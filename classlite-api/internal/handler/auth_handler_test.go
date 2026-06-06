package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

const testVerifyURLBase = "https://my.classlite.app/verify-email"

func newTestAuthHandler(t *testing.T) (*handler.AuthHandler, *test.TxDB, *service.MockEmailSender, *service.InProcessRetryQueue) {
	t.Helper()
	db := test.SetupDB(t)
	hasher := &service.MockHasher{}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthService(db, hasher, sender, auditLogger, queue, testVerifyURLBase)
	cookieCfg := handler.CookieConfig{Domain: "", Secure: false, SameSite: http.SameSiteLaxMode}
	return handler.NewAuthHandler(svc, cookieCfg), db, sender, queue
}

// drainQueueAndWaitFor starts the retry-queue worker and polls (via the
// mock sender's locked Count accessor) until the expected number of sends
// has occurred or the deadline elapses. Returns the actual count seen.
func drainQueueAndWaitFor(t *testing.T, q *service.InProcessRetryQueue, sender *service.MockEmailSender, want int) int {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go q.Start(ctx)
	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		if sender.Count() >= want {
			return sender.Count()
		}
		time.Sleep(2 * time.Millisecond)
	}
	return sender.Count()
}

func newReqWithRequestID(method, path string, body string) *http.Request {
	var bodyReader *bytes.Buffer
	if body != "" {
		bodyReader = bytes.NewBufferString(body)
	} else {
		bodyReader = bytes.NewBufferString("")
	}
	req := httptest.NewRequest(method, path, bodyReader)
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.RequestID, "auth-test-req")
	return req.WithContext(ctx)
}

type successEnvelope[T any] struct {
	Data T `json:"data"`
}

type errorEnvelope struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
		Details   any    `json:"details"`
	} `json:"error"`
}

// ---------- Register ----------

func TestAuthHandler_Register_201Success(t *testing.T) {
	h, _, sender, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.Register)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register",
		`{"email":"handler@example.com","password":"supersecret","fullName":"Handler"}`))

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			User struct {
				ID            string `json:"id"`
				Email         string `json:"email"`
				FullName      string `json:"fullName"`
				EmailVerified bool   `json:"emailVerified"`
			} `json:"user"`
			VerifyPollID  string `json:"verifyPollId"`
			EmailDelivery string `json:"emailDelivery"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if env.Data.User.Email != "handler@example.com" {
		t.Errorf("email = %q", env.Data.User.Email)
	}
	if env.Data.User.EmailVerified {
		t.Errorf("emailVerified should be false on register")
	}
	if env.Data.VerifyPollID == "" {
		t.Errorf("verifyPollId missing")
	}
	if env.Data.EmailDelivery != "sent" {
		t.Errorf("emailDelivery = %q, want sent", env.Data.EmailDelivery)
	}
	_ = sender // worker not started here; we only assert envelope shape
}

func TestAuthHandler_Register_409DuplicateEmail(t *testing.T) {
	h, _, sender, queue := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.Register)

	body := `{"email":"dup-handler@example.com","password":"supersecret","fullName":"D"}`

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register", body))
	if rec.Code != http.StatusCreated {
		t.Fatalf("first register: %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register", body))
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate: expected 409, got %d", rec.Code)
	}
	var env errorEnvelope
	json.NewDecoder(rec.Body).Decode(&env)
	if env.Error.Code != "EMAIL_ALREADY_REGISTERED" {
		t.Errorf("code = %q, want EMAIL_ALREADY_REGISTERED", env.Error.Code)
	}
	if env.Error.RequestID != "auth-test-req" {
		t.Errorf("requestId not propagated: %q", env.Error.RequestID)
	}
	// Negative assertion (TEST-BE-1 spirit): drain the retry queue and assert
	// EXACTLY one email was sent across two register attempts — the duplicate
	// path must not enqueue a second job.
	got := drainQueueAndWaitFor(t, queue, sender, 1)
	if got != 1 {
		t.Errorf("expected exactly 1 email after duplicate register attempt, got %d", got)
	}
}

func TestAuthHandler_Register_422Validation(t *testing.T) {
	h, _, _, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.Register)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register",
		`{"email":"not-an-email","password":"short","fullName":""}`))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
	var env errorEnvelope
	json.NewDecoder(rec.Body).Decode(&env)
	if env.Error.Code != "VALIDATION_ERROR" {
		t.Errorf("code = %q", env.Error.Code)
	}
	details, ok := env.Error.Details.([]any)
	if !ok || len(details) < 3 {
		t.Errorf("expected ≥3 field errors, got %v", env.Error.Details)
	}
}

func TestAuthHandler_Register_422MalformedJSON(t *testing.T) {
	h, _, _, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.Register)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register", `not json`))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for malformed JSON, got %d", rec.Code)
	}
}

// ---------- VerifyEmail ----------

func TestAuthHandler_VerifyEmail_200Success(t *testing.T) {
	h, db, _, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.Register)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register",
		`{"email":"vh@example.com","password":"supersecret","fullName":"VH"}`))

	var token string
	if err := db.Tx.QueryRow(context.Background(),
		`SELECT token FROM email_verifications WHERE user_id = (SELECT id FROM users WHERE email = 'vh@example.com')`).Scan(&token); err != nil {
		t.Fatalf("fetch token: %v", err)
	}

	verify := middleware.ErrorMapper(h.VerifyEmail)
	rec = httptest.NewRecorder()
	verify.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/verify-email",
		`{"token":"`+token+`"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var env successEnvelope[struct {
		Verified bool   `json:"verified"`
		Email    string `json:"email"`
	}]
	json.NewDecoder(rec.Body).Decode(&env)
	if !env.Data.Verified || env.Data.Email != "vh@example.com" {
		t.Errorf("unexpected data: %+v", env.Data)
	}
}

