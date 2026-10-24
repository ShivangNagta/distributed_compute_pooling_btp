# Distributed WGSL Data-Parallel Rendering

This guide explains the implementation in this repository so that the same
pattern can be adapted to other WGSL workloads, image sizes, scheduling
policies, and result formats.

The implementation uses the existing coordinator job system:

```text
Client
  |
  | POST /room/{room_id}/shader-job/submit
  v
Coordinator
  |
  | Creates one Task per tile
  | Sends JobArtifact and TaskAssign
  v
Rust wgpu workers
  |
  | Execute WGSL through Rust wgpu
  | Return tile pixels through TaskResult
  v
Coordinator
  |
  | Persists task results
  | Emits TaskUpdate and JobUpdate
  v
Client
  |
  | Displays and downloads the coordinator-produced image
```

The implementation provides parallelism at two levels:

1. **Across workers/GPUs:** each worker receives a separate region of the
   input domain.
2. **Within a GPU:** each worker dispatches the region using a two-dimensional
   WGSL workgroup grid.

The current sample is an image renderer, but the same design applies to
matrices, particles, simulations, image filters, ray tracing workloads, and
other independent data partitions.

## Repository locations

The relevant implementation is split across these files:

| Responsibility | File |
|---|---|
| Sample WGSL compute shader | [`shader.wgsl`](./shader.wgsl) |
| Self-contained neon WGSL shader | [`shader3.wgsl`](./shader3.wgsl) |
| Coordinator tile-job creation and aggregation | [`coordinator/src/shader_exec.rs`](../../coordinator/src/shader_exec.rs) |
| Authenticated submission and worker WebSocket API | [`coordinator/src/api/job.rs`](../../coordinator/src/api/job.rs), [`coordinator/src/api/worker.rs`](../../coordinator/src/api/worker.rs) |
| Route registration | [`coordinator/src/api/mod.rs`](../../coordinator/src/api/mod.rs) |
| Job/artifact/task contracts | [`coordinator/src/contracts.rs`](../../coordinator/src/contracts.rs) |
| Browser adapter for compiled Rust/WASM wgpu | [`ui/src/lib/wasm.ts`](../../ui/src/lib/wasm.ts) |
| Shared Rust wgpu execution | [`coordinator/src/wgpu_worker.rs`](../../coordinator/src/wgpu_worker.rs) |
| WASM wrapper crate | [`coordinator/wgpu-worker/src/lib.rs`](../../coordinator/wgpu-worker/src/lib.rs) |
| Worker WebSocket page | [`ui/src/pages/WorkerPage.tsx`](../../ui/src/pages/WorkerPage.tsx) |
| Client submission and compositing | [`ui/src/pages/ClientPage.tsx`](../../ui/src/pages/ClientPage.tsx) |
| Shared frontend types | [`ui/src/types.ts`](../../ui/src/types.ts) |

The coordinator remains responsible for scheduling, persistence, and image
aggregation. Workers remain responsible for local GPU execution. The same
Rust wgpu implementation can be compiled natively for a GPU worker or to
`wasm32-unknown-unknown` for a browser worker using WebGPU.

## 1. Define an artifact execution type

The original system supported WASM artifacts. The artifact model was extended
with an explicit execution kind:

```rust
pub enum ArtifactKind {
    Wasm,
    ShaderCompute,
}
```

The `Artifact` structure contains:

```rust
pub struct Artifact {
    pub entry_point: String,
    pub files: Vec<File>,
    pub kind: ArtifactKind,
}
```

The field uses a serde default so existing clients that do not send `kind`
continue to mean WASM:

```rust
#[serde(default)]
pub kind: ArtifactKind,
```

This is preferable to inferring execution type only from file names. A
`shader.wgsl` file tells us what a file is, but `kind` tells the worker how to
execute the artifact.

For another workload type, extend the enum:

```rust
pub enum ArtifactKind {
    Wasm,
    ShaderCompute,
    WgpuRender,
    Cuda,
    Python,
}
```

Then add a corresponding worker execution branch.

## 2. Keep the generic job protocol

The existing coordinator contracts already contain the important generic
objects:

```rust
pub struct Job {
    pub id: String,
    pub room_id: String,
    pub name: String,
    pub artifact: Artifact,
    pub status: JobStatus,
    pub created_at: i64,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

pub struct Task {
    pub id: String,
    pub job_id: String,
    pub worker_id: Option<String>,
    pub status: TaskStatus,
    pub input: serde_json::Value,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
    pub execution_time_ms: Option<i64>,
}
```

The important design decision is that task-specific input and output remain
JSON values:

```rust
pub input: Value,
pub result: Option<Value>,
```

This lets the same task table support:

```json
// WASM task
[1, 2]
```

