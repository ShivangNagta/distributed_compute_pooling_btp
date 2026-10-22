use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::app_state::{AppState, BUFFER_SIZE};
use crate::contracts::{Message, RoomStatus};
use crate::service;

pub async fn ws_handler(
    State(state): State<AppState>,
    Path((room_id, room_token)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> Response {
    let room = match state.repo.get_room(&room_id).await {
        Ok(Some(room)) if room.status == RoomStatus::Active => room,
        Ok(_) => return (StatusCode::NOT_FOUND, "Room is not active").into_response(),
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    };

    if room.worker_token != room_token {
        return (StatusCode::UNAUTHORIZED, "Invalid room token").into_response();
    }

    let client_token = room.client_token.clone();
    ws.on_upgrade(move |socket| handle_socket(socket, state, room_id, client_token))
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    room_id: String,
    client_token: String,
) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::channel::<WsMessage>(BUFFER_SIZE);

    let worker = match service::register_worker(&state, &room_id).await {
        Ok(worker) => worker,
        Err(_) => return,
    };
    let worker_id = worker.id.clone();

    state
        .worker_conns
        .lock()
        .await
        .insert(worker_id.clone(), tx);

    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = ws_receiver.next().await {
        if matches!(msg, WsMessage::Close(_)) {
            break;
        }

        let text = match msg {
            WsMessage::Text(text) => text,
            _ => continue,
        };
        let message = match serde_json::from_str::<Message>(&text) {
            Ok(message) => message,
            Err(_) => continue,
        };
        let events = match service::handle_worker_message(&state, &worker_id, message).await {
            Ok(events) => events,
            Err(_) => continue,
        };
        for event in events {
            service::send_to_client(&state, &client_token, &event).await;
        }
    }

    state.worker_conns.lock().await.remove(&worker_id);
    let events = service::remove_worker(&state, &worker_id)
        .await
        .unwrap_or_default();
    for event in events {
        service::send_to_client(&state, &client_token, &event).await;
    }

    let _ = writer.await;
}
