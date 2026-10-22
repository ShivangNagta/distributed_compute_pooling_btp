export type WorkerStatus = 'connected' | 'busy' | 'disconnected'
export type JobStatus = 'created' | 'running' | 'completed' | 'failed'
export type TaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'failed'

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

export interface File {
  name: string
  content: string
  mime?: string | null
}

export interface Artifact {
  entry_point: string
  files: File[]
}

export interface Job {
  id: string
  room_id: string
  name: string
  artifact: Artifact
  status: JobStatus
  created_at: number
  started_at?: number | null
  finished_at?: number | null
}

export interface Task {
  id: string
  job_id: string
  worker_id?: string | null
  status: TaskStatus
  input: unknown
  result?: unknown
  error?: string | null
  execution_time_ms?: number | null
}

// One wire contract shared by both channels. Mirrors
// coordinator/src/contracts.rs.
export type Message =
  | { type: 'capabilities'; payload: Capabilities }
  | { type: 'worker_joined'; payload: Worker }
  | { type: 'worker_left'; payload: { worker_id: string } }
  | { type: 'job_artifact'; payload: { job_id: string; artifact: Artifact } }
  | { type: 'task_assign'; payload: Task }
  | { type: 'task_started'; payload: { task_id: string } }
  | {
      type: 'task_result'
      payload: { task_id: string; result: unknown; execution_time_ms: number }
    }
  | { type: 'task_failed'; payload: { task_id: string; error: string } }
  | { type: 'job_update'; payload: Job }
  | { type: 'task_update'; payload: Task }
  | { type: 'error'; payload: { reason: string } }
