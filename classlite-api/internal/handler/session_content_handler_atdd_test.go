// Story 3.5 — SessionContentHandler integration tests (TEST-BE-3: real
// middleware, real service, real DB via the committed raw pool). Covers
// AC3/AC4/AC5/AC6/AC7:
//   - teacher CRUD on own session's notes/materials/exercises → 201/200/204
//   - cross-teacher caller → 404 SESSION_NOT_FOUND (teacher-sees-nothing)
//   - student caller → 403 INSUFFICIENT_ROLE
//   - a sessionId belonging to another tenant → 404 (cross-tenant FK closed by
//     the service parent-load under tenant context; the FK alone does not)
//   - content addable on PAST and CANCELLED sessions (no time/status gate)
//   - (id, session_id) mutation guard: a note edited through the wrong session → 404
//   - full {data,meta} success envelope + {error:{code,message,requestId}} shape
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// decodeContentList unmarshals a {data:[…]} list envelope.
func decodeContentList(t *testing.T, rec *httptest.ResponseRecorder) classListEnvelope {
	t.Helper()
	var out classListEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode list envelope: %v (body: %s)", err, rec.Body.String())
	}
	return out
}

type contentTestEnv struct {
	srv           http.Handler
	centerID      string
	sessionAID    uuid.UUID // in class A (teacher A)
	sessionBID    uuid.UUID // in class B (teacher B)
	pastSessionID uuid.UUID // in class A, starts_at in the past
	cancelledID   uuid.UUID // in class A, status='cancelled'
	ownerTok      string
	teacherATok   string
	teacherBTok   string
	studentTok    string
}

