// student_mistakes_example_quote_atdd_test.go — Story 8-3b ATDD (GREEN as of dev-story).
// **P0 blocking-merge** (AC21 · R-D). The WF-4 co-finalize (D-COFINAL) adds three
// fields to MistakePattern — `questionType`, `exampleQuote`, `exampleNote` — that
// the BACKEND must POPULATE. This is the pin the FE cannot give: openapi-typescript
// makes `questionType: string|null` satisfiable by `null`, so a partial ship
// (contract deployed, buildMistakePatterns never wired) is `tsc -b`-green and
// silently renders a blank/"—" label on BOTH Mistakes tabs (Murat #2). This test
// proves population on BOTH build functions:
//   - buildStudentMistakePatterns (analytics_service.go:823) via GetStudentPerformance
//   - buildMistakePatterns        (analytics_service.go:1003) via anClassPerf
//
// EXPECTED population (AC21):
//
//	auto_graded (reading/listening): QuestionType != ""  · Criterion == ""  · ExampleQuote == nil · ExampleNote == nil
//	human_comment (writing/speaking): QuestionType == "" · Criterion != ""  · ExampleQuote != nil (the mined comment text)
//
// RED: `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` this compile-FAILS
// on the not-yet-existing `service.MistakePattern.QuestionType`/`.ExampleQuote`/
// `.ExampleNote` fields (the D-COFINAL seam). All helpers are shipped/local
// (spSeedObjectiveGrade, spSeedWritingErrorGrade, anClassPerf, dashPGToUUID,
// setCenterTZUTC, seedClassWithTeacher, insertEnrollmentRaw). No test.skip —
// [[reference_atdd_red_convention]]. De-tag once the fields + mining land.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

func TestStudentMistakes_QuestionTypeAndExampleQuote_Populated_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)

	studentU := CreateUser(t, db, "s@center-a.test", "Subject Student")
	CreateCenterMember(t, db, studentU.ID, center.ID, "student")
	sID := dashPGToUUID(t, studentU.ID)
	insertEnrollmentRaw(t, db, cid, sID, class, "active")

	// A SECOND enrolled student sharing the same patterns — the class co-gate
	// (buildMistakePatterns) requires affectedStudentCount >= MinPatternStudents (2),
	// so a single-student fixture would leave the class endpoint empty and never
	// exercise the class build fn (the per-student endpoint has no multi-student gate).
	student2 := CreateUser(t, db, "s2@center-a.test", "Peer Student")
	CreateCenterMember(t, db, student2.ID, center.ID, "student")
	s2ID := dashPGToUUID(t, student2.ID)
	insertEnrollmentRaw(t, db, cid, s2ID, class, "active")

	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	now := time.Now()
	day := func(n int) time.Time { return now.Add(-time.Duration(n) * 24 * time.Hour) }

	// human_comment source: a Writing error comment (text "x" is the mined exemplar).
	spSeedWritingErrorGrade(t, db, cid, class, sID, tID, "coherenceCohesion", 3, day(1))
	spSeedWritingErrorGrade(t, db, cid, class, s2ID, tID, "coherenceCohesion", 3, day(1))
	// auto_graded source: a Reading objective grade with answer_errors (questionType "gap_fill").
	readingErrors := `[{"questionRef":"qr","questionType":"gap_fill"}]`
	for i := 0; i < 3; i++ {
		spSeedObjectiveGrade(t, db, cid, class, sID, tID, "reading", day(i+2), &readingErrors)
		spSeedObjectiveGrade(t, db, cid, class, s2ID, tID, "reading", day(i+2), &readingErrors)
	}

	// helper: find one pattern by source in a set.
	findBySource := func(t *testing.T, ps []service.MistakePattern, source string) service.MistakePattern {
		t.Helper()
		for _, p := range ps {
			if p.PatternSource == source {
				return p
			}
		}
		t.Fatalf("no pattern with patternSource=%q in %+v", source, ps)
		return service.MistakePattern{}
	}

	// ── Student endpoint (buildStudentMistakePatterns) ──────────────────────
	svc := service.NewAnalyticsService(db, clock.RealClock{})
	ownerTC := model.TenantContext{CenterID: TenantAID, UserID: UUIDString(owner.ID), Role: "owner", EmailVerified: true}
	sp, err := svc.GetStudentPerformance(context.Background(), ownerTC, sID)
	if err != nil {
		t.Fatalf("GetStudentPerformance: %v", err)
	}
	assertPopulated(t, "student", findBySource(t, sp.MistakePatterns.Patterns, "auto_graded"),
		findBySource(t, sp.MistakePatterns.Patterns, "human_comment"))

	// ── Class endpoint (buildMistakePatterns) — same population, D12 symmetry ─
	cp := anClassPerf(t, db, tID, class, "teacher")
	assertPopulated(t, "class", findBySource(t, cp.MistakePatterns.Patterns, "auto_graded"),
		findBySource(t, cp.MistakePatterns.Patterns, "human_comment"))
}

// assertPopulated pins AC21 on ONE endpoint's auto_graded + human_comment patterns.
// The field references below are the RED seam (compile-fail until D-COFINAL lands).
func assertPopulated(t *testing.T, endpoint string, auto, human service.MistakePattern) {
	t.Helper()
	// auto_graded: questionType carried, criterion emptied, no exemplar quote.
	if auto.QuestionType == "" {
		t.Errorf("[%s] auto_graded QuestionType empty — must carry the question type", endpoint)
	}
	if auto.Criterion != "" {
		t.Errorf("[%s] auto_graded Criterion=%q — must be \"\" (Winston #2)", endpoint, auto.Criterion)
	}
	if auto.ExampleQuote != nil {
		t.Errorf("[%s] auto_graded ExampleQuote non-nil — must be nil (quote-less)", endpoint)
	}
	// human_comment: criterion carried, questionType empty, an exemplar quote mined.
	if human.Criterion == "" {
		t.Errorf("[%s] human_comment Criterion empty — must carry the IELTS criterion", endpoint)
	}
	if human.QuestionType != "" {
		t.Errorf("[%s] human_comment QuestionType=%q — must be \"\"", endpoint, human.QuestionType)
	}
	if human.ExampleQuote == nil || *human.ExampleQuote == "" {
		t.Errorf("[%s] human_comment ExampleQuote nil/empty — must mine one exemplar comment body", endpoint)
	}
}
