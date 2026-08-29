// Story 7.1a (AC1/AC2/AC5/AC6/AC14/AC16 · risk=7) — the staff HTTP surface authz
// EDGE (real middleware chain) + existence non-disclosure + the split-object envelope.
// These ride the shipped RequireRole middleware (proven by Story 2.6) around the
// net-new staff routes; the substance here is that the routes are wired to the RIGHT
// role gate and that a cross-boundary detail read 404s (never 403 — no existence leak).
//
// package handler_test — reuses errorEnvelope + newReqWithRequestID.
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// test-server seam test.NewStaffTestServerForRole (dev adds it in Task 9, mirroring
// test.NewInvites2_6TestServerForRole — the repo's per-story test-server convention).
//
// GREEN SEAMS (dev):
//
//	test.NewStaffTestServerForRole(t, db, callerUserID pgtype.UUID, centerID, role string) http.Handler
//	  mounts GET /api/staff (RequireRole owner,admin), GET /api/staff/{userId} (owner,admin),
//	  POST /api/staff/{userId}/{archive,assign-class,reset-password} (RequireRole owner),
//	  with the production ExtractTenant → Require* chain and the caller's JWT injected.
//	Envelope: GET /api/staff → { data: { members: [...], pendingInvites: [...] } } (D10 provisional —
//	  asserted LOOSELY here: top-level keys present, inner field spellings co-finalized in 7-1b).
//
// NB: AC16 force-logout REUSE (FR-80) is already covered by the shipped
// TestForceLogout_AC06_HappyPath_200Envelope (teacher target) +
// TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden — NOT duplicated here.
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// staffCaller seeds a center member with the given DB role and returns the ids.
func staffCaller(t *testing.T, db *test.TxDB, centerID pgtype.UUID, email, role string) pgtype.UUID {
	t.Helper()
	u := test.CreateUser(t, db, email, "Staff "+role)
	test.CreateCenterMember(t, db, u.ID, centerID, role)
	return u.ID
}

// AC2/AC6 — a teacher or student caller is 403 INSUFFICIENT_ROLE on both read endpoints.
func TestStaffHandler_ReadAuthzGrid_TeacherStudent403_ATDD(t *testing.T) {
	for _, role := range []string{"teacher", "student"} {
		t.Run(role, func(t *testing.T) {
			db := test.SetupDB(t)
			centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
			test.TenantContext(t, db, centerA.ID)
			caller := staffCaller(t, db, centerA.ID, role+"@example.com", role)
			srv := test.NewStaffTestServerForRole(t, db, caller, test.TenantAID, role)

			for _, path := range []string{"/api/staff", "/api/staff/" + uuid.NewString()} {
				req := newReqWithRequestID(http.MethodGet, path, "")
				rec := httptest.NewRecorder()
				srv.ServeHTTP(rec, req)
				if rec.Code != http.StatusForbidden {
					t.Fatalf("%s as %s: want 403, got %d (body=%q)", path, role, rec.Code, rec.Body.String())
				}
				var env errorEnvelope
				if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
					t.Fatalf("decode: %v", err)
				}
				if env.Error.Code != "INSUFFICIENT_ROLE" {
					t.Errorf("%s as %s: error.code want INSUFFICIENT_ROLE, got %q", path, role, env.Error.Code)
				}
			}
		})
	}
}

// AC16 — admin / teacher / student are 403 on the Owner-only ACTION endpoints (edge gate).
func TestStaffHandler_ActionAuthzGrid_NonOwner403_ATDD(t *testing.T) {
	for _, role := range []string{"admin", "teacher", "student"} {
		t.Run(role, func(t *testing.T) {
			db := test.SetupDB(t)
			centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
			test.TenantContext(t, db, centerA.ID)
			caller := staffCaller(t, db, centerA.ID, role+"@example.com", role)
			srv := test.NewStaffTestServerForRole(t, db, caller, test.TenantAID, role)

			req := newReqWithRequestID(http.MethodPost, "/api/staff/"+uuid.NewString()+"/archive", "")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("archive as %s: want 403, got %d (body=%q)", role, rec.Code, rec.Body.String())
			}
		})
	}
}

// AC5/B5 — existence non-disclosure: an Admin requesting the OWNER's detail gets 404
// STAFF_NOT_FOUND (never 403 — do not disclose the owner's existence/role).
func TestStaffHandler_OwnerDetailNonDisclosure404_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := staffCaller(t, db, centerA.ID, "owner@example.com", "owner")
	admin := staffCaller(t, db, centerA.ID, "admin@example.com", "admin")
	srv := test.NewStaffTestServerForRole(t, db, admin, test.TenantAID, "admin")

	req := newReqWithRequestID(http.MethodGet, "/api/staff/"+test.UUIDString(owner), "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("admin→owner detail: want 404, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var env errorEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Error.Code != "STAFF_NOT_FOUND" {
		t.Errorf("error.code: want STAFF_NOT_FOUND, got %q (must not be FORBIDDEN — no existence leak)", env.Error.Code)
	}
}

// AC1 — owner GET /api/staff → 200 with the split-object envelope (loose per D10).
func TestStaffHandler_ListHappy200Envelope_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := staffCaller(t, db, centerA.ID, "owner@example.com", "owner")
	srv := test.NewStaffTestServerForRole(t, db, owner, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodGet, "/api/staff", "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner list: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "members") || !strings.Contains(body, "pendingInvites") {
		t.Errorf("split-object envelope: want members+pendingInvites keys, got %q", body)
	}
}

// AC14 — self-archive → 409 CANNOT_ARCHIVE_SELF (an Owner cannot archive themselves).
func TestStaffHandler_SelfArchive409_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := staffCaller(t, db, centerA.ID, "owner@example.com", "owner")
	srv := test.NewStaffTestServerForRole(t, db, owner, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodPost, "/api/staff/"+test.UUIDString(owner)+"/archive", "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("self-archive: want 409, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "CANNOT_ARCHIVE_SELF") {
		t.Errorf("body should mention CANNOT_ARCHIVE_SELF, got %q", rec.Body.String())
	}
}
