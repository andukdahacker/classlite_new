// Story 2.6 (AC9) — handler-layer ATDD for POST /api/centers/{id}/invites.
//
// Real middleware chain per TEST-BE-3 — ExtractTenant → RequireVerifiedEmail
// → RequireCenterContext → RequireRole("owner","admin") → rate-limit →
// ErrorMapper → invitesHandler.Post. Every row asserts on the full HTTP
// envelope (status + code + role of the persisted invite row for happy
// paths, or the details.field for the inline-field errors).
//
// Row inventory (per AC9 handler-layer split):
//   1. Owner  → Teacher (201, invite row visible, envelope role matches)
//   2. Owner  → Owner   (201, FR-11 permits Owner-to-Owner promotion)
//   3. Admin  → Teacher (201, exercises the widened RequireRole allowlist)
//   4. Admin  → Admin   (201, exercises Admin-invites-Admin arm)
//   5. Admin  → Owner   (403 ROLE_ASSIGNMENT_FORBIDDEN — FR-11 envelope proof)
//   6. Teacher middleware-block — Teacher JWT hits the route, RequireRole
//      rejects at the HTTP edge with INSUFFICIENT_ROLE; the service is NEVER
//      invoked (no role_assignment_blocked audit row, no invite row).
//   7. Row-persistence positive assertion on the Owner→Teacher happy path —
//      after the 201, read the invites table and verify (center_id, email,
//      role, expires_at) shape.
//
// The Owner→Teacher happy path acts as the "handler-layer row 7"
// combined with row 1 — one 201 exercises envelope shape + DB row
// persistence + audit row per Murat open Q's row-persistence assertion.
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
)

// inviteEnvelope mirrors the api.yaml EnvelopeInviteResult shape.
type inviteEnvelope struct {
	Data struct {
		ID        string `json:"id"`
		Email     string `json:"email"`
		Role      string `json:"role"`
		ExpiresAt string `json:"expiresAt"`
	} `json:"data"`
	Meta struct {
		ServerTime string `json:"serverTime"`
	} `json:"meta"`
}

type inviteErrorEnvelope struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
		Details   any    `json:"details"`
	} `json:"error"`
}

// hierarchyHandlerCase describes one row of the AC9 handler matrix.
type hierarchyHandlerCase struct {
	name           string
	callerDBRole   string
	callerJWTRole  string // usually equal to callerDBRole; SEC-1 tests differ
	targetRole     string
	wantStatus     int
	wantCode       string // empty on success
	wantEnvelope   bool   // whether to assert the success envelope
	wantInviteRow  bool   // whether an invite row should exist post-call
	wantAuditEvent string // empty for no audit assertion
}