```json
// WebGPU tile task
{
  "offset": [0, 0],
  "size": [400, 600],
  "global_resolution": [800, 600]
}
```

For a production system, the scheduler should validate the JSON shape before
dispatching it. The current sample validates the render dimensions and creates
the expected tile shape.

## 3. Add a specialized submission endpoint

The generic endpoint is:

```text
POST /room/{room_id}/wasm-job/submit
```

It expects a complete artifact and complete task list. That is useful for
general workloads, but the client should not need to calculate WGSL tile
boundaries itself.

The implementation therefore adds:

```text
POST /room/{room_id}/shader-job/submit
```

The request is intentionally small:

```json
{
  "name": "wgpu-render",
  "width": 800,
  "height": 600,
  "worker_ids": [
    "worker-a",
    "worker-b"
  ]
}
```

The endpoint:

1. Extracts the bearer client token.
2. Finds the room belonging to that token.
3. Verifies the URL room ID matches the token room.
4. Calls the data-parallel job builder.
5. Returns the generated `job_id`.

Keep this authorization step. A room token must not be accepted as a client
token, and a token from one room must not submit to another room.

## 4. Partition the input domain

The sample partitions the image into horizontal strips.

For a canvas width `W` and `N` workers:

```text
tile_width = ceil(W / N)
```

The tile for worker index `i` is:

```text
offset_x = i * tile_width
tile_width_i = min(tile_width, W - offset_x)
```

The resulting task input is:

```json
{
  "offset": [offset_x, 0],
  "size": [tile_width_i, height],
  "global_resolution": [width, height]
}
```

Example for `800 × 600` and two workers:

```text
Worker A:
  offset: [0, 0]
  size: [400, 600]

Worker B:
  offset: [400, 0]
  size: [400, 600]
```

Example for `1000 × 600` and three workers:

```text
Worker A:
  offset: [0, 0]
  size: [334, 600]

Worker B:
  offset: [334, 0]
  size: [334, 600]

Worker C:
  offset: [668, 0]
  size: [332, 600]
```

The final tile is clamped so that:

```text
offset_x + tile_width_i <= full_width
```

### Alternative partitioning strategies

Horizontal strips are simple, but not always optimal. The same task model can
support:

#### 2D tiles

Useful when workers have different speeds or the image is large:

```json
{
  "offset": [512, 256],
  "size": [256, 256],
  "global_resolution": [2048, 1024]
}
```

#### Fixed-size work chunks

Create many more tasks than workers and assign them dynamically. This improves
load balancing when different regions take different amounts of time.

#### Capability-weighted partitioning

Use worker capabilities such as GPU memory, adapter limits, or benchmarked
throughput to assign larger tiles to faster workers.

#### Dynamic scheduling

Instead of requiring the client to provide worker IDs, the coordinator can
select available workers and dispatch pending tasks as workers become idle.
That would require changing the current explicit-assignment behavior in
`service::submit_job`.

## 5. Package the WGSL shader as an artifact

The coordinator includes the sample shader at compile time:

```rust
const SHADER: &str =
    include_str!("../../../experiments/data-parallelism/shader.wgsl");
```

It then creates an artifact:

```rust
let artifact = Artifact {
    entry_point: "main".into(),
    files: vec![File {
        name: "shader.wgsl".into(),
        content: BASE64.encode(SHADER.as_bytes()),
        mime: Some("text/wgsl".into()),
    }],
    kind: ArtifactKind::ShaderCompute,
};
```

The existing `File.content` convention is base64-encoded bytes. This avoids
transport problems with arbitrary binary files and keeps the artifact contract
consistent with WASM artifacts.

For user-supplied shaders, do not blindly compile arbitrary WGSL in a
multi-tenant production environment. Add authentication, size limits,
allowlists, validation, quotas, and possibly shader compilation policies.

## 6. Design the shader for distributed execution

The sample shader receives a render region:

```wgsl
struct RenderRegion {
    tile_offset: vec2<f32>,
    tile_size: vec2<f32>,
    global_res: vec2<f32>,
    _padding: vec2<f32>,
}
```

The padding is important because uniform structures are aligned according to
WGSL/WebGPU layout rules.

The shader uses local invocation coordinates:

```wgsl
let x = id.x;
let y = id.y;
```

It bounds-checks the tile:

```wgsl
if (x >= width || y >= height) {
    return;
}
```

It then converts local coordinates to global coordinates:

```wgsl
let global_pixel =
    region.tile_offset + vec2<f32>(f32(x), f32(y));
```

This is the key requirement for distributed rendering. Effects that depend on
absolute image position must use `global_pixel`, not only `x` and `y`.

The shader normalizes against the full image:

```wgsl
let uv =
    (global_pixel / region.global_res) * 2.0
    - vec2<f32>(1.0);
```

If a shader instead used:

