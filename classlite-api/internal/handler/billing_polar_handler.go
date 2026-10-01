// Package handler — Story 9.2a owner-only billing WRITE + preview endpoints (D5/D6/D7/D9). All
// are mounted on the owner-gated billingChain in main.go (RequireRole "owner" at the edge). The
// FE never calls Polar directly (D5/arch:942): these proxy handler → BillingService →
// internal/polar. The contract-probe handler (ContractProbe) is the AC22 test harness — mounted
// ONLY by NewBillingTestServerWithWrites, never in main.go.
package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/google/uuid"
)

// --- GET /api/billing/addons (AC9, D7) --------------------------------------------------------

type addonOfferDTO struct {
	PackID      string `json:"packId"`
	Credits     int    `json:"credits"`
	PriceVnd    int    `json:"priceVnd"`
	SubtotalVnd int    `json:"subtotalVnd"`
	VatVnd      int    `json:"vatVnd"`
}

// GetAddons lists the add-on packs available for the owner's tier (403 ADDON_NOT_AVAILABLE on Free).
func (h *BillingHandler) GetAddons(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	offers, err := h.svc.ListAddons(r.Context(), tc)
	if err != nil {
		return err
	}
	dtos := make([]addonOfferDTO, 0, len(offers))
	for _, o := range offers {
		dtos = append(dtos, addonOfferDTO{PackID: o.PackID, Credits: o.Credits, PriceVnd: o.PriceVnd, SubtotalVnd: o.SubtotalVnd, VatVnd: o.VatVnd})
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{"addons": dtos})
	return nil
}

// --- POST /api/billing/checkout (AC10/AC13, D5) -----------------------------------------------

type checkoutRequest struct {
	Kind         string `json:"kind"`
	Plan         string `json:"plan"`
	BillingCycle string `json:"billingCycle"`
	AddonPackID  string `json:"addonPackId"`
}

// CreateCheckout opens a Polar hosted checkout (upgrade or add-on) and returns the URL. No local
// plan/credit change — that is webhook-driven (D2/D8).
func (h *BillingHandler) CreateCheckout(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	var req checkoutRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	url, err := h.svc.CreateCheckout(r.Context(), tc, req.Kind, req.Plan, req.BillingCycle, req.AddonPackID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{"checkoutUrl": url})
	return nil
}

// --- GET /api/billing/proration-preview (AC12, D6) --------------------------------------------

// GetProrationPreview proxies Polar's proration preview VERBATIM (never computed locally, D6/D25).
func (h *BillingHandler) GetProrationPreview(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	planName := r.URL.Query().Get("plan")
	cycle := r.URL.Query().Get("billingCycle")
	if planName == "" || cycle == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "plan", Message: "plan and billingCycle are required"}}}
	}
	preview, err := h.svc.GetProrationPreview(r.Context(), tc, planName, cycle)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{
		"targetPlan":         planName,
		"targetBillingCycle": cycle,
		"subtotalVnd":        preview.SubtotalVnd,
		"vatVnd":             preview.VatVnd,
		"totalVnd":           preview.TotalVnd,
		"creditAppliedVnd":   preview.CreditAppliedVnd,
		"chargedTodayVnd":    preview.ChargedTodayVnd,
	})
	return nil
}

// --- POST /api/billing/downgrade + /downgrade/cancel (AC15/AC17, D9) --------------------------

type downgradeRequest struct {
	Plan         string `json:"plan"`
	BillingCycle string `json:"billingCycle"`
}

type pendingDowngradeResponse struct {
	PendingPlan         string     `json:"pendingPlan"`
	PendingBillingCycle string     `json:"pendingBillingCycle"`
	EffectiveAt         *time.Time `json:"effectiveAt"`
}

// ScheduleDowngrade records a pending at-renewal downgrade (no immediate limit change, no deletion).
func (h *BillingHandler) ScheduleDowngrade(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	var req downgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if err := h.svc.ScheduleDowngrade(r.Context(), tc, req.Plan, req.BillingCycle); err != nil {
		return err
	}
	return h.writePendingDowngrade(w, r, tc)
}

// CancelDowngrade clears a pending downgrade (the plan continues unchanged at renewal).
func (h *BillingHandler) CancelDowngrade(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	if err := h.svc.CancelDowngrade(r.Context(), tc); err != nil {
		return err
	}
	return h.writePendingDowngrade(w, r, tc)
}

func (h *BillingHandler) writePendingDowngrade(w http.ResponseWriter, r *http.Request, tc model.TenantContext) error {
	planName, cycle, effectiveAt, err := h.svc.PendingDowngradeState(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, pendingDowngradeResponse{
		PendingPlan: planName, PendingBillingCycle: cycle, EffectiveAt: effectiveAt,
	})
	return nil
}

// --- POST /api/billing/contract-probe (AC22/D14 — TEST HARNESS ONLY, never mounted in main.go) -

type contractProbeRequest struct {
	Gate    string  `json:"gate"`
	ClassID *string `json:"classId"`
}

// ContractProbe drives a real gate so the FU-9-CONTRACT-402 test can assert the emitted 409/402/
// 403 `details` shape (AC22). Mounted ONLY by NewBillingTestServerWithWrites (test harness).
func (h *BillingHandler) ContractProbe(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	var req contractProbeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	var classID *uuid.UUID
	if req.ClassID != nil {
		parsed, err := uuid.Parse(*req.ClassID)
		if err != nil {
			return model.ValidationError{Fields: []model.FieldError{{Field: "classId", Message: "invalid uuid"}}}
		}
		classID = &parsed
	}
	if err := h.svc.ProbeGate(r.Context(), tc, req.Gate, classID); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{"passed": true})
	return nil
}
