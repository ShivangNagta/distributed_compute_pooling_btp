package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/service"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/store"
)

func strPtr(s string) *string { return &s }

func setupTestRouter(t *testing.T) (*service.Service, http.Handler) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("store.Open failed: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatalf("Migrate failed: %v", err)
	}
	svc := service.New(st)
	return svc, NewRouter(svc)
}

func seedJob(t *testing.T, svc *service.Service, roomID string) contracts.Job {
	t.Helper()
	job := contracts.Job{
		ID:        "job-1",
		RoomID:    roomID,
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
		Input:    json.RawMessage(`{"a":1}`),
	}
	if err := svc.Store.CreateJob(context.Background(), job, []contracts.Task{task}); err != nil {
		t.Fatalf("CreateJob failed: %v", err)
	}
	return job
}

func TestCreateRoomReturnsTokens(t *testing.T) {
	_, router := setupTestRouter(t)

	req := httptest.NewRequest(http.MethodPost, "/create_room", strings.NewReader(`{"passwordless":false}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp createRoomResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json response: %v", err)
	}
	if resp.RoomID == "" || resp.ClientToken == "" || resp.WorkerToken == "" {
		t.Fatalf("expected non-empty room tokens: %+v", resp)
	}
}

func TestGetJobReturnsPersistedState(t *testing.T) {
	svc, router := setupTestRouter(t)
	room, _ := svc.CreateRoom(context.Background(), false)
	job := seedJob(t, svc, room.ID)

	req := httptest.NewRequest(http.MethodGet, "/room/"+room.ID+"/job/"+job.ID, nil)
	req.Header.Set("Authorization", "Bearer "+room.ClientToken)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetJobRequiresAuth(t *testing.T) {
	svc, router := setupTestRouter(t)
	room, _ := svc.CreateRoom(context.Background(), false)
	job := seedJob(t, svc, room.ID)

	req := httptest.NewRequest(http.MethodGet, "/room/"+room.ID+"/job/"+job.ID, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestGetJobRejectsWrongRoomForToken(t *testing.T) {
	svc, router := setupTestRouter(t)
	room, _ := svc.CreateRoom(context.Background(), false)
	other, _ := svc.CreateRoom(context.Background(), false)
	job := seedJob(t, svc, other.ID)

	req := httptest.NewRequest(http.MethodGet, "/room/"+room.ID+"/job/"+job.ID, nil)
	req.Header.Set("Authorization", "Bearer "+room.ClientToken)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestSubmitJobCreatesAndDispatches(t *testing.T) {
	svc, router := setupTestRouter(t)
	room, _ := svc.CreateRoom(context.Background(), false)
	svc.RegisterWorkerConn("worker-1")

	body := map[string]any{
		"name": "add",
		"artifact": map[string]any{
			"entry_point": "add",
			"files": []map[string]any{
				{"name": "main.wasm", "content": "AGFzbQ==", "mime": "application/wasm"},
			},
		},
		"tasks": []map[string]any{
			{"worker_id": "worker-1", "input": []int{1, 2}},
		},
	}
	raw, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/room/"+room.ID+"/job/submit", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+room.ClientToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSubmitAcceptsRequestLargerThan2MB(t *testing.T) {
	svc, router := setupTestRouter(t)
	room, _ := svc.CreateRoom(context.Background(), false)

	body := map[string]any{
		"name":        "large image upload",
		"artifact":    map[string]any{"entry_point": "main", "files": []any{}},
		"tasks":       []any{},
		"large_field": strings.Repeat("x", 2*1024*1024),
	}
	raw, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, "/room/"+room.ID+"/job/submit", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+room.ClientToken)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestPasswordlessAndDeleteRoomRoutes(t *testing.T) {
	_, router := setupTestRouter(t)

	// Create one passwordless room and one protected room.
	for _, body := range []string{`{"passwordless":true}`, `{"passwordless":false}`} {
		req := httptest.NewRequest(http.MethodPost, "/create_room", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("create_room failed: %d", rec.Code)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/rooms/passwordless", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list passwordless failed: %d", rec.Code)
	}
	var rooms []contracts.Room
	if err := json.Unmarshal(rec.Body.Bytes(), &rooms); err != nil {
		t.Fatalf("unmarshal rooms failed: %v", err)
	}
	if len(rooms) != 1 {
		t.Fatalf("expected 1 passwordless room, got %d", len(rooms))
	}

	delReq := httptest.NewRequest(http.MethodDelete, "/rooms/"+rooms[0].ID, nil)
	delRec := httptest.NewRecorder()
	router.ServeHTTP(delRec, delReq)
	if delRec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", delRec.Code)
	}
}

type pipeListener struct {
	conns  chan net.Conn
	closed chan struct{}
}

func newPipeListener() *pipeListener {
	return &pipeListener{
		conns:  make(chan net.Conn),
		closed: make(chan struct{}),
	}
}

func (l *pipeListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.conns:
		return c, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *pipeListener) Close() error {
	select {
	case <-l.closed:
	default:
		close(l.closed)
	}
	return nil
}

func (l *pipeListener) Addr() net.Addr {
	return &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 3000}
}

func (l *pipeListener) DialContext(ctx context.Context, _, _ string) (net.Conn, error) {
	clientConn, serverConn := net.Pipe()
	select {
	case l.conns <- serverConn:
		return clientConn, nil
	case <-l.closed:
		_ = clientConn.Close()
		_ = serverConn.Close()
		return nil, errors.New("listener closed")
	case <-ctx.Done():
		_ = clientConn.Close()
		_ = serverConn.Close()
		return nil, ctx.Err()
	}
}

func TestWebSocketEndToEndFlow(t *testing.T) {
	_, router := setupTestRouter(t)
	ln := newPipeListener()
	srv := &http.Server{Handler: router}
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(func() {
		_ = srv.Close()
		_ = ln.Close()
	})

	httpClient := &http.Client{
		Transport: &http.Transport{DialContext: ln.DialContext},
	}
	baseURL := "http://coordinator.local"
	wsBase := "ws://coordinator.local"

	// 1. Create room
	resp, err := httpClient.Post(baseURL+"/create_room", "application/json", strings.NewReader(`{"passwordless":false}`))
	if err != nil {
		t.Fatalf("create_room failed: %v", err)
	}
	defer resp.Body.Close()
	var room createRoomResponse
	if err := json.NewDecoder(resp.Body).Decode(&room); err != nil {
		t.Fatalf("decode create_room failed: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// 2. Connect client and worker WebSockets
	dialOpts := &websocket.DialOptions{HTTPClient: httpClient}
	clientWS, _, err := websocket.Dial(ctx, wsBase+"/ws/"+room.RoomID+"/"+room.ClientToken, dialOpts)
	if err != nil {
		t.Fatalf("client ws dial failed: %v", err)
	}
	defer func() { _ = clientWS.CloseNow() }()

	workerWS, _, err := websocket.Dial(ctx, wsBase+"/ws/join_room/"+room.RoomID+"/"+room.WorkerToken, dialOpts)
	if err != nil {
		t.Fatalf("worker ws dial failed: %v", err)
	}
	defer func() { _ = workerWS.CloseNow() }()

	// 3. Worker sends capabilities -> Client receives worker_joined
	cores := int32(4)
	capsMsg, _ := contracts.NewMessage(contracts.MsgCapabilities, contracts.Capabilities{Cores: &cores})
	capsBytes, _ := json.Marshal(capsMsg)
	if err := workerWS.Write(ctx, websocket.MessageText, capsBytes); err != nil {
		t.Fatalf("worker write capabilities failed: %v", err)
	}

	_, rawJoined, err := clientWS.Read(ctx)
	if err != nil {
		t.Fatalf("client read worker_joined failed: %v", err)
	}
	var joinedMsg contracts.Message
	if err := json.Unmarshal(rawJoined, &joinedMsg); err != nil || joinedMsg.Type != contracts.MsgWorkerJoined {
		t.Fatalf("expected worker_joined, got %s (%v)", string(rawJoined), err)
	}
	joinedWorker, err := contracts.DecodePayload[contracts.Worker](joinedMsg)
	if err != nil {
		t.Fatalf("decode joined worker failed: %v", err)
	}

	// 4. Submit job for that worker
	submitBody, _ := json.Marshal(map[string]any{
		"name": "add",
		"artifact": map[string]any{
			"entry_point": "add",
			"files": []map[string]any{
				{"name": "main.wasm", "content": "AGFzbQ==", "mime": "application/wasm"},
			},
		},
		"tasks": []map[string]any{
			{"worker_id": joinedWorker.ID, "input": []int{2, 3}},
		},
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/room/"+room.RoomID+"/job/submit", bytes.NewReader(submitBody))
	req.Header.Set("Authorization", "Bearer "+room.ClientToken)
	req.Header.Set("Content-Type", "application/json")
	subResp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("submit job failed: %v", err)
	}
	defer subResp.Body.Close()
	if subResp.StatusCode != http.StatusOK {
		t.Fatalf("submit job status = %d", subResp.StatusCode)
	}

	// 5. Worker reads job_artifact and task_assign
	_, rawArt, err := workerWS.Read(ctx)
	if err != nil {
		t.Fatalf("worker read artifact failed: %v", err)
	}
	var artMsg contracts.Message
	_ = json.Unmarshal(rawArt, &artMsg)
	if artMsg.Type != contracts.MsgJobArtifact {
		t.Fatalf("expected job_artifact, got %s", artMsg.Type)
	}

	_, rawAssign, err := workerWS.Read(ctx)
	if err != nil {
		t.Fatalf("worker read task_assign failed: %v", err)
	}
	var assignMsg contracts.Message
	_ = json.Unmarshal(rawAssign, &assignMsg)
	if assignMsg.Type != contracts.MsgTaskAssign {
		t.Fatalf("expected task_assign, got %s", assignMsg.Type)
	}
	assignedTask, _ := contracts.DecodePayload[contracts.Task](assignMsg)

	// 6. Worker sends task_result -> client eventually observes completed job_update
	resMsg, _ := contracts.NewMessage(contracts.MsgTaskResult, contracts.TaskResultPayload{
		TaskID:          assignedTask.ID,
		Result:          json.RawMessage(`5`),
		ExecutionTimeMs: 12,
	})
	resBytes, _ := json.Marshal(resMsg)
	if err := workerWS.Write(ctx, websocket.MessageText, resBytes); err != nil {
		t.Fatalf("worker write task_result failed: %v", err)
	}

	for {
		_, rawEv, err := clientWS.Read(ctx)
		if err != nil {
			t.Fatalf("client read failed waiting for job_update: %v", err)
		}
		var ev contracts.Message
		_ = json.Unmarshal(rawEv, &ev)
		if ev.Type == contracts.MsgJobUpdate {
			job, _ := contracts.DecodePayload[contracts.Job](ev)
			if job.Status == contracts.JobStatusCompleted {
				break
			}
		}
	}
}
