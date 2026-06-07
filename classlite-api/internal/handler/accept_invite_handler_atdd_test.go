// accept_invite_handler_atdd_test.go — Story 1.6 handler integration
// tests for POST /api/auth/accept-invite. These exercise the full
// middleware.ErrorMapper → AuthHandler.AcceptInvite chain so the
// envelope shape matches what the SPA receives in production.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-04  200 envelope { data: { accessToken, user, center, role } }
//   AC-1.6-04  refresh_token cookie set (parity with Login per AC10 from Story 1.5)
//   AC-1.6-04  404 INVITE_NOT_FOUND for unknown token
//   AC-1.6-04  410 INVITE_EXPIRED with details: { centerName, inviterEmail }
//   AC-1.6-04  409 INVITE_ALREADY_ACCEPTED with details: { centerName }
//   AC-1.6-04  422 VALIDATION_ERROR when new-user branch missing fullName/password

package handler_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// newAcceptInviteHarness builds a handler wired to a real AuthService
// over the TxDB. The returned helper seeds invites + invokes the
// endpoint via the canonical ErrorMapper chain.
func newAcceptInviteHarness(t *testing.T, mockClock *clock.MockClock) (*handler.AuthHandler, *test.TxDB) {
	t.Helper()
	db := test.SetupDB(t)
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", mockClock)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), mockClock))
	svc.SetAppApexHost("my.classlite.app")
	svc.SetAppPostLoginURL("http://localhost:5173/")
	svc.SetAppLoginErrorURLBase("http://localhost:5173/login")
	cookieCfg := handler.CookieConfig{Domain: "", Secure: false, SameSite: http.SameSiteLaxMode}
	return handler.NewAuthHandler(svc, cookieCfg), db
}