```wgsl
let uv = vec2<f32>(f32(x), f32(y)) / region.tile_size;
```

then every tile would generate an independent copy of the scene.

## 7. Dispatch work inside each GPU

The sample uses:

```wgsl
@compute @workgroup_size(16, 16)
fn main(...)
```

The worker dispatches:

```rust
pass.dispatch_workgroups(tile_width.div_ceil(16), tile_height.div_ceil(16), 1);
```

The relationship is:

```text
global invocations in X = workgroups_x * 16
global invocations in Y = workgroups_y * 16
```

The shader bounds check is required because the dispatch dimensions are
rounded up to complete workgroups.

For a different shader, change both:

1. The WGSL `@workgroup_size`.
2. The host-side dispatch calculation.

Do not hardcode `16` in only one place.

## 8. Allocate and bind buffers

The Rust wgpu worker creates:

```text
Uniform buffer:
  tile offset, tile size, global resolution

Storage buffer:
  packed output pixels

Readback buffer:
  CPU-readable copy of the storage buffer
```

The output buffer uses:

```ts
GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
```

The readback buffer uses:

```ts
GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
```

The buffer size is:

```text
tile_width * tile_height * bytes_per_pixel
```

The sample uses four bytes per pixel because the shader writes one `u32`:

```wgsl
output_pixels[index] = packed_color;
```

If your shader writes floats, vectors, or multiple output arrays, define a
different result schema and byte-size calculation.

## 9. Pack pixel output consistently

The sample packs a pixel as:

```text
0xAABBGGRR
```

The WGSL expression is:

```wgsl
let packed_color =
    r |
    (g << 8u) |
    (b << 16u) |
    (a << 24u);
```

The browser then reads the storage buffer as bytes and creates an
`ImageData` object from those bytes.

This works because the browser and shader agree on:

```text
one pixel = four bytes
byte 0 = red
byte 1 = green
byte 2 = blue
byte 3 = alpha
```

If you change channel order, update both sides. A common failure mode is
getting an image that appears blue/red swapped because the shader and image
compositor disagree about byte order.

## 10. Return results through the existing protocol

The worker sends the existing task lifecycle messages:

```text
TaskStarted
TaskResult
TaskFailed
```

The WebGPU result is:

```json
{
  "pixels_base64": "<tile RGBA bytes>"
}
```

The worker must not send a new message type just for WebGPU unless the
coordinator genuinely needs a new lifecycle concept. Keeping the existing
`TaskResult` message means persistence, task status, job completion, and
client notifications work without a second backend path.

For large images, base64 JSON has substantial overhead. A production
implementation may eventually need:

- binary WebSocket frames
- chunked result uploads
- object/blob storage
- compression
- result references instead of inline JSON

For the current experiment, base64 makes the protocol easy to inspect and
reuse.

## 11. Persisting and completing jobs

The coordinator stores the result in the existing task row:

```text
tasks.result_json
```

When a worker sends `TaskResult`, the coordinator:

1. Loads the task.
2. Marks it `Completed`.
3. Stores the result JSON.
4. Stores execution time.
5. Emits `TaskUpdate`.
6. Checks whether every task in the job is terminal.
7. Marks the job `Completed` or `Failed`.
8. Emits `JobUpdate`.

The current failure policy is:

```text
any failed tile => entire job fails
```

To support retry, add a retry policy around failed tasks. A safe retry design
should include:

- attempt count
- task lease/ownership
- idempotent result handling
- duplicate result protection
- worker availability checks
- maximum retry count

## 12. Aggregate the completed tiles in the coordinator

The coordinator must not send each tile to the client for composition. Instead,
it performs these steps after all GPU tasks complete:

1. Find a completed `shader_compute` job.
2. Verify every task is completed.
3. Read `offset`, `size`, and `global_resolution` from every task.
4. Decode each `pixels_base64` value.
5. Validate:

```text
decoded byte length =
    tile_width * tile_height * 4
```

6. Create one full-size RGBA buffer.
7. Copy each tile into its bounded offset.
8. Emit one `shader_image` message containing the full image.
9. Let the client convert that full buffer to PNG for display/download.

The coordinator implementation is in
[`coordinator/src/shader_exec.rs`](../../coordinator/src/shader_exec.rs).
The client only presents the resulting `shader_image`; it does not know the
tile layout.

## 13. Why the page became very large before compositing

Before the compositor was added, the UI displayed task results like this:

```tsx
JSON.stringify(task.result)
```

For a `800 × 600` image, the result contains approximately:

```text
800 * 600 * 4 = 1,920,000 bytes
```

Base64 expands that data by roughly one third, and JSON adds more overhead.
Printing it into the DOM creates a huge text node and causes excessive
scrolling.

The correct approach is:

```text
large binary result -> decode -> image/canvas
```

not:

