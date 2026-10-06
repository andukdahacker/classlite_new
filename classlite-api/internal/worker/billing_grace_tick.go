// Story 9.3 — the billing_grace_tick worker handler (D5). It rides the SAME 4.3a dispatcher on
// the existing jobs queue (jobs.type is free text; no migration), future-dated via
// next_attempt_at. NOT an AI job — the gemini client is ignored. On dequeue the dispatcher has
// already re-established the tenant from the job ROW's center_id (SEC-6); this handler calls
// BillingService.HandleGraceTick (GFW-7 worker-imports-service) to run the elapsed-day action
// (days 0/3/5/6 warning email, 3/5 Polar re-collect, day-7 23:59 auto-downgrade), then
// reschedules the next tick while the center is still past_due (the self-rescheduling cadence).
//
// The worker-package integration test driving ProcessOnce across MockClock days 0→7 (D-green-1)
// is a deferred follow-up; the WF-8 reds drive HandleGraceTick directly under MockClock.
package worker

import (
	"context"
	"encoding/json"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// BillingGraceTickHandler processes billing_grace_tick jobs. It holds the BillingService (the
// peer entry point the tick drives) — never a handler (GFW-7).
type BillingGraceTickHandler struct {
	db      generated.DBTX
	billing *service.BillingService
}

// NewBillingGraceTickHandler builds the handler. db is the harness-bound handle for the
// 3-pattern ProcessTask path; the production dispatcher drives generate on its per-job tx.
func NewBillingGraceTickHandler(db generated.DBTX, billing *service.BillingService) *BillingGraceTickHandler {
	return &BillingGraceTickHandler{db: db, billing: billing}
}

// JobType reports the grace-tick job type.
func (h *BillingGraceTickHandler) JobType() model.JobType { return model.JobTypeBillingGraceTick }

// ProcessTask satisfies the tenant-isolation harness — runs the same logic, discards the
// (nil) result fragment.
func (h *BillingGraceTickHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, nil, tc, payload)
	return err
}

// generate runs the grace tick: HandleGraceTick (its own tenant tx — the day's action +
// idempotent per-day marker + day-7 downgrade), then RescheduleGraceTickTx on THIS job's tx so
// the next tick is enqueued atomically with the job's completion while the center is still
// past_due. gem is unused (not an AI job). A nil billing is a defensive no-op.
func (h *BillingGraceTickHandler) generate(ctx context.Context, db generated.DBTX, _ gemini.Client, tc model.TenantContext, _ json.RawMessage) (json.RawMessage, error) {
	if h.billing == nil {
		return nil, nil
	}
	if err := h.billing.HandleGraceTick(ctx, tc); err != nil {
		return nil, err
	}
	if err := h.billing.RescheduleGraceTickTx(ctx, generated.New(db), tc); err != nil {
		return nil, err
	}
	return nil, nil
}
