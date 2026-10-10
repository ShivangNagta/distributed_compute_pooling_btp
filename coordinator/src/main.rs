use axum::{http::{header::{AUTHORIZATION, CONTENT_TYPE}, StatusCode}, response::IntoResponse, routing::get , Router};
use tower_http::cors::{Any, CorsLayer};

// CORS: https://medium.com/@mikecode/axum-28-cors-596e311fc6cc
// http://docs.rs/tower-http/latest/tower_http/cors/index.html

#[tokio::main]
async fn main() {
    let app = app();

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();

    axum::serve(listener, app).await.unwrap();
}

fn app() -> Router {
    let cors_layer = CorsLayer::new().allow_methods(Any).allow_origin(Any).allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    Router::new().route("/", get(|| async{"hello from coordinator"})).route("/hello", get(hello)).layer(cors_layer)
}

async fn hello() -> impl IntoResponse {
    println!("hello from handler ");
    (StatusCode::OK, "hello").into_response()
}
