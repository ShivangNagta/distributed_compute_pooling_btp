import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function emitBenchmarkResults(results: unknown): void {
  const output = JSON.stringify(results, null, 2)
  console.log(output)

  const outputPath = process.env.BENCHMARK_OUTPUT
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, `${output}\n`)
  }
}
