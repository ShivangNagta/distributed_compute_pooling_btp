import { useCallback, useEffect, useRef, useState } from 'react'
import { CapabilityList } from '../components/CapabilityList'
import { CopyButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { COORDINATOR_URL, coordinatorWsUrl, parseMessage } from '../coordinator'
import { statusTone } from '../lib/status'
import {
  loadActiveRoomId,
  loadClientRooms,
  saveActiveRoomId,
  saveClientRooms,
  type StoredRoom,
} from '../lib/storage'
import type { Worker } from '../types'

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

  useEffect(() => {
    saveClientRooms(rooms)
  }, [rooms])

  useEffect(() => {
    saveActiveRoomId(activeRoomId)
  }, [activeRoomId])

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
        setRooms((current) =>
          current.map((item) =>
            item.id === room.id
              ? { ...item, workers: item.workers.filter((w) => w.id !== workerId) }
              : item,
          ),
        )
        setStatus(`Worker ${workerId} left.`)
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
      </div>
    </main>
  )
}

export default ClientPage
