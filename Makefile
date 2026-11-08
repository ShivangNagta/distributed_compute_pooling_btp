.PHONY: format check lint test build ci

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
