use serde::{Deserialize, Serialize};
use crate::worker::{Capability};

// #[derive(Serialize, Deserialize, Debug)]
// pub enum Metadata {
//     capability(Capability),
//     job(Job)
// }

// #[derive(Serialize, Deserialize, Debug)]
// pub struct Job {
//     Id: String,
//     WorkerId: String
// }

#[derive(Serialize, Deserialize, Debug)]
pub struct SocketMessage {
    pub message_type: String,
    pub metadata: Capability,
    pub user_id: String,
}
