use sqlx::Row;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};

use crate::contracts::{Job, JobStatus, Room, RoomStatus, Task, TaskStatus};
use crate::error::AppError;

/// Durable storage. Wraps a SQLite connection pool and exposes domain-level
/// queries.
#[derive(Clone)]
pub struct Repository {
    pool: SqlitePool,
}

impl Repository {
    pub async fn open(path: &str) -> Result<Self, AppError> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(path)
            .await?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> Result<(), AppError> {
        sqlx::migrate!("./migrations").run(&self.pool).await?;
        Ok(())
    }

    // ------------------------------------------------------------------ rooms

    pub async fn create_room(&self, room: &Room) -> Result<(), AppError> {
        sqlx::query(
            "INSERT INTO rooms (id, name, client_token, worker_token, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&room.id)
        .bind(&room.name)
        .bind(&room.client_token)
        .bind(&room.worker_token)
        .bind(room.status.as_str())
        .bind(room.created_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn get_room(&self, id: &str) -> Result<Option<Room>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, client_token, worker_token, status, created_at
             FROM rooms WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.as_ref().map(row_to_room))
    }

    pub async fn get_room_by_client_token(&self, token: &str) -> Result<Option<Room>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, client_token, worker_token, status, created_at
             FROM rooms WHERE client_token = ?1",
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.as_ref().map(row_to_room))
    }

    pub async fn get_room_by_worker_token(&self, token: &str) -> Result<Option<Room>, AppError> {
        let row = sqlx::query(
            "SELECT id, name, client_token, worker_token, status, created_at
             FROM rooms WHERE worker_token = ?1",
        )
        .bind(token)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.as_ref().map(row_to_room))
    }

    pub async fn close_room(&self, id: &str) -> Result<(), AppError> {
        sqlx::query("UPDATE rooms SET status = ?1 WHERE id = ?2")
            .bind(RoomStatus::Closed.as_str())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ------------------------------------------------------------------- jobs

    pub async fn create_job(&self, job: &Job, tasks: &[Task]) -> Result<(), AppError> {
        let mut tx = self.pool.begin().await?;

        sqlx::query(
            "INSERT INTO jobs (id, room_id, name, artifact_json,
                               status, created_at, started_at, finished_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&job.id)
        .bind(&job.room_id)
        .bind(&job.name)
        .bind(serde_json::to_string(&job.artifact)?)
        .bind(job.status.as_str())
        .bind(job.created_at)
        .bind(job.started_at)
        .bind(job.finished_at)
        .execute(&mut *tx)
        .await?;

        for task in tasks {
            sqlx::query(
                "INSERT INTO tasks (id, job_id, worker_id, status, input_json,
                                   result_json, error, execution_time_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )
            .bind(&task.id)
            .bind(&task.job_id)
            .bind(&task.worker_id)
            .bind(task.status.as_str())
            .bind(serde_json::to_string(&task.input)?)
            .bind(json_col(&task.result))
            .bind(&task.error)
            .bind(task.execution_time_ms)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn get_job(&self, id: &str) -> Result<Option<Job>, AppError> {
        let row = sqlx::query(
            "SELECT id, room_id, name, artifact_json,
                    status, created_at, started_at, finished_at
             FROM jobs WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.as_ref().map(row_to_job))
    }

    pub async fn set_job_status(&self, id: &str, status: JobStatus) -> Result<(), AppError> {
        sqlx::query("UPDATE jobs SET status = ?1 WHERE id = ?2")
            .bind(status.as_str())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_job_started(&self, id: &str, at: i64) -> Result<(), AppError> {
        sqlx::query("UPDATE jobs SET started_at = ?1 WHERE id = ?2")
            .bind(at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_job_finished(&self, id: &str, at: i64) -> Result<(), AppError> {
        sqlx::query("UPDATE jobs SET finished_at = ?1 WHERE id = ?2")
            .bind(at)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ------------------------------------------------------------------ tasks

    pub async fn get_task(&self, id: &str) -> Result<Option<Task>, AppError> {
        let row = sqlx::query(
            "SELECT id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms
             FROM tasks WHERE id = ?1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.as_ref().map(row_to_task))
    }

    pub async fn get_tasks_by_job(&self, job_id: &str) -> Result<Vec<Task>, AppError> {
        let rows = sqlx::query(
            "SELECT id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms
             FROM tasks WHERE job_id = ?1",
        )
        .bind(job_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(row_to_task).collect())
    }

    pub async fn update_task(&self, task: &Task) -> Result<(), AppError> {
        sqlx::query(
            "UPDATE tasks
             SET status = ?1, result_json = ?2, error = ?3, execution_time_ms = ?4
             WHERE id = ?5",
        )
        .bind(task.status.as_str())
        .bind(json_col(&task.result))
        .bind(&task.error)
        .bind(task.execution_time_ms)
        .bind(&task.id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Marks every assigned/running task owned by a worker as Failed.
    pub async fn fail_tasks_by_worker(&self, worker_id: &str) -> Result<Vec<Task>, AppError> {
        let rows = sqlx::query(
            "SELECT id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms
             FROM tasks
             WHERE worker_id = ?1 AND status IN ('assigned', 'running')",
        )
        .bind(worker_id)
        .fetch_all(&self.pool)
        .await?;

        let mut failed = Vec::new();
        for row in rows.iter() {
            let mut task = row_to_task(row);
            task.status = TaskStatus::Failed;
            task.error = Some("worker disconnected".to_string());
            failed.push(task);
        }
        for task in &failed {
            self.update_task(task).await?;
        }
        Ok(failed)
    }
}

fn json_col(value: &Option<serde_json::Value>) -> Option<String> {
    value.as_ref().map(|v| v.to_string())
}

fn row_to_room(row: &sqlx::sqlite::SqliteRow) -> Room {
    let status: String = row.get("status");
    Room {
        id: row.get("id"),
        name: row.get("name"),
        client_token: row.get("client_token"),
        worker_token: row.get("worker_token"),
        status: RoomStatus::parse(&status).unwrap_or(RoomStatus::Closed),
        created_at: row.get("created_at"),
    }
}

fn row_to_job(row: &sqlx::sqlite::SqliteRow) -> Job {
    let status: String = row.get("status");
    let artifact_json: String = row.get("artifact_json");
    Job {
        id: row.get("id"),
        room_id: row.get("room_id"),
        name: row.get("name"),
        artifact: serde_json::from_str(&artifact_json).unwrap_or_default(),
        status: JobStatus::parse(&status).unwrap_or(JobStatus::Created),
        created_at: row.get("created_at"),
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
    }
}

fn row_to_task(row: &sqlx::sqlite::SqliteRow) -> Task {
    let status: String = row.get("status");
    let input_json: String = row.get("input_json");
    let result_json: Option<String> = row.get("result_json");
    Task {
        id: row.get("id"),
        job_id: row.get("job_id"),
        worker_id: row.get("worker_id"),
        status: TaskStatus::parse(&status).unwrap_or(TaskStatus::Pending),
        input: serde_json::from_str(&input_json).unwrap_or(serde_json::Value::Null),
        result: result_json.and_then(|s| serde_json::from_str(&s).ok()),
        error: row.get("error"),
        execution_time_ms: row.get("execution_time_ms"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{Artifact, File, JobStatus, RoomStatus, TaskStatus};

    async fn test_repo() -> (Repository, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let repo = Repository::open(&format!("sqlite://{}?mode=rwc", path.display()))
            .await
            .unwrap();
        repo.migrate().await.unwrap();
        (repo, dir)
    }

    fn sample_room() -> Room {
        Room {
            id: "room-1".into(),
            name: "test".into(),
            client_token: "ctoken".into(),
            worker_token: "wtoken".into(),
            status: RoomStatus::Active,
            created_at: 1,
        }
    }

    #[tokio::test]
    async fn room_round_trip() {
        let (repo, _dir) = test_repo().await;
        repo.create_room(&sample_room()).await.unwrap();

        let got = repo.get_room("room-1").await.unwrap().unwrap();
        assert_eq!(got.client_token, "ctoken");
        assert_eq!(got.worker_token, "wtoken");
        assert_eq!(got.status, RoomStatus::Active);

        assert!(repo.get_room("nope").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn room_lookup_by_tokens() {
        let (repo, _dir) = test_repo().await;
        repo.create_room(&sample_room()).await.unwrap();

        assert_eq!(
            repo.get_room_by_client_token("ctoken")
                .await
                .unwrap()
                .unwrap()
                .id,
            "room-1"
        );
        assert_eq!(
            repo.get_room_by_worker_token("wtoken")
                .await
                .unwrap()
                .unwrap()
                .id,
            "room-1"
        );
    }

    #[tokio::test]
    async fn job_and_tasks_round_trip() {
        let (repo, _dir) = test_repo().await;
        repo.create_room(&sample_room()).await.unwrap();

        let job = Job {
            id: "job-1".into(),
            room_id: "room-1".into(),
            name: "sum".into(),
            artifact: Artifact {
                entry_point: "main".into(),
                files: vec![File {
                    name: "main.wasm".into(),
                    content: "AGFzbQ==".into(),
                    mime: Some("application/wasm".into()),
                }],
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
            input: serde_json::json!({ "a": 1, "b": 2 }),
            result: None,
            error: None,
            execution_time_ms: None,
        };

        repo.create_job(&job, &[task]).await.unwrap();

        let got_job = repo.get_job("job-1").await.unwrap().unwrap();
        assert_eq!(got_job.name, "sum");
        assert_eq!(got_job.artifact.entry_point, "main");
        assert_eq!(got_job.status, JobStatus::Created);

        let tasks = repo.get_tasks_by_job("job-1").await.unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].input["a"], 1);
        assert_eq!(tasks[0].worker_id.as_deref(), Some("worker-1"));
    }

    #[tokio::test]
    async fn update_task_and_job_status() {
        let (repo, _dir) = test_repo().await;
        repo.create_room(&sample_room()).await.unwrap();

        let job = Job {
            id: "job-1".into(),
            room_id: "room-1".into(),
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
            input: serde_json::Value::Null,
            result: None,
            error: None,
            execution_time_ms: None,
        };
        repo.create_job(&job, &[task]).await.unwrap();

        let mut task = repo.get_task("task-1").await.unwrap().unwrap();
        task.status = TaskStatus::Completed;
        task.result = Some(serde_json::json!({ "sum": 3 }));
        task.execution_time_ms = Some(7);
        repo.update_task(&task).await.unwrap();

        repo.set_job_status("job-1", JobStatus::Running)
            .await
            .unwrap();
        repo.set_job_started("job-1", 100).await.unwrap();
        repo.set_job_finished("job-1", 200).await.unwrap();

        let task = repo.get_task("task-1").await.unwrap().unwrap();
        assert_eq!(task.status, TaskStatus::Completed);
        assert_eq!(task.execution_time_ms, Some(7));
        assert_eq!(task.result.unwrap()["sum"], 3);

        let job = repo.get_job("job-1").await.unwrap().unwrap();
        assert_eq!(job.status, JobStatus::Running);
        assert_eq!(job.started_at, Some(100));
        assert_eq!(job.finished_at, Some(200));
    }

    #[tokio::test]
    async fn fail_tasks_by_worker_only_hits_active_ones() {
        let (repo, _dir) = test_repo().await;
        repo.create_room(&sample_room()).await.unwrap();

        let job = Job {
            id: "job-1".into(),
            room_id: "room-1".into(),
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
        let pending = Task {
            id: "task-pending".into(),
            job_id: "job-1".into(),
            worker_id: Some("worker-1".into()),
            status: TaskStatus::Pending,
            input: serde_json::Value::Null,
            result: None,
            error: None,
            execution_time_ms: None,
        };
        let running = Task {
            id: "task-running".into(),
            job_id: "job-1".into(),
            worker_id: Some("worker-1".into()),
            status: TaskStatus::Running,
            input: serde_json::Value::Null,
            result: None,
            error: None,
            execution_time_ms: None,
        };
        repo.create_job(&job, &[pending, running]).await.unwrap();

        let failed = repo.fail_tasks_by_worker("worker-1").await.unwrap();
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].id, "task-running");
        assert_eq!(failed[0].status, TaskStatus::Failed);

        let still_pending = repo.get_task("task-pending").await.unwrap().unwrap();
        assert_eq!(still_pending.status, TaskStatus::Pending);
    }
}
