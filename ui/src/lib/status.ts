import type { JobStatus, TaskStatus } from '../types'

export type BadgeTone = 'green' | 'amber' | 'red' | 'neutral'

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'connected':
      return 'green'
    case 'connecting':
    case 'busy':
      return 'amber'
    case 'error':
      return 'red'
    default:
      return 'neutral'
  }
}

export function jobStatusTone(status: JobStatus): BadgeTone {
  switch (status) {
    case 'running':
      return 'amber'
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    default:
      return 'neutral'
  }
}

export function taskStatusTone(status: TaskStatus): BadgeTone {
  switch (status) {
    case 'assigned':
    case 'running':
      return 'amber'
    case 'completed':
      return 'green'
    case 'failed':
      return 'red'
    default:
      return 'neutral'
  }
}
