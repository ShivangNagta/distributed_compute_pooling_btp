import { describe, expect, it } from 'vitest'

import type { Job, Task } from '../types'
import { addJobIfMissing, upsertJob, upsertTask, type JobRecord } from './jobs'

function job(id: string, status: Job['status'] = 'created'): Job {
  return {
    id,
    room_id: 'r1',
    name: 'add',
    artifact: { entry_point: 'add', files: [] },
    status,
    created_at: 0,
    started_at: null,
    finished_at: null,
  }
}

function task(id: string, jobId: string, status: Task['status'] = 'pending'): Task {
  return {
    id,
    job_id: jobId,
    worker_id: 'w1',
    status,
    input: [1, 2],
    result: undefined,
    error: null,
    execution_time_ms: null,
  }
}

describe('jobs', () => {
  it('does not duplicate when the job_update arrives before the optimistic add', () => {
    let jobs: JobRecord[] = []
    jobs = upsertTask(jobs, task('t1', 'j1', 'assigned'))
    jobs = upsertJob(jobs, job('j1', 'running'))
    jobs = addJobIfMissing(jobs, job('j1', 'created'))

    expect(jobs).toHaveLength(1)
    expect(jobs[0].job.status).toBe('running')
    expect(jobs[0].tasks).toHaveLength(1)
  })

  it('does not duplicate when the optimistic add arrives first', () => {
    let jobs: JobRecord[] = []
    jobs = addJobIfMissing(jobs, job('j1', 'created'))
    jobs = upsertTask(jobs, task('t1', 'j1', 'assigned'))
    jobs = upsertJob(jobs, job('j1', 'running'))

    expect(jobs).toHaveLength(1)
    expect(jobs[0].tasks).toHaveLength(1)
  })

  it('keeps the task when job_update replaces a placeholder', () => {
    let jobs = upsertTask([], task('t1', 'j1', 'completed'))
    jobs = upsertJob(jobs, job('j1', 'completed'))

    expect(jobs).toHaveLength(1)
    expect(jobs[0].tasks).toHaveLength(1)
    expect(jobs[0].tasks[0].status).toBe('completed')
  })

  it('updates a task in place', () => {
    let jobs = upsertTask([], task('t1', 'j1', 'assigned'))
    jobs = upsertTask(jobs, task('t1', 'j1', 'completed'))

    expect(jobs[0].tasks).toHaveLength(1)
    expect(jobs[0].tasks[0].status).toBe('completed')
  })
})
