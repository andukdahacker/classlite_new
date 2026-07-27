// Story 4.1 — ExerciseHandler integration tests (TEST-BE-3: real middleware,
// real service, real DB via the committed raw pool). Covers AC1–AC8:
//   - owner/admin/teacher create → 201 + EX-code + schemaVersion=1 + shell
//   - role scope: owner/admin see all; teacher sees own only; cross-teacher
//     get/update/delete/duplicate → 404; student → 403; forged owner JWT → 403
//   - pagination boundary (page/pageSize validation + clamp + filtered total)
//   - schemaVersion smuggle rejected; code immutable
//   - tag filter semantics; duplicate deep-copy; soft-delete
//   - optimistic-concurrency precondition (428 / 409 / 200)
//   - golden envelope pinning meta.pagination field names
//   - EX-code concurrency (N goroutines → N distinct codes)
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type exerciseListEnvelope struct {
	Data []map[string]any `json:"data"`
	Meta struct {
		ServerTime string `json:"serverTime"`
		Pagination struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			Total      int `json:"total"`
			TotalPages int `json:"totalPages"`
		} `json:"pagination"`
		SkillCounts []struct {
			Skill string `json:"skill"`
			Count int    `json:"count"`
		} `json:"skillCounts"`
	} `json:"meta"`
}

func decodeExerciseList(t *testing.T, rec *httptest.ResponseRecorder) exerciseListEnvelope {
	t.Helper()
	var out exerciseListEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode exercise list envelope: %v (body: %s)", err, rec.Body.String())
	}
	return out
}

type exerciseTestEnv struct {
	srv         http.Handler
	centerID    string
	teacherAID  pgtype.UUID
	teacherBID  pgtype.UUID
	ownerTok    string
	adminTok    string
	teacherATok string
	teacherBTok string
	studentTok  string
}

func setupExerciseHandlerTest(t *testing.T) exerciseTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	admin := test.CreateUserOnPool(t, pool, "admin-"+sfx+"@example.com", "Admin")
	teacherA := test.CreateUserOnPool(t, pool, "ta-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "tb-"+sfx+"@example.com", "Teacher B")
	student := test.CreateUserOnPool(t, pool, "s1-"+sfx+"@example.com", "Student")
	for _, u := range []test.User{owner, admin, teacherA, teacherB, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, admin.ID, "admin")
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type = 'exercise'`)
		_, _ = sp.Exec(ctx, `DELETE FROM exercises WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM exercise_code_counters WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, admin, teacherA, teacherB, student} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})

	return exerciseTestEnv{
		srv:         test.NewExerciseTestServerBareMux(t, pool),
		centerID:    centerID,
		teacherAID:  teacherA.ID,
		teacherBID:  teacherB.ID,
		ownerTok:    test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		adminTok:    test.SignAccessTokenForRole(t, admin.ID, centerID, "admin"),
		teacherATok: test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok: test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:  test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
}

func createExerciseBody(title, skill string, tags []string) map[string]any {
	body := map[string]any{"title": title, "skill": skill}
	if tags != nil {
		body["tags"] = tags
	}
	return body
}

// createExercise POSTs and returns the decoded {data} envelope on 201.
func createExercise(t *testing.T, env exerciseTestEnv, tok, title, skill string, tags []string) classEnvelope {
	t.Helper()
	rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", tok, createExerciseBody(title, skill, tags))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create exercise → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	return decodeClassEnvelope(t, rec)
}

// getExercise GETs the detail envelope (with content) on 200.
func getExercise(t *testing.T, env exerciseTestEnv, tok, id string) classEnvelope {
	t.Helper()
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises/"+id, tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get exercise → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	return decodeClassEnvelope(t, rec)
}

// populatedContent is a valid v1 content body with one section + a two-question
// group, so section/question counts and deep-copy independence are observable.
func populatedContent() map[string]any {
	return map[string]any{
		"sections": []map[string]any{{
			"type":    "reading",
			"title":   "Passage 1",
			"content": "The quick brown fox.",
			"questionGroups": []map[string]any{{
				"type":         "multiple_choice",
				"instructions": "Choose the best answer.",
				"questions": []map[string]any{
					{"text": "Q1", "type": "multiple_choice", "options": []string{"a", "b"}, "correctAnswer": "a", "acceptedVariants": []string{}},
					{"text": "Q2", "type": "multiple_choice", "options": []string{"a", "b"}, "correctAnswer": "b", "acceptedVariants": []string{}},
				},
			}},
		}},
		"settings": map[string]any{"timeLimitEnabled": true, "timeLimitMinutes": 30, "caseSensitive": false},
	}
}

