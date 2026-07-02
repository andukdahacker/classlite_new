// Package service — Story 2.1 CenterService.
//
// CreateCenter runs a single transaction that: pre-checks the caller has
// no existing membership (v1 one-center-per-user invariant), pre-generates
// the center UUID in Go so SET LOCAL app.current_tenant_id can fire BEFORE
// any tenant-scoped write, INSERTs into centers with slug + collision
// retry, INSERTs into center_members with role=owner, and calls
// AuditLogger.LogWithinTx inside the same tx so the audit row commits or
// rolls back with the rest of the write.
//
// After the tx commits, MintAccessToken issues a fresh JWT carrying the
// new center + role claims so downstream Epic 2 endpoints don't force a
// re-login.
package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	slugRetryAttempts   = 5
	slugRandomSuffixLen = 4
	fallbackSlugPrefix  = "center-"
	fallbackSlugRandLen = 6

	centerNameMinLen = 1
	centerNameMaxLen = 120

	shortCodeConstraintName    = "idx_centers_short_code"
	memberUserUniqueConstraint = "idx_center_members_user_id"

	auditActionCenterCreated = "center.created"
	auditEntityTypeCenter    = "center"
)

// AuditLogger is the constructor seam CenterService uses to write the
// center.created audit row inside its own transaction (AC6). Production
// wires *AuditService; tests inject a brokenAuditLogger to prove atomicity.
type AuditLogger interface {
	LogWithinTx(
		ctx context.Context,
		tx pgx.Tx,
		tc model.TenantContext,
		action string,
		entityType string,
		entityID uuid.UUID,
		changes any,
	) error
}

// accessTokenIssuer is the second constructor seam CenterService uses to
// mint the fresh access token returned in CreateCenter's response body
// (AC2). Production wires *AuthService; tests inject a mock.
type accessTokenIssuer interface {
	MintAccessToken(
		ctx context.Context,
		userID uuid.UUID,
		centerID *uuid.UUID,
		role string,
	) (string, time.Time, error)
}

// CenterService owns the transactional POST /api/centers path.
type CenterService struct {
	db          AuthDB
	audit       AuditLogger
	tokenIssuer accessTokenIssuer
	clk         clock.Clock
}

// NewCenterService constructs a CenterService with its collaborators
// injected as interfaces so tests can substitute a broken audit or a mock
// token issuer without touching the underlying DB pool.
func NewCenterService(db AuthDB, audit AuditLogger, tokenIssuer accessTokenIssuer, clk clock.Clock) *CenterService {
	return &CenterService{db: db, audit: audit, tokenIssuer: tokenIssuer, clk: clk}
}

// CreateCenterInput carries the caller's raw request body. UserID is
// deliberately absent — the handler sources it from TenantContext.
type CreateCenterInput struct {
	Name       string
	BrandColor *string
	LogoUrl    *string
}

// CreateCenterResult is what the handler renders back to the caller
// (AC2 response body).
type CreateCenterResult struct {
	ID          uuid.UUID
	Name        string
	ShortCode   string
	BrandColor  *string
	LogoUrl     *string
	Timezone    string
	Role        string
	AccessToken string
	ExpiresAt   time.Time
}

// centerAuditChanges is the exact JSONB shape written to
// audit_logs.changes.after. Pinned for AC6's audit shape test.
type centerAuditChanges struct {
	Name       string  `json:"name"`
	ShortCode  string  `json:"short_code"`
	BrandColor *string `json:"brand_color"`
	LogoUrl    *string `json:"logo_url"`
}

