## WASM Build Commands for the worker

```bash
cargo build \
  --manifest-path wasm-wgpu-worker/Cargo.toml \
  --target wasm32-unknown-unknown \
  --release

wasm-bindgen \
  wasm-wgpu-worker/target/wasm32-unknown-unknown/release/coordinator_wgpu_worker.wasm \
  --target web \
  --out-dir ui/public/wasm-wgpu-worker
```