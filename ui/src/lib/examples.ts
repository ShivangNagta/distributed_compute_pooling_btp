import type { Artifact } from '../types'

export type WorkloadLanguage = 'rust' | 'c'
export type ArgType = 'i32' | 'u32' | 'f64'
export type ResultType = 'i32' | 'u32' | 'f64'
export type Combine = 'sum' | 'mean' | 'max'

export interface WorkloadArg {
  key: string
  label: string
  type: ArgType
  default: number
  min?: number
  max?: number
  step?: number
}

export type SplitPolicy =
  | { kind: 'range'; startKey: string; endKey: string; combine: Combine }
  | { kind: 'iterations'; iterationsKey: string; combine: Combine }
  | { kind: 'rows'; rowsKey: string; combine: Combine }

export interface WorkloadExample {
  id: string
  title: string
  description: string
  language: WorkloadLanguage
  module: string
  entryPoint: string
  resultType: ResultType
  args: WorkloadArg[]
  split?: SplitPolicy
  sourceUrl: string
}

export const CUSTOM_EXAMPLE_ID = '__custom__'

const RUST_MODULE = '/examples/workloads.wasm'
const RUST_SOURCE = '/examples/src/workloads.rs'

export const EXAMPLES: WorkloadExample[] = [
  {
    id: 'add',
    title: 'Add two integers',
    description: 'Sanity check: calls add(a, b) on a single worker.',
    language: 'rust',
    module: RUST_MODULE,
    entryPoint: 'add',
    resultType: 'i32',
    sourceUrl: RUST_SOURCE,
    args: [
      { key: 'a', label: 'a', type: 'i32', default: 7 },
      { key: 'b', label: 'b', type: 'i32', default: 5 },
    ],
  },
  {
    id: 'fib',
    title: 'Fibonacci (iterative)',
    description:
      'Computes fib(n) with wrapping u32 arithmetic. Cost is linear in n.',
    language: 'rust',
    module: RUST_MODULE,
    entryPoint: 'fib',
    resultType: 'u32',
    sourceUrl: RUST_SOURCE,
    args: [
      {
        key: 'n',
        label: 'n',
        type: 'u32',
        default: 1_000_000,
        min: 0,
        max: 50_000_000,
      },
    ],
  },
  {
    id: 'prime-count',
    title: 'Prime count (distributed)',
    description:
      'Counts primes in [start, end). Split the range across workers and sum the counts.',
    language: 'rust',
    module: RUST_MODULE,
    entryPoint: 'prime_count_range',
    resultType: 'u32',
    sourceUrl: RUST_SOURCE,
    split: { kind: 'range', startKey: 'start', endKey: 'end', combine: 'sum' },
    args: [
      { key: 'start', label: 'start', type: 'u32', default: 0, min: 0 },
      { key: 'end', label: 'end', type: 'u32', default: 2_000_000, min: 0 },
    ],
  },
  {
    id: 'monte-carlo-pi',
    title: 'Monte Carlo Pi (distributed)',
    description:
      'Estimates Pi. Split the iterations across workers and average the estimates.',
    language: 'rust',
    module: RUST_MODULE,
    entryPoint: 'monte_carlo_pi',
    resultType: 'f64',
    sourceUrl: RUST_SOURCE,
    split: { kind: 'iterations', iterationsKey: 'iterations', combine: 'mean' },
    args: [
      {
        key: 'iterations',
        label: 'iterations',
        type: 'u32',
        default: 5_000_000,
        min: 1,
        max: 500_000_000,
      },
      { key: 'seed', label: 'seed', type: 'u32', default: 12345, min: 0 },
    ],
  },
  {
    id: 'matmul-checksum',
    title: 'Matrix multiply checksum (distributed)',
    description:
      'Deterministic integer matmul; split the rows across workers and sum the checksums.',
    language: 'rust',
    module: RUST_MODULE,
    entryPoint: 'matmul_checksum_range',
    resultType: 'u32',
    sourceUrl: RUST_SOURCE,
    split: { kind: 'rows', rowsKey: 'n', combine: 'sum' },
    args: [
      {
        key: 'n',
        label: 'n (matrix size)',
        type: 'u32',
        default: 96,
        min: 1,
        max: 2048,
      },
      { key: 'seed', label: 'seed', type: 'u32', default: 1234, min: 0 },
    ],
  },
  {
    id: 'hash-chain',
    title: 'Hash chain',
    description: 'Runs an xorshift chain for the given number of iterations.',
    language: 'rust',
    module: RUST_MODULE,
    entryPoint: 'hash_chain',
    resultType: 'u32',
    sourceUrl: RUST_SOURCE,
    args: [
      {
        key: 'iterations',
        label: 'iterations',
        type: 'u32',
        default: 20_000_000,
        min: 1,
        max: 500_000_000,
      },
      { key: 'seed', label: 'seed', type: 'u32', default: 1, min: 0 },
    ],
  },
  {
    id: 'c-prime-count',
    title: 'Prime count (C, distributed)',
    description:
      'The same prime count written in freestanding C and compiled with emcc.',
    language: 'c',
    module: '/examples/c-prime_count.wasm',
    entryPoint: 'prime_count_range',
    resultType: 'u32',
    sourceUrl: '/examples/src/prime_count.c',
    split: { kind: 'range', startKey: 'start', endKey: 'end', combine: 'sum' },
    args: [
      { key: 'start', label: 'start', type: 'u32', default: 0, min: 0 },
      { key: 'end', label: 'end', type: 'u32', default: 2_000_000, min: 0 },
    ],
  },
  {
    id: 'c-monte-carlo-pi',
    title: 'Monte Carlo Pi (C, distributed)',
    description: 'The Monte Carlo Pi estimator written in freestanding C.',
    language: 'c',
    module: '/examples/c-monte_carlo_pi.wasm',
    entryPoint: 'monte_carlo_pi',
    resultType: 'f64',
    sourceUrl: '/examples/src/monte_carlo_pi.c',
    split: { kind: 'iterations', iterationsKey: 'iterations', combine: 'mean' },
    args: [
      {
        key: 'iterations',
        label: 'iterations',
        type: 'u32',
        default: 5_000_000,
        min: 1,
        max: 500_000_000,
      },
      { key: 'seed', label: 'seed', type: 'u32', default: 12345, min: 0 },
    ],
  },
  {
    id: 'c-fib',
    title: 'Fibonacci (C)',
    description: 'Iterative Fibonacci written in freestanding C.',
    language: 'c',
    module: '/examples/c-fib.wasm',
    entryPoint: 'fib',
    resultType: 'u32',
    sourceUrl: '/examples/src/fib.c',
    args: [
      {
        key: 'n',
        label: 'n',
        type: 'u32',
        default: 1_000_000,
        min: 0,
        max: 50_000_000,
      },
    ],
  },
]

