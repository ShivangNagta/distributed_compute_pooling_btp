- 2 separate workload endpoints
```
.route("/room/{room_id}/wasm-job/submit)
.route("/room/{room_id}/shader-job/submit")
```
- the submit-handler will take an interface `SubmitRequest` that can have different implementations (currently `SubmitWasmJob` and `SubmitShaderJob`) and interface for `SubmitResponse` that can have different implemenations accordingly.
- Currently there are 2 different implemenations of submit_handler. Can we combine it to one neatly? Data parallelism api handler will get merged in job.rs itself.
- `client_token()` for auth is also the same.
- Similarly the `submit_job` functions for both of them should be `submit_wasm_job`, `submit_shader_job` and the unified `submit_handler` should resolve request and route it to corresponding submit functions.


- [Just a note] The payload from frontend can be changed accordingly for `.route("/room/{room_id}/shader-job/submit", post(data_parallelism::submit_handler))`
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
- For now the shader is present locally `experiment/data-parallelism` folder

- [Important] What we want is that the client does not aggregate the results from the worker. This work should be done by coordinator. The coordinator has the results from the worker, aggregates to create the image and send the image to the `client`. So move this logic to the coordinator. Instead of `src/data-parallelism` folder, create a new folder `shader-exec` which contains this aggregator. Take the references from the wasm execution implementation.

## Important: Keep the GPU access and shader execution logic in `rust-wgpu`
- This is important because in future we will be bringing our backend native. So directly using WebGPU APIs would make it tightly coupled to browsers.
- We need to map WebGPU APIs with `rust-wgpu`'s.
- Refer `experiments/wgpu-wasm`.