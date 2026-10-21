use uuid::Uuid;

use axum::extract::ws::Message as WsMessage;
use serde::Deserialize;
use serde_json::Value;

use crate::app_state::AppState;
use crate::contracts::{
    Artifact, Capabilities, Job, JobStatus, Message, Room, RoomStatus, Task, TaskStatus, Worker,
    WorkerStatus,
};
use crate::error::AppError;
use crate::util::{generate_token, now_ms};

/// A task supplied by the client at submission time. The worker is chosen by
/// the client; the coordinator does not schedule.
#[derive(Deserialize)]
pub struct NewTask {
    pub worker_id: String,
    pub input: Value,
}

pub async fn submit_job(
    state: &AppState,
    room_id: &str,
    name: String,
    artifact: Artifact,
    tasks: Vec<NewTask>,
) -> Result<Job, AppError> {
    if tasks.is_empty() {
        return Err(AppError::BadRequest("job must have at least one task".into()));
    }

    let worker_ids: Vec<&str> = {
        let conns = state.worker_conns.lock().await;
        tasks
            .iter()
            .map(|task| task.worker_id.as_str())
            .filter(|id| !conns.contains_key(*id))
            .collect()
    };
    if let Some(id) = worker_ids.first() {
        return Err(AppError::BadRequest(format!("worker {id} is not connected")));
    }

    let job = Job {
        id: Uuid::new_v4().to_string(),
        room_id: room_id.to_string(),
        name,
        artifact,
        status: JobStatus::Created,
        created_at: now_ms(),
        started_at: None,
        finished_at: None,
    };

    let tasks = tasks
        .into_iter()
        .map(|task| Task {
            id: Uuid::new_v4().to_string(),
            job_id: job.id.clone(),
            worker_id: Some(task.worker_id),
            status: TaskStatus::Pending,
            input: task.input,
            result: None,
            error: None,
            execution_time_ms: None,
        })
        .collect::<Vec<_>>();

    state.repo.create_job(&job, &tasks).await?;
    dispatch_job(state, room_id, &job.id).await?;
    Ok(job)
}

/// Sends the artifact once per worker, then each task. The client is notified
/// as tasks move to Assigned and the job moves to Running.
async fn dispatch_job(state: &AppState, room_id: &str, job_id: &str) -> Result<(), AppError> {
    let job = state.repo.get_job(job_id).await?.ok_or(AppError::NotFound)?;
    let tasks = state.repo.get_tasks_by_job(job_id).await?;

    let mut artifact_sent: Vec<String> = Vec::new();
    let mut assigned: Vec<Task> = Vec::new();

    for task in tasks {
        let worker_id = match &task.worker_id {
            Some(id) => id.clone(),
            None => continue,
        };

        if !artifact_sent.contains(&worker_id) {
            send_to_worker(
                state,
                &worker_id,
                &Message::JobArtifact {
                    job_id: job_id.to_string(),
                    artifact: job.artifact.clone(),
                },
            )
            .await;
            artifact_sent.push(worker_id.clone());
        }

        send_to_worker(state, &worker_id, &Message::TaskAssign(task.clone())).await;

        let mut updated = task;
        updated.status = TaskStatus::Assigned;
        state.repo.update_task(&updated).await?;
        assigned.push(updated);
    }

    state.repo.set_job_status(job_id, JobStatus::Running).await?;
    state.repo.set_job_started(job_id, now_ms()).await?;

    let client_token = state
        .repo
        .get_room(room_id)
        .await?
        .ok_or(AppError::NotFound)?
        .client_token;

    for task in &assigned {
        send_to_client(state, &client_token, &Message::TaskUpdate(task.clone())).await;
    }
    if let Some(updated) = state.repo.get_job(job_id).await? {
        send_to_client(state, &client_token, &Message::JobUpdate(updated)).await;
    }

    Ok(())
}

