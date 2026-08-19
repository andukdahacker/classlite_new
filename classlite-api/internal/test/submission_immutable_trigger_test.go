// Story 6.1 (AC3 / R16 / NFR-6) — the submission_immutable_after_release trigger:
// the FIRST trigger in the repo. Both directions proven: (a) the legitimate
// submitted→graded flip passes; (b) any UPDATE of an already-graded row RAISEs the
// named P0001 exception AND leaves the row byte-for-byte unchanged.
package test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestTrigger_SubmittedToGraded_Passes(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	classID, exerciseID, studentID := rlsSeedGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	assignmentID := rlsInsertAssignment(t, db, uuid.UUID(centerA.ID.Bytes), exerciseID, classID, studentID)
	submissionID := rlsInsertSubmission(t, db, uuid.UUID(centerA.ID.Bytes), assignmentID, studentID, "submitted")

	// The release flip must PASS (OLD.status = 'submitted').
	tag, err := db.Exec(context.Background(),
		`UPDATE submissions SET status='graded', updated_at=now() WHERE id=$1`, submissionID)
	if err != nil {
		t.Fatalf("submitted→graded UPDATE should pass, got: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("expected 1 row updated, got %d", tag.RowsAffected())
	}
}

func TestTrigger_UpdateOfGradedRow_Raises_DataUnchanged(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	classID, exerciseID, studentID := rlsSeedGraph(t, db, uuid.UUID(centerA.ID.Bytes))
	assignmentID := rlsInsertAssignment(t, db, uuid.UUID(centerA.ID.Bytes), exerciseID, classID, studentID)
	// Insert directly in the 'graded' state (INSERT does not fire the BEFORE UPDATE trigger).
	submissionID := rlsInsertSubmission(t, db, uuid.UUID(centerA.ID.Bytes), assignmentID, studentID, "graded")

	// Capture the pre-image.
	var contentBefore, statusBefore string
	if err := db.QueryRow(context.Background(),
		`SELECT content::text, status FROM submissions WHERE id=$1`, submissionID).Scan(&contentBefore, &statusBefore); err != nil {
		t.Fatalf("read pre-image: %v", err)
	}

	// Any UPDATE of the graded row must RAISE the named P0001 exception. Wrap in a
	// savepoint so the raised error does not poison the whole test tx.
	ctx := context.Background()
	if _, err := db.Exec(ctx, "SAVEPOINT immutable_update"); err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	_, err := db.Exec(ctx,
		`UPDATE submissions SET content='{"answer":"tampered"}'::jsonb WHERE id=$1`, submissionID)
	if err == nil {
		t.Fatal("IMMUTABILITY VIOLATION: UPDATE of a graded submission should have RAISEd")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected a pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "P0001" || !strings.Contains(pgErr.Message, "submission_immutable_after_release") {
		t.Fatalf("expected P0001 'submission_immutable_after_release', got code=%s message=%q", pgErr.Code, pgErr.Message)
	}
	if _, err := db.Exec(ctx, "ROLLBACK TO SAVEPOINT immutable_update"); err != nil {
		t.Fatalf("rollback to savepoint: %v", err)
	}

	// Data unchanged.
	var contentAfter, statusAfter string
	if err := db.QueryRow(context.Background(),
		`SELECT content::text, status FROM submissions WHERE id=$1`, submissionID).Scan(&contentAfter, &statusAfter); err != nil {
		t.Fatalf("read post-image: %v", err)
	}
	if contentAfter != contentBefore || statusAfter != statusBefore {
		t.Errorf("IMMUTABILITY VIOLATION: graded row changed (content %q→%q, status %q→%q)",
			contentBefore, contentAfter, statusBefore, statusAfter)
	}
}
