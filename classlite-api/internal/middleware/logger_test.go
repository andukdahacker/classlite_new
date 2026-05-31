package middleware_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
)

func TestLogger_LogsRequestFields(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	slog.SetDefault(logger)

	handler := middleware.Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/classes", nil)
	ctx := context.WithValue(req.Context(), model.RequestID, "test-req-123")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	var logEntry map[string]any
	if err := json.NewDecoder(&buf).Decode(&logEntry); err != nil {
		t.Fatalf("failed to decode log: %v", err)
	}

	if logEntry["method"] != "POST" {
		t.Errorf("expected method POST, got %v", logEntry["method"])
	}
	if logEntry["path"] != "/api/classes" {
		t.Errorf("expected path /api/classes, got %v", logEntry["path"])
	}
	// Status is logged as float64 from JSON.
	if logEntry["status"] != float64(201) {
		t.Errorf("expected status 201, got %v", logEntry["status"])
	}
	if logEntry["request_id"] != "test-req-123" {
		t.Errorf("expected request_id test-req-123, got %v", logEntry["request_id"])
	}
	if _, ok := logEntry["duration_ms"]; !ok {
		t.Error("expected duration_ms in log")
	}
}

func TestLogger_DefaultStatus200(t *testing.T) {
	var buf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buf, nil))
	slog.SetDefault(logger)

	handler := middleware.Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// No explicit WriteHeader — defaults to 200.
		w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	var logEntry map[string]any
	if err := json.NewDecoder(&buf).Decode(&logEntry); err != nil {
		t.Fatalf("failed to decode log: %v", err)
	}
	if logEntry["status"] != float64(200) {
		t.Errorf("expected default status 200, got %v", logEntry["status"])
	}
}
