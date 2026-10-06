// Story 9.2a — the Polar-driven billing write paths layered on the 9-1a credit/plan engine:
//
//	· ProcessPolarEvent — the signature-verified webhook dispatch (ONE tx: dedup → resolve
//	    tenant → SET LOCAL → apply), the source of truth for upgrade/add-on confirmation (D2).
//	· SetPlanFromPolar   — the D17 period-from-payload, change-gated plan apply (SEPARATE from
//	    the genesis/override SetPlan; preserves monthly_used on a mid-cycle upgrade).
//	· CreateCheckout / ScheduleDowngrade / CancelDowngrade — owner-initiated outbound flows;
//	    the Polar call runs OUTSIDE any tx/lock (D21), then a short tx persists the result.
//	· ReconcilePendingCheckouts — the D18 lost-webhook safety net (polled on GET /api/billing).
//
// Idempotency is layered (D19/D22/D23): the polar_webhook_events PK dedups a duplicate
// delivery (whole dispatch is one tx → the loser mutates nothing); the add-on grant is
// ledger-first over a FULL UNIQUE(ref_purchase_id, reason) index; invoices dedup on
// UNIQUE(polar_order_id); a plan apply is target-state idempotent (period_start compare).
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/polar"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// reasonAddonPurchase is the ai_credit_ledger reason for a paid add-on top-up (4.3a CHECK
// already admits it; the reserved 9-1a hook this story populates).
const reasonAddonPurchase = "addon_purchase"

// polarPaymentFailedEventType is the Polar event that STARTS our grace clock (Story 9.3,
// D2/D6). VERIFIED against the Polar docs at dev time: Polar fires `subscription.past_due`
// when a subscription's renewal charge fails (candidates were also order.payment_failed /
// invoice.payment_failed — FU-9-POLAR-CONTRACT posture, Jan-2026 cutoff). It is resolved via
// the SAME persisted-sub-id-wins path as subscription.updated/.active (confused-deputy guard,
// SEC-7) — a signed event whose data.id maps to a center can never be redirected by raw-body
// metadata. If the sandbox shows a different wire name before arming, swap this one constant.
const polarPaymentFailedEventType = "subscription.past_due"

// purchaseIDNamespace maps a Polar order id deterministically to ONE purchase id, used as BOTH
// the add-on ledger ref_purchase_id AND the invoices PK — so the two are linked (D8) and a
// re-processed order (webhook + reconcile, or a duplicate delivery) collides on the same keys.
var purchaseIDNamespace = uuid.MustParse("9a2a0000-0000-0000-0000-00000c0ffee5")

func purchaseIDForOrder(orderID string) uuid.UUID {
	return uuid.NewSHA1(purchaseIDNamespace, []byte(orderID))
}

// polarEvent is the slice of a Polar webhook envelope this story consumes. The wire field
// names MUST be verified against current Polar docs at dev time (D4/D29a — knowledge cutoff);
// metadata.center_id / addon_pack_id are the values WE plant at checkout create (D5/D12).
type polarEvent struct {
	Type string `json:"type"`
	Data struct {
		ID                 string `json:"id"`
		Amount             int    `json:"amount"`
		Currency           string `json:"currency"`
		Status             string `json:"status"`
		ProductPlan        string `json:"product_plan"`
		RecurringInterval  string `json:"recurring_interval"`
		OrderID            string `json:"order_id"`
		CheckoutID         string `json:"checkout_id"`
		CurrentPeriodStart string `json:"current_period_start"`
		CurrentPeriodEnd   string `json:"current_period_end"`
		// HostedInvoiceURL is Polar's hosted invoice/receipt PDF link (Story 9.3 code-review D4,
		// 2026-10-06). PROVISIONAL wire name under the Jan-2026 cutoff (candidates: hosted_invoice_url
		// / invoice_url / receipt_url — FU-9-POLAR-CONTRACT; reconcile against the sandbox payload
		// before arming). Persisted to invoices.polar_invoice_id only when it is an https URL, so the
		// s70 Download-PDF action (AC15) renders; absent/non-URL → left null → the FE omits the action.
		HostedInvoiceURL string `json:"hosted_invoice_url"`
		Metadata         struct {
			CenterID    string `json:"center_id"`
			AddonPackID string `json:"addon_pack_id"`
		} `json:"metadata"`
		// Story 9.2b (Task 11, AC12) — the Polar card-on-file descriptor ({brand, last4},
		// MASKED, never raw card data — epic:127-130). These wire field names are
		// PROVISIONAL (modeled under the Jan-2026 cutoff) and MUST be reconciled against the
		// real Polar subscription payload before arming (FU-9-POLAR-CONTRACT / D29a): if the
		// sandbox nests them differently (e.g. data.payment_method.card.*), fix this shape.
		// Absent fields → empty strings → the card is left untouched (see setPlanFromPolarTx).
		PaymentMethod struct {
			Brand string `json:"brand"`
			Last4 string `json:"last4"`
		} `json:"payment_method"`
	} `json:"data"`
}

