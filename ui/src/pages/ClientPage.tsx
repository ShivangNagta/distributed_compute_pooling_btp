import { useEffect, useRef, useState } from 'react'

type RoomRecord = {
  id: string
  clientToken: string
  roomToken: string
  workers: WorkerResource[]
}

type WorkerResource = {
  id: string
  status: 'online' | 'idle'
  resources: Record<string, unknown>
  lastSeen: string
}

function parseWorkerMessage(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // The worker may send a JSON string that has already been stringified once.
  }

  try {
    const unwrapped = JSON.parse(raw.replace(/^"|"$/g, ''))
    if (unwrapped && typeof unwrapped === 'object') {
      return unwrapped as Record<string, unknown>
    }
  } catch {
    // Ignore invalid messages.
  }

  return null
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

  const connectClientSocket = (room: RoomRecord) => {
    if (socketByRoom.current[room.id]) {
      return
    }

    const socket = new WebSocket(
      `wss://distributed-compute-pooling.onrender.com/ws/${encodeURIComponent(room.id)}/${encodeURIComponent(room.clientToken)}`,
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
      const payload = parseWorkerMessage(event.data)
      if (!payload) {
        return
      }

      const workerId =
        typeof payload.workerId === 'string'
          ? payload.workerId
          : typeof payload.name === 'string'
            ? payload.name
            : `Worker ${room.workers.length + 1}`

      const workerMetrics: WorkerResource = {
        id: workerId,
        status: 'online',
        lastSeen: new Date().toISOString(),
        resources: payload,
      }

      setRooms((currentRooms) =>
        currentRooms.map((currentRoom) => {
          if (currentRoom.id !== room.id) {
            return currentRoom
          }

          const nextWorkers = currentRoom.workers.filter((worker) => worker.id !== workerId)
          return {
            ...currentRoom,
            workers: [workerMetrics, ...nextWorkers],
          }
        }),
      )
    }
  }

  const createRoom = async () => {
    setIsCreating(true)
    setError(null)
    setStatus('Creating room...')

    try {
      const response = await fetch('https://distributed-compute-pooling.onrender.com/create_room', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`Room creation failed (${response.status})`)
      }

      const body = await response.text()
      const params = new URLSearchParams(body)
      const roomId = params.get('room_id')
      const clientToken = params.get('client_token')
      const roomToken = params.get('room_token')

      if (!roomId || !clientToken || !roomToken) {
        throw new Error('Coordinator returned an invalid room response.')
      }

      const nextRoom: RoomRecord = {
        id: roomId,
        clientToken,
        roomToken,
        workers: [],
      }

      setRooms((currentRooms) => {
        const existing = currentRooms.find((room) => room.id === roomId)
        if (existing) {
          return currentRooms
        }

        return [nextRoom, ...currentRooms]
      })
      setActiveRoomId(roomId)
      connectClientSocket(nextRoom)
      setStatus(`Room ${roomId} created successfully.`)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Unable to create room.'
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
                        const resources = worker.resources
                        const gpuInfo = resources.gpu && typeof resources.gpu === 'object' ? resources.gpu as Record<string, unknown> : null

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
                                <dd className="font-medium text-slate-900">{formatResourceValue(resources.cores)}</dd>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <dt>Memory</dt>
                                <dd className="font-medium text-slate-900">{formatResourceValue(resources.memoryGB)} GB</dd>
                              </div>
                              <div className="flex items-center justify-between gap-3">
                                <dt>Platform</dt>
                                <dd className="font-medium text-slate-900">{formatResourceValue(resources.platform)}</dd>
                              </div>
                              {gpuInfo ? (
                                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                                  <p className="font-medium text-slate-800">GPU</p>
                                  <p className="mt-1">{formatResourceValue(gpuInfo.vendor)}</p>
                                  <p>{formatResourceValue(gpuInfo.device)}</p>
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
