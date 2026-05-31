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
}

// Load reads configuration from environment variables with sensible defaults.
func Load() Config {
	return Config{
		AppEnv:       getEnv("APP_ENV", "development"),
		Port:         getEnv("PORT", "8080"),
		DatabaseURL:  getEnv("DATABASE_URL", ""),
		JWTSecret:    getEnv("JWT_SECRET", ""),
		CookieDomain: getEnv("COOKIE_DOMAIN", "localhost"),
		CORSOrigins:    getEnv("CORS_ORIGINS", "http://localhost:5173"),
		SentryDSN:      getEnv("SENTRY_DSN", ""),
		ResendAPIKey:     getEnv("RESEND_API_KEY", ""),
		ResendFromEmail:  getEnv("RESEND_FROM_EMAIL", "noreply@classlite.app"),
		R2AccountID:      getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:    getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:     getEnv("R2_BUCKET_NAME", "classlite-uploads"),
	}
}

// Validate checks that critical configuration values are set.
// In non-development mode, DATABASE_URL and JWT_SECRET must be non-empty.
func (c Config) Validate() error {
	if c.AppEnv != "development" {
		var missing []string
		if c.DatabaseURL == "" {
			missing = append(missing, "DATABASE_URL")
		}
		if c.JWTSecret == "" {
			missing = append(missing, "JWT_SECRET")
		}
		if len(missing) > 0 {
			return fmt.Errorf("required config missing for %s: %s", c.AppEnv, strings.Join(missing, ", "))
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
	)
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