// ProcessPolarEvent is the webhook dispatch (already-verified upstream). It owns ONE tx on ONE
// connection (D23): INSERT polar_webhook_events (the outer dedup) → resolve the tenant from OUR
// DB (D20) → SET LOCAL → dispatch by event type. A duplicate event_id, an unresolved center,
// or an unhandled type (e.g. a refund — FU-9-REFUND) all commit an empty tx: 200 + log, ZERO
// mutation. The loser of a same-event_id race collides on the PK and its whole dispatch is
// skipped.
func (s *BillingService) ProcessPolarEvent(ctx context.Context, eventID, eventType string, body []byte) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("process polar event: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	q := generated.New(tx)

	// Outer dedup (D23): the polar_webhook_events PK. rows==0 → a duplicate delivery; commit
	// the empty tx and mutate nothing. polar_webhook_events has NO RLS (pre-tenant, global).
	sum := sha256.Sum256(body)
	rows, err := q.InsertWebhookEvent(ctx, generated.InsertWebhookEventParams{
		EventID:     eventID,
		EventType:   eventType,
		PayloadHash: pgtype.Text{String: "sha256:" + hex.EncodeToString(sum[:]), Valid: true},
	})
	if err != nil {
		return fmt.Errorf("process polar event: dedup insert: %w", err)
	}
	if rows == 0 {
		return tx.Commit(ctx) // already processed — idempotent no-op
	}

	var ev polarEvent
	if err := json.Unmarshal(body, &ev); err != nil {
		// A malformed body under a valid signature: log + swallow (a retry would never parse).
		slog.Warn("polar webhook: unparseable body", "event_id", eventID, "event_type", eventType)
		return tx.Commit(ctx)
	}

	center, err := s.resolvePolarCenter(ctx, q, eventType, ev)
	if err != nil {
		return err
	}
	if center == "" {
		// Unresolved tenant or an unhandled event type (refund, checkout.*, etc.) → 200 + log,
		// no mutation (D19 one-event-per-effect; D29b refund dispatcher-only-200).
		slog.Info("polar webhook: no-op event", "event_id", eventID, "event_type", eventType)
		return tx.Commit(ctx)
	}

	tc := model.TenantContext{CenterID: center}
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("process polar event: set tenant: %w", err)
	}
	// Code-review P3 (2026-10-06) — serialize grace-state transitions per center: take the
	// subscription lock BEFORE the recovery read + dispatch so a day-7 grace tick running
	// concurrently (its own tx) cannot race this recovery/downgrade (R21 wrong-day transition).
	// Acquired before lockClassCredit (applyOrderPaidTx) so the lock order is consistent.
	if err := s.acquireLock(ctx, q, tc, lockClassSubscription); err != nil {
		return fmt.Errorf("process polar event: lock: %w", err)
	}

	// D24 — the webhook re-establishes CENTER context with no acting user; attribute every
	// downstream ledger row (grant/top-up) to the center OWNER. A center with no owner is a
	// HANDLED no-op (200 + log), NOT a uuid.Nil FK-violation 500 retry loop. Populating
	// tc.UserID here also feeds the shared applyLazyReset/grant paths a valid user.
	centerUUID, err := uuid.Parse(center)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	owner, err := q.GetCenterOwnerUserID(ctx, pgUUID(centerUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			slog.Warn("polar webhook: center has no owner — dropping event", "event_id", eventID, "center_id", center)
			return tx.Commit(ctx)
		}
		return fmt.Errorf("process polar event: owner lookup: %w", err)
	}
	tc.UserID = uuid.UUID(owner.Bytes).String()

	var dispatchErr error
	var supersededDowngradeSubID string

	// Story 9.3 (AC9/BLOCKER-1) — status-based grace recovery, BEFORE the normal dispatch. A
	// recovery-eligible event (order.paid / subscription.active/.updated) arriving while the
	// center is past_due means payment resolved WITHIN the window: clear grace + cancel ticks +
	// return to active, INDEPENDENT of the genuine plan/period-change gate (a same-period
	// dunning-retry success does not roll the period, so setPlanFromPolarTx's !genuine early
	// return would otherwise leave it past_due and wrongly downgrade at day 7). The normal
	// dispatch below then applies any genuine change (a no-op on an unchanged period).
	if isRecoveryEligibleEvent(ev) {
		sub, serr := q.GetSubscription(ctx, pgUUID(centerUUID))
		if serr != nil && !errors.Is(serr, pgx.ErrNoRows) {
			return fmt.Errorf("process polar event: recovery read: %w", serr)
		}
		if serr == nil && sub.Status == "past_due" {
			dispatchErr = s.recoverFromGraceTx(ctx, q, tc)
		}
	}

	if dispatchErr == nil {
		switch eventType {
		case "order.paid":
			dispatchErr = s.applyOrderPaidTx(ctx, q, tc, ev)
		case "subscription.updated", "subscription.active":
			dispatchErr = s.applySubscriptionEventTx(ctx, q, tc, ev, &supersededDowngradeSubID)
		case polarPaymentFailedEventType:
			dispatchErr = s.enterGraceTx(ctx, q, tc, ev)
		default:
			slog.Info("polar webhook: ignored event type", "event_id", eventID, "event_type", eventType)
		}
	}
	if dispatchErr != nil {
		// A PERMANENT failure (a malformed/unmapped payload or an authz/tenant problem on an
		// already-resolved tenant) must NOT bubble to a 500: Polar would retry forever and —
		// because the polar_webhook_events dedup row shares THIS tx — every retry rolls it back
		// and re-fails, a poison pill (review P-1). Dead-letter it: commit the dedup row + log so
		// the event is recorded once and never re-dispatched. Only TRANSIENT errors (DB/tx/infra)
		// propagate → 500 → a safe, dedup-protected Polar retry.
		if isPermanentEventError(dispatchErr) {
			slog.Warn("polar webhook: permanent dispatch failure — dead-lettered (committed, no retry)",
				"event_id", eventID, "event_type", eventType, "error", dispatchErr.Error())
			return tx.Commit(ctx)
		}
		return dispatchErr
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("process polar event: commit: %w", err)
	}

	// D26 (review): a genuine plan change that SUPERSEDED a scheduled downgrade must also cancel
	// the live Polar-side schedule — otherwise the stale schedule fires at the next renewal and
	// dumps the just-upgraded owner to the lower tier. The Polar call runs AFTER commit, OUTSIDE
	// any tx/lock (D21); best-effort — a failure is logged, not fatal (a later subscription event
	// or reconcile re-applies the authoritative plan).
	if supersededDowngradeSubID != "" && s.polar != nil {
		if cerr := s.polar.CancelDowngrade(context.WithoutCancel(ctx), supersededDowngradeSubID); cerr != nil {
			slog.Warn("polar webhook: failed to cancel superseded downgrade schedule",
				"subscription_id", supersededDowngradeSubID, "error", cerr.Error())
		}
	}
	return nil
}

// isPermanentEventError reports whether a webhook dispatch error is deterministic — a retry can
// never succeed — so it must be dead-lettered (committed + logged) rather than 500'd into an
// infinite Polar retry (review P-1). A malformed/unmapped payload surfaces as
// model.ValidationError; an authz/tenant problem as *ForbiddenError. Everything else is treated
// as transient and propagated.
func isPermanentEventError(err error) bool {
	var ve model.ValidationError
	var fe *ForbiddenError
	return errors.As(err, &ve) || errors.As(err, &fe)
}

// isRecoveryEligibleEvent reports whether an event, delivered while the center is past_due,
// signals an actual SUBSCRIPTION payment recovery (Story 9.3, AC9/D6). Recovery is still
// status-based rather than gated on a genuine plan change (BLOCKER-1 — a same-period dunning-
// retry success must recover), but code-review D1 (2026-10-06) tightened it to inspect the
// event PAYLOAD, not just its type, closing a revenue-bypass hole:
//
//   - order.paid recovers ONLY when the order is a subscription charge, never an add-on pack
//     purchase (buying AI credits while past_due must NOT clear the failed renewal's dunning
//     clock). Add-on orders carry a known addon_pack_id → plan.AddonPackByID(...).Credits > 0.
//   - subscription.active recovers unless the payload explicitly reports a non-active status.
//   - subscription.updated recovers ONLY when the payload status is "active" — the generic
//     update event fires for many non-payment reasons (metadata/schedule changes) that can
//     legitimately arrive while still past_due, so the type alone is NOT trusted.
//
// The payment-failure event itself is never recovery-eligible.
func isRecoveryEligibleEvent(ev polarEvent) bool {
	switch ev.Type {
	case "order.paid":
		return plan.AddonPackByID(ev.Data.Metadata.AddonPackID).Credits == 0
	case "subscription.active":
		return ev.Data.Status == "" || ev.Data.Status == "active"
	case "subscription.updated":
		return ev.Data.Status == "active"
	default:
		return false
	}
}

