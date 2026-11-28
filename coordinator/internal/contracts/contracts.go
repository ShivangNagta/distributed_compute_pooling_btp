package contracts

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Status enums

type RoomStatus string

const (
	RoomStatusActive RoomStatus = "active"
	RoomStatusClosed RoomStatus = "closed"
)

func ParseRoomStatus(s string) (RoomStatus, bool) {
	switch RoomStatus(s) {
	case RoomStatusActive, RoomStatusClosed:
		return RoomStatus(s), true
	default:
		return "", false
	}
}

type WorkerStatus string

const (
	WorkerStatusConnected    WorkerStatus = "connected"
	WorkerStatusBusy         WorkerStatus = "busy"
	WorkerStatusDisconnected WorkerStatus = "disconnected"
)

func ParseWorkerStatus(s string) (WorkerStatus, bool) {
	switch WorkerStatus(s) {
	case WorkerStatusConnected, WorkerStatusBusy, WorkerStatusDisconnected:
		return WorkerStatus(s), true
	default:
		return "", false
	}
}

type JobStatus string

const (
	JobStatusCreated   JobStatus = "created"
	JobStatusRunning   JobStatus = "running"
	JobStatusCompleted JobStatus = "completed"
	JobStatusFailed    JobStatus = "failed"
)

func ParseJobStatus(s string) (JobStatus, bool) {
	switch JobStatus(s) {
	case JobStatusCreated, JobStatusRunning, JobStatusCompleted, JobStatusFailed:
		return JobStatus(s), true
	default:
		return "", false
	}
}

type TaskStatus string

const (
	TaskStatusPending   TaskStatus = "pending"
	TaskStatusAssigned  TaskStatus = "assigned"
	TaskStatusRunning   TaskStatus = "running"
	TaskStatusCompleted TaskStatus = "completed"
	TaskStatusFailed    TaskStatus = "failed"
)

func ParseTaskStatus(s string) (TaskStatus, bool) {
	switch TaskStatus(s) {
	case TaskStatusPending, TaskStatusAssigned, TaskStatusRunning, TaskStatusCompleted, TaskStatusFailed:
		return TaskStatus(s), true
	default:
		return "", false
	}
}

type ArtifactKind string

const (
	ArtifactKindWasm          ArtifactKind = "wasm"
	ArtifactKindShaderCompute ArtifactKind = "shader_compute"
)

func ParseArtifactKind(s string) (ArtifactKind, bool) {
	switch ArtifactKind(s) {
	case ArtifactKindWasm, ArtifactKindShaderCompute:
		return ArtifactKind(s), true
	default:
		return "", false
	}
}

// Domain types

type GpuInformation struct {
	Vendor       *string `json:"vendor"`
	Architecture *string `json:"architecture"`
	Device       *string `json:"device"`
	Description  *string `json:"description"`
}

type Capabilities struct {
	Cores     *int32          `json:"cores"`
	MemoryGB  *int32          `json:"memory_gb"`
	Platform  *string         `json:"platform"`
	UserAgent *string         `json:"user_agent"`
	GPU       *GpuInformation `json:"gpu"`
}

type Room struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	ClientToken string     `json:"client_token"`
	WorkerToken string     `json:"worker_token"`
	Status      RoomStatus `json:"status"`
	CreatedAt   int64      `json:"created_at"`
}

type Worker struct {
	ID           string       `json:"id"`
	RoomID       string       `json:"room_id"`
	Status       WorkerStatus `json:"status"`
	Capabilities Capabilities `json:"capabilities"`
	LastSeenAt   int64        `json:"last_seen_at"`
}

// File represents an artifact file sent to a worker (e.g. main.wasm, shader.wgsl).
type File struct {
	Name    string  `json:"name"`
	Content string  `json:"content"`
	Mime    *string `json:"mime"`
}

// Artifact is the executable payload of a job.
type Artifact struct {
	EntryPoint string       `json:"entry_point"`
	Files      []File       `json:"files"`
	Kind       ArtifactKind `json:"kind"`
}

type artifactAlias Artifact

func (a *Artifact) UnmarshalJSON(data []byte) error {
	var raw artifactAlias
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if raw.Kind == "" {
		raw.Kind = ArtifactKindWasm
	} else if _, ok := ParseArtifactKind(string(raw.Kind)); !ok {
		return fmt.Errorf("unknown artifact kind: %q", raw.Kind)
	}
	if raw.Files == nil {
		raw.Files = []File{}
	}
	*a = Artifact(raw)
	return nil
}