// =============================================================================
// AC3 — create: EX-code, schemaVersion=1, content shell, owned by creator
// =============================================================================
func TestExercise_Create_TeacherOwnsWithCodeAndShell_201(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	got := createExercise(t, env, env.teacherATok, "Reading P1", "reading", []string{"ielts"})

	if code, _ := got.Data["code"].(string); code != "EX-R001" {
		t.Errorf("code = %v, want EX-R001", got.Data["code"])
	}
	if v, _ := got.Data["schemaVersion"].(float64); v != 1 {
		t.Errorf("schemaVersion = %v, want 1 (server-set)", got.Data["schemaVersion"])
	}
	if got.Data["createdBy"] != test.UUIDString(env.teacherAID) {
		t.Errorf("createdBy = %v, want the teacher", got.Data["createdBy"])
	}
	if sc, _ := got.Data["sectionCount"].(float64); sc != 0 {
		t.Errorf("sectionCount = %v, want 0 (fresh shell)", got.Data["sectionCount"])
	}
	content, ok := got.Data["content"].(map[string]any)
	if !ok {
		t.Fatalf("content is not an object: %v", got.Data["content"])
	}
	if sections, ok := content["sections"].([]any); !ok || len(sections) != 0 {
		t.Errorf("content.sections = %v, want empty array", content["sections"])
	}
	if _, ok := content["settings"].(map[string]any); !ok {
		t.Errorf("content.settings missing — v1 shell must materialize default settings")
	}
}

// Per-skill EX-code letters + monotonic sequence.
func TestExercise_Create_CodeLettersAndSequence(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	cases := []struct{ skill, wantPrefix string }{
		{"writing", "EX-W001"},
		{"listening", "EX-L001"},
		{"speaking", "EX-S001"},
		{"grammar", "EX-G001"},
		{"vocabulary", "EX-V001"},
		{"general", "EX-X001"},
	}
	for _, c := range cases {
		got := createExercise(t, env, env.ownerTok, "T", c.skill, nil)
		if got.Data["code"] != c.wantPrefix {
			t.Errorf("skill %s → code %v, want %s", c.skill, got.Data["code"], c.wantPrefix)
		}
	}
	// Second writing exercise increments the sequence.
	got := createExercise(t, env, env.ownerTok, "T2", "writing", nil)
	if got.Data["code"] != "EX-W002" {
		t.Errorf("second writing code = %v, want EX-W002", got.Data["code"])
	}
}

// AC3 — title required, skill from the fixed enum.
func TestExercise_Create_Validation_422(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
		map[string]any{"title": "", "skill": "reading"})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty title → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	rec = classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
		map[string]any{"title": "T", "skill": "telepathy"})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("unknown skill → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
}

// AC4 — schemaVersion is un-settable: a body carrying it is rejected (strict
// decode), so the column can never be smuggled to a client value.
func TestExercise_Create_SchemaVersionSmuggle_Rejected(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
		map[string]any{"title": "T", "skill": "reading", "schemaVersion": 99})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("smuggled schemaVersion → %d, want 422 (unknown field rejected) (body: %s)", rec.Code, rec.Body.String())
	}
}

