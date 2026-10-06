// Story 10-1a · Task 0.3 / AC7 / R15 — owner-only billing role-scope at WRITE
// time. The read API is "give me my rows"; correctness depends entirely on the
// subscriber addressing the right user_id. This red is the R15 guard.
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on
//
//	service.NewNotificationService / .Register (n101Wire) and
//	service.NewNotificationService / handler.NewInboxHandler (newInboxSrv),
//	plus service.EnrollmentChangedPayload is the EXISTING production payload.
//
//	· payment.failed  → owner gets exactly ONE payment_failed row; admin gets ZERO.
//	· enrollment.changed → admin AND owner both get an enrollment_changed row
//	  (operational signal is shared; billing is not).
//
// Read back through GET /api/inbox AS each role (AC7's own assertion vehicle).
package test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestNotification_OwnerOnlyBilling_AdminSharesEnrollment_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := qaUUIDFromPg(center.ID)

	owner := qaSeedMember(t, db, centerUUID, "n101-owner@example.com", "The Owner", "owner")
	admin := qaSeedMember(t, db, centerUUID, "n101-admin@example.com", "The Admin", "admin")
	student := qaSeedMember(t, db, centerUUID, "n101-student@example.com", "The Student", "student")
	n101VerifyCenterMembers(t, db, center.ID) // GET /api/inbox requires a verified caller

	// Subscribers + the read server share the SAME *TxDB so the savepoint-committed
	// rows are visible to the HTTP read in the same outer tx.
	bus, _ := n101Wire(t, db, clk, &service.MockEmailSender{})
	srv := newInboxSrv(t, db, clk)
	centerIDStr := UUIDString(center.ID)
	ownerTok := SignAccessTokenForRole(t, qaPgUUID(owner), centerIDStr, "owner")
	adminTok := SignAccessTokenForRole(t, qaPgUUID(admin), centerIDStr, "admin")

	// --- payment.failed → owner only (R15) ---
	bus.Publish(ctx, n101Event(event.PaymentFailed, centerIDStr, "", nil))

	status, ownerEnv := n101GetInbox(t, srv, ownerTok, "")
	if status != http.StatusOK {
		t.Fatalf("owner GET /api/inbox status = %d, want 200", status)
	}
	if got := n101InboxTypeCount(ownerEnv, n101TypePaymentFailed); got != 1 {
		t.Errorf("owner must have exactly 1 payment_failed row, got %d", got)
	}

	status, adminEnv := n101GetInbox(t, srv, adminTok, "")
	if status != http.StatusOK {
		t.Fatalf("admin GET /api/inbox status = %d, want 200", status)
	}
	if got := n101InboxTypeCount(adminEnv, n101TypePaymentFailed); got != 0 {
		t.Errorf("R15 VIOLATION: admin has %d payment_failed rows, must be 0 (billing is owner-only)", got)
	}

	// --- enrollment.changed → admin AND owner both get a row ---
	bus.Publish(ctx, n101Event(event.EnrollmentChanged, centerIDStr, "", service.EnrollmentChangedPayload{
		EnrollmentID: uuid.NewString(),
		StudentID:    UUIDString(qaPgUUID(student)),
		Action:       "withdrawn",
	}))

	_, ownerEnv = n101GetInbox(t, srv, ownerTok, "")
	if got := n101InboxTypeCount(ownerEnv, n101TypeEnrollmentChanged); got != 1 {
		t.Errorf("owner must have exactly 1 enrollment_changed row, got %d", got)
	}
	_, adminEnv = n101GetInbox(t, srv, adminTok, "")
	if got := n101InboxTypeCount(adminEnv, n101TypeEnrollmentChanged); got != 1 {
		t.Errorf("admin must have exactly 1 enrollment_changed row (operational signal is shared), got %d", got)
	}
}
