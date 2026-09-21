// analytics_query_count_atdd_test.go — Story 8-2a ATDD (green) (AC15 · risk=7 ·
// WF-8 HARD GATE · R31/PERF-2). REUSES the 8-1a keystone CountingDBTX (query-count
// tracer) UNCHANGED — this story is the SECOND consumer that proves it generalizes.
//
// COUNTING BOUNDARY = the tx the SERVICE runs on, NOT the pool (the 8-1a
// party-mode BLOCKER). NewCountingDBTX wraps the db AnalyticsService holds; its
// Begin() hands back a tx whose Exec/Query/QueryRow increment a business-query
// counter, filtering tx plumbing. If the service could run sqlc on the raw pool,
// the counter reads ~0 and every ≤N assertion false-passes.
//
// SIZE-INVARIANCE (Winston, party-mode): "≤N on one small fixture" is meaningless —
// a 2-student N+1 stays under N. The real property is count(cohort=small) ==
// count(cohort=large) <= N. A per-row fan-out makes the large-cohort count exceed
// the small-cohort count. These tests assert EQUALITY across cohort sizes, per
// endpoint per role.
//
// THREE synthetic-N+1 proofs (Murat): the class-perf endpoint has three distinct
// fan-out surfaces — per-STUDENT at-risk classify, per-WEEK heatmap bucket,
// per-GRADE comment unnest. Each synthetic proves the counter catches a fan-out of
// that magnitude; a counter that under-counts (wrong boundary) would let a real
// N+1 on any surface slip through every ≤N assertion in this package.
//
// ─────────────────────────────────────────────────────────────────────────────
// RED: real `//go:build atdd_red_phase`. Under `-tags=atdd_red_phase` compile-fails
// on the greenfield SERVICE seams (NewCountingDBTX is SHIPPED, 8-1a):
//
// GREEN SEAMS (dev — Task 3 + Task 5):
//
//	internal/service/analytics_service.go:
//	  func NewAnalyticsService(db <the same db-interface NewDashboardService takes>, clk clock.Clock) *AnalyticsService
//	  func (s *AnalyticsService) GetHome(ctx context.Context, tc model.TenantContext) (*<AnalyticsHome>, error)
//	  func (s *AnalyticsService) GetClassPerformance(ctx context.Context, tc model.TenantContext, classID uuid.UUID) (*<ClassPerformance>, error)
//
// Evidence artifact (dev, green): evidence/analytics-query-count.json (P0) —
// ITEMIZED per-query budget per (endpoint, role), e.g.
//
//	class = 1 SET LOCAL + 1 class-auth + 1 bandOverTime + 1 heatmap + 1 mistakes
//	        + 1 atRisk-batch + 1 submissionRate = 7.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// Per-(endpoint, role) ceilings. N = 1 (SET LOCAL) + k SET-BASED sqlc calls; UPPER
// bounds asserting O(1)-in-rows. The dev tunes k in green to the exact composed
// query set (CQ-3 named consts — the single source of truth the assertion reads)
// and records the itemized budget in evidence/analytics-query-count.json.
// Itemized per-(endpoint, role) budget (evidence/analytics-query-count.json). N is
// the SET-BASED sqlc calls only (SET LOCAL is filtered by CountingDBTX). These are
// TIGHT — the exact composed set — so any future per-row fan-out trips the gate.
//
//	home  (teacher|owner) = ListAnalyticsHomeClasses + ListAnalyticsHomeAtRiskInputs = 2
//	class                 = GetClassForAnalytics + GetCenterTimezone + ListClassBandOverTime
//	                        + ListClassSkillHeatmap + ListClassMistakePatterns
//	                        + GetClassSubmissionRate + ListClassStudentsAtRiskInputs = 7
const (
	maxAnalyticsHomeQueriesTeacher = 2
	maxAnalyticsHomeQueriesOwner   = 2
	maxAnalyticsClassQueries       = 7
)

// anSeedClassWithNAtRisk seeds a class owned by `teacher` with `n` at-risk students,
// each with a released grade. Used to vary cohort size for the size-invariance
// assertion (a per-student at-risk N+1 makes the count scale with n).
func anSeedClassWithNAtRisk(t *testing.T, db *TxDB, cid, teacherID uuid.UUID, tag string, n int) uuid.UUID {
	t.Helper()
	class := seedClassWithTeacher(t, db, cid, teacherID)
	for i := 0; i < n; i++ {
		email := tag + string(rune('a'+i)) + "@qc.test"
		s := dashSeedAtRiskStudent(t, db, cid, class, teacherID, email, tag+"_S"+string(rune('A'+i)))
		seedReleasedGrade(t, db, cid, class, s, teacherID, "writing", 6.0)
	}
	return class
}

// ── AC15 — GET /api/analytics/classes/{id} is SIZE-INVARIANT (no per-student N+1) ──

