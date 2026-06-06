package middleware_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

// runHandler wraps a HandlerWithError through ErrorMapper and serves an
// in-memory request, returning the recorder.
func runHandler(t *testing.T, err error) *httptest.ResponseRecorder {
	t.Helper()
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return err
	})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	h.ServeHTTP(rec, req)
	return rec
}

func TestErrorMapper_InvalidCredentials_401(t *testing.T) {
	rec := runHandler(t, &service.InvalidCredentialsError{})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "INVALID_CREDENTIALS" {
		t.Errorf("code = %v", code)
	}
}

func TestErrorMapper_AccountLocked_429_WithRetryAfter(t *testing.T) {
	rec := runHandler(t, &service.AccountLockedError{RetryAfter: 7 * time.Minute})
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d", rec.Code)
	}
	ra := rec.Header().Get("Retry-After")
	n, err := strconv.Atoi(ra)
	if err != nil || n != 420 {
		t.Errorf("Retry-After = %q, want 420", ra)
	}
}

func TestErrorMapper_TokenReuseDetected_401(t *testing.T) {
	rec := runHandler(t, &service.TokenReuseDetectedError{FamilyID: "abc"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "REFRESH_TOKEN_REUSE_DETECTED" {
		t.Errorf("code = %v", code)
	}
}

func TestErrorMapper_ResetTokenConsumed_409(t *testing.T) {
	rec := runHandler(t, &service.ResetTokenConsumedError{})
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "RESET_TOKEN_CONSUMED" {
		t.Errorf("code = %v", code)
	}
}

func TestErrorMapper_InsufficientRole_403(t *testing.T) {
	rec := runHandler(t, &service.ForbiddenError{Reason: "insufficient role"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "INSUFFICIENT_ROLE" {
		t.Errorf("code = %v", code)
	}
}

func TestErrorMapper_GenericForbidden_403(t *testing.T) {
	rec := runHandler(t, &service.ForbiddenError{Reason: "some other reason"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "FORBIDDEN" {
		t.Errorf("code = %v", code)
	}
}

func TestErrorMapper_RefreshTokenInvalid_401(t *testing.T) {
	rec := runHandler(t, &service.RefreshTokenInvalidError{})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestErrorMapper_AuthUserGone_401(t *testing.T) {
	rec := runHandler(t, &service.AuthUserGoneError{})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "AUTH_USER_GONE" {
		t.Errorf("code = %v", code)
	}
}

func TestErrorMapper_InvalidTenantClaim_403(t *testing.T) {
	rec := runHandler(t, &service.InvalidTenantClaimError{})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}
	var resp map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	if code := resp["error"].(map[string]any)["code"]; code != "INVALID_TENANT_CLAIM" {
		t.Errorf("code = %v", code)
	}
}
