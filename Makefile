.PHONY: format check lint test build benchmark benchmark-native benchmark-e2e benchmark-all benchmark-wasm ci

BENCHMARK_RESULTS_DIR := $(CURDIR)/ui/.benchmark-results

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

benchmark:
	cd ui && npm run benchmark

benchmark-native:
	cd coordinator && cargo run --release --bin native_benchmark

benchmark-wasm:
	cargo build --manifest-path coordinator/workloads/Cargo.toml --target wasm32-unknown-unknown --release

benchmark-e2e:
	cd ui && npm run benchmark:e2e

benchmark-all:
	mkdir -p $(BENCHMARK_RESULTS_DIR)
	BENCHMARK_OUTPUT=$(BENCHMARK_RESULTS_DIR)/native.json $(MAKE) benchmark-native
	BENCHMARK_OUTPUT=$(BENCHMARK_RESULTS_DIR)/node-local.json $(MAKE) benchmark
	BENCHMARK_OUTPUT=$(BENCHMARK_RESULTS_DIR)/remote-browser.json $(MAKE) benchmark-e2e
	cd ui && npm run benchmark:compare -- .benchmark-results/native.json .benchmark-results/node-local.json .benchmark-results/remote-browser.json

build:
	cd ui && npm run build

ci: check lint test build
