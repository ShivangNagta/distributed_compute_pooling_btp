package store

import (
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	_ "modernc.org/sqlite"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Store wraps SQLite persistence for rooms, jobs, and tasks.
type Store struct {
	db *sql.DB
}

func Open(dbPath string) (*Store, error) {
	if dbPath != ":memory:" {
		if dir := filepath.Dir(dbPath); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create db directory: %w", err)
			}
		}
	}

	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// Single writer/connection avoids SQLITE_BUSY under concurrent goroutines.
	db.SetMaxOpenConns(1)

	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL;",
		"PRAGMA busy_timeout=5000;",
		"PRAGMA foreign_keys=ON;",
	} {
		if _, err := db.Exec(pragma); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("apply %s: %w", pragma, err)
		}
	}

	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Migrate(ctx context.Context) error {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		sqlBytes, err := fs.ReadFile(migrationsFS, "migrations/"+entry.Name())
		if err != nil {
			return fmt.Errorf("read migration %s: %w", entry.Name(), err)
		}
		if _, err := s.db.ExecContext(ctx, string(sqlBytes)); err != nil {
			return fmt.Errorf("execute migration %s: %w", entry.Name(), err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------- rooms

func (s *Store) CreateRoom(ctx context.Context, room contracts.Room) error {
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO rooms (id, name, client_token, worker_token, status, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		room.ID, room.Name, room.ClientToken, room.WorkerToken, string(room.Status), room.CreatedAt,
	)
	return err
}

func (s *Store) GetRoom(ctx context.Context, id string) (*contracts.Room, error) {
	return s.getRoomBy(ctx, "id = ?", id)
}

func (s *Store) GetRoomByClientToken(ctx context.Context, token string) (*contracts.Room, error) {
	return s.getRoomBy(ctx, "client_token = ?", token)
}

func (s *Store) GetRoomByWorkerToken(ctx context.Context, token string) (*contracts.Room, error) {
	return s.getRoomBy(ctx, "worker_token = ?", token)
}

func (s *Store) getRoomBy(ctx context.Context, where string, arg any) (*contracts.Room, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT id, name, client_token, worker_token, status, created_at
		 FROM rooms WHERE `+where,
		arg,
	)
	room, err := scanRoom(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &room, nil
}

func (s *Store) ListPasswordlessRooms(ctx context.Context, workerToken string) ([]contracts.Room, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, name, client_token, worker_token, status, created_at
		 FROM rooms WHERE worker_token = ? AND status = 'active'`,
		workerToken,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	rooms := []contracts.Room{}
	for rows.Next() {
		room, err := scanRoom(rows)
		if err != nil {
			return nil, err
		}
		rooms = append(rooms, room)
	}
	return rooms, rows.Err()
}

func (s *Store) DeleteRoom(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM tasks WHERE job_id IN (SELECT id FROM jobs WHERE room_id = ?)`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM jobs WHERE room_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM rooms WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) CloseRoom(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx, `UPDATE rooms SET status = ? WHERE id = ?`, string(contracts.RoomStatusClosed), id)
	return err
}

// ----------------------------------------------------------------------- jobs

func (s *Store) CreateJob(ctx context.Context, job contracts.Job, tasks []contracts.Task) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	artifactJSON, err := json.Marshal(job.Artifact)
	if err != nil {
		return err
	}

	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO jobs (id, room_id, name, artifact_json, status, created_at, started_at, finished_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.RoomID, job.Name, string(artifactJSON), string(job.Status),
		job.CreatedAt, job.StartedAt, job.FinishedAt,
	)
	if err != nil {
		return err
	}

	for _, task := range tasks {
		inputJSON := "null"
		if len(task.Input) > 0 {
			inputJSON = string(task.Input)
		}
		var resultJSON *string
		if task.Result != nil && len(*task.Result) > 0 {
			str := string(*task.Result)
			resultJSON = &str
		}
		_, err = tx.ExecContext(
			ctx,
			`INSERT INTO tasks (id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			task.ID, task.JobID, task.WorkerID, string(task.Status), inputJSON,
			resultJSON, task.Error, task.ExecutionTimeMs,
		)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *Store) GetJob(ctx context.Context, id string) (*contracts.Job, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT id, room_id, name, artifact_json, status, created_at, started_at, finished_at
		 FROM jobs WHERE id = ?`,
		id,
	)
	job, err := scanJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &job, nil
}

func (s *Store) SetJobStatus(ctx context.Context, id string, status contracts.JobStatus) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET status = ? WHERE id = ?`, string(status), id)
	return err
}

func (s *Store) SetJobStarted(ctx context.Context, id string, at int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET started_at = ? WHERE id = ?`, at, id)
	return err
}

func (s *Store) SetJobFinished(ctx context.Context, id string, at int64) error {
	_, err := s.db.ExecContext(ctx, `UPDATE jobs SET finished_at = ? WHERE id = ?`, at, id)
	return err
}

// ---------------------------------------------------------------------- tasks

func (s *Store) GetTask(ctx context.Context, id string) (*contracts.Task, error) {
	row := s.db.QueryRowContext(
		ctx,
		`SELECT id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms
		 FROM tasks WHERE id = ?`,
		id,
	)
	task, err := scanTask(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &task, nil
}

func (s *Store) GetTasksByJob(ctx context.Context, jobID string) ([]contracts.Task, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms
		 FROM tasks WHERE job_id = ?`,
		jobID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := []contracts.Task{}
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (s *Store) UpdateTask(ctx context.Context, task contracts.Task) error {
	var resultJSON *string
	if task.Result != nil && len(*task.Result) > 0 {
		str := string(*task.Result)
		resultJSON = &str
	}
	_, err := s.db.ExecContext(
		ctx,
		`UPDATE tasks
		 SET status = ?, result_json = ?, error = ?, execution_time_ms = ?
		 WHERE id = ?`,
		string(task.Status), resultJSON, task.Error, task.ExecutionTimeMs, task.ID,
	)
	return err
}

// FailTasksByWorker marks every assigned/running task owned by workerID as failed.
func (s *Store) FailTasksByWorker(ctx context.Context, workerID string) ([]contracts.Task, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, job_id, worker_id, status, input_json, result_json, error, execution_time_ms
		 FROM tasks
		 WHERE worker_id = ? AND status IN ('assigned', 'running')`,
		workerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	failed := []contracts.Task{}
	disconnectMsg := "worker disconnected"
	for rows.Next() {
		task, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		task.Status = contracts.TaskStatusFailed
		task.Error = &disconnectMsg
		failed = append(failed, task)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, task := range failed {
		if err := s.UpdateTask(ctx, task); err != nil {
			return nil, err
		}
	}
	return failed, nil
}

// -------------------------------------------------------------------- scanners

type scanner interface {
	Scan(dest ...any) error
}

func scanRoom(s scanner) (contracts.Room, error) {
	var room contracts.Room
	var statusStr string
	if err := s.Scan(&room.ID, &room.Name, &room.ClientToken, &room.WorkerToken, &statusStr, &room.CreatedAt); err != nil {
		return contracts.Room{}, err
	}
	if status, ok := contracts.ParseRoomStatus(statusStr); ok {
		room.Status = status
	} else {
		room.Status = contracts.RoomStatusClosed
	}
	return room, nil
}

func scanJob(s scanner) (contracts.Job, error) {
	var job contracts.Job
	var artifactJSON string
	var statusStr string
	var startedAt, finishedAt sql.NullInt64

	if err := s.Scan(
		&job.ID, &job.RoomID, &job.Name, &artifactJSON,
		&statusStr, &job.CreatedAt, &startedAt, &finishedAt,
	); err != nil {
		return contracts.Job{}, err
	}

	_ = json.Unmarshal([]byte(artifactJSON), &job.Artifact)
	if job.Artifact.Files == nil {
		job.Artifact.Files = []contracts.File{}
	}
	if job.Artifact.Kind == "" {
		job.Artifact.Kind = contracts.ArtifactKindWasm
	}
	if status, ok := contracts.ParseJobStatus(statusStr); ok {
		job.Status = status
	} else {
		job.Status = contracts.JobStatusCreated
	}
	if startedAt.Valid {
		v := startedAt.Int64
		job.StartedAt = &v
	}
	if finishedAt.Valid {
		v := finishedAt.Int64
		job.FinishedAt = &v
	}
	return job, nil
}

func scanTask(s scanner) (contracts.Task, error) {
	var task contracts.Task
	var workerID, resultJSON, errStr sql.NullString
	var statusStr, inputJSON string
	var execMs sql.NullInt64

	if err := s.Scan(
		&task.ID, &task.JobID, &workerID, &statusStr,
		&inputJSON, &resultJSON, &errStr, &execMs,
	); err != nil {
		return contracts.Task{}, err
	}

	if workerID.Valid {
		v := workerID.String
		task.WorkerID = &v
	}
	if status, ok := contracts.ParseTaskStatus(statusStr); ok {
		task.Status = status
	} else {
		task.Status = contracts.TaskStatusPending
	}
	if inputJSON != "" {
		task.Input = json.RawMessage(inputJSON)
	} else {
		task.Input = json.RawMessage("null")
	}
	if resultJSON.Valid && resultJSON.String != "" {
		raw := json.RawMessage(resultJSON.String)
		task.Result = &raw
	}
	if errStr.Valid {
		v := errStr.String
		task.Error = &v
	}
	if execMs.Valid {
		v := execMs.Int64
		task.ExecutionTimeMs = &v
	}
	return task, nil
}