pub async fn send_to_worker(state: &AppState, worker_id: &str, message: &Message) {
    let tx = {
        let conns = state.worker_conns.lock().await;
        conns.get(worker_id).cloned()
    };
    if let Some(tx) = tx {
        if let Ok(json) = serde_json::to_string(message) {
            let _ = tx.send(WsMessage::Text(json.into())).await;
        }
    }
}

pub async fn send_to_client(state: &AppState, client_token: &str, message: &Message) {
    let tx = {
        let conns = state.client_conns.lock().await;
        conns.get(client_token).cloned()
    };
    if let Some(tx) = tx {
        if let Ok(json) = serde_json::to_string(message) {
            let _ = tx.send(WsMessage::Text(json.into())).await;
        }
    }
}

pub async fn create_room(state: &AppState) -> Result<Room, AppError> {
    let room = Room {
        id: Uuid::new_v4().to_string(),
        name: String::new(),
        client_token: generate_token(),
        worker_token: generate_token(),
        status: RoomStatus::Active,
        created_at: now_ms(),
    };
    state.repo.create_room(&room).await?;
    Ok(room)
}

pub async fn close_room(state: &AppState, room_id: &str) -> Result<(), AppError> {
    state.repo.close_room(room_id).await
}

pub async fn register_worker(state: &AppState, room_id: &str) -> Result<Worker, AppError> {
    let room = state
        .repo
        .get_room(room_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if room.status != RoomStatus::Active {
        return Err(AppError::BadRequest("room is not active".into()));
    }

    let worker = Worker {
        id: Uuid::new_v4().to_string(),
        room_id: room_id.to_string(),
        status: WorkerStatus::Connected,
        capabilities: Capabilities::default(),
        last_seen_at: now_ms(),
    };
    state
        .workers
        .lock()
        .await
        .insert(worker.id.clone(), worker.clone());
    Ok(worker)
}

pub async fn remove_worker(state: &AppState, worker_id: &str) -> Result<Vec<Message>, AppError> {
    let worker = state.workers.lock().await.remove(worker_id);
    let mut messages = Vec::new();

    if let Some(worker) = worker {
        messages.push(Message::WorkerLeft {
            worker_id: worker.id.clone(),
        });

        let failed = state.repo.fail_tasks_by_worker(&worker.id).await?;
        for task in &failed {
            messages.push(Message::TaskUpdate(task.clone()));
        }
        if !failed.is_empty() {
            let mut job_ids: Vec<String> = Vec::new();
            for task in &failed {
                if !job_ids.contains(&task.job_id) {
                    job_ids.push(task.job_id.clone());
                }
            }
            for job_id in job_ids {
                messages.extend(fail_job_with(state, &job_id, JobStatus::Failed).await?);
            }
        }
    }

    Ok(messages)
}

pub async fn handle_worker_message(
    state: &AppState,
    worker_id: &str,
    message: Message,
) -> Result<Vec<Message>, AppError> {
    match message {
        Message::Capabilities(caps) => {
            let worker = {
                let mut workers = state.workers.lock().await;
                match workers.get_mut(worker_id) {
                    Some(worker) => {
                        worker.capabilities = caps;
                        worker.last_seen_at = now_ms();
                        worker.clone()
                    }
                    None => return Ok(Vec::new()),
                }
            };
            Ok(vec![Message::WorkerJoined(worker)])
        }
        Message::TaskStarted { task_id } => {
            let mut task = state
                .repo
                .get_task(&task_id)
                .await?
                .ok_or(AppError::NotFound)?;
            task.status = TaskStatus::Running;
            state.repo.update_task(&task).await?;
            Ok(vec![Message::TaskUpdate(task)])
        }
        Message::TaskResult {
            task_id,
            result,
            execution_time_ms,
        } => {
            let mut task = state
                .repo
                .get_task(&task_id)
                .await?
                .ok_or(AppError::NotFound)?;
            task.status = TaskStatus::Completed;
            task.result = Some(result);
            task.execution_time_ms = Some(execution_time_ms as i64);
            state.repo.update_task(&task).await?;

            let mut messages = vec![Message::TaskUpdate(task.clone())];
            messages.extend(finish_job_if_done(state, &task.job_id).await?);
            Ok(messages)
        }
        Message::TaskFailed { task_id, error } => {
            let mut task = state
                .repo
                .get_task(&task_id)
                .await?
                .ok_or(AppError::NotFound)?;
            task.status = TaskStatus::Failed;
            task.error = Some(error);
            state.repo.update_task(&task).await?;

            let mut messages = vec![Message::TaskUpdate(task.clone())];
            if let Some(job) = state.repo.get_job(&task.job_id).await? {
                messages.extend(fail_job_with(state, &job.id, JobStatus::Failed).await?);
            }
            Ok(messages)
        }
        _ => Ok(Vec::new()),
    }
}

async fn finish_job_if_done(state: &AppState, job_id: &str) -> Result<Vec<Message>, AppError> {
    let tasks = state.repo.get_tasks_by_job(job_id).await?;
    let all_done = !tasks.is_empty()
        && tasks
            .iter()
            .all(|t| matches!(t.status, TaskStatus::Completed | TaskStatus::Failed));
    if !all_done {
        return Ok(Vec::new());
    }

    let any_failed = tasks.iter().any(|t| t.status == TaskStatus::Failed);
    fail_job_with(state, job_id, if any_failed { JobStatus::Failed } else { JobStatus::Completed }).await
}

async fn fail_job_with(
    state: &AppState,
    job_id: &str,
    status: JobStatus,
) -> Result<Vec<Message>, AppError> {
    state.repo.set_job_status(job_id, status).await?;
    state.repo.set_job_finished(job_id, now_ms()).await?;
    match state.repo.get_job(job_id).await? {
        Some(updated) => Ok(vec![Message::JobUpdate(updated)]),
        None => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::AppState;
    use crate::contracts::{Artifact, File, Job, JobStatus, Task, TaskStatus};
    use crate::repository::Repository;
    use axum::extract::ws::Message as WsMessage;

    async fn test_state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let repo = Repository::open(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        repo.migrate().await.unwrap();
        (AppState::new(repo), dir)
    }

    fn sample_task(job_id: &str) -> Task {
        Task {
            id: "task-1".into(),
            job_id: job_id.to_string(),
            worker_id: Some("worker-1".into()),
            status: TaskStatus::Pending,
            input: serde_json::json!({ "a": 1, "b": 2 }),
            result: None,
            error: None,
            execution_time_ms: None,
        }
    }

    fn sample_job(room_id: &str) -> Job {
        Job {
            id: "job-1".into(),
            room_id: room_id.to_string(),
            name: "sum".into(),
            artifact: Artifact {
                entry_point: "main".into(),
                files: Vec::new(),
            },
            status: JobStatus::Created,
            created_at: 1,
            started_at: None,
            finished_at: None,
        }
    }

    #[tokio::test]
    async fn register_then_remove_worker() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();

        let worker = register_worker(&state, &room.id).await.unwrap();
        assert!(state.workers.lock().await.contains_key(&worker.id));

        let events = remove_worker(&state, &worker.id).await.unwrap();
        assert!(events
            .iter()
            .any(|m| matches!(m, Message::WorkerLeft { .. })));
        assert!(!state.workers.lock().await.contains_key(&worker.id));
    }

    #[tokio::test]
    async fn register_rejects_inactive_room() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();
        close_room(&state, &room.id).await.unwrap();

        let err = register_worker(&state, &room.id).await.unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[tokio::test]
    async fn capabilities_message_emits_worker_joined() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();
        let worker = register_worker(&state, &room.id).await.unwrap();

        let events = handle_worker_message(
            &state,
            &worker.id,
            Message::Capabilities(Capabilities {
                cores: Some(4),
                ..Default::default()
            }),
        )
        .await
        .unwrap();

        assert!(events.iter().any(|m| matches!(
            m,
            Message::WorkerJoined(w) if w.capabilities.cores == Some(4)
        )));
    }

    #[tokio::test]
    async fn task_result_completes_job() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();

        let job = sample_job(&room.id);
        state.repo.create_job(&job, &[sample_task(&job.id)]).await.unwrap();

        let events = handle_worker_message(
            &state,
            "worker-1",
            Message::TaskResult {
                task_id: "task-1".into(),
                result: serde_json::json!({ "sum": 3 }),
                execution_time_ms: 5,
            },
        )
        .await
        .unwrap();

        let task = state.repo.get_task("task-1").await.unwrap().unwrap();
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.execution_time_ms, Some(5));

        let job = state.repo.get_job("job-1").await.unwrap().unwrap();
        assert_eq!(job.status, JobStatus::Completed);
        assert!(events.iter().any(|m| matches!(m, Message::JobUpdate(_))));
    }

    #[tokio::test]
    async fn task_failed_fails_job() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();

        let job = sample_job(&room.id);
        state.repo.create_job(&job, &[sample_task(&job.id)]).await.unwrap();

        let _ = handle_worker_message(
            &state,
            "worker-1",
            Message::TaskFailed {
                task_id: "task-1".into(),
                error: "boom".into(),
            },
        )
        .await
        .unwrap();

        let task = state.repo.get_task("task-1").await.unwrap().unwrap();
        assert_eq!(task.status, TaskStatus::Failed);
        assert_eq!(task.error.as_deref(), Some("boom"));

        let job = state.repo.get_job("job-1").await.unwrap().unwrap();
        assert_eq!(job.status, JobStatus::Failed);
    }

    #[tokio::test]
    async fn submit_dispatches_artifact_and_task() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();

        let (worker_tx, mut worker_rx) = tokio::sync::mpsc::channel(10);
        state
            .worker_conns
            .lock()
            .await
            .insert("worker-1".into(), worker_tx);
        let (client_tx, mut client_rx) = tokio::sync::mpsc::channel(10);
        state
            .client_conns
            .lock()
            .await
            .insert(room.client_token.clone(), client_tx);

        let artifact = Artifact {
            entry_point: "add".into(),
            files: vec![File {
                name: "main.wasm".into(),
                content: "AGFzbQ==".into(),
                mime: Some("application/wasm".into()),
            }],
        };
        let tasks = vec![NewTask {
            worker_id: "worker-1".into(),
            input: serde_json::json!([1, 2]),
        }];

        let job = submit_job(&state, &room.id, "add job".into(), artifact, tasks)
            .await
            .unwrap();

        let job_after = state.repo.get_job(&job.id).await.unwrap().unwrap();
        assert_eq!(job_after.status, JobStatus::Running);

        let tasks_after = state.repo.get_tasks_by_job(&job.id).await.unwrap();
        assert_eq!(tasks_after.len(), 1);
        assert_eq!(tasks_after[0].status, TaskStatus::Assigned);

        // Worker receives JobArtifact then TaskAssign.
        let first = worker_rx.recv().await.unwrap();
        match first {
            WsMessage::Text(t) => assert!(t.contains("job_artifact")),
            other => panic!("expected text message, got {other:?}"),
        }
        let second = worker_rx.recv().await.unwrap();
        match second {
            WsMessage::Text(t) => assert!(t.contains("task_assign")),
            other => panic!("expected text message, got {other:?}"),
        }

        // Client is notified of the assigned task and running job.
        assert!(client_rx.recv().await.is_some());
        assert!(client_rx.recv().await.is_some());
    }

    #[tokio::test]
    async fn submit_rejects_unknown_worker() {
        let (state, _dir) = test_state().await;
        let room = create_room(&state).await.unwrap();

        let tasks = vec![NewTask {
            worker_id: "ghost".into(),
            input: serde_json::json!([]),
        }];

        let err = submit_job(
            &state,
            &room.id,
            "add".into(),
            Artifact::default(),
            tasks,
        )
        .await
        .unwrap_err();

        assert!(matches!(err, AppError::BadRequest(_)));
    }
}
