// Package service — Story 3.3 template CRUD (detail / update / soft-delete).
//
// These extend the Story 2.2 TemplateService (list + create). They keep the
// AuthDB seam (no store interface — deliberate, per template.go:8-10) and run
// every DB touch inside a tx so SET LOCAL app.current_tenant_id fires before
// RLS evaluates (GO-1 / PERF-1). Reads stay open to any role with a center;
// the handler layer gates PUT/DELETE to owner+admin via templateWriteChain.
package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	sessionDurationMin = 5
	sessionDurationMax = 600
	sessionsMax        = 100
)

// GetTemplateDetail returns a single template + its ordered sessions + usedCount
// (Story 3.3 AC3, closes FU-3-1-A). RLS-invisible / soft-deleted / cross-tenant
// ids surface as NotFoundError{Code:"TEMPLATE_NOT_FOUND"} → 404 (no metadata
// leak). Open to any role with a center.
func (s *TemplateService) GetTemplateDetail(ctx context.Context, tc model.TenantContext, id uuid.UUID) (*model.TemplateDetail, error) {
	if _, err := uuid.Parse(tc.CenterID); err != nil {
		return nil, &InvalidTenantClaimError{}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("get template detail: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("get template detail: set tenant context: %w", err)
	}

	q := generated.New(tx)
	row, err := q.GetTemplateByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, templateNotFound(id)
		}
		return nil, fmt.Errorf("get template detail: query: %w", err)
	}

	sessions, err := loadTemplateSessions(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("get template detail: commit: %w", err)
	}

	targetBand, err := numericToFloat(row.TargetBand)
	if err != nil {
		return nil, fmt.Errorf("get template detail: decode target band: %w", err)
	}
	return &model.TemplateDetail{
		ID:           uuidStringFromPg(row.ID),
		Name:         row.Name,
		TargetBand:   targetBand,
		PrimarySkill: row.PrimarySkill,
		SessionCount: int(row.SessionCount),
		Color:        nullableTextPtr(row.Color),
		Scope:        scopeFromCenterID(row.CenterID),
		UsedCount:    int(row.UsedCount),
		Sessions:     sessions,
	}, nil
}

// UpdateTemplate does a full-replace update (Story 3.3 AC4): scalars + the
// entire ordered session set in ONE tx. session_count is DERIVED = len(sessions).
// A system-seed (scope "system") is rejected with 403 TEMPLATE_READONLY BEFORE
// the write; a cross-tenant / soft-deleted id is 404 TEMPLATE_NOT_FOUND. Writes
// a class_template.updated audit row in-tx.
func (s *TemplateService) UpdateTemplate(ctx context.Context, tc model.TenantContext, id uuid.UUID, in model.UpdateTemplateInput) (*model.TemplateDetail, error) {
	if err := validateUpdateTemplateInput(in); err != nil {
		return nil, err
	}
	if _, err := uuid.Parse(tc.CenterID); err != nil {
		return nil, &InvalidTenantClaimError{}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("update template: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("update template: set tenant context: %w", err)
	}

	q := generated.New(tx)
	existing, err := q.GetTemplateByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, templateNotFound(id)
		}
		return nil, fmt.Errorf("update template: fetch: %w", err)
	}
	// System seeds (center_id NULL) are immutable — clean 403 before the write,
	// not the confusing 404 the RLS UPDATE policy would otherwise produce.
	if scopeFromCenterID(existing.CenterID) == scopeSystemTemplate {
		return nil, &ForbiddenError{Reason: ReasonTemplateReadOnly}
	}

	targetBandNumeric, err := floatToNumeric(in.TargetBand)
	if err != nil {
		return nil, fmt.Errorf("update template: encode target band: %w", err)
	}

	updated, err := q.UpdateTemplate(ctx, generated.UpdateTemplateParams{
		ID:           pgUUID(id),
		Name:         trimName(in.Name),
		TargetBand:   targetBandNumeric,
		PrimarySkill: in.PrimarySkill,
		SessionCount: int32(len(in.Sessions)),
		Color:        nullableText(in.Color),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Raced against a concurrent soft-delete between fetch and update.
			return nil, templateNotFound(id)
		}
		return nil, fmt.Errorf("update template: update scalars: %w", err)
	}

	// Full replace: clear the old session set, reinsert the new ordered one.
	if err := q.DeleteTemplateSessionsByTemplateID(ctx, pgUUID(id)); err != nil {
		return nil, fmt.Errorf("update template: clear sessions: %w", err)
	}
	sessions := make([]model.TemplateSession, 0, len(in.Sessions))
	for i, sess := range in.Sessions {
		row, err := q.CreateTemplateSession(ctx, generated.CreateTemplateSessionParams{
			ID:              pgUUID(model.NewID()),
			TemplateID:      pgUUID(id),
			SessionOrder:    int32(i),
			Title:           strings.TrimSpace(sess.Title),
			Description:     nullableText(sess.Description),
			DurationMinutes: nullableDurationInt4(sess.Duration),
		})
		if err != nil {
			return nil, fmt.Errorf("update template: insert session[%d]: %w", i, err)
		}
		sessions = append(sessions, generatedSessionToModel(row))
	}

	persistedTargetBand, err := numericToFloat(updated.TargetBand)
	if err != nil {
		return nil, fmt.Errorf("update template: decode persisted target band: %w", err)
	}
	changes := Changes{
		After: map[string]any{
			"name":          updated.Name,
			"target_band":   persistedTargetBand,
			"primary_skill": updated.PrimarySkill,
			"session_count": int(updated.SessionCount),
			"color":         nullableTextPtr(updated.Color),
		},
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, classTemplateUpdated, classTemplateEntity, id, changes); err != nil {
		return nil, fmt.Errorf("update template: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("update template: commit: %w", err)
	}

	return &model.TemplateDetail{
		ID:           uuidStringFromPg(updated.ID),
		Name:         updated.Name,
		TargetBand:   persistedTargetBand,
		PrimarySkill: updated.PrimarySkill,
		SessionCount: int(updated.SessionCount),
		Color:        nullableTextPtr(updated.Color),
		Scope:        scopeCenterTemplate,
		UsedCount:    int(existing.UsedCount), // usedCount is unaffected by an edit
		Sessions:     sessions,
	}, nil
}

