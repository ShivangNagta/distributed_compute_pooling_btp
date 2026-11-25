import type { Artifact, Task } from '../types'

export const WGPU_WORKER_MODULE_URL: string =
  (import.meta.env.VITE_WGPU_WORKER_MODULE_URL as string | undefined) ??
  '/wasm-wgpu-worker/coordinator_wgpu_worker.js'

export type TaskOutcome = {
  result: unknown
  execution_time_ms: number
}

export async function runTask(
  artifact: Artifact,
  task: Task,
): Promise<TaskOutcome> {
  if (artifact.kind === 'shader_compute') {
    return runWgpuTask(artifact, task)
  }
  return runWasmTask(artifact, task)
}

type WgpuWorkerModule = {
  default?: () => Promise<void>
  execute_shader: (shader: string, input: unknown) => Promise<unknown>
}

async function runWgpuTask(
  artifact: Artifact,
  task: Task,
): Promise<TaskOutcome> {
  const shaderFile = artifact.files.find((file) => file.name.endsWith('.wgsl'))
  if (!shaderFile) {
    throw new Error('shader artifact contains no WGSL file')
  }

  const moduleUrl = WGPU_WORKER_MODULE_URL
  if (!moduleUrl) {
    throw new Error('VITE_WGPU_WORKER_MODULE_URL is not configured')
  }

  const loadWgpuWorkerModule = new Function('url', 'return import(url)') as (
    url: string,
  ) => Promise<WgpuWorkerModule>

  const module = await loadWgpuWorkerModule(
    new URL(moduleUrl, window.location.origin).href,
  )

  await module.default?.()
  const started = performance.now()
  const result = await module.execute_shader(
    new TextDecoder().decode(base64ToBytes(shaderFile.content)),
    task.input,
  )
  return { result, execution_time_ms: Math.round(performance.now() - started) }
}

/// Instantiates the wasm file in the artifact and calls `entry_point` with the
/// task input (a positional argument list).
export async function runWasmTask(
  artifact: Artifact,
  task: Task,
): Promise<TaskOutcome> {
  const wasmFile =
    artifact.files.find((file) => file.mime === 'application/wasm') ??
    artifact.files.find((file) => file.name.endsWith('.wasm'))

  if (!wasmFile) {
    throw new Error('artifact contains no wasm file')
  }

  const instance = new WebAssembly.Instance(
    new WebAssembly.Module(base64ToBytes(wasmFile.content)),
  )
  const exports = instance.exports as Record<string, unknown>

  // Emscripten reactors export `_initialize`; call it before the entry point.
  const initialize = exports._initialize
  if (typeof initialize === 'function') {
    ;(initialize as () => void)()
  }

  const entry = exports[artifact.entry_point]
  if (typeof entry !== 'function') {
    throw new Error(`export "${artifact.entry_point}" not found`)
  }

  const args = Array.isArray(task.input) ? task.input : [task.input]
  const started = performance.now()
  const result = (entry as (...a: unknown[]) => unknown)(...args)

  return {
    result: toJsonSafe(result),
    execution_time_ms: Math.round(performance.now() - started),
  }
}

/// WebAssembly i64 values surface as BigInt, which JSON.stringify rejects.
/// Normalize them before they travel over the wire.
function toJsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        toJsonSafe(item),
      ]),
    )
  }
  return value
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
