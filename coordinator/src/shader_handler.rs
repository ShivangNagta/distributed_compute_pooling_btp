use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    api::requests::SubmitJobRequest,
    app_state::AppState,
    contracts::{Artifact, ArtifactKind, Job, Task},
    error::AppError,
    service::{self, NewTask},
};

pub async fn submit(
    state: &AppState,
    room_id: &str,
    request: SubmitJobRequest,
) -> Result<Job, AppError> {
    let width = request
        .metadata
        .get("width")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            AppError::BadRequest("wgsl metadata.width must be a positive integer".into())
        })?;
    let height = request
        .metadata
        .get("height")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| {
            AppError::BadRequest("wgsl metadata.height must be a positive integer".into())
        })?;
    if width == 0 || height == 0 {
        return Err(AppError::BadRequest(
            "width and height must be positive".into(),
        ));
    }
    if request.tasks.is_empty() {
        return Err(AppError::BadRequest(
            "at least one worker is required".into(),
        ));
    }
    let tile_width = width.div_ceil(request.tasks.len() as u32);
    let tasks = request
        .tasks
        .iter()
        .enumerate()
        .filter_map(|(index, task)| {
            let offset_x = index as u32 * tile_width;
            (offset_x < width).then(|| NewTask {
                worker_id: task.worker_id.clone(),
                input: Some(json!({
                    "offset": [offset_x, 0],
                    "size": [tile_width.min(width - offset_x), height],
                    "global_resolution": [width, height],
                })),
            })
        })
        .collect();
    let has_shader = request
        .artifact
        .files
        .iter()
        .any(|file| file.name.ends_with(".wgsl"));
    if !has_shader {
        return Err(AppError::BadRequest(
            "shader artifact must contain a WGSL file".into(),
        ));
    }
    service::submit_job(
        state,
        room_id,
        request.name,
        Artifact {
            kind: ArtifactKind::ShaderCompute,
            ..request.artifact
        },
        tasks,
    )
    .await
}

#[derive(Deserialize)]
struct TileInput {
    offset: [u32; 2],
    size: [u32; 2],
    global_resolution: [u32; 2],
}

#[derive(Deserialize)]
struct TileResult {
    pixels_base64: String,
}

pub fn aggregate_tiles(tasks: &[Task]) -> Result<(), AppError> {
    let first = tasks
        .first()
        .ok_or_else(|| AppError::Internal("shader job has no tasks".into()))?;
    let first_input: TileInput = serde_json::from_value(first.input.clone())
        .map_err(|e| AppError::BadRequest(format!("invalid shader tile input: {e}")))?;
    let [width, height] = first_input.global_resolution;
    let byte_count = width
        .checked_mul(height)
        .and_then(|n| n.checked_mul(4))
        .ok_or_else(|| AppError::BadRequest("shader image dimensions overflow".into()))?;
    let mut pixels = vec![0; byte_count as usize];

    for task in tasks {
        let input: TileInput = serde_json::from_value(task.input.clone())
            .map_err(|e| AppError::BadRequest(format!("invalid shader tile input: {e}")))?;
        if input.global_resolution != [width, height] {
            return Err(AppError::BadRequest(
                "shader tiles have inconsistent global resolutions".into(),
            ));
        }
        let result = task
            .result
            .clone()
            .ok_or_else(|| AppError::Internal(format!("task {} has no result", task.id)))?;
        let result: TileResult = serde_json::from_value(result)
            .map_err(|e| AppError::Internal(format!("invalid shader result: {e}")))?;
        let bytes = BASE64
            .decode(result.pixels_base64)
            .map_err(|e| AppError::Internal(format!("invalid shader pixel data: {e}")))?;
        let [tile_width, tile_height] = input.size;
        let expected = tile_width
            .checked_mul(tile_height)
            .and_then(|n| n.checked_mul(4))
            .ok_or_else(|| AppError::BadRequest("shader tile dimensions overflow".into()))?;
        if bytes.len() != expected as usize {
            return Err(AppError::Internal(format!(
                "task {} returned {} bytes; expected {}",
                task.id,
                bytes.len(),
                expected
            )));
        }
        let [offset_x, offset_y] = input.offset;
        if offset_x > width.saturating_sub(tile_width)
            || offset_y > height.saturating_sub(tile_height)
        {
            return Err(AppError::BadRequest(format!(
                "task {} tile is outside the shader image",
                task.id
            )));
        }
        for row in 0..tile_height {
            let source = (row * tile_width * 4) as usize;
            let target = (((offset_y + row) * width + offset_x) * 4) as usize;
            let row_bytes = (tile_width * 4) as usize;
            pixels[target..target + row_bytes].copy_from_slice(&bytes[source..source + row_bytes]);
        }
    }
    Ok(())
}