export function findExample(id: string): WorkloadExample | undefined {
  return EXAMPLES.find((example) => example.id === id)
}

export function defaultValueMap(
  example: WorkloadExample,
): Record<string, number> {
  return Object.fromEntries(example.args.map((arg) => [arg.key, arg.default]))
}

export function isSplittable(example: WorkloadExample): boolean {
  return example.split !== undefined
}

const moduleCache = new Map<string, Promise<string>>()
const sourceCache = new Map<string, Promise<string>>()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function loadModuleBase64(moduleUrl: string): Promise<string> {
  const cached = moduleCache.get(moduleUrl)
  if (cached) return cached
  const promise = fetch(moduleUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load ${moduleUrl} (${response.status}).`)
    }
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()))
  })
  moduleCache.set(moduleUrl, promise)
  promise.catch(() => moduleCache.delete(moduleUrl))
  return promise
}

export async function loadExampleArtifact(
  example: WorkloadExample,
): Promise<Artifact> {
  const content = await loadModuleBase64(example.module)
  const fileName = example.module.split('/').pop() ?? 'module.wasm'
  return {
    entry_point: example.entryPoint,
    kind: 'wasm',
    files: [{ name: fileName, content, mime: 'application/wasm' }],
  }
}

export function loadSource(sourceUrl: string): Promise<string> {
  const cached = sourceCache.get(sourceUrl)
  if (cached) return cached
  const promise = fetch(sourceUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Unable to load ${sourceUrl} (${response.status}).`)
    }
    return response.text()
  })
  sourceCache.set(sourceUrl, promise)
  promise.catch(() => sourceCache.delete(sourceUrl))
  return promise
}
