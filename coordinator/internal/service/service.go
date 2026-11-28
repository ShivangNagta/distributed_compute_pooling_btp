package service

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/apperr"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/shader"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/store"
)

const ChannelBufferSize = 100

// NewTask represents a task supplied by the client at job submission time.
type NewTask struct {
	WorkerID string          `json:"worker_id"`
	Input    json.RawMessage `json:"input,omitempty"`
}

// Conn wraps a bounded outbound message queue for a WebSocket connection.
type Conn struct {
	Send chan []byte
	Done chan struct{}
	once sync.Once
}

func NewConn() *Conn {
	return &Conn{
		Send: make(chan []byte, ChannelBufferSize),
		Done: make(chan struct{}),
	}
}

func (c *Conn) Close() {
	c.once.Do(func() {
		close(c.Done)
	})
}

func (c *Conn) Enqueue(payload []byte) bool {
	select {
	case <-c.Done:
		return false
	default:
	}
	select {
	case c.Send <- payload:
		return true
	case <-c.Done:
		return false
	}
}

// Service coordinates rooms, ephemeral worker/client WebSocket registries, and job lifecycle.
type Service struct {
	Store       *store.Store
	mu          sync.RWMutex
	clientConns map[string]*Conn
	workerConns map[string]*Conn
	workers     map[string]contracts.Worker
}

func New(st *store.Store) *Service {
	return &Service{
		Store:       st,
		clientConns: make(map[string]*Conn),
		workerConns: make(map[string]*Conn),
		workers:     make(map[string]contracts.Worker),
	}
}

func PasswordlessWorkerToken() string {
	if v := os.Getenv("PASSWORDLESS_WORKER_TOKEN"); v != "" {
		return v
	}
	return "passwordless-worker"
}

func NowMs() int64 {
	return time.Now().UnixMilli()
}

func GenerateToken() string {
	const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
	out := make([]byte, 6)
	maxIdx := big.NewInt(int64(len(alphabet)))
	for i := range out {
		n, err := rand.Int(rand.Reader, maxIdx)
		if err != nil {
			out[i] = alphabet[i]
			continue
		}
		out[i] = alphabet[n.Int64()]
	}
	return string(out)
}

func (s *Service) RegisterClientConn(clientToken string) *Conn {
	conn := NewConn()
	s.mu.Lock()
	if prev, ok := s.clientConns[clientToken]; ok {
		prev.Close()
	}
	s.clientConns[clientToken] = conn
	s.mu.Unlock()
	return conn
}

func (s *Service) UnregisterClientConn(clientToken string, conn *Conn) {
	s.mu.Lock()
	if current, ok := s.clientConns[clientToken]; ok && current == conn {
		delete(s.clientConns, clientToken)
	}
	s.mu.Unlock()
	conn.Close()
}

func (s *Service) RegisterWorkerConn(workerID string) *Conn {
	conn := NewConn()
	s.mu.Lock()
	if prev, ok := s.workerConns[workerID]; ok {
		prev.Close()
	}
	s.workerConns[workerID] = conn
	s.mu.Unlock()
	return conn
}

func (s *Service) UnregisterWorkerConn(workerID string, conn *Conn) {
	s.mu.Lock()
	if current, ok := s.workerConns[workerID]; ok && current == conn {
		delete(s.workerConns, workerID)
	}
	s.mu.Unlock()
	conn.Close()
}

func (s *Service) HasWorker(workerID string) bool {
	s.mu.RLock()
	_, ok := s.workers[workerID]
	s.mu.RUnlock()
	return ok
}

func (s *Service) SendToWorker(workerID string, msg contracts.Message) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	s.mu.RLock()
	conn := s.workerConns[workerID]
	s.mu.RUnlock()
	if conn != nil {
		conn.Enqueue(raw)
	}
}

func (s *Service) SendToClient(clientToken string, msg contracts.Message) {
	raw, err := json.Marshal(msg)
	if err != nil {
		return
	}
	s.mu.RLock()
	conn := s.clientConns[clientToken]
	s.mu.RUnlock()
	if conn != nil {
		conn.Enqueue(raw)
	}
}

func (s *Service) SendMessagesToClient(clientToken string, msgs []contracts.Message) {
	for _, msg := range msgs {
		s.SendToClient(clientToken, msg)
	}
}

