import { describe, expect, it } from 'vitest'

import type { Task } from '../types'
import { sampleArtifact } from './sample'
import { runWasmTask } from './wasm'

function task(input: unknown): Task {
  return {
    id: 't1',
    job_id: 'j1',
    worker_id: 'w1',
    status: 'pending',
    input,
    result: undefined,
    error: undefined,
    execution_time_ms: undefined,
  }
}

describe('runWasmTask', () => {
  it('runs the sample add module', async () => {
    const outcome = await runWasmTask(sampleArtifact(), task([2, 3]))
    expect(outcome.result).toBe(5)
    expect(outcome.execution_time_ms).toBeGreaterThanOrEqual(0)
  })

  it('throws when the export is missing', async () => {
    const artifact = { entry_point: 'nope', files: sampleArtifact().files }
    await expect(runWasmTask(artifact, task([1, 2]))).rejects.toThrow()
  })

  it('throws when no wasm file is present', async () => {
    await expect(runWasmTask({ entry_point: 'add', files: [] }, task([1, 2]))).rejects.toThrow()
  })
})
