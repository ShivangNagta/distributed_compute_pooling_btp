import { useEffect, useRef, useState } from 'react'
import { COORDINATOR_URL, coordinatorWsUrl, parseMessage } from '../coordinator'
import type { Worker } from '../types'

type RoomRecord = {
  id: string
  clientToken: string
  roomToken: string
  workers: Worker[]
}

function formatResourceValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return 'N/A'
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? `${value}` : value.toFixed(1)
  }

  return String(value)
}

function ClientPage({ onBack }: { onBack: () => void }) {
  const socketByRoom = useRef<Record<string, WebSocket>>({})
  const [rooms, setRooms] = useState<RoomRecord[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [status, setStatus] = useState('No room created yet.')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const sockets = socketByRoom.current

    return () => {
      Object.values(sockets).forEach((socket) => socket.close())
    }
  }, [])

  const upsertWorker = (roomId: string, worker: Worker) => {
    setRooms((current) =>
      current.map((room) => {
        if (room.id !== roomId) {
          return room
        }
        const workers = room.workers.filter((w) => w.id !== worker.id)
        return { ...room, workers: [worker, ...workers] }
      }),
    )
  }

  const removeWorker = (roomId: string, workerId: string) => {
    setRooms((current) =>
      current.map((room) =>
        room.id === roomId
          ? { ...room, workers: room.workers.filter((w) => w.id !== workerId) }
          : room,
      ),
    )
  }

  const connectClientSocket = (room: RoomRecord) => {
    if (socketByRoom.current[room.id]) {
      return
    }

    const socket = new WebSocket(
      coordinatorWsUrl(
        `/ws/${encodeURIComponent(room.id)}/${encodeURIComponent(room.clientToken)}`,
      ),
    )
    socketByRoom.current[room.id] = socket

    socket.onopen = () => {
      setStatus(`Connected to room ${room.id}. Waiting for worker updates.`)
    }

    socket.onerror = () => {
      setError(`WebSocket connection for room ${room.id} failed.`)
    }

    socket.onclose = () => {
      delete socketByRoom.current[room.id]
    }

    socket.onmessage = (event) => {
      const message = parseMessage(event.data)
      if (!message) {
        return
      }

      if (message.type === 'worker_joined') {
        upsertWorker(room.id, message.payload)
        setStatus(`Worker ${message.payload.id} joined.`)
      } else if (message.type === 'worker_left') {
        removeWorker(room.id, message.payload.worker_id)
        setStatus(`Worker ${message.payload.worker_id} left.`)
      }
    }
  }

  const createRoom = async () => {
    setIsCreating(true)
    setError(null)
    setStatus('Creating room...')

    try {
      const response = await fetch(`${COORDINATOR_URL}/create_room`, {
        method: 'POST',
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

      const nextRoom: RoomRecord = {
        id: roomId,
        clientToken,
        roomToken,
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

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      setStatus('Room token copied to clipboard.')
    } catch {
      setStatus('Copy failed. You can still manually copy the room token.')
    }
  }

  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-800">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Client mode</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Client dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={createRoom}
              disabled={isCreating}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isCreating ? 'Creating room...' : 'Create room'}
            </button>
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
            >
              Back
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Rooms</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{rooms.length}</span>
            </div>

            {rooms.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No rooms yet. Create one to get started.
              </div>
            ) : (
              <div className="space-y-2">
                {rooms.map((room) => (
                  <button
                    key={room.id}
                    type="button"
                    onClick={() => setActiveRoomId(room.id)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      activeRoom?.id === room.id
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100'
                    }`}
                  >
                    <div className="text-xs font-medium uppercase tracking-[0.2em] opacity-70">Room</div>
                    <div className="mt-1 truncate text-base font-semibold">{room.id}</div>
                    <div className="mt-2 text-xs opacity-80">{room.workers.length} workers</div>
                  </button>
                ))}
              </div>
            )}
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            {activeRoom ? (
              <>
                <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-medium uppercase tracking-[0.22em] text-slate-500">Active room</p>
                    <h2 className="mt-2 text-2xl font-semibold text-slate-900">{activeRoom.id}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToken(activeRoom.roomToken)}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
                  >
                    Copy room token
                  </button>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Room token</p>
                    <p className="mt-2 break-all text-base font-semibold text-slate-900">{activeRoom.roomToken}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Client token</p>
                    <p className="mt-2 break-all text-base font-semibold text-slate-900">{activeRoom.clientToken}</p>
                  </div>
                </div>

                <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">{status}</div>
                {error ? <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}

                <div className="mt-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-900">Workers</h3>
                    <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
                      {activeRoom.workers.length}
                    </span>
                  </div>

                  {activeRoom.workers.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                      No workers have joined this room yet.
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {activeRoom.workers.map((worker) => {
                        const caps = worker.capabilities
                        const gpu = caps.gpu

                        return (
                          <div key={`${activeRoom.id}-${worker.id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-3">
                              <h4 className="text-base font-semibold text-slate-900">{worker.id}</h4>
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-emerald-700">
                                {worker.status}
                              </span>
                            </div>

                            <dl className="mt-4 space-y-2 text-sm text-slate-600">
                              <div className="flex items-center justify-between gap-3">
                                <dt>CPU cores</dt>
                                <dd className="font-medium text-slate-900">{formatResourceValue(caps.cores)}</dd>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <dt>Memory</dt>
                                <dd className="font-medium text-slate-900">
                                  {formatResourceValue(caps.memory_gb)} GB
                                </dd>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <dt>Platform</dt>
                                <dd className="font-medium text-slate-900">{formatResourceValue(caps.platform)}</dd>
                              </div>
                              {gpu ? (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                                  <p className="font-medium text-slate-800">GPU</p>
                                  <p className="mt-1">{formatResourceValue(gpu.vendor)}</p>
                                  <p>{formatResourceValue(gpu.device)}</p>
                                </div>
                              ) : null}
                            </dl>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-slate-500">
                No active room selected. Create a room to begin.
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default ClientPage
