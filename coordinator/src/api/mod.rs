pub mod job;
pub mod requests;
pub mod room;
pub mod worker;

use axum::{
    Router,
    http::header::{AUTHORIZATION, CONTENT_TYPE},
    routing::{get, post},
};
use tower_http::cors::{Any, CorsLayer};

use crate::app_state::AppState;

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_methods(Any)
        .allow_origin(Any)
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    Router::new()
        .route("/", get(root))
        .route("/create_room", post(room::create_room_handler))
        .route("/ws/{room_id}/{client_token}", get(room::ws_handler))
        .route(
            "/ws/join_room/{room_id}/{room_token}",
            get(worker::ws_handler),
        )
        .route("/room/{room_id}/job/submit", post(job::submit_handler))
        // .route("/room/{room_id}/wasm-job/submit", post(job::submit_handler))
        // .route(
        //     "/room/{room_id}/shader-job/submit",
        //     post(job::submit_handler),
        // )
        .route("/room/{room_id}/job/{job_id}", get(job::get_handler))
        .with_state(state)
        .layer(cors)
}

async fn root() -> &'static str {
    "hello from coordinator"
}