func (s *Service) CreateRoom(ctx context.Context, passwordless bool) (contracts.Room, error) {
	workerToken := GenerateToken()
	if passwordless {
		workerToken = PasswordlessWorkerToken()
	}
	room := contracts.Room{
		ID:          uuid.NewString(),
		Name:        "",
		ClientToken: GenerateToken(),
		WorkerToken: workerToken,
		Status:      contracts.RoomStatusActive,
		CreatedAt:   NowMs(),
	}
	if err := s.Store.CreateRoom(ctx, room); err != nil {
		return contracts.Room{}, err
	}
	return room, nil
}

func (s *Service) DeleteRoom(ctx context.Context, roomID string) error {
	return s.Store.DeleteRoom(ctx, roomID)
}

func (s *Service) CloseRoom(ctx context.Context, roomID string) error {
	return s.Store.CloseRoom(ctx, roomID)
}

func (s *Service) RegisterWorker(ctx context.Context, roomID string) (contracts.Worker, error) {
	room, err := s.Store.GetRoom(ctx, roomID)
	if err != nil {
		return contracts.Worker{}, err
	}
	if room == nil {
		return contracts.Worker{}, apperr.NotFound()
	}
	if room.Status != contracts.RoomStatusActive {
		return contracts.Worker{}, apperr.BadRequest("room is not active")
	}

	worker := contracts.Worker{
		ID:           uuid.NewString(),
		RoomID:       roomID,
		Status:       contracts.WorkerStatusConnected,
		Capabilities: contracts.Capabilities{},
		LastSeenAt:   NowMs(),
	}
	s.mu.Lock()
	s.workers[worker.ID] = worker
	s.mu.Unlock()
	return worker, nil
}

func (s *Service) RemoveWorker(ctx context.Context, workerID string) ([]contracts.Message, error) {
	s.mu.Lock()
	worker, existed := s.workers[workerID]
	if existed {
		delete(s.workers, workerID)
	}
	s.mu.Unlock()

	if !existed {
		return nil, nil
	}

	leftMsg, err := contracts.NewMessage(contracts.MsgWorkerLeft, contracts.WorkerLeftPayload{WorkerID: worker.ID})
	if err != nil {
		return nil, err
	}
	messages := []contracts.Message{leftMsg}

	failed, err := s.Store.FailTasksByWorker(ctx, worker.ID)
	if err != nil {
		return nil, err
	}
	seenJobs := make(map[string]struct{})
	var jobOrder []string
	for _, task := range failed {
		msg, err := contracts.NewMessage(contracts.MsgTaskUpdate, task)
		if err != nil {
			return nil, err
		}
		messages = append(messages, msg)
		if _, seen := seenJobs[task.JobID]; !seen {
			seenJobs[task.JobID] = struct{}{}
			jobOrder = append(jobOrder, task.JobID)
		}
	}

	for _, jobID := range jobOrder {
		updates, err := s.failJobWith(ctx, jobID, contracts.JobStatusFailed)
		if err != nil {
			return nil, err
		}
		messages = append(messages, updates...)
	}
	return messages, nil
}

func (s *Service) SubmitJob(
	ctx context.Context,
	roomID string,
	name string,
	artifact contracts.Artifact,
	newTasks []NewTask,
) (contracts.Job, error) {
	if len(newTasks) == 0 {
		return contracts.Job{}, apperr.BadRequest("job must have at least one task")
	}

	s.mu.RLock()
	var missingWorker string
	for _, t := range newTasks {
		if _, ok := s.workerConns[t.WorkerID]; !ok {
			missingWorker = t.WorkerID
			break
		}
	}
	s.mu.RUnlock()
	if missingWorker != "" {
		return contracts.Job{}, apperr.BadRequest(fmt.Sprintf("worker %s is not connected", missingWorker))
	}

	if artifact.Kind == "" {
		artifact.Kind = contracts.ArtifactKindWasm
	}
	if artifact.Files == nil {
		artifact.Files = []contracts.File{}
	}

	job := contracts.Job{
		ID:        uuid.NewString(),
		RoomID:    roomID,
		Name:      name,
		Artifact:  artifact,
		Status:    contracts.JobStatusCreated,
		CreatedAt: NowMs(),
	}

	tasks := make([]contracts.Task, len(newTasks))
	for i, nt := range newTasks {
		workerID := nt.WorkerID
		input := nt.Input
		if len(input) == 0 {
			input = json.RawMessage("null")
		}
		tasks[i] = contracts.Task{
			ID:       uuid.NewString(),
			JobID:    job.ID,
			WorkerID: &workerID,
			Status:   contracts.TaskStatusPending,
			Input:    input,
		}
	}

	if err := s.Store.CreateJob(ctx, job, tasks); err != nil {
		return contracts.Job{}, err
	}
	if err := s.dispatchJob(ctx, roomID, job.ID); err != nil {
		return contracts.Job{}, err
	}
	return job, nil
}

