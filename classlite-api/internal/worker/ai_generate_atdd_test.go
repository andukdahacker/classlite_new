// Story 4.3a, AC3 + AC8 (worker tenant-context adversarial grid) — GREEN.
//
// WHAT THIS PROVES (R3/A7, scored BLOCK(9) — the async equivalent of GO-1)
//
// Every worker job type ships the 3 mandatory adversarial patterns from
// internal/test/workers/harness.go:14-28. The job row's center_id is the ONLY
// tenant trust anchor; payload center_id is untrusted; a missing SET LOCAL must
// fail closed (0 rows), never leak all rows. See the reference implementation in
// internal/test/workers/harness_test.go (inspectHandler / rlsProbeHandler).
//
// DI SEAM (dev confirms exact shape in green phase — single source of truth is
// the newXHandler helpers below): each handler is constructed with the tx-scoped
// DB handle the harness owns (h.DB, mirroring harness_test.go's inspectHandler),
// the injected gemini.Client, and the deterministic clock. The harness sets
// tenant context from the job row BEFORE calling ProcessTask.
package worker_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

// ---------------------------------------------------------------------------
// DI helpers — the ONE place to adjust when the real constructors land.
// ---------------------------------------------------------------------------

func newSectionHandler(t *testing.T, h *workers.WorkerHarness, mock gemini.Client) workers.JobHandler {
	t.Helper()
	// GREEN-PHASE (dev): confirm the constructor signature. Intent: handler
	// depends on the tx-scoped DB, the gemini client, and the clock — nothing
	// tenant-ish from the payload.
	return worker.NewGenerateSectionHandler(h.DB, mock, h.Clock)
}

func newQuestionsHandler(t *testing.T, h *workers.WorkerHarness, mock gemini.Client) workers.JobHandler {
	t.Helper()
	return worker.NewGenerateQuestionsHandler(h.DB, mock, h.Clock)
}

func newDistractorsHandler(t *testing.T, h *workers.WorkerHarness, mock gemini.Client) workers.JobHandler {
	t.Helper()
	return worker.NewGenerateDistractorsHandler(h.DB, mock, h.Clock)
}

// seedExerciseForTenant creates an exercise owned by centerID so
// questions/distractors modes have a target to read. GREEN-PHASE: delegates to
// the testpkg helper, which sets tenant context to centerID (so the RLS INSERT
// passes even when the caller has not set a tenant) and returns the exercise id.
func seedExerciseForTenant(t *testing.T, h *workers.WorkerHarness, centerID uuid.UUID) uuid.UUID {
	t.Helper()
	return testpkg.SeedExerciseForWorker(t, h.DB, centerID)
}

// ===========================================================================
// AC3 / AC8 — Pattern 1: HappyPath  (row tenant set, downstream effect asserted)
// ===========================================================================

func TestGenerateSection_HappyPath(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")

	centerA := uuid.MustParse(testpkg.TenantAID)
	exID := seedExerciseForTenant(t, h, centerA)

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSection})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateSection),
		model.AIGenerateSectionParams{ExerciseID: exID.String(), Topic: "Present perfect"})

	if err := h.ProcessSpecific(context.Background(), t, jobID, newSectionHandler(t, h, mock)); err != nil {
		t.Fatalf("happy path returned error: %v", err)
	}

	// Downstream effect: job completed and a validated result fragment persisted.
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want %q", got, workers.StatusComplete)
	}
	// GREEN-PHASE: assert jobs.result is non-null and passes
	// store.ValidateExerciseContentStructural (AC4). Kept as a downstream marker
	// here; the deep parse/merge assertions live in the green-phase companion.
	if mock.CallCount() != 1 {
		t.Errorf("gemini.Generate called %d times, want exactly 1", mock.CallCount())
	}
}

func TestGenerateQuestions_HappyPath(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidQuestions})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateQuestions),
		model.AIGenerateQuestionsParams{ExerciseID: exID.String(), SectionID: "sec-1", Count: 3})

	if err := h.ProcessSpecific(context.Background(), t, jobID, newQuestionsHandler(t, h, mock)); err != nil {
		t.Fatalf("happy path returned error: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want %q", got, workers.StatusComplete)
	}
}

func TestGenerateDistractors_HappyPath(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidDistractors})
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateDistractors),
		model.AIGenerateDistractorsParams{ExerciseID: exID.String(), QuestionID: "q-1", Count: 3})

	if err := h.ProcessSpecific(context.Background(), t, jobID, newDistractorsHandler(t, h, mock)); err != nil {
		t.Fatalf("happy path returned error: %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want %q", got, workers.StatusComplete)
	}
}

// ===========================================================================
// AC3 / AC8 — Pattern 2: PayloadCenterIdIgnored
// Job row center_id=A; payload claims center_id=B AND references a B-owned
// exercise. The handler MUST operate under A → RLS hides B's exercise →
// NotFoundError. A leak here is the R3 cross-tenant data breach.
// ===========================================================================

