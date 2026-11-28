package apperr

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

type Kind int

const (
	KindBadRequest Kind = iota
	KindUnauthorized
	KindNotFound
	KindInternal
)

type Error struct {
	Kind    Kind
	Message string
	Err     error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Message, e.Err)
	}
	return e.Message
}

func (e *Error) Unwrap() error {
	return e.Err
}

func BadRequest(msg string) error {
	return &Error{Kind: KindBadRequest, Message: msg}
}

func Unauthorized() error {
	return &Error{Kind: KindUnauthorized, Message: "unauthorized"}
}

func NotFound() error {
	return &Error{Kind: KindNotFound, Message: "not found"}
}

func Internal(msg string, err error) error {
	return &Error{Kind: KindInternal, Message: msg, Err: err}
}

func HTTPStatus(err error) (int, string) {
	var appErr *Error
	if errors.As(err, &appErr) {
		switch appErr.Kind {
		case KindBadRequest:
			return http.StatusBadRequest, appErr.Message
		case KindUnauthorized:
			return http.StatusUnauthorized, appErr.Message
		case KindNotFound:
			return http.StatusNotFound, appErr.Message
		default:
			if appErr.Err != nil {
				return http.StatusInternalServerError, appErr.Error()
			}
			return http.StatusInternalServerError, appErr.Message
		}
	}
	return http.StatusInternalServerError, err.Error()
}

func WriteHTTP(w http.ResponseWriter, err error) {
	status, msg := HTTPStatus(err)
	WriteJSON(w, status, map[string]string{"error": msg})
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
