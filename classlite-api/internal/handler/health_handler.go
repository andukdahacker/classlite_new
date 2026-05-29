package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// HealthHandler serves the health check endpoint.
type HealthHandler struct{}

// Check returns the current health status of the API.
func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(map[string]string{"status": "ok"}); err != nil {
		slog.Error("write health response", "error", err)
	}
}