func (a Artifact) MarshalJSON() ([]byte, error) {
	out := artifactAlias(a)
	if out.Kind == "" {
		out.Kind = ArtifactKindWasm
	}
	if out.Files == nil {
		out.Files = []File{}
	}
	return json.Marshal(out)
}

type Job struct {
	ID         string    `json:"id"`
	RoomID     string    `json:"room_id"`
	Name       string    `json:"name"`
	Artifact   Artifact  `json:"artifact"`
	Status     JobStatus `json:"status"`
	CreatedAt  int64     `json:"created_at"`
	StartedAt  *int64    `json:"started_at"`
	FinishedAt *int64    `json:"finished_at"`
}

type Task struct {
	ID              string           `json:"id"`
	JobID           string           `json:"job_id"`
	WorkerID        *string          `json:"worker_id"`
	Status          TaskStatus       `json:"status"`
	Input           json.RawMessage  `json:"input"`
	Result          *json.RawMessage `json:"result"`
	Error           *string          `json:"error"`
	ExecutionTimeMs *int64           `json:"execution_time_ms"`
}

type taskAlias Task

func (t Task) MarshalJSON() ([]byte, error) {
	out := taskAlias(t)
	if len(bytes.TrimSpace(out.Input)) == 0 {
		out.Input = json.RawMessage("null")
	}
	return json.Marshal(out)
}

// Wire contract (one tagged envelope used on both WebSocket channels)

type MessageType string

const (
	MsgCapabilities MessageType = "capabilities"
	MsgWorkerJoined MessageType = "worker_joined"
	MsgWorkerLeft   MessageType = "worker_left"
	MsgJobArtifact  MessageType = "job_artifact"
	MsgTaskAssign   MessageType = "task_assign"
	MsgTaskStarted  MessageType = "task_started"
	MsgTaskResult   MessageType = "task_result"
	MsgTaskFailed   MessageType = "task_failed"
	MsgJobUpdate    MessageType = "job_update"
	MsgTaskUpdate   MessageType = "task_update"
	MsgError        MessageType = "error"
)

func isValidMessageType(t MessageType) bool {
	switch t {
	case MsgCapabilities,
		MsgWorkerJoined,
		MsgWorkerLeft,
		MsgJobArtifact,
		MsgTaskAssign,
		MsgTaskStarted,
		MsgTaskResult,
		MsgTaskFailed,
		MsgJobUpdate,
		MsgTaskUpdate,
		MsgError:
		return true
	default:
		return false
	}
}

type WorkerLeftPayload struct {
	WorkerID string `json:"worker_id"`
}

type JobArtifactPayload struct {
	JobID    string   `json:"job_id"`
	Artifact Artifact `json:"artifact"`
}

type TaskStartedPayload struct {
	TaskID string `json:"task_id"`
}

type TaskResultPayload struct {
	TaskID          string          `json:"task_id"`
	Result          json.RawMessage `json:"result"`
	ExecutionTimeMs uint64          `json:"execution_time_ms"`
}

type TaskFailedPayload struct {
	TaskID string `json:"task_id"`
	Error  string `json:"error"`
}

type ErrorPayload struct {
	Reason string `json:"reason"`
}

type Message struct {
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func (m *Message) UnmarshalJSON(data []byte) error {
	type messageAlias struct {
		Type    MessageType     `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	var raw messageAlias
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	if !isValidMessageType(raw.Type) {
		return fmt.Errorf("unknown message type: %q", raw.Type)
	}
	if len(bytes.TrimSpace(raw.Payload)) == 0 {
		return fmt.Errorf("missing payload for message type: %q", raw.Type)
	}
	m.Type = raw.Type
	m.Payload = raw.Payload
	return nil
}

func NewMessage(msgType MessageType, payload any) (Message, error) {
	if !isValidMessageType(msgType) {
		return Message{}, fmt.Errorf("unknown message type: %q", msgType)
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return Message{}, err
	}
	return Message{
		Type:    msgType,
		Payload: encoded,
	}, nil
}

func DecodePayload[T any](m Message) (T, error) {
	var out T
	err := json.Unmarshal(m.Payload, &out)
	return out, err
}

// RawPtr returns a pointer to a copy of raw, or nil if raw is empty.
func RawPtr(raw json.RawMessage) *json.RawMessage {
	if len(bytes.TrimSpace(raw)) == 0 {
		return nil
	}
	cp := make(json.RawMessage, len(raw))
	copy(cp, raw)
	return &cp
}
