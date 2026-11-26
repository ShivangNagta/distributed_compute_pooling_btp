#!/usr/bin/env bash
# Builds the Rust and C demo workloads into import-free wasm modules and copies
# their sources for the in-UI source viewer.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/ui/public/examples"
SRC_OUT="$OUT/src"
mkdir -p "$OUT" "$SRC_OUT"

RUST_WORKLOADS=(add fib prime_count monte_carlo_pi wordcount)

echo "Building Rust workloads..."
args=()
for name in "${RUST_WORKLOADS[@]}"; do
  args+=(-p "$name")
done
cargo build \
  --manifest-path "$ROOT/examples/workloads/Cargo.toml" \
  --release \
  --target wasm32-unknown-unknown \
  "${args[@]}"

for name in "${RUST_WORKLOADS[@]}"; do
  cp "$ROOT/examples/workloads/target/wasm32-unknown-unknown/release/$name.wasm" \
    "$OUT/$name.wasm"
  cp "$ROOT/examples/workloads/$name/src/lib.rs" "$SRC_OUT/$name.rs"
done

# Drop the old single-module artifacts if they are still around.
rm -f "$OUT/workloads.wasm" "$SRC_OUT/workloads.rs"

if command -v emcc >/dev/null 2>&1; then
  echo "Building C workloads..."
  # Homebrew emscripten can pick a broken bundled node; prefer the PATH node.
  if command -v node >/dev/null 2>&1; then
    export EM_NODE_JS="${EM_NODE_JS:-$(command -v node)}"
  fi
  while IFS= read -r src; do
    name="$(basename "$src" .c)"
    case "$name" in
      prime_count) exports='["_prime_count_range","_prime_count"]' ;;
      monte_carlo_pi) exports='["_monte_carlo_pi"]' ;;
      fib) exports='["_fib"]' ;;
      *)
        echo "unknown C workload: $name" >&2
        exit 1
        ;;
    esac
    emcc -O3 \
      -sSTANDALONE_WASM=1 \
      --no-entry \
      -sEXPORTED_FUNCTIONS="$exports" \
      -sERROR_ON_UNDEFINED_SYMBOLS=1 \
      "$src" \
      -o "$OUT/c-$name.wasm"
    cp "$src" "$SRC_OUT/$name.c"
  done < <(find "$ROOT/examples/workloads/c" -name '*.c' | sort)
else
  echo "emcc not found; skipping C workloads (Rust modules still built)." >&2
fi

chmod 644 "$OUT"/*.wasm
node "$ROOT/examples/check-wasm-imports.mjs" "$OUT"/*.wasm
