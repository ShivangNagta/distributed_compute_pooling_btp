use axum::{
    Json,
    extract::{Path, State},
    http::header::HeaderMap,
};
use serde::Serialize;

use crate::api::requests::{SubmitJobRequest, SubmitJobResponse};
use crate::app_state::AppState;
use crate::contracts::{Job, Task};
use crate::error::AppError;
use crate::service;

/// Recovery path. The happy path is WebSocket events (task_update /
/// job_update); this lets a client that missed them fetch the current
/// persisted state of a job on reconnect.
#[derive(Serialize)]
pub struct JobResponse {
    pub job: Job,
    pub tasks: Vec<Task>,
}

fn client_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
}

async fn authenticated_room(
    state: &AppState,
    room_id: &str,
    headers: &HeaderMap,
) -> Result<crate::contracts::Room, AppError> {
    let token = client_token(headers).ok_or(AppError::Unauthorized)?;
    let room = state
        .repo
        .get_room_by_client_token(token)
        .await?
        .ok_or(AppError::NotFound)?;
    if room.id != room_id {
        return Err(AppError::NotFound);
    }
    Ok(room)
}

// middleware handler that passes on to the task specific handlers
pub async fn submit_handler(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<SubmitJobRequest>,
) -> Result<Json<SubmitJobResponse>, AppError> {
    authenticated_room(&state, &room_id, &headers).await?;

    let job = if request
        .metadata
        .get("type")
        .and_then(|value| value.as_str())
        == Some("wgsl")
    {
        crate::shader_handler::submit(&state, &room_id, request).await?
    } else {
        service::submit_job(
            &state,
            &room_id,
            request.name,
            request.artifact,
            request.tasks,
        )
        .await?
    };

    Ok(Json(SubmitJobResponse { job_id: job.id }))
}

pub async fn get_handler(
    State(state): State<AppState>,
    Path((room_id, job_id)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<JobResponse>, AppError> {
    authenticated_room(&state, &room_id, &headers).await?;

    let job = state
        .repo
        .get_job(&job_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if job.room_id != room_id {
        return Err(AppError::NotFound);
    }
    let tasks = state.repo.get_tasks_by_job(&job_id).await?;
    Ok(Json(JobResponse { job, tasks }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request, http::StatusCode};
    use tower::ServiceExt;

    use crate::contracts::{Artifact, JobStatus, TaskStatus};
    use crate::repository::Repository;
    use crate::service;

    async fn setup() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let repo = Repository::open(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        repo.migrate().await.unwrap();
        (AppState::new(repo), dir)
    }

    async fn seed_job(state: &AppState, room_id: &str) -> Job {
        let job = Job {
            id: "job-1".into(),
            room_id: room_id.to_string(),
            name: "sum".into(),
            artifact: Artifact {
                entry_point: "main".into(),
                files: Vec::new(),
                kind: Default::default(),
            },
            status: JobStatus::Created,
            created_at: 1,
            started_at: None,
            finished_at: None,
        };
        let task = Task {
            id: "task-1".into(),
            job_id: "job-1".into(),
            worker_id: Some("worker-1".into()),
            status: TaskStatus::Pending,
            input: serde_json::json!({ "a": 1 }),
            result: None,
            error: None,
            execution_time_ms: None,
        };
        state.repo.create_job(&job, &[task]).await.unwrap();
        job
    }

    #[tokio::test]
    async fn get_job_returns_persisted_state() {
        let (state, _dir) = setup().await;
        let room = service::create_room(&state).await.unwrap();
        let job = seed_job(&state, &room.id).await;

        let app = crate::api::router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/room/{}/job/{}", room.id, job.id))
                    .header("Authorization", format!("Bearer {}", room.client_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn get_job_requires_auth() {
        let (state, _dir) = setup().await;
        let room = service::create_room(&state).await.unwrap();
        let job = seed_job(&state, &room.id).await;

        let app = crate::api::router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/room/{}/job/{}", room.id, job.id))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn get_job_rejects_wrong_room_for_token() {
        let (state, _dir) = setup().await;
        let room = service::create_room(&state).await.unwrap();
        let other = service::create_room(&state).await.unwrap();
        let job = seed_job(&state, &other.id).await;

        let app = crate::api::router(state);
        let response = app
            .oneshot(
                Request::builder()
                    .method("GET")
                    .uri(format!("/room/{}/job/{}", room.id, job.id))
                    .header("Authorization", format!("Bearer {}", room.client_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn submit_job_creates_and_dispatches() {
        let (state, _dir) = setup().await;
        let room = service::create_room(&state).await.unwrap();

        let (tx, _rx) = tokio::sync::mpsc::channel(10);
        state
            .worker_conns
            .lock()
            .await
            .insert("worker-1".into(), tx);

        let app = crate::api::router(state);
        let body = serde_json::json!({
            "name": "add",
            "artifact": {
                "entry_point": "add",
                "files": [{ "name": "main.wasm", "content": "AGFzbQ==", "mime": "application/wasm" }]
            },
            "tasks": [{ "worker_id": "worker-1", "input": [1, 2] }]
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/room/{}/wasm-job/submit", room.id))
                    .header("Authorization", format!("Bearer {}", room.client_token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
