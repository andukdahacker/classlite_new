// Package service — Story 2.2 TemplateService.
//
// TemplateService owns the two read/write template surfaces exposed by
// GET /api/templates and POST /api/templates. Spawn (the multi-class fan-out
// endpoint) lives in ClassService because the transactional logic touches
// classes + invites + audit_logs in one tx.
//
// AuthDB reuse: continues the Story 2.1 §Architectural Debt Acknowledged
// pattern (Dev Notes §2). No dedicated TemplateDB interface — that's a
// speculative abstraction until a second consumer materializes.
package service

import (
	"context"
	"fmt"
	"math"
	"math/big"
	"strings"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	templateNameMinLen   = 1
	templateNameMaxLen   = 120
	sessionTitleMinLen   = 1
	sessionTitleMaxLen   = 200
	sessionCountMin      = 1
	sessionCountMax      = 100
	targetBandMin        = 1.0
	targetBandMax        = 9.0
	targetBandStep       = 0.5
	classTemplateEntity  = "class_template"
	classTemplateAction  = "class_template.created"
	classTemplateUpdated = "class_template.updated"
	classTemplateDeleted = "class_template.deleted"
	scopeSystemTemplate  = "system"
	scopeCenterTemplate  = "center"
)

// TemplateService handles list + create custom template.
type TemplateService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewTemplateService constructs a TemplateService bound to the given
// tx-capable DB seam and audit logger. clk is injected for test-driven
// serverTime assertions.
func NewTemplateService(db AuthDB, audit AuditLogger, clk clock.Clock) *TemplateService {
	return &TemplateService{db: db, audit: audit, clk: clk}
}

// ListAccessibleTemplates returns the system-seed + tenant-owned template
// catalog. Runs under a tx so SET LOCAL app.current_tenant_id fires before
// the dual-scope RLS SELECT evaluates.
func (s *TemplateService) ListAccessibleTemplates(ctx context.Context, tc model.TenantContext) ([]model.Template, error) {
	// R2-P19 — validate the tenant claim before any DB work so a bad
	// center_id maps to 403 INVALID_TENANT_CLAIM (AC13) instead of
	// falling through as an internal error.
	if _, err := uuid.Parse(tc.CenterID); err != nil {
		return nil, &InvalidTenantClaimError{}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("list templates: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		// SetTenantContext failure at this point means the SET LOCAL
		// itself failed (DB unreachable, tx aborted), not a bad claim —
		// the pre-parse above covered that. Treat as internal.
		return nil, fmt.Errorf("list templates: set tenant context: %w", err)
	}

	q := generated.New(tx)
	rows, err := q.ListAccessibleTemplates(ctx)
	if err != nil {
		return nil, fmt.Errorf("list templates: query: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("list templates: commit: %w", err)
	}

	out := make([]model.Template, 0, len(rows))
	for _, row := range rows {
		m, err := generatedTemplateToModel(row)
		if err != nil {
			return nil, fmt.Errorf("list templates: decode row: %w", err)
		}
		out = append(out, m)
	}
	return out, nil
}

// CountSystemTemplates returns the number of `center_id IS NULL` templates
// visible to the caller. Handler uses this to detect an incomplete seed
// migration (AC1 500 SEED_INCOMPLETE).
func (s *TemplateService) CountSystemTemplates(templates []model.Template) int {
	n := 0
	for _, t := range templates {
		if t.Scope == scopeSystemTemplate {
			n++
		}
	}
	return n
}

// CreateCustomTemplate inserts a class_templates row and all provided
// template_sessions rows in a SINGLE transaction. LogWithinTx writes a
// class_template.created audit row inside the same tx.
func (s *TemplateService) CreateCustomTemplate(
	ctx context.Context, tc model.TenantContext, in model.CreateTemplateInput,
) (*model.CreateTemplateResponse, error) {
	if err := validateCreateTemplateInput(in); err != nil {
		return nil, err
	}

	// R2-P19 — parse the tenant claim before any DB work so a bad
	// center_id maps to 403 INVALID_TENANT_CLAIM (AC13) rather than
	// leaking through as an internal error from SetTenantContext.
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &InvalidTenantClaimError{}
	}

	templateID := model.NewID()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create template: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		// Pre-parse above covered the bad-claim case; a failure here is
		// a SET LOCAL / DB-transport problem — internal error.
		return nil, fmt.Errorf("create template: set tenant context: %w", err)
	}

	targetBandNumeric, err := floatToNumeric(in.TargetBand)
	if err != nil {
		return nil, fmt.Errorf("create template: encode target band: %w", err)
	}

	q := generated.New(tx)
	tmpl, err := q.CreateCustomTemplate(ctx, generated.CreateCustomTemplateParams{
		ID:           pgUUID(templateID),
		CenterID:     pgUUID(centerUUID),
		Name:         trimName(in.Name),
		TargetBand:   targetBandNumeric,
		PrimarySkill: in.PrimarySkill,
		SessionCount: int32(in.SessionCount),
		Color:        nullableText(in.Color),
	})
	if err != nil {
		return nil, fmt.Errorf("create template: insert row: %w", err)
	}

	sessions := make([]model.TemplateSession, 0, len(in.Sessions))
	for i, s := range in.Sessions {
		row, err := q.CreateTemplateSession(ctx, generated.CreateTemplateSessionParams{
			ID:              pgUUID(model.NewID()),
			TemplateID:      pgUUID(templateID),
			SessionOrder:    int32(i),
			Title:           strings.TrimSpace(s.Title),
			Description:     nullableText(s.Description),
			DurationMinutes: nullableDurationInt4(s.Duration),
		})
		if err != nil {
			return nil, fmt.Errorf("create template: insert session[%d]: %w", i, err)
		}
		sessions = append(sessions, model.TemplateSession{
			ID:           uuidStringFromPg(row.ID),
			Title:        row.Title,
			Description:  nullableTextPtr(row.Description),
			SessionOrder: int(row.SessionOrder),
			Duration:     int4ToIntPtr(row.DurationMinutes),
		})
	}

	// R2-P20 — audit records the value AS PERSISTED (rounded through the
	// numeric(3,1) column), not the raw client input. If the round-trip
	// through pgtype.Numeric can't decode, treat the whole tx as suspect
	// and bubble the error — a corrupt Numeric on a row we just wrote
	// means the driver or column is broken and the audit would lie.
	persistedTargetBand, err := numericToFloat(tmpl.TargetBand)
	if err != nil {
		return nil, fmt.Errorf("create template: decode persisted target band: %w", err)
	}

	changes := Changes{
		Before: nil,
		After: map[string]any{
			"name":          tmpl.Name,
			"target_band":   persistedTargetBand,
			"primary_skill": tmpl.PrimarySkill,
			"session_count": in.SessionCount,
			"color":         nullableTextPtr(tmpl.Color),
		},
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, classTemplateAction, classTemplateEntity, templateID, changes); err != nil {
		return nil, fmt.Errorf("create template: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create template: commit: %w", err)
	}

	return &model.CreateTemplateResponse{
		ID:           templateID.String(),
		Name:         tmpl.Name,
		TargetBand:   in.TargetBand,
		PrimarySkill: tmpl.PrimarySkill,
		SessionCount: int(tmpl.SessionCount),
		Color:        nullableTextPtr(tmpl.Color),
		Scope:        scopeCenterTemplate,
		Sessions:     sessions,
	}, nil
}

