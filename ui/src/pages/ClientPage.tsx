import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import { CapabilityList } from '../components/CapabilityList'
import { CopyButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { COORDINATOR_URL, coordinatorWsUrl, parseMessage } from '../coordinator'
import {
  CUSTOM_EXAMPLE_ID,
  EXAMPLES,
  defaultValueMap,
  findExample,
  loadExampleArtifact,
  loadSource,
  type WorkloadExample,
} from '../lib/examples'
import {
  addJobIfMissing,
  getLatestJob,
  upsertJob,
  upsertTask,
  type JobRecord,
} from '../lib/jobs'
import { sampleArtifact } from '../lib/sample'
import {
  downloadImageProcessingShaderTemplate,
  downloadShaderTemplate,
  IMAGE_PROCESSING_SHADER_TEMPLATE,
  SHADER_TEMPLATE,
} from '../lib/shaderTemplate'
import { jobStatusTone, statusTone, taskStatusTone } from '../lib/status'
import {
  buildTaskInputs,
  combineResults,
  formatResult,
  validateValues,
} from '../lib/workloads'
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
  bytes: Uint8Array,
): Promise<RenderedFrame> {
  if (bytes.length !== width * height * 4) {
    throw new Error('Coordinator returned an invalid image buffer.')
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to create a 2D canvas context.')
  context.putImageData(
    new ImageData(new Uint8ClampedArray(bytes), width, height),
    0,
    0,
  )
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error('Unable to encode the rendered image as PNG.')),
      'image/png',
    )
  })
  return { jobId, url: URL.createObjectURL(blob), width, height }
}

async function composeImageFromTasks(
  jobId: string,
  tasks: JobRecord['tasks'],
): Promise<RenderedFrame> {
  const first = tasks[0]
  if (!first || typeof first.input !== 'object' || first.input === null) {
    throw new Error('Shader task has invalid input.')
  }
  const resolution = (first.input as { global_resolution?: unknown })
    .global_resolution
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
    if (
      typeof task.input !== 'object' ||
      task.input === null ||
      typeof task.result !== 'object' ||
      task.result === null
    ) {
      throw new Error('Shader task has invalid result data.')
    }
    const tile = task.input as { offset?: unknown; size?: unknown }
    const result = task.result as { pixels_base64?: unknown }
    if (
      !Array.isArray(tile.offset) ||
      !Array.isArray(tile.size) ||
      tile.offset.length !== 2 ||
      tile.size.length !== 2 ||
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
  return composeImage(jobId, width, height, pixels)
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
        <div className="text-sm text-tx-secondary">{label}</div>
        <code className="mono mt-0.5 block break-all text-tx-primary">
          {value}
        </code>
      </div>
      <CopyButton value={value} />
    </div>
  )
}

const WorkerCard = memo(function WorkerCard({ worker }: { worker: Worker }) {
  return (
    <div className="subcard">
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate text-tx-primary">{worker.id}</span>
        <StatusBadge tone={statusTone(worker.status)}>
          {worker.status}
        </StatusBadge>
      </div>
      <CapabilityList capabilities={worker.capabilities} />
    </div>
  )
})

