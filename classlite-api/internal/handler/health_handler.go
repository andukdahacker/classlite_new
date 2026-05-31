package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// HealthHandler serves the health check endpoint.
type HealthHandler struct {
	Pool *pgxpool.Pool
}

// Check returns the current health status of the API, including database connectivity.
func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	statusText := "ok"
	dbStatus := "connected"
	httpStatus := http.StatusOK

	if h.Pool == nil || !h.pingDB(r.Context()) {
		statusText = "degraded"
		dbStatus = "disconnected"
		httpStatus = http.StatusServiceUnavailable
	}

	w.WriteHeader(httpStatus)
	if err := json.NewEncoder(w).Encode(map[string]string{
		"status": statusText,
		"db":     dbStatus,
	}); err != nil {
		slog.Error("write health response", "error", err)
	}
}

func (h *HealthHandler) pingDB(parent context.Context) bool {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()
	if err := h.Pool.Ping(ctx); err != nil {
		slog.Error("health check: database unreachable", "error", err)
		return false
	}
	return true
}
