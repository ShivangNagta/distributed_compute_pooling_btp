import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CapabilityList } from '../components/CapabilityList'
import { CopyButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { COORDINATOR_URL, coordinatorWsUrl, parseMessage } from '../coordinator'
import { addJobIfMissing, upsertJob, upsertTask, type JobRecord } from '../lib/jobs'
import { sampleArtifact } from '../lib/sample'
import { downloadShaderTemplate, SHADER_TEMPLATE } from '../lib/shaderTemplate'
import { jobStatusTone, statusTone, taskStatusTone } from '../lib/status'
import {
  loadActiveRoomId,
  loadClientRooms,
  saveActiveRoomId,
  saveClientRooms,
  type StoredRoom,
} from '../lib/storage'
import type { Artifact, Worker } from '../types'

type RenderedFrame = {
  jobId: string
  url: string
  width: number
  height: number
}

async function composeImage(
  jobId: string,
  width: number,
  height: number,
  pixelsBase64: string,
): Promise<RenderedFrame> {
  const bytes = decodeBase64(pixelsBase64)
  if (bytes.length !== width * height * 4) {
    throw new Error('Coordinator returned an invalid image buffer.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create a 2D canvas context.')
  context.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Unable to encode the rendered image as PNG.')), 'image/png')
  })
  return { jobId, url: URL.createObjectURL(blob), width, height }
}

async function composeImageFromTasks(jobId: string, tasks: JobRecord['tasks']): Promise<RenderedFrame> {
  const first = tasks[0]
  if (!first || typeof first.input !== 'object' || first.input === null) {
    throw new Error('Shader task has invalid input.')
  }
  const resolution = (first.input as { global_resolution?: unknown }).global_resolution
  if (
    !Array.isArray(resolution) ||
    resolution.length !== 2 ||
    !resolution.every((value) => Number.isInteger(value) && value > 0)
  ) {
    throw new Error('Shader task has invalid global resolution.')
  }
  const [width, height] = resolution as [number, number]
  const pixels = new Uint8Array(width * height * 4)
  for (const task of tasks) {
    if (typeof task.input !== 'object' || task.input === null || typeof task.result !== 'object' || task.result === null) {
      throw new Error('Shader task has invalid result data.')
    }
    const tile = task.input as { offset?: unknown; size?: unknown }
    const result = task.result as { pixels_base64?: unknown }
    if (
      !Array.isArray(tile.offset) || !Array.isArray(tile.size) ||
      tile.offset.length !== 2 || tile.size.length !== 2 ||
      !tile.offset.every((value) => Number.isInteger(value)) ||
      !tile.size.every((value) => Number.isInteger(value) && value > 0) ||
      typeof result.pixels_base64 !== 'string'
    ) {
      throw new Error('Shader task has invalid tile data.')
    }
    const [offsetX, offsetY] = tile.offset as [number, number]
    const [tileWidth, tileHeight] = tile.size as [number, number]
    if (offsetX + tileWidth > width || offsetY + tileHeight > height) {
      throw new Error('Shader task tile is outside the rendered image.')
    }
    const bytes = decodeBase64(result.pixels_base64)
    if (bytes.length !== tileWidth * tileHeight * 4) {
      throw new Error('Shader task returned an invalid image buffer.')
    }
    for (let row = 0; row < tileHeight; row += 1) {
      const source = row * tileWidth * 4
      const target = ((offsetY + row) * width + offsetX) * 4
      pixels.set(bytes.subarray(source, source + tileWidth * 4), target)
    }
  }
  return composeImage(jobId, width, height, bytesToBase64(pixels))
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function downloadFrame(frame: RenderedFrame) {
  const link = document.createElement('a')
  link.href = frame.url
  link.download = `${frame.jobId}-render.png`
  link.click()
}

function TokenRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm text-neutral-600">{label}</div>
        <code className="mono mt-0.5 block break-all text-neutral-900">{value}</code>
      </div>
      <CopyButton value={value} />
    </div>
  )
}

