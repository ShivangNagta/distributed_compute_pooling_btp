import { COORDINATOR_URL, coordinatorWsUrl, parseMessage } from '../coordinator'
import {
  BENCHMARK_MEASURED_RUNS,
  BENCHMARK_WARMUP_RUNS,
  DEFAULT_REMOTE_WORKLOADS,
  type RemoteWorkload,
} from './suite'
import { runTask } from '../lib/wasm'
import type { Artifact, Capabilities, Message, Task } from '../types'
import { summarize } from './statistics'
import type { BenchmarkResult } from './types'

type RoomResponse = {
  room_id: string
  client_token: string
  worker_token: string
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.addEventListener('open', () => resolve(socket), { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('remote benchmark WebSocket failed')),
      { once: true },
    )
  })
}

function capabilities(): Capabilities {
  return {
    cores: navigator.hardwareConcurrency || null,
    platform: navigator.platform || null,
    user_agent: navigator.userAgent || null,
  }
}

async function waitForJob(
  room: RoomResponse,
  jobId: string,
): Promise<{ status: string; executionTimeMs: number | null }> {
  for (;;) {
    const response = await fetch(
      `${COORDINATOR_URL}/room/${room.room_id}/job/${jobId}`,
      { headers: { Authorization: `Bearer ${room.client_token}` } },
    )
    if (!response.ok) {
      throw new Error(`remote benchmark status failed (${response.status})`)
    }
    const body = (await response.json()) as {
      job?: { status?: string }
      tasks?: { execution_time_ms?: number | null }[]
    }
    const status = body.job?.status
    if (status === 'completed' || status === 'failed') {
      return {
        status,
        executionTimeMs: body.tasks?.[0]?.execution_time_ms ?? null,
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 10))
  }
}

async function runWorkload(
  room: RoomResponse,
  workerId: string,
  workload: RemoteWorkload,
  run: number,
): Promise<{ elapsedMs: number; executionTimeMs: number | null }> {
  const response = await fetch(
    `${COORDINATOR_URL}/room/${room.room_id}/job/submit`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${room.client_token}`,
      },
      body: JSON.stringify({
        name: `dev-${workload.workload}-${run}`,
        artifact: workload.artifact,
        tasks: [{ worker_id: workerId, input: workload.input }],
        metadata: {},
      }),
    },
  )
  if (!response.ok) {
    throw new Error(`remote benchmark submission failed (${response.status})`)
  }
  const body = (await response.json()) as { job_id?: string }
  if (!body.job_id) throw new Error('remote benchmark returned no job ID')

  const started = performance.now()
  const result = await waitForJob(room, body.job_id)
  if (result.status !== 'completed') {
    throw new Error(`remote benchmark job ${body.job_id} failed`)
  }
  return {
    elapsedMs: performance.now() - started,
    executionTimeMs: result.executionTimeMs,
  }
}

async function runRemoteWorkload(
  room: RoomResponse,
  workerId: string,
  workload: RemoteWorkload,
  warmupRuns: number,
  measuredRuns: number,
): Promise<BenchmarkResult> {
  for (let run = 0; run < warmupRuns; run += 1) {
    await runWorkload(room, workerId, workload, run)
  }

  const samples: number[] = []
  const workerExecutionSamples: number[] = []
  for (let run = 0; run < measuredRuns; run += 1) {
    const result = await runWorkload(room, workerId, workload, warmupRuns + run)
    samples.push(result.elapsedMs)
    if (result.executionTimeMs != null) {
      workerExecutionSamples.push(result.executionTimeMs)
    }
  }

  return {
    scenario: 'remote-browser-worker',
    workload: workload.workload,
    warmup_runs: warmupRuns,
    measured_runs: measuredRuns,
    samples_ms: samples,
    summary: summarize(samples),
    worker_execution_ms: workerExecutionSamples,
  }
}

export async function runRemoteBenchmarks(
  workloads: RemoteWorkload[] = DEFAULT_REMOTE_WORKLOADS,
  options: { warmup_runs?: number; measured_runs?: number } = {},
): Promise<BenchmarkResult[]> {
  const warmupRuns = options.warmup_runs ?? BENCHMARK_WARMUP_RUNS
  const measuredRuns = options.measured_runs ?? BENCHMARK_MEASURED_RUNS
  const roomResponse = await fetch(`${COORDINATOR_URL}/create_room`, {
    method: 'POST',
  })
  if (!roomResponse.ok) {
    throw new Error(`remote benchmark room failed (${roomResponse.status})`)
  }
  const room = (await roomResponse.json()) as RoomResponse
  const clientSocket = await openSocket(
    coordinatorWsUrl(`/ws/${room.room_id}/${room.client_token}`),
  )
  const workerSocket = await openSocket(
    coordinatorWsUrl(`/ws/join_room/${room.room_id}/${room.worker_token}`),
  )

  try {
    const workerIdPromise = new Promise<string>((resolve) => {
      clientSocket.addEventListener('message', (event) => {
        const message = parseMessage(event.data)
        if (message?.type === 'worker_joined') resolve(message.payload.id)
      })
    })
    const artifacts = new Map<string, Artifact>()
    workerSocket.addEventListener('message', (event) => {
      const message = parseMessage(event.data)
      if (!message) return
      if (message.type === 'job_artifact') {
        artifacts.set(message.payload.job_id, message.payload.artifact)
        return
      }
      if (message.type !== 'task_assign') return
      void handleTask(workerSocket, message, artifacts)
    })
    workerSocket.send(
      JSON.stringify({ type: 'capabilities', payload: capabilities() }),
    )

    const workerId = await workerIdPromise
    const results: BenchmarkResult[] = []
    for (const workload of workloads) {
      results.push(
        await runRemoteWorkload(
          room,
          workerId,
          workload,
          warmupRuns,
          measuredRuns,
        ),
      )
    }
    return results
  } finally {
    clientSocket.close()
    workerSocket.close()
  }
}

async function handleTask(
  socket: WebSocket,
  message: Extract<Message, { type: 'task_assign' }>,
  artifacts: Map<string, Artifact>,
): Promise<void> {
  const task = message.payload
  const artifact = artifacts.get(task.job_id)
  socket.send(
    JSON.stringify({ type: 'task_started', payload: { task_id: task.id } }),
  )
  try {
    if (!artifact) throw new Error('remote benchmark artifact was not received')
    const result = await runTask(artifact, task as Task)
    socket.send(
      JSON.stringify({
        type: 'task_result',
        payload: {
          task_id: task.id,
          result: result.result,
          execution_time_ms: result.execution_time_ms,
        },
      }),
    )
  } catch (error) {
    socket.send(
      JSON.stringify({
        type: 'task_failed',
        payload: {
          task_id: task.id,
          error: error instanceof Error ? error.message : 'execution failed',
        },
      }),
    )
  }
}
