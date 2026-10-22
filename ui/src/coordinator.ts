import type { Message } from './types'

export const COORDINATOR_URL: string =
  (import.meta.env.VITE_COORDINATOR_URL as string | undefined) ?? 'http://localhost:3000'

export function coordinatorWsUrl(path: string): string {
  return `${COORDINATOR_URL.replace(/^http/, 'ws')}${path}`
}

export function parseMessage(raw: unknown): Message | null {
  if (typeof raw !== 'string') return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'type' in parsed &&
      typeof (parsed as { type: unknown }).type === 'string'
    ) {
      return parsed as Message
    }
  } catch {
    return null
  }

  return null
}
