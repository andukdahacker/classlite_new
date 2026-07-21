// ATDD specimens for Story 3.3 — Template Management (GET detail / PUT update /
// DELETE soft-delete + authz + the AC4 spawned-class-unaffected invariant).
//
// These compile against the SHIPPED test harness (Story 2.2 helpers) and fail at
// RUNTIME because the target endpoints do not exist yet at baseline e3a5df5:
//   - GET/PUT/DELETE /api/templates/{id} are unrouted (mux → 404/405, not the
//     asserted 200/204/403/404-with-code) — Task 5 wires them.
//   - The write routes are ungated today (templateChain stops at requireCenter);
//     Task 5 adds templateWriteChain = RequireRole("owner","admin").
//   - usedCount / TemplateDetail.sessions[].duration are absent from the DTO —
//     Task 3 (api.yaml) + Task 4 (codegen) add them.
//   - TEMPLATE_READONLY is a NEW ForbiddenError code the error mapper must add.
//
// Level: API/integration (real middleware chain, committed pool) per TEST-BE-3 —
// the shipped TemplateService takes AuthDB, so there is no store seam to mock;
// this mirrors template_handler_atdd_test.go (Story 2.2).
//
// Amelia removes the red one test at a time as green-phase code lands.

package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/test"
)

// A deterministic system-seed template id (center_id IS NULL), seeded by
// migration 20260703120300_seed_class_templates. Seeds are non-editable.
const seedTemplateID = "11111111-2222-3333-4444-555555555501"

// validUpdateBody is a well-formed PUT payload (scalars + one session with the
// new duration field). Kept minimal — the point is authz/routing, not validation.
const validUpdateBody = `{"name":"Renamed Template","targetBand":6.5,"primarySkill":"writing","color":"#f59e0b","sessions":[{"title":"Session 1","description":"Intro","duration":60}]}`

func pgUUIDStr(u pgtype.UUID) string { return uuid.UUID(u.Bytes).String() }

