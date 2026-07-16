package middleware_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

func reqWithID() *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	ctx := context.WithValue(req.Context(), model.RequestID, "test-req-id")
	return req.WithContext(ctx)
}

type errorEnvelope struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
		Details   any    `json:"details"`
	} `json:"error"`
}

func TestErrorMapper_NotFoundError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.NotFoundError{Resource: "student", ID: "abc"}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "NOT_FOUND" {
		t.Errorf("expected NOT_FOUND, got %s", body.Error.Code)
	}
	if body.Error.RequestID != "test-req-id" {
		t.Errorf("expected test-req-id, got %s", body.Error.RequestID)
	}
}

func TestErrorMapper_ForbiddenError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.ForbiddenError{Reason: "not a class member"}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "FORBIDDEN" {
		t.Errorf("expected FORBIDDEN, got %s", body.Error.Code)
	}
}

func TestErrorMapper_ValidationError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "email", Message: "invalid format"},
			{Field: "name", Message: "required"},
		}}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("expected VALIDATION_ERROR, got %s", body.Error.Code)
	}
	details, ok := body.Error.Details.([]any)
	if !ok || len(details) != 2 {
		t.Errorf("expected 2 field errors in details, got %v", body.Error.Details)
	}
}

func TestErrorMapper_ConflictError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.ConflictError{Resource: "user", ID: "email@test.com"}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "CONFLICT" {
		t.Errorf("expected CONFLICT, got %s", body.Error.Code)
	}
}

func TestErrorMapper_UnknownError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return fmt.Errorf("something unexpected")
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "INTERNAL_ERROR" {
		t.Errorf("expected INTERNAL_ERROR, got %s", body.Error.Code)
	}
	if body.Error.Message != "An unexpected error occurred." {
		t.Errorf("expected generic message, got %s", body.Error.Message)
	}
}

func TestErrorMapper_PanicRecovery(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		panic("something broke")
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "INTERNAL_ERROR" {
		t.Errorf("expected INTERNAL_ERROR, got %s", body.Error.Code)
	}
}

func TestErrorMapper_NotFoundError_CustomCode(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.NotFoundError{Resource: "verification_token", Code: "VERIFICATION_TOKEN_INVALID"}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "VERIFICATION_TOKEN_INVALID" {
		t.Errorf("expected VERIFICATION_TOKEN_INVALID, got %s", body.Error.Code)
	}
}

func TestErrorMapper_ConflictError_CustomCodeAndMessage(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.ConflictError{
			Resource: "email",
			Code:     "EMAIL_ALREADY_REGISTERED",
			Message:  "If this email is not yet registered, you will receive a verification email shortly.",
		}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "EMAIL_ALREADY_REGISTERED" {
		t.Errorf("expected EMAIL_ALREADY_REGISTERED, got %s", body.Error.Code)
	}
	if body.Error.Message != "If this email is not yet registered, you will receive a verification email shortly." {
		t.Errorf("custom message not propagated: %q", body.Error.Message)
	}
}

func TestErrorMapper_GoneError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return model.GoneError{Code: "VERIFICATION_TOKEN_EXPIRED", Reason: "This verification link has expired."}
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusGone {
		t.Errorf("expected 410, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "VERIFICATION_TOKEN_EXPIRED" {
		t.Errorf("expected VERIFICATION_TOKEN_EXPIRED, got %s", body.Error.Code)
	}
	if body.Error.Message != "This verification link has expired." {
		t.Errorf("Reason not propagated as message: %q", body.Error.Message)
	}
	if body.Error.RequestID != "test-req-id" {
		t.Errorf("expected test-req-id, got %s", body.Error.RequestID)
	}
}

func TestErrorMapper_NoError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		w.WriteHeader(http.StatusCreated)
		return nil
	})

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())

	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.Code)
	}
}

// ---------------------------------------------------------------------
// Story 2-5c Google Meet OAuth callback error mapping tests
// (Task 4.5 coverage, added 2026-07-16 during Round 1 /bmad-code-review).
// The Meet callback flows through ErrorMapper (JSON envelope), unlike the
// login-flow OAuth callback which uses 302 redirects. Verifies each of the
// 6 new error types lands at the correct HTTP status + code.
// ---------------------------------------------------------------------

func TestErrorMapper_OAuthStateInvalidError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return &service.OAuthStateInvalidError{}
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "OAUTH_STATE_INVALID" {
		t.Errorf("expected OAUTH_STATE_INVALID, got %s", body.Error.Code)
	}
}

func TestErrorMapper_OAuthStateExpiredError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return &service.OAuthStateExpiredError{}
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())
	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "OAUTH_STATE_EXPIRED" {
		t.Errorf("expected OAUTH_STATE_EXPIRED, got %s", body.Error.Code)
	}
}

func TestErrorMapper_OAuthStateMismatchError_DoesNotLeakReason(t *testing.T) {
	// P5 fix (2026-07-16 code review): mapper MUST NOT echo the internal
	// Reason field to the client — it lets an attacker learn which of the
	// four binding checks failed (path-vs-state, session-vs-state,
	// user-vs-state, format-invalid).
	const leakyReason = "state center id ≠ path center id"
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return &service.OAuthStateMismatchError{Reason: leakyReason}
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "OAUTH_STATE_MISMATCH" {
		t.Errorf("expected OAUTH_STATE_MISMATCH, got %s", body.Error.Code)
	}
	if body.Error.Message != "OAuth state binding failed." {
		t.Errorf("expected static message, got %q", body.Error.Message)
	}
	if strings.Contains(body.Error.Message, leakyReason) {
		t.Errorf("client message leaks internal Reason field: %q", body.Error.Message)
	}
}

func TestErrorMapper_OAuthMembershipRevokedError(t *testing.T) {
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return &service.OAuthMembershipRevokedError{UserID: "u", CenterID: "c"}
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())
	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "OAUTH_MEMBERSHIP_REVOKED" {
		t.Errorf("expected OAUTH_MEMBERSHIP_REVOKED, got %s", body.Error.Code)
	}
}

func TestErrorMapper_IntegrationConnectFailedError(t *testing.T) {
	// Also verify UpstreamErr is NEVER echoed to the client (opaque
	// Google-side details should not leak — see errors.go doc).
	const upstream = "invalid_grant: token expired"
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return &service.IntegrationConnectFailedError{Provider: "google_meet", UpstreamErr: upstream}
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())
	if rec.Code != http.StatusBadGateway {
		t.Errorf("expected 502, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "INTEGRATION_CONNECT_FAILED" {
		t.Errorf("expected INTEGRATION_CONNECT_FAILED, got %s", body.Error.Code)
	}
	if strings.Contains(body.Error.Message, upstream) {
		t.Errorf("client message leaks UpstreamErr: %q", body.Error.Message)
	}
}

func TestErrorMapper_OAuthNotConfiguredError(t *testing.T) {
	// P1 fix (2026-07-16 code review): OAuthNotConfiguredError previously
	// fell through to the generic 500 fallback. Now maps to 503 to match
	// the login-flow handler's 503 code (auth_handler.go:439).
	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return &service.OAuthNotConfiguredError{}
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithID())
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}
	var body errorEnvelope
	json.NewDecoder(rec.Body).Decode(&body)
	if body.Error.Code != "OAUTH_NOT_CONFIGURED" {
		t.Errorf("expected OAUTH_NOT_CONFIGURED, got %s", body.Error.Code)
	}
}
