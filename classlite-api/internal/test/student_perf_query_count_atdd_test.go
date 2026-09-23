// student_perf_query_count_atdd_test.go — Story 8-3a ATDD (green)
// (AC19/AC20 · risk=8 · R-3/R31/PERF-2 · WF-8 HARD GATE). REUSES the 8-1a keystone
// CountingDBTX (counting boundary = the SERVICE tx, NOT the pool) to pin that BOTH
// student endpoints are O(1)-in-rows across the COMBINED per-skill × per-week ×
// mistake-union fan-out.
//
// SIZE-INVARIANCE (Murat C3): "≤N on a small fixture" is meaningless — a saturated
// small fixture hides a per-skill or per-week N+1. The property is count(small) ==
// count(large) <= maxAnalyticsStudentQueries, per endpoint. small = 1 skill / 2
// grades / 1 populated week; large = 4 skills / 40 grades / 12 GAPPED weeks (the gap
// is load-bearing — a densify-by-query scales with populated weeks, so a gapped-12
// fixture catches it where a dense one might not).
//
// FOUR synthetic-N+1 probes (Murat): the four fan-out axes — per-skill band loop,
// per-week densify, comments unnest, answer_errors unnest. Each proves the counter
// catches a fan-out of that magnitude; a counter that under-counts (wrong boundary)
// lets a real N+1 on any axis slip through every ≤N assertion in this file.
//
// RED: real `//go:build atdd_red_phase`. NewCountingDBTX + anTestNow/weeksAgo/
// seedGradeAt/setCenterTZUTC are SHIPPED. Under `-tags=atdd_red_phase` compile-fails
// ONLY on the greenfield SERVICE seams (dev — Task 5):
//
//	internal/service/analytics_service.go:
//	  func (s *AnalyticsService) GetStudentPerformance(ctx, tc model.TenantContext, studentID uuid.UUID) (*StudentPerformance, error)
//	  func (s *AnalyticsService) GetMyPerformance(ctx, tc model.TenantContext) (*StudentPerformance, error)
//
// Evidence artifact (dev, green): evidence/analytics-query-count.json — the itemized
// per-endpoint budget, e.g. GetStudentForAnalytics + ListStudentBandProgression +
// ListStudentSkillBreakdown + ListClassCohortSkillAvg + GetStudentSubmissionStats +
// ListStudentMistakePatterns (single UNION ALL) = 6.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// maxAnalyticsStudentQueries is the per-invocation SET-BASED sqlc ceiling for BOTH
// student endpoints (N = the composed query set; SET LOCAL is filtered by
// CountingDBTX). TIGHT — the dev tunes it to the exact CQ-named set in green and
// records the itemized budget in evidence/analytics-query-count.json.
const maxAnalyticsStudentQueries = 6

// spSeedEnrolledStudent creates a student, enrolls them active in `class`, returns id.
func spSeedEnrolledStudent(t *testing.T, db *TxDB, cid, class uuid.UUID, centerPG pgtype.UUID, email string) uuid.UUID {
	t.Helper()
	u := CreateUser(t, db, email, "QC Student")
	CreateCenterMember(t, db, u.ID, centerPG, "student")
	sid := uuidFromPg(u.ID)
	insertEnrollmentRaw(t, db, cid, sid, class, "active")
	return sid
}

// spSeedStudentGrades seeds `gradesPerSkill` released grades per skill, distributed
// across the given week indices (weeksAgo relative to anTestNow — the MockClock now).
func spSeedStudentGrades(t *testing.T, db *TxDB, cid, class, student, author uuid.UUID, skills []string, gradesPerSkill int, weekIdx []int) {
	t.Helper()
	for _, skill := range skills {
		for i := 0; i < gradesPerSkill; i++ {
			rel := weeksAgo(weekIdx[i%len(weekIdx)])
			seedGradeAt(t, db, cid, class, student, author, skill, 6.0, "{}", "[]",
				rel.Add(-24*time.Hour), rel.Add(-2*time.Hour), rel)
		}
	}
}

func spCountGetStudent(t *testing.T, svc *service.AnalyticsService, counter *CountingDBTX, tc model.TenantContext, studentID uuid.UUID) int {
	t.Helper()
	counter.Reset()
	if _, err := svc.GetStudentPerformance(context.Background(), tc, studentID); err != nil {
		t.Fatalf("GetStudentPerformance(%s): %v", studentID, err)
	}
	return counter.Count()
}

func spCountGetMe(t *testing.T, svc *service.AnalyticsService, counter *CountingDBTX, tc model.TenantContext) int {
	t.Helper()
	counter.Reset()
	if _, err := svc.GetMyPerformance(context.Background(), tc); err != nil {
		t.Fatalf("GetMyPerformance(%s): %v", tc.UserID, err)
	}
	return counter.Count()
}

