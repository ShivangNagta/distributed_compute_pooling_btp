import { useEffect, useRef, useState } from 'react'
import { CapabilityList } from '../components/CapabilityList'
import { CopyButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { coordinatorWsUrl, parseMessage } from '../coordinator'
import { runTask } from '../lib/wasm'
import { statusTone, taskStatusTone } from '../lib/status'
import { loadWorkerRooms, saveWorkerRooms, type StoredJoinedRoom } from '../lib/storage'
import type { Artifact, Capabilities, TaskStatus } from '../types'

type WorkerActivity = {
  taskId: string
  jobId: string
  entryPoint: string
  fileName: string
  status: TaskStatus
  input: unknown
  result: unknown
  error: string | null
  executionTimeMs: number | null
}

async function getCapabilities(): Promise<Capabilities> {
  let gpuInfo: Capabilities['gpu'] = null

  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter?.info) {
        gpuInfo = {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
        }
      }
    } catch {
      gpuInfo = null
    }
  }

  return {
    cores: navigator.hardwareConcurrency || null,
    memory_gb: (navigator as { deviceMemory?: number }).deviceMemory || null,
    platform: navigator.platform || null,
    user_agent: navigator.userAgent || null,
    gpu: gpuInfo,
  }
}

async function handleWorkerMessage(
  socket: WebSocket,
  raw: unknown,
  artifacts: Map<string, Artifact>,
  onActivity: (activity: WorkerActivity) => void,
): Promise<void> {
  const message = parseMessage(raw)
  if (!message) return

  if (message.type === 'job_artifact') {
    artifacts.set(message.payload.job_id, message.payload.artifact)
    return
  }

  if (message.type === 'task_assign') {
    const task = message.payload
    const artifact = artifacts.get(task.job_id)

    const base: WorkerActivity = {
      taskId: task.id,
      jobId: task.job_id,
      entryPoint: artifact?.entry_point ?? '',
      fileName: artifact?.files[0]?.name ?? '',
      status: 'assigned',
      input: task.input,
      result: undefined,
      error: null,
      executionTimeMs: null,
    }

    onActivity(base)
    socket.send(JSON.stringify({ type: 'task_started', payload: { task_id: task.id } }))
    onActivity({ ...base, status: 'running' })

    try {
      if (!artifact) throw new Error('artifact not received yet')
      const outcome = await runTask(artifact, task)
      socket.send(
        JSON.stringify({
          type: 'task_result',
          payload: {
            task_id: task.id,
            result: outcome.result,
            execution_time_ms: outcome.execution_time_ms,
          },
        }),
      )
      onActivity({
        ...base,
        status: 'completed',
        result: outcome.result,
        executionTimeMs: outcome.execution_time_ms,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'execution failed'
      socket.send(
        JSON.stringify({ type: 'task_failed', payload: { task_id: task.id, error: reason } }),
      )
      onActivity({ ...base, status: 'failed', error: reason })
    }
  }
}

function JoinedRoomCard({ room }: { room: StoredJoinedRoom }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate text-neutral-900">{room.roomId}</span>
        <StatusBadge tone={statusTone(room.status)}>{room.status}</StatusBadge>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-600">Room token</span>
        <div className="flex min-w-0 items-center gap-2">
          <code className="mono truncate text-neutral-900">{room.roomToken}</code>
          <CopyButton value={room.roomToken} />
        </div>
      </div>

      <CapabilityList capabilities={room.capabilities} />
    </div>
  )
}

function ActivityCard({ activity }: { activity: WorkerActivity }) {
  return (
    <div className="rounded-md border border-neutral-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-900">
          Task {activity.taskId.slice(0, 8)}
        </span>
        <StatusBadge tone={taskStatusTone(activity.status)}>{activity.status}</StatusBadge>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Job</dt>
          <dd className="mono truncate text-neutral-900">{activity.jobId}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Module</dt>
          <dd className="mono truncate text-neutral-900">
            {activity.fileName || '—'} · {activity.entryPoint || '—'}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-neutral-500">Input</dt>
          <dd className="mono text-neutral-900">{JSON.stringify(activity.input)}</dd>
        </div>
        {activity.status === 'completed' && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-neutral-500">Result</dt>
            <dd className="mono text-neutral-900">{JSON.stringify(activity.result)}</dd>
          </div>
        )}
        {activity.error && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-neutral-500">Error</dt>
            <dd className="text-red-600">{activity.error}</dd>
          </div>
        )}
        {activity.executionTimeMs != null && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-neutral-500">Time</dt>
            <dd className="text-neutral-900">{activity.executionTimeMs} ms</dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function WorkerPage({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<WebSocket | null>(null)
  const artifactsRef = useRef<Map<string, Artifact>>(new Map())
  const [roomIdInput, setRoomIdInput] = useState('')
  const [roomTokenInput, setRoomTokenInput] = useState('')
  const [joinedRooms, setJoinedRooms] = useState<StoredJoinedRoom[]>(() => loadWorkerRooms())
  const [status, setStatus] = useState('Join a room to start contributing resources.')
  const [isJoining, setIsJoining] = useState(false)
  const [activities, setActivities] = useState<WorkerActivity[]>([])

  useEffect(() => {
    saveWorkerRooms(joinedRooms)
  }, [joinedRooms])

  const upsertRoom = (
    current: StoredJoinedRoom[],
    roomId: string,
    roomToken: string,
    nextStatus: StoredJoinedRoom['status'],
    capabilities: Capabilities | null,
  ) =>
    current.map((room) =>
      room.roomId === roomId && room.roomToken === roomToken
        ? { ...room, status: nextStatus, capabilities }
        : room,
    )

  const joinRoom = async () => {
    try {
      setIsJoining(true)
      setStatus('Validating room details...')

      const roomId = roomIdInput.trim()
      const roomToken = roomTokenInput.trim()

      if (!roomId || !roomToken) {
        throw new Error('Both room ID and room token are required.')
      }

      const socket = new WebSocket(
        coordinatorWsUrl(
          `/ws/join_room/${encodeURIComponent(roomId)}/${encodeURIComponent(roomToken)}`,
        ),
      )
      socketRef.current = socket

      socket.onopen = async () => {
        const capabilities = await getCapabilities()
        socket.send(JSON.stringify({ type: 'capabilities', payload: capabilities }))
        setJoinedRooms((current) =>
          upsertRoom(current, roomId, roomToken, 'connected', capabilities),
        )
        setStatus(`Connected to room ${roomId}. Your resources are now visible to the client.`)
      }

      socket.onmessage = (event) => {
        void handleWorkerMessage(socket, event.data, artifactsRef.current, (activity) => {
          setActivities((current) => [
            activity,
            ...current.filter((item) => item.taskId !== activity.taskId),
          ])
        })
      }

      socket.onerror = () => {
        setStatus('Could not connect to that room. Check the room ID and room token and try again.')
        setJoinedRooms((current) => upsertRoom(current, roomId, roomToken, 'error', null))
      }

      socket.onclose = () => {
        setJoinedRooms((current) =>
          current.map((room) =>
            room.roomId === roomId && room.roomToken === roomToken
              ? { ...room, status: room.status === 'error' ? 'error' : 'disconnected' }
              : room,
          ),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to join room.'
      setStatus(message)
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <PageHeader title="Worker" description="Join a room and contribute your resources.">
          <button type="button" onClick={onBack} className="btn btn-secondary">
            Back
          </button>
        </PageHeader>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="card p-5">
            <h2 className="text-sm font-semibold">Join a room</h2>

            <div className="mt-4">
              <label className="label" htmlFor="room-id">
                Room ID
              </label>
              <input
                id="room-id"
                className="input"
                value={roomIdInput}
                onChange={(event) => setRoomIdInput(event.target.value)}
                placeholder="Enter the room ID"
              />
            </div>

            <div className="mt-4">
              <label className="label" htmlFor="room-token">
                Room token
              </label>
              <input
                id="room-token"
                className="input"
                value={roomTokenInput}
                onChange={(event) => setRoomTokenInput(event.target.value)}
                placeholder="Enter the room token"
              />
            </div>

            <button
              type="button"
              disabled={isJoining}
              onClick={joinRoom}
              className="btn btn-primary mt-5 w-full"
            >
              {isJoining ? 'Joining...' : 'Join room'}
            </button>

            {status ? <p className="mt-4 text-sm text-neutral-500">{status}</p> : null}
          </section>

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Joined rooms</h2>
              <span className="text-xs text-neutral-500">{joinedRooms.length}</span>
            </div>

            {joinedRooms.length === 0 ? (
              <p className="text-sm text-neutral-500">No rooms joined yet.</p>
            ) : (
              <div className="space-y-3">
                {joinedRooms.map((room) => (
                  <JoinedRoomCard key={`${room.roomId}-${room.roomToken}`} room={room} />
                ))}
              </div>
            )}
          </section>
        </div>

        <section className="card mt-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Job activity</h2>
            <span className="text-xs text-neutral-500">{activities.length}</span>
          </div>

          {activities.length === 0 ? (
            <p className="text-sm text-neutral-500">
              No jobs yet. Assigned tasks appear here with what was received and the result.
            </p>
          ) : (
            <div className="space-y-3">
              {activities.map((activity) => (
                <ActivityCard key={activity.taskId} activity={activity} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

export default WorkerPage