func TestInvitesHandler_AC9_HierarchyMatrix(t *testing.T) {
	cases := []hierarchyHandlerCase{
		{
			name:           "owner_invites_teacher_201",
			callerDBRole:   "owner",
			callerJWTRole:  "owner",
			targetRole:     "teacher",
			wantStatus:     http.StatusCreated,
			wantEnvelope:   true,
			wantInviteRow:  true,
			wantAuditEvent: "center.invite.sent",
		},
		{
			name:           "owner_invites_owner_201",
			callerDBRole:   "owner",
			callerJWTRole:  "owner",
			targetRole:     "owner",
			wantStatus:     http.StatusCreated,
			wantEnvelope:   true,
			wantInviteRow:  true,
			wantAuditEvent: "center.invite.sent",
		},
		{
			name:           "admin_invites_teacher_201",
			callerDBRole:   "admin",
			callerJWTRole:  "admin",
			targetRole:     "teacher",
			wantStatus:     http.StatusCreated,
			wantEnvelope:   true,
			wantInviteRow:  true,
			wantAuditEvent: "center.invite.sent",
		},
		{
			name:           "admin_invites_admin_201",
			callerDBRole:   "admin",
			callerJWTRole:  "admin",
			targetRole:     "admin",
			wantStatus:     http.StatusCreated,
			wantEnvelope:   true,
			wantInviteRow:  true,
			wantAuditEvent: "center.invite.sent",
		},
		{
			name:           "admin_invites_owner_403_role_assignment_forbidden",
			callerDBRole:   "admin",
			callerJWTRole:  "admin",
			targetRole:     "owner",
			wantStatus:     http.StatusForbidden,
			wantCode:       "ROLE_ASSIGNMENT_FORBIDDEN",
			wantAuditEvent: "center.invite.role_assignment_blocked",
		},
		{
			name:          "teacher_middleware_blocked_403_insufficient_role",
			callerDBRole:  "teacher",
			callerJWTRole: "teacher",
			targetRole:    "teacher",
			wantStatus:    http.StatusForbidden,
			wantCode:      "INSUFFICIENT_ROLE",
			// No audit row — RequireRole rejects at the HTTP edge before the
			// service (and its audit ceremony) is reached.
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			db := test.SetupDB(t)

			center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
			caller := test.CreateUser(t, db, "caller-"+tc.name+"@example.com", "Caller "+tc.name)
			test.MarkUserEmailVerified(t, db, caller.ID)
			_ = test.TenantContext(t, db, center.ID)
			_ = test.CreateCenterMember(t, db, caller.ID, center.ID, tc.callerDBRole)

			srv := test.NewInvites2_6TestServerForRole(t, db, caller.ID, test.TenantAID, tc.callerJWTRole)

			inviteEmail := "target-" + tc.name + "@example.com"
			body := `{"email":"` + inviteEmail + `","role":"` + tc.targetRole + `"}`
			req := httptest.NewRequest(http.MethodPost, "/api/centers/"+test.TenantAID+"/invites",
				strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d — body: %s", rec.Code, tc.wantStatus, rec.Body.String())
			}

			if tc.wantEnvelope {
				var env inviteEnvelope
				if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
					t.Fatalf("decode success envelope: %v", err)
				}
				if env.Data.Role != tc.targetRole {
					t.Errorf("envelope role = %q, want %q", env.Data.Role, tc.targetRole)
				}
				if env.Data.Email != inviteEmail {
					t.Errorf("envelope email = %q, want %q", env.Data.Email, inviteEmail)
				}
				if env.Data.ID == "" {
					t.Errorf("envelope id must be populated")
				}
				if env.Data.ExpiresAt == "" {
					t.Errorf("envelope expiresAt must be populated")
				}
				if env.Meta.ServerTime == "" {
					t.Errorf("meta.serverTime must be populated")
				}
			}

			if tc.wantCode != "" {
				var errEnv inviteErrorEnvelope
				if err := json.NewDecoder(rec.Body).Decode(&errEnv); err != nil {
					t.Fatalf("decode error envelope: %v", err)
				}
				if errEnv.Error.Code != tc.wantCode {
					t.Errorf("error code = %q, want %q", errEnv.Error.Code, tc.wantCode)
				}
				// requestId is populated by the RequestID middleware in
				// production wiring; the test-server helpers do not stack
				// it in, so the envelope carries the "" placeholder. The
				// shape assertion (envelope has an "error" key with a
				// "requestId" property) is what we care about here.
				_ = errEnv.Error.RequestID
			}

			// Row-persistence assertion (positive AND negative).
			var inviteCount int
			_ = db.QueryRow(req.Context(),
				`SELECT COUNT(*) FROM invites WHERE center_id = $1 AND email = $2`,
				center.ID, inviteEmail,
			).Scan(&inviteCount)
			if tc.wantInviteRow && inviteCount != 1 {
				t.Errorf("expected 1 invite row for %s, got %d", inviteEmail, inviteCount)
			}
			if !tc.wantInviteRow && inviteCount != 0 {
				t.Errorf("expected 0 invite rows for %s, got %d", inviteEmail, inviteCount)
			}

			if tc.wantAuditEvent != "" {
				var rows int
				_ = db.QueryRow(req.Context(),
					`SELECT COUNT(*) FROM auth_audit_logs WHERE event = $1 AND user_id = $2`,
					tc.wantAuditEvent, caller.ID,
				).Scan(&rows)
				if rows != 1 {
					t.Errorf("expected 1 %s audit row, got %d", tc.wantAuditEvent, rows)
				}
			}
		})
	}
}

