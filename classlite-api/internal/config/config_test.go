package config_test

import (
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/config"
)

const okSecret = "x-this-secret-is-exactly-thirty-two-bytes!!"

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
	cfg := config.Config{
		AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: okSecret,
		AppVerifyURLBase: "https://my.classlite.app/verify-email",
		AppResetURLBase:  "https://my.classlite.app/reset-password",
		CookieDomain:     ".classlite.app",
	}
	if err := cfg.Validate(); err != nil {
		t.Errorf("production with all values set should pass, got: %v", err)
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
