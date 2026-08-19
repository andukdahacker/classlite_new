package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/jackc/pgx/v5/pgconn"
)

// TestTranslateGradeWriteError covers AC3c/B3 — the store maps the append-only
// ledger's SQLSTATEs to typed 409 conflicts.
func TestTranslateGradeWriteError(t *testing.T) {
	immutable := &pgconn.PgError{Code: "P0001", Message: "submission_immutable_after_release"}
	unique := &pgconn.PgError{Code: "23505", Message: `duplicate key value violates unique constraint "uq_grades_submission_version"`}
	other := fmt.Errorf("some unrelated error")

	cases := []struct {
		name     string
		err      error
		isRevise bool
		wantCode string // "" means expect the error returned unchanged
	}{
		{"trigger_P0001_grade", immutable, false, "SUBMISSION_ALREADY_GRADED"},
		{"trigger_P0001_revise", immutable, true, "SUBMISSION_ALREADY_GRADED"},
		{"unique_grade_path", unique, false, "SUBMISSION_ALREADY_GRADED"},
		{"unique_revise_path", unique, true, "GRADE_REVISE_CONFLICT"},
		{"unrelated_passthrough", other, false, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := translateGradeWriteError(tc.err, tc.isRevise)
			if tc.wantCode == "" {
				if !errors.Is(got, tc.err) {
					t.Fatalf("expected passthrough of the original error, got %v", got)
				}
				return
			}
			var conflict model.ConflictError
			if !errors.As(got, &conflict) {
				t.Fatalf("expected model.ConflictError, got %T: %v", got, got)
			}
			if conflict.Code != tc.wantCode {
				t.Errorf("conflict code = %q, want %q", conflict.Code, tc.wantCode)
			}
		})
	}
}
