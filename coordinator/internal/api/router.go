package api

import (
	"context"
	"net/http"

	"github.com/coder/websocket"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/service"
)

const maxJobRequestBytes = 16 * 1024 * 1024

type Handler struct {
	svc *service.Service
}

func NewRouter(svc *service.Service) http.Handler {
	h := &Handler{svc: svc}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /{$}", h.root)
	mux.HandleFunc("POST /create_room", h.createRoom)
	mux.HandleFunc("GET /rooms/passwordless", h.listPasswordlessRooms)
	mux.HandleFunc("DELETE /rooms/{room_id}", h.deleteRoom)
	mux.HandleFunc("GET /ws/{room_id}/{client_token}", h.clientWS)
	mux.HandleFunc("GET /ws/join_room/{room_id}/{room_token}", h.workerWS)
	mux.HandleFunc("POST /room/{room_id}/job/submit", h.submitJob)
	mux.HandleFunc("GET /room/{room_id}/job/{job_id}", h.getJob)

	return corsMiddleware(mux)
}

func (h *Handler) root(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("hello from coordinator"))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func acceptWS(w http.ResponseWriter, r *http.Request) (*websocket.Conn, error) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		return nil, err
	}
	ws.SetReadLimit(maxJobRequestBytes)
	return ws, nil
}

func writePump(ctx context.Context, ws *websocket.Conn, conn *service.Conn) {
	for {
		select {
		case msg := <-conn.Send:
			if err := ws.Write(ctx, websocket.MessageText, msg); err != nil {
				return
			}
		case <-conn.Done:
			return
		case <-ctx.Done():
			return
		}
	}
}
