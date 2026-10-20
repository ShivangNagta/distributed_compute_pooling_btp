export type WorkerStatus = 'connected' | 'busy' | 'disconnected'

export interface GpuInformation {
  vendor?: string | null
  architecture?: string | null
  device?: string | null
  description?: string | null
}

export interface Capabilities {
  cores?: number | null
  memory_gb?: number | null
  platform?: string | null
  user_agent?: string | null
  gpu?: GpuInformation | null
}

export interface Worker {
  id: string
  room_id: string
  status: WorkerStatus
  capabilities: Capabilities
  last_seen_at: number
}

// Messages the coordinator can push to a client. The full wire contract lives
// in the backend (coordinator/src/contracts.rs).
export type Message =
  | { type: 'worker_joined'; payload: Worker }
  | { type: 'worker_left'; payload: { worker_id: string } }