// resolvePolarCenter resolves the tenant per D20: for a subscription event the PERSISTED
// polar_subscription_id mapping WINS (the confused-deputy guard — a signed/replayed event whose
// body names another center can never redirect a grant); only when the id is unbound (the
// first-ever event) do we trust the signed metadata.center_id we planted at checkout (D5). An
// order.paid carries no persisted mapping, so its signed metadata.center_id is the anchor.
// Returns "" for an unresolved/unhandled event (→ no mutation). Runs on q BEFORE SET LOCAL; the
// subscription lookup goes through the SECURITY DEFINER function (bypasses FORCE RLS, pre-tenant).
func (s *BillingService) resolvePolarCenter(ctx context.Context, q *generated.Queries, eventType string, ev polarEvent) (string, error) {
	switch eventType {
	case "order.paid":
		return ev.Data.Metadata.CenterID, nil
	case "subscription.updated", "subscription.active", polarPaymentFailedEventType:
		if ev.Data.ID != "" {
			bound, err := q.PolarCenterBySubscriptionID(ctx, ev.Data.ID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return "", fmt.Errorf("resolve polar center: %w", err)
			}
			if bound.Valid {
				return uuidString(bound), nil // persisted mapping wins (confused-deputy guard)
			}
		}
		// First-ever event for this subscription (unbound). D20 (review D-3): anchor on the
		// billing_checkout_intents row we persisted at checkout-create, keyed by the originating
		// checkout id — via the SECURITY DEFINER lookup, since intents is RLS and we are still
		// pre-tenant. That mapping is authoritative (WE planted the checkout); the signed
		// metadata.center_id is only the last resort. Inert if the event carries no checkout id.
		if ev.Data.CheckoutID != "" {
			byCheckout, err := q.PolarCenterByCheckoutID(ctx, ev.Data.CheckoutID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return "", fmt.Errorf("resolve polar center: checkout anchor: %w", err)
			}
			if byCheckout.Valid {
				return uuidString(byCheckout), nil
			}
		}
		return ev.Data.Metadata.CenterID, nil // first event, no intent anchor → trust signed metadata
	default:
		return "", nil
	}
}

// applyOrderPaidTx grants a paid add-on pack: ledger-FIRST idempotency (D22), then addon_remaining
// and the invoice snapshot — all only if the ledger row landed. Runs under the (center,credit)
// lock inside the dispatch tx. A duplicate delivery bypassing the outer dedup is still a balance
// no-op (the FULL UNIQUE(ref_purchase_id, reason) index dedups the ledger, gating the rest).
func (s *BillingService) applyOrderPaidTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, ev polarEvent) error {
	orderID := ev.Data.ID
	pack := plan.AddonPackByID(ev.Data.Metadata.AddonPackID)
	if pack.Credits == 0 {
		// Not an add-on order — an upgrade/renewal SUBSCRIPTION charge (D19: the plan change
		// itself is the subscription.* event's effect). Snapshot the invoice ONLY, no credit
		// grant. Idempotent via invoices UNIQUE(polar_order_id). Review P-2: this previously
		// returned nil, so a webhook-delivered subscription charge left NO invoice row (only the
		// reconcile path wrote one).
		if orderID == "" {
			slog.Info("polar order.paid: no add-on pack and no order id — nothing to snapshot")
			return nil
		}
		return s.insertChargeInvoice(ctx, q, tc, purchaseIDForOrder(orderID), orderID, "subscription", ev.Data.Amount, ev.Data.Currency, ev.Data.Status, ev.Data.HostedInvoiceURL)
	}
	if orderID == "" {
		return nil
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	ownerUUID, err := s.centerOwnerUUID(ctx, q, centerUUID)
	if err != nil {
		return err
	}
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return err
	}
	credits, err := s.getOrCreateAICredits(ctx, q, tc)
	if err != nil {
		return err
	}
	credits, err = s.applyLazyReset(ctx, q, tc, credits)
	if err != nil {
		return err
	}
	purchaseID := purchaseIDForOrder(orderID)
	prevBalance := s.latestLedgerBalance(ctx, q, centerUUID)
	newBalance := prevBalance + pack.Credits

	// Ledger-FIRST (D22): only touch the balance + invoice if the +credits row actually landed.
	ledgerRows, err := q.InsertAddonPurchaseLedgerRow(ctx, generated.InsertAddonPurchaseLedgerRowParams{
		CenterID:      pgUUID(centerUUID),
		UserID:        pgUUID(ownerUUID),
		Change:        int32(pack.Credits),
		RefPurchaseID: pgUUID(purchaseID),
		BalanceAfter:  int32(newBalance),
	})
	if err != nil {
		return fmt.Errorf("apply order.paid: addon ledger: %w", err)
	}
	if ledgerRows == 0 {
		return nil // already granted for this purchase — idempotent no-op
	}
	if err := q.UpdateAICreditsBuckets(ctx, generated.UpdateAICreditsBucketsParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: credits.MonthlyAllocation,
		MonthlyUsed:       credits.MonthlyUsed,
		AddonRemaining:    credits.AddonRemaining + int32(pack.Credits),
		ResetAt:           credits.ResetAt,
	}); err != nil {
		return fmt.Errorf("apply order.paid: update buckets: %w", err)
	}
	return s.insertChargeInvoice(ctx, q, tc, purchaseID, orderID, "addon", ev.Data.Amount, ev.Data.Currency, ev.Data.Status, ev.Data.HostedInvoiceURL)
}

// applySubscriptionEventTx applies a Polar subscription.updated/.active plan change (D17). Parses
// the authoritative period bounds from the payload and delegates to setPlanFromPolarTx.
func (s *BillingService) applySubscriptionEventTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, ev polarEvent, supersededCancel *string) error {
	periodStart := parsePolarTime(ev.Data.CurrentPeriodStart)
	periodEnd := parsePolarTime(ev.Data.CurrentPeriodEnd)
	// Map Polar's recurring-interval vocabulary to our internal cycle BEFORE validation (review
	// P-4): Polar sends month/year (etc.), not our literal monthly/annual — an unmapped value
	// would otherwise fail validation and poison-pill the webhook.
	return s.setPlanFromPolarTx(ctx, q, tc, plan.Tier(ev.Data.ProductPlan), normalizePolarCycle(ev.Data.RecurringInterval), ev.Data.ID, periodStart, periodEnd, ev.Data.PaymentMethod.Brand, ev.Data.PaymentMethod.Last4, supersededCancel)
}

