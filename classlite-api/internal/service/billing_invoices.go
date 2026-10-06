// Story 9.3 — the s70 invoice-history read model (D7/FR-66) over the shipped 9-2a invoices
// table. Owner-gated at the route (billingChain). Money is integer VND, rendered verbatim from
// the snapshotted amount/subtotal/vat (D25 — never re-read from the plan catalog). The PDF is a
// passthrough to Polar's hosted invoice (pdfUrl|null); until a producer populates polar_invoice_id
// with a hosted URL (C3 — FU-9-POLAR-CONTRACT), pdfUrl is null and the FE omits the action.
package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// defaultInvoicePageSize is the page size when the request omits one (XL-2).
	defaultInvoicePageSize = 20
	// maxInvoicePageSize caps the page size (and bounds the email-to-accountant history).
	maxInvoicePageSize = 100
)

// BillingInvoiceRow is one invoice for the s70 history (AC14). Money is integer VND verbatim
// (D25). SubtotalVnd/VatVnd are nil when the snapshot carried no split. PdfUrl is Polar's hosted
// invoice PDF or nil (C3 — the FE omits the Download-PDF action when nil). Status is Polar's
// status (the FE maps it to a pill; the 6-pill taxonomy renders from whatever rows exist).
type BillingInvoiceRow struct {
	ID          uuid.UUID
	Kind        *string
	AmountVnd   int
	SubtotalVnd *int
	VatVnd      *int
	Currency    string
	Status      string
	PdfUrl      *string
	IssuedAt    *time.Time
}

// ListInvoicesPage returns a page of the caller center's invoices, the total matching the
// optional status filter, and the EFFECTIVE page/pageSize the server actually used after
// clamping (AC14; D7). page/pageSize are 1-based (XL-2 — OFFSET = (page-1)*size), clamped to
// sane bounds. Returning the effective values is load-bearing (code-review P1, 2026-10-06): the
// handler must report them in meta.pagination rather than re-deriving the service's default (it
// cannot see defaultInvoicePageSize), which previously made meta wrong on any partial page when
// the caller omitted pageSize. Owner authz is enforced at the route (billingChain, D7). One
// tenant tx (PERF-1) covering the list + count.
func (s *BillingService) ListInvoicesPage(ctx context.Context, tc model.TenantContext, status string, page, pageSize int) (rowsOut []BillingInvoiceRow, total, effPage, effPageSize int, err error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, 0, 0, 0, &ForbiddenError{Reason: "invalid tenant context"}
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = defaultInvoicePageSize
	}
	if pageSize > maxInvoicePageSize {
		pageSize = maxInvoicePageSize
	}
	statusFilter := pgtype.Text{}
	if trimmed := strings.TrimSpace(status); trimmed != "" {
		statusFilter = pgtype.Text{String: trimmed, Valid: true}
	}

	var (
		rows     []generated.Invoice
		rowCount int64
	)
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("list invoices: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, 0, 0, 0, fmt.Errorf("list invoices: %w", err)
	}
	q := generated.New(tx)
	rows, err = q.ListInvoices(ctx, generated.ListInvoicesParams{
		CenterID:  pgUUID(centerUUID),
		Status:    statusFilter,
		RowOffset: int32((page - 1) * pageSize),
		PageSize:  int32(pageSize),
	})
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("list invoices: list: %w", err)
	}
	rowCount, err = q.CountInvoices(ctx, generated.CountInvoicesParams{
		CenterID: pgUUID(centerUUID),
		Status:   statusFilter,
	})
	if err != nil {
		return nil, 0, 0, 0, fmt.Errorf("list invoices: count: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, 0, 0, fmt.Errorf("list invoices: commit: %w", err)
	}

	out := make([]BillingInvoiceRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, toInvoiceRow(r))
	}
	return out, int(rowCount), page, pageSize, nil
}

// toInvoiceRow maps a generated.Invoice to the service row. pdfUrl is surfaced only when
// polar_invoice_id holds an https URL (C3 — a bare id is not a URL; until a producer stores the
// hosted URL, this stays nil and the FE omits the Download-PDF action).
func toInvoiceRow(r generated.Invoice) BillingInvoiceRow {
	row := BillingInvoiceRow{
		ID:        uuid.UUID(r.ID.Bytes),
		AmountVnd: int(r.AmountVnd),
		Currency:  r.Currency,
		Status:    r.Status,
	}
	if r.Kind.Valid {
		k := r.Kind.String
		row.Kind = &k
	}
	if r.SubtotalVnd.Valid {
		v := int(r.SubtotalVnd.Int32)
		row.SubtotalVnd = &v
	}
	if r.VatVnd.Valid {
		v := int(r.VatVnd.Int32)
		row.VatVnd = &v
	}
	if r.IssuedAt.Valid {
		t := r.IssuedAt.Time
		row.IssuedAt = &t
	}
	if r.PolarInvoiceID.Valid && strings.HasPrefix(r.PolarInvoiceID.String, "https://") {
		u := r.PolarInvoiceID.String
		row.PdfUrl = &u
	}
	return row
}
