// Story 3.4 — ATDD RED-PHASE, Task 0. R19 (DATA, score 6) discharge (part 2):
// the recurring-session "Apply to…" SCOPE matrix + cross-teacher isolation +
// concurrency, driven through the REAL middleware/service (TEST-BE-3) with a
// FROZEN CLOCK so the past/future boundary is deterministic (Murat BLOCKER-4).
//
// RED signal (compile-red, per Ducdo 2026-07-21 "full typed suite now"):
//   undefined: test.NewSessionTestServerBareMux  (+ the SessionService/routes
//   it wires) — the feature does not exist yet. `go test ./internal/handler/...`
//   fails to BUILD until Story 3.4 Tasks 1–5 land. This is intentional and
//   accepted: the test pins the exact R19 oracle the implementation must satisfy.
//
// GREEN mapping:
//   NewSessionTestServerBareMux + routes/service → Tasks 1–5
//   scope WHERE + `starts_at >= clk.Now()` past-immutable floor → Task 2/5 (AC4)
//   optimistic `expectedUpdatedAt` → 409 → Task 2/5 (AC2)
//   recurrence bound (endDate + 200 cap) → Task 5 (AC3)
//   teacher-scope 404 + student 403 → Task 5 (AC2)
//
// SEMANTICS UNDER TEST (post party-mode reversal — mutations are PAST-IMMUTABLE):
//   this   → the single target row (422 SESSION_ALREADY_STARTED if target is past)
//   future → recurrence_group_id = grp AND starts_at >= target.starts_at AND starts_at >= now()
//   all    → recurrence_group_id = grp AND starts_at >= now()   (past EXCLUDED)
//   reads  → always include past (the calendar renders history)
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// frozenNow is the deterministic reference instant for every scope test.
// Series occurrences straddle it: PAST = {08-02, 08-09}, FUTURE = {08-16, 08-23, 08-30}.
var frozenNow = time.Date(2026, 8, 15, 0, 0, 0, 0, time.UTC)

type sessionSeries struct {
	groupID    uuid.UUID
	past       []uuid.UUID // 08-02, 08-09 (before frozenNow)
	future     []uuid.UUID // 08-16, 08-23, 08-30 (after frozenNow)
	updatedAt  map[uuid.UUID]time.Time
}

type sessionTestEnv struct {
	srv         http.Handler
	clk         *clock.MockClock
	centerID    string
	classAID    uuid.UUID // owned by teacher A
	classBID    uuid.UUID // owned by teacher B
	ownerTok    string
	teacherATok string
	teacherBTok string
	studentTok  string
}

// errCodeOf extracts the error envelope code (reuses errEnvelope from
// class_handler_atdd_test.go — same handler_test package).
func errCodeOf(t *testing.T, body []byte) string {
	t.Helper()
	var e errEnvelope
	_ = json.Unmarshal(body, &e)
	return e.Error.Code
}

// setupSessionHandlerTest wires the session server with a FROZEN clock and two
// teacher-owned classes so cross-teacher isolation is testable.
func setupSessionHandlerTest(t *testing.T) sessionTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)

	teacherA := test.CreateUserOnPool(t, pool, "ta-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "tb-"+sfx+"@example.com", "Teacher B")
	student := test.CreateUserOnPool(t, pool, "st-"+sfx+"@example.com", "Student S")
	for _, u := range []test.User{teacherA, teacherB, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	// Two classes, each assigned to a different teacher (teacher-scope boundary).
	taID := test.UUIDString(teacherA.ID)
	tbID := test.UUIDString(teacherB.ID)
	classA := test.SeedClass(t, centerID, "Class A", "active", &taID, nil)
	classB := test.SeedClass(t, centerID, "Class B", "active", &tbID, nil)

	clk := clock.NewMockClock(frozenNow)

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type = 'session'`)
		_, _ = sp.Exec(ctx, `DELETE FROM sessions WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacherA.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacherB.ID)
		test.PurgeUserAndOwnedCenters(t, pool, student.ID)
	})

	return sessionTestEnv{
		// RED symbol: the session test server does not exist until Tasks 1–5.
		// It must accept a clock.Clock so the service's now()-floor is frozen.
		srv:         test.NewSessionTestServerBareMux(t, pool, clk),
		clk:         clk,
		centerID:    centerID,
		classAID:    classA,
		classBID:    classB,
		ownerTok:    test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		teacherATok: test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok: test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:  test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
}