// SoftDeleteTemplate archives a center-owned template (Story 3.3 AC4). Sets
// deleted_at so it drops out of every read while spawned classes keep their
// template_id provenance. System-seed → 403 TEMPLATE_READONLY; cross-tenant /
// already-deleted → 404. Writes a class_template.deleted audit row in-tx.
func (s *TemplateService) SoftDeleteTemplate(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	if _, err := uuid.Parse(tc.CenterID); err != nil {
		return &InvalidTenantClaimError{}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("soft delete template: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("soft delete template: set tenant context: %w", err)
	}

	q := generated.New(tx)
	existing, err := q.GetTemplateByID(ctx, pgUUID(id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return templateNotFound(id)
		}
		return fmt.Errorf("soft delete template: fetch: %w", err)
	}
	if scopeFromCenterID(existing.CenterID) == scopeSystemTemplate {
		return &ForbiddenError{Reason: ReasonTemplateReadOnly}
	}

	if _, err := q.SoftDeleteTemplate(ctx, pgUUID(id)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return templateNotFound(id)
		}
		return fmt.Errorf("soft delete template: update: %w", err)
	}

	changes := Changes{
		After: map[string]any{"deleted": true},
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, classTemplateDeleted, classTemplateEntity, id, changes); err != nil {
		return fmt.Errorf("soft delete template: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("soft delete template: commit: %w", err)
	}
	return nil
}

// loadTemplateSessions reads a template's ordered session blueprint.
func loadTemplateSessions(ctx context.Context, q *generated.Queries, id uuid.UUID) ([]model.TemplateSession, error) {
	rows, err := q.ListTemplateSessionsByTemplateID(ctx, pgUUID(id))
	if err != nil {
		return nil, fmt.Errorf("load template sessions: %w", err)
	}
	sessions := make([]model.TemplateSession, 0, len(rows))
	for _, row := range rows {
		sessions = append(sessions, model.TemplateSession{
			ID:           uuidStringFromPg(row.ID),
			Title:        row.Title,
			Description:  nullableTextPtr(row.Description),
			SessionOrder: int(row.SessionOrder),
			Duration:     int4ToIntPtr(row.DurationMinutes),
		})
	}
	return sessions, nil
}

// generatedSessionToModel maps a CreateTemplateSession RETURNING row.
func generatedSessionToModel(row generated.CreateTemplateSessionRow) model.TemplateSession {
	return model.TemplateSession{
		ID:           uuidStringFromPg(row.ID),
		Title:        row.Title,
		Description:  nullableTextPtr(row.Description),
		SessionOrder: int(row.SessionOrder),
		Duration:     int4ToIntPtr(row.DurationMinutes),
	}
}

// templateNotFound builds the 404 TEMPLATE_NOT_FOUND error used for every
// RLS-invisible / soft-deleted / cross-tenant lookup miss (identical surface —
// no metadata leak).
func templateNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "template", ID: id.String(), Code: "TEMPLATE_NOT_FOUND"}
}

