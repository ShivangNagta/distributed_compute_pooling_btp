import type { Capabilities, Worker } from '../types'

export type StoredRoom = {
  id: string
  clientToken: string
  workerToken: string
  workers: Worker[]
}

export type StoredJoinedRoom = {
  roomId: string
  roomToken: string
  status: 'connected' | 'disconnected' | 'error'
  capabilities: Capabilities | null
}

const CLIENT_ROOMS_KEY = 'btp.client.rooms'
const WORKER_ROOMS_KEY = 'btp.worker.rooms'
const ACTIVE_ROOM_KEY = 'btp.client.activeRoom'

// sessionStorage is scoped to a single tab (unlike localStorage, which is
// shared across every tab of the origin). That keeps the state of one worker
// or client tab isolated from others, while still surviving a refresh.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage failures (quota exceeded, privacy mode, etc.).
  }
}

export function loadClientRooms(): StoredRoom[] {
  return read<StoredRoom[]>(CLIENT_ROOMS_KEY, [])
}

export function saveClientRooms(rooms: StoredRoom[]): void {
  write(CLIENT_ROOMS_KEY, rooms)
}

export function loadWorkerRooms(): StoredJoinedRoom[] {
  return read<StoredJoinedRoom[]>(WORKER_ROOMS_KEY, [])
}

export function saveWorkerRooms(rooms: StoredJoinedRoom[]): void {
  write(WORKER_ROOMS_KEY, rooms)
}

export function loadActiveRoomId(): string | null {
  return read<string | null>(ACTIVE_ROOM_KEY, null)
}

export function saveActiveRoomId(id: string | null): void {
  write(ACTIVE_ROOM_KEY, id)
}
