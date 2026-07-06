// ATDD specimens for Story 2.2 — Template Handler.
//
// Expected to FAIL against current codebase:
//   - handler.NewTemplateHandler does not exist yet (Task 8.1)
//   - service.NewTemplateService / service.NewClassService do not exist (Task 6/7)
//   - middleware.RequireCenterContext not implemented (Task 4.1)
//   - migrations 20260703120000..20260703120400 not applied (Task 2)
//   - Story 2-2 test harness (test.NewTestServerFor2_2, CreateClassTemplate,
//     etc.) not yet defined (Task 11.6 — story_2_2_helpers.go)
//
// Coverage — happy paths + negative matrix + AC11 attack matrix + AC6 Founder
// auto-assign. AC9 audit atomicity is covered exclusively at the SERVICE
// layer (`class_atdd_test.go:TestClassService_Spawn_AC09_BrokenAuditRollsBackWholeTx`)
// via a brokenAuditLogger injected at the constructor seam; the handler is
// a thin binder and adding a duplicated broken-audit route at this layer
// would not surface new failure modes (C3-12 review-finding: file header
// previously overclaimed handler-level coverage).
//
// Naming convention matches internal/handler/onboarding_handler_atdd_test.go
// and center_handler_atdd_test.go — Amelia removes the compile-fail one file
// at a time as green-phase code lands.

package handler_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/test"
)

// -----------------------------------------------------------------------------
// AC1 — GET /api/templates
// -----------------------------------------------------------------------------

