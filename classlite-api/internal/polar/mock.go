// Story 9.2a — the deterministic Polar mock. It is the ONLY polar.Client exercised in PR
// tests (a real Polar call is BANNED from CI — D4/D29a). Canned responses are configured
// per-test; in production these are built from RECORDED real-sandbox fixtures (cite the
// record date + Polar API version in the Dev Agent Record) and replayed nightly against the
// sandbox to catch provider drift (FU-9-POLAR-CONTRACT).
//
// The mock never logs the API key/secret (R49 — parity with the real client, which holds it
// only in a header).
package polar

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// MockOrder is a canned paid Polar order (the charge behind an invoice snapshot).
type MockOrder struct {
	ID        string
	Status    string
	AmountVnd int
	Currency  string
}

// MockSubscription is a canned Polar subscription state. CheckoutPaid marks it as the paid
// result the D18 reconcile discovers when the confirming webhook was dropped. PeriodStart/End
// are the authoritative bounds the apply adopts verbatim (D17 — annual honored).
type MockSubscription struct {
	ID           string
	Status       string
	Plan         string
	Cycle        string
	OrderID      string
	PeriodStart  time.Time
	PeriodEnd    time.Time
	CheckoutPaid bool
}

// MockConfig configures a MockClient. PaidOrders/Subscriptions are keyed by their Polar ids.
// Proration, when set, is what GetProrationPreview returns verbatim (D6/D28b — deliberately an
// odd number the round-half-up formula could not emit, to prove no local recompute).
type MockConfig struct {
	PaidOrders    map[string]MockOrder
	Subscriptions map[string]MockSubscription
	Proration     *ProrationPreview
	// FailCreateCheckout, when set, makes CreateCheckout return an error (D21 — proves the
	// outbound call runs OUTSIDE any tx: a Polar failure leaves nothing half-written).
	FailCreateCheckout bool
}

// MockClient is a deterministic polar.Client for tests.
type MockClient struct {
	cfg   MockConfig
	mu    sync.Mutex
	calls int
	seq   int
}

// NewMockClient builds a MockClient for the given config.
func NewMockClient(cfg MockConfig) *MockClient { return &MockClient{cfg: cfg} }

// CallCount returns how many Polar calls have been made — the adversarial tests assert Polar
// is NOT called on an ineligible-tier add-on (D7) and is called exactly once on the happy path.
func (m *MockClient) CallCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.calls
}

func (m *MockClient) nextID(prefix string) string {
	m.seq++
	return fmt.Sprintf("%s_mock_%d", prefix, m.seq)
}

// CreateCheckout returns a deterministic hosted URL + checkout id (no real network). The id is
// monotonic per client so concurrent-safe and stable within a test.
func (m *MockClient) CreateCheckout(_ context.Context, _ CheckoutParams) (CheckoutResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.cfg.FailCreateCheckout {
		return CheckoutResult{}, fmt.Errorf("polar: simulated checkout failure")
	}
	id := m.nextID("co")
	return CheckoutResult{CheckoutURL: "https://checkout.polar.sh/mock/" + id, CheckoutID: id}, nil
}

// ResolveCheckout reports the paid subscription (+ its order) the D18 reconcile applies. The
// mock returns the single configured CheckoutPaid subscription (deterministic per-test); a
// config with no paid subscription resolves to Paid=false (nothing to apply yet).
func (m *MockClient) ResolveCheckout(_ context.Context, _ string) (CheckoutResolution, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	for id, sub := range m.cfg.Subscriptions {
		if !sub.CheckoutPaid {
			continue
		}
		rs := &ResolvedSubscription{
			ID: id, Status: sub.Status, Plan: sub.Plan, Cycle: sub.Cycle,
			OrderID: sub.OrderID, PeriodStart: sub.PeriodStart, PeriodEnd: sub.PeriodEnd,
		}
		res := CheckoutResolution{Paid: true, Subscription: rs}
		if ord, ok := m.cfg.PaidOrders[sub.OrderID]; ok {
			res.Order = &ResolvedOrder{ID: ord.ID, Status: ord.Status, AmountVnd: ord.AmountVnd, Currency: ord.Currency}
		}
		return res, nil
	}
	return CheckoutResolution{Paid: false}, nil
}

// GetProrationPreview returns the configured Polar proration verbatim (D6). Absent config → a
// zero preview (the caller displays whatever Polar returns; we never compute it locally).
func (m *MockClient) GetProrationPreview(_ context.Context, _ ProrationParams) (ProrationPreview, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.cfg.Proration != nil {
		return *m.cfg.Proration, nil
	}
	return ProrationPreview{}, nil
}

// ScheduleDowngrade / CancelDowngrade record the outbound call (CallCount) and succeed.
func (m *MockClient) ScheduleDowngrade(_ context.Context, _, _, _ string, _ time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	return nil
}

func (m *MockClient) CancelDowngrade(_ context.Context, _ string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	return nil
}