// SetPlanFromPolar is the public D17 seam (its own tenant tx). The webhook path calls
// setPlanFromPolarTx directly on the dispatch tx. NEVER the genesis/override SetPlan.
func (s *BillingService) SetPlanFromPolar(ctx context.Context, tc model.TenantContext, tier plan.Tier, cycle, polarSubID string, periodStart, periodEnd time.Time) error {
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		// Public seam carries no payload card (brand/last4 empty → payment method untouched).
		return s.setPlanFromPolarTx(ctx, q, tc, tier, cycle, polarSubID, periodStart, periodEnd, "", "", nil)
	})
}

// setPlanFromPolarTx writes the plan/period FROM the Polar payload (honors annual), persists
// polar_subscription_id, clears any pending downgrade (D26), and grants the monthly allocation
// ONLY on a genuine plan-change or period-rollover — a mid-cycle upgrade PRESERVES monthly_used
// (tops up to the new ceiling, never re-zeroes); an unrelated update (same plan/cycle/period) is
// a NO-OP on credits/period (it only binds polar_subscription_id if unbound). D17.
func (s *BillingService) setPlanFromPolarTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, tier plan.Tier, cycle, polarSubID string, periodStart, periodEnd time.Time, brand, last4 string, supersededCancel *string) error {
	if !plan.IsValid(tier) {
		return model.ValidationError{Fields: []model.FieldError{{Field: "plan", Message: "unknown plan tier"}}}
	}
	if cycle != "monthly" && cycle != "annual" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "billingCycle", Message: "must be 'monthly' or 'annual'"}}}
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	// Serialize the whole apply (period write + pending-downgrade clear + grant) with
	// ScheduleDowngrade/CancelDowngrade on the (center,credit) advisory lock so a cancel⟷renewal
	// race cannot interleave (review P-8). grantPlanAllocationFromPolarTx re-acquires the same key
	// later in this tx — the same holder re-granting is immediate.
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return err
	}
	sub, err := s.getOrCreateSubscription(ctx, q, tc)
	if err != nil {
		return err
	}

	// Story 9.2b (AC12) — persist the card-on-file BEFORE the genuine/no-op split: a
	// payment-method edit arrives as a NON-genuine subscription.updated (same plan/cycle/period),
	// which returns early below, so capturing it only on the genuine path would miss it. Only
	// write when the payload actually carried a card (both fields present) — an absent card must
	// never blank an existing one. {brand, last4} is Polar's MASKED descriptor (epic:127-130).
	if brand != "" && last4 != "" {
		if err := q.SetSubscriptionPaymentMethod(ctx, generated.SetSubscriptionPaymentMethodParams{
			PaymentBrand: pgtype.Text{String: brand, Valid: true},
			PaymentLast4: pgtype.Text{String: last4, Valid: true},
			CenterID:     pgUUID(centerUUID),
		}); err != nil {
			return fmt.Errorf("set plan from polar: payment method: %w", err)
		}
	}

	// A zero/unparseable payload period (review P-4) is NOT a genuine change — never let a missing
	// field masquerade as a new period and trigger a spurious re-grant.
	periodChanged := !periodStart.IsZero() && !sub.CurrentPeriodStart.Time.Equal(periodStart)
	genuine := sub.Plan != string(tier) ||
		sub.BillingCycle != cycle ||
		periodChanged
	if !genuine {
		// Unrelated subscription.updated (payment-method/metadata edit): no credit/period change.
		// Bind polar_subscription_id if this is the first event that carried it (D20).
		if polarSubID != "" && (!sub.PolarSubscriptionID.Valid || sub.PolarSubscriptionID.String == "") {
			if err := q.SetPolarSubscriptionID(ctx, generated.SetPolarSubscriptionIDParams{
				PolarSubscriptionID: pgtype.Text{String: polarSubID, Valid: true},
				CenterID:            pgUUID(centerUUID),
			}); err != nil {
				return fmt.Errorf("set plan from polar: bind sub id: %w", err)
			}
		}
		return nil
	}

	// D26 (review D-1): record whether this genuine change SUPERSEDES a scheduled downgrade — a
	// pending_plan that is NOT the tier we are now applying (an upgrade/different plan, not the
	// downgrade fulfilling itself at renewal). The caller cancels the live Polar schedule out-of-tx
	// after commit so the stale schedule never fires.
	if supersededCancel != nil && sub.PendingPlan.Valid && sub.PendingPlan.String != string(tier) {
		cancelID := polarSubID
		if cancelID == "" {
			cancelID = sub.PolarSubscriptionID.String
		}
		if cancelID != "" {
			*supersededCancel = cancelID
		}
	}

	// Preserve the stored period when the payload's is zero/unparseable — never persist a
	// 0001-01-01 sentinel (review P-4).
	effStart := periodStart
	if effStart.IsZero() {
		effStart = sub.CurrentPeriodStart.Time
	}
	effEnd := periodEnd
	if effEnd.IsZero() {
		effEnd = sub.CurrentPeriodEnd.Time
	}

	// Genuine change: write the subscription (clears pending downgrade — D26), re-point storage.
	if err := q.UpdateSubscriptionFromPolar(ctx, generated.UpdateSubscriptionFromPolarParams{
		Plan:                string(tier),
		BillingCycle:        cycle,
		Status:              "active",
		PolarSubscriptionID: pgtype.Text{String: polarSubID, Valid: polarSubID != ""},
		CurrentPeriodStart:  pgTimestamptz(effStart),
		CurrentPeriodEnd:    pgTimestamptz(effEnd),
		CenterID:            pgUUID(centerUUID),
	}); err != nil {
		return fmt.Errorf("set plan from polar: update subscription: %w", err)
	}
	if err := q.UpdateCenterStorageLimit(ctx, generated.UpdateCenterStorageLimitParams{
		ID:                pgUUID(centerUUID),
		StorageLimitBytes: plan.LimitsFor(tier).StorageBytes,
	}); err != nil {
		return fmt.Errorf("set plan from polar: storage limit: %w", err)
	}
	return s.grantPlanAllocationFromPolarTx(ctx, q, tc, centerUUID, tier)
}

