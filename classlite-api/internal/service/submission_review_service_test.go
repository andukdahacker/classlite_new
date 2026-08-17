// Story 5.5a — SubmissionService.GetStudentSubmissionReview service-layer ATDD.
//
// Covers (P-ids from the WF-8 risk-6 test design):
//   P0-1  OwnTerminal → read-back + prefix-valid audio, exactly 1 mint
//   P0-2  B1 same-center cross-student → 404 SUBMISSION_NOT_FOUND, zero mint
//   P0-3  B2 cross-tenant assignmentId → 404, BOTH reads RLS-scoped (no leak)
//   P0-4  ownership-before-enrollment → 404 (never a 403 that leaks the class)
//   P0-5  non-student principal → 403 INSUFFICIENT_ROLE, zero mint
//   P0-6  withdrawn / never-enrolled owner → 403 NOT_ENROLLED, zero mint
//   P0-7  no submission → 404 SUBMISSION_NOT_FOUND, zero mint
//   P0-10 null/absent audioKey (speaking) AND non-speaking terminal → AudioURL nil, no 500, zero mint
//   P0-11 presign runs AFTER the read tx commits (D9/PERF-1)
//   P0-12 zero mint on EVERY gated-failure path (table)
//   P1-1  in_progress short-circuit → CTA result, no strip, no presign (D10)
//   P1-2  closed / past-hard-deadline TERMINAL → still returns read-back (NOT lock-gated, D6)
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Build-tagged `atdd_red_phase`: excluded
// from normal `go test ./...`; `go test -tags=atdd_red_phase ./...` fails to
// compile on undefined Story-5.5a symbols (GetStudentSubmissionReview /
// StudentSubmissionReviewResult). Dev removes the tag per-file as each contract
// lands (red→green).
//
// PINNED CONTRACT (dev conforms):
//   svc.GetStudentSubmissionReview(ctx, tc, assignmentID uuid.UUID)
//       (service.StudentSubmissionReviewResult, error)
//   StudentSubmissionReviewResult{
//       Submission service.SubmissionResult // .Row.ID present for a resolved row
//       Assignment generated.Assignment
//       Exercise   service.AttemptExercise  // answer-stripped; ZERO value when InProgress
//       Released   bool                     // false for 5.5a (grades land in 5.5b)
//       AudioURL   *string                  // nil for non-speaking / nil-or-absent audioKey
//       InProgress bool                     // true → CTA short-circuit (no strip, no presign)
//   }
// Resolution is keyed on (assignment_id, principal studentID) — REUSE the existing
// `GetSubmissionByAssignmentStudent :one` (internal/store/queries/submissions.sql:8),
// do NOT add a parallel GetSubmissionByAssignmentAndStudent. The presigned GET is
// minted via StorageService.PresignGetOwned OUTSIDE the read tx (D9/PERF-1).
package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// -----------------------------------------------------------------------------
// env + file-local seeders (package service_test can only reach EXPORTED test
// helpers, so raw db.Exec mirrors the internal/test seeders' house style).
// -----------------------------------------------------------------------------

type reviewEnv struct {
	db         *test.TxDB
	storage    *service.MockStorageService
	svc        *service.SubmissionService
	centerID   uuid.UUID
	ownerID    uuid.UUID
	studentA   uuid.UUID
	studentB   uuid.UUID
	classID    uuid.UUID
	speakingEx uuid.UUID
	readingEx  uuid.UUID
	studentATC model.TenantContext
	studentBTC model.TenantContext
	ownerTC    model.TenantContext
}