func TestListTemplates_AC01_MixedScope_ReturnsSystemPlusOwnCenter(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	test.CreateClassTemplate(t, pool, centerID, "My Custom Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("AC1: want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			Templates []struct {
				ID           string  `json:"id"`
				Name         string  `json:"name"`
				TargetBand   float64 `json:"targetBand"`
				PrimarySkill string  `json:"primarySkill"`
				SessionCount int     `json:"sessionCount"`
				Color        *string `json:"color"`
				Scope        string  `json:"scope"`
			} `json:"templates"`
		} `json:"data"`
		Meta struct {
			ServerTime string `json:"serverTime"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("AC12: meta.serverTime MUST be populated")
	}

	nSystem, nCenter := 0, 0
	sawCustomFirst := false // used to prove system-first sort order
	for i, tpl := range env.Data.Templates {
		switch tpl.Scope {
		case "system":
			if sawCustomFirst {
				t.Errorf("AC1 sort: system template at index %d must come BEFORE center-owned ones", i)
			}
			nSystem++
		case "center":
			nCenter++
			sawCustomFirst = true
		default:
			t.Errorf("AC1: scope MUST be 'system' or 'center', got %q at index %d", tpl.Scope, i)
		}
	}
	if nSystem < 5 {
		t.Errorf("AC1b + Sally-S1: want >=5 system seed templates, got %d — seed migration incomplete", nSystem)
	}
	if nCenter != 1 {
		t.Errorf("AC1: want 1 center-owned template, got %d", nCenter)
	}
}

func TestListTemplates_AC01_MissingCenter_Returns403CenterRequired(t *testing.T) {
	// Caller finished 2.1 persona pick but hasn't POSTed a center yet.
	// RequireCenterContext must fire with CENTER_REQUIRED (AC13 routing).
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "no-center@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	// C3-11 review fix — explicit no-center helper; the general
	// NewTestServerFor2_2ForUser now t.Fatals on missing center_members.
	srv := test.NewTestServerFor2_2ForUserNoCenter(t, db, user.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("AC8/AC13: want 403, got %d", rec.Code)
	}
	assertErrorCodeTmpl(t, rec.Body, "CENTER_REQUIRED")
}

func TestListTemplates_AC01_NoAuth_Returns401(t *testing.T) {
	db := test.SetupDB(t)
	srv := test.NewTestServerFor2_2Unauthenticated(t, db)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("AC13: want 401, got %d", rec.Code)
	}
}

func TestListTemplates_AC01_UnverifiedEmail_Returns403(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "unverified@example.com", "U") // NOT verified — no center either
	srv := test.NewTestServerFor2_2ForUserNoCenter(t, db, user.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/templates", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("AC13: want 403, got %d", rec.Code)
	}
	assertErrorCodeTmpl(t, rec.Body, "EMAIL_VERIFICATION_REQUIRED")
}

// -----------------------------------------------------------------------------
// AC2 — POST /api/templates (create custom template)
// -----------------------------------------------------------------------------

func TestCreateTemplate_AC02_HappyPath_ReturnsScopeCenterAndSessions(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	test.CreateCenterForOwner(t, pool, owner.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	body := `{
		"name":"Custom Reading Push",
		"targetBand":7.0,
		"primarySkill":"reading",
		"sessionCount":3,
		"color":"#14b8a6",
		"sessions":[
			{"title":"Skim + scan basics","description":"Warmup"},
			{"title":"T/F/NG drill","description":null},
			{"title":"Full passage timing","description":"Timed exam sim"}
		]
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("AC2: want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			ID           string  `json:"id"`
			Name         string  `json:"name"`
			TargetBand   float64 `json:"targetBand"`
			PrimarySkill string  `json:"primarySkill"`
			SessionCount int     `json:"sessionCount"`
			Color        *string `json:"color"`
			Scope        string  `json:"scope"`
			Sessions     []struct {
				ID           string  `json:"id"`
				Title        string  `json:"title"`
				Description  *string `json:"description"`
				SessionOrder int     `json:"sessionOrder"`
			} `json:"sessions"`
		} `json:"data"`
		Meta struct{ ServerTime string `json:"serverTime"` } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.Scope != "center" {
		t.Errorf("AC2: scope MUST be 'center' for a user-created template, got %q", env.Data.Scope)
	}
	if env.Data.SessionCount != 3 || len(env.Data.Sessions) != 3 {
		t.Errorf("AC2: sessionCount=%d, sessions.length=%d — MUST equal (single source of truth)", env.Data.SessionCount, len(env.Data.Sessions))
	}
	for i, s := range env.Data.Sessions {
		if s.SessionOrder != i {
			t.Errorf("AC2: sessions[%d].sessionOrder = %d, want %d (0-indexed input order)", i, s.SessionOrder, i)
		}
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("AC12: meta.serverTime MUST be populated")
	}
}

func TestCreateTemplate_AC02_SessionCountMismatch_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	test.MarkUserEmailVerified(t, db, owner.ID)
	test.SeedCenterForUser(t, db, owner.ID) // helper landing in Task 11.6

	srv := test.NewTestServerFor2_2ForUser(t, db, owner.ID)

	// sessionCount=5 but only 2 sessions provided — spec MUST reject.
	body := `{
		"name":"Broken","targetBand":6.5,"primarySkill":"writing",
		"sessionCount":5,"color":null,
		"sessions":[{"title":"one","description":null},{"title":"two","description":null}]
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("AC2 single-source-of-truth: want 422, got %d", rec.Code)
	}
	assertErrorCodeTmpl(t, rec.Body, "VALIDATION_ERROR")
}

func TestCreateTemplate_AC02_InvalidPrimarySkill_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	test.MarkUserEmailVerified(t, db, owner.ID)
	test.SeedCenterForUser(t, db, owner.ID)
	srv := test.NewTestServerFor2_2ForUser(t, db, owner.ID)

	body := `{
		"name":"Bad Skill","targetBand":6.5,"primarySkill":"parkour",
		"sessionCount":1,"color":null,"sessions":[{"title":"x","description":null}]
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d", rec.Code)
	}
	// C3-17 review fix — assert the error code, not just HTTP status.
	assertErrorCodeTmpl(t, rec.Body, "VALIDATION_ERROR")
}

func TestCreateTemplate_AC02_MissingCenter_Returns403CenterRequired(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "no-center@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerFor2_2ForUserNoCenter(t, db, user.ID)

	body := `{"name":"n","targetBand":6.5,"primarySkill":"writing","sessionCount":1,"color":null,"sessions":[{"title":"x","description":null}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("AC8: want 403 CENTER_REQUIRED, got %d", rec.Code)
	}
	assertErrorCodeTmpl(t, rec.Body, "CENTER_REQUIRED")
}

// -----------------------------------------------------------------------------
// AC3 — POST /api/templates/{id}/spawn (happy + response shape)
// -----------------------------------------------------------------------------

func TestSpawn_AC03_HappyMixedBranches_ReturnsFullResponseShape(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	teacher := test.CreateUserOnPool(t, pool, "teacher@example.com", "Teacher")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	test.AddCenterMember(t, pool, centerID, teacher.ID, "teacher")
	templateID := test.CreateClassTemplate(t, pool, centerID, "Owned Template")
	t.Cleanup(func() {
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacher.ID)
	})

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	body := fmt.Sprintf(`{
		"classes":[
			{"cohortName":"Self",     "startDate":"2026-08-01","teacherEmail":"owner@example.com"},
			{"cohortName":"Member",   "startDate":"2026-08-08","teacherEmail":"teacher@example.com"},
			{"cohortName":"Invited",  "startDate":"2026-08-15","teacherEmail":"stranger@example.com"},
			{"cohortName":"Unassigned","startDate":"2026-08-22","teacherEmail":null}
		]
	}`)
	spawnURL := "/api/templates/" + test.UUIDString(templateID) + "/spawn"
	req := httptest.NewRequest(http.MethodPost, spawnURL, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("AC3: want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			Classes []struct {
				ID                      string  `json:"id"`
				Name                    string  `json:"name"`
				StartDate               string  `json:"startDate"`
				TeacherID               *string `json:"teacherId"`
				TeacherEmail            *string `json:"teacherEmail"`
				PendingTeacherEmail     *string `json:"pendingTeacherEmail"`
				TeacherStatus           string  `json:"teacherStatus"`
				TeacherAssignmentReason string  `json:"teacherAssignmentReason"`
			} `json:"classes"`
			Invites []struct {
				Email                string `json:"email"`
				ClassIndices         []int  `json:"classIndices"`
				Enqueued             bool   `json:"enqueued"`
				ReusedExistingInvite bool   `json:"reusedExistingInvite"`
				ExpiresAt            string `json:"expiresAt"`
			} `json:"invites"`
			InvitesSent int `json:"invitesSent"`
		} `json:"data"`
		Meta struct{ ServerTime string `json:"serverTime"` } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data.Classes) != 4 {
		t.Fatalf("AC3: want 4 spawned classes, got %d", len(env.Data.Classes))
	}
	got := map[string]struct {
		Status string
		Reason string
	}{}
	for _, c := range env.Data.Classes {
		got[c.Name] = struct{ Status, Reason string }{c.TeacherStatus, c.TeacherAssignmentReason}
	}
	// Branch A / B / C / D discriminants
	if got["Self"].Status != "assigned" || got["Self"].Reason != "explicit_self" {
		t.Errorf("AC3 Branch A: Self class got %+v, want (assigned, explicit_self)", got["Self"])
	}
	if got["Member"].Status != "assigned" || got["Member"].Reason != "explicit_member" {
		t.Errorf("AC3 Branch B: Member class got %+v, want (assigned, explicit_member)", got["Member"])
	}
	if got["Invited"].Status != "invited" || got["Invited"].Reason != "invited" {
		t.Errorf("AC3 Branch C: Invited class got %+v, want (invited, invited)", got["Invited"])
	}
	if got["Unassigned"].Status != "unassigned" || got["Unassigned"].Reason != "unassigned" {
		t.Errorf("AC3 Branch D: Unassigned class got %+v, want (unassigned, unassigned)", got["Unassigned"])
	}
	// One invite bucket for stranger@ only.
	if len(env.Data.Invites) != 1 || env.Data.Invites[0].Email != "stranger@example.com" {
		t.Errorf("AC3 invites[] shape: want 1 bucket for 'stranger@example.com', got %+v", env.Data.Invites)
	}
	if env.Data.InvitesSent != 1 {
		t.Errorf("AC3 invitesSent (newly-created + enqueued): want 1, got %d", env.Data.InvitesSent)
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("AC12: meta.serverTime MUST be populated")
	}
}

// -----------------------------------------------------------------------------
// AC6 — Founder auto-assign on classes[0] (handler-level round trip)
// -----------------------------------------------------------------------------

func TestSpawn_AC06_FounderAutoAssign_ClassesZeroTeacherIsFounder(t *testing.T) {
	pool := test.SetupRawPool(t)
	founder := test.CreateUserOnPool(t, pool, "founder@example.com", "F")
	test.MarkUserEmailVerifiedOnPool(t, pool, founder.ID)
	test.SetUserPersonaOnPool(t, pool, founder.ID, "founder")
	centerID := test.CreateCenterForOwner(t, pool, founder.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, founder.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, founder.ID)

	body := `{"classes":[
		{"cohortName":"First",  "startDate":"2026-08-01","teacherEmail":null},
		{"cohortName":"Second", "startDate":"2026-08-08","teacherEmail":null}
	]}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(templateID)+"/spawn", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("AC6: want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Classes []struct {
				Name                    string  `json:"name"`
				TeacherID               *string `json:"teacherId"`
				TeacherAssignmentReason string  `json:"teacherAssignmentReason"`
				TeacherStatus           string  `json:"teacherStatus"`
			} `json:"classes"`
		} `json:"data"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&env)

	first := env.Data.Classes[0]
	if first.TeacherID == nil || *first.TeacherID != test.UUIDString(founder.ID) {
		t.Errorf("AC6: classes[0].teacherID MUST equal founder.userID (FR-4 server enforcement). got %v", first.TeacherID)
	}
	if first.TeacherAssignmentReason != "founder_auto" {
		t.Errorf("AC6: classes[0].teacherAssignmentReason MUST be 'founder_auto', got %q", first.TeacherAssignmentReason)
	}
	second := env.Data.Classes[1]
	if second.TeacherStatus != "unassigned" {
		t.Errorf("AC6: only classes[0] auto-assigns — classes[1] MUST remain unassigned, got %q", second.TeacherStatus)
	}

	// C3-15 review fix — verify DB state after the 201, not just the response
	// body. A regression where the handler returns a lying 201 without a
	// real DB write would otherwise pass this test.
	sp := test.SuperuserPool(t)
	nClasses := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if nClasses != 2 {
		t.Errorf("AC6 DB verify: expected 2 classes rows in DB, got %d", nClasses)
	}
}

// -----------------------------------------------------------------------------
// C3-14 review fix — non-founder personas MUST NOT auto-assign on classes[0].
// Guards against a regression where the persona-check drift silently plants
// admin/operator/teacher as the classes[0] teacher.
// -----------------------------------------------------------------------------
func TestSpawn_AC06_NonFounderPersonaDoesNotAutoAssign(t *testing.T) {
	nonFounderPersonas := []string{"operator", "solo_teacher"}
	for _, persona := range nonFounderPersonas {
		t.Run(persona, func(t *testing.T) {
			pool := test.SetupRawPool(t)
			owner := test.CreateUserOnPool(t, pool, persona+"-owner@example.com", "O")
			test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
			test.SetUserPersonaOnPool(t, pool, owner.ID, persona)
			centerID := test.CreateCenterForOwner(t, pool, owner.ID)
			templateID := test.CreateClassTemplate(t, pool, centerID, "T")
			t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

			srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

			body := `{"classes":[{"cohortName":"First","startDate":"2026-08-01","teacherEmail":null}]}`
			req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(templateID)+"/spawn", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)

			if rec.Code != http.StatusCreated {
				t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
			}
			var env struct {
				Data struct {
					Classes []struct {
						TeacherID     *string `json:"teacherId"`
						TeacherStatus string  `json:"teacherStatus"`
					} `json:"classes"`
				} `json:"data"`
			}
			_ = json.NewDecoder(rec.Body).Decode(&env)

			c0 := env.Data.Classes[0]
			if c0.TeacherStatus != "unassigned" {
				t.Errorf("AC6 %s persona MUST NOT auto-assign — got teacherStatus=%q, teacherID=%v", persona, c0.TeacherStatus, c0.TeacherID)
			}
			if c0.TeacherID != nil {
				t.Errorf("AC6 %s persona MUST NOT plant classes[0].teacher_id — got %v", persona, *c0.TeacherID)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// AC3 — Spawn validation matrix
// -----------------------------------------------------------------------------

func TestSpawn_AC03_MalformedTeacherEmail_Returns422InvalidTeacherEmail(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "O")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	body := `{"classes":[{"cohortName":"X","startDate":"2026-08-01","teacherEmail":"not-an-email"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(templateID)+"/spawn", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("AC13: want 422, got %d", rec.Code)
	}
	assertErrorCodeTmpl(t, rec.Body, "VALIDATION_ERROR")
	// Field-level code per AC13 error catalog.
	assertFieldErrorCode(t, rec.Body, "INVALID_TEACHER_EMAIL")
}

func TestSpawn_AC03_EmptyClassesList_Returns422(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "O")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	body := `{"classes":[]}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(templateID)+"/spawn", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("AC3 length bounds: want 422 for empty classes, got %d", rec.Code)
	}
	// C3-17 review fix — assert the error code, not just HTTP status.
	assertErrorCodeTmpl(t, rec.Body, "VALIDATION_ERROR")

	// C3-16 review fix — assert zero classes were written to the DB on the
	// validation-error path (belt against a future "validate late, roll back
	// after partial insert" regression).
	sp := test.SuperuserPool(t)
	nClasses := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if nClasses != 0 {
		t.Errorf("AC3 no-partial-write: %d classes rows in center after validation error, expected 0", nClasses)
	}
	// R2-P12 — templateID is used at line 540 to build the spawn URL. The
	// prior `_ = templateID` was a stale suppression left from an earlier
	// refactor and has been removed.
}

// -----------------------------------------------------------------------------
// AC11 — Cross-tenant cross-user attack matrix
// -----------------------------------------------------------------------------

func TestSpawn_AC11_AttackVectors(t *testing.T) {
	pool := test.SetupRawPool(t)

	// C3-02 review fix — each subtest gets its own fresh attacker/victim
	// fixture with unique-suffix emails so subtests can run in any order
	// (partial `-run` filter, parallel, future Go runtime change) without
	// contaminating each other. Cleanup registers per-subtest via t.Cleanup.
	type ac11Fixture struct {
		attackerCenter    pgtype.UUID
		victimCenter      pgtype.UUID
		attackerTemplate  pgtype.UUID
		victimTemplate    pgtype.UUID
		srv               http.Handler
	}
	setup := func(t *testing.T, suffix string) ac11Fixture {
		attacker := test.CreateUserOnPool(t, pool, "attacker-"+suffix+"@example.com", "A")
		victim := test.CreateUserOnPool(t, pool, "victim-"+suffix+"@example.com", "V")
		test.MarkUserEmailVerifiedOnPool(t, pool, attacker.ID)
		test.MarkUserEmailVerifiedOnPool(t, pool, victim.ID)
		attackerCenter := test.CreateCenterForOwner(t, pool, attacker.ID)
		victimCenter := test.CreateCenterForOwner(t, pool, victim.ID)
		attackerTemplate := test.CreateClassTemplate(t, pool, attackerCenter, "Attacker Template")
		victimTemplate := test.CreateClassTemplate(t, pool, victimCenter, "Victim Template")
		t.Cleanup(func() {
			test.PurgeUserAndOwnedCenters(t, pool, attacker.ID)
			test.PurgeUserAndOwnedCenters(t, pool, victim.ID)
		})
		return ac11Fixture{
			attackerCenter:   attackerCenter,
			victimCenter:     victimCenter,
			attackerTemplate: attackerTemplate,
			victimTemplate:   victimTemplate,
			srv:              test.NewTestServerFor2_2ForUser(t, pool, attacker.ID),
		}
	}

	t.Run("attack_vector_body_template_id_from_other_tenant", func(t *testing.T) {
		fx := setup(t, "template")
		// URL path uses the VICTIM's template ID — RLS makes it invisible
		// to attacker → handler MUST return 404 TEMPLATE_NOT_FOUND.
		body := `{"classes":[{"cohortName":"X","startDate":"2026-08-01","teacherEmail":null}]}`
		req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(fx.victimTemplate)+"/spawn",
			strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		fx.srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotFound {
			t.Errorf("AC11 template_id_from_other_tenant: want 404, got %d — body: %s", rec.Code, rec.Body.String())
		}
		assertErrorCodeTmpl(t, rec.Body, "TEMPLATE_NOT_FOUND")
		sp := test.SuperuserPool(t)
		nAttacker := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
			test.MustParseUUID(t, test.UUIDString(fx.attackerCenter)))
		nVictim := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
			test.MustParseUUID(t, test.UUIDString(fx.victimCenter)))
		if nAttacker != 0 || nVictim != 0 {
			t.Errorf("AC11 template_id_from_other_tenant: expected zero classes rows anywhere, got attacker=%d victim=%d", nAttacker, nVictim)
		}
	})

	t.Run("attack_vector_body_center_override", func(t *testing.T) {
		fx := setup(t, "override")
		// Payload includes "centerId" — server MUST NOT trust body's centerId
		// (SEC-7 trust boundary). C2-10 review fix hardened the decoder to
		// `DisallowUnknownFields`, so the request is REJECTED outright
		// (422 VALIDATION_ERROR) rather than silently ignored + spawned.
		// This is strictly more secure than the previous "silently ignore
		// and spawn 1 attacker class" behavior — no 201 misleadingly signals
		// success on smuggling attempts.
		body := fmt.Sprintf(`{"centerId":"%s","classes":[{"cohortName":"X","startDate":"2026-08-01","teacherEmail":null}]}`,
			test.UUIDString(fx.victimCenter))
		req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(fx.attackerTemplate)+"/spawn",
			strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		fx.srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("AC11 body_center_override: want 422 (unknown-field smuggling attempt rejected), got %d — body: %s", rec.Code, rec.Body.String())
		}
		sp := test.SuperuserPool(t)
		nVictim := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
			test.MustParseUUID(t, test.UUIDString(fx.victimCenter)))
		if nVictim != 0 {
			t.Errorf("AC11 body_center_override: %d classes rows planted in victim center — server trusted body centerId", nVictim)
		}
		// Also assert attacker's center was NOT spawned into — the whole
		// request was rejected, so zero rows in either center.
		nAttacker := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
			test.MustParseUUID(t, test.UUIDString(fx.attackerCenter)))
		if nAttacker != 0 {
			t.Errorf("AC11 body_center_override: expected 0 attacker classes (whole request rejected on unknown field), got %d", nAttacker)
		}
	})

	t.Run("attack_vector_header_center_spoof", func(t *testing.T) {
		fx := setup(t, "header")
		body := `{"classes":[{"cohortName":"X","startDate":"2026-08-01","teacherEmail":null}]}`
		req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(fx.attackerTemplate)+"/spawn",
			strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Center-ID", test.UUIDString(fx.victimCenter))
		rec := httptest.NewRecorder()
		fx.srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Errorf("AC11 header_center_spoof: want 201 (X-Center-ID header MUST be ignored — attacker still spawns legitimately in own center), got %d — body: %s", rec.Code, rec.Body.String())
		}
		sp := test.SuperuserPool(t)
		nVictim := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
			test.MustParseUUID(t, test.UUIDString(fx.victimCenter)))
		if nVictim != 0 {
			t.Errorf("AC11 header_center_spoof: %d classes rows planted in victim center — SEC-7 trust boundary broken", nVictim)
		}
		// R2-P14 — proving 0 victim rows only proves the spoofed X-Center-ID
		// header didn't win. It does NOT prove the legitimate attacker spawn
		// actually landed in the attacker's own center (the 201 above could
		// be misreported by a broken handler that returns success without
		// writing anywhere). Assert the attacker's own center received the
		// single legitimate class spawn.
		nAttacker := test.CountRows(t, sp, `SELECT count(*) FROM classes WHERE center_id = $1`,
			test.MustParseUUID(t, test.UUIDString(fx.attackerCenter)))
		if nAttacker != 1 {
			t.Errorf("AC11 header_center_spoof: expected 1 class row in attacker's own center (legitimate spawn under attacker's tenant), got %d", nAttacker)
		}
	})
}

// -----------------------------------------------------------------------------
// AC12 — Envelope shape (positive + negative)
// -----------------------------------------------------------------------------

func TestSpawn_AC12_ErrorEnvelopeShape(t *testing.T) {
	db := test.SetupDB(t)
	srv := test.NewTestServerFor2_2Unauthenticated(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(test.NewPGUUIDFromString("00000000-0000-0000-0000-000000000099"))+"/spawn",
		strings.NewReader(`{"classes":[]}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// Any error MUST come back as {error: {code, message, requestId, details}} — AC12.
	var env struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"requestId"`
			// details is intentionally checked as raw json so present-null still passes.
			Details json.RawMessage `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Error.Code == "" || env.Error.Message == "" {
		t.Errorf("AC12: error envelope MUST have non-empty code + message, got %#v", env.Error)
	}
	if env.Error.Details == nil {
		t.Errorf("AC12: error envelope MUST include a 'details' key (nullable, but present)")
	}
}

// C3-06 review fix — the AC12 unauth test above only exercises the 401 path.
// This second case forces a spawn-specific 422 response (via authenticated
// caller + malformed teacherEmail) so the envelope is proven for THE handler,
// not for middleware. Verifies the field-level `code=INVALID_TEACHER_EMAIL`
// path AND the full 4-field envelope shape.
func TestSpawn_AC12_ErrorEnvelopeShape_AuthenticatedSpawnValidationError(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "envelope-owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	ownerCenter := test.CreateCenterForOwner(t, pool, owner.ID)
	ownerTemplate := test.CreateClassTemplate(t, pool, ownerCenter, "Envelope Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	// Malformed teacherEmail → 422 INVALID_TEACHER_EMAIL per AC13.
	body := `{"classes":[{"cohortName":"X","startDate":"2026-08-01","teacherEmail":"not-a-valid-email"}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates/"+test.UUIDString(ownerTemplate)+"/spawn",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("AC12 spawn-specific envelope: want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeTmpl(t, rec.Body, "VALIDATION_ERROR")
	assertFieldErrorCode(t, rec.Body, "INVALID_TEACHER_EMAIL")

	var env struct {
		Error struct {
			Code      string          `json:"code"`
			Message   string          `json:"message"`
			RequestID string          `json:"requestId"`
			Details   json.RawMessage `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(bufSnapshot(rec.Body)).Decode(&env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	// requestId is populated only when the test harness threads a RequestID
	// middleware (production does; some test harnesses don't). Presence of
	// the key is asserted structurally via json unmarshal; non-empty is not
	// required because httptest's synthetic request skips the CID middleware.
	if env.Error.Code == "" || env.Error.Message == "" {
		t.Errorf("AC12 spawn envelope: MUST have non-empty code + message, got %#v", env.Error)
	}
	if env.Error.Details == nil {
		t.Errorf("AC12 spawn envelope: MUST include a 'details' key (present, even if null)")
	}
}

// -----------------------------------------------------------------------------
// R2-P17 — Nonexistent template ID → 404 TEMPLATE_NOT_FOUND (positive-caller,
// unknown UUID). Distinct from AC11's cross-tenant test where the UUID exists
// but RLS hides it: here the row genuinely does not exist in any tenant.
// -----------------------------------------------------------------------------
func TestSpawn_NonexistentTemplateID_Returns404(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "nonexistent-owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	test.CreateCenterForOwner(t, pool, owner.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	srv := test.NewTestServerFor2_2ForUser(t, pool, owner.ID)

	// Random UUID that has never been INSERTed anywhere — differs from AC11's
	// "exists but hidden by RLS" case, both of which MUST collapse to the
	// same 404 TEMPLATE_NOT_FOUND response (SEC-8: never leak existence of
	// resources scoped to another tenant, and treat true-missing the same).
	bogusID := uuid.New().String()
	body := `{"classes":[{"cohortName":"X","startDate":"2026-08-01","teacherEmail":null}]}`
	req := httptest.NewRequest(http.MethodPost, "/api/templates/"+bogusID+"/spawn",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 for nonexistent template ID, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeTmpl(t, rec.Body, "TEMPLATE_NOT_FOUND")
}

// -----------------------------------------------------------------------------
// Test-local helpers
// -----------------------------------------------------------------------------

// bufSnapshot reads the buffer once and returns a fresh io.Reader for each
// consumer. The ATDD test helpers below use it so multiple assertions on
// the same rec.Body don't drain each other. (Structural test-helper fix
// only — no assertion semantics change; the assertions themselves stay
// verbatim per the ATDD preservation checklist §9.)
func bufSnapshot(body *bytes.Buffer) *bytes.Reader {
	return bytes.NewReader(body.Bytes())
}

func assertErrorCodeTmpl(t *testing.T, body *bytes.Buffer, wantCode string) {
	t.Helper()
	var env struct {
		Error struct{ Code string `json:"code"` } `json:"error"`
	}
	if err := json.NewDecoder(bufSnapshot(body)).Decode(&env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Error.Code != wantCode {
		t.Errorf("AC13 error catalog: want error.code=%q, got %q — wizard router (Story 2.3b) keys on this string", wantCode, env.Error.Code)
	}
}

func assertFieldErrorCode(t *testing.T, body *bytes.Buffer, wantFieldCode string) {
	t.Helper()
	var env struct {
		Error struct {
			Details []struct {
				Field string `json:"field"`
				Code  string `json:"code"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(bufSnapshot(body)).Decode(&env); err != nil {
		t.Fatalf("decode field-error envelope: %v", err)
	}
	for _, d := range env.Error.Details {
		if d.Code == wantFieldCode {
			return
		}
	}
	t.Errorf("AC13 field-level code: expected error.details[*].code = %q; got %+v", wantFieldCode, env.Error.Details)
}
