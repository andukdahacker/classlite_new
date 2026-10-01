// Story 9-2a (Upgrade, Downgrade & AI Credit Add-ons — Polar backend keystone) test helpers.
//
// RED phase: this file is tagged `atdd_red_phase` and excluded from the normal build.
// Verify RED with:  cd classlite-api && go test -tags atdd_red_phase ./internal/test/
// The tagged build COMPILE-FAILS until the green-phase seams land (the compile errors
// live in the 9-2a *_atdd_test.go files, not here — this helpers file is seam-light so it
// stays a stable foundation as the dev removes the tag from each red file at green).
//
// This file is seam-light ON PURPOSE: it uses only stdlib + the already-green Story 9-1a
// helpers (SuperuserPool, UUIDString, NewPGUUIDFromString, newBillingCenter, billingEpoch,
// readAICredits, …). The raw-SQL readers below query the new 9-2a tables (invoices,
// billing_checkout_intents, center_resource_baselines, polar_webhook_events) — those
// tables do not exist yet, so the readers fail at RUNTIME (never reached until green), NOT
// at compile time. The RED signal is the missing Go seams referenced by the test files:
//
//	GREEN-PHASE SEAMS the 9-2a reds compile against (each documented in its test header):
//	  · internal/polar            — Client interface, NewClient, MockClient/NewMockClient
//	  · internal/polarwebhook      — Verify(secret,prevSecret,headers,body,now) + errors
//	  · service.SetPlanFromPolar    — period-from-payload, change-gated apply (D17)
//	  · service.PurchaseAddonCheckout / the addon grant path + AddonNotAvailableError 403 (D7/D8)
//	  · service.CheckAndConsumeCredit tier-eligibility branch (D25)
//	  · store query InsertAddonPurchaseLedgerRow (FULL (ref_purchase_id,reason) index — D22)
//	  · billing_checkout_intents store queries (D18) + reconcile on GET /api/billing
//	  · migrations: invoices (+UNIQUE polar_order_id), billing_checkout_intents,
//	    center_resource_baselines, polar_webhook_events (no RLS), subscriptions
//	    pending_* cols + widened status CHECK
//	  · handler: the webhook receiver + NewBillingTestServerWithWebhook (origin-bypassed)
//
// Convention notes:
//
//	· Standard-Webhooks HMAC = base64(HMAC-SHA256(secret, "{id}.{ts}.{rawBody}")),
//	  signature header value "v1,<base64>" (space-separated list allowed by the spec).
//	· Concurrency reds use SetupRawPool (two committed txns) + a rendezvous barrier, with a
//	  no-guard control PROVEN to double-mutate (D15/Murat).
//	· Value-scan not key-scan: assert the balance VALUE delta, never just a row count.
package test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- Polar test secrets (test-only; never a real key) --------------------------------

const (
	polarTestSecret     = "whsec_test_current_secret_0123456789abcdef"
	polarTestPrevSecret = "whsec_test_previous_secret_fedcba9876543210"
	polarWrongSecret    = "whsec_test_wrong_secret_deadbeefdeadbeef00"
	// addonPack500Credits / its Pro price are the D7 catalog values the reds assert.
	addonPack500ID        = "credits_500"
	addonPack500Credits   = 500
	addonPack500ProVnd    = 399000
	addonPack100ID        = "credits_100"
	addonPack100Credits   = 100
	webhookMaxSkewSeconds = 300
)

// --- Standard-Webhooks HMAC signing --------------------------------------------------

