import type {
  Combine,
  ResultType,
  WorkloadArg,
  WorkloadExample,
} from './examples'

const I32_MIN = -2147483648
const I32_MAX = 2147483647
const U32_MAX = 4294967295

export function coerceArg(arg: WorkloadArg, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${arg.label} must be a number.`)
  }
  if (arg.type === 'f64') {
    return value
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${arg.label} must be an integer.`)
  }
  if (arg.type === 'i32' && (value < I32_MIN || value > I32_MAX)) {
    throw new Error(`${arg.label} must fit in a signed 32-bit integer.`)
  }
  if (arg.type === 'u32' && (value < 0 || value > U32_MAX)) {
    throw new Error(`${arg.label} must fit in an unsigned 32-bit integer.`)
  }
  return value
}

export function validateValues(
  example: WorkloadExample,
  values: Record<string, number>,
): string | null {
  for (const arg of example.args) {
    const value = values[arg.key] ?? arg.default
    try {
      coerceArg(arg, value)
    } catch (error) {
      return error instanceof Error ? error.message : `${arg.label} is invalid.`
    }
    if (arg.min !== undefined && value < arg.min) {
      return `${arg.label} must be at least ${arg.min}.`
    }
    if (arg.max !== undefined && value > arg.max) {
      return `${arg.label} must be at most ${arg.max}.`
    }
  }
  return null
}

function argValue(
  example: WorkloadExample,
  values: Record<string, number>,
  key: string,
): number {
  const arg = example.args.find((item) => item.key === key)
  if (!arg) {
    throw new Error(`unknown argument "${key}"`)
  }
  return coerceArg(arg, values[key] ?? arg.default)
}

function hasArg(example: WorkloadExample, key: string): boolean {
  return example.args.some((item) => item.key === key)
}

/** Splits [start, end) into `parts` contiguous, balanced sub-ranges. */
export function splitRange(
  start: number,
  end: number,
  parts: number,
): Array<[number, number]> {
  const count = Math.max(1, Math.floor(parts))
  const total = Math.max(0, end - start)
  return Array.from({ length: count }, (_, index) => {
    const from = start + Math.floor((total * index) / count)
    const to = start + Math.floor((total * (index + 1)) / count)
    return [from, to]
  })
}

/**
 * Builds one positional argument list per worker. Non-splittable examples
 * always return a single input.
 */
export function buildTaskInputs(
  example: WorkloadExample,
  values: Record<string, number>,
  workerCount: number,
): number[][] {
  const singleInput = example.args.map((arg) =>
    coerceArg(arg, values[arg.key] ?? arg.default),
  )

  if (!example.split) {
    return [singleInput]
  }

  const count = Math.max(1, Math.floor(workerCount))

  if (example.split.kind === 'range') {
    const start = argValue(example, values, example.split.startKey)
    const end = argValue(example, values, example.split.endKey)
    if (end < start) {
      throw new Error('end must be greater than or equal to start.')
    }
    return splitRange(start, end, count).map(([from, to]) => [from, to])
  }

  if (example.split.kind === 'iterations') {
    const total = argValue(example, values, example.split.iterationsKey)
    const seed = hasArg(example, 'seed') ? argValue(example, values, 'seed') : 0
    return splitRange(0, total, count).map(([from, to], index) => [
      to - from,
      (seed + index) >>> 0,
    ])
  }

  const size = argValue(example, values, example.split.rowsKey)
  const seed = hasArg(example, 'seed') ? argValue(example, values, 'seed') : 0
  return splitRange(0, size, count).map(([from, to]) => [size, from, to, seed])
}

function combine(combineKind: Combine, results: number[]): number | null {
  if (results.length === 0) {
    return null
  }
  if (combineKind === 'sum') {
    return results.reduce((total, value) => total + value, 0)
  }
  if (combineKind === 'max') {
    return Math.max(...results)
  }
  return results.reduce((total, value) => total + value, 0) / results.length
}

export function combineResults(
  example: WorkloadExample,
  results: number[],
): number | null {
  const values =
    example.resultType === 'u32' ? results.map((value) => value >>> 0) : results
  if (!example.split) {
    return values.length > 0 ? values[0] : null
  }
  const combined = combine(example.split.combine, values)
  return combined !== null && example.resultType === 'u32'
    ? combined >>> 0
    : combined
}

export function formatResult(
  value: number | null,
  resultType?: ResultType,
): string {
  if (value === null || Number.isNaN(value)) {
    return '—'
  }
  if (resultType === 'u32') {
    return (value >>> 0).toLocaleString('en-US')
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString('en-US')
  }
  return value.toFixed(6)
}
