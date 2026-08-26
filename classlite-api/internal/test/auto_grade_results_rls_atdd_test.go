// Story 6.4a (AC8/AC9/AC10 · D2/D9 · R16=6) — the auto_grade_results WORKING table:
// the 4-policy FORCE-RLS grid (cross-tenant read AND write isolation, TEST-BE-1) +
// the repo's SECOND immutability trigger (auto_grade_results_immutable_after_release).
// Runs under SET LOCAL ROLE classlite_app (SetupDB) so FORCE RLS is actually enforced
// — a superuser bypasses it. Mirrors grades_rls_test.go (the RLS template + Murat
// re-read control) and submission_immutable_trigger_test.go (the P0001 twin).
//
// GREEN (de-tagged, runs in `go test ./...`): the reds landed build-tagged
// `atdd_red_phase` before in-progress (WF-8 gate); the auto_grade_results table + the D9
// trigger now exist (Task 2 migrations), so the tag was removed and this RLS + trigger
// suite is permanent regression coverage.
//
// SEAMS (dev, green — reconcile in Task 2 migrations):
//   - migration create_auto_grade_results: columns per AC8 — id, submission_id uuid
//       NOT NULL UNIQUE FK→submissions ON DELETE RESTRICT, center_id uuid NOT NULL
//       FK→centers, raw_score int, max_score int, percentage numeric, provisional_band
//       numeric(2,1), answers jsonb NOT NULL, created_at, updated_at; 4-policy FORCE
//       RLS grid on center_id (mirror grades). Plus partial index
//       idx_grades_submission_released ON grades(submission_id) WHERE released_at IS NOT NULL.
//   - migration add_auto_grade_results_immutable_trigger: BEFORE UPDATE, RAISE P0001
//       named 'auto_grade_results_immutable_after_release' when
//       EXISTS(SELECT 1 FROM grades WHERE submission_id=NEW.submission_id AND released_at IS NOT NULL).
package test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// rlsInsertAutoGradeResultAS inserts one working row under the CURRENT tenant context,
// matching the AC8 column contract.
func rlsInsertAutoGradeResultAS(t *testing.T, db *TxDB, centerID, submissionID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO auto_grade_results
		   (id, submission_id, center_id, raw_score, max_score, percentage, provisional_band, answers)
		 VALUES ($1, $2, $3, 1, 2, 50.0, 6.0, '[]'::jsonb)`,
		id, submissionID, centerID); err != nil {
		t.Fatalf("insert auto_grade_results: %v", err)
	}
	return id
}

// AC9 (TEST-BE-1) — cross-tenant READ isolation: tenant A cannot see tenant B's row.
func TestRLS_AutoGradeResults_CrossTenantRead_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))
	rlsInsertAutoGradeResultAS(t, db, uuid.UUID(centerB.ID.Bytes), submissionID)

	TenantContext(t, db, centerA.ID)
	var count int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM auto_grade_results`).Scan(&count); err != nil {
		t.Fatalf("count auto_grade_results: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: tenant A sees %d auto_grade_results from tenant B, want 0", count)
	}
}

// AC9 (TEST-BE-1) — cross-tenant WRITE isolation: a tenant-A INSERT spoofing tenant
// B's center_id must be rejected by the WITH CHECK policy.
func TestRLS_AutoGradeResults_CrossTenantInsertRejected_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))

	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(context.Background(),
		`INSERT INTO auto_grade_results
		   (id, submission_id, center_id, raw_score, max_score, percentage, provisional_band, answers)
		 VALUES ($1, $2, $3, 1, 2, 50.0, 6.0, '[]'::jsonb)`,
		uuid.New(), submissionID, uuid.UUID(centerB.ID.Bytes))
	AssertRLSViolation(t, err, "tenant A INSERT spoofing tenant B center_id on auto_grade_results")
}

// AC9 — cross-tenant WRITE isolation via UPDATE: a tenant-A UPDATE of tenant B's row
// affects 0 rows AND the re-read as B proves the value is unchanged (Murat house rule:
// 0 rows alone is not proof — an UPDATE hitting 0 rows is not an error in PostgreSQL).
func TestRLS_AutoGradeResults_CrossTenantUpdate_NoMutation_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerB.ID.Bytes))
	rowID := rlsInsertAutoGradeResultAS(t, db, uuid.UUID(centerB.ID.Bytes), submissionID)

	TenantContext(t, db, centerA.ID)
	if _, err := db.Exec(context.Background(),
		`UPDATE auto_grade_results SET raw_score = 99 WHERE id = $1`, rowID); err != nil {
		// RLS makes this a 0-row no-op (not an error); a privilege/policy error is also acceptable.
		t.Logf("cross-tenant UPDATE returned %v (0-row no-op expected)", err)
	}
	// Re-read as B: raw_score must be the seeded 1, not 99.
	TenantContext(t, db, centerB.ID)
	var rawScore int
	if err := db.QueryRow(context.Background(), `SELECT raw_score FROM auto_grade_results WHERE id=$1`, rowID).Scan(&rawScore); err != nil {
		t.Fatalf("re-read as B: %v", err)
	}
	if rawScore != 1 {
		t.Errorf("RLS WRITE VIOLATION: cross-tenant UPDATE mutated raw_score to %d, want 1", rawScore)
	}
}