```text
large binary result -> JSON.stringify -> HTML
```

## 14. Running the current sample

Start the coordinator:

```sh
cargo run --manifest-path coordinator/Cargo.toml
```

Start the UI:

```sh
cd ui
npm run dev
```

Then:

1. Open the client page.
2. Create a room.
3. Open one or more worker pages.
4. Join each worker to the room using the worker token.
5. Confirm the workers appear in the client.
6. Select `WGSL / WebGPU`.
7. Choose render dimensions, for example `800 × 600`.
8. Select workers.
9. Submit the job.
10. Wait for all tile tasks to complete.
11. Inspect the rendered image.
12. Check the downloaded `<job-id>-render.png` file.

WebGPU must be available in the browser. Browser security requirements such as
secure contexts may apply depending on how the application is served. Local
development on `localhost` is normally treated as a secure context by modern
browsers.

## 15. Adapting the implementation to another shader

For a new shader, update the following areas.

### A. Define the task input

Replace the render region with your domain parameters:

```json
{
  "matrix_offset": [0, 0],
  "matrix_size": [1024, 1024],
  "total_size": [4096, 4096]
}
```

### B. Update the WGSL uniform structure

The fields and alignment must match the host-side typed array exactly:

```wgsl
struct WorkRegion {
    offset: vec2<u32>,
    size: vec2<u32>,
    total_size: vec2<u32>,
    _padding: vec2<u32>,
}
```

### C. Update the host-side uniform data

The order in the JavaScript `Float32Array`, `Uint32Array`, or other typed
array must match the WGSL structure.

### D. Update the output buffer interpretation

If the shader writes:

```wgsl
array<u32>
```

then decode four bytes per element. If it writes a different structure,
define an explicit result layout and decoder.

### E. Update result assembly

For images, use `putImageData`. For matrices, copy values into a matrix
container. For simulations, merge state ranges or use a separate reduction
step.

### F. Update validation

Validate:

- input dimensions
- tile bounds
- byte lengths
- supported device limits
- maximum allocation size
- shader-specific constraints

## 16. Practical production improvements

The current implementation is a working prototype. For larger workloads,
consider the following improvements.

### Worker capability-aware scheduling

Use GPU information and benchmark scores to assign work proportionally instead
of using equal-width tiles.

### Dynamic worker selection

Let the coordinator select workers instead of requiring the client to provide
worker IDs.

### More tasks than workers

Create small work chunks and schedule them as workers become available. This
handles heterogeneous GPUs better than one large tile per worker.

### Result chunking

Avoid placing multi-megabyte base64 buffers inside SQLite JSON columns. Store
large results externally and persist only a result reference.

### Binary transport

Use binary WebSocket messages or HTTP uploads for pixel buffers to eliminate
base64 overhead.

### Device reuse

The current worker execution path requests a WebGPU device per task. A
production worker should create the adapter/device once and reuse pipelines
and buffers where possible.

### Pipeline reuse

Compile the shader once per artifact/job instead of recompiling it for every
tile task.

### Backpressure

Limit concurrent tasks per worker based on GPU memory and queue capacity.

### Cancellation

Add job cancellation and worker-side cancellation handling for large renders.

### Security

Treat uploaded WGSL as executable code for the GPU. Add:

- authentication and authorization
- artifact size limits
- shader validation
- resource limits
- execution timeouts
- worker isolation
- result size limits

## 17. Validation checklist

Before adapting the design, verify:

- [ ] The artifact has the correct execution kind.
- [ ] The shader entry point matches the pipeline entry point.
- [ ] Uniform field order matches host-side data order.
- [ ] Uniform padding satisfies WebGPU alignment.
- [ ] Workgroup size matches dispatch calculations.
- [ ] Bounds checks protect rounded-up dispatches.
- [ ] Tile offsets use global coordinates.
- [ ] Output byte order matches the image decoder.
- [ ] Each tile has the expected byte length.
- [ ] Tiles cannot exceed the full output dimensions.
- [ ] Results are not rendered as raw JSON/base64.
- [ ] Object URLs are revoked.
- [ ] Worker failure transitions the job to a visible failed state.
- [ ] Large results have a planned storage/transport strategy.

## 18. Current implementation boundary

The coordinator is Rust and owns:

```text
authentication
job creation
artifact creation
task partitioning
worker assignment
dispatch
task persistence
job completion
```

The integrated browser worker currently uses the browser WebGPU API and owns:

```text
adapter/device creation
WGSL compilation
buffer allocation
compute dispatch
GPU readback
result encoding
```

The standalone Rust `wgpu` WASM experiment under
[`experiments/wgpu-wasm`](../wgpu-wasm) is useful as a reference for Rust
`wgpu` browser initialization, but the actual coordinator-integrated path
currently executes WebGPU through the browser worker implementation.