// scopeFromCenterID derives the wire scope discriminator from the nullable
// center_id (NULL → system seed, set → tenant-owned).
func scopeFromCenterID(centerID pgtype.UUID) string {
	if centerID.Valid {
		return scopeCenterTemplate
	}
	return scopeSystemTemplate
}

// nullableDurationInt4 encodes an optional minutes value into pgtype.Int4.
func nullableDurationInt4(d *int) pgtype.Int4 {
	if d == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: int32(*d), Valid: true}
}

// int4ToIntPtr decodes a nullable pgtype.Int4 into *int for the wire payload.
func int4ToIntPtr(v pgtype.Int4) *int {
	if !v.Valid {
		return nil
	}
	n := int(v.Int32)
	return &n
}

// validateUpdateTemplateInput mirrors validateCreateTemplateInput but treats
// session_count as DERIVED (sessions.length ≥ 1, ≤ 100) rather than a separate
// input, and validates the optional per-session duration bound.
func validateUpdateTemplateInput(in model.UpdateTemplateInput) error {
	var fields []model.FieldError

	trimmed := trimName(in.Name)
	nameRunes := utf8.RuneCountInString(trimmed)
	switch {
	case nameRunes < templateNameMinLen:
		fields = append(fields, model.FieldError{Field: "name", Message: "must be at least 1 character"})
	case nameRunes > templateNameMaxLen:
		fields = append(fields, model.FieldError{Field: "name", Message: fmt.Sprintf("must be at most %d characters", templateNameMaxLen)})
	}

	if math.IsNaN(in.TargetBand) || math.IsInf(in.TargetBand, 0) {
		fields = append(fields, model.FieldError{Field: "targetBand", Message: "must be a finite number"})
	} else if in.TargetBand < targetBandMin || in.TargetBand > targetBandMax {
		fields = append(fields, model.FieldError{Field: "targetBand", Message: fmt.Sprintf("must be between %.1f and %.1f", targetBandMin, targetBandMax)})
	} else {
		step := in.TargetBand / targetBandStep
		if diff := step - math.Round(step); diff > 0.001 || diff < -0.001 {
			fields = append(fields, model.FieldError{Field: "targetBand", Message: "must be in 0.5 steps"})
		}
	}

	if !model.IsValidPrimarySkill(in.PrimarySkill) {
		fields = append(fields, model.FieldError{Field: "primarySkill", Message: "must be one of writing, speaking, listening, reading, listening_reading, all_skills"})
	}

	switch {
	case len(in.Sessions) < 1:
		fields = append(fields, model.FieldError{Field: "sessions", Message: "must contain at least 1 session"})
	case len(in.Sessions) > sessionsMax:
		fields = append(fields, model.FieldError{Field: "sessions", Message: fmt.Sprintf("must contain at most %d sessions", sessionsMax)})
	}

	for i, sess := range in.Sessions {
		title := strings.TrimSpace(sess.Title)
		titleRunes := utf8.RuneCountInString(title)
		if titleRunes < sessionTitleMinLen {
			fields = append(fields, model.FieldError{Field: fmt.Sprintf("sessions[%d].title", i), Message: "must be at least 1 character"})
		} else if titleRunes > sessionTitleMaxLen {
			fields = append(fields, model.FieldError{Field: fmt.Sprintf("sessions[%d].title", i), Message: fmt.Sprintf("must be at most %d characters", sessionTitleMaxLen)})
		}
		if sess.Duration != nil && (*sess.Duration < sessionDurationMin || *sess.Duration > sessionDurationMax) {
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
