use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;
use crate::room::RoomTable;
use axum::{
    extract::{Path, State, ws::{WebSocketUpgrade, WebSocket, Message}},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use futures_util::{SinkExt, StreamExt};
use rand::{distr::Alphanumeric, RngExt};
use super::room::{Room, RoomStatus};

// Sending/Receiving buffer size
const BUFFER_SIZE: usize = 100;

pub type SharedAppState = Arc<Mutex<AppState>>;

// Shared struct for all clients
pub struct AppState {
    pub room_table: RoomTable, // for create_room_handler
    pub client_conn: ClientConn, // 
}

// Constructor of AppState
impl AppState {
    pub fn new() -> Self {
        Self {
            room_table: RoomTable::new(),
            client_conn: ClientConn::new(),
        }
    }
}

// Map of WS connections
pub struct ClientConn {
    // map from client_token to mpsc channel
    connections: HashMap<String, mpsc::Sender<Message>>,
}

// Constructor of ClientConn
impl ClientConn {
    fn new() -> Self {
        Self { connections: HashMap::new() }
    }
}

pub async fn ws_handler(
    State(state): State<SharedAppState>,
    Path(client_token): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    // verify if the client_token belongs to active room
    let is_active = {
        let app = state.lock().await;
        app.room_table
            .get(&client_token)
            .is_some_and(|room| matches!(&room.status, RoomStatus::Active))
    };

    if !is_active {
        return (StatusCode::UNAUTHORIZED, "Invalid or inactive client token")
            .into_response();
    }
    
    ws.on_upgrade(move |socket| handle_socket(socket, state, client_token))
}

async fn handle_socket(socket: WebSocket, state: SharedAppState, client_token: String) {
    // split sender and receiver 
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Create mpsc Channel for this connection
    let (tx, mut rx) = mpsc::channel::<Message>(BUFFER_SIZE);

    // add this channel to the connections map
    {
        let mut app = state.lock().await;
        app.client_conn.connections.insert(client_token.clone(), tx);
        println!("Sending channel of client with client_token {} added to the connections map ", client_token.clone());
    }

    // Forward messsage from the internal channel to this WebSocket
    let writer = tokio::spawn(
        async move {
            while let Some(msg) = rx.recv().await {
                if ws_sender.send(msg).await.is_err() {
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
        
        // preprocessing logic ...
    }

    // if function reaches here, connection needs to be removed from the map
    state.lock().await.client_conn.connections.remove(&client_token);

    let _ = writer.await;
}

// Alphanumeric 6 digit token generator
fn generate_token() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect()
}

pub fn create_shared_state() -> SharedAppState {
    Arc::new(Mutex::new(AppState::new()))
}

pub async fn create_room_handler(
    State(state): State<SharedAppState>,
) -> impl IntoResponse {
    let mut app = state.lock().await;
    let (client_token, room_token) = create_room(&mut app.room_table);

    format!("client_token={client_token}&room_token={room_token}")
}

fn create_room(room_table: &mut RoomTable) -> (String, String) {
    // generate tokens
    let client_token = generate_token(); // for client
    let room_token = generate_token(); // for workers

    // Room instantiation
    let new_room = Room::new(
        Uuid::new_v4(), 
        room_token.clone(), 
        client_token.clone(), 
        RoomStatus::Active
    );
    
    let room_id = new_room.room_id;

    println!("Room struct with room_id: {} created successfully", room_id);

    // save room info in the database
    room_table.insert(client_token.clone(), new_room);
    println!("Room info with room_id: {} added to database", room_id);

    (client_token, room_token)
}