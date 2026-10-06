// Story 9-3 — AC16 / SEC-11: the email-to-accountant path validates + sanitizes the client-
// supplied recipient. Added per the 2026-10-05 party-mode review HIGH finding: no red exercised
// net/mail.ParseAddress + CRLF-strip + subject-cap, so CRLF header injection (BCC smuggling,
// spoofed subjects) would ship with zero gate signal.
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · (svc *service.BillingService).SetEmailSender(service.EmailSender)
//   · (svc *service.BillingService).EmailInvoicesToAccountant(ctx, tc, recipient string) error —
//       renders the center's invoice history and sends it via the EmailSender; MUST reject a
//       recipient that fails net/mail.ParseAddress, strip CRLF from every header field, and cap
//       the subject (SEC-11). Owner-gated at the handler; this is the service-layer sanitization.
//
// RED: compile-fails on svc.SetEmailSender / svc.EmailInvoicesToAccountant.

package test

import (
	"context"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

const sec11SubjectCap = 200 // SEC-11 subject-length cap

// TestEmailInvoices_RejectsCRLFRecipient asserts a CRLF-injected recipient is rejected and NO
// email is sent (no BCC smuggling reaches the sender).
func TestEmailInvoices_RejectsCRLFRecipient(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	sender := &service.MockEmailSender{}
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))
	svc.SetEmailSender(sender)

	_, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))

	injected := "accountant@example.com\r\nBcc: evil@attacker.test"
	err := svc.EmailInvoicesToAccountant(ctx, tc, injected)
	if err == nil {
		t.Error("EmailInvoicesToAccountant accepted a CRLF-injected recipient, want a validation error (SEC-11 / net/mail.ParseAddress)")
	}
	if sender.Count() != 0 {
		t.Errorf("emails sent for an injected recipient = %d, want 0 (nothing must reach the sender)", sender.Count())
	}
}

// TestEmailInvoices_ValidRecipient_CleanHeaders asserts a valid recipient sends exactly one
// email whose To + Subject carry no CRLF and whose subject is within the cap.
func TestEmailInvoices_ValidRecipient_CleanHeaders(t *testing.T) {
	ctx := context.Background()
	pool := SetupRawPool(t)
	sender := &service.MockEmailSender{}
	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))
	svc.SetEmailSender(sender)

	_, tc := newBillingCenter(t, "pro", 500, 0, 0, billingEpoch.AddDate(0, 1, 0))

	if err := svc.EmailInvoicesToAccountant(ctx, tc, "accountant@example.com"); err != nil {
		t.Fatalf("EmailInvoicesToAccountant valid recipient: %v", err)
	}
	sent := sender.Snapshot()
	if len(sent) != 1 {
		t.Fatalf("emails sent = %d, want exactly 1", len(sent))
	}
	e := sent[0]
	if strings.ContainsAny(e.To, "\r\n") || strings.ContainsAny(e.Subject, "\r\n") {
		t.Errorf("CRLF present in To=%q or Subject=%q (SEC-11 strip failed)", e.To, e.Subject)
	}
	if len(e.Subject) > sec11SubjectCap {
		t.Errorf("subject length = %d, want <= %d (SEC-11 cap)", len(e.Subject), sec11SubjectCap)
	}
}
