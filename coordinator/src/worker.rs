
use uuid::Uuid;
use axum::{
    extract::{Path, State, ws::{WebSocketUpgrade, WebSocket, Message}},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use tokio::sync::mpsc;
use futures_util::{SinkExt, StreamExt};
use super::room::{RoomStatus, Room};
use crate::app_state::{SharedAppState, BUFFER_SIZE};

pub async fn ws_worker_handler(
    State(state): State<SharedAppState>,
    Path((room_id, room_token)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> Response {

    // verify if the room_id belongs to active room
    let is_active = {
        let app = state.lock().await;
        app.room_table
            .get(&room_id)
            .is_some_and(|room| matches!(&room.status, RoomStatus::Active))
        };
        
    if !is_active {
        return (StatusCode::NOT_FOUND, "Room is not active")
            .into_response();
    }

    // authenticate worker via room_token
    let is_authenticated = {
        let app = state.lock().await;
        app.room_table
            .get(&room_id)
            .is_some_and(|room| room.room_token == room_token)
    };

    if !is_authenticated {
        return (StatusCode::UNAUTHORIZED, "Invalid or inactive room token")
            .into_response();
    }
    
    ws.on_upgrade(move |socket| handle_socket(socket, state, room_token, room_id))
}


async fn handle_socket(socket: WebSocket, state: SharedAppState, room_token: String, room_id: String) {
    // split sender and receiver 
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create mpsc Channel for this connection
    let (tx, mut rx) = mpsc::channel::<Message>(BUFFER_SIZE);

    // add this channel to the connections map
    {
        let mut app = state.lock().await;
        app.worker_conn.connections.insert(room_token.clone(), tx);
        println!("Sending channel of worker with room_token {} added to the worker connections map ", room_token.clone());
    }

    // Forward messsage from the internal channel to this WebSocket
    let writer = tokio::spawn(
        async move {
            while let Some(msg) = rx.recv().await {
                if ws_sender.send(msg.clone()).await.is_err() {
                    break;
                }
            }
        }
    );

    while let Some(Ok(msg)) = ws_receiver.next().await {
        // if it receives close message, close the connection
        if matches!(msg, Message::Close(_)){
            break;
        }
        
        // Forward messages received from the worker to the room's client.
        let client_tx_channel = {
            let app = state.lock().await;
            app.room_table
                .get(&room_id)
                .and_then(|room| app.client_conn.connections.get(&room.client_token))
                .cloned()
        };

        if let Some(client_tx_channel) = client_tx_channel {
            if client_tx_channel.send(msg).await.is_err() {
                break;
            }
        }
    }

    // if function reaches here, connection needs to be removed from the map
    // state.lock().await.client_conn.connections.remove(&room_token);

    let _ = writer.await;
}

pub struct GpuInformation {
    vendor: String,
    architecture: String,
    device: String,
    description: String,
}

pub struct Capabilities {
    pub cores: i32,
    pub memory_gb: f32,
    pub platform: String,
    pub user_agent: String,
    pub gpu: GpuInformation,
}

pub struct Worker {
    pub worker_id: Uuid,
    pub capabilites: Capabilities,
}

// pub struct WorkerTable {
//     pub workers: HashMap<String, Worker>,
// }

// impl WorkerTable {
//     pub fn new() -> Self {
//         Self {
//             workers: HashMap::new(),
//         }
//     }

//     pub fn insert(&mut self, worker_id: Uuid, worker: Worker) {
//         self.rooms.insert(client_token, room);
//     }
// }