// CreateCenter runs the transactional flow described at the top of the
// file. Errors are typed so the handler layer produces the right HTTP
// status (model.ValidationError → 422, model.ConflictError → 409, wrapped
// stdlib error → 500).
func (s *CenterService) CreateCenter(ctx context.Context, userID uuid.UUID, in CreateCenterInput) (*CreateCenterResult, error) {
	if userID == uuid.Nil {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "userId", Message: "authenticated user required"},
		}}
	}
	if err := validateCreateCenterInput(in); err != nil {
		return nil, err
	}

	// Pre-generate the center UUID so SET LOCAL app.current_tenant_id can
	// fire BEFORE the centers INSERT (Winston-B2). This keeps the pattern
	// correct if centers later gains RLS in Epic 5+.
	centerID := model.NewID()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("create center: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	// Pre-check the one-center-per-user invariant. This is the suspenders;
	// idx_center_members_user_id is the belt for the concurrent race.
	q := generated.New(tx)
	count, err := q.CountCenterMembersByUser(ctx, pgUUID(userID))
	if err != nil {
		return nil, fmt.Errorf("create center: count memberships: %w", err)
	}
	if count > 0 {
		return nil, model.ConflictError{
			Code:    "USER_ALREADY_HAS_CENTER",
			Message: "user already owns a center; multi-center is not supported in v1",
		}
	}

	// Set the tenant context to the pre-generated centerID so downstream
	// tenant-scoped writes (center_members, audit_logs) run under RLS.
	// EmailVerified is not set: SetTenantContext does not read it, and
	// asserting a middleware invariant here would silently defeat any
	// future SetTenantContext branch on the field.
	tc := model.TenantContext{
		CenterID: centerID.String(),
		UserID:   userID.String(),
		Role:     "owner",
	}
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("create center: set tenant context: %w", err)
	}

	// Slug retry loop.
	insertedCenter, shortCode, err := s.insertCenterWithSlugRetry(ctx, tx, q, centerID, in)
	if err != nil {
		return nil, err
	}

	// center_members INSERT — remap unique-violation on idx_center_members_user_id
	// to USER_ALREADY_HAS_CENTER (concurrent double-post lost the race).
	if _, err := q.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   pgUUID(userID),
		CenterID: pgUUID(centerID),
		Role:     "owner",
	}); err != nil {
		if isConstraintViolation(err, memberUserUniqueConstraint) {
			return nil, model.ConflictError{
				Code:    "USER_ALREADY_HAS_CENTER",
				Message: "user already owns a center; multi-center is not supported in v1",
			}
		}
		return nil, fmt.Errorf("create center: insert member: %w", err)
	}

	// Audit inside the SAME tx (AC6). LogWithinTx trusts our SET LOCAL —
	// it does NOT re-run SetTenantContext.
	changes := Changes{
		Before: nil,
		After: centerAuditChanges{
			Name:       insertedCenter.Name,
			ShortCode:  shortCode,
			BrandColor: nullableTextPtr(insertedCenter.BrandColor),
			LogoUrl:    nullableTextPtr(insertedCenter.LogoUrl),
		},
	}
	if err := s.audit.LogWithinTx(ctx, tx, tc, auditActionCenterCreated, auditEntityTypeCenter, centerID, changes); err != nil {
		return nil, fmt.Errorf("create center: audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("create center: commit tx: %w", err)
	}

	// Mint the fresh access token OUTSIDE the tx (no DB dep). AC2 rules
	// out forcing a re-login.
	token, expiresAt, err := s.tokenIssuer.MintAccessToken(ctx, userID, &centerID, "owner")
	if err != nil {
		return nil, fmt.Errorf("create center: mint access token: %w", err)
	}

	return &CreateCenterResult{
		ID:          centerID,
		Name:        insertedCenter.Name,
		ShortCode:   insertedCenter.ShortCode,
		BrandColor:  nullableTextPtr(insertedCenter.BrandColor),
		LogoUrl:     nullableTextPtr(insertedCenter.LogoUrl),
		Timezone:    insertedCenter.Timezone,
		Role:        "owner",
		AccessToken: token,
		ExpiresAt:   expiresAt,
	}, nil
}