// seedSeries inserts a 5-occurrence weekly series (2 past + 3 future relative to
// frozenNow) for the given class, via the superuser pool. Returns ids + the
// per-row updated_at snapshot (for optimistic-concurrency + negative-space).
func seedSeries(t *testing.T, centerID string, classID uuid.UUID) sessionSeries {
	t.Helper()
	grp := uuid.New()
	dates := []time.Time{
		time.Date(2026, 8, 2, 9, 0, 0, 0, time.UTC),  // past
		time.Date(2026, 8, 9, 9, 0, 0, 0, time.UTC),  // past
		time.Date(2026, 8, 16, 9, 0, 0, 0, time.UTC), // future
		time.Date(2026, 8, 23, 9, 0, 0, 0, time.UTC), // future (the 'future'-scope target N)
		time.Date(2026, 8, 30, 9, 0, 0, 0, time.UTC), // future
	}
	s := sessionSeries{groupID: grp, updatedAt: map[uuid.UUID]time.Time{}}
	sp := test.SuperuserPool(t)
	for _, d := range dates {
		id := uuid.New()
		var ua time.Time
		err := sp.QueryRow(context.Background(),
			`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status, recurrence_group_id, recurrence_pattern)
			 VALUES ($1, $2::uuid, $3, 'Original', $4::timestamptz, $4::timestamptz + interval '90 minutes', 'scheduled', $5, 'weekly')
			 RETURNING updated_at`,
			id, centerID, classID, d, grp,
		).Scan(&ua)
		if err != nil {
			t.Fatalf("seed session %s: %v", d.Format("2006-01-02"), err)
		}
		s.updatedAt[id] = ua
		if d.Before(frozenNow) {
			s.past = append(s.past, id)
		} else {
			s.future = append(s.future, id)
		}
	}
	return s
}

func topicOf(t *testing.T, id uuid.UUID) string {
	t.Helper()
	var topic string
	if err := test.SuperuserPool(t).QueryRow(context.Background(),
		`SELECT topic FROM sessions WHERE id = $1`, id).Scan(&topic); err != nil {
		t.Fatalf("read topic %s: %v", id, err)
	}
	return topic
}

func statusOf(t *testing.T, id uuid.UUID) string {
	t.Helper()
	var st string
	if err := test.SuperuserPool(t).QueryRow(context.Background(),
		`SELECT status FROM sessions WHERE id = $1`, id).Scan(&st); err != nil {
		t.Fatalf("read status %s: %v", id, err)
	}
	return st
}

func existsRow(t *testing.T, id uuid.UUID) bool {
	t.Helper()
	var n int
	if err := test.SuperuserPool(t).QueryRow(context.Background(),
		`SELECT count(*) FROM sessions WHERE id = $1`, id).Scan(&n); err != nil {
		t.Fatalf("exists %s: %v", id, err)
	}
	return n == 1
}

