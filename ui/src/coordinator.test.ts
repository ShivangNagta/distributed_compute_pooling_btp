import { describe, expect, it } from 'vitest'

import { parseMessage } from './coordinator'

describe('parseMessage', () => {
  it('parses a worker_joined message', () => {
    const raw = JSON.stringify({
      type: 'worker_joined',
      payload: { id: 'w-1', capabilities: { cores: 8 } },
    })
    const message = parseMessage(raw)

    expect(message?.type).toBe('worker_joined')
  })

  it('parses a worker_left message', () => {
    const raw = JSON.stringify({ type: 'worker_left', payload: { worker_id: 'w-1' } })
    const message = parseMessage(raw)

    expect(message?.type).toBe('worker_left')
  })

  it('returns null for invalid json', () => {
    expect(parseMessage('not json')).toBeNull()
  })

  it('returns null when type is missing', () => {
    expect(parseMessage(JSON.stringify({ payload: {} }))).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(parseMessage(42)).toBeNull()
  })
})
