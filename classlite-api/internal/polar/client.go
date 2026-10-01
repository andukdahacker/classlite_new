// Package polar abstracts the Polar.sh billing REST API for Story 9.2a — the FIRST real
// payment integration in the codebase. It mirrors internal/gemini exactly: an interface
// seam (the ONE mock seam), a real HTTPS impl used in production, and a deterministic
// MockClient injected by every PR test. A REAL Polar network call is BANNED from CI
// (D4/D29a — the mock is built from recorded sandbox fixtures; a nightly sandbox contract
// replay + a staging smoke are the arming preconditions, FU-9-POLAR-CONTRACT).
//
// SECRET POSTURE (EDGE-4/R49/D4): POLAR_API_KEY is held ONLY in the real client struct and
// sent in an `Authorization: Bearer` HEADER — never in a URL (so it cannot leak via a
// %w-wrapped request-build error, proxy/LB access logs, or APM URL sampling), a log line, an
// error message, a health check, a serialized config, or a DB row. Response bodies are
// io.LimitReader-capped; timeouts are package consts; wrapped errors carry the HTTP status
// only, never the key or the response body.
//
// API-SURFACE CAVEAT (D4/D29a — assistant knowledge cutoff Jan 2026): Polar's exact endpoint
// paths + request/response JSON shapes drift and MUST be verified against current Polar docs
// at dev time. The Client interface is modeled on OUR needs (checkout create, checkout
// resolve for the D18 reconcile, proration preview, scheduled downgrade + cancel); the real
// impl below adapts those to Polar's actual REST surface and is the piece to reconcile
// against the live sandbox before arming (cite the doc version + record date in the Dev Agent
// Record when the fixtures are captured).
package polar

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// maxResponseBytes caps a Polar response body read so a pathological/compromised upstream
// cannot OOM the API (CQ-3 — no magic values). requestTimeout bounds every call (payment
// APIs are user-facing; a hung Polar call must not exceed the handler deadline).
const (
	maxResponseBytes = 4 << 20 // 4 MiB — Polar payloads are small JSON
	requestTimeout   = 20 * time.Second
	defaultBaseURL   = "https://api.polar.sh"
)

// CheckoutParams is a hosted-checkout create request. Metadata carries the tenant anchor we
// plant so the confirming webhook can resolve center_id (D5/D12): metadata["center_id"] +,
// for an add-on, metadata["addon_pack_id"]. Kind is "upgrade" | "addon".
type CheckoutParams struct {
	CenterID    string
	Kind        string
	Plan        string
	Cycle       string
	AddonPackID string
	PriceVnd    int
	SuccessURL  string
	Metadata    map[string]string
}

// CheckoutResult is what CreateCheckout returns: the hosted URL the FE redirects to and the
// Polar checkout id we persist on the billing_checkout_intents row (the D18 reconcile /
// D20 tenant-resolution anchor).
type CheckoutResult struct {
	CheckoutURL string
	CheckoutID  string
}

// ResolvedOrder is a paid Polar order (the charge behind an invoice snapshot).
type ResolvedOrder struct {
	ID        string
	Status    string
	AmountVnd int
	Currency  string
}

// ResolvedSubscription is a Polar subscription's authoritative state (period bounds honored
// verbatim, D17 — annual included).
type ResolvedSubscription struct {
	ID          string
	Status      string
	Plan        string
	Cycle       string
	OrderID     string
	PeriodStart time.Time
	PeriodEnd   time.Time
}

// CheckoutResolution is the D18 lost-webhook reconcile read: has the checkout been PAID, and
// if so, what order + subscription resulted (so GET /api/billing can apply the change once).
type CheckoutResolution struct {
	Paid         bool
	Order        *ResolvedOrder
	Subscription *ResolvedSubscription
}

// ProrationParams asks Polar to preview a subscription-update proration (D6 — Polar is
// authoritative; we display its number verbatim, never compute it ourselves).
type ProrationParams struct {
	SubscriptionID string
	TargetPlan     string
	TargetCycle    string
}

// ProrationPreview is Polar's proration breakdown, returned to the s71 modal VERBATIM
// (integer VND). We never re-derive any of these from the plan catalog (D6/D25).
type ProrationPreview struct {
	SubtotalVnd      int
	VatVnd           int
	TotalVnd         int
	CreditAppliedVnd int
	ChargedTodayVnd  int
}

// Client is the single Polar mock seam. Every method is proxied through billing_service
// (the FE never calls Polar directly — D5/arch:942). A non-nil error is a provider failure
// the caller surfaces (never a partial state change — outbound calls run OUTSIDE any DB tx,
// D21, so a Polar failure leaves nothing half-written).
type Client interface {
	// CreateCheckout opens a hosted checkout (subscription upgrade or one-time add-on order)
	// and returns the URL + checkout id. NO local state changes here (webhook-driven, D2/D8).
	CreateCheckout(ctx context.Context, p CheckoutParams) (CheckoutResult, error)
	// ResolveCheckout reports whether a checkout has been paid and the resulting order +
	// subscription — the D18 reconcile poll for a lost webhook.
	ResolveCheckout(ctx context.Context, checkoutID string) (CheckoutResolution, error)
	// GetProrationPreview proxies Polar's subscription-update proration preview (D6).
	GetProrationPreview(ctx context.Context, p ProrationParams) (ProrationPreview, error)
	// ScheduleDowngrade schedules a plan change to take effect at period end (D9).
	ScheduleDowngrade(ctx context.Context, subscriptionID, targetPlan, targetCycle string, effectiveAt time.Time) error
	// CancelDowngrade cancels a previously scheduled downgrade (D9/D26).
	CancelDowngrade(ctx context.Context, subscriptionID string) error
}