func hashInviteTokenForHandlerTest(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func seedInviteForHandler(t *testing.T, db *test.TxDB, centerID, inviterID, email, role, tokenHash string, expiresAt time.Time) string {
	t.Helper()
	var inviteID string
	if err := db.QueryRow(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		centerID, inviterID, email, role, tokenHash, expiresAt,
	).Scan(&inviteID); err != nil {
		t.Fatalf("seed invite: %v", err)
	}
	return inviteID
}

// TestAcceptInvite_AC04_HappyPath_NewUser200Envelope proves the
// envelope shape on the new-user branch.
func TestAcceptInvite_AC04_HappyPath_NewUser200Envelope(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "handler-happy-new-user-token-1234"
	seedInviteForHandler(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"newteacher@example.com", "teacher",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(7*24*time.Hour),
	)

	body := `{"inviteToken":"` + rawToken + `","fullName":"New Teacher","password":"StrongPass123!"}`
	req := newReqWithRequestID(http.MethodPost, "/api/auth/accept-invite", body)
	rec := httptest.NewRecorder()
	middleware.ErrorMapper(h.AcceptInvite).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			AccessToken string `json:"accessToken"`
			User        struct {
				ID            string `json:"id"`
				Email         string `json:"email"`
				EmailVerified bool   `json:"emailVerified"`
			} `json:"user"`
			Center struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"center"`
			Role string `json:"role"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Data.AccessToken == "" {
		t.Error("accessToken: want non-empty")
	}
	if env.Data.User.Email != "newteacher@example.com" {
		t.Errorf("user.email: want %q, got %q", "newteacher@example.com", env.Data.User.Email)
	}
	if !env.Data.User.EmailVerified {
		t.Error("user.emailVerified: want true (invite link IS verification)")
	}
	if env.Data.Center.ID != test.TenantAID {
		t.Errorf("center.id: want %q, got %q", test.TenantAID, env.Data.Center.ID)
	}
	if env.Data.Center.Name != "Tenant A" {
		t.Errorf("center.name: want %q, got %q", "Tenant A", env.Data.Center.Name)
	}
	if env.Data.Role != "teacher" {
		t.Errorf("role: want %q, got %q", "teacher", env.Data.Role)
	}

	// refresh_token cookie present.
	cookies := rec.Result().Cookies()
	var refresh *http.Cookie
	for _, c := range cookies {
		if c.Name == "refresh_token" {
			refresh = c
			break
		}
	}
	if refresh == nil {
		t.Fatal("expected refresh_token cookie on accept-invite success")
	}
	if refresh.Value == "" {
		t.Error("refresh_token cookie value empty")
	}
}

// TestAcceptInvite_AC04_UnknownToken_Returns404 proves the
// *InviteNotFoundError → 404 mapping.
func TestAcceptInvite_AC04_UnknownToken_Returns404(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newAcceptInviteHarness(t, mockClock)

	req := newReqWithRequestID(http.MethodPost, "/api/auth/accept-invite",
		`{"inviteToken":"totally-random-string","fullName":"X","password":"Pass12345"}`)
	rec := httptest.NewRecorder()
	middleware.ErrorMapper(h.AcceptInvite).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var env errorEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Error.Code != "INVITE_NOT_FOUND" {
		t.Errorf("error.code: want %q, got %q", "INVITE_NOT_FOUND", env.Error.Code)
	}
	if env.Error.RequestID != "auth-test-req" {
		t.Errorf("error.requestId: want %q, got %q", "auth-test-req", env.Error.RequestID)
	}
}

// TestAcceptInvite_AC04_ExpiredToken_Returns410WithDetails proves the
// 410 envelope carries the details payload.
func TestAcceptInvite_AC04_ExpiredToken_Returns410WithDetails(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "handler-expired-token"
	seedInviteForHandler(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"late@example.com", "teacher",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(-1*time.Hour),
	)

	body := `{"inviteToken":"` + rawToken + `","fullName":"Late","password":"WhateverPass1"}`
	req := newReqWithRequestID(http.MethodPost, "/api/auth/accept-invite", body)
	rec := httptest.NewRecorder()
	middleware.ErrorMapper(h.AcceptInvite).ServeHTTP(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status: want 410, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var env struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				CenterName   string `json:"centerName"`
				InviterEmail string `json:"inviterEmail"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Error.Code != "INVITE_EXPIRED" {
		t.Errorf("error.code: want %q, got %q", "INVITE_EXPIRED", env.Error.Code)
	}
	if env.Error.Details.CenterName != "Tenant A" {
		t.Errorf("details.centerName: want %q, got %q", "Tenant A", env.Error.Details.CenterName)
	}
	if env.Error.Details.InviterEmail != "owner@example.com" {
		t.Errorf("details.inviterEmail: want %q, got %q", "owner@example.com", env.Error.Details.InviterEmail)
	}
}

// TestAcceptInvite_AC04_AlreadyAccepted_Returns409WithCenter proves
// the 409 envelope details.
func TestAcceptInvite_AC04_AlreadyAccepted_Returns409WithCenter(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "handler-already-accepted"
	inviteID := seedInviteForHandler(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"twice@example.com", "teacher",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(7*24*time.Hour),
	)
	if _, err := db.Exec(context.Background(),
		`UPDATE invites SET accepted_at = $2 WHERE id = $1`,
		inviteID, mockClock.Now(),
	); err != nil {
		t.Fatalf("pre-mark accepted: %v", err)
	}

	body := `{"inviteToken":"` + rawToken + `","fullName":"Twice","password":"WhateverPass1"}`
	req := newReqWithRequestID(http.MethodPost, "/api/auth/accept-invite", body)
	rec := httptest.NewRecorder()
	middleware.ErrorMapper(h.AcceptInvite).ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status: want 409, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVITE_ALREADY_ACCEPTED") {
		t.Errorf("body should mention INVITE_ALREADY_ACCEPTED, got %q", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Tenant A") {
		t.Errorf("details.centerName should be in body, got %q", rec.Body.String())
	}
}

// TestAcceptInvite_AC04_NewUserMissingFullName_Returns422 proves the
// new-user branch enforces both fullName and password.
func TestAcceptInvite_AC04_NewUserMissingFullName_Returns422(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "handler-missing-name"
	seedInviteForHandler(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"nameless@example.com", "teacher",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(7*24*time.Hour),
	)

	body := `{"inviteToken":"` + rawToken + `","password":"GoodPass123!"}`
	req := newReqWithRequestID(http.MethodPost, "/api/auth/accept-invite", body)
	rec := httptest.NewRecorder()
	middleware.ErrorMapper(h.AcceptInvite).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "fullName") {
		t.Errorf("error details should mention fullName, got %q", rec.Body.String())
	}
}