func reviewPg(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func reviewInsertUser(t *testing.T, db *test.TxDB, email string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO users (id, email, full_name, password_hash, email_verified)
		 VALUES ($1, $2, 'Review User', 'x', true)`, id, email); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

func reviewTC(centerID, userID uuid.UUID, role model.Role) model.TenantContext {
	return model.TenantContext{
		CenterID:      centerID.String(),
		UserID:        userID.String(),
		Role:          role,
		EmailVerified: true,
	}
}

// speakingExerciseJSON is a valid speaking exercise (prompt-only section, no groups).
func speakingExerciseJSON() string {
	return `{"sections":[{"type":"speaking","title":"S","content":"Describe your day","questionGroups":[]}],"settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}}`
}

// readingExerciseJSON is a minimal non-speaking exercise (no audio to presign).
func readingExerciseJSON() string {
	return `{"sections":[{"type":"reading","title":"R","content":"passage","questionGroups":[]}],"settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}}`
}

// speakingSubmissionContent returns the v1 submission blob carrying an audioKey
// under the caller's tenant prefix (Story 5.4 shape) plus the key it embeds.
func speakingSubmissionContent(centerID uuid.UUID) (content, key string) {
	key = centerID.String() + "/speaking/" + uuid.NewString() + ".webm"
	content = `{"schemaVersion":1,"audioKey":"` + key + `","contentType":"audio/webm","durationSec":12}`
	return content, key
}

func newReviewEnv(t *testing.T) *reviewEnv {
	t.Helper()
	ctx := context.Background()
	db := test.SetupDB(t)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	centerID := uuid.UUID(center.ID.Bytes)
	test.TenantContext(t, db, center.ID)

	ownerID := reviewInsertUser(t, db, "owner-"+uuid.NewString()+"@example.com")
	studentA := reviewInsertUser(t, db, "sa-"+uuid.NewString()+"@example.com")
	studentB := reviewInsertUser(t, db, "sb-"+uuid.NewString()+"@example.com")
	test.CreateCenterMember(t, db, reviewPg(ownerID), center.ID, "owner")
	test.CreateCenterMember(t, db, reviewPg(studentA), center.ID, "student")
	test.CreateCenterMember(t, db, reviewPg(studentB), center.ID, "student")

	classID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`,
		classID, centerID, ownerID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	// studentA actively enrolled by default (each gated test overrides as needed).
	if _, err := db.Exec(ctx,
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), centerID, studentA, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
	speakingEx := reviewSeedExercise(t, db, centerID, ownerID, speakingExerciseJSON())
	readingEx := reviewSeedExercise(t, db, centerID, ownerID, readingExerciseJSON())

	audit := service.NewAuditService(db)
	storage := service.NewMockStorageService()
	svc := service.NewSubmissionService(db, audit, clock.RealClock{}).WithStorage(storage)

	return &reviewEnv{
		db: db, storage: storage, svc: svc,
		centerID: centerID, ownerID: ownerID, studentA: studentA, studentB: studentB,
		classID: classID, speakingEx: speakingEx, readingEx: readingEx,
		studentATC: reviewTC(centerID, studentA, model.RoleStudent),
		studentBTC: reviewTC(centerID, studentB, model.RoleStudent),
		ownerTC:    reviewTC(centerID, ownerID, model.RoleOwner),
	}
}

func reviewSeedExercise(t *testing.T, db *test.TxDB, centerID, creatorID uuid.UUID, content string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Ex Title','speaking',$5,1)`,
		id, centerID, creatorID, "EX-"+id.String()[:8], content); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	return id
}

func (e *reviewEnv) seedAssignment(t *testing.T, exerciseID uuid.UUID, status string, deadline time.Time, hard *time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, hard_deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1.5)`,
		id, e.centerID, exerciseID, e.classID, e.ownerID, status, deadline, hard); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return id
}

func (e *reviewEnv) seedSubmission(t *testing.T, assignmentID, studentID uuid.UUID, status, content string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	now := time.Now().UTC()
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at, submitted_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,1,$7,$7,$7,$7)`,
		id, e.centerID, assignmentID, studentID, status, content, now); err != nil {
		t.Fatalf("seed submission: %v", err)
	}
	return id
}

// -----------------------------------------------------------------------------
// P0-1 — own terminal SPEAKING: read-back + prefix-valid audio + exactly 1 mint.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_OwnTerminal_ReturnsReadbackAndPrefixValidAudio(t *testing.T) {
	e := newReviewEnv(t)
	content, audioKey := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentA, "submitted", content)

	res, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	if err != nil {
		t.Fatalf("own terminal review errored: %v", err)
	}
	if res.InProgress {
		t.Error("terminal submission must NOT be flagged InProgress")
	}
	if res.Released {
		t.Error("5.5a is pre-grade: Released must be false")
	}
	if !res.Submission.Row.ID.Valid {
		t.Error("resolved submission id must be present in the result")
	}
	if res.Exercise.ID == "" || len(res.Exercise.Sections) == 0 {
		t.Error("terminal result must carry the answer-stripped exercise")
	}
	if res.AudioURL == nil || *res.AudioURL == "" {
		t.Fatalf("speaking read-back must presign an AudioURL, got %v", res.AudioURL)
	}
	// SEC-8: the minted key stays under the caller's tenant prefix, and exactly ONE
	// GET was minted (no double-signing).
	if len(e.storage.PresignGetKeys) != 1 {
		t.Fatalf("presign mint count = %d, want exactly 1", len(e.storage.PresignGetKeys))
	}
	if got := e.storage.PresignGetKeys[0]; got != audioKey || !strings.HasPrefix(got, e.centerID.String()+"/") {
		t.Errorf("minted key = %q, want the audioKey %q under the %s/ prefix", got, audioKey, e.centerID)
	}
}