// grantPlanAllocationFromPolarTx grants the tier's monthly allocation on a Polar plan change,
// PRESERVING monthly_used (D17 — a mid-cycle upgrade tops up to the new ceiling, never
// re-zeroes; on a downgrade the used bucket is capped to the new, lower allocation so available
// never goes negative). Appends a chain-consistent monthly_grant ledger row attributed to the
// center OWNER (D24). Runs under the (center,credit) lock.
func (s *BillingService) grantPlanAllocationFromPolarTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, centerUUID uuid.UUID, tier plan.Tier) error {
	if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
		return err
	}
	credits, err := s.getOrCreateAICredits(ctx, q, tc)
	if err != nil {
		return err
	}
	credits, err = s.applyLazyReset(ctx, q, tc, credits)
	if err != nil {
		return err
	}
	ownerUUID, err := s.centerOwnerUUID(ctx, q, centerUUID)
	if err != nil {
		return err
	}
	newAlloc := plan.LimitsFor(tier).AICreditsPerMonth
	if newAlloc < 0 {
		newAlloc = 0
	}
	used := int(credits.MonthlyUsed)
	if used > newAlloc {
		used = newAlloc // downgrade: cap forfeits the overage, never a negative available
	}
	addon := int(credits.AddonRemaining)
	newAvailable := (newAlloc - used) + addon

	resetAt := credits.ResetAt
	if !resetAt.Valid || !resetAt.Time.After(s.clk.Now()) {
		resetAt = pgTimestamptz(startOfNextMonthUTC(s.clk.Now()))
	}
	prevBalance := s.latestLedgerBalance(ctx, q, centerUUID)

	if err := q.UpdateAICreditsBuckets(ctx, generated.UpdateAICreditsBucketsParams{
		CenterID:          pgUUID(centerUUID),
		MonthlyAllocation: int32(newAlloc),
		MonthlyUsed:       int32(used),
		AddonRemaining:    int32(addon),
		ResetAt:           resetAt,
	}); err != nil {
		return fmt.Errorf("set plan from polar: update buckets: %w", err)
	}
	if _, err := q.InsertCreditLedgerRow(ctx, generated.InsertCreditLedgerRowParams{
		CenterID:     pgUUID(centerUUID),
		UserID:       pgUUID(ownerUUID),
		Change:       int32(newAvailable - prevBalance),
		Reason:       reasonMonthlyGrant,
		RefJobID:     pgtype.UUID{},
		BalanceAfter: int32(newAvailable),
		PeriodEnd:    resetAt,
	}); err != nil {
		return fmt.Errorf("set plan from polar: grant ledger: %w", err)
	}
	return nil
}

// insertChargeInvoice snapshots a Polar charge (D10/D25 — amount VERBATIM from Polar, never the
// plan catalog). id equals the order's purchase id (D8 linkage); UNIQUE(polar_order_id) +
// ON CONFLICT DO NOTHING makes it idempotent. Runs under the tenant tx.
func (s *BillingService) insertChargeInvoice(ctx context.Context, q *generated.Queries, tc model.TenantContext, id uuid.UUID, orderID, kind string, amountVnd int, currency, status, hostedInvoiceURL string) error {
	// Story 9.3 (R2) — PROPAGATE the charge status instead of hardcoding 'paid', so the
	// declined/refunded producer writes the right pill. A blank status defaults to 'paid' (the
	// order.paid / reconciled-checkout callers are successful charges). The declined producer +
	// the declined→paid recovery transition now ship (code-review D3, 2026-10-06).
	if status == "" {
		status = "paid"
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	if currency == "" {
		currency = "VND"
	}
	// Review P-9: ClassLite bills only in integer VND. A non-VND charge (or a minor-unit amount)
	// must not be silently snapshotted as a VND figure — reject so the mismatch surfaces instead
	// of corrupting the invoice / next-invoice card. A permanent error → dead-lettered on the
	// webhook path (P-1), surfaced on the reconcile path.
	if currency != "VND" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "currency", Message: "unsupported charge currency: " + currency + " (expected VND)"}}}
	}
	// Review P-7: snapshot the 10%-inclusive VAT split DERIVED from the authoritative amount
	// (never re-read from the plan catalog — D25) so invoices carry subtotal_vnd/vat_vnd for the
	// 9.3 history/export UI instead of NULL. vat = amount - subtotal guarantees an exact re-sum.
	var subtotalVnd, vatVnd pgtype.Int4
	if amountVnd > 0 {
		subtotal := plan.Subtotal(amountVnd)
		subtotalVnd = pgtype.Int4{Int32: int32(subtotal), Valid: true}
		vatVnd = pgtype.Int4{Int32: int32(amountVnd - subtotal), Valid: true}
	}
	// Story 9.3 code-review D4 (2026-10-06) — persist Polar's hosted invoice PDF URL so the s70
	// Download-PDF action (AC15) renders. Only an https URL is stored (toInvoiceRow surfaces pdfUrl
	// only for https); a bare id / empty value stays null and the FE omits the action.
	polarInvoiceID := pgtype.Text{}
	if strings.HasPrefix(hostedInvoiceURL, "https://") {
		polarInvoiceID = pgtype.Text{String: hostedInvoiceURL, Valid: true}
	}
	if _, err := q.InsertInvoice(ctx, generated.InsertInvoiceParams{
		ID:             pgUUID(id),
		CenterID:       pgUUID(centerUUID),
		PolarInvoiceID: polarInvoiceID,
		PolarOrderID:   pgtype.Text{String: orderID, Valid: orderID != ""},
		Kind:           pgtype.Text{String: kind, Valid: true},
		AmountVnd:      int32(amountVnd),
		SubtotalVnd:    subtotalVnd,
		VatVnd:         vatVnd,
		Currency:       currency,
		Status:         status,
		IssuedAt:       pgTimestamptz(s.clk.Now()),
	}); err != nil {
		return fmt.Errorf("insert invoice: %w", err)
	}
	return nil
}

// centerOwnerUUID looks up the center owner for webhook ledger attribution (D24). A center with
// no owner is a handled typed error (→ 500 mapped, but NOT a uuid.Nil FK-violation retry loop).
func (s *BillingService) centerOwnerUUID(ctx context.Context, q *generated.Queries, centerUUID uuid.UUID) (uuid.UUID, error) {
	owner, err := q.GetCenterOwnerUserID(ctx, pgUUID(centerUUID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, fmt.Errorf("center %s has no owner for ledger attribution", centerUUID)
		}
		return uuid.Nil, fmt.Errorf("lookup center owner: %w", err)
	}
	return uuid.UUID(owner.Bytes), nil
}

// latestLedgerBalance returns the newest ledger balance_after (0 on an empty ledger) — the
// prevBalance the chain-consistent grant/top-up delta is computed against (D14).
func (s *BillingService) latestLedgerBalance(ctx context.Context, q *generated.Queries, centerUUID uuid.UUID) int {
	if bal, err := q.GetLatestLedgerBalanceAfter(ctx, pgUUID(centerUUID)); err == nil {
		return int(bal)
	}
	return 0
}

// --- owner-initiated outbound flows (Polar call OUTSIDE any tx/lock — D21) ------------------

