import { useEffect, useRef, useState } from 'react'
import { CapabilityList } from '../components/CapabilityList'
import { CopyButton } from '../components/CopyButton'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { coordinatorWsUrl } from '../coordinator'
import { statusTone } from '../lib/status'
import { loadWorkerRooms, saveWorkerRooms, type StoredJoinedRoom } from '../lib/storage'
import type { Capabilities } from '../types'

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

function WorkerPage({ onBack }: { onBack: () => void }) {
  const socketRef = useRef<WebSocket | null>(null)
  const [roomIdInput, setRoomIdInput] = useState('')
  const [roomTokenInput, setRoomTokenInput] = useState('')
  const [joinedRooms, setJoinedRooms] = useState<StoredJoinedRoom[]>(() => loadWorkerRooms())
  const [status, setStatus] = useState('Join a room to start contributing resources.')
  const [isJoining, setIsJoining] = useState(false)

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
      </div>
    </main>
  )
}

export default WorkerPage
