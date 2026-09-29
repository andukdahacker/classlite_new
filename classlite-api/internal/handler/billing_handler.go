// Package handler — Story 9.1a BillingHandler. Two Owner-only reads (D9; the
// RequireRole("owner") gate lives in the route chain, so a non-owner never reaches here
// — 403 at the edge):
//
//	GET /api/billing         current plan + limits + live usage (NO invoice/payment, D-DASH)
//	GET /api/billing/plans   the static VND+VAT tier catalog (display data for 9-1b)
//
// The handler is a thin binding: pull the tenant (GFW-3), call the service, write the
// {data, meta} envelope. Wire DTOs carry explicit json tags with NO omitempty (GO-5):
// an Unlimited limit/max serializes as null (a *int/*int64), never a magic -1.
package handler

import (
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/plan"
	"github.com/ducdo/classlite-api/internal/service"
)

// BillingHandler serves the Owner-only billing reads.
type BillingHandler struct {
	svc *service.BillingService
	clk clock.Clock
}

// NewBillingHandler constructs a BillingHandler.
func NewBillingHandler(svc *service.BillingService, clk clock.Clock) *BillingHandler {
	return &BillingHandler{svc: svc, clk: clk}
}

// GetSummary handles GET /api/billing (AC15).
func (h *BillingHandler) GetSummary(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	summary, err := h.svc.GetUsageAndLimits(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, toBillingSummaryDTO(summary))
	return nil
}

// GetPlans handles GET /api/billing/plans (AC17).
func (h *BillingHandler) GetPlans(w http.ResponseWriter, r *http.Request) error {
	if _, ok := model.TenantFromContext(r.Context()); !ok {
		return ErrTenantContextMissing
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{"plans": toPlanCatalogDTO(h.svc.ListPlans())})
	return nil
}

// --- wire DTOs (GO-5: explicit tags, no omitempty; Unlimited → null via *int) ----------

type billingLimitsDTO struct {
	Teachers          *int  `json:"teachers"`
	Classes           *int  `json:"classes"`
	StudentsPerClass  *int  `json:"studentsPerClass"`
	AICreditsPerMonth *int  `json:"aiCreditsPerMonth"`
	StorageBytes      int64 `json:"storageBytes"`
}

type countMeterDTO struct {
	Current     int  `json:"current"`
	Max         *int `json:"max"`
	Approaching bool `json:"approaching"`
}

type creditMeterDTO struct {
	MonthlyAllocation int       `json:"monthlyAllocation"`
	MonthlyUsed       int       `json:"monthlyUsed"`
	AddonRemaining    int       `json:"addonRemaining"`
	Available         int       `json:"available"`
	ResetAt           time.Time `json:"resetAt"`
}

type storageMeterDTO struct {
	UsedBytes   int64 `json:"usedBytes"`
	LimitBytes  int64 `json:"limitBytes"`
	PercentUsed int   `json:"percentUsed"`
	Approaching bool  `json:"approaching"`
}

type billingUsageDTO struct {
	TeacherSeats countMeterDTO   `json:"teacherSeats"`
	Classes      countMeterDTO   `json:"classes"`
	AICredits    creditMeterDTO  `json:"aiCredits"`
	Storage      storageMeterDTO `json:"storage"`
}

type billingSummaryDTO struct {
	Plan               string           `json:"plan"`
	BillingCycle       string           `json:"billingCycle"`
	Status             string           `json:"status"`
	IsFree             bool             `json:"isFree"`
	CreditsApplicable  bool             `json:"creditsApplicable"`
	CurrentPeriodStart time.Time        `json:"currentPeriodStart"`
	CurrentPeriodEnd   *time.Time       `json:"currentPeriodEnd"`
	Limits             billingLimitsDTO `json:"limits"`
	Usage              billingUsageDTO  `json:"usage"`
}

type planVATDTO struct {
	MonthlySubtotal int `json:"monthlySubtotal"`
	MonthlyVat      int `json:"monthlyVat"`
	AnnualSubtotal  int `json:"annualSubtotal"`
	AnnualVat       int `json:"annualVat"`
}

type planCatalogEntryDTO struct {
	Plan            string           `json:"plan"`
	Limits          billingLimitsDTO `json:"limits"`
	PriceMonthlyVnd int              `json:"priceMonthlyVnd"`
	PriceAnnualVnd  int              `json:"priceAnnualVnd"`
	VAT             planVATDTO       `json:"vat"`
}

// unlimitedToNil maps the plan.Unlimited sentinel (-1) to a JSON null (*int nil).
func unlimitedToNil(v int) *int {
	if v == plan.Unlimited {
		return nil
	}
	return &v
}

func toLimitsDTO(l service.BillingLimits) billingLimitsDTO {
	return billingLimitsDTO{
		Teachers:          unlimitedToNil(l.Teachers),
		Classes:           unlimitedToNil(l.Classes),
		StudentsPerClass:  unlimitedToNil(l.StudentsPerClass),
		AICreditsPerMonth: unlimitedToNil(l.AICreditsPerMonth),
		StorageBytes:      l.StorageBytes,
	}
}

func toCountMeterDTO(m service.CountMeter) countMeterDTO {
	return countMeterDTO{Current: m.Current, Max: unlimitedToNil(m.Max), Approaching: m.Approaching}
}

func toBillingSummaryDTO(s service.BillingSummary) billingSummaryDTO {
	return billingSummaryDTO{
		Plan:               s.Plan,
		BillingCycle:       s.BillingCycle,
		Status:             s.Status,
		IsFree:             s.IsFree,
		CreditsApplicable:  s.CreditsApplicable,
		CurrentPeriodStart: s.CurrentPeriodStart,
		CurrentPeriodEnd:   s.CurrentPeriodEnd,
		Limits:             toLimitsDTO(s.Limits),
		Usage: billingUsageDTO{
			TeacherSeats: toCountMeterDTO(s.TeacherSeats),
			Classes:      toCountMeterDTO(s.Classes),
			AICredits: creditMeterDTO{
				MonthlyAllocation: s.Credits.MonthlyAllocation,
				MonthlyUsed:       s.Credits.MonthlyUsed,
				AddonRemaining:    s.Credits.AddonRemaining,
				Available:         s.Credits.Available,
				ResetAt:           s.Credits.ResetAt,
			},
			Storage: storageMeterDTO{
				UsedBytes:   s.Storage.UsedBytes,
				LimitBytes:  s.Storage.LimitBytes,
				PercentUsed: s.Storage.PercentUsed,
				Approaching: s.Storage.Approaching,
			},
		},
	}
}

func toPlanCatalogDTO(entries []service.PlanCatalogEntry) []planCatalogEntryDTO {
	out := make([]planCatalogEntryDTO, 0, len(entries))
	for _, e := range entries {
		out = append(out, planCatalogEntryDTO{
			Plan:            e.Plan,
			Limits:          toLimitsDTO(e.Limits),
			PriceMonthlyVnd: e.PriceMonthlyVnd,
			PriceAnnualVnd:  e.PriceAnnualVnd,
			VAT: planVATDTO{
				MonthlySubtotal: e.VAT.MonthlySubtotal,
				MonthlyVat:      e.VAT.MonthlyVat,
				AnnualSubtotal:  e.VAT.AnnualSubtotal,
				AnnualVat:       e.VAT.AnnualVat,
			},
		})
	}
	return out
}