// AC4/CR-4-1-10 — targetBand must be a 0.5-step multiple in [0,9]; a sub-0.1
// value would silently round against the numeric(2,1) column and then never
// match its own band filter, so it is rejected 422.
func TestExercise_Create_TargetBandStep_422(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	for _, band := range []float64{6.25, 6.1, -0.5, 9.5} {
		rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
			map[string]any{"title": "T", "skill": "reading", "targetBand": band})
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("targetBand=%v → %d, want 422 (body: %s)", band, rec.Code, rec.Body.String())
		}
	}
	// A valid 0.5-step band is accepted.
	rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
		map[string]any{"title": "T", "skill": "reading", "targetBand": 6.5})
	if rec.Code != http.StatusCreated {
		t.Fatalf("targetBand=6.5 → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
}

// AC4/CR-4-1-9 — an explicit JSON null clears a previously-set nullable field
// (description/targetBand); an absent key leaves it unchanged.
func TestExercise_Update_NullClearsNullableFields(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	created := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
		map[string]any{"title": "T", "skill": "reading", "description": "a description", "targetBand": 6.5})
	if created.Code != http.StatusCreated {
		t.Fatalf("create → %d, want 201 (body: %s)", created.Code, created.Body.String())
	}
	x := decodeClassEnvelope(t, created)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)
	if x.Data["description"] == nil || x.Data["targetBand"] == nil {
		t.Fatalf("precondition: created row should have description + targetBand set (got %v / %v)", x.Data["description"], x.Data["targetBand"])
	}

	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"description": nil, "targetBand": nil, "updatedAt": updatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("null-clear PATCH → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["description"] != nil {
		t.Errorf("description after null-clear = %v, want null", got.Data["description"])
	}
	if got.Data["targetBand"] != nil {
		t.Errorf("targetBand after null-clear = %v, want null", got.Data["targetBand"])
	}
	// Persisted, and an absent key on a follow-up PATCH leaves it null.
	reread := getExercise(t, env, env.ownerTok, id)
	if reread.Data["description"] != nil || reread.Data["targetBand"] != nil {
		t.Errorf("re-read after null-clear = %v / %v, want null / null", reread.Data["description"], reread.Data["targetBand"])
	}
}

// AC8 — student caller → 403 INSUFFICIENT_ROLE.
func TestExercise_Create_StudentForbidden_403(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.studentTok,
		createExerciseBody("T", "reading", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("student create → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

// unauthenticated → 401
func TestExercise_List_Unauthenticated_401(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token → %d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// AC8 — role scope: owner sees all; teacher sees own only
// =============================================================================
func TestExercise_List_RoleScope(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	createExercise(t, env, env.teacherATok, "A1", "reading", nil)
	createExercise(t, env, env.teacherBTok, "B1", "writing", nil)

	// owner sees both.
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner list → %d (body: %s)", rec.Code, rec.Body.String())
	}
	if list := decodeExerciseList(t, rec); list.Meta.Pagination.Total != 2 {
		t.Errorf("owner total = %d, want 2 (sees all)", list.Meta.Pagination.Total)
	}

	// teacher A sees only their own.
	rec = classReq(t, env.srv, http.MethodGet, "/api/exercises", env.teacherATok, nil)
	list := decodeExerciseList(t, rec)
	if list.Meta.Pagination.Total != 1 {
		t.Fatalf("teacher A total = %d, want 1 (own only)", list.Meta.Pagination.Total)
	}
	if list.Data[0]["title"] != "A1" {
		t.Errorf("teacher A sees %v, want A1", list.Data[0]["title"])
	}
}

// AC8 — cross-teacher GET → 404 (same 404 as not-found, no enumeration oracle).
func TestExercise_Get_CrossTeacher_404(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	a := createExercise(t, env, env.teacherATok, "A1", "reading", nil)
	id, _ := a.Data["id"].(string)

	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises/"+id, env.teacherBTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-teacher get → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "EXERCISE_NOT_FOUND" {
		t.Errorf("error code = %q, want EXERCISE_NOT_FOUND", code)
	}
}

// SEC-1 — a forged owner-role JWT for a DB teacher is still teacher-scoped: the
// teacher can create (owner/admin/teacher all may), but the middleware
// re-validates the role from center_members, so the forged token behaves as the
// DB role. Here we prove a DB-teacher with an owner token does NOT see another
// teacher's exercises (role read from DB, not JWT).
func TestExercise_List_ForgedOwnerJWTForTeacher_ScopedToDBRole(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	createExercise(t, env, env.teacherATok, "A1", "reading", nil)
	createExercise(t, env, env.teacherBTok, "B1", "writing", nil)

	forgedOwnerTok := test.SignAccessTokenForRole(t, env.teacherBID, env.centerID, "owner")
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises", forgedOwnerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("forged-owner list → %d (body: %s)", rec.Code, rec.Body.String())
	}
	list := decodeExerciseList(t, rec)
	if list.Meta.Pagination.Total != 1 {
		t.Errorf("forged-owner-for-DB-teacher total = %d, want 1 (scoped to the DB teacher role, not the JWT claim)", list.Meta.Pagination.Total)
	}
}

// =============================================================================
// AC2 — pagination boundary + filtered total + golden meta shape
// =============================================================================
func TestExercise_List_PaginationBoundary(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	for i := 0; i < 3; i++ {
		createExercise(t, env, env.ownerTok, "R", "reading", nil)
	}

	// page 1, size 2 → 2 items, total 3, totalPages 2.
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises?page=1&pageSize=2", env.ownerTok, nil)
	list := decodeExerciseList(t, rec)
	if len(list.Data) != 2 || list.Meta.Pagination.Total != 3 || list.Meta.Pagination.TotalPages != 2 {
		t.Errorf("page1 size2: items=%d total=%d totalPages=%d, want 2/3/2", len(list.Data), list.Meta.Pagination.Total, list.Meta.Pagination.TotalPages)
	}
	// page 2 → 1 item.
	rec = classReq(t, env.srv, http.MethodGet, "/api/exercises?page=2&pageSize=2", env.ownerTok, nil)
	if list := decodeExerciseList(t, rec); len(list.Data) != 1 {
		t.Errorf("page2 size2 items = %d, want 1", len(list.Data))
	}
	// page beyond last → empty data, correct total (not an error).
	rec = classReq(t, env.srv, http.MethodGet, "/api/exercises?page=3&pageSize=2", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("page beyond last → %d, want 200", rec.Code)
	}
	if list := decodeExerciseList(t, rec); len(list.Data) != 0 || list.Meta.Pagination.Total != 3 {
		t.Errorf("page3: items=%d total=%d, want 0/3", len(list.Data), list.Meta.Pagination.Total)
	}
}

func TestExercise_List_PaginationValidation_422(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	// Includes the CR-4-1-2 page upper bound (overflow guard) and the CR-4-1-3
	// band range/finite guard — each must be a clean 422, never a 500.
	for _, qs := range []string{
		"?page=0", "?page=-1", "?page=abc", "?page=999999999",
		"?pageSize=0", "?pageSize=-5", "?pageSize=xyz",
		"?band=notnum", "?band=-3", "?band=99", "?band=NaN", "?band=Inf",
	} {
		rec := classReq(t, env.srv, http.MethodGet, "/api/exercises"+qs, env.ownerTok, nil)
		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("list%s → %d, want 422 (body: %s)", qs, rec.Code, rec.Body.String())
		}
	}
}

