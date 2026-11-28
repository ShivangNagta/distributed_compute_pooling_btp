package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/coder/websocket"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
)

func (h *Handler) workerWS(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	roomToken := r.PathValue("room_token")

	room, err := h.svc.Store.GetRoom(r.Context(), roomID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if room == nil || room.Status != contracts.RoomStatusActive {
		http.Error(w, "Room is not active", http.StatusNotFound)
		return
	}
	if room.WorkerToken != roomToken {
		http.Error(w, "Invalid room token", http.StatusUnauthorized)
		return
	}

	ws, err := acceptWS(w, r)
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()

	worker, err := h.svc.RegisterWorker(r.Context(), roomID)
	if err != nil {
		return
	}

	conn := h.svc.RegisterWorkerConn(worker.ID)
	done := make(chan struct{})
	go func() {
		defer close(done)
		writePump(r.Context(), ws, conn)
	}()

	for {
		msgType, data, err := ws.Read(r.Context())
		if err != nil {
			break
		}
		if msgType != websocket.MessageText {
			continue
		}

		var msg contracts.Message
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		events, err := h.svc.HandleWorkerMessage(r.Context(), worker.ID, msg)
		if err != nil {
			if errMsg, mkErr := contracts.NewMessage(contracts.MsgError, contracts.ErrorPayload{Reason: err.Error()}); mkErr == nil {
				h.svc.SendToClient(room.ClientToken, errMsg)
			}
			continue
		}
		h.svc.SendMessagesToClient(room.ClientToken, events)
	}

	h.svc.UnregisterWorkerConn(worker.ID, conn)
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if events, err := h.svc.RemoveWorker(cleanupCtx, worker.ID); err == nil {
		h.svc.SendMessagesToClient(room.ClientToken, events)
	}

	<-done
}
