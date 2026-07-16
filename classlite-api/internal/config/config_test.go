package config_test

import (
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/config"
)

const okSecret = "x-this-secret-is-exactly-thirty-two-bytes!!"

// okIntegrationsKey is a base64-encoded 32-byte AES key that passes Validate.
// 44 base64 chars → 32 decoded bytes (base64.StdEncoding).
const okIntegrationsKey = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

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
		AppInviteURLBase:     "https://my.classlite.app/invite",
		CookieDomain:         ".classlite.app",
		GoogleClientID:            "client-id",
		GoogleClientSecret:        "client-secret",
		GoogleRedirectURL:         "https://my.classlite.app/api/auth/google/callback",
		OAuthStateSecret:          okSecret,
		AppApexHost:               "my.classlite.app",
		AppPostLoginURL:           "https://my.classlite.app/",
		AppLoginErrorURLBase:      "https://my.classlite.app/login",
		IntegrationsEncryptionKey: okIntegrationsKey,
		MeetOAuthRedirectURL:      "https://my.classlite.app/api/centers/callback/google-meet",
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
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y", AppInviteURLBase: "https://z",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty DATABASE_URL")
	}
}

func TestValidate_ProductionRequiresJWTSecret(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "",
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y", AppInviteURLBase: "https://z",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty JWT_SECRET")
	}
}

func TestValidate_ProductionRequiresAppVerifyURLBase(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "", AppResetURLBase: "https://y", AppInviteURLBase: "https://z",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty APP_VERIFY_URL_BASE")
	}
}

func TestValidate_ProductionRequiresAppResetURLBase(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "https://x", AppResetURLBase: "", AppInviteURLBase: "https://z",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty APP_RESET_URL_BASE")
	}
}

func TestValidate_ProductionRequiresAppInviteURLBase(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y", AppInviteURLBase: "",
	}
	if err := cfg.Validate(); err == nil {
		t.Error("production should reject empty APP_INVITE_URL_BASE (R2-P1: prevents localhost invite URLs shipping in prod)")
	}
}

func TestValidate_ProductionRejectsShortJWTSecret(t *testing.T) {
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "too-short",
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y", AppInviteURLBase: "https://z",
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
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y", AppInviteURLBase: "https://z",
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
		AppVerifyURLBase: "https://x", AppResetURLBase: "https://y", AppInviteURLBase: "https://z",
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

// Story 2.5c — INTEGRATIONS_ENCRYPTION_KEY + MEET_OAUTH_REDIRECT_URL validation.

func TestValidate_ProductionRequiresIntegrationsEncryptionKey(t *testing.T) {
	cfg := productionBase()
	cfg.IntegrationsEncryptionKey = ""
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "INTEGRATIONS_ENCRYPTION_KEY") {
		t.Fatalf("expected INTEGRATIONS_ENCRYPTION_KEY error, got %v", err)
	}
}

func TestValidate_ProductionRejectsInvalidBase64IntegrationsKey(t *testing.T) {
	cfg := productionBase()
	cfg.IntegrationsEncryptionKey = "!!not-base64!!"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "base64") {
		t.Fatalf("expected base64 decode error, got %v", err)
	}
}

func TestValidate_ProductionRejectsWrongLengthIntegrationsKey(t *testing.T) {
	cfg := productionBase()
	// 16 bytes decoded — half the required length.
	cfg.IntegrationsEncryptionKey = "AAECAwQFBgcICQoLDA0ODw=="
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "32 bytes") {
		t.Fatalf("expected 32-byte length error, got %v", err)
	}
}

func TestValidate_ProductionRequiresMeetOAuthRedirectURL(t *testing.T) {
	cfg := productionBase()
	cfg.MeetOAuthRedirectURL = ""
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "MEET_OAUTH_REDIRECT_URL") {
		t.Fatalf("expected MEET_OAUTH_REDIRECT_URL error, got %v", err)
	}
}

func TestValidate_ProductionRejectsHTTPMeetOAuthRedirect(t *testing.T) {
	cfg := productionBase()
	cfg.MeetOAuthRedirectURL = "http://my.classlite.app/api/centers/callback/google-meet"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "https://") {
		t.Fatalf("expected MEET_OAUTH_REDIRECT_URL https requirement, got %v", err)
	}
}

// P4 fix (2026-07-16 code review): Validate() must reject a
// MEET_OAUTH_REDIRECT_URL that does not end with the fixed callback path.
// Mirrors the shipped GoogleRedirectURLPath suffix check (config.go:203)
// so an operator setting the URL to a wrong endpoint (e.g. an old typo,
// or the reverse-proxy stripping the API prefix) fails at boot instead
// of at first Google callback attempt.
func TestValidate_ProductionRejectsMeetOAuthRedirectURLWithWrongPathSuffix(t *testing.T) {
	cfg := productionBase()
	cfg.MeetOAuthRedirectURL = "https://my.classlite.app/api/centers/callback/wrong-provider"
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), config.MeetOAuthRedirectURLPath) {
		t.Fatalf("expected MEET_OAUTH_REDIRECT_URL path suffix error mentioning %q, got %v",
			config.MeetOAuthRedirectURLPath, err)
	}
}

func TestValidate_ProductionPassesWithAllIntegrationsSet(t *testing.T) {
	cfg := productionBase()
	if err := cfg.Validate(); err != nil {
		t.Errorf("production with integrations key + meet redirect set should pass, got: %v", err)
	}
	// After Validate, decoded bytes must be populated.
	if len(cfg.IntegrationsEncryptionKeyBytes) != config.IntegrationsEncryptionKeyBytesLen {
		t.Errorf("expected IntegrationsEncryptionKeyBytes to be %d bytes after Validate, got %d",
			config.IntegrationsEncryptionKeyBytesLen, len(cfg.IntegrationsEncryptionKeyBytes))
	}
}

func TestValidate_DevelopmentFallsBackToDevKey(t *testing.T) {
	cfg := config.Config{AppEnv: "development", IntegrationsEncryptionKey: ""}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("development with empty INTEGRATIONS_ENCRYPTION_KEY should fall back, got %v", err)
	}
	if len(cfg.IntegrationsEncryptionKeyBytes) != config.IntegrationsEncryptionKeyBytesLen {
		t.Errorf("expected dev-mode fallback to seed a %d-byte key, got %d bytes",
			config.IntegrationsEncryptionKeyBytesLen, len(cfg.IntegrationsEncryptionKeyBytes))
	}
}

func TestValidate_DevelopmentRejectsBadBase64IntegrationsKey(t *testing.T) {
	cfg := config.Config{AppEnv: "development", IntegrationsEncryptionKey: "!!not-base64!!"}
	err := cfg.Validate()
	if err == nil || !strings.Contains(err.Error(), "base64") {
		t.Fatalf("dev-mode with malformed INTEGRATIONS_ENCRYPTION_KEY should reject, got %v", err)
	}
}
