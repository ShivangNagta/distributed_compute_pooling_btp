import { useMemo, useState } from 'react'
import { COORDINATOR_URL } from '../coordinator'
import type { BenchmarkResult } from '../benchmarks/types'
import {
  BENCHMARK_MEASURED_RUNS,
  BENCHMARK_WARMUP_RUNS,
  BENCHMARK_WORKLOADS,
  toRemoteWorkload,
} from '../benchmarks/suite'
import { runRemoteBenchmarks } from '../benchmarks/browser-remote'
import { runBenchmark } from '../benchmarks/runner'
import { runWasmTask } from '../lib/wasm'
import type { Task } from '../types'

const task: Task = {
  id: 'dev-benchmark-task',
  job_id: 'dev-benchmark-job',
  worker_id: 'dev-benchmark-worker',
  status: 'pending',
  input: [2, 3],
  result: undefined,
  error: undefined,
  execution_time_ms: undefined,
}

function benchmarkTask(input: unknown): Task {
  return { ...task, input }
}

function formatMilliseconds(value: number): string {
  if (value < 0.01) return `${value.toFixed(4)} ms`
  if (value < 1) return `${value.toFixed(3)} ms`
  return `${value.toFixed(2)} ms`
}

function formatScenario(scenario: string): string {
  return scenario
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-tx-muted">{label}</dt>
      <dd className="mt-1 mono text-lg text-tx-primary">
        {formatMilliseconds(value)}
      </dd>
    </div>
  )
}

function BenchmarkCard({
  result,
  scale,
}: {
  result: BenchmarkResult
  scale: number
}) {
  return (
    <article className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-tx-primary">{result.workload}</h2>
          <p className="mt-1 text-xs text-tx-muted">
            {result.measured_runs} measured runs · {result.warmup_runs} warmups
          </p>
        </div>
        <span className="rounded-full bg-accent/15 px-2 py-1 text-xs text-accent">
          {formatScenario(result.scenario)}
        </span>
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3">
        <Metric label="Median" value={result.summary.median_ms} />
        <Metric label="P95" value={result.summary.p95_ms} />
        <Metric label="P99" value={result.summary.p99_ms} />
      </dl>

      <div className="mt-5 space-y-2">
        <div className="flex items-center gap-3 text-xs text-tx-muted">
          <span className="w-10">p50</span>
          <div className="h-2 flex-1 rounded-full bg-surface">
            <div
              className="h-2 rounded-full bg-accent"
              style={{
                width: `${Math.max((result.summary.median_ms / scale) * 100, 1)}%`,
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-tx-muted">
          <span className="w-10">p95</span>
          <div className="h-2 flex-1 rounded-full bg-surface">
            <div
              className="h-2 rounded-full bg-highlight"
              style={{
                width: `${Math.max((result.summary.p95_ms / scale) * 100, 1)}%`,
              }}
            />
          </div>
        </div>
      </div>
    </article>
  )
}

function DevPage({
  onBack,
  onOpenVariance,
}: {
  onBack: () => void
  onOpenVariance?: () => void
}) {
  const [results, setResults] = useState<BenchmarkResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scale = useMemo(
    () => Math.max(...results.map((result) => result.summary.p95_ms), 0.001),
    [results],
  )

  const runAllBenchmarks = async () => {
    setIsRunning(true)
    setError(null)

    try {
      const backendResponse = await fetch(
        `${COORDINATOR_URL}/dev/benchmarks/native`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warmup_runs: BENCHMARK_WARMUP_RUNS,
            measured_runs: BENCHMARK_MEASURED_RUNS,
            workloads: BENCHMARK_WORKLOADS.map(({ id, iterations }) => ({
              id,
              iterations: iterations ?? null,
            })),
          }),
        },
      )
      if (!backendResponse.ok) {
        throw new Error(`Backend benchmark failed (${backendResponse.status}).`)
      }
      const backendResults = (await backendResponse.json()) as BenchmarkResult[]

      const browserResults: BenchmarkResult[] = []
      for (const workload of BENCHMARK_WORKLOADS) {
        browserResults.push(
          await runBenchmark(
            () =>
              runWasmTask(
                workload.artifact,
                benchmarkTask(workload.input),
              ).then(() => undefined),
            {
              scenario: 'browser-local-wasm',
              workload: workload.id,
              warmup_runs: BENCHMARK_WARMUP_RUNS,
              measured_runs: BENCHMARK_MEASURED_RUNS,
            },
          ),
        )
      }

      const remoteResults = await runRemoteBenchmarks(
        BENCHMARK_WORKLOADS.map(toRemoteWorkload),
        {
          warmup_runs: BENCHMARK_WARMUP_RUNS,
          measured_runs: BENCHMARK_MEASURED_RUNS,
        },
      )
      setResults([...backendResults, ...browserResults, ...remoteResults])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Benchmark failed.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="min-h-screen bg-base px-4 py-8 text-tx-primary">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={onBack}
              className="btn btn-secondary"
            >
              Back
            </button>
            <h1 className="mt-6 text-3xl font-semibold">
              Developer benchmarks
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-tx-secondary">
              Run native, browser-local, and remote browser-worker benchmarks
              and compare their returned measurements.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => onOpenVariance?.()}
              className="btn btn-secondary mt-1"
            >
              Open variance explorer
            </button>
            <button
              type="button"
              onClick={() => void runAllBenchmarks()}
              disabled={isRunning}
              className="btn btn-primary mt-1"
            >
              {isRunning ? 'Running...' : 'Run all benchmarks'}
            </button>
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {results.length > 0 ? (
          <section className="mt-8 grid gap-4 md:grid-cols-2">
            {results.map((result) => (
              <BenchmarkCard
                key={`${result.scenario}:${result.workload}`}
                result={result}
                scale={scale}
              />
            ))}
          </section>
        ) : (
          <div className="card mt-8 p-6 text-sm text-tx-muted">
            No benchmark has been run in this session.
          </div>
        )}

        <section className="card mt-8 p-5">
          <h2 className="font-medium text-tx-primary">
            Other benchmark layers
          </h2>
          <p className="mt-2 text-sm text-tx-secondary">
            Native results come from the coordinator machine. Browser-local and
            remote-worker results are executed in this browser through the
            coordinator.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-surface p-3 text-xs text-tx-secondary">
            {`make benchmark
make benchmark-e2e
make benchmark-all`}
          </pre>
        </section>
      </div>
    </main>
  )
}

export default DevPage
