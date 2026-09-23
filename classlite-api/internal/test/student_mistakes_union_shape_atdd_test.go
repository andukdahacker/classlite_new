// student_mistakes_union_shape_atdd_test.go — Story 8-3a ATDD (green)
// (AC11/AC12/AC13/AC14 · risk=8 · R-4 JSONB-shape crash · Murat B-2 · D12 symmetry ·
// WF-8 HARD GATE). The student mistake mining UNIONs two sources over ONE student's
// released grades: comments-derived (Writing/Speaking, patternSource "human_comment")
// + answer_errors-derived (Reading/Listening, patternSource "auto_graded", FU-8-2-A).
//
// THE R-4 TRAP (Murat B-2): jsonb_array_elements over a non-array 500s the whole
// endpoint. This seeds ONE student whose answer_errors span ALL FIVE shapes — SQL
// NULL, '[]', 'null'::jsonb, a JSON object, and an array with a missing questionType —
// alongside VALID reading/listening arrays and Writing/Speaking comment grades. The
// endpoint MUST return 200 (the `WHERE answer_errors IS NOT NULL AND jsonb_typeof(
// answer_errors)='array'` guard) and still surface the reading/listening patterns.
//
// THE D12 SYMMETRY: excludedSources is EMPTY on the student endpoint AND on the 8-2a
// class endpoint (both now union answer_errors) — no two-truths asymmetry. This drives
// the SHIPPED class endpoint (anClassPerf) directly and pins its excludedSources = [].
//
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// ONLY on NewStudentPerfTestServerForRole (student_perf_role_scope_atdd_test.go).
// spSeedObjectiveGrade (file 4) + spSeedWritingErrorGrade (file 2) + seedGradeAt +
// anClassPerf are shipped/local. The grades.answer_errors column is a runtime seam.
package test

import (
	"net/http"
	"testing"
	"time"
)

func TestStudentMistakes_UnionShape_GuardAndSymmetry_ATDD(t *testing.T) {
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

	owner := CreateUser(t, db, "owner@center-a.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	now := time.Now()
	day := func(n int) time.Time { return now.Add(-time.Duration(n) * 24 * time.Hour) }

	// VALID reading answer_errors ×4 (one (reading, gap_fill, error) pattern).
	validReading := `[{"questionRef":"qr","questionType":"gap_fill"}]`
	for i := 0; i < 4; i++ {
		spSeedObjectiveGrade(t, db, cid, class, sID, tID, "reading", day(i+1), &validReading)
	}
	// VALID listening answer_errors ×3.
	validListening := `[{"questionRef":"ql","questionType":"matching"}]`
	for i := 0; i < 3; i++ {
		spSeedObjectiveGrade(t, db, cid, class, sID, tID, "listening", day(i+6), &validListening)
	}

	// The FIVE adversarial answer_errors shapes on the SAME student (R-4/B-2) — the
	// guarded UNION must tolerate every one without erroring.
	emptyArr := `[]`
	jsonNull := `null`
	jsonObject := `{"questionRef":"qx","questionType":"gap_fill"}`
	missingType := `[{"questionRef":"qm"}]`
	spSeedObjectiveGrade(t, db, cid, class, sID, tID, "reading", day(10), nil)            // SQL NULL
	spSeedObjectiveGrade(t, db, cid, class, sID, tID, "reading", day(11), &emptyArr)      // '[]'
	spSeedObjectiveGrade(t, db, cid, class, sID, tID, "reading", day(12), &jsonNull)      // 'null'::jsonb
	spSeedObjectiveGrade(t, db, cid, class, sID, tID, "reading", day(13), &jsonObject)    // JSON object (non-array)
	spSeedObjectiveGrade(t, db, cid, class, sID, tID, "listening", day(14), &missingType) // array w/ missing questionType

	// Writing/Speaking comment grades → the human_comment source.
	spSeedWritingErrorGrade(t, db, cid, class, sID, tID, "grammaticalRange", 4, day(4))
	seedGradeAt(t, db, cid, class, sID, tID, "speaking", 6.0, "{}",
		`[{"type":"error","criterion":"pronunciation","timestampMs":1000,"text":"x"},{"type":"error","criterion":"pronunciation","timestampMs":2000,"text":"y"},{"type":"error","criterion":"pronunciation","timestampMs":3000,"text":"z"}]`,
		day(6), day(5), day(5))

	// ── The student endpoint MUST NOT 500 on the malformed shapes (R-4 guard) ──
	srv := NewStudentPerfTestServerForRole(t, db, owner.ID, TenantAID, "owner")
	rec, resp := spGetStudent(t, srv, sID.String())
	if rec.Code != http.StatusOK {
		t.Fatalf("AC13/R-4: /students/{id} must be 200 despite non-array answer_errors (the jsonb_typeof='array' guard), got %d (body=%s)",
			rec.Code, rec.Body.String())
	}

	// AC12/AC13 — reading (auto_graded) surfaces from the valid arrays.
	if !spHasPattern(resp.MistakePatterns.Patterns, "reading", "auto_graded") {
		t.Errorf("AC12: a reading/auto_graded pattern must be mined from answer_errors (valid arrays present)")
	}
	// AC11 — Writing (human_comment) surfaces from comments.
	if !spHasPatternSource(resp.MistakePatterns.Patterns, "human_comment") {
		t.Errorf("AC11: a human_comment pattern must be mined from Writing/Speaking comments")
	}
	// AC12/D7 — patternSource is correct per skill family for EVERY pattern.
	for _, p := range resp.MistakePatterns.Patterns {
		switch p.SkillSource {
		case "reading", "listening":
			if p.PatternSource != "auto_graded" {
				t.Errorf("AC12/D7: %s pattern patternSource = %q, want auto_graded", p.SkillSource, p.PatternSource)
			}
		case "writing", "speaking":
			if p.PatternSource != "human_comment" {
				t.Errorf("AC11/D7: %s pattern patternSource = %q, want human_comment", p.SkillSource, p.PatternSource)
			}
		default:
			t.Errorf("D7: unexpected skillSource %q (enum = writing|speaking|reading|listening)", p.SkillSource)
		}
	}

	// AC14 / D12 — excludedSources EMPTY on the student endpoint.
	if len(resp.MistakePatterns.ExcludedSources) != 0 {
		t.Errorf("AC14/D12: student endpoint excludedSources must be [] (auto_graded is now mined), got %v",
			resp.MistakePatterns.ExcludedSources)
	}

	// AC14 / D12 — and EMPTY on the SHIPPED 8-2a class endpoint too (symmetry pin).
	cp := anClassPerf(t, db, tID, class, "teacher")
	if len(cp.MistakePatterns.ExcludedSources) != 0 {
		t.Errorf("AC14/D12: class endpoint excludedSources must be [] (was [\"auto_graded\"]) — both Mistakes surfaces symmetric, got %v",
			cp.MistakePatterns.ExcludedSources)
	}
}

func spHasPattern(ps []spMistakePattern, skillSource, patternSource string) bool {
	for _, p := range ps {
		if p.SkillSource == skillSource && p.PatternSource == patternSource {
			return true
		}
	}
	return false
}

func spHasPatternSource(ps []spMistakePattern, patternSource string) bool {
	for _, p := range ps {
		if p.PatternSource == patternSource {
			return true
		}
	}
	return false
}
