import { useState } from 'react'
import { BenchmarkChart } from '../components/BenchmarkChart'
import { PageHeader } from '../components/PageHeader'
import { COORDINATOR_URL } from '../coordinator'
import type { BenchmarkResult } from '../benchmarks/types'
import {
  BENCHMARK_MEASURED_RUNS,
  BENCHMARK_SCENARIOS,
  BENCHMARK_WARMUP_RUNS,
  BENCHMARK_WORKLOADS,
  SCENARIO_LABELS,
  toRemoteWorkload,
  type BenchmarkScenario,
  type BenchmarkWorkload,
} from '../benchmarks/suite'
import { runBenchmark } from '../benchmarks/runner'
import { runRemoteBenchmarks } from '../benchmarks/browser-remote'
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

function benchmarkTask(input: unknown): Task {
  return { ...task, input }
}

function workloadLabel(workload: BenchmarkWorkload): string {
  const iterations = workload.iterations ?? workload.input
  const iterationText =
    typeof iterations === 'number' ? ` · ${iterations} iterations` : ''
  return `${workload.id}${iterationText}`
}

export default function VariancePage({ onBack }: { onBack: () => void }) {
  const [results, setResults] = useState<BenchmarkResult[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warmupRuns, setWarmupRuns] = useState(BENCHMARK_WARMUP_RUNS)
  const [measuredRuns, setMeasuredRuns] = useState(BENCHMARK_MEASURED_RUNS)
  const [selectedScenarios, setSelectedScenarios] = useState<
    Record<BenchmarkScenario, boolean>
  >({
    'native-backend': true,
    'browser-local-wasm': true,
    'remote-browser-worker': true,
  })
  const [selectedWorkloadIds, setSelectedWorkloadIds] = useState<string[]>(() =>
    BENCHMARK_WORKLOADS.map((workload) => workload.id),
  )

  const toggleScenario = (scenario: BenchmarkScenario) => {
    setSelectedScenarios((current) => ({
      ...current,
      [scenario]: !current[scenario],
    }))
  }

  const toggleWorkload = (workloadId: string) => {
    setSelectedWorkloadIds((current) =>
      current.includes(workloadId)
        ? current.filter((id) => id !== workloadId)
        : [...current, workloadId],
    )
  }

  const runMatrix = async () => {
    setIsRunning(true)
    setError(null)

    try {
      const selectedWorkloads = BENCHMARK_WORKLOADS.filter((workload) =>
        selectedWorkloadIds.includes(workload.id),
      )

      const nextResults: BenchmarkResult[] = []

      if (selectedScenarios['native-backend']) {
        const backendResponse = await fetch(
          `${COORDINATOR_URL}/dev/benchmarks/native`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              warmup_runs: warmupRuns,
              measured_runs: measuredRuns,
              workloads: selectedWorkloads.map(({ id, iterations }) => ({
                id,
                iterations: iterations ?? null,
              })),
            }),
          },
        )
        if (!backendResponse.ok) {
          throw new Error(
            `Backend benchmark failed (${backendResponse.status}).`,
          )
        }
        nextResults.push(...(await backendResponse.json()))
      }

      if (selectedScenarios['browser-local-wasm']) {
        for (const workload of selectedWorkloads) {
          nextResults.push(
            await runBenchmark(
              () =>
                runWasmTask(
                  workload.artifact,
                  benchmarkTask(workload.input),
                ).then(() => undefined),
              {
                scenario: 'browser-local-wasm',
                workload: workload.id,
                warmup_runs: warmupRuns,
                measured_runs: measuredRuns,
              },
            ),
          )
        }
      }

      if (selectedScenarios['remote-browser-worker']) {
        nextResults.push(
          ...(await runRemoteBenchmarks(
            selectedWorkloads.map(toRemoteWorkload),
            { warmup_runs: warmupRuns, measured_runs: measuredRuns },
          )),
        )
      }

      setResults(nextResults)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Benchmark failed.')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="min-h-screen bg-base px-4 py-8 text-tx-primary">
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Benchmark variance"
          description="Run parameterized benchmarks across native, browser-local, and remote execution and compare medians."
        >
          <button type="button" onClick={onBack} className="btn btn-secondary">
            Back
          </button>
          <button
            type="button"
            onClick={() => void runMatrix()}
            disabled={isRunning}
            className="btn btn-primary"
          >
            {isRunning ? 'Running...' : 'Run benchmark matrix'}
          </button>
        </PageHeader>

        <section className="card mt-6 p-5">
          <h2 className="section-title">Benchmark matrix</h2>
          <p className="mt-2 text-sm text-tx-secondary">
            Pick execution scenarios and workload parameters, then run the suite
            and compare measured medians.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="benchmark-warmup-runs">
                Warmup runs
              </label>
              <input
                id="benchmark-warmup-runs"
                className="input"
                type="number"
                min={0}
                max={20}
                value={warmupRuns}
                onChange={(event) =>
                  setWarmupRuns(
                    Math.max(0, Math.min(20, Number(event.target.value) || 0)),
                  )
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="benchmark-measured-runs">
                Measured runs
              </label>
              <input
                id="benchmark-measured-runs"
                className="input"
                type="number"
                min={1}
                max={200}
                value={measuredRuns}
                onChange={(event) =>
                  setMeasuredRuns(
                    Math.max(
                      1,
                      Math.min(
                        200,
                        Number(event.target.value) || BENCHMARK_MEASURED_RUNS,
                      ),
                    ),
                  )
                }
              />
            </div>
          </div>

          <div className="mt-5">
            <span className="label">Scenarios</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {BENCHMARK_SCENARIOS.map((scenario) => (
                <label
                  key={scenario}
                  className="flex items-center gap-2 rounded-sm border border-border-strong px-2.5 py-1.5 text-sm hover:border-accent hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    checked={selectedScenarios[scenario]}
                    onChange={() => toggleScenario(scenario)}
                    className="h-4 w-4 rounded-sm border-border-strong accent-accent"
                  />
                  <span className="text-tx-secondary">
                    {SCENARIO_LABELS[scenario]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <span className="label">Workload parameters</span>
            <div className="mt-2 flex flex-wrap gap-2">
              {BENCHMARK_WORKLOADS.map((workload) => (
                <label
                  key={workload.id}
                  className="flex items-center gap-2 rounded-sm border border-border-strong px-2.5 py-1.5 text-sm hover:border-accent hover:bg-surface"
                >
                  <input
                    type="checkbox"
                    checked={selectedWorkloadIds.includes(workload.id)}
                    onChange={() => toggleWorkload(workload.id)}
                    className="h-4 w-4 rounded-sm border-border-strong accent-accent"
                  />
                  <span className="text-tx-secondary">
                    {workloadLabel(workload)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-6 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {results.length > 0 ? (
          <section className="card mt-6 p-5">
            <h2 className="section-title">Latency comparison</h2>
            <p className="mt-2 text-sm text-tx-secondary">
              Median execution time per workload across the selected scenarios.
            </p>
            <div className="mt-6">
              <BenchmarkChart results={results} />
            </div>
          </section>
        ) : (
          <div className="card mt-6 p-6 text-sm text-tx-muted">
            No benchmark has been run in this session yet.
          </div>
        )}
      </div>
    </main>
  )
}
