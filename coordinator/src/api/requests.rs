use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{contracts::Artifact, service::NewTask};

/// A job artifact is shared with all participants.
///
/// metadata is task specific information in json format
/// For e.g for shader specific tasks
/// {
///     type: "wgsl",
///     height: ?
///     width: ?
/// }
#[derive(Deserialize)]
pub struct SubmitJobRequest {
    pub name: String,
    pub artifact: Artifact,
    pub tasks: Vec<NewTask>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Serialize)]
pub struct SubmitJobResponse {
    pub job_id: String,
}
