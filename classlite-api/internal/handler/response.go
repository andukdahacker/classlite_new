package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
)

// Envelope wraps successful responses. No omitempty on JSON tags (GO-5).
type Envelope struct {
	Data any `json:"data"`
}

// EnvelopeWithMeta is the Story 2.1 envelope shape — every 2xx response
// from an onboarding + center endpoint carries meta.serverTime so the
// wizard can render clock-skew-immune "N seconds ago" affordances.
type EnvelopeWithMeta struct {
	Data any          `json:"data"`
	Meta EnvelopeMeta `json:"meta"`
}

// EnvelopeMeta carries the ambient response metadata.
type EnvelopeMeta struct {
	ServerTime time.Time `json:"serverTime"`
}

// WriteEnvelope writes a successful response with the Story 2.1
// {data, meta} envelope. clk is injected for tests; callers pass
// clock.RealClock in production.
func WriteEnvelope(w http.ResponseWriter, status int, clk clock.Clock, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(EnvelopeWithMeta{
		Data: data,
		Meta: EnvelopeMeta{ServerTime: clk.Now().UTC()},
	}); err != nil {
		slog.Warn("write envelope response failed", "error", err)
	}
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
// requestID is best-effort: passing a nil request leaves the field empty.
func WriteError(w http.ResponseWriter, r *http.Request, status int, code string, message string, details any) {
	var requestID string
	if r != nil {
		if id, ok := r.Context().Value(model.RequestID).(string); ok {
			requestID = id
		}
	}
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