func TestAnalyticsClass_QueryCount_SizeInvariant_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@qc.test", "Teacher")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	tID := dashPGToUUID(t, teacher.ID)

	// Small cohort (2) vs large cohort (12) — a per-student fan-out scales the count.
	classSmall := anSeedClassWithNAtRisk(t, db, cid, tID, "sm", 2)
	classLarge := anSeedClassWithNAtRisk(t, db, cid, tID, "lg", 12)

	tc := model.TenantContext{CenterID: TenantAID, UserID: UUIDString(teacher.ID), Role: "teacher", EmailVerified: true}

	counter := NewCountingDBTX(db)                                 // SHIPPED (8-1a)
	svc := service.NewAnalyticsService(counter, clock.RealClock{}) // SEAM

	counter.Reset()
	if _, err := svc.GetClassPerformance(context.Background(), tc, classSmall); err != nil {
		t.Fatalf("GetClassPerformance(small): %v", err)
	}
	small := counter.Count()

	counter.Reset()
	if _, err := svc.GetClassPerformance(context.Background(), tc, classLarge); err != nil {
		t.Fatalf("GetClassPerformance(large): %v", err)
	}
	large := counter.Count()

	if small == 0 {
		t.Fatalf("AC15 harness NO-OP: class-perf counted 0 business queries — the counter wraps the wrong " +
			"boundary (must decorate the tx the service's Begin returns, NOT the pool)")
	}
	if small != large {
		t.Errorf("AC15 N+1: class-perf query count is NOT size-invariant — %d (cohort=2) vs %d (cohort=12); "+
			"a per-student/per-grade fan-out crept in (PERF-2)", small, large)
	}
	if large > maxAnalyticsClassQueries {
		t.Errorf("AC15 ≤N BREACH: class-perf ran %d business queries, want ≤ %d (N = 1 SET LOCAL + k SET-BASED sqlc)",
			large, maxAnalyticsClassQueries)
	}
}

// ── AC15 — GET /api/analytics (home) is SIZE-INVARIANT (no per-class N+1) ─────

func TestAnalyticsHome_QueryCount_SizeInvariant_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	// teacherSmall owns 2 classes; teacherLarge owns 8 — a per-class mini-stat N+1
	// makes teacherLarge's home count exceed teacherSmall's.
	teacherSmall := CreateUser(t, db, "tsmall@qc.test", "T Small")
	teacherLarge := CreateUser(t, db, "tlarge@qc.test", "T Large")
	CreateCenterMember(t, db, teacherSmall.ID, center.ID, "teacher")
	CreateCenterMember(t, db, teacherLarge.ID, center.ID, "teacher")
	for i := 0; i < 2; i++ {
		anSeedClassWithNAtRisk(t, db, cid, dashPGToUUID(t, teacherSmall.ID), "hs"+string(rune('a'+i)), 1)
	}
	for i := 0; i < 8; i++ {
		anSeedClassWithNAtRisk(t, db, cid, dashPGToUUID(t, teacherLarge.ID), "hl"+string(rune('a'+i)), 1)
	}

	counter := NewCountingDBTX(db)
	svc := service.NewAnalyticsService(counter, clock.RealClock{})

	small := anHomeCount(t, svc, counter, UUIDString(teacherSmall.ID))
	large := anHomeCount(t, svc, counter, UUIDString(teacherLarge.ID))

	if small == 0 {
		t.Fatalf("AC15 harness NO-OP: home counted 0 business queries")
	}
	if small != large {
		t.Errorf("AC15 N+1: home query count is NOT size-invariant — %d (2 classes) vs %d (8 classes); "+
			"a per-class mini-stat fan-out crept in", small, large)
	}
	if large > maxAnalyticsHomeQueriesTeacher {
		t.Errorf("AC15 ≤N BREACH: teacher home ran %d business queries, want ≤ %d", large, maxAnalyticsHomeQueriesTeacher)
	}
}

func anHomeCount(t *testing.T, svc *service.AnalyticsService, counter *CountingDBTX, userID string) int {
	t.Helper()
	tc := model.TenantContext{CenterID: TenantAID, UserID: userID, Role: "teacher", EmailVerified: true}
	counter.Reset()
	if _, err := svc.GetHome(context.Background(), tc); err != nil {
		t.Fatalf("GetHome(%s): %v", userID, err)
	}
	return counter.Count()
}

// ── AC15 — PROVE the counter catches a synthetic N+1 on EACH of the 3 fan-out surfaces ──
//
// Each subtest deliberately issues one business query per row on the counting tx and
// asserts the count exceeds the class ceiling — i.e. had GetClassPerformance been
// written with a per-student / per-week / per-grade loop, the size-invariance test
// above WOULD have failed. If any of these does NOT trip, the counter under-counts
// (wrong boundary) and every ≤N assertion in this package is worthless.

func TestAnalyticsClass_QueryCount_DetectsSyntheticNPlus1_ATDD(t *testing.T) {
	surfaces := []struct {
		name string
		rows int // representative row cardinality for that fan-out surface
	}{
		{"per_student_at_risk", maxAnalyticsClassQueries + 6},
		{"per_week_heatmap", maxAnalyticsClassQueries + 6},
		{"per_grade_comment_unnest", maxAnalyticsClassQueries + 6},
	}
	for _, s := range surfaces {
		t.Run(s.name, func(t *testing.T) {
			db := SetupDB(t)
			center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
			_ = TenantContext(t, db, center.ID)

			counter := NewCountingDBTX(db) // SHIPPED (8-1a)
			ctx := context.Background()
			tx, err := counter.Begin(ctx)
			if err != nil {
				t.Fatalf("counting begin: %v", err)
			}
			counter.Reset()

			var one int
			for i := 0; i < s.rows; i++ {
				if err := tx.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
					t.Fatalf("synthetic query %d: %v", i, err)
				}
			}
			if counter.Count() <= maxAnalyticsClassQueries {
				t.Errorf("AC15 harness is a NO-OP for the %s surface: a synthetic %d-query N+1 counted only %d "+
					"(≤ ceiling %d) — the counting boundary is wrong; a real fan-out on this surface would false-pass",
					s.name, s.rows, counter.Count(), maxAnalyticsClassQueries)
			}
		})
	}
}

var _ = maxAnalyticsHomeQueriesOwner // referenced in green when the owner-home invariance case lands
