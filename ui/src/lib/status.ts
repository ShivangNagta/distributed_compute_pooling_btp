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
