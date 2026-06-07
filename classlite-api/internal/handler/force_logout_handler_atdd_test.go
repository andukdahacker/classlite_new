// force_logout_handler_atdd_test.go — Story 1.6 integration tests for
// POST /api/admin/users/{userId}/force-logout. Exercises ErrorMapper →
// AdminHandler.ForceLogout. The full middleware chain (ExtractTenant +
// RequireRole) lives in service-layer tests + middleware tests; this
// file isolates the handler's input/output contract.

package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

func newForceLogoutHarness(t *testing.T, mockClock *clock.MockClock) (*handler.AdminHandler, *test.TxDB) {
	t.Helper()
	db := test.SetupDB(t)
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", mockClock)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), mockClock))
	return handler.NewAdminHandler(svc), db
}

// muxWithPathValue wraps the handler in a minimal mux so r.PathValue
// resolves correctly (httptest.NewRequest doesn't populate it directly).
func muxForForceLogout(h *handler.AdminHandler) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/admin/users/{userId}/force-logout",
		middleware.ErrorMapper(h.ForceLogout))
	return mux
}

func seedRefreshTokensFor(t *testing.T, db *test.TxDB, userID uuid.UUID, count int, expiresAt time.Time) {
	t.Helper()
	for i := 0; i < count; i++ {
		family := uuid.New()
		if _, err := db.Exec(context.Background(),
			`INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, remember_me)
			 VALUES ($1, $2, $3, $4, false)`,
			userID, "seed-hash-"+family.String(), family, expiresAt,
		); err != nil {
			t.Fatalf("seed refresh_token: %v", err)
		}
	}
}

// TestForceLogout_AC06_HappyPath_200Envelope proves the success
// envelope `{ data: { forcedLogout, sessionsRevoked } }`.
func TestForceLogout_AC06_HappyPath_200Envelope(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newForceLogoutHarness(t, mockClock)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	target := test.CreateUser(t, db, "teacher@example.com", "Teacher")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, target.ID, centerA.ID, "teacher")
	seedRefreshTokensFor(t, db, uuid.UUID(target.ID.Bytes), 3, mockClock.Now().Add(7*24*time.Hour))

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuid.UUID(owner.ID.Bytes).String(),
		Role:     "owner",
	}

	req := newReqWithRequestID(http.MethodPost,
		"/api/admin/users/"+uuid.UUID(target.ID.Bytes).String()+"/force-logout", "")
	req = req.WithContext(model.WithTenantContext(req.Context(), tc))
	rec := httptest.NewRecorder()
	muxForForceLogout(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			ForcedLogout    bool `json:"forcedLogout"`
			SessionsRevoked int  `json:"sessionsRevoked"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !env.Data.ForcedLogout {
		t.Error("forcedLogout: want true")
	}
	if env.Data.SessionsRevoked != 3 {
		t.Errorf("sessionsRevoked: want 3, got %d", env.Data.SessionsRevoked)
	}
}

// TestForceLogout_AC06_MalformedUUID_Returns422 proves the path
// validation rejects garbage before the service runs.
func TestForceLogout_AC06_MalformedUUID_Returns422(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newForceLogoutHarness(t, mockClock)
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuid.UUID(owner.ID.Bytes).String(),
		Role:     "owner",
	}
	req := newReqWithRequestID(http.MethodPost,
		"/api/admin/users/not-a-uuid/force-logout", "")
	req = req.WithContext(model.WithTenantContext(req.Context(), tc))
	rec := httptest.NewRecorder()
	muxForForceLogout(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status: want 422, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("body should mention VALIDATION_ERROR, got %q", rec.Body.String())
	}
}

// TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden is the
// handler-level R1 invariant test. The substance is "not 403" — a
// passing-but-misimplemented system might 403 because of RLS.
func TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newForceLogoutHarness(t, mockClock)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "TENB")
	ownerA := test.CreateUser(t, db, "owner-a@example.com", "Owner A")
	userInB := test.CreateUser(t, db, "user-in-b@example.com", "User In B")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")
	_ = test.TenantContext(t, db, centerB.ID)
	_ = test.CreateCenterMember(t, db, userInB.ID, centerB.ID, "teacher")
	seedRefreshTokensFor(t, db, uuid.UUID(userInB.ID.Bytes), 2, mockClock.Now().Add(7*24*time.Hour))

	tc := model.TenantContext{
		CenterID: test.TenantAID, // Owner of A
		UserID:   uuid.UUID(ownerA.ID.Bytes).String(),
		Role:     "owner",
	}
	req := newReqWithRequestID(http.MethodPost,
		"/api/admin/users/"+uuid.UUID(userInB.ID.Bytes).String()+"/force-logout", "")
	req = req.WithContext(model.WithTenantContext(req.Context(), tc))
	rec := httptest.NewRecorder()
	muxForForceLogout(h).ServeHTTP(rec, req)

	if rec.Code == http.StatusForbidden {
		t.Fatalf("status: cross-tenant attempt MUST NOT 403 (R1 violation — existence leak). Body: %s", rec.Body.String())
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "USER_NOT_FOUND") {
		t.Errorf("body should mention USER_NOT_FOUND, got %q", rec.Body.String())
	}

	// User B's refresh tokens must survive.
	var remaining int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, userInB.ID,
	).Scan(&remaining); err != nil {
		t.Fatalf("count user-B refresh_tokens: %v", err)
	}
	if remaining != 2 {
		t.Errorf("user-B refresh_tokens: want 2 (untouched), got %d", remaining)
	}
}

// TestForceLogout_AC06_MissingTenantContext_Returns500 proves the
// programming-bug path: if AdminHandler runs without ExtractTenant
// having injected a context, the response is 500 (not silent allow).
func TestForceLogout_AC06_MissingTenantContext_Returns500(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newForceLogoutHarness(t, mockClock)

	target := uuid.New()
	req := newReqWithRequestID(http.MethodPost,
		"/api/admin/users/"+target.String()+"/force-logout", "")
	// NO model.WithTenantContext upstream.
	rec := httptest.NewRecorder()
	muxForForceLogout(h).ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status: want 500, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}
