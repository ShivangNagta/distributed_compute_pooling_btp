package api

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/apperr"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/contracts"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/imageproc"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/service"
	"github.com/ShivangNagta/distributed_compute_pooling_btp/coordinator/internal/shader"
)

type submitJobRequest struct {
	Name     string             `json:"name"`
	Artifact contracts.Artifact `json:"artifact"`
	Tasks    []service.NewTask  `json:"tasks"`
	Metadata map[string]any     `json:"metadata"`
}

type submitJobResponse struct {
	JobID string `json:"job_id"`
}

type jobResponse struct {
	Job   contracts.Job    `json:"job"`
	Tasks []contracts.Task `json:"tasks"`
}

func clientTokenFromHeader(r *http.Request) (string, bool) {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return "", false
	}
	return strings.TrimPrefix(auth, "Bearer "), true
}

func (h *Handler) authenticatedRoom(r *http.Request, roomID string) (*contracts.Room, error) {
	token, ok := clientTokenFromHeader(r)
	if !ok {
		return nil, apperr.Unauthorized()
	}
	room, err := h.svc.Store.GetRoomByClientToken(r.Context(), token)
	if err != nil {
		return nil, err
	}
	if room == nil || room.ID != roomID {
		return nil, apperr.NotFound()
	}
	return room, nil
}

func (h *Handler) submitJob(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	if _, err := h.authenticatedRoom(r, roomID); err != nil {
		apperr.WriteHTTP(w, err)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxJobRequestBytes)
	var req submitJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apperr.WriteHTTP(w, apperr.BadRequest(err.Error()))
		return
	}

	artifact := req.Artifact
	tasks := req.Tasks

	jobType, _ := req.Metadata["type"].(string)
	switch jobType {
	case "wgsl":
		prepared, specs, err := shader.PrepareJob(artifact, workerIDs(tasks), req.Metadata)
		if err != nil {
			apperr.WriteHTTP(w, err)
			return
		}
		artifact = prepared
		tasks = toNewTasks(specs)
	case "image_processing":
		prepared, specs, err := imageproc.PrepareJob(artifact, workerIDs(tasks))
		if err != nil {
			apperr.WriteHTTP(w, err)
			return
		}
		artifact = prepared
		tasks = toNewTasks(specs)
	}

	job, err := h.svc.SubmitJob(r.Context(), roomID, req.Name, artifact, tasks)
	if err != nil {
		apperr.WriteHTTP(w, err)
		return
	}
	apperr.WriteJSON(w, http.StatusOK, submitJobResponse{JobID: job.ID})
}

func (h *Handler) getJob(w http.ResponseWriter, r *http.Request) {
	roomID := r.PathValue("room_id")
	if _, err := h.authenticatedRoom(r, roomID); err != nil {
		apperr.WriteHTTP(w, err)
		return
	}

	jobID := r.PathValue("job_id")
	job, err := h.svc.Store.GetJob(r.Context(), jobID)
	if err != nil {
		apperr.WriteHTTP(w, err)
		return
	}
	if job == nil || job.RoomID != roomID {
		apperr.WriteHTTP(w, apperr.NotFound())
		return
	}

	tasks, err := h.svc.Store.GetTasksByJob(r.Context(), jobID)
	if err != nil {
		apperr.WriteHTTP(w, err)
		return
	}

	apperr.WriteJSON(w, http.StatusOK, jobResponse{Job: *job, Tasks: tasks})
}

func workerIDs(tasks []service.NewTask) []string {
	ids := make([]string, len(tasks))
	for i, t := range tasks {
		ids[i] = t.WorkerID
	}
	return ids
}

func toNewTasks(specs []shader.TaskSpec) []service.NewTask {
	out := make([]service.NewTask, len(specs))
	for i, s := range specs {
		out[i] = service.NewTask{
			WorkerID: s.WorkerID,
			Input:    s.Input,
		}
	}
	return out
}
