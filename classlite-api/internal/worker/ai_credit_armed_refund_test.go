// Story 9-1a code-review F1 — the ARMED credit-refund wiring guard.
//
// Regression: the enqueue consume was swapped to the 9.1a billing engine (writes an
// ai_credits bucket decrement + a center-scoped job_deduction ledger row), but the
// dispatcher's terminal-fail refund still called the legacy q.RefundJob (which only
// reverses the 4.3a per-(center,user) ledger, never the ai_credits bucket). Under
// enforcement a failed job therefore burned a credit permanently and ai_credits.available
// diverged from the ledger head (breaking the D14 invariant / AC12 auto-refund).
//
// This test drives the real dispatcher path (ProcessOnce → terminalFail → refundCredit)
// with the credit gate ARMED and asserts the ai_credits bucket is made whole.
package worker_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
)

func TestArmedRefund_TerminalFail_RestoresAICreditsBucket(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true")
	ctx := context.Background()
	h := workers.SetupWorkerHarness(t)
	// MockMalformed → invalid_ai_response → terminal on the first pass (no retries).
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockMalformed})
	d := newDispatcherForTest(t, h, mock)
	// billing's db handle is unused by RefundCreditTx (it runs on the dispatcher's tx);
	// the clock drives applyLazyReset's boundary check.
	d.SetBilling(service.NewBillingServiceWithClock(h.DB, h.Clock))

	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	user := testpkg.SeedExerciseAuthorForWorker(t, h.DB)
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	// A pending AI job (no legacy deduction — the armed path is what we exercise).
	raw, err := json.Marshal(model.AIGenerateSectionParams{ExerciseID: exID.String(), Topic: "x"})
	if err != nil {
		t.Fatalf("marshal params: %v", err)
	}
	job, err := generated.New(h.DB).InsertJob(ctx, generated.InsertJobParams{
		CenterID:            center.ID,
		CreatedBy:           pgtype.UUID{Bytes: user, Valid: true},
		Type:                string(model.JobTypeAIGenerateSection),
		Params:              raw,
		ParamsSchemaVersion: model.AIJobParamsSchemaVersion,
	})
	if err != nil {
		t.Fatalf("insert job: %v", err)
	}
	jobID := uuid.UUID(job.ID.Bytes)

	// Seed the ARMED state exactly as the enqueue consume would leave it: a Pro center
	// with allocation 5, one credit already spent (monthly_used 1 → available 4), and the
	// matching center-scoped job_deduction ledger row (balance_after 4, period_end = the
	// current period so the refund reclaims the MONTHLY bucket).
	resetAt := h.Clock.Now().AddDate(0, 1, 0)
	if _, err := h.DB.Exec(ctx,
		`INSERT INTO ai_credits (id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at)
		 VALUES (gen_random_uuid(), $1, 5, 1, 0, $2)`,
		center.ID, resetAt,
	); err != nil {
		t.Fatalf("seed ai_credits: %v", err)
	}
	if _, err := h.DB.Exec(ctx,
		`INSERT INTO ai_credit_ledger (id, center_id, user_id, change, reason, ref_job_id, balance_after, period_end, created_at)
		 VALUES (gen_random_uuid(), $1, $2, -1, 'job_deduction', $3, 4, $4, clock_timestamp())`,
		center.ID, pgtype.UUID{Bytes: user, Valid: true}, job.ID, resetAt,
	); err != nil {
		t.Fatalf("seed armed deduction: %v", err)
	}

	// Process → invalid_ai_response → terminal → armed refund.
	if err := d.ProcessOnce(ctx); err != nil {
		t.Logf("processing error (expected terminal): %v", err)
	}

	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed", got)
	}
	// The consumed monthly credit is restored (bucket made whole) — the crux of F1.
	var used, alloc, addon int
	if err := h.DB.QueryRow(ctx,
		`SELECT monthly_allocation, monthly_used, addon_remaining FROM ai_credits WHERE center_id = $1`,
		center.ID,
	).Scan(&alloc, &used, &addon); err != nil {
		t.Fatalf("read ai_credits: %v", err)
	}
	if used != 0 {
		t.Errorf("monthly_used = %d, want 0 (armed refund must restore the bucket)", used)
	}
	if available := (alloc - used) + addon; available != 5 {
		t.Errorf("available = %d, want 5 (full restore)", available)
	}
	// A center-scoped job_failed_refund ledger row landed (D14 chain reversal), exactly one.
	var refunds int
	if err := h.DB.QueryRow(ctx,
		`SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1 AND ref_job_id = $2 AND reason = 'job_failed_refund'`,
		center.ID, job.ID,
	).Scan(&refunds); err != nil {
		t.Fatalf("count refunds: %v", err)
	}
	if refunds != 1 {
		t.Errorf("job_failed_refund rows = %d, want 1", refunds)
	}
}
