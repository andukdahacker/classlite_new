// Package service — Story 1.5 AdminInviteStaff: canonical role
// re-validation guard (AC13 / SEC-1).
//
// AdminInviteStaff is the smallest mutating service method that exercises
// the "re-validate role from DB before mutating" pattern. Future mutating
// services (Epic 7 enrollment, Epic 9 billing, etc.) follow the same
// shape: read the membership row, return *ForbiddenError on miss /
// demotion, and audit the rejection.
//
// Why: a JWT's `role` claim can be up to 15 minutes stale relative to
// the DB (access-token TTL window per EDGE-2). Owner demotions take
// effect immediately on mutating endpoints because of this guard.
//
// Story 2.6 extension (Task 4.1 — SEC-1 pattern preserved verbatim):
//   - allowlist widened from Owner-only to {Owner, Admin} so an Admin
//     caller can invite Teacher / Admin peers;
//   - FR-11 fold: `model.OutranksOwner(dbRole, req.role)` blocks an
//     Admin from assigning the Owner role (returns
//     *RoleAssignmentForbiddenError);
//   - duplicate-active-invite pre-check surfaces *InviteEmailTakenError
//     with `details.field="email"` for inline UX;
//   - happy-path returns the new invite id + expiry so the handler can
//     shape the api.yaml `InviteResult` envelope. Real email delivery
//     remains an Epic 7 concern (FU-2-6-A) — the row is persisted with
//     a hashed placeholder token today.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// inviteTTL is the lifetime applied to invite rows written by
// AdminInviteStaff. Fixed 7 days for the Story 2.6 shipping path; Epic 7
// may parameterize per-tenant policy.
const inviteTTL = 7 * 24 * time.Hour

// maxInviteEmailBytes enforces the api.yaml InviteStaffRequest.email
// maxLength:254 contract server-side — mail.ParseAddress imposes no
// length cap of its own.
const maxInviteEmailBytes = 254

// InviteResult is the caller-facing payload the handler shapes into the
// api.yaml `EnvelopeInviteResult`. Kept intentionally narrow — Epic 7's
// real invite flow will grow the shape when email delivery + resend land.
type InviteResult struct {
	ID        uuid.UUID
	Email     string
	Role      string
	ExpiresAt time.Time
}

