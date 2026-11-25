use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::Deserialize;
use serde_json::{Value, json};
use wgpu::util::DeviceExt;

#[derive(Debug, Deserialize)]
pub struct ShaderTaskInput {
    pub offset: [u32; 2],
    pub size: [u32; 2],
    pub global_resolution: [u32; 2],
    #[serde(default)]
    pub input_pixels_base64: Option<String>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct ShaderTaskResult {
    pub pixels_base64: String,
}

const PREAMBLE: &str = include_str!("wgsl-template/preamble.wgsl");
const ENTRYPOINT: &str = include_str!("wgsl-template/entrypoint.wgsl");
const IMAGE_PROCESSING_PREAMBLE: &str =
    include_str!("wgsl-template/image-processing-preamble.wgsl");
const IMAGE_PROCESSING_ENTRYPOINT: &str =
    include_str!("wgsl-template/image-processing-entrypoint.wgsl");

fn build_shader(user_source: &str, image_processing: bool) -> String {
    let (preamble, entrypoint) = if image_processing {
        (IMAGE_PROCESSING_PREAMBLE, IMAGE_PROCESSING_ENTRYPOINT)
    } else {
        (PREAMBLE, ENTRYPOINT)
    };
    format!("{preamble}\n{user_source}\n{entrypoint}")
}

pub async fn execute_shader(source: &str, input: &Value) -> Result<Value, String> {
    let input: ShaderTaskInput = serde_json::from_value(input.clone())
        .map_err(|error| format!("invalid shader input: {error}"))?;
    let [tile_width, tile_height] = input.size;
    if tile_width == 0 || tile_height == 0 {
        return Err("shader tile dimensions must be positive".into());
    }

    let output_size = u64::from(tile_width)
        .checked_mul(u64::from(tile_height))
        .and_then(|size| size.checked_mul(4))
        .ok_or_else(|| "shader output dimensions overflow".to_string())?;
    let input_pixels = input
        .input_pixels_base64
        .as_deref()
        .map(|encoded| {
            BASE64
                .decode(encoded)
                .map_err(|error| format!("invalid image pixel data: {error}"))
        })
        .transpose()?;
    if let Some(pixels) = &input_pixels {
        if u64::try_from(pixels.len()).ok() != Some(output_size) {
            return Err(format!(
                "image tile contains {} bytes; expected {output_size}",
                pixels.len()
            ));
        }
    }

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: if cfg!(target_arch = "wasm32") {
            wgpu::Backends::BROWSER_WEBGPU
        } else {
            wgpu::Backends::all()
        },
        ..Default::default()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions::default())
        .await
        .map_err(|error| format!("no GPU adapter: {error}"))?;
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("distributed shader device"),
            required_features: wgpu::Features::empty(),
            required_limits: if cfg!(target_arch = "wasm32") {
                wgpu::Limits::downlevel_webgl2_defaults()
            } else {
                wgpu::Limits::default()
            },
            memory_hints: wgpu::MemoryHints::default(),
            trace: wgpu::Trace::Off,
        })
        .await
        .map_err(|error| format!("unable to create GPU device: {error}"))?;

    let full_source = build_shader(source, input_pixels.is_some());
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("distributed shader"),
        source: wgpu::ShaderSource::Wgsl(full_source.into()),
    });
    let uniforms = [
        input.offset[0] as f32,
        input.offset[1] as f32,
        tile_width as f32,
        tile_height as f32,
        input.global_resolution[0] as f32,
        input.global_resolution[1] as f32,
        0.0,
        0.0,
    ];
    let uniform = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
        label: Some("shader uniforms"),
        contents: bytemuck::cast_slice(&uniforms),
        usage: wgpu::BufferUsages::UNIFORM,
    });
    let output = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("shader output"),
        size: output_size,
        usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        mapped_at_creation: false,
    });
    let readback = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("shader readback"),
        size: output_size,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut layout_entries = vec![wgpu::BindGroupLayoutEntry {
        binding: 0,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }];
    if input_pixels.is_some() {
        layout_entries.push(wgpu::BindGroupLayoutEntry {
            binding: 1,
            visibility: wgpu::ShaderStages::COMPUTE,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Storage { read_only: true },
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        });
    }
    let output_binding = if input_pixels.is_some() { 2 } else { 1 };
    layout_entries.push(wgpu::BindGroupLayoutEntry {
        binding: output_binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only: false },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    });
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("shader bindings"),
        entries: &layout_entries,
    });
    let input_buffer = input_pixels.map(|pixels| {
        device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("shader image input"),
            contents: &pixels,
            usage: wgpu::BufferUsages::STORAGE,
        })
    });
    let mut bind_group_entries = vec![wgpu::BindGroupEntry {
        binding: 0,
        resource: uniform.as_entire_binding(),
    }];
    if let Some(input_buffer) = &input_buffer {
        bind_group_entries.push(wgpu::BindGroupEntry {
            binding: 1,
            resource: input_buffer.as_entire_binding(),
        });
    }
    bind_group_entries.push(wgpu::BindGroupEntry {
        binding: output_binding,
        resource: output.as_entire_binding(),
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shader bind group"),
        layout: &layout,
        entries: &bind_group_entries,
    });
    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some("distributed shader pipeline"),
        layout: Some(
            &device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("shader pipeline layout"),
                bind_group_layouts: &[&layout],
                push_constant_ranges: &[],
            }),
        ),
        module: &shader,
        entry_point: Some("main"),
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
        label: Some("shader encoder"),
    });
    {
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
            label: Some("shader pass"),
            timestamp_writes: None,
        });
        pass.set_pipeline(&pipeline);
        pass.set_bind_group(0, &bind_group, &[]);
        pass.dispatch_workgroups(tile_width.div_ceil(16), tile_height.div_ceil(16), 1);
    }
    encoder.copy_buffer_to_buffer(&output, 0, &readback, 0, output_size);
    queue.submit([encoder.finish()]);

    let slice = readback.slice(..);
    let (sender, receiver) = futures_channel::oneshot::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device
        .poll(wgpu::PollType::Wait)
        .map_err(|error| format!("GPU polling failed: {error}"))?;
    receiver
        .await
        .map_err(|_| "shader readback callback was dropped".to_string())?
        .map_err(|error| format!("shader readback failed: {error}"))?;
    let pixels = slice.get_mapped_range().to_vec();
    readback.unmap();

    Ok(json!(ShaderTaskResult {
        pixels_base64: BASE64.encode(pixels),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_processing_shader_uses_image_bindings_and_entrypoint() {
        let shader = build_shader(
            "fn process_pixel(gid: vec2<u32>, input_pixel: vec4<f32>, out_idx: u32) {}",
            true,
        );
        assert!(shader.contains("@binding(1) var<storage, read> input_pixels"));
        assert!(shader.contains("process_pixel(gid, source_pixel(out_idx), out_idx)"));
    }

    #[tokio::test]
    async fn rejects_image_tiles_with_incorrect_byte_length() {
        let input = json!({
            "offset": [0, 0],
            "size": [1, 1],
            "global_resolution": [1, 1],
            "input_pixels_base64": "AQID",
        });

        let error = execute_shader("", &input).await.unwrap_err();
        assert!(error.contains("image tile contains 3 bytes; expected 4"));
    }
}
