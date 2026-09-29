// Story 9-1a, AC11 + AC30 (single-thread) — the AI-credit balance gate that
// closes FU-11-CREDITCAP. Free tier (0 credits) → every AI job 402s; a 1-credit
// center spends once then 402s (1→0→402). Concurrency is proven separately in
// credit_gate_race_atdd_test.go.
//
// SEAM: (*service.BillingService).CheckAndConsumeCredit(ctx, tc, jobID) error →
//
//	nil on spend; service.InsufficientCreditsError{Available, Required} when
//	available<=0. Uses SetupRawPool (the service owns its own tx; SetupDB's shared
//	tx would nest — see storage_quota_race header).
//
// RED: compile-fails on service.NewBillingServiceWithClock / InsufficientCreditsError.
package test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func TestCreditGate_FreeTierZeroCredits_402(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))

	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New())
	var insufficient service.InsufficientCreditsError
	if !errors.As(err, &insufficient) {
		t.Fatalf("Free-tier AI job: want InsufficientCreditsError (402), got %v", err)
	}
	if insufficient.Available != 0 {
		t.Errorf("Free-tier available: want 0, got %d", insufficient.Available)
	}
}

func TestCreditGate_SingleThread_OneThenZeroThen402(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()
	_, tc := newBillingCenter(t, "pro", 1, 0, 0, billingEpoch.AddDate(0, 1, 0)) // available = 1

	svc := service.NewBillingServiceWithClock(pool, clock.NewMockClock(billingEpoch))

	if err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New()); err != nil {
		t.Fatalf("first consume (available=1) should succeed, got %v", err)
	}
	err := svc.CheckAndConsumeCredit(ctx, tc, uuid.New())
	var insufficient service.InsufficientCreditsError
	if !errors.As(err, &insufficient) {
		t.Fatalf("second consume (available=0) should 402, got %v", err)
	}
}