const JobCard = memo(function JobCard({
  record,
  showHeader = true,
}: {
  record: JobRecord
  showHeader?: boolean
}) {
  const isWgpu = record.job.artifact.kind === 'shader_compute'
  const showTaskStatus = record.tasks.length > 1
  return (
    <div className="subcard">
      {showHeader ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-tx-primary">
            {record.job.name}
          </span>
          <StatusBadge tone={jobStatusTone(record.job.status)}>
            {record.job.status}
          </StatusBadge>
        </div>
      ) : null}
      <div className="mono mt-1 text-xs text-tx-muted">{record.job.id}</div>

      <div className="mt-3 space-y-2">
        {record.tasks.length === 0 ? (
          <p className="text-sm text-tx-muted">Waiting for tasks...</p>
        ) : (
          record.tasks.map((task) => (
            <div key={task.id} className="tile text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="mono truncate text-tx-secondary">
                  {task.worker_id ?? 'unassigned'}
                </span>
                {showTaskStatus ? (
                  <StatusBadge tone={taskStatusTone(task.status)}>
                    {task.status}
                  </StatusBadge>
                ) : null}
              </div>
              <div className="mt-1 break-words text-tx-primary">
                {task.error
                  ? `Error: ${task.error}`
                  : isWgpu
                    ? task.status === 'completed'
                      ? 'GPU tile processed'
                      : `Tile ${task.status}`
                    : `Result: ${task.result === undefined ? 'pending' : JSON.stringify(task.result)}`}
                {task.execution_time_ms != null
                  ? ` · ${task.execution_time_ms} ms`
                  : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
})

const JobHistoryItem = memo(function JobHistoryItem({
  record,
}: {
  record: JobRecord
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-sm border border-border-strong bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:border-accent"
      >
        <span className="mono truncate text-tx-primary">{record.job.name}</span>
        <StatusBadge tone={jobStatusTone(record.job.status)}>
          {record.job.status}
        </StatusBadge>
      </button>
      {open ? (
        <div className="border-t border-border p-3">
          <JobCard record={record} showHeader={false} />
        </div>
      ) : null}
    </div>
  )
})

type RunContext = {
  example: WorkloadExample
  values: Record<string, number>
  split: boolean
}

function SourceViewer({ url }: { url: string }) {
  const [source, setSource] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadSource(url)
      .then((text) => {
        if (!cancelled) setSource(text)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : 'Unable to load source.',
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [url])

  if (error) {
    return <p className="text-sm text-danger">{error}</p>
  }
  if (source === null) {
    return <p className="text-sm text-tx-muted">Loading source...</p>
  }
  return (
    <pre className="mono max-h-80 overflow-auto rounded-sm border border-border bg-panel p-3 text-xs text-tx-primary">
      <code>{source}</code>
    </pre>
  )
}

type RunResult = {
  jobId: string
  context: RunContext
  record: JobRecord
  combined: number | null
}

function RunResultCard({ run }: { run: RunResult }) {
  return (
    <div className="subcard">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-tx-primary">
          {run.context.example.title}
        </span>
        <span className="text-xs text-tx-muted">
          {run.context.split
            ? `${run.record.tasks.length} workers`
            : 'single worker'}
        </span>
      </div>
      <div className="mono mt-1 text-2xl font-semibold text-tx-primary">
        {formatResult(run.combined, run.context.example.resultType)}
      </div>
      <div className="mt-2 space-y-1 text-xs text-tx-secondary">
        {run.record.tasks.map((task) => (
          <div
            key={task.id}
            className="flex items-center justify-between gap-2"
          >
            <span className="mono truncate">
              {task.worker_id ?? 'unassigned'}
            </span>
            <span
              className={task.status === 'failed' ? 'text-danger' : undefined}
            >
              {task.status === 'failed'
                ? `Error: ${task.error ?? 'failed'}`
                : formatResult(
                    typeof task.result === 'number'
                      ? task.result
                      : Number(task.result),
                    run.context.example.resultType,
                  )}
              {task.execution_time_ms != null
                ? ` · ${task.execution_time_ms} ms`
                : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ClientPage({ onBack }: { onBack: () => void }) {
  const socketByRoom = useRef<Record<string, WebSocket>>({})
  const [initialRooms] = useState<StoredRoom[]>(() => loadClientRooms())
  const [rooms, setRooms] = useState<StoredRoom[]>(initialRooms)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() =>
    loadActiveRoomId(),
  )
  const [isCreating, setIsCreating] = useState(false)
  const [status, setStatus] = useState(() =>
    initialRooms.length > 0
      ? `Restored ${initialRooms.length} room(s). Reconnecting...`
      : 'No room created yet.',
  )
  const [error, setError] = useState<string | null>(null)

  const [passwordless, setPasswordless] = useState(false)

  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [jobName, setJobName] = useState(EXAMPLES[0].title)
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id)
  const [exampleValues, setExampleValues] = useState<Record<string, number>>(
    () => defaultValueMap(EXAMPLES[0]),
  )
  const [runMode, setRunMode] = useState<'single' | 'split'>('single')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [runContexts, setRunContexts] = useState<Record<string, RunContext>>({})
  const [entryPoint, setEntryPoint] = useState('add')
  const [source, setSource] = useState<'sample' | 'upload'>('sample')
  const [wasmBase64, setWasmBase64] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [inputText, setInputText] = useState('[1, 2]')
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set())
  const [jobType, setJobType] = useState<'wasm' | 'wgpu'>('wasm')
  const [wgpuMode, setWgpuMode] = useState<'fragment' | 'image_processing'>(
    'fragment',
  )
  const [renderWidth, setRenderWidth] = useState('800')
  const [renderHeight, setRenderHeight] = useState('600')
  const [shaderSource, setShaderSource] = useState<string | null>(null)
  const [shaderFileName, setShaderFileName] = useState<string | null>(null)
  const [inputImageBase64, setInputImageBase64] = useState<string | null>(null)
  const [inputImageFileName, setInputImageFileName] = useState<string | null>(
    null,
  )
  const [inputImageMime, setInputImageMime] = useState<string | null>(null)
  const [imageShaderSource, setImageShaderSource] = useState<string | null>(
    null,
  )
  const [imageShaderFileName, setImageShaderFileName] = useState<string | null>(
    null,
  )
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
    socket.onerror = () =>
      setError(`WebSocket connection for room ${room.id} failed.`)
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
              ? {
                  ...item,
                  workers: item.workers.filter((w) => w.id !== workerId),
                }
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
        item.tasks.every((task) => task.status === 'completed'),
    )
    if (!record || record.job.id === renderedFrame?.jobId) {
      return () => {
        cancelled = true
      }
    }
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
    return () => {
      cancelled = true
    }
  }, [jobs, renderedFrame?.jobId])

  const createRoom = async () => {
    setIsCreating(true)
    setError(null)
    setStatus('Creating room...')

    try {
      const response = await fetch(`${COORDINATOR_URL}/create_room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwordless }),
      })
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
        current.some((room) => room.id === roomId)
          ? current
          : [nextRoom, ...current],
      )
      setActiveRoomId(roomId)
      connectClientSocket(nextRoom)
      setStatus(`Room ${roomId} created successfully.`)
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Unable to create room.'
      setError(message)
      setStatus(message)
    } finally {
      setIsCreating(false)
    }
  }

  const onExampleChange = (value: string) => {
    setExampleId(value)
    setSubmitError(null)
    setSourceOpen(false)
    const next = findExample(value)
    if (next) {
      setExampleValues(defaultValueMap(next))
      setJobName(next.title)
      setRunMode('single')
    } else {
      setJobName('custom')
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
    if (!file.name.toLowerCase().endsWith('.wgsl')) {
      setSubmitError('Choose a .wgsl shader file.')
      return
    }
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
    reader.onerror = () =>
      setSubmitError('Could not read the selected shader file.')
    reader.readAsText(file)
  }

  const onImageSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const supportedExtension = /\.(png|jpe?g|webp)$/i.test(file.name)
    const supportedMime = ['image/png', 'image/jpeg', 'image/webp'].includes(
      file.type,
    )
    if (!supportedExtension && !supportedMime) {
      setSubmitError('Choose a PNG, JPEG, or WebP image.')
      return
    }
    if (file.size === 0) {
      setSubmitError('The selected image is empty.')
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : null
      const base64 = url?.slice(url.indexOf(',') + 1)
      if (!base64) {
        setSubmitError('Could not read the selected image.')
        return
      }
      setInputImageBase64(base64)
      setInputImageFileName(file.name)
      setInputImageMime(file.type || null)
      setSubmitError(null)
    }
    reader.onerror = () => setSubmitError('Could not read the selected image.')
    reader.readAsDataURL(file)
  }

  const onImageShaderSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.wgsl')) {
      setSubmitError('Choose a .wgsl shader file.')
      return
    }
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
      setImageShaderSource(source)
      setImageShaderFileName(file.name)
      setSubmitError(null)
    }
    reader.onerror = () =>
      setSubmitError('Could not read the selected shader file.')
    reader.readAsText(file)
  }

  const submitJob = async () => {
    if (!activeRoom) return
    setSubmitError(null)

    try {
      const name = jobName.trim() || 'job'
      const connectedWorkerIds = new Set(
        activeRoom.workers.map((worker) => worker.id),
      )
      const selected = [...selectedWorkers].filter((workerId) =>
        connectedWorkerIds.has(workerId),
      )
      const allConnected = [...connectedWorkerIds]

      let requestBody: object
      let artifact: Artifact
      let runContext: RunContext | null = null

      if (jobType === 'wgpu') {
        if (selected.length === 0) {
          throw new Error('Select at least one worker.')
        }
        if (wgpuMode === 'fragment') {
          const width = Number(renderWidth)
          const height = Number(renderHeight)
          if (
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 1 ||
            height < 1
          ) {
            throw new Error(
              'Render width and height must be positive integers.',
            )
          }
          artifact = {
            entry_point: 'main',
            kind: 'shader_compute',
            files: [
              {
                name: shaderFileName ?? 'shader.wgsl',
                content: bytesToBase64(
                  new TextEncoder().encode(shaderSource ?? SHADER_TEMPLATE),
                ),
                mime: 'text/wgsl',
              },
            ],
          }
          requestBody = {
            name,
            artifact,
            tasks: selected.map((workerId) => ({ worker_id: workerId })),
            metadata: { type: 'wgsl', width, height },
          }
        } else {
          if (!inputImageBase64 || !inputImageFileName) {
            throw new Error('Choose an input image to process.')
          }
          artifact = {
            entry_point: 'main',
            kind: 'shader_compute',
            files: [
              {
                name: imageShaderFileName ?? 'image-processing.wgsl',
                content: bytesToBase64(
                  new TextEncoder().encode(
                    imageShaderSource ?? IMAGE_PROCESSING_SHADER_TEMPLATE,
                  ),
                ),
                mime: 'text/wgsl',
              },
              {
                name: inputImageFileName,
                content: inputImageBase64,
                mime: inputImageMime,
              },
            ],
          }
          requestBody = {
            name,
            artifact,
            tasks: selected.map((workerId) => ({ worker_id: workerId })),
            metadata: { type: 'image_processing' },
          }
        }
      } else if (exampleId === CUSTOM_EXAMPLE_ID) {
        const workerIds =
          selected.length > 0 ? selected.slice(0, 1) : allConnected.slice(0, 1)
        if (workerIds.length === 0) {
          throw new Error('Connect a worker first.')
        }
        let input: unknown
        try {
          input = JSON.parse(inputText)
        } catch {
          throw new Error('Input must be valid JSON, e.g. [1, 2].')
        }
        if (!Array.isArray(input)) {
          throw new Error('Input must be a JSON array of arguments.')
        }

        const content =
          source === 'sample' ? sampleArtifact().files[0].content : wasmBase64
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
      } else {
        const example = findExample(exampleId)
        if (!example) {
          throw new Error('Choose a workload.')
        }
        const valueError = validateValues(example, exampleValues)
        if (valueError) {
          throw new Error(valueError)
        }
        const useSplit = runMode === 'split' && example.split !== undefined
        const workerIds = useSplit
          ? selected.length > 0
            ? selected
            : allConnected
          : selected.length > 0
            ? selected.slice(0, 1)
            : allConnected.slice(0, 1)
        if (workerIds.length === 0) {
          throw new Error('Connect a worker first.')
        }
        const inputs = buildTaskInputs(
          example,
          exampleValues,
          useSplit ? workerIds.length : 1,
        )
        artifact = await loadExampleArtifact(example)
        requestBody = {
          name,
          artifact,
          tasks: workerIds.map((workerId, index) => ({
            worker_id: workerId,
            input: inputs[index] ?? inputs[0],
          })),
          metadata: {},
        }
        runContext = {
          example,
          values: { ...exampleValues },
          split: useSplit,
        }
      }

      setSubmitting(true)
      const submitPath = `/room/${encodeURIComponent(activeRoom.id)}/job/submit`
      const response = await fetch(`${COORDINATOR_URL}${submitPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeRoom.clientToken}`,
        },
        body: JSON.stringify(requestBody),
      })

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
      if (runContext) {
        const context = runContext
        setRunContexts((current) => ({ ...current, [jobId]: context }))
      }
      setSelectedWorkers(new Set())
      setStatus(`Job ${jobId} submitted.`)
    } catch (submitFailure) {
      setSubmitError(
        submitFailure instanceof Error
          ? submitFailure.message
          : 'Unable to submit job.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const activeRoom =
    rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null
  const example =
    exampleId === CUSTOM_EXAMPLE_ID ? null : (findExample(exampleId) ?? null)

  const latestJob = getLatestJob(jobs)
  const runResults: RunResult[] = jobs.flatMap((record) => {
    const context = runContexts[record.job.id]
    if (!context) return []
    if (record.tasks.length === 0) return []
    const finished = record.tasks.every(
      (task) => task.status === 'completed' || task.status === 'failed',
    )
    if (!finished) return []
    const results = record.tasks
      .filter((task) => task.status === 'completed')
      .map((task) =>
        typeof task.result === 'number' ? task.result : Number(task.result),
      )
      .filter((value) => Number.isFinite(value))
    return [
      {
        jobId: record.job.id,
        context,
        record,
        combined: combineResults(context.example, results),
      },
    ]
  })

  return (
    <main className="min-h-screen bg-base text-tx-primary">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHeader
          title="Client"
          description="Create a room and monitor connected workers."
        >
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

        <section className="card p-5">
          <h2 className="section-title">New room</h2>
          <div className="mt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                id="room-passwordless"
                type="checkbox"
                checked={passwordless}
                onChange={(event) => setPasswordless(event.target.checked)}
                className="h-4 w-4 rounded-sm border-border-strong accent-accent"
              />
              <span>Passwordless room</span>
            </label>
            <p className="mt-2 text-sm text-tx-muted">
              Create a passwordless room. Workers join without a room token.
            </p>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="section-title">Rooms</h2>
              <span className="text-xs text-tx-muted">{rooms.length}</span>
            </div>

            {rooms.length === 0 ? (
              <p className="text-sm text-tx-muted">
                No rooms yet. Create one to get started.
              </p>
            ) : (
              <ul className="space-y-2">
                {rooms.map((room) => {
                  const isActive = activeRoom?.id === room.id
                  return (
                    <li key={room.id}>
                      <button
                        type="button"
                        onClick={() => setActiveRoomId(room.id)}
                        className={`w-full rounded-sm border p-2.5 text-left transition ${
                          isActive
                            ? 'border-accent bg-accent text-panel'
                            : 'border-border-strong bg-panel hover:border-accent hover:bg-surface'
                        }`}
                      >
                        <span
                          className={`mono block truncate ${isActive ? 'text-panel' : 'text-tx-primary'}`}
                        >
                          {room.id}
                        </span>
                        <span
                          className={`mt-1 block text-xs ${isActive ? 'text-panel/80' : 'text-tx-muted'}`}
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
                <h2 className="section-title">Active room</h2>
                <div className="mt-2 divide-y divide-border border-t border-border">
                  <TokenRow label="Room ID" value={activeRoom.id} />
                  <TokenRow
                    label="Worker token"
                    value={activeRoom.workerToken}
                  />
                  <TokenRow
                    label="Client token"
                    value={activeRoom.clientToken}
                  />
                </div>

                {status ? (
                  <p className="mt-4 text-sm text-tx-muted">{status}</p>
                ) : null}
                {error ? (
                  <p className="mt-2 text-sm text-danger">{error}</p>
                ) : null}

                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="section-title">Workers</h3>
                    <span className="text-xs text-tx-muted">
                      {activeRoom.workers.length}
                    </span>
                  </div>

                  {activeRoom.workers.length === 0 ? (
                    <p className="rounded-sm border border-dashed border-border p-4 text-sm text-tx-muted">
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
              <p className="py-10 text-center text-sm text-tx-muted">
                Create a room to begin.
              </p>
            )}
          </section>
        </div>

        {activeRoom ? (
          <section className="card mt-6 p-5">
            <h2 className="section-title">Run a job</h2>
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
              {jobType === 'wgpu' ? (
                <div>
                  <label className="label" htmlFor="wgpu-mode">
                    WGSL mode
                  </label>
                  <select
                    id="wgpu-mode"
                    className="input"
                    value={wgpuMode}
                    onChange={(event) =>
                      setWgpuMode(
                        event.target.value === 'image_processing'
                          ? 'image_processing'
                          : 'fragment',
                      )
                    }
                  >
                    <option value="fragment">WGSL fragment shader</option>
                    <option value="image_processing">Image processing</option>
                  </select>
                </div>
              ) : null}
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
            </div>

            {jobType === 'wgpu' && wgpuMode === 'fragment' ? (
              <>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="render-width">
                      Render width
                    </label>
                    <input
                      id="render-width"
                      className="input"
                      type="number"
                      min="1"
                      value={renderWidth}
                      onChange={(event) => setRenderWidth(event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="render-height">
                      Render height
                    </label>
                    <input
                      id="render-height"
                      className="input"
                      type="number"
                      min="1"
                      value={renderHeight}
                      onChange={(event) => setRenderHeight(event.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <span className="label">WGSL shader</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      accept=".wgsl,text/plain"
                      onChange={onShaderSelected}
                      className="file-input"
                    />
                    <button
                      type="button"
                      onClick={downloadShaderTemplate}
                      className="btn btn-secondary"
                    >
                      Download fragment shader template
                    </button>
                    {shaderFileName ? (
                      <span className="text-xs text-tx-primary">
                        {shaderFileName} · loaded
                      </span>
                    ) : (
                      <span className="text-xs text-tx-muted">
                        Built-in template is used when no file is selected.
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-tx-muted">
                    Upload a WGSL file containing only{' '}
                    <code>shade(gid, out_idx)</code>.
                  </p>
                </div>
              </>
            ) : jobType === 'wgpu' && wgpuMode === 'image_processing' ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="input-image">
                    Input image
                  </label>
                  <input
                    id="input-image"
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    onChange={onImageSelected}
                    className="file-input"
                  />
                  <p className="mt-2 text-xs text-tx-muted">
                    {inputImageFileName
                      ? `${inputImageFileName} · loaded`
                      : 'Choose a PNG, JPEG, or WebP image.'}
                  </p>
                </div>
                <div>
                  <label className="label" htmlFor="image-processing-shader">
                    Image-processing WGSL shader
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="image-processing-shader"
                      type="file"
                      accept=".wgsl,text/plain"
                      onChange={onImageShaderSelected}
                      className="file-input"
                    />
                    <button
                      type="button"
                      onClick={downloadImageProcessingShaderTemplate}
                      className="btn btn-secondary"
                    >
                      Download image shader template
                    </button>
                    {imageShaderFileName ? (
                      <span className="text-xs text-tx-primary">
                        {imageShaderFileName} · loaded
                      </span>
                    ) : (
                      <span className="text-xs text-tx-muted">
                        Default grayscale shader is used when no file is
                        selected.
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-tx-muted">
                    Define <code>process_pixel(gid, input_pixel, out_idx)</code>{' '}
                    and write the output with <code>write_pixel</code>.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <label className="label" htmlFor="workload">
                    Workload
                  </label>
                  <select
                    id="workload"
                    className="input [&>option]:bg-surface [&>option]:text-tx-primary"
                    value={exampleId}
                    onChange={(event) => onExampleChange(event.target.value)}
                  >
                    {EXAMPLES.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}: {item.language.toUpperCase()}
                      </option>
                    ))}
                    <option value={CUSTOM_EXAMPLE_ID}>
                      Custom .wasm module...
                    </option>
                  </select>
                  {example ? (
                    <p className="mt-1 text-xs text-tx-muted">
                      {example.description}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-tx-muted">
                      Upload a precompiled, import-free wasm module and pass a
                      JSON array of positional arguments.
                    </p>
                  )}
                </div>

                {example ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {example.args.map((arg) => (
                        <div key={arg.key}>
                          <label className="label" htmlFor={`arg-${arg.key}`}>
                            {arg.label}
                          </label>
                          <input
                            id={`arg-${arg.key}`}
                            className="input mono"
                            type="number"
                            inputMode={
                              arg.type === 'f64' ? 'decimal' : 'numeric'
                            }
                            min={arg.min}
                            max={arg.max}
                            step={arg.step ?? (arg.type === 'f64' ? 'any' : 1)}
                            value={
                              Number.isFinite(exampleValues[arg.key])
                                ? exampleValues[arg.key]
                                : arg.default
                            }
                            onChange={(event) =>
                              setExampleValues((current) => ({
                                ...current,
                                [arg.key]: event.target.valueAsNumber,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>

                    <div>
                      <span className="label">Parallelism</span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setRunMode('single')}
                          className={`btn ${runMode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          Single worker
                        </button>
                        <button
                          type="button"
                          disabled={!example.split}
                          onClick={() => setRunMode('split')}
                          className={`btn ${runMode === 'split' ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          Split across workers
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-tx-muted">
                        {example.split
                          ? 'Split mode partitions the input across all connected workers (or the selected ones) and combines the results.'
                          : 'This workload runs on a single worker.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSourceOpen((value) => !value)}
                        className="btn btn-secondary"
                      >
                        {sourceOpen ? 'Hide source' : 'View source'}
                      </button>
                      <span className="text-xs text-tx-muted">
                        {example.language === 'rust' ? 'Rust' : 'C'} ·{' '}
                        {example.entryPoint}
                      </span>
                    </div>
                    {sourceOpen ? (
                      <SourceViewer
                        key={example.sourceUrl}
                        url={example.sourceUrl}
                      />
                    ) : null}
                  </>
                ) : (
                  <>
                    <div>
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
                    </div>
                    <div>
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
                    <div>
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
                              className="file-input"
                            />
                            {fileName ? (
                              <span className="text-tx-primary">
                                {fileName} · loaded
                              </span>
                            ) : (
                              <span className="text-tx-muted">
                                No file selected
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-tx-muted">
                            Built-in add(i32, i32)
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}

                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((value) => !value)}
                    className="text-xs text-tx-muted underline"
                  >
                    {showAdvanced
                      ? 'Hide advanced worker selection'
                      : 'Advanced worker selection'}
                  </button>
                </div>
              </div>
            )}

            {jobType === 'wgpu' ||
            showAdvanced ||
            exampleId === CUSTOM_EXAMPLE_ID ? (
              <div className="mt-4">
                <span className="label">
                  Workers
                  {jobType === 'wasm' && !showAdvanced ? ' (optional)' : ''}
                </span>
                {activeRoom.workers.length === 0 ? (
                  <p className="text-sm text-tx-muted">No workers connected.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {activeRoom.workers.map((worker) => (
                      <label
                        key={worker.id}
                        className="flex items-center gap-2 rounded-sm border border-border-strong px-2.5 py-1.5 text-sm hover:border-accent hover:bg-surface"
                      >
                        <input
                          type="checkbox"
                          checked={selectedWorkers.has(worker.id)}
                          onChange={() => toggleWorker(worker.id)}
                          className="h-4 w-4 rounded-sm border-border-strong accent-accent"
                        />
                        <span className="mono">{worker.id}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <button
              type="button"
              onClick={submitJob}
              disabled={
                submitting || (jobType === 'wgpu' && selectedWorkers.size === 0)
              }
              className="btn btn-primary mt-5"
            >
              {submitting
                ? 'Submitting...'
                : jobType === 'wasm' && example
                  ? 'Run function'
                  : 'Submit job'}
            </button>
            {submitError ? (
              <p className="mt-3 text-sm text-danger">{submitError}</p>
            ) : null}
          </section>
        ) : null}

        {runResults.length > 0 ? (
          <section className="card mt-6 p-5">
            <h2 className="section-title">Function results</h2>
            <div className="mt-3 space-y-3">
              {runResults.slice(0, 1).map((run) => (
                <RunResultCard key={run.jobId} run={run} />
              ))}
              {runResults.length > 1 ? (
                <div className="space-y-2">
                  {runResults.slice(1).map((run) => (
                    <details
                      key={run.jobId}
                      className="rounded-sm border border-border-strong bg-surface"
                    >
                      <summary className="cursor-pointer list-none rounded-sm border border-border-strong bg-surface px-3 py-2.5 text-sm text-tx-secondary hover:border-accent">
                        <span className="block truncate text-tx-primary">
                          {run.context.example.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-tx-muted">
                          Job {run.jobId}
                        </span>
                      </summary>
                      <div className="mt-2 border-t border-border p-3">
                        <RunResultCard run={run} />
                      </div>
                    </details>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {renderedFrame ? (
          <section className="card mt-6 overflow-hidden p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="section-title">Processed image</h2>
                <p className="mt-1 text-xs text-tx-muted">
                  {renderedFrame.width} × {renderedFrame.height} · saved as{' '}
                  {renderedFrame.jobId}-render.png
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
            <div className="mt-4 max-h-[70vh] overflow-auto rounded-sm border border-border bg-canvas p-2">
              <img
                src={renderedFrame.url}
                alt="Distributed WebGPU image output"
                className="mx-auto block h-auto max-w-full"
              />
            </div>
          </section>
        ) : null}
        {renderError ? (
          <p className="mt-3 text-sm text-danger">{renderError}</p>
        ) : null}

        <section className="card mt-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Jobs</h2>
            <span className="text-xs text-tx-muted">{jobs.length}</span>
          </div>

          {jobs.length === 0 ? (
            <p className="text-sm text-tx-muted">No jobs submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {latestJob ? <JobCard record={latestJob} /> : null}
              {jobs.length > 1 ? (
                <div className="space-y-2">
                  {jobs.slice(1).map((record) => (
                    <JobHistoryItem key={record.job.id} record={record} />
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default ClientPage