// -----------------------------------------------------------------------------
// P0-2 — B1 same-center cross-student → 404 SUBMISSION_NOT_FOUND, zero mint.
// The resolve is keyed on (assignment, CALLER); studentA has no row for B's
// assignment, so the caller gets the same 404 as a missing row — no oracle.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_B1_SameCenterCrossStudent_404_ZeroMint(t *testing.T) {
	e := newReviewEnv(t)
	// studentB is also actively enrolled and owns the ONLY submission.
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), e.centerID, e.studentB, e.classID); err != nil {
		t.Fatalf("seed B enrollment: %v", err)
	}
	content, _ := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentB, "submitted", content)

	_, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	assertReviewNotFound(t, err)
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P0-3 — B2 cross-tenant assignmentId → 404, BOTH the submission read AND the
// assignment read run under tenant-A RLS (Murat B-2: no field of tenant B's
// assignment surfaces). Store-level read isolation on the (assignment,student)
// resolve is covered by REUSING GetSubmissionByAssignmentStudent, whose RLS is
// already proven in internal/test/assignments_submissions_rls_test.go — so it is
// folded here rather than duplicated as a standalone store test.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_B2_CrossTenantAssignmentId_404_BothReadsRLSScoped(t *testing.T) {
	e := newReviewEnv(t)

	// Tenant B: its own graph + a terminal submission, seeded under B's RLS context.
	centerB := test.CreateCenterWithID(t, e.db, test.TenantBID, "Center B", "center-b")
	centerBID := uuid.UUID(centerB.ID.Bytes)
	test.TenantContext(t, e.db, centerB.ID)
	ownerB := reviewInsertUser(t, e.db, "ownerb-"+uuid.NewString()+"@example.com")
	studentBt := reviewInsertUser(t, e.db, "sbt-"+uuid.NewString()+"@example.com")
	test.CreateCenterMember(t, e.db, reviewPg(ownerB), centerB.ID, "owner")
	test.CreateCenterMember(t, e.db, reviewPg(studentBt), centerB.ID, "student")
	classB := uuid.New()
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'CB','active',$3)`,
		classB, centerBID, ownerB); err != nil {
		t.Fatalf("seed B class: %v", err)
	}
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), centerBID, studentBt, classB); err != nil {
		t.Fatalf("seed B enrollment: %v", err)
	}
	exB := reviewSeedExercise(t, e.db, centerBID, ownerB, speakingExerciseJSON())
	aidB := uuid.New()
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,'open', now() + interval '1 day', 1.5)`,
		aidB, centerBID, exB, classB, ownerB); err != nil {
		t.Fatalf("seed B assignment: %v", err)
	}
	contentB, _ := speakingSubmissionContent(centerBID)
	if _, err := e.db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at, submitted_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,'submitted',$5,1, now(), now(), now(), now())`,
		uuid.New(), centerBID, aidB, studentBt, contentB); err != nil {
		t.Fatalf("seed B submission: %v", err)
	}

	// Tenant-A student asks for tenant-B's assignmentId → RLS hides BOTH reads → 404.
	res, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aidB)
	assertReviewNotFound(t, err)
	assertZeroMint(t, e.storage)
	// No tenant-B assignment field may leak into the returned zero value.
	if res.Assignment.ID.Valid {
		t.Error("RLS VIOLATION: tenant B's assignment leaked through the cross-tenant 404")
	}
}

// -----------------------------------------------------------------------------
// P0-4 — ownership decided before enrollment: a caller with no submission gets
// 404 (not a 403 NOT_ENROLLED that would confirm the class exists).
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_Ownership_Before_Enrollment_NoOracle(t *testing.T) {
	e := newReviewEnv(t)
	// Remove studentA's enrollment so they are NOT enrolled AND own no submission.
	if _, err := e.db.Exec(context.Background(),
		`DELETE FROM enrollments WHERE class_id=$1 AND student_id=$2`, e.classID, e.studentA); err != nil {
		t.Fatalf("drop A enrollment: %v", err)
	}
	content, _ := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentB, "submitted", content) // B owns it

	_, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	assertReviewNotFound(t, err) // 404, NOT 403 — no class-existence oracle.
	var ne *service.NotEnrolledError
	if errors.As(err, &ne) {
		t.Error("leak: a non-owner learned the class exists via a 403 NOT_ENROLLED")
	}
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P0-5 — non-student principal → 403 INSUFFICIENT_ROLE, zero mint.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_NonStudentPrincipal_403_InsufficientRole_ZeroMint(t *testing.T) {
	e := newReviewEnv(t)
	content, _ := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentA, "submitted", content)

	_, err := e.svc.GetStudentSubmissionReview(context.Background(), e.ownerTC, aid)
	var fe *service.ForbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("expected ForbiddenError (INSUFFICIENT_ROLE) for an owner principal, got %v", err)
	}
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P0-6 — owner of the submission but not actively enrolled → 403 NOT_ENROLLED.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_WithdrawnOrNeverEnrolled_403_NotEnrolled_ZeroMint(t *testing.T) {
	e := newReviewEnv(t)
	// Withdraw studentA AFTER they own the (terminal) submission.
	if _, err := e.db.Exec(context.Background(),
		`UPDATE enrollments SET status='withdrawn' WHERE class_id=$1 AND student_id=$2`, e.classID, e.studentA); err != nil {
		t.Fatalf("withdraw A: %v", err)
	}
	content, _ := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentA, "submitted", content)

	_, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	var ne *service.NotEnrolledError
	if !errors.As(err, &ne) {
		t.Fatalf("expected NotEnrolledError for a withdrawn owner, got %v", err)
	}
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P0-7 — enrolled owner, but no submission for the assignment → 404, zero mint.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_NoSubmission_404_ZeroMint(t *testing.T) {
	e := newReviewEnv(t)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)

	_, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	assertReviewNotFound(t, err)
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P0-10 — B3: null/absent audioKey (speaking) AND non-speaking terminal both
// yield AudioURL == nil with no panic/500 and zero mint.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_B3_NullAudioKey_NullAudioUrl_No500(t *testing.T) {
	e := newReviewEnv(t)

	// (a) speaking submission with no audioKey field at all.
	aidSpeak := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aidSpeak, e.studentA, "submitted", `{"schemaVersion":1}`)
	res, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aidSpeak)
	if err != nil {
		t.Fatalf("null-audioKey speaking review errored: %v", err)
	}
	if res.AudioURL != nil {
		t.Errorf("absent audioKey must yield AudioURL nil, got %q", *res.AudioURL)
	}
	if len(e.storage.PresignGetKeys) != 0 {
		t.Errorf("no audioKey → no mint, got %d", len(e.storage.PresignGetKeys))
	}

	// (b) non-speaking (reading) terminal → never any audio.
	aidRead := e.seedAssignment(t, e.readingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aidRead, e.studentA, "submitted", `{"answers":{"1":"a"}}`)
	res2, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aidRead)
	if err != nil {
		t.Fatalf("non-speaking review errored: %v", err)
	}
	if res2.AudioURL != nil {
		t.Errorf("non-speaking terminal must yield AudioURL nil, got %q", *res2.AudioURL)
	}
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P0-11 — the presign is minted AFTER the read tx commits (D9/PERF-1). We cannot
// hook the tx boundary from the mock, so this pins the OBSERVABLE proxy: a single
// successful mint on the happy path. DEV NOTE: GetStudentSubmissionReview MUST
// commit readInSubmissionTx and THEN call PresignGetOwned outside it — never sign
// while holding the PG tx (a slow R2 round-trip must not pin a DB connection). If
// an ordering seam is added to the mock (e.g. a hook recording "tx open?" at mint
// time), tighten this assertion to prove no tx is held.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_PresignRunsOutsideReadTx(t *testing.T) {
	e := newReviewEnv(t)
	content, audioKey := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentA, "submitted", content)

	res, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	if err != nil {
		t.Fatalf("review errored: %v", err)
	}
	if res.AudioURL == nil {
		t.Fatal("expected an AudioURL on the happy path")
	}
	if len(e.storage.PresignGetKeys) != 1 || e.storage.PresignGetKeys[0] != audioKey {
		t.Fatalf("expected exactly one post-commit mint of %q, got %v", audioKey, e.storage.PresignGetKeys)
	}
}

// -----------------------------------------------------------------------------
// P0-12 — zero mint on EVERY gated-failure path (table).
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_ZeroMintOnEveryGatedFailurePath(t *testing.T) {
	cases := []struct {
		name  string
		build func(t *testing.T, e *reviewEnv) (model.TenantContext, uuid.UUID)
	}{
		{"non-student", func(t *testing.T, e *reviewEnv) (model.TenantContext, uuid.UUID) {
			content, _ := speakingSubmissionContent(e.centerID)
			aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
			e.seedSubmission(t, aid, e.studentA, "submitted", content)
			return e.ownerTC, aid
		}},
		{"not-enrolled", func(t *testing.T, e *reviewEnv) (model.TenantContext, uuid.UUID) {
			if _, err := e.db.Exec(context.Background(),
				`UPDATE enrollments SET status='withdrawn' WHERE class_id=$1 AND student_id=$2`, e.classID, e.studentA); err != nil {
				t.Fatalf("withdraw: %v", err)
			}
			content, _ := speakingSubmissionContent(e.centerID)
			aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
			e.seedSubmission(t, aid, e.studentA, "submitted", content)
			return e.studentATC, aid
		}},
		{"cross-student-404", func(t *testing.T, e *reviewEnv) (model.TenantContext, uuid.UUID) {
			content, _ := speakingSubmissionContent(e.centerID)
			aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
			e.seedSubmission(t, aid, e.studentB, "submitted", content)
			return e.studentATC, aid
		}},
		{"missing-404", func(t *testing.T, e *reviewEnv) (model.TenantContext, uuid.UUID) {
			aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
			return e.studentATC, aid
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newReviewEnv(t)
			ctx, aid := tc.build(t, e)
			if _, err := e.svc.GetStudentSubmissionReview(context.Background(), ctx, aid); err == nil {
				t.Fatal("expected a gated failure, got nil")
			}
			assertZeroMint(t, e.storage)
		})
	}
}

// -----------------------------------------------------------------------------
// P1-1 — in_progress short-circuit → CTA result, no strip, no presign (D10).
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_InProgress_ShortCircuit_CTA_NoStripNoPresign(t *testing.T) {
	e := newReviewEnv(t)
	content, _ := speakingSubmissionContent(e.centerID)
	aid := e.seedAssignment(t, e.speakingEx, "open", time.Now().Add(24*time.Hour), nil)
	e.seedSubmission(t, aid, e.studentA, "in_progress", content)

	res, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aid)
	if err != nil {
		t.Fatalf("in_progress review errored: %v", err)
	}
	if !res.InProgress {
		t.Error("D10: an in_progress submission must be flagged InProgress (resume CTA)")
	}
	if res.Exercise.ID != "" || len(res.Exercise.Sections) != 0 {
		t.Error("D10: the CTA short-circuit must NOT assemble a stripped exercise")
	}
	if res.AudioURL != nil {
		t.Error("D10: the CTA short-circuit must NOT presign audio")
	}
	assertZeroMint(t, e.storage)
}

// -----------------------------------------------------------------------------
// P1-2 — closed / past-hard-deadline TERMINAL submission still returns the
// read-back (the review read is NOT lock-gated, D6). Differential: the sibling
// write path SubmissionService.Submit IS lock-gated (see
// internal/test/submission_lifecycle_service_test.go TestSubmit_HardEqualsSoft-
// Deadline_LockWins) — the review READ deliberately is not.
// -----------------------------------------------------------------------------

func TestGetStudentSubmissionReview_ClosedOrPastHardDeadline_Terminal_Still200ReadOnly(t *testing.T) {
	e := newReviewEnv(t)
	past := time.Now().Add(-48 * time.Hour)
	pastHard := time.Now().Add(-24 * time.Hour)
	content, _ := speakingSubmissionContent(e.centerID)

	// (a) closed assignment.
	aClosed := e.seedAssignment(t, e.speakingEx, "closed", past, nil)
	e.seedSubmission(t, aClosed, e.studentA, "submitted", content)
	if _, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aClosed); err != nil {
		t.Fatalf("closed assignment: review must still succeed (D6, not lock-gated), got %v", err)
	}

	// (b) open but past the hard deadline.
	content2, _ := speakingSubmissionContent(e.centerID)
	aHard := e.seedAssignment(t, e.speakingEx, "open", past, &pastHard)
	e.seedSubmission(t, aHard, e.studentA, "submitted", content2)
	res, err := e.svc.GetStudentSubmissionReview(context.Background(), e.studentATC, aHard)
	if err != nil {
		t.Fatalf("past-hard-deadline: review must still succeed (D6), got %v", err)
	}
	if res.InProgress {
		t.Error("a submitted row past the deadline is still terminal, not InProgress")
	}
}

// --- shared assertions ---

func assertReviewNotFound(t *testing.T, err error) {
	t.Helper()
	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("expected model.NotFoundError, got %T: %v", err, err)
	}
	if nf.Code != "SUBMISSION_NOT_FOUND" {
		t.Errorf("not-found code = %q, want SUBMISSION_NOT_FOUND", nf.Code)
	}
}

func assertZeroMint(t *testing.T, storage *service.MockStorageService) {
	t.Helper()
	if n := len(storage.PresignGetKeys); n != 0 {
		t.Errorf("gated-failure path minted %d presigned URL(s), want 0 (no audio oracle before the gate)", n)
	}
}
