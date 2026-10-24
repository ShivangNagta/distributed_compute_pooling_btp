use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::Deserialize;
use serde_json::{Value, json};
use wgpu::util::DeviceExt;

#[derive(Debug, Deserialize)]
pub struct ShaderTaskInput {
    pub offset: [u32; 2],
    pub size: [u32; 2],
    pub global_resolution: [u32; 2],
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
pub struct ShaderTaskResult {
    pub pixels_base64: String,
}

const PREAMBLE: &str = include_str!("wgsl-template/preamble.wgsl");
const ENTRYPOINT: &str = include_str!("wgsl-template/entrypoint.wgsl");

fn build_shader(user_source: &str) -> String {
    format!("{PREAMBLE}\n{user_source}\n{ENTRYPOINT}")
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

    let full_source = build_shader(source);
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
    let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some("shader bindings"),
        entries: &[
            wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
            wgpu::BindGroupLayoutEntry {
                binding: 1,
                visibility: wgpu::ShaderStages::COMPUTE,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Storage { read_only: false },
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            },
        ],
    });
    let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("shader bind group"),
        layout: &layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: output.as_entire_binding(),
            },
        ],
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
