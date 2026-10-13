import { useRef, useState } from 'react'

type JoinedRoom = {
  roomId: string
  roomToken: string
  status: 'connecting' | 'connected' | 'error'
  resources: Record<string, unknown>
}

function normalizeResourcePayload(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object') {
    return payload as Record<string, unknown>
  }

  return {}
}

async function getCapabilities(): Promise<Record<string, unknown>> {
  let gpuInfo: Record<string, unknown> | null = null

  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter && adapter.info) {
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
    memoryGB: (navigator as { deviceMemory?: number }).deviceMemory || null,
    platform: navigator.platform || null,
    userAgent: navigator.userAgent || null,
    gpu: gpuInfo,
  }
}

function WorkerPage({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<WebSocket | null>(null)
  const [roomIdInput, setRoomIdInput] = useState('')
  const [roomTokenInput, setRoomTokenInput] = useState('')
  const [joinedRooms, setJoinedRooms] = useState<JoinedRoom[]>([])
  const [status, setStatus] = useState('Join a room to start contributing resources.')
  const [isJoining, setIsJoining] = useState(false)

  const joinRoom = async () => {
    try {
      setIsJoining(true)
      setStatus('Validating room details...')

      const roomId = roomIdInput.trim()
      const roomToken = roomTokenInput.trim()

      if (!roomId || !roomToken) {
        throw new Error('Both room ID and room token are required.')
      }

      const wsUrl = `ws://localhost:3000/ws/join_room/${encodeURIComponent(roomId)}/${encodeURIComponent(roomToken)}`

      const socket = new WebSocket(wsUrl)
      socketRef.current = socket

      socket.onopen = async () => {
        const capabilities = await getCapabilities()
        socket.send(JSON.stringify(capabilities))
        setJoinedRooms((currentRooms) => {
          const existing = currentRooms.find((room) => room.roomId === roomId && room.roomToken === roomToken)
          if (existing) {
            return currentRooms.map((room) =>
              room.roomId === roomId && room.roomToken === roomToken
                ? { ...room, status: 'connected', resources: capabilities }
                : room,
            )
          }

          return [
            {
              roomId,
              roomToken,
              status: 'connected',
              resources: capabilities,
            },
            ...currentRooms,
          ]
        })
        setStatus(`Connected to room ${roomId}. Your resources are now visible to the client.`)
      }

      socket.onerror = () => {
        setStatus('Could not connect to that room. Check the room ID and room token and try again.')
        setJoinedRooms((currentRooms) =>
          currentRooms.map((room) =>
            room.roomId === roomId && room.roomToken === roomToken ? { ...room, status: 'error' } : room,
          ),
        )
      }

      socket.onclose = () => {
        setJoinedRooms((currentRooms) =>
          currentRooms.map((room) =>
            room.roomId === roomId && room.roomToken === roomToken
              ? { ...room, status: room.status === 'error' ? 'error' : 'connected' }
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
    <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-800">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Worker mode</p>
            <h1 className="mt-2 text-3xl font-semibold text-slate-900">Join a compute room</h1>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
          >
            Back to mode selection
          </button>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <label className="block text-sm font-medium text-slate-700">Room ID</label>
            <input
              value={roomIdInput}
              onChange={(event) => setRoomIdInput(event.target.value)}
              placeholder="Enter the room ID"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <label className="mt-5 block text-sm font-medium text-slate-700">Room token</label>
            <input
              value={roomTokenInput}
              onChange={(event) => setRoomTokenInput(event.target.value)}
              placeholder="Enter the room token"
              className="mt-2 w-full rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <button
              type="button"
              disabled={isJoining}
              onClick={joinRoom}
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {isJoining ? 'Joining room...' : 'Join room'}
            </button>

            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">{status}</div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Connected rooms</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                {joinedRooms.length}
              </span>
            </div>

            {joinedRooms.length === 0 ? (
              <div className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No rooms joined yet.
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                {joinedRooms.map((room) => (
                  <div key={`${room.roomId}-${room.roomToken}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Room</p>
                        <h3 className="mt-1 text-base font-semibold text-slate-900">{room.roomId}</h3>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          room.status === 'connected'
                            ? 'bg-emerald-100 text-emerald-700'
                            : room.status === 'error'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {room.status}
                      </span>
                    </div>

                    <dl className="mt-4 space-y-2 text-sm text-slate-600">
                      <div className="flex items-center justify-between gap-3">
                        <dt>Room token</dt>
                        <dd className="font-medium text-slate-900">{room.roomToken}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>CPU cores</dt>
                        <dd className="font-medium text-slate-900">{String(normalizeResourcePayload(room.resources).cores ?? 'N/A')}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>Memory</dt>
                        <dd className="font-medium text-slate-900">
                          {(() => {
                            const memoryGB = normalizeResourcePayload(room.resources).memoryGB
                            return memoryGB !== null && memoryGB !== undefined ? `${memoryGB} GB` : 'N/A'
                          })()}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt>Platform</dt>
                        <dd className="font-medium text-slate-900">{String(normalizeResourcePayload(room.resources).platform ?? 'N/A')}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

export default WorkerPage
