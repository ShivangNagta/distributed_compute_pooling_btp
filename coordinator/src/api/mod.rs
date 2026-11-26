pub mod job;
pub mod requests;
pub mod room;
pub mod worker;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::header::{AUTHORIZATION, CONTENT_TYPE},
    routing::{get, post},
};
use tower_http::cors::{Any, CorsLayer};

use crate::app_state::AppState;

const MAX_JOB_REQUEST_BYTES: usize = 16 * 1024 * 1024;

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_methods(Any)
        .allow_origin(Any)
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    Router::new()
        .route("/", get(root))
        .route("/create_room", post(room::create_room_handler))
        .route(
            "/rooms/passwordless",
            get(room::list_passwordless_rooms_handler),
        )
        .route("/ws/{room_id}/{client_token}", get(room::ws_handler))
        .route(
            "/ws/join_room/{room_id}/{room_token}",
            get(worker::ws_handler),
        )
        .route(
            "/room/{room_id}/job/submit",
            post(job::submit_handler).layer(DefaultBodyLimit::max(MAX_JOB_REQUEST_BYTES)),
        )
        .route("/room/{room_id}/job/{job_id}", get(job::get_handler))
        .with_state(state)
        .layer(cors)
}

async fn root() -> &'static str {
    "hello from coordinator"
}
