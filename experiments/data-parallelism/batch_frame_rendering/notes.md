## Batch Frame Rendering
### Intent
1. To demonstrate high batch processing throughput on distributed GPUs.
2. N sequential frames, divided among the workers. 

### Decisions
1. Split the task based on time or screen only or both?
2. Given each worker, the time frames it has to render, how will the frames be rendered? Will that be mentioned in the shader?

### Implementation
0. Shader template decision: Shader template should be correctly written and wgpu_worker must be made consistent with the shader.
1. Task splitting logic
2. Task sending logic
3. Shader execution logic (buffer creation, struct consistency).
4. Compute Aggregation.

### Workflow
1. Same submit api will be called with `type` being batch.
2. `submit_handler` calls new `submit_batch_handler`.
3. `submit_batch_handler` does the splitting of tasks into batches according to the splitting logic and submits the task via `service::submit_job`. The splitted tasks should be consistent with the `Task` struct so that `service::submit_job` does not need to be changed. 
4. the worker executes the shader on the data given through `task` using compiled wgpu `execute_shader`. Its implementation needs to be added to handle batch rendering.
5. The results from workers are handled at `service::handle_worker_message` under `Message::TaskResult`.
6. A new result aggregation function should also be created and handled.
7. The result should be shown at the browser i.e the time metrics of sending job, compute time of each worker and response time. The rendered video should also be displayed at the client.

### Constitution
1. Every uncertain decision must be asked from me.
2. Try not to hardly couple the logic.
3. Make sure the existing struct/modules are efficiently used.
