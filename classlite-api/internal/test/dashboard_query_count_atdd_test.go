// dashboard_query_count_atdd_test.go — Story 8-1a ATDD red-phase (AC13 · D7(1) ·
// risk=7 · WF-8 HARD GATE). The R31/PERF-2 KEYSTONE query-count harness — the
// reusable infra Stories 8.2 & 8.4 inherit (test-design-architecture R31 item #5:
// "a hook used in EVERY service-layer test").
//
// COUNTING BOUNDARY = the tx the SERVICE runs on, NOT the pool (party-mode
// BLOCKER, Winston+Murat). The service does `tx,_ := s.db.Begin(ctx); q := generated.New(tx)`
// (student_service.go:240) — every dashboard query runs on that tx. A decorator
// wrapping only SetupRawPool / TxDB.Exec sees ZERO business queries (TxDB.Begin
// returns the raw nested pgx.Tx) → counter ≈ 0 → "≤N" FALSE-PASSES. The sound
// route (chosen: DBTX decorator, savepoint-safe): NewCountingDBTX wraps the db the
// service holds; its Begin() hands back a tx whose Exec/Query/QueryRow increment a
// business-query counter, FILTERING tx plumbing (BEGIN/SAVEPOINT/SET LOCAL/
// RELEASE/COMMIT). N is documented as `1 (the SET LOCAL app.current_tenant_id
// Exec) + k sqlc calls`; sqlc pgx-v5 emits exactly one Exec/Query/QueryRow per
// generated method (no implicit batching) → "≤N" is a stable, meaningful bound
// that proves O(1)-in-rows, not O(rows).
//
// ─────────────────────────────────────────────────────────────────────────────
// RED: real `//go:build atdd_red_phase`. Excluded from `go test ./...`. Under
// `-tags=atdd_red_phase` compile-fails on the THREE documented greenfield seams:
//
// GREEN SEAMS (dev — Task 5 + Task 3):
//
//	internal/test/query_counter.go  (the reusable keystone — 8.2/8.4 import it):
//	  type CountingDBTX struct { ... }
//	  func NewCountingDBTX(inner <the db-interface DashboardService takes>) *CountingDBTX
//	     — `inner` is whatever *TxDB / *pgxpool.Pool satisfy AND NewDashboardService
//	       accepts; the counter must satisfy the SAME interface so it can stand in.
//	  func (c *CountingDBTX) Begin(ctx) (pgx.Tx, error)
//	     — returns a pgx.Tx wrapper; each Exec/Query/QueryRow on it increments the
//	       counter UNLESS the SQL is tx plumbing (BEGIN/SAVEPOINT/SET LOCAL/RELEASE/
//	       COMMIT/ROLLBACK) — filter by prefix, or bake the +1 SET LOCAL offset.
//	  func (c *CountingDBTX) Count() int   // business queries since last Reset
//	  func (c *CountingDBTX) Reset()
//
//	internal/service/dashboard_service.go:
//	  func NewDashboardService(db <interface>, clk clock.Clock) *DashboardService
//	  func (s *DashboardService) GetDashboard(ctx context.Context, tc model.TenantContext) (*<DashboardData>, error)
//
// Evidence artifact (dev, green): evidence/query-count.json (P0, per D7).
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// Per-role query ceilings. N = 1 (SET LOCAL) + k sqlc calls. These are UPPER
// bounds asserting O(1)-in-rows; the dev tunes k to the exact composed query set
// in green (CQ-3 named consts — the single source of truth the assertion reads).
//
// 8-1b D13 co-finalize added gap-field queries — every addition is a SET-BASED
// batch (O(1)-in-rows), NOT an N+1:
//
//	teacher 8→9: +ListClassNamesByIDs (question-rail className) +ListAtRiskPendingCounts (measured 9).
//	owner unchanged at 13: +ListAtRiskPendingCounts +CountOverCapacityClasses
//	  +ListOverCapacityClasses lifted measured 9→12, still within the existing ceiling.
//	student unchanged at 8: due-item classId/className folded into the existing
//	  ListStudentDueSoon join (0 extra queries; measured 5).
const (
	maxDashboardQueriesTeacher = 9
	maxDashboardQueriesOwner   = 13
	maxDashboardQueriesStudent = 8
)

// dashSeedFullCenter seeds one center with a teacher, an owner, a student, a
// class, an active enrollment, an at-risk student, a needs-grading submission, an
// open question and a released grade — enough that every role branch does real
// aggregation. Returns the ids each role's tc needs. Tenant context is set here.
type dashSeededCenter struct {
	centerID  string // TenantAID (string, for model.TenantContext)
	teacherID string
	ownerID   string
	studentID string
}

