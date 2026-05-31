package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
)

// Envelope wraps successful responses. No omitempty on JSON tags (GO-5).
type Envelope struct {
	Data any `json:"data"`
}

// ErrorResponse is the standard error envelope.
type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

// ErrorBody contains error details.
type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
	Details   any    `json:"details"`
}

// WriteJSON writes a successful JSON response with the standard envelope.
func WriteJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(Envelope{Data: data}); err != nil {
		slog.Warn("write json response failed", "error", err)
	}
}

// WriteError writes an error JSON response with the standard error envelope.
func WriteError(w http.ResponseWriter, r *http.Request, status int, code string, message string, details any) {
	requestID, _ := r.Context().Value(model.RequestID).(string)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(ErrorResponse{
		Error: ErrorBody{
			Code:      code,
			Message:   message,
			RequestID: requestID,
			Details:   details,
		},
	}); err != nil {
		slog.Warn("write error response failed", "error", err)
	}
}
