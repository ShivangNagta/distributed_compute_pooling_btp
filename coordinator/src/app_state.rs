use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::ws::Message;
use tokio::sync::{Mutex, mpsc};

use crate::contracts::Worker;
use crate::repository::Repository;

pub const BUFFER_SIZE: usize = 100;

// Durable state lives in Repository (SQLite). Only ephemeral, session-scoped
// state (live sockets, the worker registry) is held here.
#[derive(Clone)]
pub struct AppState {
    pub repo: Repository,
    pub client_conns: Arc<Mutex<HashMap<String, mpsc::Sender<Message>>>>,
    pub worker_conns: Arc<Mutex<HashMap<String, mpsc::Sender<Message>>>>,
    pub workers: Arc<Mutex<HashMap<String, Worker>>>,
}

impl AppState {
    pub fn new(repo: Repository) -> Self {
        Self {
            repo,
            client_conns: Arc::new(Mutex::new(HashMap::new())),
            worker_conns: Arc::new(Mutex::new(HashMap::new())),
            workers: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
