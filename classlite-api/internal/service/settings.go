// Package service — Story 2-5a SettingsService.
//
// Owner-only reads + partial-updates against the caller's center row. The
// handler layer asserts `{id} == tc.CenterID` BEFORE dispatching to this
// service (Winston-S3 belt); the service passes `tc.CenterID` (not the
// path id) as the SQL parameter (suspenders). Together they close the
// gap that `centers` is a global-no-RLS table (docs/project-context.md §GO-1).
//
// Updates run inside a transaction with an audit row committed atomically
// via AuditLogger.LogWithinTx — same pattern as Story 2.1 CenterService.
//
// Validation rules (per story AC7 + AC10):
//   - name: 1-120 UTF-8 runes if provided.
//   - contactEmail: parseable via net/mail.ParseAddress if provided.
//   - timezone: must be one of the 30-entry whitelist (see settings_timezone.go).
//   - shortCode: NOT accepted at this layer — the API type omits it.
package service

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	auditActionCenterUpdated = "center.updated"
)

// SettingsService — Owner-only GET + PATCH on /api/centers/{id}.
type SettingsService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewSettingsService constructs a SettingsService bound to the shared pool
// and audit logger. The clock is retained for future scheduled updates
// (Terms/Rooms tabs in 2-5b will benefit from timestamped audit rows).
func NewSettingsService(db AuthDB, audit AuditLogger, clk clock.Clock) *SettingsService {
	return &SettingsService{db: db, audit: audit, clk: clk}
}

// CenterProfile is the canonical wire shape returned by both GetCenter and
// UpdateCenter. Fields mirror the api.yaml `CenterProfile` schema — the
// handler layer marshals this to JSON.
type CenterProfile struct {
	ID                  uuid.UUID
	Name                string
	ShortCode           string
	ContactEmail        *string
	BrandColor          *string
	LogoURL             *string
	Timezone            string
	GoogleMeetConnected bool
	CreatedAt           time.Time
}

// UpdateCenterInput carries the caller's partial-update body. Any absent
// pointer means "leave the column unchanged" (COALESCE pattern in SQL).
//
// D4 (2026-07-15 code review): ClearFields carries the wire-side JSON
// `null` signal. Field name in the slice forces the column to NULL,
// overriding the corresponding *string pointer. Only nullable columns
// (contact_email, brand_color, logo_url) accept clears; the handler
// rejects null on name / timezone with a 422 before dispatching here.
type UpdateCenterInput struct {
	Name         *string
	ContactEmail *string
	BrandColor   *string
	LogoURL      *string
	Timezone     *string
	ClearFields  []string
}

// GetCenter returns the caller's center profile. TenantContext must have
// a non-empty CenterID — validated at the handler layer before dispatch.
func (s *SettingsService) GetCenter(ctx context.Context, tc model.TenantContext) (*CenterProfile, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("get center: parse tenant center id: %w", err)
	}

	q := generated.New(s.db)
	row, err := q.GetCenterByIDInTenant(ctx, pgUUID(centerUUID))
	if err != nil {
		return nil, mapCenterFetchError(err)
	}
	return centerRowToProfile(row), nil
}

// UpdateCenter validates the input, runs the partial UPDATE, and writes
// an audit row atomically. Returns the fully-refreshed profile on success.
func (s *SettingsService) UpdateCenter(
	ctx context.Context,
	tc model.TenantContext,
	in UpdateCenterInput,
) (*CenterProfile, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("update center: parse tenant center id: %w", err)
	}

	if err := validateUpdateCenterInput(in); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update center: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	// SetTenantContext is defensive per Winston-B2 pattern — `centers` has
	// no RLS today, but the audit_logs INSERT below is tenant-scoped and
	// MUST run with SET LOCAL app.current_tenant_id in place.
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("update center: set tenant context: %w", err)
	}

	q := generated.New(tx)

	// Fetch the pre-update snapshot for the audit `before` payload.
	before, err := q.GetCenterByIDInTenant(ctx, pgUUID(centerUUID))
	if err != nil {
		return nil, mapCenterFetchError(err)
	}

	params := generated.UpdateCenterParams{
		ID:           pgUUID(centerUUID),
		ClearFields:  in.ClearFields,
		Name:         optionalText(in.Name),
		ContactEmail: optionalText(in.ContactEmail),
		BrandColor:   optionalText(in.BrandColor),
		LogoUrl:      optionalText(in.LogoURL),
		Timezone:     optionalText(in.Timezone),
	}
	updated, err := q.UpdateCenter(ctx, params)
	if err != nil {
		return nil, mapCenterFetchError(err)
	}

	// Audit atomically with the update. Store the wire-shaped diff so
	// forensics can render "what changed" without joining the row again.
	changes := Changes{
		Before: centerRowToAuditSnapshot(before),
		After:  centerRowToAuditSnapshot(updated),
	}
	if err := s.audit.LogWithinTx(
		ctx, tx, tc,
		auditActionCenterUpdated, auditEntityTypeCenter,
		centerUUID, changes,
	); err != nil {
		return nil, fmt.Errorf("update center: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update center: commit tx: %w", err)
	}

	return centerRowToProfile(updated), nil
}