// CreateCheckout opens a Polar hosted checkout for an upgrade or an add-on purchase and returns
// the URL, persisting a pending billing_checkout_intents row (D18 reconcile + D20 tenant anchor)
// AFTER Polar confirms the session. Free centers cannot buy add-ons (403 ADDON_NOT_AVAILABLE,
// no Polar call — D7). NO plan/credit change here: that is webhook-driven (D2/D8). The Polar
// call runs outside any DB tx (D21) so a failure leaves nothing half-written.
func (s *BillingService) CreateCheckout(ctx context.Context, tc model.TenantContext, kind, planName, cycle, addonPackID string) (string, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return "", &ForbiddenError{Reason: "invalid tenant context"}
	}
	tier, err := s.currentTier(ctx, tc)
	if err != nil {
		return "", err
	}

	var (
		params      polar.CheckoutParams
		priceVnd    int
		targetPlan  pgtype.Text
		targetCycle pgtype.Text
		addonPack   pgtype.Text
	)
	params.CenterID = tc.CenterID
	params.Kind = kind
	params.SuccessURL = s.checkoutSuccessURL // AC3: carries the FE's ?checkout=success return param.
	params.Metadata = map[string]string{"center_id": tc.CenterID}

	switch kind {
	case "addon":
		pack := plan.AddonPackByID(addonPackID)
		if pack.Credits == 0 || !pack.AvailableFor(tier) {
			// Eligibility, not payment (D7) — no Polar call.
			return "", AddonNotAvailableError{Pack: addonPackID, Tier: string(tier)}
		}
		priceVnd = pack.PriceForTier(tier)
		params.AddonPackID = addonPackID
		params.PriceVnd = priceVnd
		params.Metadata["addon_pack_id"] = addonPackID
		addonPack = pgtype.Text{String: addonPackID, Valid: true}
	case "upgrade", "plan_upgrade":
		target := plan.Tier(planName)
		if !plan.IsValid(target) || target == plan.Free {
			return "", model.ValidationError{Fields: []model.FieldError{{Field: "plan", Message: "invalid upgrade target"}}}
		}
		if cycle != "monthly" && cycle != "annual" {
			return "", model.ValidationError{Fields: []model.FieldError{{Field: "billingCycle", Message: "must be 'monthly' or 'annual'"}}}
		}
		params.Plan = planName
		params.Cycle = cycle
		targetPlan = pgtype.Text{String: planName, Valid: true}
		targetCycle = pgtype.Text{String: cycle, Valid: true}
		kind = "upgrade"
		params.Kind = "upgrade"
	default:
		return "", model.ValidationError{Fields: []model.FieldError{{Field: "kind", Message: "must be 'upgrade' or 'addon'"}}}
	}

	if s.polar == nil {
		return "", fmt.Errorf("create checkout: no polar client configured")
	}
	// Polar call OUTSIDE any tx (D21).
	res, err := s.polar.CreateCheckout(ctx, params)
	if err != nil {
		return "", fmt.Errorf("create checkout: polar: %w", err)
	}

	// Persist the pending intent in a short tenant tx (D18).
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		_, ierr := q.InsertCheckoutIntent(ctx, generated.InsertCheckoutIntentParams{
			CenterID:           pgUUID(centerUUID),
			Kind:               kind,
			TargetPlan:         targetPlan,
			TargetBillingCycle: targetCycle,
			AddonPackID:        addonPack,
			PolarCheckoutID:    pgtype.Text{String: res.CheckoutID, Valid: res.CheckoutID != ""},
		})
		return ierr
	}); err != nil {
		return "", fmt.Errorf("create checkout: persist intent: %w", err)
	}
	return res.CheckoutURL, nil
}

// ScheduleDowngrade records the SINGLE pending downgrade intent (a second schedule replaces the
// first — D26) and schedules the change with Polar at period end (D9). The Polar call runs
// OUTSIDE the tx (D21). Current plan/limits stay active until pending_effective_at.
func (s *BillingService) ScheduleDowngrade(ctx context.Context, tc model.TenantContext, planName, cycle string) error {
	target := plan.Tier(planName)
	if !plan.IsValid(target) {
		return model.ValidationError{Fields: []model.FieldError{{Field: "plan", Message: "unknown plan tier"}}}
	}
	if cycle != "monthly" && cycle != "annual" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "billingCycle", Message: "must be 'monthly' or 'annual'"}}}
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Read the current subscription (own short tx) to schedule with Polar + get the effective-at.
	var sub generated.Subscription
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		var gerr error
		sub, gerr = s.getOrCreateSubscription(ctx, q, tc)
		return gerr
	}); err != nil {
		return err
	}

	// Review P-10: a downgrade target MUST rank strictly below the current plan (AC15). Reject a
	// same-tier or higher ("upgrade") target routed to this endpoint — otherwise it would record a
	// bogus "pending downgrade" and schedule a no-proration tier jump at renewal.
	current := plan.Tier(sub.Plan)
	if tierRank(target) >= tierRank(current) {
		return model.ValidationError{Fields: []model.FieldError{{Field: "plan", Message: "downgrade target must be a lower tier than the current plan"}}}
	}
	// Review P-11: when a Polar client is configured, a paid center with NO bound
	// polar_subscription_id cannot actually be scheduled with Polar — recording a pending
	// downgrade that nothing will ever apply at renewal is a silent lie to the UI. Fail loudly.
	// (With no Polar client — dev/test — the renewal is driven directly via ProcessPolarEvent, so
	// the guard is skipped.)
	if s.polar != nil && current != plan.Free && (!sub.PolarSubscriptionID.Valid || sub.PolarSubscriptionID.String == "") {
		return model.ValidationError{Fields: []model.FieldError{{Field: "subscription", Message: "subscription is not yet linked to Polar; cannot schedule a downgrade"}}}
	}

	// Polar schedule OUTSIDE any tx (D21), best-effort when a client is configured.
	if s.polar != nil && sub.PolarSubscriptionID.Valid && sub.PolarSubscriptionID.String != "" {
		effectiveAt := s.clk.Now()
		if sub.CurrentPeriodEnd.Valid {
			effectiveAt = sub.CurrentPeriodEnd.Time
		}
		if err := s.polar.ScheduleDowngrade(ctx, sub.PolarSubscriptionID.String, planName, cycle, effectiveAt); err != nil {
			return fmt.Errorf("schedule downgrade: polar: %w", err)
		}
	}

	// Persist under the (center,credit) lock (review P-8) so a schedule racing a renewal-apply is
	// serialized.
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
			return err
		}
		return q.SetPendingDowngrade(ctx, generated.SetPendingDowngradeParams{
			PendingPlan:         pgtype.Text{String: planName, Valid: true},
			PendingBillingCycle: pgtype.Text{String: cycle, Valid: true},
			PendingEffectiveAt:  sub.CurrentPeriodEnd,
			CenterID:            pgUUID(centerUUID),
		})
	})
}

