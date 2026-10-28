use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoomStatus {
    Active,
    Closed,
}

impl RoomStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            RoomStatus::Active => "active",
            RoomStatus::Closed => "closed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "active" => Some(RoomStatus::Active),
            "closed" => Some(RoomStatus::Closed),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkerStatus {
    Connected,
    Busy,
    Disconnected,
}

impl WorkerStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            WorkerStatus::Connected => "connected",
            WorkerStatus::Busy => "busy",
            WorkerStatus::Disconnected => "disconnected",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "connected" => Some(WorkerStatus::Connected),
            "busy" => Some(WorkerStatus::Busy),
            "disconnected" => Some(WorkerStatus::Disconnected),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Created,
    Running,
    Completed,
    Failed,
}

impl JobStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            JobStatus::Created => "created",
            JobStatus::Running => "running",
            JobStatus::Completed => "completed",
            JobStatus::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "created" => Some(JobStatus::Created),
            "running" => Some(JobStatus::Running),
            "completed" => Some(JobStatus::Completed),
            "failed" => Some(JobStatus::Failed),
            _ => None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    Assigned,
    Running,
    Completed,
    Failed,
}

impl TaskStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TaskStatus::Pending => "pending",
            TaskStatus::Assigned => "assigned",
            TaskStatus::Running => "running",
            TaskStatus::Completed => "completed",
            TaskStatus::Failed => "failed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(TaskStatus::Pending),
            "assigned" => Some(TaskStatus::Assigned),
            "running" => Some(TaskStatus::Running),
            "completed" => Some(TaskStatus::Completed),
            "failed" => Some(TaskStatus::Failed),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct GpuInformation {
    pub vendor: Option<String>,
    pub architecture: Option<String>,
    pub device: Option<String>,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Capabilities {
    pub cores: Option<i32>,
    pub memory_gb: Option<i32>,
    pub platform: Option<String>,
    pub user_agent: Option<String>,
    pub gpu: Option<GpuInformation>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Room {
    pub id: String,
    pub name: String,
    pub client_token: String,
    pub worker_token: String,
    pub status: RoomStatus,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Worker {
    pub id: String,
    pub room_id: String,
    pub status: WorkerStatus,
    pub capabilities: Capabilities,
    pub last_seen_at: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct File {
    /// File name as the worker should see it, e.g. "main.wasm", "shader.wgsl",
    pub name: String,
    /// Base64-encoded bytes.
    pub content: String,
    /// Optional media type, e.g. "application/wasm", "text/wgsl", "text/csv".
    pub mime: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactKind {
    Wasm,
    ShaderCompute,
}

impl Default for ArtifactKind {
    fn default() -> Self {
        Self::Wasm
    }
}

/// The executable payload of a job.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct Artifact {
    pub entry_point: String,
    pub files: Vec<File>,
    #[serde(default)]
    pub kind: ArtifactKind,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Job {
    pub id: String,
    pub room_id: String,
    pub name: String,
    pub artifact: Artifact,
    pub status: JobStatus,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Task {
    pub id: String,
    pub job_id: String,
    pub worker_id: Option<String>,
    pub status: TaskStatus,
    pub input: Value,
    pub result: Option<Value>,
    pub error: Option<String>,
    pub execution_time_ms: Option<i64>,
}

// ---------------------------------------------------------------------------
// Wire contract (one enum used on both WebSocket channels)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", content = "payload", rename_all = "snake_case")]
pub enum Message {
    Capabilities(Capabilities),
    WorkerJoined(Worker),
    WorkerLeft {
        worker_id: String,
    },
    /// Sent once per job before its tasks, so the artifact is not repeated on
    /// every TaskAssign.
    JobArtifact {
        job_id: String,
        artifact: Artifact,
    },
    TaskAssign(Task),
    TaskStarted {
        task_id: String,
    },
    TaskResult {
        task_id: String,
        result: Value,
        execution_time_ms: u64,
    },
    TaskFailed {
        task_id: String,
        error: String,
    },
    JobUpdate(Job),
    TaskUpdate(Task),
    Error {
        reason: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_round_trips_with_payload() {
        let msg = Message::Capabilities(Capabilities {
            cores: Some(8),
            memory_gb: Some(16),
            platform: Some("macOS".into()),
            user_agent: Some("test".into()),
            gpu: None,
        });

        let json = serde_json::to_string(&msg).unwrap();
        let value: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "capabilities");
        assert_eq!(value["payload"]["cores"], 8);

        let back: Message = serde_json::from_str(&json).unwrap();
        match back {
            Message::Capabilities(caps) => assert_eq!(caps.cores, Some(8)),
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn job_artifact_carries_multiple_files() {
        let artifact = Artifact {
            entry_point: "sum".into(),
            files: vec![
                File {
                    name: "main.wasm".into(),
                    content: "AGFzbQ==".into(),
                    mime: Some("application/wasm".into()),
                },
                File {
                    name: "data.csv".into(),
                    content: "MSwy".into(),
                    mime: Some("text/csv".into()),
                },
            ],
            kind: ArtifactKind::Wasm,
        };

        let json = serde_json::to_string(&Message::JobArtifact {
            job_id: "job-1".into(),
            artifact,
        })
        .unwrap();
        let value: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "job_artifact");
        assert_eq!(value["payload"]["artifact"]["entry_point"], "sum");
        assert_eq!(
            value["payload"]["artifact"]["files"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn task_result_is_flat_within_payload() {
        let msg = Message::TaskResult {
            task_id: "t1".into(),
            result: Value::from(3),
            execution_time_ms: 42,
        };

        let value: Value = serde_json::from_str(&serde_json::to_string(&msg).unwrap()).unwrap();
        assert_eq!(value["type"], "task_result");
        assert_eq!(value["payload"]["task_id"], "t1");
        assert_eq!(value["payload"]["execution_time_ms"], 42);
        assert_eq!(value["payload"]["result"], 3);
    }

    #[test]
    fn unknown_variant_is_rejected() {
        assert!(serde_json::from_str::<Message>(r#"{"type":"nope"}"#).is_err());
    }

    #[test]
    fn status_as_str_and_parse_agree() {
        assert_eq!(RoomStatus::Active.as_str(), "active");
        assert_eq!(RoomStatus::parse("closed"), Some(RoomStatus::Closed));
        assert_eq!(JobStatus::Running.as_str(), "running");
        assert_eq!(TaskStatus::parse("pending"), Some(TaskStatus::Pending));
        assert_eq!(WorkerStatus::parse("busy"), Some(WorkerStatus::Busy));
    }
}