// signPolarWebhook returns the "webhook-signature" header value for (id, ts, body) under
// secret, in Standard-Webhooks form: "v1,<base64(HMAC-SHA256)>".
func signPolarWebhook(secret, id string, ts int64, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%s.%d.%s", id, ts, body)
	return "v1," + base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// newSignedWebhookRequest builds a POST /api/webhooks/polar request signed with secret.
// Callers mutate headers/body afterwards to exercise the tamper / stale / malformed reds.
func newSignedWebhookRequest(t *testing.T, secret, eventID string, ts int64, body []byte) *http.Request {
	t.Helper()
	req := newRawWebhookRequest(t, body)
	req.Header.Set("webhook-id", eventID)
	req.Header.Set("webhook-timestamp", strconv.FormatInt(ts, 10))
	req.Header.Set("webhook-signature", signPolarWebhook(secret, eventID, ts, body))
	return req
}

// newRawWebhookRequest builds an UNSIGNED POST to the webhook route (no webhook-* headers,
// no Origin — a genuine Polar server-to-server shape). Used by the origin-bypass +
// missing-header reds.
func newRawWebhookRequest(t *testing.T, body []byte) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "/api/webhooks/polar", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("build webhook request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return req
}

// --- Polar event payload builders (mirror the Polar webhook envelope) ----------------

// polarOrderPaidAddon builds an `order.paid` event JSON for a one-time add-on purchase,
// carrying metadata.center_id + metadata.addon_pack_id (the D5 checkout metadata) and a
// stable polar_order_id (the D19 invoice idempotency key).
func polarOrderPaidAddon(centerID pgtype.UUID, orderID, packID string, amountVnd int) []byte {
	return mustJSON(map[string]any{
		"type": "order.paid",
		"data": map[string]any{
			"id":       orderID,
			"amount":   amountVnd,
			"currency": "VND",
			"metadata": map[string]any{"center_id": UUIDString(centerID), "addon_pack_id": packID},
		},
	})
}

// polarSubscriptionUpdated builds a `subscription.updated` event for a plan change,
// carrying the AUTHORITATIVE period bounds (D17 — the code must adopt these, not invent
// now+1month) and metadata.center_id for first-event tenant resolution (D20).
func polarSubscriptionUpdated(centerID pgtype.UUID, polarSubID, plan, cycle string, periodStart, periodEnd time.Time) []byte {
	return mustJSON(map[string]any{
		"type": "subscription.updated",
		"data": map[string]any{
			"id":                   polarSubID,
			"status":               "active",
			"product_plan":         plan,
			"recurring_interval":   cycle,
			"current_period_start": periodStart.Format(time.RFC3339),
			"current_period_end":   periodEnd.Format(time.RFC3339),
			"metadata":             map[string]any{"center_id": UUIDString(centerID)},
		},
	})
}

// polarSubscriptionUpdatedForOrder is the SECOND event of the same upgrade charge (a
// distinct webhook-id) — the D19 multi-event double-grant red pairs it with the order.paid
// for one orderID to prove exactly one grant/invoice.
func polarSubscriptionUpdatedForOrder(centerID pgtype.UUID, polarSubID, plan, cycle, orderID string, periodStart, periodEnd time.Time) []byte {
	ev := map[string]any{
		"type": "subscription.updated",
		"data": map[string]any{
			"id":                   polarSubID,
			"status":               "active",
			"product_plan":         plan,
			"recurring_interval":   cycle,
			"order_id":             orderID,
			"current_period_start": periodStart.Format(time.RFC3339),
			"current_period_end":   periodEnd.Format(time.RFC3339),
			"metadata":             map[string]any{"center_id": UUIDString(centerID)},
		},
	}
	return mustJSON(ev)
}

// --- Raw readers for the new 9-2a tables (superuser, no RLS; RUNTIME-only until green) --

func countInvoices(t *testing.T, centerID pgtype.UUID) int {
	return scanCount(t, `SELECT count(*) FROM invoices WHERE center_id = $1`, centerID)
}

func countInvoicesByOrder(t *testing.T, orderID string) int {
	return scanCount(t, `SELECT count(*) FROM invoices WHERE polar_order_id = $1`, orderID)
}

func countWebhookEvents(t *testing.T, eventID string) int {
	return scanCount(t, `SELECT count(*) FROM polar_webhook_events WHERE event_id = $1`, eventID)
}

// readAddonRemaining is a value-scan shortcut (D22 — assert the balance VALUE, not a row count).
func readAddonRemaining(t *testing.T, centerID pgtype.UUID) int {
	return readAICredits(t, centerID).Addon
}

func readSubscriptionPlan(t *testing.T, centerID pgtype.UUID) (plan, cycle, status string, polarSubID *string) {
	t.Helper()
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT plan, billing_cycle, status, polar_subscription_id FROM subscriptions WHERE center_id = $1`,
		centerID,
	).Scan(&plan, &cycle, &status, &polarSubID); err != nil {
		t.Fatalf("read subscription: %v", err)
	}
	return
}

func readSubscriptionPeriodEnd(t *testing.T, centerID pgtype.UUID) time.Time {
	t.Helper()
	var end time.Time
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT current_period_end FROM subscriptions WHERE center_id = $1`, centerID,
	).Scan(&end); err != nil {
		t.Fatalf("read period_end: %v", err)
	}
	return end
}

func readPendingDowngrade(t *testing.T, centerID pgtype.UUID) (plan *string, effectiveAt *time.Time) {
	t.Helper()
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT pending_plan, pending_effective_at FROM subscriptions WHERE center_id = $1`, centerID,
	).Scan(&plan, &effectiveAt); err != nil {
		t.Fatalf("read pending downgrade: %v", err)
	}
	return
}

// pkSetSnapshot captures the full set of PKs for a table filtered by center_id — the D28
// no-delete assertion compares the set before/after a downgrade+renewal (COUNT is fragile:
// a delete+reinsert nets zero).
func pkSetSnapshot(t *testing.T, table string, centerID pgtype.UUID) map[string]struct{} {
	t.Helper()
	rows, err := SuperuserPool(t).Query(context.Background(),
		fmt.Sprintf(`SELECT id::text FROM %s WHERE center_id = $1 ORDER BY id`, table), centerID)
	if err != nil {
		t.Fatalf("pk snapshot %s: %v", table, err)
	}
	defer rows.Close()
	set := make(map[string]struct{})
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan pk %s: %v", table, err)
		}
		set[id] = struct{}{}
	}
	return set
}

// assertPKSetPreserved fails if any PK present in `before` is missing from `after` (a row
// was deleted — the R24 violation). Additions are allowed (a renewal may append rows).
func assertPKSetPreserved(t *testing.T, table string, before, after map[string]struct{}) {
	t.Helper()
	for id := range before {
		if _, ok := after[id]; !ok {
			t.Errorf("R24 VIOLATION: %s row %s was DELETED across the downgrade (no-delete invariant)", table, id)
		}
	}
}

// --- small internals ------------------------------------------------------------------

func scanCount(t *testing.T, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := SuperuserPool(t).QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatalf("count query %q: %v", sql, err)
	}
	return n
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic("marshal polar event: " + err.Error())
	}
	return b
}

func newAddonOrderID() string   { return "order_" + uuid.NewString() }
func newPolarSubID() string     { return "sub_" + uuid.NewString() }
func newWebhookEventID() string { return "evt_" + uuid.NewString() }
