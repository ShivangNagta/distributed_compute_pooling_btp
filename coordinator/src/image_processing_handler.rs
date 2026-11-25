use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use image::{ImageFormat, RgbaImage};
use serde_json::json;

use crate::{
    api::requests::SubmitJobRequest,
    app_state::AppState,
    contracts::{ArtifactKind, File, Job, Task},
    error::AppError,
    service::{self, NewTask},
};

pub async fn submit(
    state: &AppState,
    room_id: &str,
    request: SubmitJobRequest,
) -> Result<Job, AppError> {
    if request.tasks.is_empty() {
        return Err(AppError::BadRequest(
            "at least one worker is required".into(),
        ));
    }

    let shader_count = request
        .artifact
        .files
        .iter()
        .filter(|file| file.name.to_ascii_lowercase().ends_with(".wgsl"))
        .count();
    if shader_count != 1 {
        return Err(AppError::BadRequest(
            "image-processing artifact must contain exactly one WGSL file".into(),
        ));
    }

    let mut image_files = request
        .artifact
        .files
        .iter()
        .filter(|file| is_supported_image(file));
    let image_file = image_files.next().ok_or_else(|| {
        AppError::BadRequest(
            "image-processing artifact must contain a PNG, JPEG, or WebP image".into(),
        )
    })?;
    if image_files.next().is_some() {
        return Err(AppError::BadRequest(
            "image-processing artifact must contain exactly one input image".into(),
        ));
    }

    let encoded_image = BASE64
        .decode(&image_file.content)
        .map_err(|error| AppError::BadRequest(format!("invalid base64 image data: {error}")))?;
    let format = ImageFormat::from_path(&image_file.name)
        .or_else(|_| image::guess_format(&encoded_image))
        .map_err(|error| AppError::BadRequest(format!("unsupported input image: {error}")))?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(AppError::BadRequest(
            "input image must be PNG, JPEG, or WebP".into(),
        ));
    }
    let image = image::load_from_memory_with_format(&encoded_image, format)
        .map_err(|error| AppError::BadRequest(format!("unable to decode input image: {error}")))?
        .to_rgba8();
    if image.width() == 0 || image.height() == 0 {
        return Err(AppError::BadRequest(
            "input image dimensions must be positive".into(),
        ));
    }

    let tasks = create_tile_tasks(&image, &request.tasks)?;
    let mut artifact = request.artifact;
    artifact.kind = ArtifactKind::ShaderCompute;
    artifact.files.retain(|file| !is_supported_image(file));

    service::submit_job(state, room_id, request.name, artifact, tasks).await
}

fn create_tile_tasks(image: &RgbaImage, workers: &[NewTask]) -> Result<Vec<NewTask>, AppError> {
    let [width, height] = [image.width(), image.height()];
    let tile_count = u32::try_from(workers.len())
        .map_err(|_| AppError::BadRequest("too many image-processing workers".into()))?;
    let tile_width = width.div_ceil(tile_count);
    let width_usize = usize::try_from(width)
        .map_err(|_| AppError::BadRequest("image dimensions exceed addressable memory".into()))?;
    let height_usize = usize::try_from(height)
        .map_err(|_| AppError::BadRequest("image dimensions exceed addressable memory".into()))?;
    let source_pixels = image.as_raw();
    let mut tasks = Vec::with_capacity(workers.len());

    for (index, worker) in workers.iter().enumerate() {
        let index = u32::try_from(index)
            .map_err(|_| AppError::BadRequest("too many image-processing workers".into()))?;
        let offset_x = index
            .checked_mul(tile_width)
            .ok_or_else(|| AppError::BadRequest("image tile offset overflow".into()))?;
        if offset_x >= width {
            continue;
        }

        let tile_width = tile_width.min(width - offset_x);
        let row_byte_count = usize::try_from(tile_width)
            .ok()
            .and_then(|tile_width| tile_width.checked_mul(4))
            .ok_or_else(|| AppError::BadRequest("image tile dimensions overflow".into()))?;
        let tile_byte_count = row_byte_count
            .checked_mul(height_usize)
            .ok_or_else(|| AppError::BadRequest("image tile dimensions overflow".into()))?;
        let offset_x_usize = usize::try_from(offset_x)
            .map_err(|_| AppError::BadRequest("image tile offset overflow".into()))?;
        let mut tile_pixels = Vec::with_capacity(tile_byte_count);
        for row in 0..height_usize {
            let source_start = row
                .checked_mul(width_usize)
                .and_then(|pixel_index| pixel_index.checked_add(offset_x_usize))
                .and_then(|pixel_index| pixel_index.checked_mul(4))
                .ok_or_else(|| AppError::BadRequest("image tile offset overflow".into()))?;
            tile_pixels
                .extend_from_slice(&source_pixels[source_start..source_start + row_byte_count]);
        }

        tasks.push(NewTask {
            worker_id: worker.worker_id.clone(),
            input: Some(json!({
                "offset": [offset_x, 0],
                "size": [tile_width, height],
                "global_resolution": [width, height],
                "input_pixels_base64": BASE64.encode(tile_pixels),
            })),
        });
    }

    Ok(tasks)
}

