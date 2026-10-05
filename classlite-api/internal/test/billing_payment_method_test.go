// Story 9.2b — Task 11 / AC12. The Polar card-on-file is persisted from the webhook and
// surfaced on GET /api/billing.paymentMethod ({brand, last4}, Polar's MASKED descriptor —
// never raw card data, epic:127-130). Covers: capture on a genuine plan change, capture on a
// NON-genuine payment-method-edit (the both-branches case — a same-plan update must still
// persist the card), null when no card, and RLS isolation of the new columns.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestPaymentMethod_CapturedOnGenuinePlanChange(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	// Free → Pro (a genuine change) carrying the card.
	body := polarSubscriptionUpdatedWithCard(centerID, newPolarSubID(), "pro", "monthly", "visa", "4242", billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(context.Background(), "evt-"+uuid.NewString(), "subscription.updated", body); err != nil {
		t.Fatalf("ProcessPolarEvent: %v", err)
	}

	summary, err := svc.GetUsageAndLimits(context.Background(), tc)
	if err != nil {
		t.Fatalf("GetUsageAndLimits: %v", err)
	}
	if summary.PaymentMethod == nil {
		t.Fatalf("paymentMethod is nil, want the persisted card {visa, 4242}")
	}
	if summary.PaymentMethod.Brand != "visa" || summary.PaymentMethod.Last4 != "4242" {
		t.Errorf("paymentMethod = {%s, %s}, want {visa, 4242}", summary.PaymentMethod.Brand, summary.PaymentMethod.Last4)
	}
}

func TestPaymentMethod_CapturedOnNonGenuineUpdate(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	// Already Pro/monthly with the stored period (seedSubscriptionRaw: start=billingEpoch,
	// end=billingEpoch+1mo). A same-plan/cycle/period update is the NON-genuine (payment-method
	// edit) no-op branch — yet the card MUST still persist (the both-branches placement).
	centerID, tc := newBillingCenter(t, "pro", 500, 300, 0, billingEpoch.AddDate(0, 1, 0))
	body := polarSubscriptionUpdatedWithCard(centerID, newPolarSubID(), "pro", "monthly", "mastercard", "1111", billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(context.Background(), "evt-"+uuid.NewString(), "subscription.updated", body); err != nil {
		t.Fatalf("ProcessPolarEvent: %v", err)
	}

	summary, err := svc.GetUsageAndLimits(context.Background(), tc)
	if err != nil {
		t.Fatalf("GetUsageAndLimits: %v", err)
	}
	if summary.PaymentMethod == nil || summary.PaymentMethod.Brand != "mastercard" || summary.PaymentMethod.Last4 != "1111" {
		t.Fatalf("paymentMethod = %+v, want {mastercard, 1111} persisted on a non-genuine update", summary.PaymentMethod)
	}
	// The no-op branch must NOT have touched credits (value-scan: monthly_used stays 300).
	if cr := readAICredits(t, centerID); cr.Used != 300 {
		t.Errorf("monthly_used = %d, want 300 (a payment-method-edit update must be a credit no-op)", cr.Used)
	}
}

func TestPaymentMethod_NullWhenNoCard(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	summary, err := svc.GetUsageAndLimits(context.Background(), tc)
	if err != nil {
		t.Fatalf("GetUsageAndLimits: %v", err)
	}
	if summary.PaymentMethod != nil {
		t.Errorf("paymentMethod = %+v, want nil for a center with no card on file", summary.PaymentMethod)
	}
}

func TestPaymentMethod_EmptyPayloadDoesNotBlankExistingCard(t *testing.T) {
	pool := SetupRawPool(t)
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	centerID, _ := newBillingCenter(t, "pro", 500, 300, 0, billingEpoch.AddDate(0, 1, 0))
	// First a card lands.
	withCard := polarSubscriptionUpdatedWithCard(centerID, newPolarSubID(), "pro", "monthly", "visa", "4242", billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(context.Background(), "evt-"+uuid.NewString(), "subscription.updated", withCard); err != nil {
		t.Fatalf("ProcessPolarEvent set card: %v", err)
	}
	// A later event WITHOUT a card (empty payment_method) must not wipe it.
	noCard := polarSubscriptionUpdated(centerID, newPolarSubID(), "pro", "monthly", billingEpoch, billingEpoch.AddDate(0, 1, 0))
	if err := svc.ProcessPolarEvent(context.Background(), "evt-"+uuid.NewString(), "subscription.updated", noCard); err != nil {
		t.Fatalf("ProcessPolarEvent no card: %v", err)
	}
	brand, last4 := readSubscriptionPaymentMethod(t, centerID)
	if brand == nil || last4 == nil || *brand != "visa" || *last4 != "4242" {
		t.Errorf("card = {%v, %v}, want {visa, 4242} preserved (an absent payload card must not blank it)", brand, last4)
	}
}

// RLS: the new payment_method columns are tenant-isolated — tenant A can never read
// tenant B's stored card (mirrors subscriptions_rls_atdd_test.go for the new columns).
func TestRLS_Subscriptions_PaymentMethod_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	TenantContext(t, db, centerB.ID)
	if err := insertSubscriptionRawTx(t, db, uuid.UUID(centerB.ID.Bytes), "pro"); err != nil {
		t.Fatalf("seed tenant B subscription: %v", err)
	}
	if _, err := db.Exec(ctx,
		`UPDATE subscriptions SET payment_brand = 'visa', payment_last4 = '4242' WHERE center_id = $1`,
		uuid.UUID(centerB.ID.Bytes),
	); err != nil {
		t.Fatalf("set tenant B card: %v", err)
	}

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM subscriptions WHERE center_id = $1 AND payment_last4 = '4242'",
		uuid.UUID(centerB.ID.Bytes),
	).Scan(&visible); err != nil {
		t.Fatalf("count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A read %d of tenant B's card rows, expected 0", visible)
	}
}
