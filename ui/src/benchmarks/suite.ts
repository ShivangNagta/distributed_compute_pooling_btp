import type { Artifact } from '../types'
import { loopArtifact, sampleArtifact } from '../lib/sample'

export const BENCHMARK_WARMUP_RUNS = 5
export const BENCHMARK_MEASURED_RUNS = 50

export type BenchmarkScenario =
  'native-backend' | 'browser-local-wasm' | 'remote-browser-worker'

export type BenchmarkWorkload = {
  id: string
  iterations?: number
  artifact: Artifact
  input: unknown
}

export type RemoteWorkload = {
  workload: string
  artifact: Artifact
  input: unknown
}

export const SAMPLE_ADD_WORKLOAD: BenchmarkWorkload = {
  id: 'sample-add',
  artifact: sampleArtifact(),
  input: [2, 3],
}

const LOOP_WORKLOADS: BenchmarkWorkload[] = [
  {
    id: 'xorshift-loop-1k',
    iterations: 1_000,
    artifact: loopArtifact(),
    input: [1_000],
  },
  {
    id: 'xorshift-loop-10k',
    iterations: 10_000,
    artifact: loopArtifact(),
    input: [10_000],
  },
  {
    id: 'xorshift-loop-100k',
    iterations: 100_000,
    artifact: loopArtifact(),
    input: [100_000],
  },
  {
    id: 'xorshift-loop-1m',
    iterations: 1_000_000,
    artifact: loopArtifact(),
    input: [1_000_000],
  },
]

export const BENCHMARK_WORKLOADS: BenchmarkWorkload[] = [
  SAMPLE_ADD_WORKLOAD,
  ...LOOP_WORKLOADS,
]

export const DEFAULT_REMOTE_WORKLOADS: RemoteWorkload[] =
  BENCHMARK_WORKLOADS.map((workload) => ({
    workload: workload.id,
    artifact: workload.artifact,
    input: workload.input,
  }))

export const BENCHMARK_SCENARIOS: BenchmarkScenario[] = [
  'native-backend',
  'browser-local-wasm',
  'remote-browser-worker',
]

export const SCENARIO_LABELS: Record<BenchmarkScenario, string> = {
  'native-backend': 'Native backend',
  'browser-local-wasm': 'Browser local',
  'remote-browser-worker': 'Remote browser worker',
}

export function toRemoteWorkload(workload: BenchmarkWorkload): RemoteWorkload {
  return {
    workload: workload.id,
    artifact: workload.artifact,
    input: workload.input,
  }
}
