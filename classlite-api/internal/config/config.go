package config

import (
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
	// Story 1.6 — Google OAuth + invite acceptance + force-logout.
	GoogleClientID       string
	GoogleClientSecret   string
	GoogleRedirectURL    string
	OAuthStateSecret     string
	AppApexHost          string
	AppPostLoginURL      string
	AppLoginErrorURLBase string
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
		GoogleClientID:       getEnv("GOOGLE_CLIENT_ID", ""),
		GoogleClientSecret:   getEnv("GOOGLE_CLIENT_SECRET", ""),
		GoogleRedirectURL:    getEnv("GOOGLE_REDIRECT_URL", "http://localhost:8080/api/auth/google/callback"),
		OAuthStateSecret:     getEnv("OAUTH_STATE_SECRET", ""),
		AppApexHost:          getEnv("APP_APEX_HOST", "localhost:5173"),
		AppPostLoginURL:      getEnv("APP_POST_LOGIN_URL", "http://localhost:5173/"),
		AppLoginErrorURLBase: getEnv("APP_LOGIN_ERROR_URL_BASE", "http://localhost:5173/login"),
	}
}

// MinJWTSecretBytes is the HMAC-SHA256 minimum keylength per RFC 2104 (256 bits).
const MinJWTSecretBytes = 32

// MinOAuthStateSecretBytes mirrors MinJWTSecretBytes for the Story 1.6
// OAuth state HMAC signer.
const MinOAuthStateSecretBytes = 32

// Validate checks that critical configuration values are set.
// In non-development mode, DATABASE_URL, JWT_SECRET, APP_VERIFY_URL_BASE
// and APP_RESET_URL_BASE must be non-empty, and JWT_SECRET must be at
// least MinJWTSecretBytes long (AC15). In development a short or missing
// JWT_SECRET emits slog.Warn so the developer notices but boot proceeds.
func (c Config) Validate() error {
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
		if len(oauthMissing) > 0 {
			return fmt.Errorf("required oauth config missing for %s: %s", c.AppEnv, strings.Join(oauthMissing, ", "))
		}
		if len([]byte(c.OAuthStateSecret)) < MinOAuthStateSecretBytes {
			return fmt.Errorf("OAUTH_STATE_SECRET must be ≥ %d bytes for HMAC-SHA256 (got %d)",
				MinOAuthStateSecretBytes, len([]byte(c.OAuthStateSecret)))
		}
		// AC10 — reject http:// redirect URLs in non-dev.
		if !strings.HasPrefix(c.GoogleRedirectURL, "https://") {
			return fmt.Errorf("GOOGLE_REDIRECT_URL must use https:// in %s (got %q)", c.AppEnv, c.GoogleRedirectURL)
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
		"google_client_id_set", c.GoogleClientID != "",
		"oauth_state_secret_set", c.OAuthStateSecret != "",
		"app_apex_host", c.AppApexHost,
		"app_post_login_url_set", c.AppPostLoginURL != "",
	)
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