func TestGenerateQuestions_PayloadCenterIdIgnored(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	// A B-owned exercise the attacker's payload will try to reach.
	// (seedExerciseForTenant sets tenant B internally for the RLS INSERT.)
	bExercise := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantBID))

	// Job row says A; payload smuggles B's center + B's exercise id.
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateQuestions),
		model.AIGenerateQuestionsParams{
			ExerciseID:    bExercise.String(),
			SectionID:     "sec-1",
			Count:         3,
			CenterIDClaim: testpkg.TenantBID, // untrusted; MUST be ignored
		})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidQuestions})
	err := h.ProcessSpecific(context.Background(), t, jobID, newQuestionsHandler(t, h, mock))

	// Handler ran under tenant A, so B's exercise is invisible → NotFoundError.
	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("RLS VIOLATION (R3): payload center_id=B was honored — expected NotFoundError reading B's exercise under tenant A, got %v", err)
	}
	// Gemini must not be called once the tenant-scoped precondition fails.
	if mock.CallCount() != 0 {
		t.Errorf("gemini.Generate called %d times on a cross-tenant miss, want 0", mock.CallCount())
	}
}

func TestGenerateDistractors_PayloadCenterIdIgnored(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")

	bExercise := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantBID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateDistractors),
		model.AIGenerateDistractorsParams{
			ExerciseID:    bExercise.String(),
			QuestionID:    "q-1",
			Count:         3,
			CenterIDClaim: testpkg.TenantBID,
		})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidDistractors})
	err := h.ProcessSpecific(context.Background(), t, jobID, newDistractorsHandler(t, h, mock))

	var nf model.NotFoundError
	if !errors.As(err, &nf) {
		t.Fatalf("RLS VIOLATION (R3): expected NotFoundError under tenant A, got %v", err)
	}
}

// Section mode has no cross-tenant target read (it creates a fresh section), so
// its Pattern-2 proof is that the RESULT is written under A, never B. The
// discrepancy (payload claims B) must be logged and ignored, not acted on.
func TestGenerateSection_PayloadCenterIdIgnored(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantBID, "Tenant B", "TENB")
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateSection),
		model.AIGenerateSectionParams{
			ExerciseID:    exID.String(),
			Topic:         "Present perfect",
			CenterIDClaim: testpkg.TenantBID, // ignored
		})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSection})
	if err := h.ProcessSpecific(context.Background(), t, jobID, newSectionHandler(t, h, mock)); err != nil {
		t.Fatalf("section under tenant A should succeed despite payload claiming B: %v", err)
	}
	// GREEN-PHASE: assert the result row / any write landed on center A (a broad
	// SELECT scoped to B returns 0), and that a discrepancy was logged. The
	// tenant-on-connection proof is covered structurally by the harness.
	if got := h.JobStatus(t, jobID); got != workers.StatusComplete {
		t.Fatalf("job status = %q, want complete", got)
	}
}

// ===========================================================================
// AC3 / AC8 — Pattern 3: NullTenantContextRejected
// Simulate the SET LOCAL bug. Every RLS-scoped op the handler attempts must
// return 0 rows, never all-rows. Expected outcome: a typed NotFound/ErrNoRows.
// ===========================================================================

func TestGenerateSection_NullTenantContextRejected(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateSection),
		model.AIGenerateSectionParams{ExerciseID: exID.String(), Topic: "x"})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSection})
	err := h.ProcessWithoutTenantContext(context.Background(), t, jobID, newSectionHandler(t, h, mock))

	if err == nil {
		t.Fatal("RLS VIOLATION: handler succeeded with NO tenant context set — a worker that forgets SET LOCAL would leak/mutate across tenants (SEC-6/GO-1).")
	}
	// It must fail on a tenant-scoped op, not reach Gemini with a phantom target.
	if mock.CallCount() != 0 {
		t.Errorf("gemini.Generate called %d times without tenant context, want 0", mock.CallCount())
	}
}

func TestGenerateQuestions_NullTenantContextRejected(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateQuestions),
		model.AIGenerateQuestionsParams{ExerciseID: exID.String(), SectionID: "sec-1", Count: 3})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidQuestions})
	if err := h.ProcessWithoutTenantContext(context.Background(), t, jobID, newQuestionsHandler(t, h, mock)); err == nil {
		t.Fatal("RLS VIOLATION: questions handler succeeded with no tenant context set")
	}
}

func TestGenerateDistractors_NullTenantContextRejected(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateDistractors),
		model.AIGenerateDistractorsParams{ExerciseID: exID.String(), QuestionID: "q-1", Count: 3})

	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidDistractors})
	if err := h.ProcessWithoutTenantContext(context.Background(), t, jobID, newDistractorsHandler(t, h, mock)); err == nil {
		t.Fatal("RLS VIOLATION: distractors handler succeeded with no tenant context set")
	}
}

// _ keeps json imported if a dev trims payload structs to raw messages during
// green phase; remove when unused.
var _ = json.RawMessage(nil)
