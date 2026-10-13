import { useEffect, useRef, useState } from 'react'

type RoomTokens = {
  roomID: string
  clientToken: string
  roomToken: string
}

function ClientPage() {
  const [tokens, setTokens] = useState<RoomTokens | null>(null)
  const [status, setStatus] = useState('No room created yet.')
  const [isCreating, setIsCreating] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    return () => socketRef.current?.close()
  }, [])

  async function createRoom() {
    setIsCreating(true)
    setTokens(null)
    setStatus('Creating room...')
    socketRef.current?.close()

    try {
      const response = await fetch('http://localhost:3000/create_room', {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`Room creation failed (${response.status})`)
      }

      const body = await response.text()
      const values = new URLSearchParams(body)
      const roomID = values.get('room_id')
      const clientToken = values.get('client_token')
      const roomToken = values.get('room_token')

      if (!roomID || !clientToken || !roomToken) {
        throw new Error('Coordinator returned an invalid room response')
      }

      setTokens({ roomID, clientToken, roomToken })
      setStatus('Connecting to room...')

      const socket = new WebSocket(
        `ws://localhost:3000/ws/${encodeURIComponent(roomID)}/${encodeURIComponent(clientToken)}`,
      )
      socketRef.current = socket
      socket.onopen = () => setStatus('Room created successfully.')
      socket.onerror = () => setStatus('Room created, but the WebSocket connection failed.')
      socket.onclose = () => {
        socketRef.current = null
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Room creation failed.')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <section className="w-full max-w-md border border-slate-300 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Client</h1>
        <p className="mt-2 text-sm text-slate-600">Create a room and connect this client.</p>

        <button
          className="mt-6 border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isCreating}
          onClick={createRoom}
          type="button"
        >
          {isCreating ? 'Creating...' : 'Create room'}
        </button>

        <p className="mt-6 border border-slate-200 p-3 text-sm text-slate-700">{status}</p>

        {tokens && (
          <div className="mt-4 space-y-2 border border-slate-200 p-3 text-sm text-slate-700">
            <p>Room ID: {tokens.roomID}</p>
            <p>Client token: {tokens.clientToken}</p>
            <p>Room token: {tokens.roomToken}</p>
          </div>
        )}
      </section>
    </main>
  )
}

export default ClientPage