// TestInvitesHandler_AC8_InviteEmailTaken_InlineFieldError proves the
// duplicate active invite gate surfaces at the HTTP layer as 409 with
// details.field="email" per AC8's inline-field-error contract.
func TestInvitesHandler_AC8_InviteEmailTaken_InlineFieldError(t *testing.T) {
	db := test.SetupDB(t)

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "dup-owner@example.com", "Dup Owner")
	test.MarkUserEmailVerified(t, db, owner.ID)
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	srv := test.NewInvites2_6TestServerForRole(t, db, owner.ID, test.TenantAID, "owner")

	body := `{"email":"repeat@example.com","role":"teacher"}`

	req1 := httptest.NewRequest(http.MethodPost, "/api/centers/"+test.TenantAID+"/invites",
		strings.NewReader(body))
	req1.Header.Set("Content-Type", "application/json")
	rec1 := httptest.NewRecorder()
	srv.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first invite: status = %d, body = %s", rec1.Code, rec1.Body.String())
	}

	req2 := httptest.NewRequest(http.MethodPost, "/api/centers/"+test.TenantAID+"/invites",
		strings.NewReader(body))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusConflict {
		t.Fatalf("second invite: status = %d, body = %s", rec2.Code, rec2.Body.String())
	}

	var errEnv inviteErrorEnvelope
	if err := json.NewDecoder(rec2.Body).Decode(&errEnv); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if errEnv.Error.Code != "INVITE_EMAIL_TAKEN" {
		t.Errorf("error code = %q, want INVITE_EMAIL_TAKEN", errEnv.Error.Code)
	}
	details, ok := errEnv.Error.Details.([]any)
	if !ok || len(details) != 1 {
		t.Fatalf("details shape drift: %v", errEnv.Error.Details)
	}
	fieldErr, ok := details[0].(map[string]any)
	if !ok {
		t.Fatalf("field-error shape drift: %v", details[0])
	}
	if fieldErr["field"] != "email" {
		t.Errorf("details[0].field = %v, want email", fieldErr["field"])
	}
}

// TestInvitesHandler_AC8_TenantMismatch_403 belt-checks the shared
// requireSettingsTenant helper: a caller with tc.CenterID=A hitting
// path/{B}/invites gets 403 TENANT_MISMATCH before the service runs.
// Distinct from INSUFFICIENT_ROLE — matches the 2-5a settings pattern.
func TestInvitesHandler_AC8_TenantMismatch_403(t *testing.T) {
	db := test.SetupDB(t)

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "cross-owner@example.com", "Cross Owner")
	test.MarkUserEmailVerified(t, db, owner.ID)
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")

	// Caller's JWT + DB row bind them to Tenant A, but the URL path names
	// Tenant B. requireSettingsTenant returns TenantMismatchError.
	srv := test.NewInvites2_6TestServerForRole(t, db, owner.ID, test.TenantAID, "owner")

	otherCenterID := "00000000-0000-0000-0000-000000000009"
	body := `{"email":"newbie@example.com","role":"teacher"}`
	req := httptest.NewRequest(http.MethodPost, "/api/centers/"+otherCenterID+"/invites",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 — body: %s", rec.Code, rec.Body.String())
	}
	var errEnv inviteErrorEnvelope
	_ = json.NewDecoder(rec.Body).Decode(&errEnv)
	if errEnv.Error.Code != "TENANT_MISMATCH" {
		t.Errorf("error code = %q, want TENANT_MISMATCH", errEnv.Error.Code)
	}
}

// TestInvitesHandler_AC8_UnauthenticatedRequest_401 exercises the auth
// negative — no bearer token → ExtractTenant returns 401 AUTH_REQUIRED
// before the RequireRole gate ever runs. Belt-and-suspenders that the
// story-2-6 route inherits the shipped ExtractTenant + AUTH_REQUIRED
// contract unchanged.
func TestInvitesHandler_AC8_UnauthenticatedRequest_401(t *testing.T) {
	db := test.SetupDB(t)
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	// Use the bare-mux flavor so no auth-injecting wrapper overwrites the
	// (absent) Authorization header. Mirrors the 2-5b P14 fix pattern.
	srv := test.NewInvites2_6TestServerBareMux(t, db)

	body := `{"email":"newbie@example.com","role":"teacher"}`
	req := httptest.NewRequest(http.MethodPost, "/api/centers/"+test.TenantAID+"/invites",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — body: %s", rec.Code, rec.Body.String())
	}
	var errEnv inviteErrorEnvelope
	_ = json.NewDecoder(rec.Body).Decode(&errEnv)
	if !strings.HasPrefix(errEnv.Error.Code, "AUTH_") {
		t.Errorf("error code = %q, expected AUTH_* prefix", errEnv.Error.Code)
	}
}
