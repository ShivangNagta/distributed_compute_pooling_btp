import { readFileSync } from 'node:fs'

import type { BenchmarkResult } from './types'

const paths = process.argv.slice(2)
if (paths.length === 0) {
  throw new Error('provide at least one benchmark result JSON file')
}

const results = paths.flatMap((path) => {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as
    BenchmarkResult | BenchmarkResult[]
  return Array.isArray(parsed) ? parsed : [parsed]
})

const nativeMedians = new Map(
  results
    .filter((result) => result.scenario.startsWith('native-'))
    .map((result) => [result.workload, result.summary.median_ms]),
)

const rows = results.map((result) => ({
  scenario: result.scenario,
  workload: result.workload,
  median_ms: result.summary.median_ms,
  p95_ms: result.summary.p95_ms,
  mean_ms: result.summary.mean_ms,
  relative_to_native:
    nativeMedians.get(result.workload) === undefined
      ? null
      : result.summary.median_ms / nativeMedians.get(result.workload)!,
}))

console.table(rows)

const summary = rows.map((row) => ({
  ...row,
  relative_to_native: row.relative_to_native
    ? Number(row.relative_to_native.toFixed(2))
    : null,
}))
console.log(JSON.stringify(summary, null, 2))