// insertCenterWithSlugRetry generates the slug from in.Name (falling back
// to a random slug if the input degenerates to "") and INSERTs into
// centers, regenerating the slug on collision up to slugRetryAttempts.
// Each attempt runs inside a SAVEPOINT so a unique-violation does not
// abort the surrounding tx (Postgres 25P02 posture: any error inside a
// tx aborts the whole tx until ROLLBACK TO savepoint / ROLLBACK).
// Returns the freshly-inserted row and the winning slug.
func (s *CenterService) insertCenterWithSlugRetry(
	ctx context.Context,
	tx pgx.Tx,
	q *generated.Queries,
	centerID uuid.UUID,
	in CreateCenterInput,
) (generated.Center, string, error) {
	base := Slugify(in.Name)
	if base == "" {
		base = fallbackSlugPrefix + RandomSuffix(fallbackSlugRandLen)
	}

	slug := base
	var lastErr error
	for attempt := 0; attempt < slugRetryAttempts; attempt++ {
		if _, err := tx.Exec(ctx, "SAVEPOINT slug_attempt"); err != nil {
			return generated.Center{}, "", fmt.Errorf("create center: savepoint: %w", err)
		}
		center, err := q.CreateCenterFull(ctx, generated.CreateCenterFullParams{
			ID:         pgUUID(centerID),
			Name:       in.Name,
			ShortCode:  slug,
			BrandColor: nullableText(in.BrandColor),
			LogoUrl:    nullableText(in.LogoUrl),
		})
		if err == nil {
			if _, relErr := tx.Exec(ctx, "RELEASE SAVEPOINT slug_attempt"); relErr != nil {
				return generated.Center{}, "", fmt.Errorf("create center: release savepoint: %w", relErr)
			}
			return center, slug, nil
		}

		// Something failed — roll back to the savepoint so the outer tx
		// stays usable regardless of whether the failure was a slug
		// collision (retryable) or another constraint (fatal).
		if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT slug_attempt"); rbErr != nil {
			return generated.Center{}, "", fmt.Errorf("create center: rollback to savepoint: %w", rbErr)
		}
		if isConstraintViolation(err, shortCodeConstraintName) {
			// Reserve room for the suffix so truncation doesn't drop it.
			// slugMaxLen − ('-' + RandomSuffix) = room for the base.
			reserved := slugMaxLen - 1 - slugRandomSuffixLen
			truncatedBase := base
			if len(truncatedBase) > reserved {
				truncatedBase = strings.TrimRight(truncatedBase[:reserved], "-")
			}
			slug = truncatedBase + "-" + RandomSuffix(slugRandomSuffixLen)
			lastErr = err
			continue
		}
		return generated.Center{}, "", fmt.Errorf("create center: insert center: %w", err)
	}
	return generated.Center{}, "", fmt.Errorf("create center: slug retry exhausted after %d attempts (last err: %w)", slugRetryAttempts, lastErr)
}

func validateCreateCenterInput(in CreateCenterInput) error {
	var fields []model.FieldError
	trimmed := trimName(in.Name)
	runeCount := utf8.RuneCountInString(trimmed)
	switch {
	case runeCount < centerNameMinLen:
		fields = append(fields, model.FieldError{Field: "name", Message: "must be at least 1 character"})
	case runeCount > centerNameMaxLen:
		fields = append(fields, model.FieldError{Field: "name", Message: fmt.Sprintf("must be at most %d characters", centerNameMaxLen)})
	}
	if in.BrandColor != nil && *in.BrandColor == "" {
		fields = append(fields, model.FieldError{Field: "brandColor", Message: "must be null or a non-empty string"})
	}
	if in.LogoUrl != nil && *in.LogoUrl == "" {
		fields = append(fields, model.FieldError{Field: "logoUrl", Message: "must be null or a non-empty string"})
	}
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

func trimName(s string) string {
	return strings.TrimSpace(s)
}

// isConstraintViolation returns true when err is a pgconn.PgError whose
// SQLSTATE is 23505 (unique_violation) and whose ConstraintName matches
// the caller-supplied one. Constraint-name matching lets the caller
// disambiguate between multiple unique indexes on the same table.
func isConstraintViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	return pgErr.Code == uniqueViolationPgErrorCode && pgErr.ConstraintName == constraint
}

func nullableText(p *string) pgtype.Text {
	if p == nil {
		return pgtype.Text{Valid: false}
	}
	return pgtype.Text{String: *p, Valid: true}
}

func nullableTextPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}
