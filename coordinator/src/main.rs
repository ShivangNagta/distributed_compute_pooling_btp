mod client;
mod room;

use axum::{http::{header::{AUTHORIZATION, CONTENT_TYPE}, StatusCode}, response::IntoResponse, routing::get , Router};
use tower_http::cors::{Any, CorsLayer};
use client::{create_room_handler, create_shared_state, SharedAppState};

// CORS: https://medium.com/@mikecode/axum-28-cors-596e311fc6cc
// http://docs.rs/tower-http/latest/tower_http/cors/index.html

#[tokio::main]
async fn main() {
    let app = app(create_shared_state());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

fn app(state: SharedAppState) -> Router {
    let cors_layer = CorsLayer::new().allow_methods(Any).allow_origin(Any).allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    Router::new()
        .route("/", get(|| async{"hello from coordinator"}))
        .route("/create_room", axum::routing::post(create_room_handler))
        .route("/ws/{client_token}", axum::routing::any(client::ws_handler))
        .with_state(state)
        .layer(cors_layer)
}