// seedContentSession inserts one session via the superuser pool. status is
// 'scheduled' or 'cancelled' (cancelled sets cancelled_at to honor the coupling
// CHECK). Returns the session id.
func seedContentSession(t *testing.T, centerID string, classID uuid.UUID, startsAt time.Time, status string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	sp := test.SuperuserPool(t)
	var cancelledAt any
	if status == "cancelled" {
		cancelledAt = startsAt
	}
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status, cancelled_at)
		 VALUES ($1, $2::uuid, $3, 'Topic', $4::timestamptz, $4::timestamptz + interval '90 minutes', $5, $6)`,
		id, centerID, classID, startsAt, status, cancelledAt,
	); err != nil {
		t.Fatalf("seed session (%s): %v", status, err)
	}
	return id
}

func setupContentHandlerTest(t *testing.T) contentTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	teacherA := test.CreateUserOnPool(t, pool, "ta-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "tb-"+sfx+"@example.com", "Teacher B")
	student := test.CreateUserOnPool(t, pool, "st-"+sfx+"@example.com", "Student S")
	for _, u := range []test.User{owner, teacherA, teacherB, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	taID := test.UUIDString(teacherA.ID)
	tbID := test.UUIDString(teacherB.ID)
	classA := test.SeedClass(t, centerID, "Class A", "active", &taID, nil)
	classB := test.SeedClass(t, centerID, "Class B", "active", &tbID, nil)

	future := time.Now().Add(24 * time.Hour)
	past := time.Now().Add(-48 * time.Hour)
	env := contentTestEnv{
		centerID:      centerID,
		sessionAID:    seedContentSession(t, centerID, classA, future, "scheduled"),
		sessionBID:    seedContentSession(t, centerID, classB, future, "scheduled"),
		pastSessionID: seedContentSession(t, centerID, classA, past, "scheduled"),
		cancelledID:   seedContentSession(t, centerID, classA, past, "cancelled"),
		ownerTok:      test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		teacherATok:   test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok:   test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:    test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
	env.srv = test.NewSessionContentTestServerBareMux(t, pool)

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		for _, entity := range []string{"session_note", "session_material", "session_exercise"} {
			_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type = $1`, entity)
		}
		_, _ = sp.Exec(ctx, `DELETE FROM session_notes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM session_materials WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM session_exercises WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM sessions WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, teacherA, teacherB, student} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})
	return env
}

func notesPath(id uuid.UUID) string     { return "/api/sessions/" + id.String() + "/notes" }
func materialsPath(id uuid.UUID) string { return "/api/sessions/" + id.String() + "/materials" }
func exercisesPath(id uuid.UUID) string { return "/api/sessions/" + id.String() + "/exercises" }

// =============================================================================
// AC3 — teacher CRUD lifecycle on own session's notes (201 → 200 → 200 → 204)
// =============================================================================
func TestSessionContent_Notes_TeacherCRUD(t *testing.T) {
	env := setupContentHandlerTest(t)

	create := classReq(t, env.srv, http.MethodPost, notesPath(env.sessionAID), env.teacherATok,
		map[string]any{"body": "Covered past perfect"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create note → %d, want 201 (body: %s)", create.Code, create.Body.String())
	}
	created := decodeClassEnvelope(t, create)
	if created.Data["body"] != "Covered past perfect" {
		t.Errorf("body = %v, want 'Covered past perfect'", created.Data["body"])
	}
	if created.Data["sessionId"] != env.sessionAID.String() {
		t.Errorf("sessionId = %v, want %s", created.Data["sessionId"], env.sessionAID)
	}
	if _, ok := created.Data["authorId"]; !ok {
		t.Error("response missing authorId key (GO-5 explicit null)")
	}
	if created.Meta.ServerTime == "" {
		t.Error("envelope missing meta.serverTime")
	}
	noteID, _ := created.Data["id"].(string)

	list := classReq(t, env.srv, http.MethodGet, notesPath(env.sessionAID), env.teacherATok, nil)
	if list.Code != http.StatusOK {
		t.Fatalf("list notes → %d, want 200", list.Code)
	}
	if got := len(decodeContentList(t, list).Data); got != 1 {
		t.Fatalf("list length = %d, want 1", got)
	}

	upd := classReq(t, env.srv, http.MethodPatch, notesPath(env.sessionAID)+"/"+noteID, env.teacherATok,
		map[string]any{"body": "Edited note"})
	if upd.Code != http.StatusOK {
		t.Fatalf("update note → %d, want 200 (body: %s)", upd.Code, upd.Body.String())
	}
	if decodeClassEnvelope(t, upd).Data["body"] != "Edited note" {
		t.Error("note body not updated")
	}

	del := classReq(t, env.srv, http.MethodDelete, notesPath(env.sessionAID)+"/"+noteID, env.teacherATok, nil)
	if del.Code != http.StatusNoContent {
		t.Fatalf("delete note → %d, want 204 (body: %s)", del.Code, del.Body.String())
	}
	after := classReq(t, env.srv, http.MethodGet, notesPath(env.sessionAID), env.teacherATok, nil)
	if got := len(decodeContentList(t, after).Data); got != 0 {
		t.Errorf("post-delete list length = %d, want 0", got)
	}
}

// =============================================================================
// AC4 — materials are link-only; kind defaults to 'link'
// =============================================================================
func TestSessionContent_Materials_CreateLinkOnly(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, materialsPath(env.sessionAID), env.teacherATok,
		map[string]any{"title": "Grammar sheet", "url": "https://example.com/g.pdf"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create material → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["kind"] != "link" {
		t.Errorf("kind = %v, want 'link'", got.Data["kind"])
	}
	if got.Data["url"] != "https://example.com/g.pdf" {
		t.Errorf("url = %v", got.Data["url"])
	}
}

// =============================================================================
// AC5 — exercises: optional instructions/link render as explicit nulls when absent
// =============================================================================
func TestSessionContent_Exercises_CreateWithOptionalNulls(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, exercisesPath(env.sessionAID), env.teacherATok,
		map[string]any{"title": "Warm-up drill"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create exercise → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	for _, key := range []string{"instructions", "link"} {
		v, ok := got.Data[key]
		if !ok {
			t.Errorf("response missing %q key — GO-5 requires explicit null", key)
		} else if v != nil {
			t.Errorf("%s = %v, want null when omitted", key, v)
		}
	}
}

// =============================================================================
// AC7 — cross-teacher isolation: teacher B cannot touch teacher A's session → 404
// =============================================================================
func TestSessionContent_CrossTeacher_404(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, notesPath(env.sessionAID), env.teacherBTok,
		map[string]any{"body": "sneaky"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-teacher create → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "SESSION_NOT_FOUND" {
		t.Errorf("error code = %q, want SESSION_NOT_FOUND", code)
	}
}

// =============================================================================
// AC7 — students are 403 on both read and write
// =============================================================================
func TestSessionContent_StudentForbidden_403(t *testing.T) {
	env := setupContentHandlerTest(t)
	write := classReq(t, env.srv, http.MethodPost, notesPath(env.sessionAID), env.studentTok,
		map[string]any{"body": "x"})
	if write.Code != http.StatusForbidden {
		t.Fatalf("student write → %d, want 403 (body: %s)", write.Code, write.Body.String())
	}
	if code := errCodeOf(t, write.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("write error code = %q, want INSUFFICIENT_ROLE", code)
	}
	read := classReq(t, env.srv, http.MethodGet, notesPath(env.sessionAID), env.studentTok, nil)
	if read.Code != http.StatusForbidden {
		t.Errorf("student read → %d, want 403", read.Code)
	}
}

// =============================================================================
// AC6 — cross-tenant FK: a sessionId belonging to another tenant → 404. The FK
// alone does not close this; the service parent-load under tenant context does.
// =============================================================================
func TestSessionContent_CrossTenantSession_404(t *testing.T) {
	env := setupContentHandlerTest(t)

	// Build a second center with its own class + session directly on the pool.
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	var centerBID string
	if err := sp.QueryRow(ctx,
		`INSERT INTO centers (name, short_code) VALUES ($1, $2) RETURNING id`,
		"Center B2", "cb2-"+sfx).Scan(&centerBID); err != nil {
		t.Fatalf("insert center B2: %v", err)
	}
	classB2 := uuid.New()
	sessionB2 := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status) VALUES ($1, $2, 'CB2', 'active')`,
		classB2, centerBID); err != nil {
		t.Fatalf("insert class B2: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status)
		 VALUES ($1, $2, $3, 'T', now() + interval '1 day', now() + interval '1 day' + interval '90 minutes', 'scheduled')`,
		sessionB2, centerBID, classB2); err != nil {
		t.Fatalf("insert session B2: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(ctx, `DELETE FROM sessions WHERE center_id = $1`, centerBID)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerBID)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerBID)
	})

	// Center A's owner tries to add a note onto center B2's session → 404.
	rec := classReq(t, env.srv, http.MethodPost, notesPath(sessionB2), env.ownerTok,
		map[string]any{"body": "cross-tenant"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant session → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "SESSION_NOT_FOUND" {
		t.Errorf("error code = %q, want SESSION_NOT_FOUND", code)
	}
}

// =============================================================================
// AC3 — content is addable on a PAST session (no now-floor, unlike scheduling)
// =============================================================================
func TestSessionContent_PastSession_Allowed_201(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, notesPath(env.pastSessionID), env.teacherATok,
		map[string]any{"body": "Retro note on a finished session"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("note on past session → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// AC3 — content is addable on a CANCELLED session (status is not a write-gate)
// =============================================================================
func TestSessionContent_CancelledSession_Allowed_201(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, notesPath(env.cancelledID), env.teacherATok,
		map[string]any{"body": "Cancelled because of the storm"})
	if rec.Code != http.StatusCreated {
		t.Fatalf("note on cancelled session → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// (id, session_id) guard — a note created under session A cannot be edited via
// session B's path (owner is center-wide, so this isolates the guard from
// teacher-scope). Expect 404 SESSION_NOTE_NOT_FOUND.
// =============================================================================
func TestSessionContent_Note_CrossSessionEdit_404(t *testing.T) {
	env := setupContentHandlerTest(t)
	create := classReq(t, env.srv, http.MethodPost, notesPath(env.sessionAID), env.ownerTok,
		map[string]any{"body": "belongs to A"})
	if create.Code != http.StatusCreated {
		t.Fatalf("create note → %d (body: %s)", create.Code, create.Body.String())
	}
	noteID, _ := decodeClassEnvelope(t, create).Data["id"].(string)

	// Edit it through session B's path (owner has scope on B, but the note is not under B).
	rec := classReq(t, env.srv, http.MethodPatch, notesPath(env.sessionBID)+"/"+noteID, env.ownerTok,
		map[string]any{"body": "moved?"})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cross-session edit → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "SESSION_NOTE_NOT_FOUND" {
		t.Errorf("error code = %q, want SESSION_NOTE_NOT_FOUND", code)
	}
}

// =============================================================================
// unauthenticated → 401
// =============================================================================
func TestSessionContent_Unauthenticated_401(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, notesPath(env.sessionAID), "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token → %d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// validation — empty body → 422 VALIDATION_ERROR + full error envelope shape
// =============================================================================
func TestSessionContent_EmptyBody_422(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, notesPath(env.sessionAID), env.teacherATok,
		map[string]any{"body": "   "})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty body → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", code)
	}
}

// =============================================================================
// AC4 — a material url with a non-http(s) scheme is rejected server-side (the
// stored link is an href sink on the client). javascript:/data:/relative → 422.
// =============================================================================
func TestSessionContent_Material_RejectsNonHTTPURL_422(t *testing.T) {
	env := setupContentHandlerTest(t)
	for _, bad := range []string{"javascript:alert(document.cookie)", "data:text/html,<script>1</script>", "/relative/path", "ftp://host/f"} {
		rec := classReq(t, env.srv, http.MethodPost, materialsPath(env.sessionAID), env.teacherATok,
			map[string]any{"title": "sheet", "url": bad})
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("material url %q → %d, want 422 (body: %s)", bad, rec.Code, rec.Body.String())
		}
		if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
			t.Errorf("material url %q error code = %q, want VALIDATION_ERROR", bad, code)
		}
	}
}

// =============================================================================
// AC5 — an exercise link, when present, must be an http(s) URL; a bad scheme is
// rejected (422). An ABSENT link stays valid (covered by the optional-nulls test).
// =============================================================================
func TestSessionContent_Exercise_RejectsNonHTTPLink_422(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, exercisesPath(env.sessionAID), env.teacherATok,
		map[string]any{"title": "drill", "link": "javascript:void(0)"})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("exercise link javascript: → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("exercise link error code = %q, want VALIDATION_ERROR", code)
	}
}

// =============================================================================
// a body exceeding the 16 KiB MaxBytesReader cap → 413 PAYLOAD_TOO_LARGE. Wired
// on every content body incl. PATCH; asserted on the note POST here.
// =============================================================================
func TestSessionContent_OversizedBody_413(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, notesPath(env.sessionAID), env.teacherATok,
		map[string]any{"body": strings.Repeat("x", 17*1024)})
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body → %d, want 413 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "PAYLOAD_TOO_LARGE" {
		t.Errorf("error code = %q, want PAYLOAD_TOO_LARGE", code)
	}
}

// =============================================================================
// error envelope shape — a 404 carries code + message + requestId (GFW-5/CQ-5)
// =============================================================================
func TestSessionContent_ErrorEnvelopeShape(t *testing.T) {
	env := setupContentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, notesPath(uuid.New()), env.ownerTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown session → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	var e errEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if e.Error.Code != "SESSION_NOT_FOUND" {
		t.Errorf("code = %q, want SESSION_NOT_FOUND", e.Error.Code)
	}
	if e.Error.Message == "" {
		t.Error("error.message is empty")
	}
	// requestId is populated by the request-id middleware, which the bare-mux
	// test chain omits (it is wired in production main.go) — not asserted here.
}