fn is_supported_image(file: &File) -> bool {
    let extension = file
        .name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase());
    matches!(extension.as_deref(), Some("png" | "jpg" | "jpeg" | "webp"))
        || file
            .mime
            .as_deref()
            .is_some_and(|mime| mime.starts_with("image/"))
}

pub fn aggregate_tiles(tasks: &[Task]) -> Result<(), AppError> {
    crate::shader_handler::aggregate_tiles(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app_state::AppState, repository::Repository};
    use std::io::Cursor;

    #[test]
    fn tile_inputs_contain_only_their_rgba_columns() {
        let image = RgbaImage::from_raw(
            3,
            2,
            vec![
                1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
                24,
            ],
        )
        .unwrap();
        let workers = vec![
            NewTask {
                worker_id: "worker-1".into(),
                input: None,
            },
            NewTask {
                worker_id: "worker-2".into(),
                input: None,
            },
        ];

        let tasks = create_tile_tasks(&image, &workers).unwrap();
        assert_eq!(tasks.len(), 2);
        let first = tasks[0].input.as_ref().unwrap();
        let second = tasks[1].input.as_ref().unwrap();
        assert_eq!(first["offset"], json!([0, 0]));
        assert_eq!(first["size"], json!([2, 2]));
        assert_eq!(
            BASE64
                .decode(first["input_pixels_base64"].as_str().unwrap())
                .unwrap(),
            vec![1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16, 17, 18, 19, 20]
        );
        assert_eq!(second["offset"], json!([2, 0]));
        assert_eq!(second["size"], json!([1, 2]));
        assert_eq!(
            BASE64
                .decode(second["input_pixels_base64"].as_str().unwrap())
                .unwrap(),
            vec![9, 10, 11, 12, 21, 22, 23, 24]
        );
    }

    #[test]
    fn workers_without_a_tile_are_not_assigned_empty_images() {
        let image = RgbaImage::from_raw(1, 1, vec![1, 2, 3, 4]).unwrap();
        let workers = (0..2)
            .map(|index| NewTask {
                worker_id: format!("worker-{index}"),
                input: None,
            })
            .collect::<Vec<_>>();

        let tasks = create_tile_tasks(&image, &workers).unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].worker_id, "worker-0");
    }

    #[tokio::test]
    async fn submit_decodes_and_dispatches_image_tiles() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("image-processing.db");
        let repo = Repository::open(&format!("sqlite://{}?mode=rwc", database.display()))
            .await
            .unwrap();
        repo.migrate().await.unwrap();
        let state = AppState::new(repo);
        let room = service::create_room(&state).await.unwrap();
        for worker_id in ["worker-1", "worker-2"] {
            let (sender, _receiver) = tokio::sync::mpsc::channel(10);
            state
                .worker_conns
                .lock()
                .await
                .insert(worker_id.into(), sender);
        }

        let image = RgbaImage::from_raw(2, 1, vec![1, 2, 3, 4, 5, 6, 7, 8]).unwrap();
        let mut encoded_image = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut encoded_image, ImageFormat::Png)
            .unwrap();
        let request = SubmitJobRequest {
            name: "invert image".into(),
            artifact: crate::contracts::Artifact {
                entry_point: "main".into(),
                files: vec![
                    File {
                        name: "filter.wgsl".into(),
                        content: BASE64.encode("fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) { write_pixel(out_idx, input_pixel); }"),
                        mime: Some("text/wgsl".into()),
                    },
                    File {
                        name: "source.png".into(),
                        content: BASE64.encode(encoded_image.into_inner()),
                        mime: Some("image/png".into()),
                    },
                ],
                kind: ArtifactKind::Wasm,
            },
            tasks: ["worker-1", "worker-2"]
                .into_iter()
                .map(|worker_id| NewTask {
                    worker_id: worker_id.into(),
                    input: None,
                })
                .collect(),
            metadata: json!({ "type": "image_processing" }),
        };

        let job = submit(&state, &room.id, request).await.unwrap();
        assert_eq!(job.artifact.kind, ArtifactKind::ShaderCompute);
        assert_eq!(job.artifact.files.len(), 1);
        assert_eq!(job.artifact.files[0].name, "filter.wgsl");

        let tasks = state.repo.get_tasks_by_job(&job.id).await.unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].input["global_resolution"], json!([2, 1]));
        assert_eq!(tasks[1].input["global_resolution"], json!([2, 1]));
        assert!(tasks.iter().all(|task| {
            task.input
                .get("input_pixels_base64")
                .and_then(serde_json::Value::as_str)
                .is_some()
        }));
    }
}
