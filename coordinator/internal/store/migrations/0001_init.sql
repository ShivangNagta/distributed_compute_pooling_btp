CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    client_token TEXT NOT NULL,
    worker_token TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id),
    name TEXT NOT NULL,
    artifact_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL REFERENCES jobs(id),
    worker_id TEXT,
    status TEXT NOT NULL,
    input_json TEXT NOT NULL,
    result_json TEXT,
    error TEXT,
    execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_room ON jobs(room_id);
CREATE INDEX IF NOT EXISTS idx_tasks_job ON tasks(job_id);
