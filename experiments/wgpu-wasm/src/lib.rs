use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub async fn run() {
    console_error_panic_hook::set_once();
    if let Err(error) = console_log::init_with_level(log::Level::Info) {
        log::error!("Failed to initialize console logging: {error}");
        return;
    }

    let Some(window) = web_sys::window() else {
        log::error!("Unable to access the browser window");
        return;
    };
    let Some(document) = window.document() else {
        log::error!("Unable to access the browser document");
        return;
    };
    let Some(canvas) = document
        .get_element_by_id("canvas")
        .and_then(|element| element.dyn_into::<web_sys::HtmlCanvasElement>().ok())
    else {
        log::error!("Canvas element with id 'canvas' was not found");
        return;
    };

    let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU,
        ..Default::default()
    });

    // Request adapter WITHOUT compatible_surface first
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::default(),
            compatible_surface: None, // <-- key change
            force_fallback_adapter: false,
        })
        .await;
    let Ok(adapter) = adapter else {
        log::error!("No WebGPU adapter found. Is WebGPU enabled in this browser?");
        return;
    };

    log::info!("Adapter: {:?}", adapter.get_info());

    let device_and_queue = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: None,
            required_features: wgpu::Features::empty(),
            required_limits: wgpu::Limits::downlevel_webgl2_defaults(),
            memory_hints: wgpu::MemoryHints::default(),
            trace: wgpu::Trace::Off,
        })
        .await;
    let Ok((device, queue)) = device_and_queue else {
        log::error!("Failed to create WebGPU device");
        return;
    };

    // Create surface AFTER device is ready
    let surface = instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()));
    let Ok(surface) = surface else {
        log::error!("Failed to create WebGPU surface");
        return;
    };

    let caps = surface.get_capabilities(&adapter);
    let Some(format) = caps
        .formats
        .iter()
        .find(|f| f.is_srgb())
        .copied()
        .or_else(|| caps.formats.first().copied())
    else {
        log::error!("WebGPU surface does not support any texture formats");
        return;
    };
    let Some(alpha_mode) = caps.alpha_modes.first().copied() else {
        log::error!("WebGPU surface does not support any alpha modes");
        return;
    };

    surface.configure(
        &device,
        &wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: canvas.width().max(1),
            height: canvas.height().max(1),
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode,
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        },
    );

    // render pipeline logic
    let pipeline = create_render_pipeline(&device, format);

    let frame = match surface.get_current_texture() {
        Ok(f) => f,
        Err(e) => {
            log::error!("get_current_texture failed: {:?}", e);
            return;
        }
    };

    let view = frame
        .texture
        .create_view(&wgpu::TextureViewDescriptor::default());
    let mut encoder =
        device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: None });

    {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: None,
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.05,
                        g: 0.05,
                        b: 0.05,
                        a: 1.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
        });

        pass.set_pipeline(&pipeline);
        pass.draw(0..3, 0..1);
    }

    queue.submit([encoder.finish()]);
    frame.present();

    log::info!("Rendered successfully");
}

fn create_render_pipeline(
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    let shader = device.create_shader_module(wgpu::include_wgsl!("shader.wgsl"));
    let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: &[],
        push_constant_ranges: &[],
    });

    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: None,
        layout: Some(&pipeline_layout),
        vertex: wgpu::VertexState {
            module: &shader,
            entry_point: Some("vs_main"),
            buffers: &[],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: &shader,
            entry_point: Some("fs_main"),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::REPLACE),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: wgpu::PipelineCompilationOptions::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: wgpu::PrimitiveTopology::TriangleList,
            strip_index_format: None,
            front_face: wgpu::FrontFace::Ccw,
            cull_mode: Some(wgpu::Face::Back),
            polygon_mode: wgpu::PolygonMode::Fill,
            unclipped_depth: false,
            conservative: false,
        },
        depth_stencil: None,
        multisample: wgpu::MultisampleState {
            count: 1,
            mask: !0,
            alpha_to_coverage_enabled: false,
        },
        multiview: None,
        cache: None,
    })
}
