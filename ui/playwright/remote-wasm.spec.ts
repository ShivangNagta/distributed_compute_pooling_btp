import { expect, test } from '@playwright/test'

import { emitBenchmarkResults } from '../src/benchmarks/output'
import {
  BENCHMARK_MEASURED_RUNS,
  BENCHMARK_WARMUP_RUNS,
} from '../src/benchmarks/suite'
import { summarize } from '../src/benchmarks/statistics'

test('benchmarks remote WASM execution', async ({ browser }) => {
  test.setTimeout(120_000)

  const client = await browser.newPage()
  const worker = await browser.newPage()

  try {
    await client.goto('/client')
    await client.getByRole('button', { name: 'Create room' }).click()

    const roomId = await client
      .getByText('Room ID')
      .locator('..')
      .locator('code')
      .innerText()
    const workerToken = await client
      .getByText('Worker token')
      .locator('..')
      .locator('code')
      .innerText()
    const clientToken = await client
      .getByText('Client token')
      .locator('..')
      .locator('code')
      .innerText()

    await worker.goto('/worker')
    await worker.locator('#room-id').fill(roomId)
    await worker.locator('#room-token').fill(workerToken)
    await worker.getByRole('button', { name: 'Join room' }).click()
    await expect(
      worker.getByText(new RegExp(`Connected to room ${roomId}`)),
    ).toBeVisible()

    const workerCheckbox = client.locator('input[type="checkbox"]')
    await expect(workerCheckbox).toHaveCount(1)
    await workerCheckbox.check()

    const warmupRuns = BENCHMARK_WARMUP_RUNS
    const measuredRuns = BENCHMARK_MEASURED_RUNS
    const workloads = [
      { id: 'sample-add', button: 'Sample' },
      { id: 'xorshift-loop-1m', button: 'Xorshift loop' },
    ]
    const results = []

    for (const workload of workloads) {
      await client.getByRole('button', { name: workload.button }).click()
      const samples: number[] = []
      const workerExecutionSamples: number[] = []

      for (let run = 0; run < warmupRuns + measuredRuns; run += 1) {
        const jobName = `${workload.id}-${run}`
        await workerCheckbox.check()
        await client.locator('#job-name').fill(jobName)

        const started = performance.now()
        const submitResponse = client.waitForResponse(
          (response) =>
            response.url().includes('/job/submit') &&
            response.request().method() === 'POST',
        )
        await client.getByRole('button', { name: 'Submit job' }).click()
        const jobId = (await (await submitResponse).json()).job_id as string

        await expect
          .poll(
            async () =>
              client.evaluate(
                async ({ roomId, clientToken, jobId }) => {
                  const response = await fetch(
                    `http://localhost:3000/room/${roomId}/job/${jobId}`,
                    { headers: { Authorization: `Bearer ${clientToken}` } },
                  )
                  const body = (await response.json()) as {
                    job?: { status?: string }
                  }
                  return body.job?.status
                },
                { roomId, clientToken, jobId },
              ),
            { timeout: 10_000 },
          )
          .toBe('completed')
        const elapsed = performance.now() - started

        if (run >= warmupRuns) {
          samples.push(elapsed)
          const taskExecutionTime = await client.evaluate(
            async ({ roomId, clientToken, jobId }) => {
              const response = await fetch(
                `http://localhost:3000/room/${roomId}/job/${jobId}`,
                { headers: { Authorization: `Bearer ${clientToken}` } },
              )
              const body = (await response.json()) as {
                tasks?: { execution_time_ms?: number | null }[]
              }
              return body.tasks?.[0]?.execution_time_ms ?? null
            },
            { roomId, clientToken, jobId },
          )
          if (taskExecutionTime != null) {
            workerExecutionSamples.push(taskExecutionTime)
          }
        }
      }

      results.push({
        scenario: 'remote-browser-worker',
        workload: workload.id,
        warmup_runs: warmupRuns,
        measured_runs: measuredRuns,
        samples_ms: samples,
        summary: summarize(samples),
        worker_execution_ms: workerExecutionSamples,
      })
    }

    emitBenchmarkResults(results)
    expect(results).toHaveLength(workloads.length)
    for (const result of results) {
      expect(result.samples_ms).toHaveLength(measuredRuns)
    }
  } finally {
    await worker.close()
    await client.close()
  }
})