// =============================================================================
// J19-001 — edit scope 'this' → only the target changes; past + other future intact
// =============================================================================
func TestSession_Scope_This_OnlyTargetChanges(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	target := s.future[1] // 08-23

	rec := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+target.String(), env.teacherATok, map[string]any{
		"topic":           "Edited-this",
		"applyScope":      "this",
		"expectedUpdatedAt": s.updatedAt[target].Format(time.RFC3339Nano),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH this → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := topicOf(t, target); got != "Edited-this" {
		t.Errorf("target topic = %q, want Edited-this", got)
	}
	for _, id := range append(append([]uuid.UUID{}, s.past...), s.future[0], s.future[2]) {
		if got := topicOf(t, id); got != "Original" {
			t.Errorf("R19 LEAK: out-of-scope row %s changed to %q under scope 'this'", id, got)
		}
	}
}

// =============================================================================
// J19-002 + J19-005 — edit scope 'future' → target(N) + later change; earlier
// future (N-1) AND past unchanged. The `>=` boundary INCLUDES the clicked N.
// =============================================================================
func TestSession_Scope_Future_TargetAndLaterOnly_BoundaryInclusive(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	target := s.future[1] // N = 08-23; earlier future = future[0] 08-16; later = future[2] 08-30

	rec := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+target.String(), env.teacherATok, map[string]any{
		"topic":           "Edited-future",
		"applyScope":      "future",
		"expectedUpdatedAt": s.updatedAt[target].Format(time.RFC3339Nano),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH future → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	// J19-005: N itself IS in the changed set.
	if got := topicOf(t, target); got != "Edited-future" {
		t.Errorf("J19-005 boundary VIOLATION: clicked occurrence N not included in its own 'future' edit (topic=%q)", got)
	}
	if got := topicOf(t, s.future[2]); got != "Edited-future" {
		t.Errorf("later future 08-30 = %q, want Edited-future", got)
	}
	// earlier future (N-1) must NOT change.
	if got := topicOf(t, s.future[0]); got != "Original" {
		t.Errorf("R19 LEAK: earlier future 08-16 changed to %q under scope 'future'", got)
	}
	// past never changes.
	for _, id := range s.past {
		if got := topicOf(t, id); got != "Original" {
			t.Errorf("PAST-IMMUTABLE VIOLATION: past row %s changed to %q under scope 'future'", id, got)
		}
	}
}

// =============================================================================
// J19-003 (REWRITTEN per fold) — edit scope 'all' → all NON-COMPLETED (future)
// change; PAST occurrences are IMMUTABLE (protects 3.5 attendance).
// =============================================================================
func TestSession_Scope_All_FutureOnly_PastImmutable(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	target := s.future[0]

	rec := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+target.String(), env.teacherATok, map[string]any{
		"topic":           "Edited-all",
		"applyScope":      "all",
		"expectedUpdatedAt": s.updatedAt[target].Format(time.RFC3339Nano),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH all → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	for _, id := range s.future {
		if got := topicOf(t, id); got != "Edited-all" {
			t.Errorf("future row %s = %q, want Edited-all under scope 'all'", id, got)
		}
	}
	for _, id := range s.past {
		if got := topicOf(t, id); got != "Original" {
			t.Errorf("PAST-IMMUTABLE VIOLATION: 'all' scope rewrote past/completed row %s to %q — retroactive history mutation (3.5 attendance rot)", id, got)
		}
	}
}

// =============================================================================
// Past target under any mutating scope → 422 SESSION_ALREADY_STARTED.
// =============================================================================
func TestSession_Edit_PastTarget_Rejected(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	pastTarget := s.past[1] // 08-09, before frozenNow

	rec := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+pastTarget.String(), env.teacherATok, map[string]any{
		"topic":           "cannot",
		"applyScope":      "this",
		"expectedUpdatedAt": s.updatedAt[pastTarget].Format(time.RFC3339Nano),
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("PATCH past target → %d, want 422", rec.Code)
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "SESSION_ALREADY_STARTED" {
		t.Errorf("error code = %q, want SESSION_ALREADY_STARTED", code)
	}
	if got := topicOf(t, pastTarget); got != "Original" {
		t.Errorf("past row mutated despite 422 (topic=%q)", got)
	}
}

// =============================================================================
// Cancel negative-space — cancel 'future' marks future cancelled, leaves past +
// earlier-future 'scheduled'. Cancel KEEPS rows (FR-17).
// =============================================================================
func TestSession_Cancel_Future_NegativeSpace(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	target := s.future[1]

	rec := classReq(t, env.srv, http.MethodPost, "/api/sessions/"+target.String()+"/cancel", env.teacherATok, map[string]any{
		"applyScope":      "future",
		"expectedUpdatedAt": s.updatedAt[target].Format(time.RFC3339Nano),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("cancel future → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if statusOf(t, target) != "cancelled" || statusOf(t, s.future[2]) != "cancelled" {
		t.Error("target + later future should be cancelled")
	}
	if !existsRow(t, target) {
		t.Error("cancel must KEEP the row (FR-17), not delete it")
	}
	if statusOf(t, s.future[0]) != "scheduled" {
		t.Error("R19 LEAK: earlier future cancelled under scope 'future'")
	}
	for _, id := range s.past {
		if statusOf(t, id) != "scheduled" {
			t.Errorf("PAST-IMMUTABLE VIOLATION: past row %s cancelled under scope 'future'", id)
		}
	}
}

// =============================================================================
// Delete negative-space — delete 'all' removes FUTURE rows, KEEPS past.
// =============================================================================
func TestSession_Delete_All_FutureOnly_PastKept(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	target := s.future[0]

	rec := classReq(t, env.srv, http.MethodDelete,
		"/api/sessions/"+target.String()+"?scope=all&expectedUpdatedAt="+s.updatedAt[target].Format(time.RFC3339Nano),
		env.teacherATok, nil)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete all → %d, want 204 (body: %s)", rec.Code, rec.Body.String())
	}
	for _, id := range s.future {
		if existsRow(t, id) {
			t.Errorf("future row %s should be deleted under scope 'all'", id)
		}
	}
	for _, id := range s.past {
		if !existsRow(t, id) {
			t.Errorf("PAST-IMMUTABLE VIOLATION: 'all' delete removed past row %s (3.5 attendance orphan)", id)
		}
	}
}

// =============================================================================
// J19-004 — optimistic concurrency: stale expectedUpdatedAt → 409, series consistent.
// =============================================================================
func TestSession_Concurrent_StaleUpdate_Conflict(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	target := s.future[0]
	stamp := s.updatedAt[target].Format(time.RFC3339Nano)

	first := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+target.String(), env.teacherATok, map[string]any{
		"topic": "winner", "applyScope": "this", "expectedUpdatedAt": stamp,
	})
	if first.Code != http.StatusOK {
		t.Fatalf("first edit → %d, want 200", first.Code)
	}
	// Second edit reuses the now-stale stamp.
	second := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+target.String(), env.teacherATok, map[string]any{
		"topic": "loser", "applyScope": "this", "expectedUpdatedAt": stamp,
	})
	if second.Code != http.StatusConflict {
		t.Fatalf("stale edit → %d, want 409 SESSION_CONFLICT", second.Code)
	}
	if code := errCodeOf(t, second.Body.Bytes()); code != "SESSION_CONFLICT" {
		t.Errorf("error code = %q, want SESSION_CONFLICT", code)
	}
	if got := topicOf(t, target); got != "winner" {
		t.Errorf("row = %q, want winner (loser must not have overwritten)", got)
	}
}

// =============================================================================
// Cross-teacher-same-tenant isolation (Murat BLOCKER-6, the likeliest real leak).
// teacherA cannot GET/PATCH/cancel/DELETE teacherB's class session → 404;
// teacherA's LIST OMITS teacherB's sessions (absent, not hidden).
// =============================================================================
func TestSession_CrossTeacher_404_AndListAbsent(t *testing.T) {
	env := setupSessionHandlerTest(t)
	sB := seedSeries(t, env.centerID, env.classBID) // owned by teacher B
	victim := sB.future[0]

	get := classReq(t, env.srv, http.MethodGet, "/api/sessions/"+victim.String(), env.teacherATok, nil)
	if get.Code != http.StatusNotFound || errCodeOf(t, get.Body.Bytes()) != "SESSION_NOT_FOUND" {
		t.Errorf("teacherA GET teacherB session → %d/%s, want 404/SESSION_NOT_FOUND", get.Code, get.Body.String())
	}
	patch := classReq(t, env.srv, http.MethodPatch, "/api/sessions/"+victim.String(), env.teacherATok, map[string]any{
		"topic": "x", "applyScope": "this", "expectedUpdatedAt": sB.updatedAt[victim].Format(time.RFC3339Nano),
	})
	if patch.Code != http.StatusNotFound {
		t.Errorf("teacherA PATCH teacherB session → %d, want 404", patch.Code)
	}
	del := classReq(t, env.srv, http.MethodDelete, "/api/sessions/"+victim.String()+"?scope=this", env.teacherATok, nil)
	if del.Code != http.StatusNotFound {
		t.Errorf("teacherA DELETE teacherB session → %d, want 404", del.Code)
	}
	if got := topicOf(t, victim); got != "Original" || !existsRow(t, victim) {
		t.Error("teacherB session must be untouched by teacherA's blocked writes")
	}
	// LIST: teacherA's range covering B's sessions must OMIT them.
	list := classReq(t, env.srv, http.MethodGet, "/api/sessions?from=2026-08-01&to=2026-09-01", env.teacherATok, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("teacherA LIST → %d, want 200", list.Code)
	}
	var env2 classListEnvelope
	if err := json.Unmarshal(list.Body.Bytes(), &env2); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	for _, row := range env2.Data {
		if row["classId"] == env.classBID.String() {
			t.Error("R19/teacher-scope LEAK: teacherA's LIST array contains teacherB's class sessions (absent, not hidden)")
		}
	}
}

// =============================================================================
// Student → 403 on every session verb (surface is the deferred /my-schedule).
// =============================================================================
func TestSession_Student_Forbidden_AllVerbs(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)
	id := s.future[0].String()

	cases := []struct {
		method, path string
		body         any
	}{
		{http.MethodGet, "/api/sessions?from=2026-08-01&to=2026-09-01", nil},
		{http.MethodGet, "/api/sessions/" + id, nil},
		{http.MethodPost, "/api/sessions", map[string]any{"classId": env.classAID.String(), "startsAt": "2026-08-20T09:00:00Z", "durationMinutes": 90, "recurrence": map[string]any{"pattern": "none"}}},
		{http.MethodPatch, "/api/sessions/" + id, map[string]any{"topic": "x", "applyScope": "this", "expectedUpdatedAt": s.updatedAt[s.future[0]].Format(time.RFC3339Nano)}},
		{http.MethodDelete, "/api/sessions/" + id + "?scope=this", nil},
	}
	for _, c := range cases {
		rec := classReq(t, env.srv, c.method, c.path, env.studentTok, c.body)
		if rec.Code != http.StatusForbidden || errCodeOf(t, rec.Body.Bytes()) != "INSUFFICIENT_ROLE" {
			t.Errorf("student %s %s → %d/%s, want 403/INSUFFICIENT_ROLE", c.method, c.path, rec.Code, rec.Body.String())
		}
	}
}

// =============================================================================
// Recurrence bound — required endDate + 200 cap trio.
// =============================================================================
func TestSession_Recurrence_RequiresEndDate(t *testing.T) {
	env := setupSessionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/sessions", env.teacherATok, map[string]any{
		"classId": env.classAID.String(), "startsAt": "2026-08-20T09:00:00Z", "durationMinutes": 90,
		"recurrence": map[string]any{"pattern": "weekly", "weekdays": []int{3}}, // no endDate
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("recurring POST without endDate → %d, want 422", rec.Code)
	}
}

func TestSession_Recurrence_CapExceeded(t *testing.T) {
	env := setupSessionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/sessions", env.teacherATok, map[string]any{
		"classId": env.classAID.String(), "startsAt": "2026-08-20T09:00:00Z", "durationMinutes": 90,
		"recurrence": map[string]any{"pattern": "daily", "endDate": "2027-12-31"}, // ~500 days > 200
	})
	if rec.Code != http.StatusUnprocessableEntity || errCodeOf(t, rec.Body.Bytes()) != "RECURRENCE_LIMIT_EXCEEDED" {
		t.Fatalf("over-cap POST → %d/%s, want 422/RECURRENCE_LIMIT_EXCEEDED", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// List date-range window cap (Winston) + GET series counts (scope-UI oracle).
// =============================================================================
func TestSession_List_RangeTooWide(t *testing.T) {
	env := setupSessionHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/sessions?from=2026-01-01&to=2026-12-31", env.ownerTok, nil)
	if rec.Code != http.StatusUnprocessableEntity || errCodeOf(t, rec.Body.Bytes()) != "SCHEDULE_RANGE_TOO_WIDE" {
		t.Fatalf("365-day range → %d/%s, want 422/SCHEDULE_RANGE_TOO_WIDE", rec.Code, rec.Body.String())
	}
}

func TestSession_Get_SeriesCounts(t *testing.T) {
	env := setupSessionHandlerTest(t)
	s := seedSeries(t, env.centerID, env.classAID)

	rec := classReq(t, env.srv, http.MethodGet, "/api/sessions/"+s.future[0].String(), env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET detail → %d, want 200", rec.Code)
	}
	var env2 classEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env2); err != nil {
		t.Fatalf("decode: %v", err)
	}
	series, ok := env2.Data["series"].(map[string]any)
	if !ok {
		t.Fatal("GET /{id} must return a `series` block (total/upcoming/completed) as the scope-UI count oracle")
	}
	if series["total"].(float64) != 5 || series["upcoming"].(float64) != 3 || series["completed"].(float64) != 2 {
		t.Errorf("series counts = %v, want total5/upcoming3/completed2", series)
	}
}
