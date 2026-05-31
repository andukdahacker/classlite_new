package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/jackc/pgx/v5/pgxpool"
)

func getTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://classlite:classlite_dev_password@localhost:5432/classlite_dev?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Skipf("skipping: cannot connect to database: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Skipf("skipping: cannot ping database: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func TestHealthCheck_DBConnected(t *testing.T) {
	pool := getTestPool(t)

	h := &handler.HealthHandler{Pool: pool}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	h.Check(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "ok" {
		t.Errorf("expected status ok, got %s", body["status"])
	}
	if body["db"] != "connected" {
		t.Errorf("expected db connected, got %s", body["db"])
	}
}

func TestHealthCheck_DBDisconnected(t *testing.T) {
	// Create a pool with an invalid URL to simulate disconnected DB.
	pool, err := pgxpool.New(context.Background(), "postgres://invalid:invalid@localhost:59999/nonexistent?sslmode=disable&connect_timeout=1")
	if err != nil {
		// pgxpool.New may fail immediately with bad config — that's fine,
		// use a pool that will fail on Ping instead.
		t.Skipf("skipping: pgxpool.New failed immediately: %v", err)
	}
	defer pool.Close()

	h := &handler.HealthHandler{Pool: pool}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	h.Check(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}

	var body map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode body: %v", err)
	}
	if body["status"] != "degraded" {
		t.Errorf("expected status degraded, got %s", body["status"])
	}
	if body["db"] != "disconnected" {
		t.Errorf("expected db disconnected, got %s", body["db"])
	}
}
