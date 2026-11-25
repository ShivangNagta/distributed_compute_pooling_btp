use distributed_gpu::{ComputePipeline, SplitStrategy, Buffer};

// 1. User defines their custom parameters struct
#[derive(distributed_gpu::GpuLayout)]
struct TransformConfig {
    multiplier: f32,
    threshold: f32,
}

fn main() {
    // 2. Prepare the massive global dataset (e.g., 4 Million values)
    let heavy_dataset: Vec<f32> = (0..4_000_000).map(|x| x as f32 * 0.01).collect();

    // 3. Initialize the pipeline layout configuration using the wrapper
    let pipeline = ComputePipeline::new()
        .shader_path("transform.wgsl")
        .workgroup_size(256, 1, 1); // Tells wrapper: 256 threads per local group

    // 4. Declare the binding stack and execution splitting topology
    // The order of the vector matches binding indices (0, 1, 2) in the WGSL script
    let manifests = pipeline.distribute_work(
        // Specification: Split input into 8 equal chunks across 8 browser workers
        SplitStrategy::UniformChunks { num_workers: 8 }, 
        vec![
            // Binding 0: Uniform configuration block (auto-padded to 16 bytes by encase)
            Buffer::uniform(TransformConfig { multiplier: 2.5, threshold: 10.0 }),
            
            // Binding 1: The heavy array chunked automatically across the 8 workers
            Buffer::input_chunk(&heavy_dataset),
            
            // Binding 2: Allocates a matching blank output footprint on the WebGPU device
            Buffer::output_chunk::<f32>(), 
        ]
    );
}
