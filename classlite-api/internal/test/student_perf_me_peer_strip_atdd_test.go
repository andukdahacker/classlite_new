// student_perf_me_peer_strip_atdd_test.go — Story 8-3a ATDD (green)
// (AC5/AC7 · risk=8 · R-1/FR-50 · Murat B-1 fix · WF-8 HARD GATE). The FR-50
// peer-strip is a DATA guarantee (not a UI concern): the teacher /students/{id}
// view carries the per-skill cohort `classAvgBand` (D11) + `mistakePatterns[]
// .affectedStudentCount`; `/me` STRIPS BOTH in the service.
//
// WHY POSITIVE-CONTROL-PAIRED (Murat B-1): before D11 the minted contract had no
// peer field, so "strip peer data" was a vacuous test a byte-identical payload
// passed green. This test seeds a class WITH a cohort so both peer fields are
// PRESENT/non-null on the teacher view, then asserts they are ABSENT on `/me` for
// the SAME student — present⇄absent is the real assertion. PLUS a structural
// key-scan over the raw `/me` body kills any `average|cohort|peer`-shaped key that
// a lazy impl leaves behind (belt-and-suspenders for a "present-but-null" strip).
//
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// ONLY on NewStudentPerfTestServerForRole (→ analyticsHandler.GetStudent/.Me,
// student_perf_role_scope_atdd_test.go). All sp* structs/helpers + seed helpers
// (seedGradeAt/seedClassWithTeacher/seedReleasedGrade) are shipped/local.
package test

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// spSeedWritingErrorGrade seeds ONE released Writing grade for `student` carrying
// `n` `type:"error"` comments on `criterion` — enough repeated instances to clear
// the mistake co-gate so a MistakePattern (hence affectedStudentCount) surfaces on
// the teacher view. releasedAt is kept recent (within the RealClock 12-week axis
// the HTTP server uses).
func spSeedWritingErrorGrade(t *testing.T, db *TxDB, cid, class, student, author uuid.UUID, criterion string, n int, releasedAt time.Time) {
	t.Helper()
	elems := make([]string, 0, n)
	for i := 0; i < n; i++ {
		elems = append(elems, `{"type":"error","criterion":"`+criterion+`","anchorStart":0,"anchorEnd":1,"text":"x"}`)
	}
	commentsJSON := "[" + strings.Join(elems, ",") + "]"
	seedGradeAt(t, db, cid, class, student, author, "writing", 6.0, "{}", commentsJSON,
		releasedAt.Add(-24*time.Hour), releasedAt.Add(-2*time.Hour), releasedAt)
}

// ── AC7 — classAvgBand + affectedStudentCount PRESENT on teacher, ABSENT on /me ──

func TestStudentPerf_MePeerStrip_PositiveControlPaired_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@center-a.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)

	// Subject student (self) + cohort peers — so the class HAS a Writing cohort avg.
	subject := dashSeedAtRiskStudent(t, db, cid, class, tID, "self@center-a.test", "Subject")
	peer1 := dashSeedAtRiskStudent(t, db, cid, class, tID, "p1@center-a.test", "Peer One")
	peer2 := dashSeedAtRiskStudent(t, db, cid, class, tID, "p2@center-a.test", "Peer Two")
	now := time.Now()
	// Subject: 4 same-criterion Writing errors → a real MistakePattern (co-gate clears).
	spSeedWritingErrorGrade(t, db, cid, class, subject, tID, "grammaticalRange", 4, now.Add(-3*24*time.Hour))
	// Cohort peers with released Writing grades → non-null classAvgBand for the skill.
	seedReleasedGrade(t, db, cid, class, peer1, tID, "writing", 7.0)
	seedReleasedGrade(t, db, cid, class, peer2, tID, "writing", 5.0)

	// Teacher view of the subject — peer fields PRESENT.
	srvT := NewStudentPerfTestServerForRole(t, db, teacher.ID, TenantAID, "teacher")
	recT, teacherView := spGetStudent(t, srvT, subject.String())
	if recT.Code != 200 {
		t.Fatalf("teacher /students/{id} must be 200, got %d (body=%s)", recT.Code, recT.Body.String())
	}
	if !spAnySkillHasClassAvg(teacherView.SkillBreakdown) {
		t.Errorf("AC7 positive control: teacher view must carry a non-null classAvgBand for the cohort'd Writing skill (D11) — else the strip test is vacuous")
	}
	if !spAnyPatternHasAffected(teacherView.MistakePatterns.Patterns) {
		t.Errorf("AC7 positive control: teacher view must carry a non-null mistakePatterns[].affectedStudentCount — else the strip test is vacuous")
	}

	// /me for the SAME student — peer fields STRIPPED (absent → nil).
	subjPG := pgtype.UUID{Bytes: subject, Valid: true}
	srvMe := NewStudentPerfTestServerForRole(t, db, subjPG, TenantAID, "student")
	recMe, meView := spGetMe(t, srvMe)
	if recMe.Code != 200 {
		t.Fatalf("student /me must be 200, got %d (body=%s)", recMe.Code, recMe.Body.String())
	}
	for _, sb := range meView.SkillBreakdown {
		if sb.ClassAvgBand != nil {
			t.Errorf("FR-50 LEAK: /me skillBreakdown[%s].classAvgBand must be ABSENT, got %v", sb.Skill, *sb.ClassAvgBand)
		}
	}
	for _, p := range meView.MistakePatterns.Patterns {
		if p.AffectedStudentCount != nil {
			t.Errorf("FR-50 LEAK: /me mistakePatterns[%s/%s].affectedStudentCount must be ABSENT, got %v",
				p.SkillSource, p.Criterion, *p.AffectedStudentCount)
		}
	}

	// Structural value-scan (belt-and-suspenders over the typed nil asserts above).
	// NOTE the peer KEYS are ALWAYS present on the wire — GO-5 forbids `omitempty`, so a
	// stripped *float64/*int marshals to `"classAvgBand": null`, not an absent key. A
	// key-absence scan is therefore both wrong (the key legitimately survives as null) and
	// prone to false positives on the student's own legitimate `avgBand` per-week band. The
	// real FR-50 guarantee is that the peer fields carry NO non-null value anywhere in the
	// /me body — so scan for a peer key followed by a numeric (non-null) value.
	peerLeak := regexp.MustCompile(`"(classAvgBand|affectedStudentCount)"\s*:\s*[0-9]`)
	if m := peerLeak.FindString(recMe.Body.String()); m != "" {
		t.Errorf("FR-50 LEAK: a peer field carried a non-null value on /me (matched %q) — the service must strip all class-average/peer data to null", m)
	}
}

func spAnySkillHasClassAvg(bd []spSkillBreakdown) bool {
	for _, sb := range bd {
		if sb.ClassAvgBand != nil {
			return true
		}
	}
	return false
}

func spAnyPatternHasAffected(ps []spMistakePattern) bool {
	for _, p := range ps {
		if p.AffectedStudentCount != nil {
			return true
		}
	}
	return false
}
