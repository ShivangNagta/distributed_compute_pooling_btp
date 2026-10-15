use crate::room::RoomTable;
use crate::worker::WorkerTable;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use tokio::sync::mpsc;
use axum::{
    extract::{ws::{Message}},
};

// Sending/Receiving buffer size
pub const BUFFER_SIZE: usize = 100;

pub type SharedAppState = Arc<Mutex<AppState>>;

// Shared struct for all clients
pub struct AppState {
    pub room_table: RoomTable, // for create_room_handler
    pub client_conn: ClientConn,
    pub worker_conn: WorkerConn,
    pub worker_table: WorkerTable, // temp
}

// Constructor of AppState
impl AppState {
    pub fn new() -> Self {
        Self {
            room_table: RoomTable::new(),
            client_conn: ClientConn::new(),
            worker_conn: WorkerConn::new(),
            worker_table: WorkerTable::new(),
        }
    }
}

pub fn create_shared_state() -> SharedAppState {
    Arc::new(Mutex::new(AppState::new()))
}

// Map of WS connections
pub struct ClientConn {
    // map from client_token to mpsc channel
    pub connections: HashMap<String, mpsc::Sender<Message>>,
}

// Constructor of ClientConn
impl ClientConn {
    fn new() -> Self {
        Self { connections: HashMap::new() }
    }
}

pub struct WorkerConn {
    // map from client_token to mpsc channel
    pub connections: HashMap<String, mpsc::Sender<Message>>,
}

// Constructor of WorkerConn
impl WorkerConn {
    fn new() -> Self {
        Self { connections: HashMap::new() }
    }
}
