package store

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
)

func strPtr(s string) *string { return &s }

func testStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	return s
}

func sampleRoom() contracts.Room {
	return contracts.Room{
		ID:          "room-1",
		Name:        "test",
		ClientToken: "ctoken",
		WorkerToken: "wtoken",
		Status:      contracts.RoomStatusActive,
		CreatedAt:   1,
	}
}

func TestRoomRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)

	if err := s.CreateRoom(ctx, sampleRoom()); err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}
	got, err := s.GetRoom(ctx, "room-1")
	if err != nil || got == nil {
		t.Fatalf("GetRoom failed: %v %v", got, err)
	}
	if got.ClientToken != "ctoken" || got.WorkerToken != "wtoken" || got.Status != contracts.RoomStatusActive {
		t.Fatalf("unexpected room: %+v", got)
	}

	missing, err := s.GetRoom(ctx, "nope")
	if err != nil || missing != nil {
		t.Fatalf("expected nil for missing room, got %v %v", missing, err)
	}
}

func TestRoomLookupByTokens(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)

	if err := s.CreateRoom(ctx, sampleRoom()); err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}
	r1, err := s.GetRoomByClientToken(ctx, "ctoken")
	if err != nil || r1 == nil || r1.ID != "room-1" {
		t.Fatalf("GetRoomByClientToken failed: %+v %v", r1, err)
	}
	r2, err := s.GetRoomByWorkerToken(ctx, "wtoken")
	if err != nil || r2 == nil || r2.ID != "room-1" {
		t.Fatalf("GetRoomByWorkerToken failed: %+v %v", r2, err)
	}
}

func TestJobAndTasksRoundTrip(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if err := s.CreateRoom(ctx, sampleRoom()); err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	job := contracts.Job{
		ID:     "job-1",
		RoomID: "room-1",
		Name:   "sum",
		Artifact: contracts.Artifact{
			EntryPoint: "main",
			Files: []contracts.File{
				{Name: "main.wasm", Content: "AGFzbQ==", Mime: strPtr("application/wasm")},
			},
			Kind: contracts.ArtifactKindWasm,
		},
		Status:    contracts.JobStatusCreated,
		CreatedAt: 1,
	}
	task := contracts.Task{
		ID:       "task-1",
		JobID:    "job-1",
		WorkerID: strPtr("worker-1"),
		Status:   contracts.TaskStatusPending,
		Input:    json.RawMessage(`{"a":1,"b":2}`),
	}

	if err := s.CreateJob(ctx, job, []contracts.Task{task}); err != nil {
		t.Fatalf("CreateJob failed: %v", err)
	}

	gotJob, err := s.GetJob(ctx, "job-1")
	if err != nil || gotJob == nil {
		t.Fatalf("GetJob failed: %v %v", gotJob, err)
	}
	if gotJob.Name != "sum" || gotJob.Artifact.EntryPoint != "main" || gotJob.Status != contracts.JobStatusCreated {
		t.Fatalf("unexpected job: %+v", gotJob)
	}

	tasks, err := s.GetTasksByJob(ctx, "job-1")
	if err != nil || len(tasks) != 1 {
		t.Fatalf("GetTasksByJob failed: %v %v", tasks, err)
	}
	if *tasks[0].WorkerID != "worker-1" {
		t.Fatalf("unexpected worker_id: %v", tasks[0].WorkerID)
	}
}

func TestUpdateTaskAndJobStatus(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if err := s.CreateRoom(ctx, sampleRoom()); err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	job := contracts.Job{
		ID:        "job-1",
		RoomID:    "room-1",
		Name:      "sum",
		Artifact:  contracts.Artifact{EntryPoint: "main", Files: []contracts.File{}},
		Status:    contracts.JobStatusCreated,
		CreatedAt: 1,
	}
	task := contracts.Task{
		ID:       "task-1",
		JobID:    "job-1",
		WorkerID: strPtr("worker-1"),
		Status:   contracts.TaskStatusPending,
		Input:    json.RawMessage("null"),
	}
	if err := s.CreateJob(ctx, job, []contracts.Task{task}); err != nil {
		t.Fatalf("CreateJob failed: %v", err)
	}

	gotTask, _ := s.GetTask(ctx, "task-1")
	gotTask.Status = contracts.TaskStatusCompleted
	gotTask.Result = contracts.RawPtr(json.RawMessage(`{"sum":3}`))
	execMs := int64(7)
	gotTask.ExecutionTimeMs = &execMs
	if err := s.UpdateTask(ctx, *gotTask); err != nil {
		t.Fatalf("UpdateTask failed: %v", err)
	}

	_ = s.SetJobStatus(ctx, "job-1", contracts.JobStatusRunning)
	_ = s.SetJobStarted(ctx, "job-1", 100)
	_ = s.SetJobFinished(ctx, "job-1", 200)

	updatedTask, _ := s.GetTask(ctx, "task-1")
	if updatedTask.Status != contracts.TaskStatusCompleted || *updatedTask.ExecutionTimeMs != 7 {
		t.Fatalf("unexpected updated task: %+v", updatedTask)
	}

	updatedJob, _ := s.GetJob(ctx, "job-1")
	if updatedJob.Status != contracts.JobStatusRunning || *updatedJob.StartedAt != 100 || *updatedJob.FinishedAt != 200 {
		t.Fatalf("unexpected updated job: %+v", updatedJob)
	}
}

func TestFailTasksByWorkerOnlyHitsActiveOnes(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if err := s.CreateRoom(ctx, sampleRoom()); err != nil {
		t.Fatalf("CreateRoom failed: %v", err)
	}

	job := contracts.Job{
		ID:        "job-1",
		RoomID:    "room-1",
		Name:      "sum",
		Artifact:  contracts.Artifact{EntryPoint: "main", Files: []contracts.File{}},
		Status:    contracts.JobStatusCreated,
		CreatedAt: 1,
	}
	pending := contracts.Task{
		ID:       "task-pending",
		JobID:    "job-1",
		WorkerID: strPtr("worker-1"),
		Status:   contracts.TaskStatusPending,
		Input:    json.RawMessage("null"),
	}
	running := contracts.Task{
		ID:       "task-running",
		JobID:    "job-1",
		WorkerID: strPtr("worker-1"),
		Status:   contracts.TaskStatusRunning,
		Input:    json.RawMessage("null"),
	}
	if err := s.CreateJob(ctx, job, []contracts.Task{pending, running}); err != nil {
		t.Fatalf("CreateJob failed: %v", err)
	}

	failed, err := s.FailTasksByWorker(ctx, "worker-1")
	if err != nil {
		t.Fatalf("FailTasksByWorker failed: %v", err)
	}
	if len(failed) != 1 || failed[0].ID != "task-running" || failed[0].Status != contracts.TaskStatusFailed {
		t.Fatalf("unexpected failed tasks: %+v", failed)
	}

	stillPending, _ := s.GetTask(ctx, "task-pending")
	if stillPending.Status != contracts.TaskStatusPending {
		t.Fatalf("expected pending task to remain pending, got %s", stillPending.Status)
	}
}
