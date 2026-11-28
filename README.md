# Browser First Compute Pooling

Pool idle CPU/GPU resources across browsers and execute CPU and GPU jobs remotely,
mainly via WebAssembly and WebGPU/wgpu.

## Architecture

**Overview**

```mermaid
flowchart BT
    User["User / Job Submitter"] -- Submit Job --> Coordinator["Coordinator"]
    Coordinator <-- Job / Results --> WorkerA["Browser Worker A"] & WorkerB["Browser Worker B"]
    WorkerA --- ResourcesA["CPU / GPU<br/>Resource Information"]
    WorkerB --- ResourcesB["CPU / GPU<br/>Resource Information"]
    ResourcesA -- Metrics --> Coordinator
    ResourcesB -- Metrics --> Coordinator
```

**Job flow**

```mermaid
flowchart BT
    Client["Create Job"] -- zero code --> JobAPI["Submit Job"]
    JobAPI -- "3. POST /job/submit" --- Coordinator["Coordinator"]
    WorkerA["Join Room"] -- Results / Status --> Coordinator
    ExecutionA["Execution Runtimes"] --> WASMA["WASM Execution"] & WebGPUA["wgpu Execution"]
    Client -- define --- Job["Job Definition"]
    Job --> JobAPI
    Client -- wasm/ wgpu --> JobAPI
    n3["Private Room/ Public Room"] -- "1. POST /room/create" --> Coordinator
    n4["Client"] --- n3
    n3 --> Client
    n5["Browser Worker"] -- room token --> WorkerA
    n5 --> ExecutionA
    n1["Native Worker"] -- room token --> WorkerA
    n1 --> ExecutionA
    WorkerA -- "2. Websocket /room/join" --> Coordinator
    Coordinator -- "4. Submit Job to Worker" --> n5 & n1
    ExecutionA -- "5. Job Finished" --> Coordinator

    n3@{ shape: rect}
    n4@{ shape: rect}
    n5@{ shape: rect}
    n1@{ shape: rect}
```

**Initial vision**

![Pooling overview](docs/initial_affine_doc/assets/fxqokmcIcSBRvnTPC272D1D4VImh0xSSpE64e3PuvtI=.png)

## Quick start

- Backend: `cd coordinator && go run ./cmd/coordinator`
- Frontend: `cd ui && npm run dev`

Coordinator on `http://localhost:3000`, UI on `http://localhost:8080`.

## Docs

- [Roadmap](docs/ROADMAP.md)
- [Diagrams](docs/architecture)
