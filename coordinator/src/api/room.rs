use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        Path, State,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tokio::sync::mpsc;

use crate::app_state::{AppState, BUFFER_SIZE};
use crate::contracts::RoomStatus;
use crate::error::AppError;
use crate::service;

#[derive(Serialize)]
pub struct CreateRoomResponse {
    pub room_id: String,
    pub client_token: String,
    pub worker_token: String,
}

pub async fn create_room_handler(
    State(state): State<AppState>,
) -> Result<Json<CreateRoomResponse>, AppError> {
    let room = service::create_room(&state).await?;
    Ok(Json(CreateRoomResponse {
        room_id: room.id,
        client_token: room.client_token,
        worker_token: room.worker_token,
    }))
}

pub async fn ws_handler(
    State(state): State<AppState>,
    Path((room_id, client_token)): Path<(String, String)>,
    ws: WebSocketUpgrade,
) -> Response {
    let room = match state.repo.get_room(&room_id).await {
        Ok(Some(room)) if room.status == RoomStatus::Active => room,
        Ok(_) => return (StatusCode::NOT_FOUND, "Room is not active").into_response(),
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
        }
    };

    if room.client_token != client_token {
        return (StatusCode::UNAUTHORIZED, "Invalid client token").into_response();
    }

    ws.on_upgrade(move |socket| handle_socket(socket, state, client_token))
}

async fn handle_socket(socket: WebSocket, state: AppState, client_token: String) {
    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::channel::<WsMessage>(BUFFER_SIZE);

    state
        .client_conns
        .lock()
        .await
        .insert(client_token.clone(), tx);

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
        // TODO: Client -> server messages (e.g. JobSubmit).
    }

    state.client_conns.lock().await.remove(&client_token);
    let _ = writer.await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::Request};
    use tower::ServiceExt;

    #[tokio::test]
    async fn create_room_returns_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let repo = crate::repository::Repository::open(&format!(
            "sqlite://{}?mode=rwc",
            path.display()
        ))
        .await
        .unwrap();
        repo.migrate().await.unwrap();

        let app = crate::api::router(AppState::new(repo));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/create_room")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }
}
