mod api;
mod app_state;
mod contracts;
mod error;
mod repository;
mod service;
mod util;

use app_state::AppState;
use repository::Repository;

#[tokio::main]
async fn main() {
    let database_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "data/coordinator.db".to_string());
    if let Some(parent) = std::path::Path::new(&database_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let database_url = format!("sqlite://{}?mode=rwc", database_path);

    let repo = Repository::open(&database_url)
        .await
        .expect("failed to open database");
    repo.migrate().await.expect("failed to run migrations");

    let state = AppState::new(repo);
    let app = api::router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