// AdminInviteStaff inserts an invites row for `email` with `role`. Story
// 1.5 shipped this hook to lock in the SEC-1 role re-validation pattern;
// Story 2.6 (AC8) widens it to accept Admin callers and enforces FR-11
// via model.OutranksOwner. See package doc for the surgical addition
// summary — the tx choreography (Begin → SET LOCAL → member re-fetch →
// mutate → commit) is preserved verbatim per Winston-INFO fold.
func (s *AuthService) AdminInviteStaff(ctx context.Context, tc model.TenantContext, email, role string) (*InviteResult, error) {
	// Target role validation — must be one of {owner, admin, teacher}.
	// Student rejected at 422 because the accept-invite flow provisions
	// staff seats only; student enrollment goes through a separate
	// endpoint (Epic 7).
	if role != model.RoleOwner && role != model.RoleAdmin && role != model.RoleTeacher {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "role", Message: "must be one of owner, admin, teacher"},
		}}
	}

	// Email shape validation — RFC 5322 lite via net/mail. Canonicalize to
	// the parsed RFC mailbox (lowercased, trimmed) so display-name forms
	// like `Bob <bob@example.com>` dedup against `bob@example.com` and the
	// persisted value matches what the accepting user's normalized address
	// resolves to (Epic 7 accept-invite). This mirrors Login / Register /
	// ResetPassword, which all key on normalizeEmail(parsed.Address).
	parsedEmail, err := mail.ParseAddress(strings.TrimSpace(email))
	if err != nil {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "email", Message: "invalid email format"},
		}}
	}
	normalizedEmail := normalizeEmail(parsedEmail.Address)
	if len(normalizedEmail) > maxInviteEmailBytes {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "email", Message: fmt.Sprintf("must be at most %d characters", maxInviteEmailBytes)},
		}}
	}

	// Parse the JWT-provided IDs. Validation errors here are programming
	// errors (middleware should never inject malformed strings), so map
	// them to 403 rather than 422 to be defensive.
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}

	// Open the tx FIRST, then SET LOCAL app.current_tenant_id, then do
	// the role re-validation READ inside the tenant-scoped session. The
	// previous shape called GetCenterMemberByUserAndCenter via the bare
	// pool — relying on permissive RLS for the read — which would silently
	// start failing when policies tighten.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin invite tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	// Use set_config(name, value, is_local) with a real parameter bind so
	// the value never reaches the SQL parser as concatenated string —
	// future copies of this pattern can't accidentally introduce an
	// injection vector even if the value isn't pre-validated as UUID.
	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerUUID.String()); err != nil {
		return nil, fmt.Errorf("set tenant local: %w", err)
	}

	txQ := generated.New(tx)
	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgtype.UUID{Bytes: userUUID, Valid: true},
		CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Best-effort audit BEFORE rolling back the tx. We don't want
			// to keep the tx open while we wait on a network round-trip
			// to the audit subsystem.
			_ = tx.Rollback(context.WithoutCancel(ctx))
			s.auditRoleRevalidationBlocked(ctx, userUUID, tc.Role, "")
			return nil, &ForbiddenError{Reason: "insufficient role"}
		}
		return nil, fmt.Errorf("get center member: %w", err)
	}
	// SEC-1 defense — allowlist enforced against the DB row, not the
	// JWT claim. `tc.Role` was populated by ExtractTenant which itself
	// resolves from the DB, but the JWT could still hold a stale claim
	// that we're duty-bound to reject on any mutating call.
	if member.Role != model.RoleOwner && member.Role != model.RoleAdmin {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		s.auditRoleRevalidationBlocked(ctx, userUUID, tc.Role, member.Role)
		return nil, &ForbiddenError{Reason: "insufficient role"}
	}
	// FR-11 — only an Owner may assign the Owner role. The middleware
	// (RequireRole("owner","admin")) does not have DB-role state so it
	// cannot distinguish "Owner invites Owner" (fine) from "Admin
	// invites Owner" (blocked). This is the load-bearing gate.
	if model.OutranksOwner(member.Role, role) {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		s.auditRoleAssignmentBlocked(ctx, userUUID, member.Role, role)
		return nil, &RoleAssignmentForbiddenError{}
	}

	// Duplicate-active-invite gate — predicate is aligned EXACTLY with the
	// shipped partial unique index `idx_invites_center_email_active`
	// (WHERE accepted_at IS NULL). Expiry is intentionally NOT in the
	// predicate: the index can't include it (now() is not IMMUTABLE, so
	// Postgres rejects it in a partial-index WHERE), so a gate that checked
	// `expires_at > now` would pass for a lapsed-unaccepted row and then
	// collide at INSERT (23505 → 500). Any unaccepted invite blocks re-send
	// with a clean 409 until it is cleared; FU-2-6-F owns "re-send
	// supersedes a lapsed invite" for Epic 7. Case-insensitive on email.
	var existingCount int
	if err := tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM invites
		 WHERE center_id = $1
		   AND LOWER(email) = LOWER($2)
		   AND accepted_at IS NULL`,
		centerUUID, normalizedEmail,
	).Scan(&existingCount); err != nil {
		return nil, fmt.Errorf("check duplicate invite: %w", err)
	}
	if existingCount > 0 {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, &InviteEmailTakenError{Email: normalizedEmail}
	}

	// Happy path — write the invite. Token + expiry are placeholder
	// values; Epic 7 owns the real invite flow (email send + raw token
	// echo). Story 1.6 migrated invites.token → invites.token_hash so we
	// persist the sha256-hex; the raw token is currently discarded
	// because this synthetic hook doesn't email anyone.
	rawToken, err := newPasswordResetToken() // 32 random bytes, reuse helper
	if err != nil {
		return nil, fmt.Errorf("invite token: %w", err)
	}
	tokenHashBytes := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(tokenHashBytes[:])
	now := s.clk.Now()
	expiresAt := now.Add(inviteTTL)
	var inviteID pgtype.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		centerUUID, userUUID, normalizedEmail, role, tokenHash, expiresAt,
	).Scan(&inviteID); err != nil {
		// Belt-and-suspenders: the app gate above already rejects an active
		// duplicate, but a concurrent invite for the same (center, email)
		// can slip past it and collide on idx_invites_center_email_active.
		// Map the unique violation to the same 409 rather than leaking a
		// 500. pgUniqueViolationCode is the shared "23505" const (room.go).
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode {
			return nil, &InviteEmailTakenError{Email: normalizedEmail}
		}
		return nil, fmt.Errorf("insert invite: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit invite tx: %w", err)
	}

	inviteUUID, err := pgUUIDToGoogle(inviteID)
	if err != nil {
		return nil, fmt.Errorf("convert invite id: %w", err)
	}
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "center.invite.sent",
		EntityType: "invite",
		EntityID:   inviteUUID,
		Changes: Changes{After: map[string]any{
			"email": normalizedEmail,
			"role":  role,
		}},
	})
	return &InviteResult{
		ID:        inviteUUID,
		Email:     normalizedEmail,
		Role:      role,
		ExpiresAt: expiresAt,
	}, nil
}

// auditRoleRevalidationBlocked writes the SEC-1 rejection audit row.
// Reserved for "JWT role claim disagrees with DB role" — the stale-JWT
// defense case tracked as R15.
func (s *AuthService) auditRoleRevalidationBlocked(ctx context.Context, userUUID uuid.UUID, jwtRole, dbRole string) {
	after := map[string]any{}
	if dbRole == "" {
		after["dbRole"] = nil
	} else {
		after["dbRole"] = dbRole
	}
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "auth.role_revalidation_blocked",
		EntityType: "user",
		EntityID:   userUUID,
		Changes: Changes{
			Before: map[string]any{"jwtRole": jwtRole},
			After:  after,
		},
	})
}

// auditRoleAssignmentBlocked writes the FR-11 rejection audit row —
// distinct from role_revalidation_blocked because the caller's JWT and
// DB rows AGREE, but the target role (owner) requires an Owner caller.
func (s *AuthService) auditRoleAssignmentBlocked(ctx context.Context, userUUID uuid.UUID, callerRole, targetRole string) {
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "center.invite.role_assignment_blocked",
		EntityType: "invite",
		EntityID:   userUUID,
		Changes: Changes{After: map[string]any{
			"callerRole": callerRole,
			"targetRole": targetRole,
		}},
	})
}
