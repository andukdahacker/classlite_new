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

	"github.com/ducdo/classlite-api/internal/clock"
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

	// AuthService — RealClock; SetJWTSigner with the production secret;
	// SetResetURLBase with the configured reset URL.
	authAudit := service.NewPgAuthAuditLogger(pool)
	retryQ := service.NewEmailRetryQueue(emailSender, 256)
	hasher := service.BcryptHasher{Cost: 12}
	authSvc := service.NewAuthServiceWithClock(pool, hasher, emailSender, authAudit, retryQ, cfg.AppVerifyURLBase, clock.RealClock{})

	if cfg.JWTSecret != "" {
		authSvc.SetJWTSigner(service.NewJWTSigner([]byte(cfg.JWTSecret)))
	}
	if cfg.AppResetURLBase != "" {
		authSvc.SetResetURLBase(cfg.AppResetURLBase)
	}

	// Story 1.6 — Google OAuth wiring. If the operator left the
	// credentials empty (dev parity), the OAuth endpoints will return 503
	// instead of redirecting to a misconfigured Google authorize URL.
	if cfg.GoogleClientID != "" && cfg.OAuthStateSecret != "" {
		googleClient := service.NewGoogleOAuthClient(
			cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL,
		)
		oauthState := service.NewOAuthStateSigner([]byte(cfg.OAuthStateSecret))
		authSvc.SetGoogleOAuth(googleClient, oauthState)
	} else {
		slog.Warn("Google OAuth not configured — /api/auth/google endpoints will 503")
	}
	authSvc.SetAppApexHost(cfg.AppApexHost)
	authSvc.SetAppPostLoginURL(cfg.AppPostLoginURL)
	authSvc.SetAppLoginErrorURLBase(cfg.AppLoginErrorURLBase)

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

	// Cookie config — non-dev demands all four attributes (R7 / AC10).
	cookieCfg := handler.CookieConfig{
		Domain:   pickCookieDomain(cfg),
		Secure:   cfg.AppEnv != "development",
		SameSite: http.SameSiteLaxMode,
	}
	authHandler := handler.NewAuthHandler(authSvc, cookieCfg)

	registerIPLimit := middleware.RateLimitByKey(
		"auth-register",
		rate.Every(2*time.Minute),
		5,
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
		makeEmailKeyFn(resendBodyKey),
	)
	// Why burst 8 (not 5): the per-email account lockout (AC6) fires at 5
	// failed attempts. If the IP rate-limit burst were also 5, the 6th
	// attempt would be 429 RATE_LIMIT_EXCEEDED before the service-layer
	// lockout check could surface 429 ACCOUNT_LOCKED. Keeping the burst
	// slightly higher lets the lockout envelope code surface at the HTTP
	// edge — single IP still tops out fast, just with the more specific
	// code.
	loginLimit := middleware.RateLimitByKey(
		"auth-login",
		rate.Every(2*time.Minute),
		8,
		middleware.IPKeyFn,
	)
	forgotIPLimit := middleware.RateLimitByKey(
		"forgot-pw-ip",
		rate.Every(2*time.Minute),
		5,
		middleware.IPKeyFn,
	)
	forgotEmailLimit := middleware.RateLimitByKey(
		"forgot-pw-email",
		rate.Every(60*time.Second),
		3,
		makeEmailKeyFn(forgotPasswordBodyKey),
	)

	mux.Handle("POST /api/auth/register",
		registerIPLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.Register))))
	mux.Handle("POST /api/auth/verify-email",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.VerifyEmail)))
	mux.Handle("POST /api/auth/resend-verification",
		emailKeyGate(resendBodyKey, resendIPLimit(resendEmailLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.ResendVerification))))))
	mux.Handle("GET /api/auth/verify-status",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.VerifyStatus)))

	// Story 1.5 auth endpoints. Login + Logout were previously bypassing
	// ErrorMapper via an in-handler `writeMappedError` shim; they now
	// route through the canonical mapper alongside Refresh / ForgotPassword
	// / ResetPassword so envelope shape stays byte-identical.
	mux.Handle("POST /api/auth/login",
		loginLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.Login))))
	mux.Handle("POST /api/auth/refresh",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.Refresh)))
	mux.Handle("POST /api/auth/logout",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.Logout)))
	mux.Handle("POST /api/auth/forgot-password",
		emailKeyGate(forgotPasswordBodyKey, forgotIPLimit(forgotEmailLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.ForgotPassword))))))
	mux.Handle("POST /api/auth/reset-password",
		http.HandlerFunc(middleware.ErrorMapper(authHandler.ResetPassword)))

	// Story 1.6 — Google OAuth + invite acceptance + force-logout.
	//
	// OAuth init/callback skip ErrorMapper (302 redirects, not envelopes).
	// The global 200/min/IP cap covers them (browser-driven, low frequency).
	mux.HandleFunc("GET /api/auth/google", authHandler.GoogleInit)
	mux.HandleFunc("GET /api/auth/google/callback", authHandler.GoogleCallback)

	// Invite acceptance — per-IP rate limit defends against token
	// enumeration. The route otherwise uses the canonical ErrorMapper.
	acceptInviteIPLimit := middleware.RateLimitByKey(
		"auth-accept-invite",
		rate.Every(time.Minute),
		10,
		middleware.IPKeyFn,
	)
	mux.Handle("POST /api/auth/accept-invite",
		acceptInviteIPLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.AcceptInvite))))

	// Force-logout — only Owners; ExtractTenant runs first to populate
	// the DB-resolved role, then RequireRole gates.
	adminHandler := handler.NewAdminHandler(authSvc)
	forceLogoutChain := middleware.ExtractTenant(pool, authSvc.JWTSigner())(
		middleware.RequireRole("owner")(
			http.HandlerFunc(middleware.ErrorMapper(adminHandler.ForceLogout)),
		),
	)
	mux.Handle("POST /api/admin/users/{userId}/force-logout", forceLogoutChain)

	// Story 2.1 — Onboarding + Center endpoints. Middleware chain per AC8:
	//   ExtractTenant → RequireVerifiedEmail → per-route rate limit → handler
	auditSvc := service.NewAuditService(pool)
	onboardingSvc := service.NewOnboardingService(pool)
	centerSvc := service.NewCenterService(pool, auditSvc, authSvc, clock.RealClock{})
	onboardingHandler := handler.NewOnboardingHandler(onboardingSvc, clock.RealClock{})
	centerHandler := handler.NewCenterHandler(centerSvc, clock.RealClock{})

	onboardingLimit := middleware.RateLimitByKey(
		"onboarding",
		rate.Every(60*time.Second),
		20,
		middleware.IPKeyFn,
	)
	requireVerified := middleware.RequireVerifiedEmail()
	extractTenant := middleware.ExtractTenant(pool, authSvc.JWTSigner())

	onboardingChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				onboardingLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}

	mux.Handle("POST /api/onboarding/persona", onboardingChain(onboardingHandler.SetPersona))
	mux.Handle("GET /api/onboarding/progress", onboardingChain(onboardingHandler.GetProgress))
	mux.Handle("PUT /api/onboarding/progress", onboardingChain(onboardingHandler.PutProgress))
	mux.Handle("POST /api/centers", onboardingChain(centerHandler.Create))

	// Story 2.2 — Templates + Spawn. Middleware chain per AC8:
	//   ExtractTenant → onboardingLimit → RequireVerifiedEmail →
	//   RequireCenterContext → handler
	//
	// Winston-W-B3 fix: onboardingLimit runs BEFORE RequireVerifiedEmail so
	// a valid-JWT verified-but-center-less flood cannot bypass the bucket.
	templateSvc := service.NewTemplateService(pool, auditSvc, clock.RealClock{})
	classSvc := service.NewClassService(pool, auditSvc, retryQ, clock.RealClock{})
	// R2-P1 fix: wire the invite accept URL base. The ClassService constructor
	// defaults this to a localhost URL; Validate() rejects an empty
	// AppInviteURLBase in non-dev so a missing wiring cannot ship silently.
	classSvc.SetAcceptURLBase(cfg.AppInviteURLBase)
	templateHandler := handler.NewTemplateHandler(templateSvc, classSvc, clock.RealClock{})
	requireCenter := middleware.RequireCenterContext()

	templateChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			onboardingLimit(
				requireVerified(
					requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
				),
			),
		)
	}

	// Spawn-specific rate limit (Winston-W-S4 + C1-10 review fix): 5/min
	// keyed by `centerID:ip` (not pure IP). Spawn amplifies to 20 classes × 20
	// invite emails per request; a botnet-driven IP flood would otherwise
	// bypass a pure-IP cap. Center-scoped keying caps Resend spend + DB
	// writes per tenant AND keeps shared-NAT users independent. Falls back to
	// pure IP when no TenantContext (unauthenticated caller — already
	// rejected by ExtractTenant earlier in the chain, but belt-and-suspenders).
	spawnLimit := middleware.RateLimitByKey(
		"spawn",
		rate.Every(60*time.Second),
		5,
		middleware.CenterAndIPKeyFn,
	)
	spawnChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			spawnLimit(
				onboardingLimit(
					requireVerified(
						requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}

	mux.Handle("GET /api/templates", templateChain(templateHandler.List))
	mux.Handle("POST /api/templates", templateChain(templateHandler.Create))
	mux.Handle("POST /api/templates/{id}/spawn", spawnChain(templateHandler.Spawn))

	// Middleware chain order (AC11/AC12):
	// RequestID → ClientIP → Logger → CORS → OriginCheck → global RateLimit → mux
	corsOrigins := middleware.ParseOrigins(cfg.CORSOrigins)
	corsMW := middleware.NewCORS(middleware.CORSConfig{
		AllowedOrigins:   corsOrigins,
		AllowCredentials: true,
	})
	originMW := middleware.NewOriginCheck(corsOrigins)

	wrapped := middleware.RequestID(
		middleware.ClientIP(
			middleware.Logger(
				corsMW(
					originMW(
						middleware.RateLimit(200.0/60.0, 200)(mux),
					),
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

// pickCookieDomain selects the cookie Domain attribute based on AppEnv.
//
// D4 contract: in non-dev, COOKIE_DOMAIN MUST be set explicitly (validated
// at config load — Validate() rejects empty). The previous shape silently
// fell back to ".classlite.app" for any non-dev environment, which made a
// staging deployment at staging.classlite.app emit cookies that the prod
// frontend would also read. There is no fallback now: operator-supplied
// value is the value used.
//
// Dev: empty (host-only on localhost, which the Vite proxy needs) UNLESS
// the operator explicitly overrode with COOKIE_DOMAIN. Operator config
// wins for parity with prod debugging.
func pickCookieDomain(cfg config.Config) string {
	if cfg.AppEnv == "development" {
		return cfg.CookieDomain
	}
	if cfg.CookieDomain == "localhost" {
		// Defensive guard: localhost is almost never the right value in a
		// non-dev environment. Refuse to use it; the operator must fix
		// the config rather than silently downgrading prod cookie scope.
		slog.Warn("COOKIE_DOMAIN=localhost rejected in non-dev; using empty (host-only)",
			"env", cfg.AppEnv)
		return ""
	}
	return cfg.CookieDomain
}

// resendBodyKeyType / forgotPasswordBodyKeyType are typed context keys for
// the cached body payload that emailKeyGate stashes for the per-email
// rate-limit keyFn.
type resendBodyKeyType struct{}
type forgotPasswordBodyKeyType struct{}

var (
	resendBodyKey         resendBodyKeyType
	forgotPasswordBodyKey forgotPasswordBodyKeyType
)

// emailKeyGate reads + caps the request body once, stashes the bytes in
// context under the given key, restores r.Body, and short-circuits with
// 400 on a read failure. Shared by /resend-verification (Story 1.4) and
// /forgot-password (Story 1.5) — both endpoints need the body twice
// (once for per-email rate-limit key extraction, once for the handler's
// JSON decoder), and both honor the same 16 KiB body cap.
func emailKeyGate(bodyKey any, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxResendBodyBytes)
		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeBadRequestJSON(w, r, "INVALID_BODY", "Request body could not be read.")
			return
		}
		ctx := context.WithValue(r.Context(), bodyKey, body)
		r2 := r.Clone(ctx)
		r2.Body = io.NopCloser(bytes.NewBuffer(body))
		next.ServeHTTP(w, r2)
	})
}

// makeEmailKeyFn returns a RateLimitByKey keyFn that reads the cached body
// from the given context key (set by emailKeyGate), parses the email
// field, and returns the normalized form.
//
// Malformed-body handling (P27): rather than returning "" (which makes
// RateLimitByKey pass through without consuming a token, letting a
// distributed attacker spam the endpoint with `{"email":"not-an-email"}`
// to bypass per-email throttling), we key the malformed bucket on the
// client IP — same throttling shape as a single bad emailer, so spammers
// don't get a free pass just by sending unparseable payloads.
func makeEmailKeyFn(bodyKey any) func(*http.Request) string {
	return func(r *http.Request) string {
		malformedKey := "malformed:" + middleware.IPKeyFn(r)
		body, _ := r.Context().Value(bodyKey).([]byte)
		if len(body) == 0 {
			return malformedKey
		}
		var decoded struct {
			Email string `json:"email"`
		}
		if err := json.Unmarshal(body, &decoded); err != nil {
			return malformedKey
		}
		candidate := strings.TrimSpace(decoded.Email)
		if candidate == "" {
			return malformedKey
		}
		parsed, err := mail.ParseAddress(candidate)
		if err != nil {
			return malformedKey
		}
		return strings.ToLower(strings.TrimSpace(parsed.Address))
	}
}

// writeBadRequestJSON emits the envelope-shaped 400 response used by the
// body gate when the body cannot be read.
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
