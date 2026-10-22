import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  loadActiveRoomId,
  loadClientRooms,
  loadWorkerRooms,
  saveActiveRoomId,
  saveClientRooms,
  saveWorkerRooms,
  type StoredJoinedRoom,
  type StoredRoom,
} from './storage'

function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
  }
}

describe('storage', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', makeStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns defaults when nothing is stored', () => {
    expect(loadClientRooms()).toEqual([])
    expect(loadWorkerRooms()).toEqual([])
    expect(loadActiveRoomId()).toBeNull()
  })

  it('round-trips client rooms and their workers', () => {
    const rooms: StoredRoom[] = [
      {
        id: 'room-1',
        clientToken: 'ctoken',
        workerToken: 'wtoken',
        workers: [
          {
            id: 'w1',
            room_id: 'room-1',
            status: 'connected',
            capabilities: {
              cores: 4,
              memory_gb: 8,
              platform: 'macOS',
              user_agent: 'test',
              gpu: null,
            },
            last_seen_at: 1,
          },
        ],
      },
    ]

    saveClientRooms(rooms)
    expect(loadClientRooms()).toEqual(rooms)
  })

  it('round-trips joined rooms', () => {
    const rooms: StoredJoinedRoom[] = [
      { roomId: 'r1', roomToken: 't1', status: 'connected', capabilities: null },
    ]

    saveWorkerRooms(rooms)
    expect(loadWorkerRooms()).toEqual(rooms)
  })

  it('round-trips the active room id', () => {
    saveActiveRoomId('room-9')
    expect(loadActiveRoomId()).toBe('room-9')

    saveActiveRoomId(null)
    expect(loadActiveRoomId()).toBeNull()
  })

  it('falls back to defaults on corrupt data', () => {
    sessionStorage.setItem('btp.client.rooms', '{not valid json')
    expect(loadClientRooms()).toEqual([])
  })

  it('keeps each tab isolated', () => {
    const tabA = makeStorage()
    vi.stubGlobal('sessionStorage', tabA)
    saveClientRooms([{ id: 'room-a', clientToken: 'ca', workerToken: 'wa', workers: [] }])

    const tabB = makeStorage()
    vi.stubGlobal('sessionStorage', tabB)
    expect(loadClientRooms()).toEqual([])
    saveClientRooms([{ id: 'room-b', clientToken: 'cb', workerToken: 'wb', workers: [] }])

    vi.stubGlobal('sessionStorage', tabA)
    expect(loadClientRooms().map((room) => room.id)).toEqual(['room-a'])
  })
})