func TestExercise_List_PageSizeClampedNotRejected(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	createExercise(t, env, env.ownerTok, "R", "reading", nil)
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises?pageSize=500", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("pageSize=500 → %d, want 200 (clamped)", rec.Code)
	}
	if list := decodeExerciseList(t, rec); list.Meta.Pagination.PageSize != 100 {
		t.Errorf("clamped pageSize = %d, want 100", list.Meta.Pagination.PageSize)
	}
}

// Golden envelope — pin the exact meta.pagination field names + casing (the
// MSW-drift gate, since Pact is unused — Murat).
func TestExercise_List_GoldenPaginationMetaShape(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	createExercise(t, env, env.ownerTok, "R", "reading", nil)
	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises", env.ownerTok, nil)

	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	var meta map[string]json.RawMessage
	if err := json.Unmarshal(raw["meta"], &meta); err != nil {
		t.Fatalf("decode meta: %v", err)
	}
	for _, key := range []string{"serverTime", "pagination", "skillCounts"} {
		if _, ok := meta[key]; !ok {
			t.Errorf("meta missing key %q", key)
		}
	}
	var pg map[string]json.RawMessage
	if err := json.Unmarshal(meta["pagination"], &pg); err != nil {
		t.Fatalf("decode pagination: %v", err)
	}
	for _, key := range []string{"page", "pageSize", "total", "totalPages"} {
		if _, ok := pg[key]; !ok {
			t.Errorf("meta.pagination missing key %q (casing must be exact)", key)
		}
	}
}

// AC2 — tag filter: single-tag membership; unknown tag → empty set (not all).
func TestExercise_List_TagFilter(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	createExercise(t, env, env.ownerTok, "Tagged", "reading", []string{"ielts", "p1"})
	createExercise(t, env, env.ownerTok, "Untagged", "reading", nil)

	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises?tag=ielts", env.ownerTok, nil)
	list := decodeExerciseList(t, rec)
	if list.Meta.Pagination.Total != 1 || list.Data[0]["title"] != "Tagged" {
		t.Errorf("tag=ielts total=%d first=%v, want 1/Tagged", list.Meta.Pagination.Total, firstTitle(list))
	}

	rec = classReq(t, env.srv, http.MethodGet, "/api/exercises?tag=nonexistent", env.ownerTok, nil)
	if list := decodeExerciseList(t, rec); list.Meta.Pagination.Total != 0 {
		t.Errorf("unknown tag total = %d, want 0 (not all rows)", list.Meta.Pagination.Total)
	}
}