func (s *Service) dispatchJob(ctx context.Context, roomID, jobID string) error {
	job, err := s.Store.GetJob(ctx, jobID)
	if err != nil {
		return err
	}
	if job == nil {
		return apperr.NotFound()
	}

	tasks, err := s.Store.GetTasksByJob(ctx, jobID)
	if err != nil {
		return err
	}

	artifactSent := make(map[string]struct{})
	assigned := make([]contracts.Task, 0, len(tasks))

	for _, task := range tasks {
		if task.WorkerID == nil {
			continue
		}
		workerID := *task.WorkerID

		if _, sent := artifactSent[workerID]; !sent {
			if msg, err := contracts.NewMessage(contracts.MsgJobArtifact, contracts.JobArtifactPayload{
				JobID:    jobID,
				Artifact: job.Artifact,
			}); err == nil {
				s.SendToWorker(workerID, msg)
			}
			artifactSent[workerID] = struct{}{}
		}

		if msg, err := contracts.NewMessage(contracts.MsgTaskAssign, task); err == nil {
			s.SendToWorker(workerID, msg)
		}

		task.Status = contracts.TaskStatusAssigned
		if err := s.Store.UpdateTask(ctx, task); err != nil {
			return err
		}
		assigned = append(assigned, task)
	}

	if err := s.Store.SetJobStatus(ctx, jobID, contracts.JobStatusRunning); err != nil {
		return err
	}
	if err := s.Store.SetJobStarted(ctx, jobID, NowMs()); err != nil {
		return err
	}

	room, err := s.Store.GetRoom(ctx, roomID)
	if err != nil {
		return err
	}
	if room == nil {
		return apperr.NotFound()
	}

	for _, task := range assigned {
		if msg, err := contracts.NewMessage(contracts.MsgTaskUpdate, task); err == nil {
			s.SendToClient(room.ClientToken, msg)
		}
	}
	if updatedJob, err := s.Store.GetJob(ctx, jobID); err != nil {
		return err
	} else if updatedJob != nil {
		if msg, err := contracts.NewMessage(contracts.MsgJobUpdate, *updatedJob); err == nil {
			s.SendToClient(room.ClientToken, msg)
		}
	}
	return nil
}

