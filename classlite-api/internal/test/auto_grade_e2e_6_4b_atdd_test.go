// Story 6.4b (AC17a · D7/D16 · R16) — the cross-cutting objective auto-grading proof leg
// this file OWNS: the substantive R16 immutability proof AND the D7 real-handler contract
// check, wired end-to-end over the REAL SubmissionService.Submit auto-grade hook (no
// hand-inserted working row) with a NEAR-MISS answer key that genuinely yields
// needs_review. Service layer over the real DB in a tx (SetupDB → RLS enforced under
// classlite_app, TxDB auto-rollback). No mocks (TEST-BE-2).
//
// GREENED (was `//go:build atdd_red_phase`, per reference_atdd_red_convention): this file
// references the additive field service.AutoGradeView.ReleasedProjection — the definitive
// as-if-released projection (unresolved needs_review → wrong over the FULL denominator, the
// same math Release uses). That field now SHIPS, so the red-phase build tag was REMOVED and
// this file compiles and runs under the normal build (`go build ./...` / `go test ./...`).
// No t.Skip — the assertions below are real.
//
// The green-phase seam this proved (now realized in the code under test):
//   - service.AutoGradeView carries an additive `ReleasedProjection *AutoGradeReleasedProjection`
//     field ({RawScore, MaxScore, Percentage, Band} computed by definitiveScore(answers)) —
//     the as-if-released numbers, present PRE-release so the teacher sees the reckoning
//     before committing.
//   - buildAutoGradeView (and thus Override's returned view + populateAutoGrade's grading
//     read) populate ReleasedProjection unconditionally (it is the definitive projection
//     regardless of the current `released` flag).
//   - The grading-read JSON therefore structurally carries a `releasedProjection`
//     {rawScore, band} object — the D7 real-handler contract the Playwright/MSW leg cannot
//     prove because it mocks the API.

package test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// nearMissAttemptBlob answers the 2-question objectiveExercise2Q (defined in
// auto_grade_override_release_atdd_test.go, always-compiled): 0:0:0 exact-correct
// ("The fox"), 0:1:0 a free-text NEAR-MISS ("nesessary" vs the key "necessary") that the
// grading engine emits as needs_review — the golden recipe, produced here end-to-end by
// the REAL submit hook (no existing test drives this content through Submit).
const nearMissAttemptBlob = `{"schemaVersion":1,"answers":{"0:0:0":"The fox","0:1:0":"nesessary"},"flagged":[]}`

