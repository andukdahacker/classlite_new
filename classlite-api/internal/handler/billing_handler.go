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
	"encoding/json"
	"net/http"
	"strconv"
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

// GetGrace handles GET /api/billing/grace (Story 9.3, R4). Owner+admin (the route gate);
// returns just the grace block (or explicit null when not past_due — GO-5), the scoped s73
// strip source so admin gets the indicator without the owner-only full summary.
func (h *BillingHandler) GetGrace(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	grace, err := h.svc.GetGrace(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, toGraceDTO(grace))
	return nil
}

// ListInvoices handles GET /api/billing/invoices (Story 9.3, AC14). Owner-only (the route
// gate); parses the optional status filter + page/pageSize, returns the paginated history with
// a meta.pagination block (XL-2). Amounts render verbatim (D25).
func (h *BillingHandler) ListInvoices(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	status := r.URL.Query().Get("status")
	page := atoiDefault(r.URL.Query().Get("page"), 1)
	pageSize := atoiDefault(r.URL.Query().Get("pageSize"), 0) // 0 → service default
	// code-review P1 (2026-10-06) — the service returns the EFFECTIVE page/pageSize it used
	// (after clamping + applying its own default); report those in meta, never re-derive them
	// from len(rows) (which was wrong on any partial page when pageSize was omitted).
	rows, total, effPage, effSize, err := h.svc.ListInvoicesPage(r.Context(), tc, status, page, pageSize)
	if err != nil {
		return err
	}
	out := make([]billingInvoiceDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toBillingInvoiceDTO(row))
	}
	totalPages := 0
	if effSize > 0 {
		totalPages = (total + effSize - 1) / effSize
	}
	meta := billingInvoiceListMeta{
		ServerTime: h.clk.Now().UTC(),
		Pagination: PaginationMeta{Page: effPage, PageSize: effSize, Total: total, TotalPages: totalPages},
	}
	// data is the invoice array directly; pagination lives in meta.pagination (XL-2 house pattern).
	WriteEnvelopeWithMeta(w, http.StatusOK, out, meta)
	return nil
}

// EmailInvoices handles POST /api/billing/invoices/email (Story 9.3, AC16). Owner-only; the
// service validates + sanitizes the recipient (SEC-11) and sends the history via Resend.
func (h *BillingHandler) EmailInvoices(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	var body struct {
		Recipient string `json:"recipient"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "recipient", Message: "invalid request body"}}}
	}
	if err := h.svc.EmailInvoicesToAccountant(r.Context(), tc, body.Recipient); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]any{"sent": true})
	return nil
}

// atoiDefault parses a positive query int, falling back to def on empty/invalid.
func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil || n < 1 {
		return def
	}
	return n
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

// Story 9.2a D-DASH wire DTOs (PROVISIONAL — 9-2b co-finalizes; GO-5 explicit null when absent).
type nextInvoiceDTO struct {
	AmountVnd int       `json:"amountVnd"`
	DueDate   time.Time `json:"dueDate"`
}

type paymentMethodDTO struct {
	Brand string `json:"brand"`
	Last4 string `json:"last4"`
}

type pendingDowngradeDTO struct {
	Plan        string    `json:"plan"`
	EffectiveAt time.Time `json:"effectiveAt"`
}

type billingSummaryDTO struct {
	Plan               string               `json:"plan"`
	BillingCycle       string               `json:"billingCycle"`
	Status             string               `json:"status"`
	IsFree             bool                 `json:"isFree"`
	CreditsApplicable  bool                 `json:"creditsApplicable"`
	CurrentPeriodStart time.Time            `json:"currentPeriodStart"`
	CurrentPeriodEnd   *time.Time           `json:"currentPeriodEnd"`
	Limits             billingLimitsDTO     `json:"limits"`
	Usage              billingUsageDTO      `json:"usage"`
	NextInvoice        *nextInvoiceDTO      `json:"nextInvoice"`
	PaymentMethod      *paymentMethodDTO    `json:"paymentMethod"`
	PendingDowngrade   *pendingDowngradeDTO `json:"pendingDowngrade"`
	Grace              *graceDTO            `json:"grace"`
}

// Story 9.3 (D9) — the grace block for the s73 strip. Explicit null when not past_due (GO-5).
type graceDTO struct {
	GraceStartedAt   time.Time `json:"graceStartedAt"`
	GraceEndsAt      time.Time `json:"graceEndsAt"`
	PaymentFailedAt  time.Time `json:"paymentFailedAt"`
	RetryCount       int       `json:"retryCount"`
	RetriesScheduled []int     `json:"retriesScheduled"`
}

// Story 9.3 — the s70 invoice-history wire row + list meta.
type billingInvoiceDTO struct {
	ID          string     `json:"id"`
	Kind        *string    `json:"kind"`
	AmountVnd   int        `json:"amountVnd"`
	SubtotalVnd *int       `json:"subtotalVnd"`
	VatVnd      *int       `json:"vatVnd"`
	Currency    string     `json:"currency"`
	Status      string     `json:"status"`
	PdfUrl      *string    `json:"pdfUrl"`
	IssuedAt    *time.Time `json:"issuedAt"`
}

type billingInvoiceListMeta struct {
	ServerTime time.Time      `json:"serverTime"`
	Pagination PaginationMeta `json:"pagination"`
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
		NextInvoice:      toNextInvoiceDTO(s.NextInvoice),
		PaymentMethod:    toPaymentMethodDTO(s.PaymentMethod),
		PendingDowngrade: toPendingDowngradeDTO(s.PendingDowngrade),
		Grace:            toGraceDTO(s.Grace),
	}
}

func toGraceDTO(g *service.GraceInfo) *graceDTO {
	if g == nil {
		return nil
	}
	scheduled := g.RetriesScheduled
	if scheduled == nil {
		scheduled = []int{}
	}
	return &graceDTO{
		GraceStartedAt:   g.GraceStartedAt,
		GraceEndsAt:      g.GraceEndsAt,
		PaymentFailedAt:  g.PaymentFailedAt,
		RetryCount:       g.RetryCount,
		RetriesScheduled: scheduled,
	}
}

func toBillingInvoiceDTO(r service.BillingInvoiceRow) billingInvoiceDTO {
	return billingInvoiceDTO{
		ID:          r.ID.String(),
		Kind:        r.Kind,
		AmountVnd:   r.AmountVnd,
		SubtotalVnd: r.SubtotalVnd,
		VatVnd:      r.VatVnd,
		Currency:    r.Currency,
		Status:      r.Status,
		PdfUrl:      r.PdfUrl,
		IssuedAt:    r.IssuedAt,
	}
}

func toNextInvoiceDTO(n *service.NextInvoiceInfo) *nextInvoiceDTO {
	if n == nil {
		return nil
	}
	return &nextInvoiceDTO{AmountVnd: n.AmountVnd, DueDate: n.DueDate}
}

func toPaymentMethodDTO(p *service.PaymentMethodInfo) *paymentMethodDTO {
	if p == nil {
		return nil
	}
	return &paymentMethodDTO{Brand: p.Brand, Last4: p.Last4}
}

func toPendingDowngradeDTO(p *service.PendingDowngradeInfo) *pendingDowngradeDTO {
	if p == nil {
		return nil
	}
	return &pendingDowngradeDTO{Plan: p.Plan, EffectiveAt: p.EffectiveAt}
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
