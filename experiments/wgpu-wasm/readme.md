## Accessing WebGPU through wgpu-wasm

### Requirements
- WASM compilation target, `wasm32-unknown-unknown`

- `wasm-bindgen-cli`, but with the same version of `wasm-bindgen` required by cargo.lock. For example:
```
[[package]]
name = "wasm-bindgen"
version = "0.2.129"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "9bb54f33acc68fd454578d9820b0bde1a1a3d17aa17bb7b6595806d02886d409"
dependencies = [
 "cfg-if",
 "once_cell",
 "rustversion",
 "wasm-bindgen-macro",
 "wasm-bindgen-shared",
]
```
- This can automatically by handled by `wasm-pack` which can be used.

- Any http server. I used `miniserve`.

### Steps
- Write `lib.rs` with the rendering pipeline.
- Write a `shader.wgsl` that is taken by wgpu renderer.
- Write the frontend shit..
- Build and compile using the following commands:
```bash
# from project root dir
cargo build --target wasm32-unknown-unknown --release


wasm-bindgen \
  --target web \
  --out-dir pkg \
  target/wasm32-unknown-unknown/release/<project-name>.wasm
```
- Run the server and see results.