// TestAutoGrade_6_4b_EndToEnd_Immutability_And_ReleasedProjection walks the full objective
// grading lifecycle over the real services: submit (auto-grade hook fires → needs_review
// working row) → grading read (provisional band + as-if-released projection) → override →
// release (definitive == the prior projection) → re-release/override-after-release both 409.
func TestAutoGrade_6_4b_EndToEnd_Immutability_And_ReleasedProjection(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerID := uuid.UUID(center.ID.Bytes)
	TenantContext(t, db, center.ID)

	teacherID := rlsInsertUserAS(t, db, "teacher-"+uuid.NewString()+"@example.com")
	studentID := rlsInsertUserAS(t, db, "student-"+uuid.NewString()+"@example.com")
	CreateCenterMember(t, db, pgUUIDFromGo(teacherID), center.ID, "owner")
	CreateCenterMember(t, db, pgUUIDFromGo(studentID), center.ID, "student")

	classID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`, classID, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	if _, err := db.Exec(ctx, `INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`, uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}

	// Objective 2-question exercise (mcq 0:0:0 + fill_in_blank 0:1:0 keyed "necessary").
	exerciseID := uuid.New()
	if _, err := db.Exec(ctx, `INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version) VALUES ($1,$2,$3,$4,'Obj','reading',$5,1)`,
		exerciseID, centerID, teacherID, "EX-"+exerciseID.String()[:8], objectiveExercise2Q); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	assignmentID := rlsInsertAssignment(t, db, centerID, exerciseID, classID, teacherID)

	// in_progress submission whose blob near-misses 0:1:0 → needs_review after the hook.
	subID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at)
		 VALUES ($1,$2,$3,$4,'in_progress',$5,1, now())`,
		subID, centerID, assignmentID, studentID, nearMissAttemptBlob); err != nil {
		t.Fatalf("seed in_progress submission: %v", err)
	}

	audit := service.NewAuditService(db)
	clk := clock.RealClock{}
	studentTC := model.TenantContext{CenterID: centerID.String(), UserID: studentID.String(), Role: model.RoleStudent, EmailVerified: true}
	ownerTC := model.TenantContext{CenterID: centerID.String(), UserID: teacherID.String(), Role: model.RoleOwner, EmailVerified: true}

	// --- 1. REAL submit → auto-grade hook fires and writes ONE needs_review working row.
	subSvc := service.NewSubmissionService(db, audit, clk)
	if _, err := subSvc.Submit(ctx, studentTC, subID); err != nil {
		t.Fatalf("submit: %v", err)
	}
	var n int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM auto_grade_results WHERE submission_id=$1`, subID).Scan(&n); err != nil {
		t.Fatalf("count working rows: %v", err)
	}
	if n != 1 {
		t.Fatalf("auto_grade_results rows = %d, want exactly 1 (objective submit auto-grades)", n)
	}
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM auto_grade_results WHERE submission_id=$1 AND answers @> '[{"questionRef":"0:1:0","autoMark":"needs_review"}]'::jsonb`,
		subID).Scan(&n); err != nil {
		t.Fatalf("probe needs_review: %v", err)
	}
	if n != 1 {
		t.Fatalf("0:1:0 autoMark != needs_review — the near-miss recipe (nesessary/necessary) did not yield needs_review end-to-end")
	}

	// --- 2. Grading read (pre-release): provisional EXCLUDES the unresolved needs_review
	// (raw 1 / denom 1 = 100% → band 9.0), while ReleasedProjection COUNTS it wrong over
	// the full denominator (raw 1 / max 2 = 50% → band 6.0). released=false.
	gradingSvc := service.NewGradingService(db, audit, clk)
	pre, err := gradingSvc.GetSubmissionForGrading(ctx, ownerTC, subID)
	if err != nil {
		t.Fatalf("grading read (pre-release): %v", err)
	}
	if pre.AutoGrade == nil {
		t.Fatalf("grading read: AutoGrade nil, want the objective breakdown")
	}
	if pre.AutoGrade.Released {
		t.Errorf("pre-release autoGrade.Released = true, want false")
	}
	if pre.AutoGrade.RawScore != 1 || pre.AutoGrade.MaxScore != 2 {
		t.Errorf("provisional raw/max = %d/%d, want 1/2", pre.AutoGrade.RawScore, pre.AutoGrade.MaxScore)
	}
	if pre.AutoGrade.ProvisionalBand != 9.0 {
		t.Errorf("provisional band = %v, want 9.0 (needs_review excluded from denom → 100%%)", pre.AutoGrade.ProvisionalBand)
	}
	// GREEN SEAM — the additive as-if-released projection (compile-red until it ships).
	if pre.AutoGrade.ReleasedProjection == nil {
		t.Fatalf("grading read: autoGrade.ReleasedProjection nil, want the definitive as-if-released numbers (D7)")
	}
	projRaw := pre.AutoGrade.ReleasedProjection.RawScore
	projBand := pre.AutoGrade.ReleasedProjection.Band
	if projRaw != 1 || pre.AutoGrade.ReleasedProjection.MaxScore != 2 {
		t.Errorf("releasedProjection raw/max = %d/%d, want 1/2 (needs_review → wrong over full denom)", projRaw, pre.AutoGrade.ReleasedProjection.MaxScore)
	}
	if projBand != 6.0 {
		t.Errorf("releasedProjection band = %v, want 6.0 (raw 1/max 2 = 50%%); released band must be <= provisional band", projBand)
	}
	if !(projBand <= pre.AutoGrade.ProvisionalBand) {
		t.Errorf("released band %v must be <= provisional band %v (unresolved needs_review can only lower the definitive score)", projBand, pre.AutoGrade.ProvisionalBand)
	}

	// --- 6. D7 real-handler contract (folded in here since we hold the view): the emitted
	// grading-read autoGrade JSON structurally carries a releasedProjection {rawScore, band}
	// object. Case-insensitive so it holds whatever wire tag the green implementer picks.
	wire, merr := json.Marshal(pre.AutoGrade)
	if merr != nil {
		t.Fatalf("marshal autoGrade: %v", merr)
	}
	low := strings.ToLower(string(wire))
	for _, key := range []string{"releasedprojection", "rawscore", "band"} {
		if !strings.Contains(low, key) {
			t.Errorf("D7 contract: serialized autoGrade missing %q — releasedProjection {rawScore, band} must be structurally present", key)
		}
	}

	// --- 3. Override 0:1:0 → wrong. The needs_review is now resolved, so the provisional
	// denominator becomes the full maxScore: raw 1 / max 2 = 50%.
	agSvc := service.NewAutoGradeService(db, audit, clk)
	ov, err := agSvc.Override(ctx, ownerTC, subID, service.AutoGradeOverrideInput{QuestionRef: "0:1:0", Mark: "wrong"})
	if err != nil {
		t.Fatalf("override: %v", err)
	}
	if ov.RawScore != 1 || ov.MaxScore != 2 {
		t.Errorf("post-override raw/max = %d/%d, want 1/2", ov.RawScore, ov.MaxScore)
	}
	if ov.Percentage != 50 {
		t.Errorf("post-override percentage = %v, want 50 (needs_review resolved to wrong → full denom)", ov.Percentage)
	}
	if ov.Released {
		t.Errorf("post-override released = true, want false (not yet released)")
	}
	// The recomputed view's projection still equals reality (both 50% / band 6.0).
	if ov.ReleasedProjection == nil || ov.ReleasedProjection.RawScore != 1 {
		t.Errorf("post-override releasedProjection = %+v, want rawScore 1", ov.ReleasedProjection)
	}

	// --- 4. Release (no body) → 200. Definitive grade band == the prior projection band.
	grade, err := agSvc.Release(ctx, ownerTC, subID)
	if err != nil {
		t.Fatalf("release: %v", err)
	}
	if grade.OverallBand != projBand {
		t.Errorf("released grade band = %v, want %v (the projection predicted the definitive score)", grade.OverallBand, projBand)
	}
	// Grading read (post-release): released=true, scored DEFINITIVELY, and it matches the
	// pre-release projection — the projection was truthful.
	post, err := gradingSvc.GetSubmissionForGrading(ctx, ownerTC, subID)
	if err != nil {
		t.Fatalf("grading read (post-release): %v", err)
	}
	if post.AutoGrade == nil || !post.AutoGrade.Released {
		t.Fatalf("post-release autoGrade.Released = %v, want true", post.AutoGrade)
	}
	if post.AutoGrade.RawScore != projRaw || post.AutoGrade.ProvisionalBand != projBand {
		t.Errorf("definitive raw/band = %d/%v, want %d/%v (== the pre-release releasedProjection)",
			post.AutoGrade.RawScore, post.AutoGrade.ProvisionalBand, projRaw, projBand)
	}

	// --- 5. Immutability (R16): re-release AND override-after-release both 409.
	var conflict model.ConflictError
	if _, rerr := agSvc.Release(ctx, ownerTC, subID); !errors.As(rerr, &conflict) || conflict.Code != "SUBMISSION_ALREADY_RELEASED" {
		t.Errorf("re-release → want 409 SUBMISSION_ALREADY_RELEASED, got %v", rerr)
	}
	if _, oerr := agSvc.Override(ctx, ownerTC, subID, service.AutoGradeOverrideInput{QuestionRef: "0:1:0", Mark: "correct"}); !errors.As(oerr, &conflict) || conflict.Code != "SUBMISSION_ALREADY_RELEASED" {
		t.Errorf("override after release → want 409 SUBMISSION_ALREADY_RELEASED, got %v", oerr)
	}
}
