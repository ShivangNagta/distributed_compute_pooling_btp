import type { Artifact, Task } from '../types'

export type TaskOutcome = {
  result: unknown
  execution_time_ms: number
}

/// Instantiates the wasm file in the artifact and calls `entry_point` with the
/// task input (a positional argument list).
export async function runWasmTask(artifact: Artifact, task: Task): Promise<TaskOutcome> {
  const wasmFile =
    artifact.files.find((file) => file.mime === 'application/wasm') ??
    artifact.files.find((file) => file.name.endsWith('.wasm'))

  if (!wasmFile) {
    throw new Error('artifact contains no wasm file')
  }

  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(base64ToBytes(wasmFile.content)),
  )
  const entry = (instance.exports as Record<string, unknown>)[artifact.entry_point]

  if (typeof entry !== 'function') {
    throw new Error(`export "${artifact.entry_point}" not found`)
  }

  const args = Array.isArray(task.input) ? task.input : [task.input]
  const started = performance.now()
  const result = (entry as (...a: unknown[]) => unknown)(...args)

  return { result, execution_time_ms: Math.round(performance.now() - started) }
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