function WorkerCard({ worker }: { worker: Worker }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate text-neutral-900">{worker.id}</span>
        <StatusBadge tone={statusTone(worker.status)}>{worker.status}</StatusBadge>
      </div>
      <CapabilityList capabilities={worker.capabilities} />
    </div>
  )
}

function JobCard({ record }: { record: JobRecord }) {
  const isWgpu = record.job.artifact.kind === 'shader_compute'
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-900">{record.job.name}</span>
        <StatusBadge tone={jobStatusTone(record.job.status)}>{record.job.status}</StatusBadge>
      </div>
      <div className="mono mt-1 text-xs text-neutral-500">{record.job.id}</div>

      <div className="mt-3 space-y-2">
        {record.tasks.length === 0 ? (
          <p className="text-sm text-neutral-500">Waiting for tasks...</p>
        ) : (
          record.tasks.map((task) => (
            <div key={task.id} className="rounded-md bg-neutral-50 p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="mono truncate text-neutral-600">{task.worker_id ?? 'unassigned'}</span>
                <StatusBadge tone={taskStatusTone(task.status)}>{task.status}</StatusBadge>
              </div>
              <div className="mt-1 break-words text-neutral-900">
                {task.error
                  ? `Error: ${task.error}`
                  : isWgpu
                    ? task.status === 'completed'
                      ? 'GPU tile rendered'
                      : `Tile ${task.status}`
                    : `Result: ${task.result === undefined ? 'pending' : JSON.stringify(task.result)}`}
                {task.execution_time_ms != null ? ` · ${task.execution_time_ms} ms` : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function ClientPage({ onBack }: { onBack: () => void }) {
  const socketByRoom = useRef<Record<string, WebSocket>>({})
  const [initialRooms] = useState<StoredRoom[]>(() => loadClientRooms())
  const [rooms, setRooms] = useState<StoredRoom[]>(initialRooms)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() => loadActiveRoomId())
  const [isCreating, setIsCreating] = useState(false)
  const [status, setStatus] = useState(() =>
    initialRooms.length > 0
      ? `Restored ${initialRooms.length} room(s). Reconnecting...`
      : 'No room created yet.',
  )
  const [error, setError] = useState<string | null>(null)

  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobName, setJobName] = useState('add')
  const [entryPoint, setEntryPoint] = useState('add')
  const [source, setSource] = useState<'sample' | 'upload'>('sample')
  const [wasmBase64, setWasmBase64] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [inputText, setInputText] = useState('[1, 2]')
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set())
  const [jobType, setJobType] = useState<'wasm' | 'wgpu'>('wasm')
  const [renderWidth, setRenderWidth] = useState('800')
  const [renderHeight, setRenderHeight] = useState('600')
  const [shaderSource, setShaderSource] = useState<string | null>(null)
  const [shaderFileName, setShaderFileName] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [renderedFrame, setRenderedFrame] = useState<RenderedFrame | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    saveClientRooms(rooms)
  }, [rooms])

  useEffect(() => {
    saveActiveRoomId(activeRoomId)
  }, [activeRoomId])

  useEffect(() => {
    return () => {
      if (renderedFrame) URL.revokeObjectURL(renderedFrame.url)
    }
  }, [renderedFrame])

  const connectClientSocket = useCallback((room: StoredRoom) => {
    if (socketByRoom.current[room.id]) return

    const socket = new WebSocket(
      coordinatorWsUrl(
        `/ws/${encodeURIComponent(room.id)}/${encodeURIComponent(room.clientToken)}`,
      ),
    )
    socketByRoom.current[room.id] = socket

    socket.onopen = () => setStatus(`Connected to room ${room.id}.`)
    socket.onerror = () => setError(`WebSocket connection for room ${room.id} failed.`)
    socket.onclose = () => {
      delete socketByRoom.current[room.id]
    }
    socket.onmessage = (event) => {
      const message = parseMessage(event.data)
      if (!message) return

      if (message.type === 'worker_joined') {
        const worker = message.payload
        setRooms((current) =>
          current.map((item) => {
            if (item.id !== room.id) return item
            const workers = item.workers.filter((w) => w.id !== worker.id)
            return { ...item, workers: [worker, ...workers] }
          }),
        )
        setStatus(`Worker ${worker.id} joined.`)
      } else if (message.type === 'worker_left') {
        const workerId = message.payload.worker_id
        setSelectedWorkers((current) => {
          if (!current.has(workerId)) return current
          const next = new Set(current)
          next.delete(workerId)
          return next
        })
        setRooms((current) =>
          current.map((item) =>
            item.id === room.id
              ? { ...item, workers: item.workers.filter((w) => w.id !== workerId) }
              : item,
          ),
        )
        setStatus(`Worker ${workerId} left.`)
      } else if (message.type === 'job_update') {
        setJobs((current) => upsertJob(current, message.payload))
      } else if (message.type === 'task_update') {
        setJobs((current) => upsertTask(current, message.payload))
      } else if (message.type === 'error') {
        setError(message.payload.reason)
      }
    }
  }, [])

  // Restore persisted rooms and reconnect their sockets on mount.
  useEffect(() => {
    initialRooms.forEach((room) => connectClientSocket(room))
  }, [connectClientSocket, initialRooms])

  useEffect(() => {
    const sockets = socketByRoom.current
    return () => {
      Object.values(sockets).forEach((socket) => socket.close())
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const record = jobs.find(
      (item) =>
        item.job.artifact.kind === 'shader_compute' &&
        item.tasks.length > 0 &&
        item.tasks.every((task) => task.status === 'completed') &&
        renderedFrame?.jobId !== item.job.id,
    )
    if (!record) return () => { cancelled = true }
    void composeImageFromTasks(record.job.id, record.tasks)
      .then((frame) => {
        if (cancelled) {
          URL.revokeObjectURL(frame.url)
          return
        }
        setRenderError(null)
        setRenderedFrame((previous) => {
          if (previous) URL.revokeObjectURL(previous.url)
          return frame
        })
        downloadFrame(frame)
      })
      .catch((renderFailure: unknown) => {
        if (!cancelled) {
          setRenderError(
            renderFailure instanceof Error
              ? renderFailure.message
              : 'Unable to compose rendered image.',
          )
        }
      })
    return () => { cancelled = true }
  }, [jobs, renderedFrame?.jobId])

  const createRoom = async () => {
    setIsCreating(true)
    setError(null)
    setStatus('Creating room...')

    try {
      const response = await fetch(`${COORDINATOR_URL}/create_room`, { method: 'POST' })
      if (!response.ok) {
        throw new Error(`Room creation failed (${response.status})`)
      }

      const body = (await response.json()) as {
        room_id?: string
        client_token?: string
        worker_token?: string
      }
      const roomId = body.room_id
      const clientToken = body.client_token
      const roomToken = body.worker_token

      if (!roomId || !clientToken || !roomToken) {
        throw new Error('Coordinator returned an invalid room response.')
      }

      const nextRoom: StoredRoom = {
        id: roomId,
        clientToken,
        workerToken: roomToken,
        workers: [],
      }

      setRooms((current) =>
        current.some((room) => room.id === roomId) ? current : [nextRoom, ...current],
      )
      setActiveRoomId(roomId)
      connectClientSocket(nextRoom)
      setStatus(`Room ${roomId} created successfully.`)
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Unable to create room.'
      setError(message)
      setStatus(message)
    } finally {
      setIsCreating(false)
    }
  }

  const toggleWorker = (workerId: string) => {
    setSelectedWorkers((current) => {
      const next = new Set(current)
      if (next.has(workerId)) next.delete(workerId)
      else next.add(workerId)
      return next
    })
  }

  const onFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset so picking the same file again still fires `change`.
    event.target.value = ''
    if (!file) return

    if (file.size === 0) {
      setSubmitError('The selected file is empty.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : null
      const base64 = url?.slice(url.indexOf(',') + 1)
      if (!base64) {
        setSubmitError('Could not read the selected file.')
        return
      }
      setWasmBase64(base64)
      setFileName(file.name)
      setSource('upload')
      setSubmitError(null)
    }
    reader.onerror = () => setSubmitError('Could not read the selected file.')
    reader.readAsDataURL(file)
  }

  const onShaderSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size === 0) {
      setSubmitError('The selected shader file is empty.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const source = typeof reader.result === 'string' ? reader.result : null
      if (!source?.trim()) {
        setSubmitError('Could not read the selected shader file.')
        return
      }
      setShaderSource(source)
      setShaderFileName(file.name)
      setSubmitError(null)
    }
    reader.onerror = () => setSubmitError('Could not read the selected shader file.')
    reader.readAsText(file)
  }

  const submitJob = async () => {
    if (!activeRoom) return
    setSubmitError(null)

    try {
      if (selectedWorkers.size === 0) {
        throw new Error('Select at least one worker.')
      }

      const name = jobName.trim() || 'job'
      const connectedWorkerIds = new Set(activeRoom.workers.map((worker) => worker.id))
      const workerIds = [...selectedWorkers].filter((workerId) =>
        connectedWorkerIds.has(workerId),
      )
      if (workerIds.length === 0) {
        throw new Error('Selected workers are no longer connected. Select an active worker.')
      }

      let requestBody: object
      let artifact: Artifact
      if (jobType === 'wgpu') {
        const width = Number(renderWidth)
        const height = Number(renderHeight)
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
          throw new Error('Render width and height must be positive integers.')
        }
        artifact = {
          entry_point: 'main',
          kind: 'shader_compute',
          files: [{
            name: shaderFileName ?? 'shader.wgsl',
            content: bytesToBase64(new TextEncoder().encode(shaderSource ?? SHADER_TEMPLATE)),
            mime: 'text/wgsl',
          }],
        }
        requestBody = {
          name,
          artifact,
          tasks: workerIds.map((workerId) => ({ worker_id: workerId })),
          metadata: { type: 'wgsl', width, height },
        }
      } else {
        let input: unknown
        try {
          input = JSON.parse(inputText)
        } catch {
          throw new Error('Input must be valid JSON, e.g. [1, 2].')
        }
        if (!Array.isArray(input)) {
          throw new Error('Input must be a JSON array of arguments.')
        }

        const content = source === 'sample' ? sampleArtifact().files[0].content : wasmBase64
        if (!content) {
          throw new Error('Choose a wasm module or use the sample.')
        }
        artifact = {
          entry_point: entryPoint.trim() || 'add',
          files: [{ name: 'main.wasm', content, mime: 'application/wasm' }],
          kind: 'wasm',
        }
        requestBody = {
          name,
          artifact,
          tasks: workerIds.map((workerId) => ({ worker_id: workerId, input })),
          metadata: {},
        }
      }

      setSubmitting(true)
      const submitPath = `/room/${encodeURIComponent(activeRoom.id)}/job/submit`
      const response = await fetch(
        `${COORDINATOR_URL}${submitPath}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeRoom.clientToken}`,
          },
          body: JSON.stringify(requestBody),
        },
      )

      const body = (await response.json().catch(() => null)) as {
        job_id?: string
        error?: string
      } | null
      if (!response.ok) {
        throw new Error(body?.error ?? `Submit failed (${response.status}).`)
      }
      const jobId = body?.job_id
      if (!jobId) {
        throw new Error('Coordinator returned an invalid response.')
      }

      setJobs((current) =>
        addJobIfMissing(current, {
          id: jobId,
          room_id: activeRoom.id,
          name,
          artifact,
          status: 'created',
          created_at: 0,
          started_at: null,
          finished_at: null,
        }),
      )
      setSelectedWorkers(new Set())
      setStatus(`Job ${jobId} submitted.`)
    } catch (submitFailure) {
      setSubmitError(
        submitFailure instanceof Error ? submitFailure.message : 'Unable to submit job.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHeader title="Client" description="Create a room and monitor connected workers.">
          <button
            type="button"
            onClick={createRoom}
            disabled={isCreating}
            className="btn btn-primary"
          >
            {isCreating ? 'Creating...' : 'Create room'}
          </button>
          <button type="button" onClick={onBack} className="btn btn-secondary">
            Back
          </button>
        </PageHeader>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Rooms</h2>
              <span className="text-xs text-neutral-500">{rooms.length}</span>
            </div>

            {rooms.length === 0 ? (
              <p className="text-sm text-neutral-500">No rooms yet. Create one to get started.</p>
            ) : (
              <ul className="space-y-2">
                {rooms.map((room) => {
                  const isActive = activeRoom?.id === room.id
                  return (
                    <li key={room.id}>
                      <button
                        type="button"
                        onClick={() => setActiveRoomId(room.id)}
                        className={`w-full rounded-md border p-2.5 text-left transition ${
                          isActive
                            ? 'border-neutral-900 bg-neutral-900 text-white'
                            : 'border-neutral-200 bg-white hover:border-neutral-300'
                        }`}
                      >
                        <span
                          className={`mono block truncate ${isActive ? 'text-white' : 'text-neutral-900'}`}
                        >
                          {room.id}
                        </span>
                        <span
                          className={`mt-1 block text-xs ${isActive ? 'text-neutral-300' : 'text-neutral-500'}`}
                        >
                          {room.workers.length} workers
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>

          <section className="card p-5">
            {activeRoom ? (
              <>
                <h2 className="text-sm font-semibold">Active room</h2>
                <div className="mt-2 divide-y divide-neutral-100 border-t border-neutral-200">
                  <TokenRow label="Room ID" value={activeRoom.id} />
                  <TokenRow label="Worker token" value={activeRoom.workerToken} />
                  <TokenRow label="Client token" value={activeRoom.clientToken} />
                </div>

                {status ? <p className="mt-4 text-sm text-neutral-500">{status}</p> : null}
                {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}

                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Workers</h3>
                    <span className="text-xs text-neutral-500">{activeRoom.workers.length}</span>
                  </div>

                  {activeRoom.workers.length === 0 ? (
                    <p className="rounded-md border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
                      No workers have joined this room yet.
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {activeRoom.workers.map((worker) => (
                        <WorkerCard key={worker.id} worker={worker} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <p className="py-10 text-center text-sm text-neutral-500">
                Create a room to begin.
              </p>
            )}
          </section>
        </div>

        {activeRoom ? (
          <section className="card mt-6 p-5">
            <h2 className="text-sm font-semibold">Submit job</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <span className="label">Task type</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setJobType('wasm')}
                    className={`btn ${jobType === 'wasm' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    WASM
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobType('wgpu')}
                    className={`btn ${jobType === 'wgpu' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    WGSL / WebGPU
                  </button>
                </div>
              </div>
              <div>
                <label className="label" htmlFor="job-name">
                  Job name
                </label>
                <input
                  id="job-name"
                  className="input"
                  value={jobName}
                  onChange={(event) => setJobName(event.target.value)}
                  placeholder="add"
                />
              </div>
              {jobType === 'wasm' ? <div>
                <label className="label" htmlFor="entry-point">
                  Entry point
                </label>
                <input
                  id="entry-point"
                  className="input"
                  value={entryPoint}
                  onChange={(event) => setEntryPoint(event.target.value)}
                  placeholder="add"
                />
              </div> : null}
            </div>

            {jobType === 'wgpu' ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="render-width">Render width</label>
                  <input id="render-width" className="input" type="number" min="1"
                    value={renderWidth} onChange={(event) => setRenderWidth(event.target.value)} />
                </div>
                <div>
                  <label className="label" htmlFor="render-height">Render height</label>
                  <input id="render-height" className="input" type="number" min="1"
                    value={renderHeight} onChange={(event) => setRenderHeight(event.target.value)} />
                </div>
              </div>
            ) : null}

            {jobType === 'wgpu' ? (
              <div className="mt-4">
                <span className="label">WGSL shader</span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="file"
                    accept=".wgsl,text/plain"
                    onChange={onShaderSelected}
                    className="text-neutral-600"
                  />
                  <button
                    type="button"
                    onClick={downloadShaderTemplate}
                    className="btn btn-secondary"
                  >
                    Download shade template
                  </button>
                  {shaderFileName ? (
                    <span className="text-xs text-neutral-900">{shaderFileName} · loaded</span>
                  ) : (
                    <span className="text-xs text-neutral-500">
                      Built-in template is used when no file is selected.
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  Upload a WGSL file containing only <code>shade(gid, out_idx)</code>.
                </p>
              </div>
            ) : null}

            {jobType === 'wasm' ? (
              <div className="mt-4">
                <span className="label">Wasm module</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSource('sample')}
                    className={`btn ${source === 'sample' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    Sample
                  </button>
                  <button
                    type="button"
                    onClick={() => setSource('upload')}
                    className={`btn ${source === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
                  >
                    Upload .wasm
                  </button>
                  {source === 'upload' ? (
                    <span className="flex items-center gap-2 text-sm">
                      <input
                        type="file"
                        accept=".wasm,application/wasm"
                        onChange={onFileSelected}
                        className="text-neutral-600"
                      />
                      {fileName ? (
                        <span className="text-neutral-900">{fileName} · loaded</span>
                      ) : (
                        <span className="text-neutral-500">No file selected</span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-500">Built-in add(i32, i32)</span>
                  )}
                </div>
              </div>
            ) : null}

            {jobType === 'wasm' ? (
              <div className="mt-4">
                <label className="label" htmlFor="job-input">
                  Input (JSON array of arguments)
                </label>
                <input
                  id="job-input"
                  className="input mono"
                  value={inputText}
                  onChange={(event) => setInputText(event.target.value)}
                  placeholder="[1, 2]"
                />
              </div>
            ) : null}

            <div className="mt-4">
              <span className="label">Workers</span>
              {activeRoom.workers.length === 0 ? (
                <p className="text-sm text-neutral-500">No workers connected.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {activeRoom.workers.map((worker) => (
                    <label
                      key={worker.id}
                      className="flex items-center gap-2 rounded-md border border-neutral-200 px-2.5 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedWorkers.has(worker.id)}
                        onChange={() => toggleWorker(worker.id)}
                        className="h-4 w-4 rounded border-neutral-300"
                      />
                      <span className="mono">{worker.id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={submitJob}
              disabled={submitting || selectedWorkers.size === 0}
              className="btn btn-primary mt-5"
            >
              {submitting ? 'Submitting...' : 'Submit job'}
            </button>
            {submitError ? <p className="mt-3 text-sm text-red-600">{submitError}</p> : null}
          </section>
        ) : null}

        {renderedFrame ? (
          <section className="card mt-6 overflow-hidden p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Rendered image</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  {renderedFrame.width} × {renderedFrame.height} · saved as {renderedFrame.jobId}-render.png
                </p>
              </div>
              <a
                className="btn btn-secondary"
                href={renderedFrame.url}
                download={`${renderedFrame.jobId}-render.png`}
              >
                Download PNG
              </a>
            </div>
            <div className="mt-4 max-h-[70vh] overflow-auto rounded-md border border-neutral-200 bg-neutral-900 p-2">
              <img
                src={renderedFrame.url}
                alt="Distributed WebGPU render"
                className="mx-auto block h-auto max-w-full"
              />
            </div>
          </section>
        ) : null}
        {renderError ? <p className="mt-3 text-sm text-red-600">{renderError}</p> : null}

        <section className="card mt-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Jobs</h2>
            <span className="text-xs text-neutral-500">{jobs.length}</span>
          </div>

          {jobs.length === 0 ? (
            <p className="text-sm text-neutral-500">No jobs submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((record) => (
                <JobCard key={record.job.id} record={record} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default ClientPage
