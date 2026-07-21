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
	"net/url"
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
	// oauthStateSigner is hoisted to package scope of main() so both the
	// login OAuth flow (Story 1.6) and Meet OAuth flow (Story 2.5c) share the
	// same signer instance. Sharing is safe — the signer is stateless and
	// concurrency-safe under HMAC-SHA256.
	var oauthStateSigner service.OAuthStateSigner
	if cfg.GoogleClientID != "" && cfg.OAuthStateSecret != "" {
		googleClient := service.NewGoogleOAuthClient(
			cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL,
		)
		oauthStateSigner = service.NewOAuthStateSigner([]byte(cfg.OAuthStateSecret))
		authSvc.SetGoogleOAuth(googleClient, oauthStateSigner)
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

	// Story 3.3 — template write chain: same shape as templateChain but gates
	// owner+admin between requireCenter and the handler (SEC-1). GET detail stays
	// on the open templateChain (the class-creation picker/wizard reads it).
	requireTemplateWriter := middleware.RequireRole("owner", "admin")
	templateWriteChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			onboardingLimit(
				requireVerified(
					requireCenter(
						requireTemplateWriter(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}

	mux.Handle("GET /api/templates", templateChain(templateHandler.List))
	mux.Handle("POST /api/templates", templateChain(templateHandler.Create))
	mux.Handle("GET /api/templates/{id}", templateChain(templateHandler.GetByID))
	mux.Handle("PUT /api/templates/{id}", templateWriteChain(templateHandler.Update))
	mux.Handle("DELETE /api/templates/{id}", templateWriteChain(templateHandler.Delete))
	mux.Handle("POST /api/templates/{id}/spawn", spawnChain(templateHandler.Spawn))

	// Story 2-5a — Settings endpoints. Middleware chain per AC7:
	//   ExtractTenant → RequireVerifiedEmail → RequireCenterContext →
	//   RequireRole("owner") → settingsRateLimit → handler
	//
	// Bucket is keyed by `userID:ip` (settings tab-switching is bursty
	// but personal, not tenant-wide). RateLimitByKey emits Retry-After.
	settingsSvc := service.NewSettingsService(pool, auditSvc, clock.RealClock{})
	settingsHandler := handler.NewSettingsHandler(settingsSvc, clock.RealClock{})
	requireOwner := middleware.RequireRole("owner")
	settingsLimit := middleware.RateLimitByKey(
		"settings",
		rate.Every(60*time.Second),
		60,
		middleware.UserAndIPKeyFn,
	)
	settingsChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwner(
						settingsLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	mux.Handle("GET /api/centers/{id}", settingsChain(settingsHandler.Get))
	mux.Handle("PATCH /api/centers/{id}", settingsChain(settingsHandler.Patch))

	// Story 2.6 — POST /api/centers/{id}/invites (AC8, FR-11).
	//
	// Distinct chain from settingsChain because the RequireRole allowlist
	// widens to {owner, admin}. Everything else is intentionally identical
	// (same rate-limit bucket, same tenant-context guards, same ErrorMapper)
	// so a Teacher/Student caller sees the same 403 shape as on any other
	// settings route. FR-11 (Admin-invites-Owner rejection) is enforced
	// inside the service — see invites_handler.go doc.
	invitesHandler := handler.NewInvitesHandler(authSvc, clock.RealClock{})
	requireOwnerOrAdmin := middleware.RequireRole("owner", "admin")
	settingsInviteChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwnerOrAdmin(
						settingsLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	mux.Handle("POST /api/centers/{id}/invites", settingsInviteChain(invitesHandler.Post))

	// Story 2-5b — Terms + Holidays + Rooms endpoints (12 routes). Share the
	// settingsChain wiring above so the same middleware order + rate limit
	// apply. Every mutating op emits a `center.{term|holiday|room}.{created|
	// updated|deleted}` audit row inside the service tx.
	termSvc := service.NewTermService(pool, auditSvc, clock.RealClock{})
	termHandler := handler.NewTermHandler(termSvc, clock.RealClock{})
	holidaySvc := service.NewHolidayService(pool, auditSvc, clock.RealClock{})
	holidayHandler := handler.NewHolidayHandler(holidaySvc, clock.RealClock{})
	roomSvc := service.NewRoomService(pool, auditSvc, clock.RealClock{})
	roomHandler := handler.NewRoomHandler(roomSvc, clock.RealClock{})

	mux.Handle("GET /api/terms", settingsChain(termHandler.List))
	mux.Handle("POST /api/terms", settingsChain(termHandler.Create))
	mux.Handle("PATCH /api/terms/{id}", settingsChain(termHandler.Update))
	mux.Handle("DELETE /api/terms/{id}", settingsChain(termHandler.Delete))
	mux.Handle("GET /api/holidays", settingsChain(holidayHandler.List))
	mux.Handle("POST /api/holidays", settingsChain(holidayHandler.Create))
	mux.Handle("PATCH /api/holidays/{id}", settingsChain(holidayHandler.Update))
	mux.Handle("DELETE /api/holidays/{id}", settingsChain(holidayHandler.Delete))
	mux.Handle("GET /api/rooms", settingsChain(roomHandler.List))
	mux.Handle("POST /api/rooms", settingsChain(roomHandler.Create))
	mux.Handle("PATCH /api/rooms/{id}", settingsChain(roomHandler.Update))
	mux.Handle("DELETE /api/rooms/{id}", settingsChain(roomHandler.Delete))

	// Story 3.1 — Class CRUD & lifecycle (5 routes). classChain is NOT
	// owner-gated (teachers must reach it): extractTenant → requireVerified →
	// requireCenter → ErrorMapper. List is role-scoped inside the handler
	// (owner/admin = all center classes; teacher = own only); the {id}
	// endpoints return 404 CLASS_NOT_FOUND for cross-teacher access (AC6).
	classHandler := handler.NewClassHandler(classSvc, clock.RealClock{})
	classChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux.Handle("GET /api/classes", classChain(classHandler.List))
	mux.Handle("POST /api/classes", classChain(classHandler.Create))
	mux.Handle("GET /api/classes/{id}", classChain(classHandler.Get))
	mux.Handle("PATCH /api/classes/{id}", classChain(classHandler.Update))
	mux.Handle("POST /api/classes/{id}/status", classChain(classHandler.TransitionStatus))

	// Story 2-5c — Google Meet OAuth integration endpoints (AC9).
	//
	// Authorize + Disconnect ride the shipped settingsChain (Owner-only +
	// settings rate-limit bucket). Callback rides oauthCallbackChain — SAME
	// middleware minus RequireRole (the state payload proves Owner intent
	// and HandleCallback re-checks membership per AC5 step 3). Rate limit
	// bucket on callback is 5 req/min per (centerID, IP) so an attacker
	// probing state-mismatch branches gets throttled without harming
	// legitimate Owners under the same NAT.
	//
	// DEVIATION from AC9 pinned in handler package doc: callback URL is
	// FIXED at /api/centers/callback/google-meet (no `{id}`) — Google OAuth
	// requires exact-match registered redirect URIs, so a per-center path
	// is infeasible for multi-tenant OAuth. Double binding (state.CenterID
	// + tc.CenterID) + fresh membership check discharge the same attack
	// surface as the story's triple-binding.
	//
	// P2 fix (2026-07-16 code review): mirror the login-OAuth guard at
	// line 91 — if Google client + state secret aren't configured, DON'T
	// register the Meet routes. Without the guard, dev/staging with empty
	// creds would ship endpoints backed by a nil oauthStateSigner + empty
	// Google client — every hit returns OAUTH_NOT_CONFIGURED (503 via
	// error_mapper), which is noisier than a proper 404 and confuses ops.
	if cfg.GoogleClientID != "" && cfg.OAuthStateSecret != "" {
		googleMeetOAuthClient := service.NewGoogleMeetOAuthClient(
			cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.MeetOAuthRedirectURL,
		)
		googleMeetSvc := service.NewGoogleMeetService(
			pool,
			googleMeetOAuthClient,
			oauthStateSigner,
			auditSvc,
			clock.RealClock{},
			cfg.IntegrationsEncryptionKeyBytes,
		)
		// P3 fix (2026-07-16 code review): url.JoinPath handles both
		// `http://localhost:5173/` (dev default, trailing slash) and
		// `https://app.classlite.app` (prod convention, no slash) without
		// producing broken `https://app.classlite.appsettings`. Falls back
		// to `/settings` on any join error so the handler still has a
		// valid target for the 302 redirect.
		postConnectURL, err := url.JoinPath(cfg.AppPostLoginURL, "settings")
		if err != nil {
			slog.Warn("failed to compose post-connect URL for Meet OAuth; falling back to /settings",
				"error", err, "app_post_login_url", cfg.AppPostLoginURL)
			postConnectURL = "/settings"
		}
		googleMeetHandler := handler.NewGoogleMeetHandler(googleMeetSvc, clock.RealClock{}, postConnectURL)
		oauthCallbackLimit := middleware.RateLimitByKey(
			"oauth_meet_callback",
			rate.Every(12*time.Second), // 5 req/min
			5,
			middleware.CenterAndIPKeyFn,
		)
		oauthCallbackChain := func(h middleware.HandlerWithError) http.Handler {
			return extractTenant(
				requireVerified(
					requireCenter(
						oauthCallbackLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			)
		}
		mux.Handle("GET /api/centers/{id}/integrations/google-meet/authorize", settingsChain(googleMeetHandler.Authorize))
		mux.Handle("DELETE /api/centers/{id}/integrations/google-meet", settingsChain(googleMeetHandler.Disconnect))
		mux.Handle("GET /api/centers/callback/google-meet", oauthCallbackChain(googleMeetHandler.Callback))
	} else {
		slog.Warn("Google Meet OAuth not configured — /api/centers/{id}/integrations/google-meet endpoints will 404")
	}

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