// AC9 — null-tenant fail-closed: clearing the GUC yields a NULL predicate → 0 rows.
func TestRLS_AutoGradeResults_NullTenant_FailClosed_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	rlsInsertAutoGradeResultAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID)

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(context.Background(), `SELECT COUNT(*) FROM auto_grade_results`).Scan(&count); err != nil {
		t.Fatalf("count auto_grade_results: %v", err)
	}
	if count != 0 {
		t.Errorf("FAIL-OPEN: null tenant sees %d auto_grade_results, want 0 (fail-closed)", count)
	}
}

// -----------------------------------------------------------------------------
// AC10 / D9 — the immutability trigger 3-twin (twins a + b live here; the concurrent-
// release twin c is service-level in auto_grade_override_release_atdd_test.go).
// -----------------------------------------------------------------------------

// AC10(a) — UPDATE of a working row whose submission has a RELEASED grade → P0001,
// and the row is byte-for-byte unchanged (data-unchanged assert).
func TestTrigger_AutoGradeResults_UpdateAfterRelease_Raises_DataUnchanged_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, teacherID, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	rowID := rlsInsertAutoGradeResultAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID)
	// A released grade exists for this submission → the trigger must fire on UPDATE.
	rlsInsertGradeAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID, teacherID)

	var before int
	if err := db.QueryRow(context.Background(), `SELECT raw_score FROM auto_grade_results WHERE id=$1`, rowID).Scan(&before); err != nil {
		t.Fatalf("pre-image: %v", err)
	}

	ctx := context.Background()
	mustSavepoint(t, db, "ag_immutable")
	_, err := db.Exec(ctx, `UPDATE auto_grade_results SET raw_score = 2 WHERE id = $1`, rowID)
	if err == nil {
		t.Fatal("IMMUTABILITY VIOLATION: UPDATE of a released working row should have RAISEd P0001")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "P0001" || !strings.Contains(pgErr.Message, "auto_grade_results_immutable_after_release") {
		t.Fatalf("expected P0001 'auto_grade_results_immutable_after_release', got code=%s message=%q", pgErr.Code, pgErr.Message)
	}
	rollbackToSavepoint(t, db, "ag_immutable")

	var after int
	if err := db.QueryRow(ctx, `SELECT raw_score FROM auto_grade_results WHERE id=$1`, rowID).Scan(&after); err != nil {
		t.Fatalf("post-image: %v", err)
	}
	if after != before {
		t.Errorf("IMMUTABILITY VIOLATION: released working row changed raw_score %d→%d", before, after)
	}
}

// AC10(b) — the POSITIVE twin: UPDATE BEFORE release SUCCEEDS. This proves the trigger
// DISCRIMINATES on release state rather than rejecting all updates (overrides must
// work pre-release).
func TestTrigger_AutoGradeResults_UpdateBeforeRelease_Succeeds_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	rowID := rlsInsertAutoGradeResultAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID)
	// NO released grade exists → the pre-release UPDATE must pass.

	tag, err := db.Exec(context.Background(),
		`UPDATE auto_grade_results SET raw_score = 2, updated_at = now() WHERE id = $1`, rowID)
	if err != nil {
		t.Fatalf("pre-release UPDATE must succeed (trigger over-fires), got: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("pre-release UPDATE affected %d rows, want 1", tag.RowsAffected())
	}
}

// AC8 — the submission_id FK is ON DELETE RESTRICT: a working row pins its submission.
func TestFK_AutoGradeResults_SubmissionDeleteRestricted_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	_, submissionID, _, _, _, _ := seedTenantBGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	rlsInsertAutoGradeResultAS(t, db, uuid.UUID(centerA.ID.Bytes), submissionID)

	if _, err := db.Exec(context.Background(), `DELETE FROM submissions WHERE id = $1`, submissionID); err == nil {
		t.Error("FK VIOLATION: deleting a submission with an auto_grade_results row should be RESTRICTed")
	}
}
