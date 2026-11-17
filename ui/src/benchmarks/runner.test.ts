import { describe, expect, it } from 'vitest'

import { runBenchmark } from './runner'

describe('runBenchmark', () => {
  it('runs the configured warm-ups and measurements', async () => {
    let runs = 0

    const result = await runBenchmark(
      () => {
        runs += 1
      },
      {
        scenario: 'test',
        workload: 'counter',
        warmup_runs: 2,
        measured_runs: 3,
      },
    )

    expect(runs).toBe(5)
    expect(result.samples_ms).toHaveLength(3)
    expect(result.summary.min_ms).toBeGreaterThanOrEqual(0)
  })
})
