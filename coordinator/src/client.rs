use uuid::Uuid;
use crate::room::{RoomTable};
use crate::common::SocketMessage;
use axum::{
    extract::{Path, State, ws::{WebSocketUpgrade, WebSocket, Message}, Json},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use tokio::sync::mpsc;
use futures_util::{SinkExt, StreamExt};
use rand::{distr::Alphanumeric, RngExt};
use super::room::{Room, RoomStatus};
use crate::app_state::{SharedAppState, BUFFER_SIZE};

pub async fn ws_handler(
    State(state): State<SharedAppState>,
    Path((room_id, client_token)): Path<(String, String)>,
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

    // authenticate client via client_token
    let is_authenticated = {
        let app = state.lock().await;
        app.room_table
            .get(&room_id)
            .is_some_and(|room| room.client_token == client_token)
    };

    if !is_authenticated {
        return (StatusCode::UNAUTHORIZED, "Invalid or inactive client token")
            .into_response();
    }

    print!("Hello");
    
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
                println!("[Client] received {:?}", msg);
                let s = Json(&msg).to_text().unwrap();
                let p: SocketMessage = serde_json::from_str(&s).unwrap();
                println!("[Client] parsed message {:?}", p);
                if ws_sender.send(msg).await.is_err() {
                    break;
                }
            }
        }
    );

    while let Some(Ok(msg)) = ws_receiver.next().await {
        // recieve job from browser websocket here
        // if it receives close message, close the connection
        println!("{:?}", msg);
        if matches!(msg, Message::Close(_)){
            break;
        }
        
        // send the jobs to workers through
        /*
            let worker_tx_channel = {
                let app = state.lock().await;
                app.room_table
                    .get(&room_id)
                    .and_then(|room| app.worker_conn.connections.get(&worker_id))
                    .cloned()
            };

            if let Some(worker_tx_channel) = worker_tx_channel {
                if worker_tx_channel.send(msg).await.is_err() {
                    break;
                }
            }
        */
        // receving updates from the workers ...
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

pub async fn create_room_handler(
    State(state): State<SharedAppState>,
) -> impl IntoResponse {
    let mut app = state.lock().await;
    let (room_id, client_token, room_token) = create_room(&mut app.room_table);

    format!("room_id={room_id}&client_token={client_token}&room_token={room_token}")
}

fn create_room(room_table: &mut RoomTable) -> (Uuid, String, String) {
    // generate tokens
    let client_token = generate_token(); // for client
    let room_token = generate_token(); // for workers
    let room_id = Uuid::new_v4();

    // Room instantiation
    let new_room = Room::new(
        room_id,
        room_token.clone(), 
        client_token.clone(), 
        RoomStatus::Active
    );
    
    let room_id = new_room.room_id;

    println!("Room struct with room_id: {} created successfully", room_id);

    // save room info in the database
    room_table.insert(room_id.clone(), new_room);
    println!("Room info with room_id: {} added to database", room_id);

    (room_id, client_token, room_token)
}
