export type BenchmarkSummary = {
  min_ms: number
  mean_ms: number
  median_ms: number
  p95_ms: number
  p99_ms: number
  max_ms: number
}

export function summarize(samples: number[]): BenchmarkSummary {
  if (samples.length === 0) {
    throw new Error('benchmark requires at least one sample')
  }

  const sorted = [...samples].sort((a, b) => a - b)
  const sum = samples.reduce((total, sample) => total + sample, 0)

  return {
    min_ms: sorted[0],
    mean_ms: sum / samples.length,
    median_ms: percentile(sorted, 0.5),
    p95_ms: percentile(sorted, 0.95),
    p99_ms: percentile(sorted, 0.99),
    max_ms: sorted[sorted.length - 1],
  }
}

function percentile(sortedSamples: number[], rank: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.ceil(rank * sortedSamples.length) - 1,
  )
  return sortedSamples[index]
}
