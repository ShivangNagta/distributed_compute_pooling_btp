package service

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/apperr"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/store"
)

func strPtr(s string) *string { return &s }
func i32Ptr(v int32) *int32   { return &v }

func testService(t *testing.T) *Service {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open failed: %v", err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if err := s.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	return New(s)
}

func sampleJob(roomID string) contracts.Job {
	return contracts.Job{
		ID:        "job-1",
		RoomID:    roomID,
		Name:      "sum",
		Artifact:  contracts.Artifact{EntryPoint: "main", Files: []contracts.File{}},
		Status:    contracts.JobStatusCreated,
		CreatedAt: 1,
	}
}

func sampleTask(jobID string) contracts.Task {
	return contracts.Task{
		ID:       "task-1",
		JobID:    jobID,
		WorkerID: strPtr("worker-1"),
		Status:   contracts.TaskStatusPending,
		Input:    json.RawMessage(`{"a":1,"b":2}`),
	}
}

func TestCreatePasswordlessAndProtectedRooms(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)

	pwless, err := svc.CreateRoom(ctx, true)
	if err != nil {
		t.Fatalf("CreateRoom(true) failed: %v", err)
	}
	if pwless.WorkerToken != PasswordlessWorkerToken() {
		t.Fatalf("expected passwordless token, got %q", pwless.WorkerToken)
	}

	protected, err := svc.CreateRoom(ctx, false)
	if err != nil {
		t.Fatalf("CreateRoom(false) failed: %v", err)
	}
	if protected.WorkerToken == PasswordlessWorkerToken() {
		t.Fatalf("expected generated worker token, got %q", protected.WorkerToken)
	}
}

func TestDeleteRoomRemovesRoomAndJobs(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)
	job := sampleJob(room.ID)
	_ = svc.Store.CreateJob(ctx, job, []contracts.Task{sampleTask(job.ID)})

	if err := svc.DeleteRoom(ctx, room.ID); err != nil {
		t.Fatalf("DeleteRoom failed: %v", err)
	}
	got, _ := svc.Store.GetRoom(ctx, room.ID)
	if got != nil {
		t.Fatalf("expected room to be deleted, got %+v", got)
	}
}

func TestRegisterThenRemoveWorker(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)

	worker, err := svc.RegisterWorker(ctx, room.ID)
	if err != nil {
		t.Fatalf("RegisterWorker failed: %v", err)
	}
	if !svc.HasWorker(worker.ID) {
		t.Fatal("expected worker to be registered")
	}

	events, err := svc.RemoveWorker(ctx, worker.ID)
	if err != nil {
		t.Fatalf("RemoveWorker failed: %v", err)
	}
	if svc.HasWorker(worker.ID) {
		t.Fatal("expected worker to be removed")
	}
	if len(events) == 0 || events[0].Type != contracts.MsgWorkerLeft {
		t.Fatalf("expected worker_left event, got %+v", events)
	}
}

func TestRegisterRejectsInactiveRoom(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)
	_ = svc.CloseRoom(ctx, room.ID)

	_, err := svc.RegisterWorker(ctx, room.ID)
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Kind != apperr.KindBadRequest {
		t.Fatalf("expected BadRequest error, got %v", err)
	}
}

func TestCapabilitiesMessageEmitsWorkerJoined(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)
	worker, _ := svc.RegisterWorker(ctx, room.ID)

	msg, _ := contracts.NewMessage(contracts.MsgCapabilities, contracts.Capabilities{Cores: i32Ptr(4)})
	events, err := svc.HandleWorkerMessage(ctx, worker.ID, msg)
	if err != nil {
		t.Fatalf("HandleWorkerMessage failed: %v", err)
	}
	if len(events) != 1 || events[0].Type != contracts.MsgWorkerJoined {
		t.Fatalf("expected worker_joined event, got %+v", events)
	}
	joined, _ := contracts.DecodePayload[contracts.Worker](events[0])
	if joined.Capabilities.Cores == nil || *joined.Capabilities.Cores != 4 {
		t.Fatalf("expected cores 4, got %+v", joined.Capabilities)
	}
}