// rawInsertClass inserts a class row referencing templateID via the superuser
// pool (bypassing RLS for commit-visible setup). Returns the class id.
func rawInsertClass(t *testing.T, centerID, templateID pgtype.UUID, name string) uuid.UUID {
	t.Helper()
	super := test.SuperuserPool(t)
	id := uuid.New()
	if _, err := super.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, template_id, name, status)
		 VALUES ($1, $2, $3, $4, 'upcoming')`,
		id, centerID, templateID, name,
	); err != nil {
		t.Fatalf("raw insert class referencing template: %v", err)
	}
	return id
}

// R5 (P0) — a teacher AND a student are rejected from PUT and DELETE with 403
// INSUFFICIENT_ROLE. Only owner+admin may mutate templates (story AC4).
func TestTemplateWrite_3_3_NonAdminRole_Returns403(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	tmpl := test.CreateClassTemplate(t, pool, centerID, "Center Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	for _, role := range []string{"teacher", "student"} {
		role := role
		t.Run(role, func(t *testing.T) {
			member := test.CreateUserOnPool(t, pool, "tpl33-"+role+"@example.com", "Member")
			test.MarkUserEmailVerifiedOnPool(t, pool, member.ID)
			test.AddCenterMember(t, pool, centerID, member.ID, role)
			t.Cleanup(func() { purgeMember(t, member.ID) })

			srv := test.NewTestServerFor2_2ForUser(t, pool, member.ID)

			put := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmpl), validUpdateBody)
			if put.Code != http.StatusForbidden {
				t.Fatalf("%s PUT: want 403, got %d — body: %s (RED until templateWriteChain gates owner+admin)", role, put.Code, put.Body.String())
			}
			if !strings.Contains(put.Body.String(), "INSUFFICIENT_ROLE") {
				t.Errorf("%s PUT: want INSUFFICIENT_ROLE, got %s", role, put.Body.String())
			}

			del := doJSON(t, srv, http.MethodDelete, "/api/templates/"+pgUUIDStr(tmpl), "")
			if del.Code != http.StatusForbidden {
				t.Fatalf("%s DELETE: want 403, got %d — body: %s", role, del.Code, del.Body.String())
			}
		})
	}
}

// R6 (P0) — an owner mutating a SYSTEM SEED (scope:"system", center_id NULL) is
// rejected with 403 TEMPLATE_READONLY, not a confusing 404. The service-layer
// seed guard fires before the write.
func TestTemplateWrite_3_3_SystemSeed_Returns403ReadOnly(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-seedguard@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	test.CreateCenterForOwner(t, pool, owner.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	for _, method := range []string{http.MethodPut, http.MethodDelete} {
		body := ""
		if method == http.MethodPut {
			body = validUpdateBody
		}
		rec := doJSON(t, srv, method, "/api/templates/"+seedTemplateID, body)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s seed: want 403, got %d — body: %s (RED until seed guard + TEMPLATE_READONLY)", method, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "TEMPLATE_READONLY") {
			t.Errorf("%s seed: want TEMPLATE_READONLY code, got %s", method, rec.Body.String())
		}
	}
}

// R7 (P0) — an owner of center B mutating center A's template gets 404
// TEMPLATE_NOT_FOUND (RLS-invisible; no cross-tenant leak, no 403 that would
// confirm existence). Covers cross-tenant reorder rejection too (reorder is a
// sub-case of the PUT full-replace path).
func TestTemplateWrite_3_3_CrossTenant_Returns404(t *testing.T) {
	pool := test.SetupRawPool(t)

	ownerA := test.CreateUserOnPool(t, pool, "tpl33-owner-a@example.com", "Owner A")
	test.MarkUserEmailVerifiedOnPool(t, pool, ownerA.ID)
	centerA := test.CreateCenterForOwner(t, pool, ownerA.ID)
	tmplA := test.CreateClassTemplate(t, pool, centerA, "Center A Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, ownerA.ID) })

	ownerB := test.CreateUserOnPool(t, pool, "tpl33-owner-b@example.com", "Owner B")
	test.MarkUserEmailVerifiedOnPool(t, pool, ownerB.ID)
	test.CreateCenterForOwner(t, pool, ownerB.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, ownerB.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, ownerB.ID)

	put := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmplA), validUpdateBody)
	if put.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant PUT: want 404, got %d — body: %s (RED until endpoint + RLS-invisible read)", put.Code, put.Body.String())
	}
	if !strings.Contains(put.Body.String(), "TEMPLATE_NOT_FOUND") {
		t.Errorf("cross-tenant PUT: want TEMPLATE_NOT_FOUND, got %s", put.Body.String())
	}
}

// R8 (P0) — AC4 invariant: editing or soft-deleting a template does NOT affect a
// class already spawned from it. The class row survives byte-unchanged and keeps
// its template_id provenance.
func TestTemplateWrite_3_3_EditAndDelete_DoesNotAffectSpawnedClass(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-ac4@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	tmpl := test.CreateClassTemplate(t, pool, centerID, "Source Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	classID := rawInsertClass(t, centerID, tmpl, "Spawned Class A")

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	// Edit the template.
	put := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmpl), validUpdateBody)
	if put.Code != http.StatusOK {
		t.Fatalf("owner PUT: want 200, got %d — body: %s (RED until PUT endpoint lands)", put.Code, put.Body.String())
	}
	// Soft-delete the template.
	del := doJSON(t, srv, http.MethodDelete, "/api/templates/"+pgUUIDStr(tmpl), "")
	if del.Code != http.StatusNoContent {
		t.Fatalf("owner DELETE: want 204, got %d — body: %s", del.Code, del.Body.String())
	}

	// The spawned class must be untouched: name intact + template_id still set.
	super := test.SuperuserPool(t)
	var name string
	var templateID pgtype.UUID
	if err := super.QueryRow(context.Background(),
		`SELECT name, template_id FROM classes WHERE id = $1`, classID).Scan(&name, &templateID); err != nil {
		t.Fatalf("re-read spawned class: %v", err)
	}
	if name != "Spawned Class A" {
		t.Errorf("AC4 VIOLATION: template edit/delete mutated the spawned class name to %q", name)
	}
	if !templateID.Valid || pgUUIDStr(templateID) != pgUUIDStr(tmpl) {
		t.Errorf("AC4 VIOLATION: spawned class lost its template_id provenance after template soft-delete")
	}
}

// R9 (P1) — usedCount is per-tenant on a SHARED system seed: two centers each
// spawn a different number of classes from the same seed and each sees only its
// own count (RLS-scoped aggregate, PERF-2 single SQL COUNT — not global).
func TestListTemplates_3_3_UsedCount_IsPerTenantOnSharedSeed(t *testing.T) {
	pool := test.SetupRawPool(t)
	seed := test.NewPGUUIDFromString(seedTemplateID)

	ownerA := test.CreateUserOnPool(t, pool, "tpl33-used-a@example.com", "Owner A")
	test.MarkUserEmailVerifiedOnPool(t, pool, ownerA.ID)
	centerA := test.CreateCenterForOwner(t, pool, ownerA.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, ownerA.ID) })

	ownerB := test.CreateUserOnPool(t, pool, "tpl33-used-b@example.com", "Owner B")
	test.MarkUserEmailVerifiedOnPool(t, pool, ownerB.ID)
	centerB := test.CreateCenterForOwner(t, pool, ownerB.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, ownerB.ID) })

	// A spawns 2 from the seed, B spawns 1.
	rawInsertClass(t, centerA, seed, "A-1")
	rawInsertClass(t, centerA, seed, "A-2")
	rawInsertClass(t, centerB, seed, "B-1")

	if got := usedCountForSeed(t, test.NewTestServerFor2_2ForUser(t, pool, ownerA.ID)); got != 2 {
		t.Errorf("tenant A: want usedCount 2 for the shared seed, got %d (RED until usedCount COUNT lands; leak if it returns 3)", got)
	}
	if got := usedCountForSeed(t, test.NewTestServerFor2_2ForUser(t, pool, ownerB.ID)); got != 1 {
		t.Errorf("tenant B: want usedCount 1 for the shared seed, got %d", got)
	}
}

// R10 (P1) — GET /api/templates/{id} returns the {data,meta} envelope with the
// ordered sessions[] carrying sessionOrder+title+description+duration, plus
// usedCount (closes FU-3-1-A; contract lock for s20 + the picker preview).
func TestGetTemplate_3_3_Detail_ReturnsSessionsWithDurationAndUsedCount(t *testing.T) {
	pool := test.SetupRawPool(t)
	seed := test.NewPGUUIDFromString(seedTemplateID)

	owner := test.CreateUserOnPool(t, pool, "tpl33-detail@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	test.CreateCenterForOwner(t, pool, owner.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)
	rec := doJSON(t, srv, http.MethodGet, "/api/templates/"+pgUUIDStr(seed), "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET detail: want 200, got %d — body: %s (RED until GET /api/templates/{id} lands)", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			ID        string `json:"id"`
			UsedCount *int   `json:"usedCount"`
			Sessions  []struct {
				SessionOrder int     `json:"sessionOrder"`
				Title        string  `json:"title"`
				Description  *string `json:"description"`
				Duration     *int    `json:"duration"`
			} `json:"sessions"`
		} `json:"data"`
		Meta struct {
			ServerTime string `json:"serverTime"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	if env.Data.UsedCount == nil {
		t.Errorf("GET detail: usedCount MUST be present (FU-3-1-A/AC2)")
	}
	if len(env.Data.Sessions) == 0 {
		t.Errorf("GET detail: sessions[] MUST be returned (the seed has starter sessions) — closes FU-3-1-A")
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("GET detail: envelope meta.serverTime MUST be populated (GFW-5)")
	}
}

// -- helpers -----------------------------------------------------------------

func doJSON(t *testing.T, srv http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, r)
	return rec
}

func usedCountForSeed(t *testing.T, srv http.Handler) int {
	t.Helper()
	rec := doJSON(t, srv, http.MethodGet, "/api/templates", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("GET list: want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Templates []struct {
				ID        string `json:"id"`
				UsedCount *int   `json:"usedCount"`
			} `json:"templates"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	for _, tpl := range env.Data.Templates {
		if tpl.ID == seedTemplateID {
			if tpl.UsedCount == nil {
				t.Fatalf("usedCount field absent on the seed row (RED until Task 2/3 add it)")
			}
			return *tpl.UsedCount
		}
	}
	t.Fatalf("seed template %s not present in list", seedTemplateID)
	return -1
}

// purgeMember removes a non-owner member user (membership row first, then the
// user) via the superuser pool so the committed-pool test is re-runnable.
func purgeMember(t *testing.T, userID pgtype.UUID) {
	t.Helper()
	super := test.SuperuserPool(t)
	ctx := context.Background()
	super.Exec(ctx, `DELETE FROM center_members WHERE user_id = $1`, userID)
	super.Exec(ctx, `DELETE FROM users WHERE id = $1`, userID)
}