// CancelDowngrade clears a pending downgrade and cancels the Polar schedule (D9/D26). Polar call
// outside the tx (D21).
func (s *BillingService) CancelDowngrade(ctx context.Context, tc model.TenantContext) error {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Decide under the (center,credit) lock (review P-8 / D28(d)): serialize against a
	// renewal-apply so a cancel racing the renewal cannot silently "succeed" after the downgrade
	// already fired. No pending downgrade → an honest 422, NOT a silent lying no-op.
	var subID string
	var hadPending bool
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
			return err
		}
		sub, gerr := s.getOrCreateSubscription(ctx, q, tc)
		if gerr != nil {
			return gerr
		}
		hadPending = sub.PendingPlan.Valid
		if sub.PolarSubscriptionID.Valid {
			subID = sub.PolarSubscriptionID.String
		}
		return nil
	}); err != nil {
		return err
	}
	if !hadPending {
		return model.ValidationError{Fields: []model.FieldError{{Field: "downgrade", Message: "no pending downgrade to cancel (already applied or never scheduled)"}}}
	}

	// Polar cancel OUTSIDE the tx (D21).
	if s.polar != nil && subID != "" {
		if err := s.polar.CancelDowngrade(ctx, subID); err != nil {
			return fmt.Errorf("cancel downgrade: polar: %w", err)
		}
	}

	// Clear under the lock, re-checking so a renewal that applied in the gap is reported honestly
	// rather than clobbered.
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if err := s.acquireLock(ctx, q, tc, lockClassCredit); err != nil {
			return err
		}
		sub, gerr := s.getOrCreateSubscription(ctx, q, tc)
		if gerr != nil {
			return gerr
		}
		if !sub.PendingPlan.Valid {
			return model.ValidationError{Fields: []model.FieldError{{Field: "downgrade", Message: "no pending downgrade to cancel (already applied or never scheduled)"}}}
		}
		return q.ClearPendingDowngrade(ctx, pgUUID(centerUUID))
	})
}

// GetProrationPreview proxies Polar's proration preview VERBATIM (D6/D25 — never computed
// locally). Returns Polar's integer-VND breakdown for the s71 modal.
func (s *BillingService) GetProrationPreview(ctx context.Context, tc model.TenantContext, planName, cycle string) (polar.ProrationPreview, error) {
	if s.polar == nil {
		return polar.ProrationPreview{}, fmt.Errorf("proration preview: no polar client configured")
	}
	var subID string
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		sub, gerr := s.getOrCreateSubscription(ctx, q, tc)
		if gerr != nil {
			return gerr
		}
		subID = sub.PolarSubscriptionID.String
		return nil
	}); err != nil {
		return polar.ProrationPreview{}, err
	}
	return s.polar.GetProrationPreview(ctx, polar.ProrationParams{SubscriptionID: subID, TargetPlan: planName, TargetCycle: cycle})
}

// ReconcilePendingCheckouts is the D18 lost-webhook safety net (called on GET /api/billing). For
// each of the center's pending checkout intents it polls Polar (OUTSIDE any tx, D21); a PAID
// checkout is applied EXACTLY ONCE via the same idempotent apply path the webhook uses and the
// intent is marked applied (so a second GET is a pure no-op). Silent when no Polar client.
func (s *BillingService) ReconcilePendingCheckouts(ctx context.Context, tc model.TenantContext) error {
	if s.polar == nil {
		return nil
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}

	var intents []generated.ListPendingCheckoutIntentsRow
	if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		var lerr error
		intents, lerr = q.ListPendingCheckoutIntents(ctx, pgUUID(centerUUID))
		return lerr
	}); err != nil {
		return err
	}

	for _, intent := range intents {
		if !intent.PolarCheckoutID.Valid || intent.PolarCheckoutID.String == "" {
			continue
		}
		resolution, err := s.polar.ResolveCheckout(ctx, intent.PolarCheckoutID.String) // OUTSIDE tx (D21)
		if err != nil {
			slog.Warn("reconcile: polar resolve failed", "checkout_id", intent.PolarCheckoutID.String)
			continue
		}
		if !resolution.Paid {
			continue
		}
		if err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
			return s.applyReconciledCheckoutTx(ctx, q, tc, intent, resolution)
		}); err != nil {
			// Review P-3: isolate per-intent apply failures (log + continue) exactly like the
			// resolve branch above — one bad intent must NEVER brick the whole GET /api/billing.
			slog.Warn("reconcile: apply failed — skipping intent", "checkout_id", intent.PolarCheckoutID.String, "error", err.Error())
			continue
		}
	}
	return nil
}

// applyReconciledCheckoutTx applies a paid-but-unwebhooked checkout (D18) and marks the intent
// applied — idempotent with the webhook path (target-state plan apply + invoice UNIQUE + ledger
// FULL index).
func (s *BillingService) applyReconciledCheckoutTx(ctx context.Context, q *generated.Queries, tc model.TenantContext, intent generated.ListPendingCheckoutIntentsRow, r polar.CheckoutResolution) error {
	switch intent.Kind {
	case "upgrade":
		if r.Subscription != nil {
			sub := r.Subscription
			// nil cancel-sink: reconcile runs in-tx and cannot make the out-of-tx Polar cancel
			// call; a superseded-downgrade cleanup here is left to the subscription-event path.
			// Empty card: the reconcile read (ResolvedSubscription) carries no payment method —
			// the card-on-file is captured on the subscription.updated/active webhook event (AC12).
			if err := s.setPlanFromPolarTx(ctx, q, tc, plan.Tier(sub.Plan), sub.Cycle, sub.ID, sub.PeriodStart, sub.PeriodEnd, "", "", nil); err != nil {
				return err
			}
		}
		if r.Order != nil {
			// The reconcile read (ResolvedSubscription) carries no hosted-invoice URL — the PDF link
			// is populated on the subscription/order webhook event (D4); pass "" here.
			if err := s.insertChargeInvoice(ctx, q, tc, purchaseIDForOrder(r.Order.ID), r.Order.ID, "subscription", r.Order.AmountVnd, r.Order.Currency, "paid", ""); err != nil {
				return err
			}
		}
	case "addon":
		if r.Order != nil && intent.AddonPackID.Valid {
			ev := polarEvent{}
			ev.Data.ID = r.Order.ID
			ev.Data.Amount = r.Order.AmountVnd
			ev.Data.Currency = r.Order.Currency
			ev.Data.Metadata.AddonPackID = intent.AddonPackID.String
			ev.Data.Metadata.CenterID = tc.CenterID
			if err := s.applyOrderPaidTx(ctx, q, tc, ev); err != nil {
				return err
			}
		}
	}
	centerUUID, _ := uuid.Parse(tc.CenterID)
	return q.MarkCheckoutIntentApplied(ctx, generated.MarkCheckoutIntentAppliedParams{
		ID:       intent.ID,
		CenterID: pgUUID(centerUUID),
	})
}

