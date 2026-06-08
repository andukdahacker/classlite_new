package config_test

import (
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/config"
)

const okSecret = "x-this-secret-is-exactly-thirty-two-bytes!!"

// productionBase returns a Config that passes Validate in production
// when the test only wants to mutate ONE field. Story 1.6 added the
// Google + OAuth state + apex URL fields; every production test must
// fill them or hit the "required oauth config missing" branch.
func productionBase() config.Config {
	return config.Config{
		AppEnv:               "production",
		DatabaseURL:          "postgres://...",
		JWTSecret:            okSecret,
		AppVerifyURLBase:     "https://my.classlite.app/verify-email",
		AppResetURLBase:      "https://my.classlite.app/reset-password",
		CookieDomain:         ".classlite.app",
		GoogleClientID:       "client-id",
		GoogleClientSecret:   "client-secret",
		GoogleRedirectURL:    "https://my.classlite.app/api/auth/google/callback",
		OAuthStateSecret:     okSecret,
		AppApexHost:          "my.classlite.app",
		AppPostLoginURL:      "https://my.classlite.app/",
		AppLoginErrorURLBase: "https://my.classlite.app/login",
	}
}

func TestValidate_DevelopmentAcceptsEmpty(t *testing.T) {
	cfg := config.Config{AppEnv: "development", DatabaseURL: "", JWTSecret: ""}
	if err := cfg.Validate(); err != nil {
		t.Errorf("development should accept empty values, got: %v", err)
	}
}

func TestValidate_ProductionRequiresDBURL(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "", JWTSecret: okSecret,
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty DATABASE_URL")
	}
}

func TestValidate_ProductionRequiresJWTSecret(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "",
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty JWT_SECRET")
	}
}

func TestValidate_ProductionRequiresAppVerifyURLBase(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "", AppResetURLBase: "https://y",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty APP_VERIFY_URL_BASE")
	}
}

func TestValidate_ProductionRequiresAppResetURLBase(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "https://x", AppResetURLBase: "",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty APP_RESET_URL_BASE")
	}
}

func TestValidate_ProductionRejectsShortJWTSecret(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "too-short",
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y",
		CookieDomain: ".classlite.app",
	}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("production should reject JWT_SECRET shorter than 32 bytes")
	}
	if !strings.Contains(err.Error(), "32 bytes") {
		t.Errorf("error should mention 32-byte minimum, got %v", err)
	}
}

func TestValidate_ProductionPassesWithAllSet(t *testing.T) {
	cfg := productionBase()
	if err := cfg.Validate(); err != nil {
		t.Errorf("production with all values set should pass, got: %v", err)
	}
}

// Story 1.6 — OAuth fields.

func TestValidate_ProductionRequiresGoogleClientID(t *testing.T) {
	cfg := productionBase()
	cfg.GoogleClientID = ""
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "GOOGLE_CLIENT_ID") {
		t.Fatalf("expected GOOGLE_CLIENT_ID error, got %v", err)
	}
}

func TestValidate_ProductionRequiresOAuthStateSecret(t *testing.T) {
	cfg := productionBase()
	cfg.OAuthStateSecret = ""
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "OAUTH_STATE_SECRET") {
		t.Fatalf("expected OAUTH_STATE_SECRET error, got %v", err)
	}
}

func TestValidate_ProductionRejectsShortOAuthStateSecret(t *testing.T) {
	cfg := productionBase()
	cfg.OAuthStateSecret = "too-short"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "OAUTH_STATE_SECRET") {
		t.Fatalf("expected OAUTH_STATE_SECRET length error, got %v", err)
	}
	if !strings.Contains(err.Error(), "32") {
		t.Errorf("error should mention 32-byte minimum, got %v", err)
	}
}

func TestValidate_ProductionRejectsHTTPRedirect(t *testing.T) {
	cfg := productionBase()
	cfg.GoogleRedirectURL = "http://my.classlite.app/api/auth/google/callback"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "https://") {
		t.Fatalf("expected GOOGLE_REDIRECT_URL https requirement, got %v", err)
	}
}

func TestValidate_ProductionRejectsWrongRedirectPath(t *testing.T) {
	cfg := productionBase()
	cfg.GoogleRedirectURL = "https://my.classlite.app/wrong/path"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), config.GoogleRedirectURLPath) {
		t.Fatalf("expected GOOGLE_REDIRECT_URL suffix requirement, got %v", err)
	}
}

func TestValidate_DevelopmentAcceptsEmptyOAuth(t *testing.T) {
	cfg := config.Config{
		AppEnv:           "development",
		GoogleClientID:   "",
		OAuthStateSecret: "",
	}
	if err := cfg.Validate(); err != nil {
		t.Errorf("development should accept empty OAuth values, got: %v", err)
	}
}

func TestValidate_ProductionRequiresCookieDomain(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y",
		// CookieDomain intentionally empty — D4 requires explicit value.
	}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("production should reject empty COOKIE_DOMAIN")
	}
	if !strings.Contains(err.Error(), "COOKIE_DOMAIN") {
		t.Errorf("error should mention COOKIE_DOMAIN, got %v", err)
	}
}

func TestValidate_ProductionRejectsLocalhostCookieDomain(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y",
		CookieDomain: "localhost",
	}
	err := cfg.Validate()
	if err == nil {
		t.Fatal("production should reject COOKIE_DOMAIN=localhost")
	}
	if !strings.Contains(err.Error(), "COOKIE_DOMAIN") {
		t.Errorf("error should mention COOKIE_DOMAIN, got %v", err)
	}
}

func TestValidate_StagingAlsoValidates(t *testing.T) {
	cfg := config.Config{AppEnv: "staging", DatabaseURL: "", JWTSecret: ""}
	if err := cfg.Validate(); err == nil {
		t.Error("staging should also validate critical vars")
	}
}