// httpClient is the real Polar REST client. The API key is held only here and sent in the
// Authorization header (R49). baseURL is overridable for the staging sandbox (D29a).
type httpClient struct {
	apiKey  string
	baseURL string
	http    *http.Client
}

// NewClient builds a production Polar client. The key is never logged/serialized (R49).
func NewClient(apiKey string, opts ...Option) Client {
	c := &httpClient{
		apiKey:  apiKey,
		baseURL: defaultBaseURL,
		http:    &http.Client{Timeout: requestTimeout},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Option customizes the real client (e.g. WithBaseURL for the sandbox contract replay).
type Option func(*httpClient)

// WithBaseURL points the client at an alternate Polar host (the sandbox — FU-9-POLAR-CONTRACT).
func WithBaseURL(base string) Option {
	return func(c *httpClient) {
		if base != "" {
			c.baseURL = base
		}
	}
}

// doJSON performs a JSON request against Polar with the Bearer key in the header (never the
// URL), a LimitReader-capped response, and status-only errors (R49). out may be nil.
func (c *httpClient) doJSON(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("polar: marshal request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	// Path only — the key rides the header so it cannot leak via the %w-wrapped build error.
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return fmt.Errorf("polar: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// Transport failure — do NOT echo the URL/key.
		return fmt.Errorf("polar: request failed")
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Status only — never the response body (may echo request data).
		return fmt.Errorf("polar: unexpected status %d", resp.StatusCode)
	}
	if out == nil {
		return nil
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("polar: read response")
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("polar: decode response")
	}
	return nil
}

// NOTE (D4/D29a): the request/response wire shapes below are modeled on OUR needs and MUST be
// reconciled with current Polar docs before the live arming flip. They are never exercised in
// CI (the mock is the only signal). Kept intentionally thin — the sandbox smoke is where these
// are proven.

func (c *httpClient) CreateCheckout(ctx context.Context, p CheckoutParams) (CheckoutResult, error) {
	reqBody := map[string]any{
		"metadata":    p.Metadata,
		"success_url": p.SuccessURL,
		// product/price identification (plan×cycle or add-on pack) is carried in metadata +
		// the operator-configured Polar product ids (config, A3) — resolved by the caller.
	}
	var out struct {
		ID  string `json:"id"`
		URL string `json:"url"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/v1/checkouts/", reqBody, &out); err != nil {
		return CheckoutResult{}, err
	}
	return CheckoutResult{CheckoutURL: out.URL, CheckoutID: out.ID}, nil
}

func (c *httpClient) ResolveCheckout(ctx context.Context, checkoutID string) (CheckoutResolution, error) {
	var out struct {
		Status         string `json:"status"`
		SubscriptionID string `json:"subscription_id"`
		OrderID        string `json:"order_id"`
	}
	if err := c.doJSON(ctx, http.MethodGet, "/v1/checkouts/"+checkoutID, nil, &out); err != nil {
		return CheckoutResolution{}, err
	}
	res := CheckoutResolution{Paid: out.Status == "succeeded" || out.Status == "confirmed"}
	// A real impl would then GET the order + subscription for their amounts/period; the mock
	// carries those inline. Left as the sandbox-smoke reconciliation point (D29a).
	return res, nil
}

func (c *httpClient) GetProrationPreview(ctx context.Context, p ProrationParams) (ProrationPreview, error) {
	var out struct {
		Subtotal      int `json:"subtotal_amount"`
		Tax           int `json:"tax_amount"`
		Total         int `json:"total_amount"`
		CreditApplied int `json:"proration_credit"`
		DueToday      int `json:"amount_due"`
	}
	if err := c.doJSON(ctx, http.MethodPost, "/v1/subscriptions/"+p.SubscriptionID+"/proration-preview", map[string]any{
		"plan": p.TargetPlan, "recurring_interval": p.TargetCycle,
	}, &out); err != nil {
		return ProrationPreview{}, err
	}
	return ProrationPreview{
		SubtotalVnd: out.Subtotal, VatVnd: out.Tax, TotalVnd: out.Total,
		CreditAppliedVnd: out.CreditApplied, ChargedTodayVnd: out.DueToday,
	}, nil
}

func (c *httpClient) ScheduleDowngrade(ctx context.Context, subscriptionID, targetPlan, targetCycle string, effectiveAt time.Time) error {
	return c.doJSON(ctx, http.MethodPatch, "/v1/subscriptions/"+subscriptionID, map[string]any{
		"plan": targetPlan, "recurring_interval": targetCycle,
		"proration_behavior": "none", "effective_at": effectiveAt.Format(time.RFC3339),
	}, nil)
}

func (c *httpClient) CancelDowngrade(ctx context.Context, subscriptionID string) error {
	return c.doJSON(ctx, http.MethodPatch, "/v1/subscriptions/"+subscriptionID, map[string]any{
		"cancel_scheduled_changes": true,
	}, nil)
}