// ── AC19 — BOTH endpoints are SIZE-INVARIANT across the combined fan-out ──

func TestStudentPerf_QueryCount_SizeInvariant_BothEndpoints_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)
	setCenterTZUTC(t, db, cid)

	teacher := CreateUser(t, db, "t@qc.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	owner := CreateUser(t, db, "owner@qc.test", "Owner")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	// small = 1 skill / 2 grades / 1 populated week.
	studentSmall := spSeedEnrolledStudent(t, db, cid, class, center.ID, "small@qc.test")
	spSeedStudentGrades(t, db, cid, class, studentSmall, tID, []string{"writing"}, 2, []int{0})
	// large = 4 skills / 40 grades / 12 GAPPED weeks.
	studentLarge := spSeedEnrolledStudent(t, db, cid, class, center.ID, "large@qc.test")
	spSeedStudentGrades(t, db, cid, class, studentLarge, tID,
		[]string{"writing", "speaking", "reading", "listening"}, 10, []int{0, 1, 3, 5, 7, 9, 11})

	counter := NewCountingDBTX(db)                                             // SHIPPED (8-1a)
	svc := service.NewAnalyticsService(counter, clock.NewMockClock(anTestNow)) // SEAM methods

	// /students/{id} — owner caller.
	ownerTC := model.TenantContext{CenterID: TenantAID, UserID: UUIDString(owner.ID), Role: "owner", EmailVerified: true}
	smallS := spCountGetStudent(t, svc, counter, ownerTC, studentSmall)
	largeS := spCountGetStudent(t, svc, counter, ownerTC, studentLarge)
	assertSizeInvariant(t, "GetStudentPerformance", smallS, largeS)

	// /me — student self caller.
	smallMeTC := model.TenantContext{CenterID: TenantAID, UserID: studentSmall.String(), Role: "student", EmailVerified: true}
	largeMeTC := model.TenantContext{CenterID: TenantAID, UserID: studentLarge.String(), Role: "student", EmailVerified: true}
	smallMe := spCountGetMe(t, svc, counter, smallMeTC)
	largeMe := spCountGetMe(t, svc, counter, largeMeTC)
	assertSizeInvariant(t, "GetMyPerformance", smallMe, largeMe)
}

func assertSizeInvariant(t *testing.T, name string, small, large int) {
	t.Helper()
	if small == 0 {
		t.Fatalf("AC19 harness NO-OP: %s counted 0 business queries — the counter wraps the wrong boundary "+
			"(must decorate the tx the service's Begin returns, NOT the pool)", name)
	}
	if small != large {
		t.Errorf("AC19 N+1: %s query count is NOT size-invariant — %d (small) vs %d (large: 4 skills/40 grades/12 gapped weeks); "+
			"a per-skill / per-week / per-grade fan-out crept in (PERF-2)", name, small, large)
	}
	if large > maxAnalyticsStudentQueries {
		t.Errorf("AC19 ≤N BREACH: %s ran %d business queries, want ≤ %d (SET LOCAL filtered; the union is a single UNION ALL)",
			name, large, maxAnalyticsStudentQueries)
	}
}

// ── AC20 — PROVE the counter catches a synthetic N+1 on EACH of the four fan-out axes ──

func TestStudentPerf_QueryCount_DetectsSyntheticNPlus1_ATDD(t *testing.T) {
	axes := []struct {
		name string
		rows int
	}{
		{"per_skill_band_loop", maxAnalyticsStudentQueries + 6},
		{"per_week_densify", maxAnalyticsStudentQueries + 6},
		{"comments_unnest", maxAnalyticsStudentQueries + 6},
		{"answer_errors_unnest", maxAnalyticsStudentQueries + 6},
	}
	for _, a := range axes {
		t.Run(a.name, func(t *testing.T) {
			db := SetupDB(t)
			center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			_ = TenantContext(t, db, center.ID)

			counter := NewCountingDBTX(db)
			ctx := context.Background()
			tx, err := counter.Begin(ctx)
			if err != nil {
				t.Fatalf("counting begin: %v", err)
			}
			counter.Reset()

			var one int
			for i := 0; i < a.rows; i++ {
				if err := tx.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
					t.Fatalf("synthetic query %d: %v", i, err)
				}
			}
			if counter.Count() <= maxAnalyticsStudentQueries {
				t.Errorf("AC20 harness is a NO-OP for the %s axis: a synthetic %d-query N+1 counted only %d "+
					"(≤ ceiling %d) — the counting boundary is wrong; a real fan-out on this axis would false-pass",
					a.name, a.rows, counter.Count(), maxAnalyticsStudentQueries)
			}
		})
	}
}

var _ = uuid.UUID{} // keep the import stable across green-phase edits