func firstTitle(list exerciseListEnvelope) any {
	if len(list.Data) == 0 {
		return nil
	}
	return list.Data[0]["title"]
}

// AC2 — skill filter narrows; skillCounts reflects the (unfiltered-by-skill) strip.
func TestExercise_List_SkillFilterAndCounts(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	createExercise(t, env, env.ownerTok, "R1", "reading", nil)
	createExercise(t, env, env.ownerTok, "R2", "reading", nil)
	createExercise(t, env, env.ownerTok, "W1", "writing", nil)

	rec := classReq(t, env.srv, http.MethodGet, "/api/exercises?skill=reading", env.ownerTok, nil)
	list := decodeExerciseList(t, rec)
	if list.Meta.Pagination.Total != 2 {
		t.Errorf("skill=reading total = %d, want 2", list.Meta.Pagination.Total)
	}
	// skillCounts still spans all skills (the tabs are the switcher).
	counts := map[string]int{}
	for _, sc := range list.Meta.SkillCounts {
		counts[sc.Skill] = sc.Count
	}
	if counts["reading"] != 2 || counts["writing"] != 1 {
		t.Errorf("skillCounts = %v, want reading:2 writing:1", counts)
	}
}

// =============================================================================
// AC5 — duplicate: "(copy)" title, fresh code, DEEP content copy, own row
// =============================================================================
func TestExercise_Duplicate_DeepCopyFreshCode(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	// Source authored by teacher A with populated content, so we can prove the
	// clone carries a DEEP copy and a fresh created_by (the duplicator ≠ author).
	src := createExercise(t, env, env.teacherATok, "Original", "reading", []string{"ielts"})
	srcID, _ := src.Data["id"].(string)
	srcCreatedAt, _ := src.Data["updatedAt"].(string)

	populated := populatedContent()
	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+srcID, env.teacherATok,
		map[string]any{"content": populated, "updatedAt": srcCreatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("populate source content → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	srcAfter := decodeClassEnvelope(t, rec)
	srcContent := srcAfter.Data["content"]
	srcCreatedBy, _ := src.Data["createdBy"].(string)
	if got, _ := srcAfter.Data["questionCount"].(float64); got != 2 {
		t.Fatalf("source questionCount = %v, want 2 (content did not persist)", srcAfter.Data["questionCount"])
	}

	// Duplicate as OWNER (owner sees all center exercises; duplicator ≠ author).
	rec = classReq(t, env.srv, http.MethodPost, "/api/exercises/"+srcID+"/duplicate", env.ownerTok, nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("duplicate → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	dup := decodeClassEnvelope(t, rec)
	dupID, _ := dup.Data["id"].(string)

	if dup.Data["title"] != "Original (copy)" {
		t.Errorf("dup title = %v, want 'Original (copy)'", dup.Data["title"])
	}
	if dup.Data["code"] == src.Data["code"] {
		t.Errorf("dup code = %v, must differ from source %v", dup.Data["code"], src.Data["code"])
	}
	if dupID == srcID {
		t.Error("dup id must differ from source")
	}
	// Fresh created_by = the duplicator (owner), NOT copied from the author.
	if dupCreatedBy, _ := dup.Data["createdBy"].(string); dupCreatedBy == srcCreatedBy {
		t.Errorf("dup createdBy = %v, must be the duplicator (owner), not the author %v", dupCreatedBy, srcCreatedBy)
	}
	// The clone carries a DEEP copy of the content (structurally equal).
	if !reflect.DeepEqual(dup.Data["content"], srcContent) {
		t.Errorf("dup content is not a deep copy of the source\n dup: %v\n src: %v", dup.Data["content"], srcContent)
	}
	if got, _ := dup.Data["questionCount"].(float64); got != 2 {
		t.Errorf("dup questionCount = %v, want 2 (content copied)", dup.Data["questionCount"])
	}

	// MUTATION INDEPENDENCE: overwrite the clone's content, then re-read the
	// source and assert it is untouched (separate rows, separate content bytes).
	dupUpdatedAt, _ := dup.Data["updatedAt"].(string)
	rec = classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+dupID, env.ownerTok,
		map[string]any{"content": map[string]any{"sections": []any{}, "settings": populated["settings"]}, "updatedAt": dupUpdatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("mutate clone → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	srcReread := getExercise(t, env, env.teacherATok, srcID)
	if !reflect.DeepEqual(srcReread.Data["content"], srcContent) {
		t.Errorf("source content changed after mutating the clone — NOT a deep copy\n got:  %v\n want: %v", srcReread.Data["content"], srcContent)
	}
	if got, _ := srcReread.Data["questionCount"].(float64); got != 2 {
		t.Errorf("source questionCount after clone mutation = %v, want 2 (unchanged)", srcReread.Data["questionCount"])
	}
}

// AC5 — cross-teacher duplicate-by-id → 404 (read-then-clone cannot cross the boundary).
func TestExercise_Duplicate_CrossTeacher_404(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	a := createExercise(t, env, env.teacherATok, "A1", "reading", nil)
	id, _ := a.Data["id"].(string)
	rec := classReq(t, env.srv, http.MethodPost, "/api/exercises/"+id+"/duplicate", env.teacherBTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-teacher duplicate → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// AC5 — soft-delete: 204, then invisible (get → 404, absent from list)
// =============================================================================
func TestExercise_SoftDelete_ThenInvisible(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "ToDelete", "reading", nil)
	id, _ := x.Data["id"].(string)

	rec := classReq(t, env.srv, http.MethodDelete, "/api/exercises/"+id, env.ownerTok, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete → %d, want 204 (body: %s)", rec.Code, rec.Body.String())
	}
	// get → 404
	rec = classReq(t, env.srv, http.MethodGet, "/api/exercises/"+id, env.ownerTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("get after soft-delete → %d, want 404", rec.Code)
	}
	// double delete → 404
	rec = classReq(t, env.srv, http.MethodDelete, "/api/exercises/"+id, env.ownerTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("double delete → %d, want 404", rec.Code)
	}
	// absent from list
	rec = classReq(t, env.srv, http.MethodGet, "/api/exercises", env.ownerTok, nil)
	if list := decodeExerciseList(t, rec); list.Meta.Pagination.Total != 0 {
		t.Errorf("list total after soft-delete = %d, want 0", list.Meta.Pagination.Total)
	}
}

// =============================================================================
// AC4 — optimistic-concurrency precondition: 428 (missing) / 409 (stale) / 200
// =============================================================================
func TestExercise_Update_PreconditionRequired_428(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)

	// No If-Match, no body updatedAt → 428.
	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"title": "T2"})
	if rec.Code != http.StatusPreconditionRequired {
		t.Fatalf("update w/o precondition → %d, want 428 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "PRECONDITION_REQUIRED" {
		t.Errorf("error code = %q, want PRECONDITION_REQUIRED", code)
	}
}

func TestExercise_Update_StalePrecondition_409(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)

	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"title": "T2", "updatedAt": "2000-01-01T00:00:00Z"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale precondition → %d, want 409 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "CONFLICT" {
		t.Errorf("error code = %q, want CONFLICT", code)
	}
}

func TestExercise_Update_FreshPrecondition_200_KeepsSchemaVersionAndCode(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)
	origCode, _ := x.Data["code"].(string)

	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"title": "Renamed", "updatedAt": updatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("fresh precondition → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["title"] != "Renamed" {
		t.Errorf("title = %v, want Renamed", got.Data["title"])
	}
	if v, _ := got.Data["schemaVersion"].(float64); v != 1 {
		t.Errorf("schemaVersion = %v, want 1 (immutable)", got.Data["schemaVersion"])
	}
	if got.Data["code"] != origCode {
		t.Errorf("code = %v, want unchanged %v (immutable)", got.Data["code"], origCode)
	}
}

// AC4 — the If-Match header is honored as the precondition channel: a valid
// header drives the update (effect asserted + persisted), and a STALE header
// (with NO body updatedAt) still 409s — proving the header value, not a body
// field, is the precondition source.
func TestExercise_Update_IfMatchHeader_200(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)

	patch := func(ifMatch string, body map[string]any) *httptest.ResponseRecorder {
		raw, _ := json.Marshal(body)
		req := httptest.NewRequest(http.MethodPatch, "/api/exercises/"+id, bytes.NewReader(raw))
		req.Header.Set("Authorization", "Bearer "+env.ownerTok)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("If-Match", ifMatch)
		rec := httptest.NewRecorder()
		env.srv.ServeHTTP(rec, req)
		return rec
	}

	// Valid header, body carries NO updatedAt → the header is the only
	// precondition channel available; expect 200 AND the title actually changes.
	rec := patch(updatedAt, map[string]any{"title": "ViaHeader"})
	if rec.Code != http.StatusOK {
		t.Fatalf("If-Match update → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := decodeClassEnvelope(t, rec); got.Data["title"] != "ViaHeader" {
		t.Fatalf("title = %v, want 'ViaHeader' (header precondition did not drive the write)", got.Data["title"])
	}
	// Persisted (re-read confirms it wasn't a phantom 200).
	if reread := getExercise(t, env, env.ownerTok, id); reread.Data["title"] != "ViaHeader" {
		t.Errorf("re-read title = %v, want 'ViaHeader'", reread.Data["title"])
	}

	// Stale header, no body updatedAt → 409. If the header were ignored, this
	// would fall through to the 428 (missing precondition) path instead.
	rec = patch("2000-01-01T00:00:00Z", map[string]any{"title": "ShouldNotApply"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("stale If-Match → %d, want 409 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "CONFLICT" {
		t.Errorf("stale If-Match error code = %q, want CONFLICT", code)
	}
}

// AC4 — a content-bearing PATCH (the 4.2 autosave / Duplicate path) replaces the
// blob and re-derives the counts.
func TestExercise_Update_ContentReplace_200(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)
	if got, _ := x.Data["questionCount"].(float64); got != 0 {
		t.Fatalf("fresh exercise questionCount = %v, want 0", x.Data["questionCount"])
	}

	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"content": populatedContent(), "updatedAt": updatedAt})
	if rec.Code != http.StatusOK {
		t.Fatalf("content replace → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if sc, _ := got.Data["sectionCount"].(float64); sc != 1 {
		t.Errorf("sectionCount = %v, want 1", got.Data["sectionCount"])
	}
	if qc, _ := got.Data["questionCount"].(float64); qc != 2 {
		t.Errorf("questionCount = %v, want 2", got.Data["questionCount"])
	}
}

// AC4 — a content blob over the MaxContentBytes cap → 413 (DoS / giant-paste
// guard), not a 200 or a 500.
func TestExercise_Update_ContentTooLarge_413(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	x := createExercise(t, env, env.ownerTok, "T", "reading", nil)
	id, _ := x.Data["id"].(string)
	updatedAt, _ := x.Data["updatedAt"].(string)

	// A section whose passage text alone exceeds the 256 KiB blob cap.
	huge := map[string]any{
		"sections": []map[string]any{{
			"type": "reading", "title": "Big", "content": strings.Repeat("x", 300*1024),
			"questionGroups": []map[string]any{},
		}},
		"settings": map[string]any{"timeLimitEnabled": false, "timeLimitMinutes": 0, "caseSensitive": false},
	}
	rec := classReq(t, env.srv, http.MethodPatch, "/api/exercises/"+id, env.ownerTok,
		map[string]any{"content": huge, "updatedAt": updatedAt})
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized content → %d, want 413 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// EX-code concurrency — N goroutines create same-(center,skill) → N distinct
// codes, zero collisions (guards the counter + UNIQUE index).
// =============================================================================
func TestExercise_Create_ConcurrentCodesDistinct(t *testing.T) {
	env := setupExerciseHandlerTest(t)
	const n = 8
	var wg sync.WaitGroup
	codes := make([]string, n)
	statuses := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := classReq(t, env.srv, http.MethodPost, "/api/exercises", env.ownerTok,
				createExerciseBody("Concurrent", "reading", nil))
			statuses[idx] = rec.Code
			if rec.Code == http.StatusCreated {
				var env2 classEnvelope
				_ = json.Unmarshal(rec.Body.Bytes(), &env2)
				codes[idx], _ = env2.Data["code"].(string)
			}
		}(i)
	}
	wg.Wait()

	seen := map[string]bool{}
	for i := 0; i < n; i++ {
		if statuses[i] != http.StatusCreated {
			t.Fatalf("goroutine %d → %d, want 201", i, statuses[i])
		}
		if codes[i] == "" {
			t.Fatalf("goroutine %d produced an empty code", i)
		}
		if seen[codes[i]] {
			t.Errorf("CODE COLLISION: %s produced twice", codes[i])
		}
		seen[codes[i]] = true
	}
	if len(seen) != n {
		t.Errorf("distinct codes = %d, want %d", len(seen), n)
	}
}
