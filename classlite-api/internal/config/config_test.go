package config_test

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/config"
)

func TestValidate_DevelopmentAcceptsEmpty(t *testing.T) {
	cfg := config.Config{AppEnv: "development", DatabaseURL: "", JWTSecret: ""}
	if err := cfg.Validate(); err != nil {
		t.Errorf("development should accept empty values, got: %v", err)
	}
}

func TestValidate_ProductionRequiresDBURL(t *testing.T) {
	cfg := config.Config{AppEnv: "production", DatabaseURL: "", JWTSecret: "secret"}
	err := cfg.Validate()
	if err == nil {
		t.Error("production should reject empty DATABASE_URL")
	}
}

func TestValidate_ProductionRequiresJWTSecret(t *testing.T) {
	cfg := config.Config{AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "", AppVerifyURLBase: "https://x"}
	err := cfg.Validate()
	if err == nil {
		t.Error("production should reject empty JWT_SECRET")
	}
}

func TestValidate_ProductionRequiresAppVerifyURLBase(t *testing.T) {
	cfg := config.Config{AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "secret", AppVerifyURLBase: ""}
	err := cfg.Validate()
	if err == nil {
		t.Error("production should reject empty APP_VERIFY_URL_BASE")
	}
}

func TestValidate_ProductionPassesWithAllSet(t *testing.T) {
	cfg := config.Config{AppEnv: "production", DatabaseURL: "postgres://...", JWTSecret: "secret", AppVerifyURLBase: "https://my.classlite.app/verify-email"}
	if err := cfg.Validate(); err != nil {
		t.Errorf("production with all values set should pass, got: %v", err)
	}
}

func TestValidate_StagingAlsoValidates(t *testing.T) {
	cfg := config.Config{AppEnv: "staging", DatabaseURL: "", JWTSecret: ""}
	err := cfg.Validate()
	if err == nil {
		t.Error("staging should also validate critical vars")
	}
}
