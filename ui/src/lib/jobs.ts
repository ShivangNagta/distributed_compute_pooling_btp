import type { Job, Task } from '../types'

export type JobRecord = { job: Job; tasks: Task[] }

function placeholder(jobId: string): Job {
  return {
    id: jobId,
    room_id: '',
    name: 'job',
    artifact: { entry_point: '', files: [] },
    status: 'created',
    created_at: 0,
    started_at: null,
    finished_at: null,
  }
}

/// Adds a job only if it is not already present. Used for the optimistic add
/// after submit: the coordinator dispatches before returning the response, so a
/// job_update may already have created the record.
export function addJobIfMissing(jobs: JobRecord[], job: Job): JobRecord[] {
  return jobs.some((record) => record.job.id === job.id)
    ? jobs
    : [{ job, tasks: [] }, ...jobs]
}

/// Updates a job in place, or prepends it. Preserves any tasks already recorded.
export function upsertJob(jobs: JobRecord[], job: Job): JobRecord[] {
  if (jobs.some((record) => record.job.id === job.id)) {
    return jobs.map((record) =>
      record.job.id === job.id ? { job, tasks: record.tasks } : record,
    )
  }
  return [{ job, tasks: [] }, ...jobs]
}

/// Adds or updates a task on its job. If the job is not known yet (its
/// job_update has not arrived), keeps the task under a placeholder.
export function upsertTask(jobs: JobRecord[], task: Task): JobRecord[] {
  if (jobs.some((record) => record.job.id === task.job_id)) {
    return jobs.map((record) =>
      record.job.id === task.job_id
        ? { job: record.job, tasks: [task, ...record.tasks.filter((t) => t.id !== task.id)] }
        : record,
    )
  }
  return [{ job: placeholder(task.job_id), tasks: [task] }, ...jobs]
}