func dashSeedFullCenter(t *testing.T, db *TxDB) dashSeededCenter {
	t.Helper()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)
	cid := dashPGToUUID(t, center.ID)

	teacher := CreateUser(t, db, "t@qc.test", "Teacher")
	owner := CreateUser(t, db, "o@qc.test", "Owner")
	student := CreateUser(t, db, "s@qc.test", "Student")
	CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")
	CreateCenterMember(t, db, owner.ID, center.ID, "owner")
	CreateCenterMember(t, db, student.ID, center.ID, "student")

	tID := dashPGToUUID(t, teacher.ID)
	sID := dashPGToUUID(t, student.ID)
	class := seedClassWithTeacher(t, db, cid, tID)
	insertEnrollmentRaw(t, db, cid, sID, class, "active")
	seedReleasedGrade(t, db, cid, class, sID, tID, "writing", 6.0)
	dashSeedOpenQuestion(t, db, cid, class, sID, tID)
	dashSeedNeedsGrading(t, db, cid, class, tID, sID)
	// a couple of at-risk students so an N+1 impl would fan out per-student
	dashSeedAtRiskStudent(t, db, cid, class, tID, "ar1@qc.test", "AR_ONE")
	dashSeedAtRiskStudent(t, db, cid, class, tID, "ar2@qc.test", "AR_TWO")

	return dashSeededCenter{
		centerID:  TenantAID,
		teacherID: UUIDString(teacher.ID),
		ownerID:   UUIDString(owner.ID),
		studentID: UUIDString(student.ID),
	}
}

// ── AC13 — per-role ≤N query count (O(1) in rows) ──────────────────────────

func TestDashboard_QueryCount_PerRole_ATDD(t *testing.T) {
	db := SetupDB(t)
	seed := dashSeedFullCenter(t, db)

	cases := []struct {
		role   string
		userID string
		max    int
	}{
		{"teacher", seed.teacherID, maxDashboardQueriesTeacher},
		{"owner", seed.ownerID, maxDashboardQueriesOwner},
		{"student", seed.studentID, maxDashboardQueriesStudent},
	}

	for _, c := range cases {
		t.Run(c.role, func(t *testing.T) {
			// SEAM: NewCountingDBTX wraps the db the service runs on.
			counter := NewCountingDBTX(db)
			// SEAM: NewDashboardService accepts the counter (same db-interface).
			svc := service.NewDashboardService(counter, clock.RealClock{})

			tc := model.TenantContext{
				CenterID:      seed.centerID,
				UserID:        c.userID,
				Role:          c.role,
				EmailVerified: true,
			}

			counter.Reset()
			// SEAM: GetDashboard runs all the role's reads on ONE tx (D9/PERF-1).
			if _, err := svc.GetDashboard(context.Background(), tc); err != nil {
				t.Fatalf("%s: GetDashboard: %v", c.role, err)
			}
			got := counter.Count()
			if got > c.max {
				t.Errorf("AC13 ≤N BREACH: %s dashboard ran %d business queries, want ≤ %d "+
					"(N = 1 SET LOCAL + k sqlc; a per-row fan-out means an N+1 crept in — PERF-2)",
					c.role, got, c.max)
			}
			if got == 0 {
				t.Errorf("AC13 harness NO-OP: %s counted 0 business queries — the counter is wrapping "+
					"the wrong boundary (must decorate the tx the service's Begin returns, NOT the pool/TxDB.Exec)",
					c.role)
			}
		})
	}
}

// ── AC13 — PROVE the counter is not a no-op: it must catch a synthetic N+1 ──
//
// The story requires the harness be "PROVEN to fail on a synthetic N+1". Here we
// deliberately issue one business query per row on the counting tx and assert the
// count exceeds the teacher ceiling — i.e. had GetDashboard been written with a
// per-student loop, TestDashboard_QueryCount_PerRole_ATDD above WOULD have failed.
// If this assertion does NOT trip, the counter under-counts (wrong boundary) and
// every ≤N assertion in this package is worthless.

func TestDashboard_QueryCount_DetectsSyntheticNPlus1_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)

	counter := NewCountingDBTX(db) // SEAM
	ctx := context.Background()
	tx, err := counter.Begin(ctx)
	if err != nil {
		t.Fatalf("counting begin: %v", err)
	}
	counter.Reset()

	const syntheticRows = maxDashboardQueriesTeacher + 5 // guaranteed to exceed the ceiling
	var one int
	for i := 0; i < syntheticRows; i++ {
		if err := tx.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
			t.Fatalf("synthetic query %d: %v", i, err)
		}
	}
	if counter.Count() <= maxDashboardQueriesTeacher {
		t.Errorf("AC13 harness is a NO-OP: a synthetic %d-query N+1 counted only %d "+
			"(≤ ceiling %d) — the counting boundary is wrong (it must count each Query on the "+
			"service's tx, D7(1)); every ≤N assertion would false-pass",
			syntheticRows, counter.Count(), maxDashboardQueriesTeacher)
	}
}
