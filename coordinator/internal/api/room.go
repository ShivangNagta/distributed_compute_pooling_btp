package api

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/apperr"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/service"
)

type createRoomRequest struct {
	Passwordless bool `json:"passwordless"`
}

type createRoomResponse struct {
	RoomID      string `json:"room_id"`
	ClientToken string `json:"client_token"`
	WorkerToken string `json:"worker_token"`
}

func (h *Handler) createRoom(w http.ResponseWriter, r *http.Request) {
	var req createRoomRequest
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		apperr.WriteHTTP(w, apperr.BadRequest("unable to read request body"))
		return
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			apperr.WriteHTTP(w, apperr.BadRequest(err.Error()))
			return
		}
	}

	room, err := h.svc.CreateRoom(r.Context(), req.Passwordless)
	if err != nil {
		apperr.WriteHTTP(w, err)
		return
	}

	apperr.WriteJSON(w, http.StatusOK, createRoomResponse{
		RoomID:      room.ID,
		ClientToken: room.ClientToken,
		WorkerToken: room.WorkerToken,
	})
}

func (h *Handler) listPasswordlessRooms(w http.ResponseWriter, r *http.Request) {
	rooms, err := h.svc.Store.ListPasswordlessRooms(r.Context(), service.PasswordlessWorkerToken())
	if err != nil {
		apperr.WriteHTTP(w, err)
		return
	}
	apperr.WriteJSON(w, http.StatusOK, rooms)
}

func (h *Handler) deleteRoom(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	if err := h.svc.DeleteRoom(r.Context(), roomID); err != nil {
		apperr.WriteHTTP(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) clientWS(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	clientToken := r.PathValue("client_token")

	room, err := h.svc.Store.GetRoom(r.Context(), roomID)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if room == nil || room.Status != contracts.RoomStatusActive {
		http.Error(w, "Room is not active", http.StatusNotFound)
		return
	}
	if room.ClientToken != clientToken {
		http.Error(w, "Invalid client token", http.StatusUnauthorized)
		return
	}

	ws, err := acceptWS(w, r)
	if err != nil {
		return
	}
	defer func() { _ = ws.CloseNow() }()

	conn := h.svc.RegisterClientConn(clientToken)
	done := make(chan struct{})
	go func() {
		defer close(done)
		writePump(r.Context(), ws, conn)
	}()

	for {
		if _, _, err := ws.Read(r.Context()); err != nil {
			break
		}
	}

	h.svc.UnregisterClientConn(clientToken, conn)
	<-done
}