// ProbeGate drives a REAL 9-1a/9-2a gate to emit its exact rejection (Story 9.2a, AC22/D14 —
// FU-9-CONTRACT-402). It is the provider side of the contract lock: the FE's 9-1b typeGuards +
// MSW fixtures were built against an ASSUMED 409/402/403 `details` shape while enforcement was
// dark-OFF; the contract-probe test harness (NewBillingTestServerWithWrites) drives this to
// assert the emitted shape matches. It reuses the SAME Check*/CreateCheckout path the real
// endpoints run — no new emitter. Never wired in main.go (test-harness only).
func (s *BillingService) ProbeGate(ctx context.Context, tc model.TenantContext, gate string, classID *uuid.UUID) error {
	switch gate {
	case "studentsPerClass":
		if classID == nil {
			return model.ValidationError{Fields: []model.FieldError{{Field: "classId", Message: "required for the studentsPerClass gate"}}}
		}
		return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
			return s.CheckStudentPerClass(ctx, q, tc, *classID)
		})
	case "aiCredits":
		// The pre-enqueue credit gate (402 when the balance is exhausted). A Pro center with 0
		// balance 402s BEFORE consuming (idempotency + tier checks pass, balance gate fires).
		return s.CheckAndConsumeCredit(ctx, tc, uuid.New())
	case "addon":
		_, err := s.CreateCheckout(ctx, tc, "addon", "", "", plan.AddonPack500ID)
		return err
	default:
		return model.ValidationError{Fields: []model.FieldError{{Field: "gate", Message: "unknown gate"}}}
	}
}

// AddonOffer is one purchasable pack for the caller's tier (GET /api/billing/addons, D7). Prices
// are the tier-resolved VND (the 500-pack is cheaper on Studio); the VAT split re-sums exactly.
type AddonOffer struct {
	PackID      string
	Credits     int
	PriceVnd    int
	SubtotalVnd int
	VatVnd      int
}

// ListAddons returns the add-on packs available for the caller's tier (D7/AC9). A Free-tier
// center gets AddonNotAvailableError (403 — add-ons are Pro/Studio only), NOT an empty list, so
// the FE renders the upgrade hint rather than a bare "no packs".
func (s *BillingService) ListAddons(ctx context.Context, tc model.TenantContext) ([]AddonOffer, error) {
	tier, err := s.currentTier(ctx, tc)
	if err != nil {
		return nil, err
	}
	packs := plan.AddonPacksForTier(tier)
	if len(packs) == 0 {
		return nil, AddonNotAvailableError{Tier: string(tier)}
	}
	out := make([]AddonOffer, 0, len(packs))
	for _, p := range packs {
		out = append(out, AddonOffer{
			PackID:      p.ID,
			Credits:     p.Credits,
			PriceVnd:    p.PriceForTier(tier),
			SubtotalVnd: p.SubtotalForTier(tier),
			VatVnd:      p.VatForTier(tier),
		})
	}
	return out, nil
}

// PendingDowngradeState reads the current pending downgrade (POST /api/billing/downgrade +
// /cancel responses, AC15/AC17). Returns ("", "", nil, nil) when none is scheduled.
func (s *BillingService) PendingDowngradeState(ctx context.Context, tc model.TenantContext) (planName, cycle string, effectiveAt *time.Time, err error) {
	err = s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		sub, gerr := s.getOrCreateSubscription(ctx, q, tc)
		if gerr != nil {
			return gerr
		}
		if sub.PendingPlan.Valid {
			planName = sub.PendingPlan.String
		}
		if sub.PendingBillingCycle.Valid {
			cycle = sub.PendingBillingCycle.String
		}
		if sub.PendingEffectiveAt.Valid {
			t := sub.PendingEffectiveAt.Time
			effectiveAt = &t
		}
		return nil
	})
	return planName, cycle, effectiveAt, err
}

// CaptureResourceBaselines freezes a center's current live resource counts as the
// FU-9-1-GRANDFATHER high-water baselines (D13), so after enforcement arms the Check* gates
// block only ABOVE max(planMax, baseline) — a downgraded-then-trimmed center re-adds up to where
// it was. One-time per resource (ON CONFLICT DO NOTHING). Captures the center-level seat + class
// counts (the live COUNTs, never a stored counter — D20); the per-class enrollment baseline is a
// scripts/ backfill concern (D13) since studentsPerClass is per-class. NOT auto-invoked in 9-2a
// (prod arming is deferred — D3); a scripts/arm hook calls this at the flip.
func (s *BillingService) CaptureResourceBaselines(ctx context.Context, tc model.TenantContext) error {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return &ForbiddenError{Reason: "invalid tenant context"}
	}
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		return s.captureResourceBaselinesTx(ctx, q, centerUUID)
	})
}

// currentTier reads the center's current plan tier (own short tx).
func (s *BillingService) currentTier(ctx context.Context, tc model.TenantContext) (plan.Tier, error) {
	var tier plan.Tier
	err := s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		sub, gerr := s.getOrCreateSubscription(ctx, q, tc)
		if gerr != nil {
			return gerr
		}
		tier = plan.Tier(sub.Plan)
		return nil
	})
	return tier, err
}

// parsePolarTime parses an RFC3339 Polar timestamp; a blank/unparseable value yields the zero
// time (the caller compares against the stored period — a zero never equals a real start, so it
// is treated as a genuine change, which for a real Polar payload never happens).
func parsePolarTime(s string) time.Time {
	if s == "" {
		return time.Time{}
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}
	}
	return t
}

// normalizePolarCycle maps Polar's recurring-interval vocabulary to our internal billing cycle
// (review P-4). Polar sends month/year (and variants), never our literal monthly/annual — an
// unmapped value returns "" so setPlanFromPolarTx rejects it as a (dead-lettered) ValidationError
// rather than silently treating it as a cycle change. Already-internal values pass through so the
// public SetPlanFromPolar seam (tests) is unaffected.
func normalizePolarCycle(raw string) string {
	switch raw {
	case "month", "monthly":
		return "monthly"
	case "year", "yearly", "annual", "annually":
		return "annual"
	default:
		return ""
	}
}

// tierRank returns the display-order rank of a tier (Free=0 < Pro=1 < Studio=2). An unknown tier
// ranks below Free (-1) so it never passes a "strictly lower than current" comparison (review
// P-10).
func tierRank(t plan.Tier) int {
	for i, x := range plan.AllTiers() {
		if x == t {
			return i
		}
	}
	return -1
}

// uuidString renders a pgtype.UUID as the canonical 8-4-4-4-12 string.
func uuidString(u pgtype.UUID) string {
	return uuid.UUID(u.Bytes).String()
}
