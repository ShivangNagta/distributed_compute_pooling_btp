.PHONY: format check lint test build ci wasm-examples bench-native bench-wasmtime bench-browser-setup bench-browser bench-report bench

format:
	cd coordinator && cargo fmt --all
	cd ui && npm run format

check:
	cd coordinator && cargo fmt --all -- --check
	cd ui && npm run format:check

lint:
	cd coordinator && cargo clippy --all-targets --all-features
	cd ui && npm run lint

test:
	cd coordinator && cargo test --all-targets --all-features
	cd ui && npm run test

build:
	cd ui && npm run build

ci: check lint test build

wasm-examples:
	./examples/build-wasm.sh

bench-native:
	cd benchmarks/harness && cargo run --release -- native --config ../bench.json --out ../results/native.json

bench-wasmtime:
	cd benchmarks/harness && cargo run --release -- wasmtime --config ../bench.json --out ../results/wasmtime.json

bench-browser-setup:
	cd benchmarks/browser && npm install --no-fund --no-audit && npx playwright install chromium

bench-browser:
	cd benchmarks/browser && node run.mjs

bench-report:
	node benchmarks/report.mjs

bench: bench-native bench-wasmtime bench-browser bench-report
