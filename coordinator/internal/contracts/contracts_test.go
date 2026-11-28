package contracts

import (
	"encoding/json"
	"testing"
)

func strPtr(s string) *string { return &s }
func i32Ptr(v int32) *int32   { return &v }

func TestCapabilitiesRoundTripsWithPayload(t *testing.T) {
	msg, err := NewMessage(MsgCapabilities, Capabilities{
		Cores:     i32Ptr(8),
		MemoryGB:  i32Ptr(16),
		Platform:  strPtr("macOS"),
		UserAgent: strPtr("test"),
	})
	if err != nil {
		t.Fatalf("NewMessage failed: %v", err)
	}

	raw, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatalf("Unmarshal map failed: %v", err)
	}
	if envelope["type"] != "capabilities" {
		t.Fatalf("expected type capabilities, got %v", envelope["type"])
	}
	payload := envelope["payload"].(map[string]any)
	if payload["cores"] != float64(8) {
		t.Fatalf("expected cores 8, got %v", payload["cores"])
	}

	var back Message
	if err := json.Unmarshal(raw, &back); err != nil {
		t.Fatalf("Unmarshal Message failed: %v", err)
	}
	caps, err := DecodePayload[Capabilities](back)
	if err != nil {
		t.Fatalf("DecodePayload failed: %v", err)
	}
	if caps.Cores == nil || *caps.Cores != 8 {
		t.Fatalf("expected cores 8, got %v", caps.Cores)
	}
}

func TestJobArtifactCarriesMultipleFiles(t *testing.T) {
	artifact := Artifact{
		EntryPoint: "sum",
		Files: []File{
			{Name: "main.wasm", Content: "AGFzbQ==", Mime: strPtr("application/wasm")},
			{Name: "data.csv", Content: "MSwy", Mime: strPtr("text/csv")},
		},
		Kind: ArtifactKindWasm,
	}

	msg, err := NewMessage(MsgJobArtifact, JobArtifactPayload{
		JobID:    "job-1",
		Artifact: artifact,
	})
	if err != nil {
		t.Fatalf("NewMessage failed: %v", err)
	}

	raw, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if value["type"] != "job_artifact" {
		t.Fatalf("expected job_artifact, got %v", value["type"])
	}
	p := value["payload"].(map[string]any)
	art := p["artifact"].(map[string]any)
	if art["entry_point"] != "sum" {
		t.Fatalf("expected entry_point sum, got %v", art["entry_point"])
	}
	files := art["files"].([]any)
	if len(files) != 2 {
		t.Fatalf("expected 2 files, got %d", len(files))
	}
}

func TestTaskResultIsFlatWithinPayload(t *testing.T) {
	msg, err := NewMessage(MsgTaskResult, TaskResultPayload{
		TaskID:          "t1",
		Result:          json.RawMessage("3"),
		ExecutionTimeMs: 42,
	})
	if err != nil {
		t.Fatalf("NewMessage failed: %v", err)
	}

	raw, err := json.Marshal(msg)
	if err != nil {
		t.Fatalf("Marshal failed: %v", err)
	}

	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("Unmarshal failed: %v", err)
	}
	if value["type"] != "task_result" {
		t.Fatalf("expected task_result, got %v", value["type"])
	}
	p := value["payload"].(map[string]any)
	if p["task_id"] != "t1" {
		t.Fatalf("expected t1, got %v", p["task_id"])
	}
	if p["execution_time_ms"] != float64(42) {
		t.Fatalf("expected 42, got %v", p["execution_time_ms"])
	}
	if p["result"] != float64(3) {
		t.Fatalf("expected 3, got %v", p["result"])
	}
}

func TestUnknownVariantIsRejected(t *testing.T) {
	var m Message
	if err := json.Unmarshal([]byte(`{"type":"nope"}`), &m); err == nil {
		t.Fatal("expected error for unknown message type")
	}
}

func TestStatusParsing(t *testing.T) {
	if RoomStatusActive != "active" {
		t.Fatalf("unexpected active status: %q", RoomStatusActive)
	}
	if s, ok := ParseRoomStatus("closed"); !ok || s != RoomStatusClosed {
		t.Fatalf("ParseRoomStatus failed: %v %v", s, ok)
	}
	if s, ok := ParseTaskStatus("pending"); !ok || s != TaskStatusPending {
		t.Fatalf("ParseTaskStatus failed: %v %v", s, ok)
	}
	if s, ok := ParseWorkerStatus("busy"); !ok || s != WorkerStatusBusy {
		t.Fatalf("ParseWorkerStatus failed: %v %v", s, ok)
	}
}