func TestTaskResultCompletesJob(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)
	job := sampleJob(room.ID)
	_ = svc.Store.CreateJob(ctx, job, []contracts.Task{sampleTask(job.ID)})

	msg, _ := contracts.NewMessage(contracts.MsgTaskResult, contracts.TaskResultPayload{
		TaskID:          "task-1",
		Result:          json.RawMessage(`{"sum":3}`),
		ExecutionTimeMs: 5,
	})
	events, err := svc.HandleWorkerMessage(ctx, "worker-1", msg)
	if err != nil {
		t.Fatalf("HandleWorkerMessage failed: %v", err)
	}

	task, _ := svc.Store.GetTask(ctx, "task-1")
	if task.Status != contracts.TaskStatusCompleted || *task.ExecutionTimeMs != 5 {
		t.Fatalf("unexpected task: %+v", task)
	}
	gotJob, _ := svc.Store.GetJob(ctx, "job-1")
	if gotJob.Status != contracts.JobStatusCompleted {
		t.Fatalf("expected completed job, got %s", gotJob.Status)
	}
	hasJobUpdate := false
	for _, ev := range events {
		if ev.Type == contracts.MsgJobUpdate {
			hasJobUpdate = true
		}
	}
	if !hasJobUpdate {
		t.Fatalf("expected job_update event, got %+v", events)
	}
}

func TestTaskFailedFailsJob(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)
	job := sampleJob(room.ID)
	_ = svc.Store.CreateJob(ctx, job, []contracts.Task{sampleTask(job.ID)})

	msg, _ := contracts.NewMessage(contracts.MsgTaskFailed, contracts.TaskFailedPayload{
		TaskID: "task-1",
		Error:  "boom",
	})
	if _, err := svc.HandleWorkerMessage(ctx, "worker-1", msg); err != nil {
		t.Fatalf("HandleWorkerMessage failed: %v", err)
	}

	task, _ := svc.Store.GetTask(ctx, "task-1")
	if task.Status != contracts.TaskStatusFailed || *task.Error != "boom" {
		t.Fatalf("unexpected task: %+v", task)
	}
	gotJob, _ := svc.Store.GetJob(ctx, "job-1")
	if gotJob.Status != contracts.JobStatusFailed {
		t.Fatalf("expected failed job, got %s", gotJob.Status)
	}
}

func TestSubmitDispatchesArtifactAndTask(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)

	workerConn := svc.RegisterWorkerConn("worker-1")
	clientConn := svc.RegisterClientConn(room.ClientToken)

	artifact := contracts.Artifact{
		EntryPoint: "add",
		Files:      []contracts.File{{Name: "main.wasm", Content: "AGFzbQ==", Mime: strPtr("application/wasm")}},
	}
	tasks := []NewTask{{WorkerID: "worker-1", Input: json.RawMessage(`[1,2]`)}}

	job, err := svc.SubmitJob(ctx, room.ID, "add job", artifact, tasks)
	if err != nil {
		t.Fatalf("SubmitJob failed: %v", err)
	}

	gotJob, _ := svc.Store.GetJob(ctx, job.ID)
	if gotJob.Status != contracts.JobStatusRunning {
		t.Fatalf("expected running job, got %s", gotJob.Status)
	}
	gotTasks, _ := svc.Store.GetTasksByJob(ctx, job.ID)
	if len(gotTasks) != 1 || gotTasks[0].Status != contracts.TaskStatusAssigned {
		t.Fatalf("expected 1 assigned task, got %+v", gotTasks)
	}

	first := string(<-workerConn.Send)
	if !strings.Contains(first, "job_artifact") {
		t.Fatalf("expected job_artifact, got %s", first)
	}
	second := string(<-workerConn.Send)
	if !strings.Contains(second, "task_assign") {
		t.Fatalf("expected task_assign, got %s", second)
	}
	if len(clientConn.Send) < 2 {
		t.Fatalf("expected at least 2 client notifications, got %d", len(clientConn.Send))
	}
}

func TestSubmitRejectsUnknownWorker(t *testing.T) {
	ctx := context.Background()
	svc := testService(t)
	room, _ := svc.CreateRoom(ctx, false)

	_, err := svc.SubmitJob(ctx, room.ID, "add", contracts.Artifact{}, []NewTask{
		{WorkerID: "ghost", Input: json.RawMessage(`[]`)},
	})
	var appErr *apperr.Error
	if !errors.As(err, &appErr) || appErr.Kind != apperr.KindBadRequest {
		t.Fatalf("expected BadRequest, got %v", err)
	}
}
