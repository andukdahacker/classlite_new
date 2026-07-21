// Story 3.3 — green-phase coverage beyond the mandated red suite
// (template_handler_3_3_atdd_test.go). Exercises the admin-role positive path,
// session_count re-derivation + full-replace semantics, delete→get→404, body
// validation, and audit-row emission. API/integration level via the shipped
// NewTestServerFor2_2ForUser harness (TEST-BE-3), same package as the red suite
// so it reuses doJSON / pgUUIDStr / validUpdateBody / rawInsertClass.

package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
)

// twoSessionUpdateBody replaces the session set with two ordered sessions (one
// carrying a duration, one null) so the re-derivation + replace can be asserted.
const twoSessionUpdateBody = `{"name":"Replaced","targetBand":7.0,"primarySkill":"speaking","color":"#3b82f6","sessions":[{"title":"S1","description":"first","duration":45},{"title":"S2","description":null,"duration":null}]}`

// R-admin (green) — an ADMIN (not owner) may PUT and DELETE. Pairs with the red
// R5 teacher/student negative to prove the exact owner+admin allowlist.
func TestTemplateWrite_3_3_AdminRole_CanUpdateAndDelete(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-adm-owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	tmpl := test.CreateClassTemplate(t, pool, centerID, "Admin-editable Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	admin := test.CreateUserOnPool(t, pool, "tpl33-adm-member@example.com", "Admin")
	test.MarkUserEmailVerifiedOnPool(t, pool, admin.ID)
	test.AddCenterMember(t, pool, centerID, admin.ID, "admin")
	t.Cleanup(func() { purgeMember(t, admin.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, admin.ID)

	put := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmpl), validUpdateBody)
	if put.Code != http.StatusOK {
		t.Fatalf("admin PUT: want 200, got %d — body: %s", put.Code, put.Body.String())
	}
	del := doJSON(t, srv, http.MethodDelete, "/api/templates/"+pgUUIDStr(tmpl), "")
	if del.Code != http.StatusNoContent {
		t.Fatalf("admin DELETE: want 204, got %d — body: %s", del.Code, del.Body.String())
	}
}

// Green — PUT derives session_count = len(sessions) and FULLY REPLACES the
// session set (ordered, with durations). Then GET reflects the new detail, and
// a soft-deleted template 404s.
func TestTemplateUpdate_3_3_DerivesCountReplacesSessions_ThenDeleteGet404(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-derive@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	// Seed session_count=12, zero session rows — the replace must drive it to 2.
	tmpl := test.CreateClassTemplate(t, pool, centerID, "Derive Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	put := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmpl), twoSessionUpdateBody)
	if put.Code != http.StatusOK {
		t.Fatalf("PUT: want 200, got %d — body: %s", put.Code, put.Body.String())
	}
	var putEnv struct {
		Data struct {
			SessionCount int `json:"sessionCount"`
			Sessions     []struct {
				SessionOrder int     `json:"sessionOrder"`
				Title        string  `json:"title"`
				Duration     *int    `json:"duration"`
				Description  *string `json:"description"`
			} `json:"sessions"`
		} `json:"data"`
	}
	if err := json.NewDecoder(put.Body).Decode(&putEnv); err != nil {
		t.Fatalf("decode PUT: %v", err)
	}
	if putEnv.Data.SessionCount != 2 {
		t.Errorf("sessionCount derived: want 2, got %d", putEnv.Data.SessionCount)
	}
	if len(putEnv.Data.Sessions) != 2 {
		t.Fatalf("sessions replaced: want 2, got %d", len(putEnv.Data.Sessions))
	}
	if putEnv.Data.Sessions[0].SessionOrder != 0 || putEnv.Data.Sessions[1].SessionOrder != 1 {
		t.Errorf("session order: want [0,1], got [%d,%d]", putEnv.Data.Sessions[0].SessionOrder, putEnv.Data.Sessions[1].SessionOrder)
	}
	if putEnv.Data.Sessions[0].Duration == nil || *putEnv.Data.Sessions[0].Duration != 45 {
		t.Errorf("session[0].duration: want 45, got %v", putEnv.Data.Sessions[0].Duration)
	}
	if putEnv.Data.Sessions[1].Duration != nil {
		t.Errorf("session[1].duration: want null, got %v", *putEnv.Data.Sessions[1].Duration)
	}

	// GET reflects the replacement.
	get := doJSON(t, srv, http.MethodGet, "/api/templates/"+pgUUIDStr(tmpl), "")
	if get.Code != http.StatusOK {
		t.Fatalf("GET after PUT: want 200, got %d", get.Code)
	}

	// Soft-delete, then GET → 404.
	del := doJSON(t, srv, http.MethodDelete, "/api/templates/"+pgUUIDStr(tmpl), "")
	if del.Code != http.StatusNoContent {
		t.Fatalf("DELETE: want 204, got %d — body: %s", del.Code, del.Body.String())
	}
	getGone := doJSON(t, srv, http.MethodGet, "/api/templates/"+pgUUIDStr(tmpl), "")
	if getGone.Code != http.StatusNotFound {
		t.Fatalf("GET after DELETE: want 404, got %d", getGone.Code)
	}
	if !strings.Contains(getGone.Body.String(), "TEMPLATE_NOT_FOUND") {
		t.Errorf("GET after DELETE: want TEMPLATE_NOT_FOUND, got %s", getGone.Body.String())
	}
}

// Green — a PUT with an empty session set and an out-of-range duration are both
// 422 VALIDATION_ERROR (session_count is derived, so ≥1 is enforced in the service).
func TestTemplateUpdate_3_3_InvalidBody_Returns422(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-invalid@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	tmpl := test.CreateClassTemplate(t, pool, centerID, "Invalid-body Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	cases := map[string]string{
		"empty sessions":       `{"name":"X","targetBand":7.0,"primarySkill":"writing","color":null,"sessions":[]}`,
		"duration below bound": `{"name":"X","targetBand":7.0,"primarySkill":"writing","color":null,"sessions":[{"title":"S1","description":null,"duration":1}]}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			rec := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmpl), body)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
				t.Errorf("want VALIDATION_ERROR, got %s", rec.Body.String())
			}
		})
	}
}

// Green — PUT + DELETE each write an audit row (class_template.updated /
// class_template.deleted) scoped to the template entity.
func TestTemplateWrite_3_3_WritesAuditRows(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "tpl33-audit@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	tmpl := test.CreateClassTemplate(t, pool, centerID, "Audited Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	if put := doJSON(t, srv, http.MethodPut, "/api/templates/"+pgUUIDStr(tmpl), validUpdateBody); put.Code != http.StatusOK {
		t.Fatalf("PUT: want 200, got %d — body: %s", put.Code, put.Body.String())
	}
	if del := doJSON(t, srv, http.MethodDelete, "/api/templates/"+pgUUIDStr(tmpl), ""); del.Code != http.StatusNoContent {
		t.Fatalf("DELETE: want 204, got %d — body: %s", del.Code, del.Body.String())
	}

	super := test.SuperuserPool(t)
	for _, action := range []string{"class_template.updated", "class_template.deleted"} {
		var n int
		if err := super.QueryRow(context.Background(),
			`SELECT count(*) FROM audit_logs WHERE action = $1 AND entity_id = $2`,
			action, tmpl,
		).Scan(&n); err != nil {
			t.Fatalf("count audit rows for %s: %v", action, err)
		}
		if n != 1 {
			t.Errorf("audit %s: want 1 row for template, got %d", action, n)
		}
	}
}