func (s *Service) HandleWorkerMessage(ctx context.Context, workerID string, msg contracts.Message) ([]contracts.Message, error) {
	switch msg.Type {
	case contracts.MsgCapabilities:
		caps, err := contracts.DecodePayload[contracts.Capabilities](msg)
		if err != nil {
			return nil, apperr.BadRequest(fmt.Sprintf("invalid capabilities payload: %v", err))
		}
		s.mu.Lock()
		worker, ok := s.workers[workerID]
		if ok {
			worker.Capabilities = caps
			worker.LastSeenAt = NowMs()
			s.workers[workerID] = worker
		}
		s.mu.Unlock()
		if !ok {
			return nil, nil
		}
		joined, err := contracts.NewMessage(contracts.MsgWorkerJoined, worker)
		if err != nil {
			return nil, err
		}
		return []contracts.Message{joined}, nil

	case contracts.MsgTaskStarted:
		payload, err := contracts.DecodePayload[contracts.TaskStartedPayload](msg)
		if err != nil {
			return nil, apperr.BadRequest(fmt.Sprintf("invalid task_started payload: %v", err))
		}
		task, err := s.Store.GetTask(ctx, payload.TaskID)
		if err != nil {
			return nil, err
		}
		if task == nil {
			return nil, apperr.NotFound()
		}
		task.Status = contracts.TaskStatusRunning
		if err := s.Store.UpdateTask(ctx, *task); err != nil {
			return nil, err
		}
		update, err := contracts.NewMessage(contracts.MsgTaskUpdate, *task)
		if err != nil {
			return nil, err
		}
		return []contracts.Message{update}, nil

	case contracts.MsgTaskResult:
		payload, err := contracts.DecodePayload[contracts.TaskResultPayload](msg)
		if err != nil {
			return nil, apperr.BadRequest(fmt.Sprintf("invalid task_result payload: %v", err))
		}
		task, err := s.Store.GetTask(ctx, payload.TaskID)
		if err != nil {
			return nil, err
		}
		if task == nil {
			return nil, apperr.NotFound()
		}
		task.Status = contracts.TaskStatusCompleted
		task.Result = contracts.RawPtr(payload.Result)
		execMs := int64(payload.ExecutionTimeMs)
		task.ExecutionTimeMs = &execMs
		if err := s.Store.UpdateTask(ctx, *task); err != nil {
			return nil, err
		}

		update, err := contracts.NewMessage(contracts.MsgTaskUpdate, *task)
		if err != nil {
			return nil, err
		}
		messages := []contracts.Message{update}
		doneMsgs, err := s.finishJobIfDone(ctx, task.JobID)
		if err != nil {
			return nil, err
		}
		messages = append(messages, doneMsgs...)
		return messages, nil

	case contracts.MsgTaskFailed:
		payload, err := contracts.DecodePayload[contracts.TaskFailedPayload](msg)
		if err != nil {
			return nil, apperr.BadRequest(fmt.Sprintf("invalid task_failed payload: %v", err))
		}
		task, err := s.Store.GetTask(ctx, payload.TaskID)
		if err != nil {
			return nil, err
		}
		if task == nil {
			return nil, apperr.NotFound()
		}
		task.Status = contracts.TaskStatusFailed
		errCopy := payload.Error
		task.Error = &errCopy
		if err := s.Store.UpdateTask(ctx, *task); err != nil {
			return nil, err
		}

		update, err := contracts.NewMessage(contracts.MsgTaskUpdate, *task)
		if err != nil {
			return nil, err
		}
		messages := []contracts.Message{update}
		if job, err := s.Store.GetJob(ctx, task.JobID); err != nil {
			return nil, err
		} else if job != nil {
			failMsgs, err := s.failJobWith(ctx, job.ID, contracts.JobStatusFailed)
			if err != nil {
				return nil, err
			}
			messages = append(messages, failMsgs...)
		}
		return messages, nil

	default:
		return nil, nil
	}
}

func (s *Service) finishJobIfDone(ctx context.Context, jobID string) ([]contracts.Message, error) {
	tasks, err := s.Store.GetTasksByJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if len(tasks) == 0 {
		return nil, nil
	}

	anyFailed := false
	for _, t := range tasks {
		switch t.Status {
		case contracts.TaskStatusCompleted:
		case contracts.TaskStatusFailed:
			anyFailed = true
		default:
			return nil, nil
		}
	}

	status := contracts.JobStatusCompleted
	if anyFailed {
		status = contracts.JobStatusFailed
	} else {
		job, err := s.Store.GetJob(ctx, jobID)
		if err != nil {
			return nil, err
		}
		if job == nil {
			return nil, apperr.NotFound()
		}
		if job.Artifact.Kind == contracts.ArtifactKindShaderCompute {
			if err := shader.AggregateTiles(tasks); err != nil {
				return nil, err
			}
		}
	}

	return s.failJobWith(ctx, jobID, status)
}

func (s *Service) failJobWith(ctx context.Context, jobID string, status contracts.JobStatus) ([]contracts.Message, error) {
	if err := s.Store.SetJobStatus(ctx, jobID, status); err != nil {
		return nil, err
	}
	if err := s.Store.SetJobFinished(ctx, jobID, NowMs()); err != nil {
		return nil, err
	}
	updated, err := s.Store.GetJob(ctx, jobID)
	if err != nil {
		return nil, err
	}
	if updated == nil {
		return nil, nil
	}
	msg, err := contracts.NewMessage(contracts.MsgJobUpdate, *updated)
	if err != nil {
		return nil, err
	}
	return []contracts.Message{msg}, nil
}
