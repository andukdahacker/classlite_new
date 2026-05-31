package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ducdo/classlite-api/internal/config"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()

	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	cfg.LogSummary()

	// Connect to PostgreSQL.
	pool, err := store.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("database connected")

	mux := http.NewServeMux()

	healthHandler := &handler.HealthHandler{Pool: pool}
	mux.HandleFunc("GET /health", healthHandler.Check)

	// Upload endpoints — auth wrapping added in story 1.4+.
	var uploadStorage service.StorageService = service.NewMockStorageService()
	if cfg.R2AccountID != "" {
		uploadStorage = service.NewR2StorageService(cfg.R2AccountID, cfg.R2AccessKeyID, cfg.R2SecretAccessKey, cfg.R2BucketName)
	}
	uploadHandler := &handler.UploadHandler{Storage: uploadStorage}
	mux.HandleFunc("POST /api/uploads/presign", middleware.ErrorMapper(uploadHandler.Presign))
	mux.HandleFunc("POST /api/uploads/confirm", middleware.ErrorMapper(uploadHandler.Confirm))

	// Middleware chain order: RequestID → Logger → CORS → RateLimit → mux
	// 200 requests per minute = ~3.33 per second, burst allows short spikes.
	wrapped := middleware.RequestID(
		middleware.Logger(
			middleware.CORS(cfg.CORSOrigins)(
				middleware.RateLimit(200.0/60.0, 200)(mux),
			),
		),
	)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      wrapped,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("server starting", "port", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
	slog.Info("server stopped")
}
