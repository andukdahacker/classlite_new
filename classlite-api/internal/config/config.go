package config

import "os"

// Config holds all configuration values for the API server.
type Config struct {
	Port         string
	DatabaseURL  string
	JWTSecret    string
	CookieDomain string
	CORSOrigins  string
	SentryDSN    string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() Config {
	return Config{
		Port:         getEnv("PORT", "8080"),
		DatabaseURL:  getEnv("DATABASE_URL", ""),
		JWTSecret:    getEnv("JWT_SECRET", ""),
		CookieDomain: getEnv("COOKIE_DOMAIN", "localhost"),
		CORSOrigins:  getEnv("CORS_ORIGINS", "http://localhost:5173"),
		SentryDSN:    getEnv("SENTRY_DSN", ""),
	}
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
