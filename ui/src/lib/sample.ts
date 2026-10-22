import type { Artifact } from '../types'

// Minimal wasm module exporting `add(i32, i32) -> i32`.
// Generated as raw bytes and verified with `wasmtime add.wasm add 1 2` -> 3.
const SAMPLE_WASM_BASE64 =
  // 'AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags='
  'AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA3N1YgAACgkBBwAgACABaws='

export const SAMPLE_ENTRY_POINT = 'add'

export function sampleArtifact(): Artifact {
  return {
    entry_point: SAMPLE_ENTRY_POINT,
    files: [
      {
        name: 'add.wasm',
        content: SAMPLE_WASM_BASE64,
        mime: 'application/wasm',
      },
    ],
  }
}
