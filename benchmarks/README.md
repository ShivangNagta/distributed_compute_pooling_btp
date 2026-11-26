# Benchmarks

Compares the same scalar workloads across three execution paths:

| Path     | Harness                                       | What it represents             |
| -------- | --------------------------------------------- | ------------------------------ |
| Native   | `benchmarks/harness` (Rust, static calls)     | Lower bound / no wasm boundary |
| Wasmtime | `benchmarks/harness` (Rust, `wasmtime` crate) | Native wasm runtime            |
| Browser  | `benchmarks/browser` (Playwright + Chromium)  | The demo worker runtime (V8)   |

`benchmarks/bench.json` defines iterations, warmup, and cases. Each case names
the `wasm` module it runs, resolved relative to the config file.

## Run

```sh
make wasm-examples        # rebuild ui/public/examples/*.wasm first if sources changed
make bench-native
make bench-wasmtime
make bench-browser-setup  # npm install + playwright chromium (once)
make bench-browser
make bench-report         # or `make bench` for all of the above
```

Results land in `benchmarks/results/`:

- `native.json`, `wasmtime.json`, `browser.json` — raw samples and summaries
- `report.md` — merged Markdown table plus embedded charts
- `summary.csv` — same data as CSV
- `warm-call.svg`, `cold-total.svg` — log-scale p50 charts

## What is measured

- **Warm call** — repeated invocation on an already compiled and instantiated
  module/call target, after `warmup` discarded calls.
- **Cold total** — compile + instantiate + first call, measured per iteration
  and reported as the p50 of the component times.
- **Native** — direct Rust function calls; there is no compile/instantiate cost.

Each timing is wall-clock via `Instant` (Rust) or `performance.now()` (browser).
`p50`/`p95` use the nearest-rank method over the recorded samples.

## Fairness notes

- These are microbenchmarks on one machine, not a remote-offload measurement.
  Network upload/download and coordinator overhead are not included.
- Native and wasmtime are built in release mode; browser uses Chromium's
  optimizing wasm compiler. Expect JIT warmup and GC noise at small sizes.
- Chromium compiles wasm lazily and tiers up, so its `compile` timing is often
  much lower than wasmtime's eager Cranelift compile and the first call can
  include extra tier-up work. Treat browser cold totals as time-to-first-result,
  not as a full native compilation cost.
- Keep the machine idle while running, and compare runs collected with the same
  `bench.json` (iterations, sizes) and hardware.
- `add`/`sub` exist for smoke tests; they are dominated by call overhead and are
  not included in the default config.
