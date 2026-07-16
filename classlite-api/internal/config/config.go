package config

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"os"
	"strings"
)

// Config holds all configuration values for the API server.
type Config struct {
	AppEnv       string // development, staging, production
	Port         string
	DatabaseURL  string
	JWTSecret    string
	CookieDomain string
	CORSOrigins    string
	SentryDSN      string
	ResendAPIKey     string
	ResendFromEmail  string
	R2AccountID      string
	R2AccessKeyID    string
	R2SecretAccessKey string
	R2BucketName     string
	// AppVerifyURLBase is the canonical base URL embedded in verification emails
	// (story 1.4). The token is appended as ?token=<value>.
	AppVerifyURLBase string
	// AppResetURLBase is the canonical base URL embedded in password-reset
	// emails (story 1.5). The token is appended as ?token=<value>.
	AppResetURLBase string
	// AppInviteURLBase is the canonical base URL embedded in team-invite
	// emails (story 2.2 spawn path). The raw token is appended as /<value>.
	// R2-P1 fix: the ClassService constructor previously defaulted this to
	// a localhost URL, so a prod deploy that forgot the wiring would ship
	// localhost URLs to real teachers. Validate() rejects an empty value in
	// non-dev; main.go calls classSvc.SetAcceptURLBase(cfg.AppInviteURLBase).
	AppInviteURLBase string
	// Story 1.6 — Google OAuth + invite acceptance + force-logout.
	GoogleClientID       string
	GoogleClientSecret   string
	GoogleRedirectURL    string
	OAuthStateSecret     string
	AppApexHost          string
	AppPostLoginURL      string
	AppLoginErrorURLBase string
	// Story 2.5c — Google Meet OAuth integration (per-center, separate from login).
	// IntegrationsEncryptionKey is base64-encoded 32 bytes; decoded via Validate()
	// into IntegrationsEncryptionKeyBytes. Dev-mode fallback is a fixed-seed test
	// key (never used in non-dev). MeetOAuthRedirectURL is the API-hosted callback
	// endpoint Google 302-redirects to; must match the OAuth client's registered
	// redirect URI verbatim.
	IntegrationsEncryptionKey      string
	IntegrationsEncryptionKeyBytes []byte
	MeetOAuthRedirectURL           string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() Config {
	return Config{
		AppEnv:       getEnv("APP_ENV", "development"),
		Port:         getEnv("PORT", "8080"),
		DatabaseURL:  getEnv("DATABASE_URL", ""),
		JWTSecret:    getEnv("JWT_SECRET", ""),
		// D4: no fallback to ".classlite.app" for cookies. The default is
		// localhost (dev parity); non-dev MUST explicitly set COOKIE_DOMAIN
		// — enforced by Validate(). This stops a staging deploy from
		// silently writing cookies onto the production domain.
		CookieDomain: getEnv("COOKIE_DOMAIN", "localhost"),
		CORSOrigins:    getEnv("CORS_ORIGINS", "http://localhost:5173"),
		SentryDSN:      getEnv("SENTRY_DSN", ""),
		ResendAPIKey:     getEnv("RESEND_API_KEY", ""),
		ResendFromEmail:  getEnv("RESEND_FROM_EMAIL", "noreply@classlite.app"),
		R2AccountID:      getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:    getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:     getEnv("R2_BUCKET_NAME", "classlite-uploads"),
		AppVerifyURLBase: getEnv("APP_VERIFY_URL_BASE", "http://localhost:5173/verify-email"),
		AppResetURLBase:  getEnv("APP_RESET_URL_BASE", "http://localhost:5173/reset-password"),
		AppInviteURLBase: getEnv("APP_INVITE_URL_BASE", "http://localhost:5173/invite"),
		GoogleClientID:       getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:   getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:    getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/api/auth/google/callback"),
		OAuthStateSecret:     getEnv("OAUTH_STATE_SECRET", ""),
		AppApexHost:          getEnv("APP_APEX_HOST", "localhost:5173"),
		AppPostLoginURL:      getEnv("APP_POST_LOGIN_URL", "http://localhost:5173/"),
		AppLoginErrorURLBase: getEnv("APP_LOGIN_ERROR_URL_BASE", "http://localhost:5173/login"),
		IntegrationsEncryptionKey: getEnv("INTEGRATIONS_ENCRYPTION_KEY", ""),
		MeetOAuthRedirectURL:      getEnv("MEET_OAUTH_REDIRECT_URL", "http://localhost:8080/api/centers/callback/google-meet"),
	}
}

// MinJWTSecretBytes is the HMAC-SHA256 minimum keylength per RFC 2104 (256 bits).
const MinJWTSecretBytes = 32

// MinOAuthStateSecretBytes mirrors MinJWTSecretBytes for the Story 1.6
// OAuth state HMAC signer.
const MinOAuthStateSecretBytes = 32

// IntegrationsEncryptionKeyBytes is the exact AES-256-GCM key length used
// by internal/service/integration_crypto.go (Story 2.5c). Validate()
// enforces this after base64-decoding INTEGRATIONS_ENCRYPTION_KEY.
const IntegrationsEncryptionKeyBytesLen = 32

// devIntegrationsEncryptionKey is the fixed-seed 32-byte AES key used ONLY
// when APP_ENV=development AND INTEGRATIONS_ENCRYPTION_KEY is unset. It is
// deterministic so dev-mode Seal/Open round-trips work across restarts, but
// it MUST never appear in non-dev deploys — Validate() rejects an empty
// INTEGRATIONS_ENCRYPTION_KEY outside development.
var devIntegrationsEncryptionKey = []byte{
	0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
	0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
	0x01, 0x12, 0x23, 0x34, 0x45, 0x56, 0x67, 0x78,
	0x89, 0x9a, 0xab, 0xbc, 0xcd, 0xde, 0xef, 0xf0,
}

// GoogleRedirectURLPath is the required path suffix on GOOGLE_REDIRECT_URL.
// A misconfigured redirect like https://foo.classlite.app/anything would
// otherwise pass validation and cause an opaque Google-side error at
// callback time.
const GoogleRedirectURLPath = "/api/auth/google/callback"

// MeetOAuthRedirectURLPath is the required path suffix on
// MEET_OAUTH_REDIRECT_URL. Story 2.5c AC9 (as amended 2026-07-16): callback
// URL is fixed at `/api/centers/callback/google-meet` (no `{id}` — Google
// requires exact-match registered redirect URIs). Enforce the suffix so an
// operator-supplied URL pointing at the wrong endpoint surfaces at boot
// instead of at callback time (matches the GoogleRedirectURLPath pattern).
const MeetOAuthRedirectURLPath = "/api/centers/callback/google-meet"

// Validate checks that critical configuration values are set.
// In non-development mode, DATABASE_URL, JWT_SECRET, APP_VERIFY_URL_BASE
// and APP_RESET_URL_BASE must be non-empty, and JWT_SECRET must be at
// least MinJWTSecretBytes long (AC15). In development a short or missing
// JWT_SECRET emits slog.Warn so the developer notices but boot proceeds.
func (c *Config) Validate() error {
	if c.AppEnv != "development" {
		var missing []string
		if c.DatabaseURL == "" {
			missing = append(missing, "DATABASE_URL")
		}
		if c.JWTSecret == "" {
			missing = append(missing, "JWT_SECRET")
		}
		if c.AppVerifyURLBase == "" {
			missing = append(missing, "APP_VERIFY_URL_BASE")
		}
		if c.AppResetURLBase == "" {
			missing = append(missing, "APP_RESET_URL_BASE")
		}
		if c.AppInviteURLBase == "" {
			missing = append(missing, "APP_INVITE_URL_BASE")
		}
		// D4: COOKIE_DOMAIN must be set explicitly in non-dev. The default
		// is "localhost" (good for local dev only); a deploy that forgets
		// to override would otherwise emit cookies scoped to localhost in
		// prod, or — worse — silently inherit the previous "fallback to
		// .classlite.app" shape and leak between staging and prod.
		if c.CookieDomain == "" || c.CookieDomain == "localhost" {
			missing = append(missing, "COOKIE_DOMAIN")
		}
		if len(missing) > 0 {
			return fmt.Errorf("required config missing for %s: %s", c.AppEnv, strings.Join(missing, ", "))
		}
		if len([]byte(c.JWTSecret)) < MinJWTSecretBytes {
			return fmt.Errorf("JWT_SECRET must be ≥ %d bytes for HS256 (got %d)", MinJWTSecretBytes, len([]byte(c.JWTSecret)))
		}
		// Story 1.6 — Google OAuth + state secret + apex URLs.
		var oauthMissing []string
		if c.GoogleClientID == "" {
			oauthMissing = append(oauthMissing, "GOOGLE_CLIENT_ID")
		}
		if c.GoogleClientSecret == "" {
			oauthMissing = append(oauthMissing, "GOOGLE_CLIENT_SECRET")
		}
		if c.GoogleRedirectURL == "" {
			oauthMissing = append(oauthMissing, "GOOGLE_REDIRECT_URL")
		}
		if c.OAuthStateSecret == "" {
			oauthMissing = append(oauthMissing, "OAUTH_STATE_SECRET")
		}
		if c.AppApexHost == "" {
			oauthMissing = append(oauthMissing, "APP_APEX_HOST")
		}
		if c.AppPostLoginURL == "" {
			oauthMissing = append(oauthMissing, "APP_POST_LOGIN_URL")
		}
		if c.AppLoginErrorURLBase == "" {
			oauthMissing = append(oauthMissing, "APP_LOGIN_ERROR_URL_BASE")
		}
		// Story 2.5c — Google Meet OAuth (per-center integration).
		if c.IntegrationsEncryptionKey == "" {
			oauthMissing = append(oauthMissing, "INTEGRATIONS_ENCRYPTION_KEY")
		}
		if c.MeetOAuthRedirectURL == "" {
			oauthMissing = append(oauthMissing, "MEET_OAUTH_REDIRECT_URL")
		}
		if len(oauthMissing) > 0 {
			return fmt.Errorf("required oauth config missing for %s: %s", c.AppEnv, strings.Join(oauthMissing, ", "))
		}
		if len([]byte(c.OAuthStateSecret)) < MinOAuthStateSecretBytes {
			return fmt.Errorf("OAUTH_STATE_SECRET must be ≥ %d bytes for HMAC-SHA256 (got %d)",
				MinOAuthStateSecretBytes, len([]byte(c.OAuthStateSecret)))
		}
		// AC10 — reject http:// redirect URLs in non-dev and enforce the
		// expected callback path so an operator-supplied URL pointing at
		// the wrong endpoint surfaces at boot instead of at callback time.
		if !strings.HasPrefix(c.GoogleRedirectURL, "https://") {
			return fmt.Errorf("GOOGLE_REDIRECT_URL must use https:// in %s (got %q)", c.AppEnv, c.GoogleRedirectURL)
		}
		if !strings.HasSuffix(c.GoogleRedirectURL, GoogleRedirectURLPath) {
			return fmt.Errorf("GOOGLE_REDIRECT_URL must end with %q (got %q)", GoogleRedirectURLPath, c.GoogleRedirectURL)
		}
		// Story 2.5c — decode INTEGRATIONS_ENCRYPTION_KEY (base64) and assert
		// exactly 32 bytes so AES-256-GCM Seal/Open never rejects at runtime.
		decoded, decodeErr := base64.StdEncoding.DecodeString(c.IntegrationsEncryptionKey)
		if decodeErr != nil {
			return fmt.Errorf("INTEGRATIONS_ENCRYPTION_KEY must be valid base64 (%s)", decodeErr.Error())
		}
		if len(decoded) != IntegrationsEncryptionKeyBytesLen {
			return fmt.Errorf("INTEGRATIONS_ENCRYPTION_KEY must decode to exactly %d bytes (got %d)",
				IntegrationsEncryptionKeyBytesLen, len(decoded))
		}
		c.IntegrationsEncryptionKeyBytes = decoded
		if !strings.HasPrefix(c.MeetOAuthRedirectURL, "https://") {
			return fmt.Errorf("MEET_OAUTH_REDIRECT_URL must use https:// in %s (got %q)", c.AppEnv, c.MeetOAuthRedirectURL)
		}
		if !strings.HasSuffix(c.MeetOAuthRedirectURL, MeetOAuthRedirectURLPath) {
			return fmt.Errorf("MEET_OAUTH_REDIRECT_URL must end with %q (got %q)", MeetOAuthRedirectURLPath, c.MeetOAuthRedirectURL)
		}
	} else {
		if c.JWTSecret != "" && len([]byte(c.JWTSecret)) < MinJWTSecretBytes {
			slog.Warn("JWT_SECRET is shorter than 32 bytes — fine for dev only",
				"current_bytes", len([]byte(c.JWTSecret)))
		}
		if c.OAuthStateSecret != "" && len([]byte(c.OAuthStateSecret)) < MinOAuthStateSecretBytes {
			slog.Warn("OAUTH_STATE_SECRET is shorter than 32 bytes — fine for dev only",
				"current_bytes", len([]byte(c.OAuthStateSecret)))
		}
		// Story 2.5c — dev-mode Integrations key fallback. If the operator
		// supplied a value, decode it; otherwise seed the deterministic dev
		// key so Seal/Open round-trips work locally without extra setup.
		if c.IntegrationsEncryptionKey == "" {
			slog.Warn("INTEGRATIONS_ENCRYPTION_KEY unset — falling back to dev-only fixed-seed key (never use outside development)")
			c.IntegrationsEncryptionKeyBytes = devIntegrationsEncryptionKey
		} else {
			decoded, decodeErr := base64.StdEncoding.DecodeString(c.IntegrationsEncryptionKey)
			if decodeErr != nil {
				return fmt.Errorf("INTEGRATIONS_ENCRYPTION_KEY must be valid base64 even in dev (%s)", decodeErr.Error())
			}
			if len(decoded) != IntegrationsEncryptionKeyBytesLen {
				return fmt.Errorf("INTEGRATIONS_ENCRYPTION_KEY must decode to exactly %d bytes (got %d)",
					IntegrationsEncryptionKeyBytesLen, len(decoded))
			}
			c.IntegrationsEncryptionKeyBytes = decoded
		}
	}
	return nil
}

// LogSummary logs a sanitized config summary (no secrets).
func (c Config) LogSummary() {
	slog.Info("config loaded",
		"app_env", c.AppEnv,
		"port", c.Port,
		"database_url_set", c.DatabaseURL != "",
		"jwt_secret_set", c.JWTSecret != "",
		"cookie_domain", c.CookieDomain,
		"cors_origins", c.CORSOrigins,
		"sentry_dsn_set", c.SentryDSN != "",
		"resend_api_key_set", c.ResendAPIKey != "",
		"resend_from_email", c.ResendFromEmail,
		"r2_account_id_set", c.R2AccountID != "",
		"r2_bucket_name", c.R2BucketName,
		"app_verify_url_base_set", c.AppVerifyURLBase != "",
		"app_reset_url_base_set", c.AppResetURLBase != "",
		"app_invite_url_base_set", c.AppInviteURLBase != "",
		"google_client_id_set", c.GoogleClientID != "",
		"oauth_state_secret_set", c.OAuthStateSecret != "",
		"app_apex_host", c.AppApexHost,
		"app_post_login_url_set", c.AppPostLoginURL != "",
		"integrations_encryption_key_set", c.IntegrationsEncryptionKey != "",
		"meet_oauth_redirect_url_set", c.MeetOAuthRedirectURL != "",
	)
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
