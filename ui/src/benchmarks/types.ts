import type { BenchmarkSummary } from './statistics'

export type BenchmarkResult = {
  scenario: string
  workload: string
  warmup_runs: number
  measured_runs: number
  samples_ms: number[]
  summary: BenchmarkSummary
  worker_execution_ms?: number[]
}
