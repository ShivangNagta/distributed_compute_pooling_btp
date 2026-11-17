import type { BenchmarkResult } from './types'
import { BENCHMARK_MEASURED_RUNS, BENCHMARK_WARMUP_RUNS } from './suite'
import { summarize } from './statistics'

export type BenchmarkOptions = {
  scenario: string
  workload: string
  warmup_runs?: number
  measured_runs?: number
}

export async function runBenchmark(
  operation: () => void | Promise<void>,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const warmupRuns = options.warmup_runs ?? BENCHMARK_WARMUP_RUNS
  const measuredRuns = options.measured_runs ?? BENCHMARK_MEASURED_RUNS

  for (let run = 0; run < warmupRuns; run += 1) {
    await operation()
  }

  const samples: number[] = []
  for (let run = 0; run < measuredRuns; run += 1) {
    const started = performance.now()
    await operation()
    samples.push(performance.now() - started)
  }

  return {
    scenario: options.scenario,
    workload: options.workload,
    warmup_runs: warmupRuns,
    measured_runs: measuredRuns,
    samples_ms: samples,
    summary: summarize(samples),
  }
}