// generatedTemplateToModel converts a sqlc ListAccessibleTemplates row into the
// wire-format model.Template. Scope is derived from the nullable center_id;
// UsedCount is the per-tenant class count carried by the query (Story 3.3).
//
// R2-P9 — returns an error when the DB Numeric fails to decode. Silent 0
// would mask a driver/DB bug; callers propagate as INTERNAL_ERROR (500).
func generatedTemplateToModel(row generated.ListAccessibleTemplatesRow) (model.Template, error) {
	scope := scopeSystemTemplate
	if row.CenterID.Valid {
		scope = scopeCenterTemplate
	}
	targetBand, err := numericToFloat(row.TargetBand)
	if err != nil {
		return model.Template{}, fmt.Errorf("decode template %s target_band: %w", uuidStringFromPg(row.ID), err)
	}
	return model.Template{
		ID:           uuidStringFromPg(row.ID),
		Name:         row.Name,
		TargetBand:   targetBand,
		PrimarySkill: row.PrimarySkill,
		SessionCount: int(row.SessionCount),
		Color:        nullableTextPtr(row.Color),
		Scope:        scope,
		UsedCount:    int(row.UsedCount),
	}, nil
}

// validateCreateTemplateInput runs the CreateTemplate-specific validation
// per AC2. Returns model.ValidationError with per-field details.
func validateCreateTemplateInput(in model.CreateTemplateInput) error {
	var fields []model.FieldError

	trimmed := trimName(in.Name)
	nameRunes := utf8.RuneCountInString(trimmed)
	switch {
	case nameRunes < templateNameMinLen:
		fields = append(fields, model.FieldError{Field: "name", Message: "must be at least 1 character"})
	case nameRunes > templateNameMaxLen:
		fields = append(fields, model.FieldError{Field: "name", Message: fmt.Sprintf("must be at most %d characters", templateNameMaxLen)})
	}

	// C1-06 review fix — reject NaN/Inf before the range comparison so a
	// deserialized non-finite float doesn't bypass the guard (NaN comparisons
	// evaluate to false, letting a NaN sail past `< targetBandMin`).
	if math.IsNaN(in.TargetBand) || math.IsInf(in.TargetBand, 0) {
		fields = append(fields, model.FieldError{Field: "targetBand", Message: "must be a finite number"})
	} else if in.TargetBand < targetBandMin || in.TargetBand > targetBandMax {
		fields = append(fields, model.FieldError{Field: "targetBand", Message: fmt.Sprintf("must be between %.1f and %.1f", targetBandMin, targetBandMax)})
	} else {
		// Enforce 0.5 step — allow tiny floating drift.
		step := in.TargetBand / targetBandStep
		if diff := step - math.Round(step); diff > 0.001 || diff < -0.001 {
			fields = append(fields, model.FieldError{Field: "targetBand", Message: "must be in 0.5 steps"})
		}
	}

	if !model.IsValidPrimarySkill(in.PrimarySkill) {
		fields = append(fields, model.FieldError{Field: "primarySkill", Message: "must be one of writing, speaking, listening, reading, listening_reading, all_skills"})
	}

	if in.SessionCount < sessionCountMin || in.SessionCount > sessionCountMax {
		fields = append(fields, model.FieldError{Field: "sessionCount", Message: fmt.Sprintf("must be between %d and %d", sessionCountMin, sessionCountMax)})
	}

	// Single source of truth (AC2): sessions.length MUST equal sessionCount.
	if len(in.Sessions) != in.SessionCount {
		fields = append(fields, model.FieldError{Field: "sessions", Message: fmt.Sprintf("length (%d) must equal sessionCount (%d)", len(in.Sessions), in.SessionCount)})
	}

	for i, s := range in.Sessions {
		title := strings.TrimSpace(s.Title)
		titleRunes := utf8.RuneCountInString(title)
		if titleRunes < sessionTitleMinLen {
			fields = append(fields, model.FieldError{Field: fmt.Sprintf("sessions[%d].title", i), Message: "must be at least 1 character"})
		} else if titleRunes > sessionTitleMaxLen {
			fields = append(fields, model.FieldError{Field: fmt.Sprintf("sessions[%d].title", i), Message: fmt.Sprintf("must be at most %d characters", sessionTitleMaxLen)})
		}
		// CR-3-3 fix — bound the optional session duration here too, mirroring
		// validateUpdateTemplateInput. Without it an out-of-range create-time
		// duration sailed past validation and tripped the DB CHECK → 500 instead
		// of a 422 contract error.
		if s.Duration != nil && (*s.Duration < sessionDurationMin || *s.Duration > sessionDurationMax) {
			fields = append(fields, model.FieldError{Field: fmt.Sprintf("sessions[%d].duration", i), Message: fmt.Sprintf("must be between %d and %d minutes", sessionDurationMin, sessionDurationMax)})
		}
	}

	if in.Color != nil && *in.Color == "" {
		fields = append(fields, model.FieldError{Field: "color", Message: "must be null or a non-empty string"})
	}

	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

// floatToNumeric converts a Go float64 targetBand into a pgtype.Numeric that
// sqlc's :one INSERT will accept. The value comes from validated JSON so it
// always fits into the numeric(3,1) column.
//
// C1-07 review fix — use math.Round instead of a truncating int64() cast.
// Truncation on a deserialized 6.4999999999999… would write 64 (i.e. 6.4)
// instead of 65 (6.5), producing silent band drift on inputs that already
// passed the 0.5-step validation.
//
// R2-P8 — fail-loud on negative scaled result. Upstream validation
// (validateCreateTemplateInput) is the only gate; if a future refactor
// bypasses it, silently clamping to 0 would corrupt data. Returning an
// error forces the caller to surface the bug rather than write junk.
func floatToNumeric(f float64) (pgtype.Numeric, error) {
	scaled := int64(math.Round(f * 10))
	if scaled < 0 {
		return pgtype.Numeric{}, fmt.Errorf("floatToNumeric: negative value %f", f)
	}
	return pgtype.Numeric{
		Int:   big.NewInt(scaled),
		Exp:   -1,
		Valid: true,
	}, nil
}

// numericToFloat converts a pgtype.Numeric read from the DB back into a
// float64 for the wire payload. Guarded against nil / non-finite values.
//
// R2-P9 — surface errors rather than silently returning 0. A silent-0
// on a corrupt Numeric would ship band=0 to the SPA (which validation
// rejects), masking a real DB or driver bug. Callers should map the
// error to INTERNAL_ERROR (500).
func numericToFloat(n pgtype.Numeric) (float64, error) {
	if !n.Valid || n.Int == nil {
		return 0, fmt.Errorf("numericToFloat: invalid Numeric (Valid=%v, Int=%v)", n.Valid, n.Int)
	}
	// Use pgtype's Float64Value for the safe conversion path when available.
	f, err := n.Float64Value()
	if err != nil {
		return 0, fmt.Errorf("numericToFloat: Float64Value: %w", err)
	}
	if !f.Valid {
		return 0, fmt.Errorf("numericToFloat: Float64Value: invalid Float8 result")
	}
	return f.Float64, nil
}

// uuidStringFromPg renders a pgtype.UUID to canonical UUID text.
func uuidStringFromPg(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}

// Compile-time interface assertions so a signature drift on either seam
// surfaces at build time instead of test time.
var (
	_ interface {
		ListAccessibleTemplates(context.Context, model.TenantContext) ([]model.Template, error)
	} = (*TemplateService)(nil)
)
