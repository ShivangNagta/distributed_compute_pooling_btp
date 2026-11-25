## Distributed GPGPU Compute
1. User creates a rust job


## Implementation steps:
1. Create an `attribution macro` for struct for memory layout consistent with the WGSL memory layouts. `#[GPUStruct]`
2. Define data splitting implementations.
3. Define how uniform, input and output buffers will get formed.
4. Create a cargo build pipeline for extracting out the following:
```
transform-job/
├── manifest.json
├── shaders/
│   └── transform.wgsl
├── data/
│   └── heavy_dataset.bin
└── schemas/
    └── TransformConfig.json
```