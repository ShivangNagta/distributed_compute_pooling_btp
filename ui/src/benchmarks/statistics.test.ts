import { describe, expect, it } from 'vitest'

import { summarize } from './statistics'

describe('summarize', () => {
  it('calculates common latency statistics', () => {
    expect(summarize([10, 20, 30, 40, 100])).toEqual({
      min_ms: 10,
      mean_ms: 40,
      median_ms: 30,
      p95_ms: 100,
      p99_ms: 100,
      max_ms: 100,
    })
  })

  it('does not mutate the input samples', () => {
    const samples = [30, 10, 20]

    summarize(samples)

    expect(samples).toEqual([30, 10, 20])
  })

  it('rejects empty samples', () => {
    expect(() => summarize([])).toThrow(
      'benchmark requires at least one sample',
    )
  })
})