func TestAuthHandler_VerifyEmail_410Expired(t *testing.T) {
	h, db, _, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.Register)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/register",
		`{"email":"exp@example.com","password":"supersecret","fullName":"E"}`))

	// Force-expire
	db.Tx.Exec(context.Background(),
		`UPDATE email_verifications SET expires_at = now() - INTERVAL '1 hour' WHERE user_id = (SELECT id FROM users WHERE email = 'exp@example.com')`)

	var token string
	db.Tx.QueryRow(context.Background(),
		`SELECT token FROM email_verifications WHERE user_id = (SELECT id FROM users WHERE email = 'exp@example.com')`).Scan(&token)

	verify := middleware.ErrorMapper(h.VerifyEmail)
	rec = httptest.NewRecorder()
	verify.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/verify-email", `{"token":"`+token+`"}`))

	if rec.Code != http.StatusGone {
		t.Fatalf("expected 410, got %d", rec.Code)
	}
	var env errorEnvelope
	json.NewDecoder(rec.Body).Decode(&env)
	if env.Error.Code != "VERIFICATION_TOKEN_EXPIRED" {
		t.Errorf("code = %q", env.Error.Code)
	}
}

func TestAuthHandler_VerifyEmail_404Unknown(t *testing.T) {
	h, _, _, _ := newTestAuthHandler(t)
	verify := middleware.ErrorMapper(h.VerifyEmail)

	rec := httptest.NewRecorder()
	verify.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/verify-email", `{"token":"nope"}`))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
	var env errorEnvelope
	json.NewDecoder(rec.Body).Decode(&env)
	if env.Error.Code != "VERIFICATION_TOKEN_INVALID" {
		t.Errorf("code = %q", env.Error.Code)
	}
}

// ---------- VerifyStatus ----------

func TestAuthHandler_VerifyStatus_404MalformedPollID(t *testing.T) {
	h, _, _, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.VerifyStatus)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodGet, "/api/auth/verify-status?pollId=not-a-uuid", ""))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed pollId, got %d", rec.Code)
	}
	var env errorEnvelope
	json.NewDecoder(rec.Body).Decode(&env)
	if env.Error.Code != "POLL_ID_NOT_FOUND" {
		t.Errorf("code = %q", env.Error.Code)
	}
}

// ---------- Resend ----------

func TestAuthHandler_Resend_200WithNullPollIDForUnknownEmail(t *testing.T) {
	h, _, _, _ := newTestAuthHandler(t)
	wrapped := middleware.ErrorMapper(h.ResendVerification)

	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, newReqWithRequestID(http.MethodPost, "/api/auth/resend-verification",
		`{"email":"ghost@example.com"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// AC7 ambiguous response: verifyPollId is JSON null.
	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte(`"verifyPollId":null`)) {
		t.Errorf("expected verifyPollId:null in response, got: %s", body)
	}
}