// mapCenterFetchError converts pgx errors into a model.NotFoundError with
// a CENTER_NOT_FOUND code so the mapper emits the right status. Any other
// error becomes a wrapped internal error.
func mapCenterFetchError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return model.NotFoundError{
			Code:     "CENTER_NOT_FOUND",
			Resource: "center",
		}
	}
	return fmt.Errorf("center fetch: %w", err)
}

// validateUpdateCenterInput enforces the story's field-level constraints.
// Absent fields skip their check; the UPDATE leaves them unchanged.
func validateUpdateCenterInput(in UpdateCenterInput) error {
	var fields []model.FieldError

	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		count := utf8.RuneCountInString(trimmed)
		switch {
		case count < centerNameMinLen:
			fields = append(fields, model.FieldError{Field: "name", Message: "must be at least 1 character"})
		case count > centerNameMaxLen:
			fields = append(fields, model.FieldError{Field: "name", Message: fmt.Sprintf("must be at most %d characters", centerNameMaxLen)})
		}
	}

	// P8 (2026-07-15 code review): reject empty string on nullable fields.
	// The wire contract is: absent = no change, `null` = clear to NULL,
	// non-empty value = set. Empty string is neither a valid value nor a
	// clear signal — it was previously silently persisted as `""` (a
	// third state distinct from NULL and a real email).
	if in.ContactEmail != nil {
		if *in.ContactEmail == "" {
			fields = append(fields, model.FieldError{Field: "contactEmail", Message: "must be null or a valid email address (empty string not accepted)"})
		} else if _, err := mail.ParseAddress(*in.ContactEmail); err != nil {
			fields = append(fields, model.FieldError{Field: "contactEmail", Message: "must be a valid email address"})
		}
	}

	if in.BrandColor != nil && *in.BrandColor == "" {
		fields = append(fields, model.FieldError{Field: "brandColor", Message: "must be null or a non-empty string"})
	}

	if in.LogoURL != nil && *in.LogoURL == "" {
		fields = append(fields, model.FieldError{Field: "logoUrl", Message: "must be null or a non-empty string"})
	}

	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}

	// Timezone check runs AFTER field validation so a caller that sends a
	// bogus timezone plus a bad email gets the sharper 422 UNSUPPORTED_TIMEZONE
	// code (per the story's error catalog — UnsupportedTimezoneError is a
	// distinct pointer type mapped to 422 UNSUPPORTED_TIMEZONE).
	if in.Timezone != nil && !isSupportedTimezone(*in.Timezone) {
		return &UnsupportedTimezoneError{Timezone: *in.Timezone}
	}

	return nil
}

// centerRowToProfile normalizes generated.Center → wire-shaped CenterProfile.
func centerRowToProfile(row generated.Center) *CenterProfile {
	return &CenterProfile{
		ID:                  uuidFromPg(row.ID),
		Name:                row.Name,
		ShortCode:           row.ShortCode,
		ContactEmail:        nullableTextPtr(row.ContactEmail),
		BrandColor:          nullableTextPtr(row.BrandColor),
		LogoURL:             nullableTextPtr(row.LogoUrl),
		Timezone:            row.Timezone,
		GoogleMeetConnected: row.GoogleMeetConnected,
		CreatedAt:           row.CreatedAt.Time,
	}
}

// centerAuditSnapshot is the shape persisted to audit_logs.changes.{before,after}
// for `center.updated`. Pinned so the audit-row test in settings_test.go can
// assert exact wire keys.
type centerAuditSnapshot struct {
	Name         string  `json:"name"`
	ContactEmail *string `json:"contact_email"`
	BrandColor   *string `json:"brand_color"`
	LogoURL      *string `json:"logo_url"`
	Timezone     string  `json:"timezone"`
}

func centerRowToAuditSnapshot(row generated.Center) centerAuditSnapshot {
	return centerAuditSnapshot{
		Name:         row.Name,
		ContactEmail: nullableTextPtr(row.ContactEmail),
		BrandColor:   nullableTextPtr(row.BrandColor),
		LogoURL:      nullableTextPtr(row.LogoUrl),
		Timezone:     row.Timezone,
	}
}

// optionalText wires a caller-optional *string into a pgtype.Text. nil ->
// {Valid: false} means the sqlc `narg` is absent, which COALESCE resolves
// to the existing column value.
func optionalText(p *string) pgtype.Text {
	if p == nil {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: *p, Valid: true}
}

