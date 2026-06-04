package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/mail"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ducdo/classlite-api/internal/config"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
	"golang.org/x/time/rate"
)

// maxResendBodyBytes caps the body the per-email rate-limit keyFn will read.
// Mirrors the handler's body cap so the limiter cannot be tricked into
// allocating unbounded memory before the handler's MaxBytesReader takes over.
const maxResendBodyBytes = 16 * 1024

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg := config.Load()

	if err := cfg.Validate(); err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	cfg.LogSummary()

	pool, err := store.NewPool(context.Background(), cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()
	slog.Info("database connected")

	// Email sender — Resend if configured, else MockEmailSender for dev.
	var emailSender service.EmailSender
	if cfg.ResendAPIKey != "" {
		rs, err := service.NewResendEmailSender(cfg.ResendAPIKey, cfg.ResendFromEmail)
		if err != nil {
			slog.Error("resend sender init failed", "error", err)
			os.Exit(1)
		}
		emailSender = rs
		slog.Info("email sender: resend")
	} else {
		emailSender = &service.MockEmailSender{}
		slog.Warn("email sender mocked — no RESEND_API_KEY set; verification emails will not actually be delivered")
	}

	// Story 1.4 dependencies.
	authAudit := service.NewPgAuthAuditLogger(pool)
	retryQ := service.NewEmailRetryQueue(emailSender, 256)
	hasher := service.BcryptHasher{Cost: 12}
	authSvc := service.NewAuthService(pool, hasher, emailSender, authAudit, retryQ, cfg.AppVerifyURLBase)

	// Long-lived context that survives request cancellations — the retry worker
	// must keep running until graceful shutdown signals.
	workerCtx, cancelWorker := context.WithCancel(context.Background())
	go retryQ.Start(workerCtx)

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

	// Auth routes (story 1.4) — register + resend get per-IP throttling; resend
	// additionally gets per-email throttling. verify-email and verify-status use
	// only the global limiter (AC10).
	authHandler := &handler.AuthHandler{Svc: authSvc}

	registerIPLimit := middleware.RateLimitByKey(
		"auth-register",
		rate.Every(2*time.Minute), // 1 token per 2 min
		5,                         // burst 5 (per AC9 / B3)
		middleware.IPKeyFn,
	)
	resendIPLimit := middleware.RateLimitByKey(
		"auth-resend-ip",
		rate.Every(2*time.Minute),
		5,
		middleware.IPKeyFn,
	)
	resendEmailLimit := middleware.RateLimitByKey(
		"resend-email",
		rate.Every(60*time.Second),
		1,
		resendEmailKeyFn,
	)

	mux.Handle("POST /api/auth/register",
		registerIPLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.Register))))
	mux.Handle("POST /api/auth/verify-email",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.VerifyEmail)))
	mux.Handle("POST /api/auth/resend-verification",
		resendBodyGate(resendIPLimit(resendEmailLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.ResendVerification))))))
	mux.Handle("GET /api/auth/verify-status",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.VerifyStatus)))

	// Middleware chain order: RequestID → ClientIP → Logger → CORS → global RateLimit → mux
	// Per-route limiters are wired into the mux entries above (they sit BETWEEN
	// the global limiter and the handler, on a per-route basis).
	wrapped := middleware.RequestID(
		middleware.ClientIP(
			middleware.Logger(
				middleware.CORS(cfg.CORSOrigins)(
					middleware.RateLimit(200.0/60.0, 200)(mux),
				),
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

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("server shutdown error", "error", err)
	}
	cancelWorker()
	slog.Info("server stopped")
}

// resendEmailKeyFn implements Task 8 / H3: returns the normalized email as
// the per-email bucket key.
//
// Pre-conditions established by resendBodyGate (which runs BEFORE this keyFn):
//   - r.Body has been read into r.Context() at resendBodyKey, then restored
//   - the body is at most maxResendBodyBytes
//   - body-read errors have already been short-circuited with a 400
//
// Returns "" on:
//   - JSON parse failure (per spec H3 — incoherent body has no key; handler
//     will return 422)
//   - missing / unparseable email (so per-email visitor map cannot be filled
//     with unbounded attacker-controlled garbage keys)
//
// On valid input returns the RFC-mailbox-normalized email. This is the same
// normalization the AuthService uses, so the limiter bucket matches the
// uniqueness key.
func resendEmailKeyFn(r *http.Request) string {
	body, _ := r.Context().Value(resendBodyKey).([]byte)
	if len(body) == 0 {
		return ""
	}
	var decoded struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return ""
	}
	candidate := strings.TrimSpace(decoded.Email)
	if candidate == "" {
		return ""
	}
	parsed, err := mail.ParseAddress(candidate)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(parsed.Address))
}

// resendBodyKeyType is the context-key type for the cached body payload that
// resendBodyGate stashes for resendEmailKeyFn / the downstream handler.
type resendBodyKeyType struct{}

var resendBodyKey resendBodyKeyType

// resendBodyGate reads and caps the request body once, stashes it in context,
// restores r.Body for downstream consumers, and short-circuits with 400 on a
// read failure (review decision D2 — body-read errors should not bypass the
// per-email rate limiter the way JSON parse failures do, since they look like
// targeted attempts to evade the bucket key).
func resendBodyGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxResendBodyBytes)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeBadRequestJSON(w, r, "INVALID_BODY", "Request body could not be read.")
			return
		}
		ctx := context.WithValue(r.Context(), resendBodyKey, body)
		// GFW-6: restore the body so downstream Decoders still work.
		r2 := r.Clone(ctx)
		r2.Body = io.NopCloser(bytes.NewBuffer(body))
		next.ServeHTTP(w, r2)
	})
}

// writeBadRequestJSON emits the envelope-shaped 400 response used by the
// resend body gate when the body cannot be read.
func writeBadRequestJSON(w http.ResponseWriter, r *http.Request, code, message string) {
	requestID, _ := r.Context().Value(model.RequestID).(string)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":      code,
			"message":   message,
			"requestId": requestID,
			"details":   nil,
		},
	})
}
