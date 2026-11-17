import type { BenchmarkResult } from './types'
import {
  BENCHMARK_MEASURED_RUNS,
  BENCHMARK_WARMUP_RUNS,
  BENCHMARK_WORKLOADS,
} from './suite'
import { runBenchmark } from './runner'
import { emitBenchmarkResults } from './output'
import { runWasmTask } from '../lib/wasm'
import type { Task } from '../types'

const task: Task = {
  id: 'benchmark-task',
  job_id: 'benchmark-job',
  worker_id: 'benchmark-worker',
  status: 'pending',
  input: [2, 3],
  result: undefined,
  error: undefined,
  execution_time_ms: undefined,
}

const results: BenchmarkResult[] = []
for (const workload of BENCHMARK_WORKLOADS) {
  const result = await runBenchmark(
    () =>
      runWasmTask(workload.artifact, {
        ...task,
        input: workload.input,
      }).then(() => undefined),
    {
      scenario: 'node-local-wasm',
      workload: workload.id,
      warmup_runs: BENCHMARK_WARMUP_RUNS,
      measured_runs: BENCHMARK_MEASURED_RUNS,
    },
  )
  results.push(result)
}

emitBenchmarkResults(results)
