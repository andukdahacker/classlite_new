// Story 10-1a · Task 0.2 / AC6 / R3 — the subscriber-tenant-context red (the
// headline worker/async-SET-LOCAL gate).
//
// MUST use SetupRawPool, NOT SetupDB. Under SetupDB the whole test runs in ONE
// pgx.Tx and the NotificationService subscriber's own-tx is a SAVEPOINT on that
// SAME connection; its `SET LOCAL app.current_tenant_id` reverts on savepoint
// RELEASE (audit.go:28-30) — so a SetupDB test greens WITHOUT ever exercising
// production's connection-per-subscriber semantics (false green, Winston/Murat).
// On the raw pool each subscriber genuinely opens its own pooled connection.
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on
//
//	service.NewNotificationService / (*NotificationService).Register
//	(via the n101Wire helper).
//
// Asserts: (a) a tenant-A event lands under tenant A (value-scan the owner's
// payment_failed row); (b) an INDEPENDENT tenant-B RLS session sees ZERO; (c) an
// event with an empty CenterID is rejected by SetTenantContext (no blank-GUC
// fall-through) → no row, no panic.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/service"
)

func TestNotificationSubscriber_WritesUnderEventTenantOnly_ATDD(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	centerA := n101NewCenter(t, 0)
	centerB := n101NewCenter(t, 0)
	ownerA := n101SeedMemberOnPool(t, centerA, "n101-ownerA-"+UUIDString(centerA)[:8]+"@example.com", "Owner A", "owner")
	ownerB := n101SeedMemberOnPool(t, centerB, "n101-ownerB-"+UUIDString(centerB)[:8]+"@example.com", "Owner B", "owner")

	bus, _ := n101Wire(t, pool, clk, &service.MockEmailSender{})

	// Publish a tenant-A billing event. The subscriber must open its OWN tenant-A
	// tx, resolve the owner, and insert exactly one payment_failed row under A.
	bus.Publish(ctx, n101Event(event.PaymentFailed, UUIDString(centerA), "", nil))

	// (a) The row lands under A — value-scan the type/title, not just a count.
	sp := SuperuserPool(t)
	if got := n101CountByType(t, sp, centerA, ownerA, n101TypePaymentFailed); got != 1 {
		t.Fatalf("owner A must have exactly 1 payment_failed row, got %d", got)
	}
	title, _, _, _, found := n101FirstByType(t, sp, centerA, ownerA, n101TypePaymentFailed)
	if !found || title == "" {
		t.Errorf("owner A payment_failed row must carry a non-empty title (value-scan), found=%v title=%q", found, title)
	}

	// (b) An INDEPENDENT tenant-B session sees ZERO of A's rows (R3 cross-tenant
	// write leak probe). Owner B has nothing either.
	if got := n101RLSCountAs(t, centerB, centerA, ownerA); got != 0 {
		t.Errorf("R3 LEAK: a tenant-B session saw %d of tenant-A's notification rows, expected 0", got)
	}
	if got := n101CountByType(t, sp, centerB, ownerB, n101TypePaymentFailed); got != 0 {
		t.Errorf("owner B must have 0 payment_failed rows (no event fired for B), got %d", got)
	}

	// (c) An event with an EMPTY CenterID must be rejected by SetTenantContext
	// (no blank-GUC fall-through writing into some default tenant). The bus
	// swallows the handler error; no row is created; Publish does not panic.
	bus.Publish(ctx, n101Event(event.PaymentFailed, "", "", nil))
	if got := n101CountByType(t, sp, centerA, ownerA, n101TypePaymentFailed); got != 1 {
		t.Errorf("empty-CenterID event must NOT add a row; owner A still expected 1, got %d", got)
	}
}
