// Story 11-0b (Task 4 / DD3) — the cheap dispatcher ROUND-TRIP test for the calibration
// result-capturing seam. The calibration harness reads the grade fragment through the
// exported read-only GradeWritingHandler.GenerateResult accessor; this one UNTAGGED test
// proves that fragment is byte-faithful through the dispatcher's serialize→persist→
// deserialize path (MarkJobComplete → jobs.result jsonb → read back), so the expensive
// real-Gemini run (run_calibration_test.go) never has to double as a serialization
// regression test. No Gemini, no credits — the deterministic mock stands in.
package worker_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

// TestCalibrationSeam_HandlerFragmentMatchesPersistedJobResult asserts that the fragment
// the DD3 accessor returns equals what the dispatcher persists to jobs.result. Equality is
// SEMANTIC (jsonb may reorder keys / normalise whitespace), so both are decoded into the
// typed result before comparison — the property under test is round-trip fidelity, not
// byte identity.
func TestCalibrationSeam_HandlerFragmentMatchesPersistedJobResult(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})
	params := model.AIGradeWritingParams{SubmissionID: subID.String()}
	rawParams, err := json.Marshal(params)
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}

	// (1) Capture the handler's computed fragment via the read-only accessor (DD3), tenant set.
	ctx := testpkg.TenantContext(t, h.DB, center.ID)
	handler := worker.NewGradeWritingHandler(h.DB, mock, h.Clock)
	fragment, err := handler.GenerateResult(ctx, model.TenantContext{CenterID: testpkg.TenantAID}, rawParams)
	if err != nil {
		t.Fatalf("GenerateResult (accessor) returned error: %v", err)
	}
	if len(fragment) == 0 {
		t.Fatal("GenerateResult returned an empty fragment — the accessor must surface the computed result")
	}

	// (2) Drive the real dispatcher to PERSIST job.result for an equivalent job.
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting), params)
	d := newGradeDispatcher(t, h, mock)
	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Fatalf("dispatcher ProcessOnce returned error: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want %q", got, workers.StatusComplete)
	}
	persisted := jobResultRaw(t, h, jobID)

	// (3) The accessor fragment and the persisted job.result must deserialize equal.
	var fromAccessor, fromJobResult model.AIWritingGradeResult
	if err := json.Unmarshal(fragment, &fromAccessor); err != nil {
		t.Fatalf("accessor fragment is not a valid AIWritingGradeResult: %v", err)
	}
	if err := json.Unmarshal(persisted, &fromJobResult); err != nil {
		t.Fatalf("persisted job.result is not a valid AIWritingGradeResult: %v", err)
	}
	if !reflect.DeepEqual(fromAccessor, fromJobResult) {
		t.Errorf("DD3 round-trip mismatch:\n accessor  = %+v\n job.result= %+v", fromAccessor, fromJobResult)
	}
}
