.PHONY: format check lint test build wasm-wgpu-worker wasm-examples bench-native bench-wasmtime bench-browser-setup bench-browser bench-report bench ci

format:
	cd coordinator && gofmt -w .
	cd wasm-wgpu-worker && cargo fmt --all
	cd ui && npm run format

check:
	@unformatted="$$(cd coordinator && gofmt -l .)"; \
	if [ -n "$$unformatted" ]; then echo "Unformatted Go files:"; echo "$$unformatted"; exit 1; fi
	cd wasm-wgpu-worker && cargo fmt --all -- --check
	cd ui && npm run format:check

lint:
	cd coordinator && go vet ./...
	cd wasm-wgpu-worker && cargo check --target wasm32-unknown-unknown
	cd ui && npm run lint

test:
	cd coordinator && go test ./...
	cd ui && npm run test

build:
	cd coordinator && go build ./...
	cd ui && npm run build

wasm-wgpu-worker:
	cargo build \
		--manifest-path wasm-wgpu-worker/Cargo.toml \
		--target wasm32-unknown-unknown \
		--release
	wasm-bindgen \
		wasm-wgpu-worker/target/wasm32-unknown-unknown/release/coordinator_wgpu_worker.wasm \
		--target web \
		--out-dir ui/public/wasm-wgpu-worker

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
