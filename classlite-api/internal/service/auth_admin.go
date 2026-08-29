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
	"html"
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

// AdminInviteStaffInput carries the Story 7.1a widened invite request (D2/D7).
// Name/WelcomeNote/ClassID are optional; ClassID is accepted only for a teacher
// invite (else 422) and must resolve in the caller's center (else 404).
type AdminInviteStaffInput struct {
	Email       string
	Role        string
	Name        *string
	WelcomeNote *string
	ClassID     *uuid.UUID
}

// AdminInviteStaff inserts an invites row for `email` with `role`. Story
// 1.5 shipped this hook to lock in the SEC-1 role re-validation pattern;
// Story 2.6 (AC8) widens it to accept Admin callers and enforces FR-11
// via model.OutranksOwner. See package doc for the surgical addition
// summary — the tx choreography (Begin → SET LOCAL → member re-fetch →
// mutate → commit) is preserved verbatim per Winston-INFO fold.
func (s *AuthService) AdminInviteStaff(ctx context.Context, tc model.TenantContext, in AdminInviteStaffInput) (*InviteResult, error) {
	email, role := in.Email, in.Role
	// Target role validation — must be one of {owner, admin, teacher}.
	// Student rejected at 422 because the accept-invite flow provisions
	// staff seats only; student enrollment goes through a separate
	// endpoint (Epic 7).
	if role != model.RoleOwner && role != model.RoleAdmin && role != model.RoleTeacher {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "role", Message: "must be one of owner, admin, teacher"},
		}}
	}

	// Story 7.1a (D7) — a classId is meaningful only for a teacher invite
	// (auto-assign-on-accept). A non-teacher invite carrying a classId is a
	// 422 (pure input validation, no DB needed). The class's existence in the
	// caller's center is re-checked in-tenant below.
	if in.ClassID != nil && role != model.RoleTeacher {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "classId", Message: "classId may only be set on a teacher invite"},
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

	// Story 7.1a (D7) — re-validate the optional target class IN-TENANT.
	// GetClassByID is RLS-scoped, so a class not in the caller's center →
	// pgx.ErrNoRows → 404 CLASS_NOT_FOUND (never a cross-tenant reference).
	var classArg pgtype.UUID
	if in.ClassID != nil {
		classArg = pgtype.UUID{Bytes: *in.ClassID, Valid: true}
		if _, err := txQ.GetClassByID(ctx, classArg); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				_ = tx.Rollback(context.WithoutCancel(ctx))
				return nil, model.NotFoundError{Resource: "class", ID: in.ClassID.String(), Code: "CLASS_NOT_FOUND"}
			}
			return nil, fmt.Errorf("resolve invite class: %w", err)
		}
	}

	var nameArg pgtype.Text
	if in.Name != nil {
		nameArg = pgtype.Text{String: strings.TrimSpace(*in.Name), Valid: true}
	}

	// Story 7.1a (D2) — mint the raw token and KEEP it (the 2.6 hook discarded
	// it). 32 random bytes; persisted as sha256-hex; echoed only via the email
	// accept URL, never returned to the caller.
	rawToken, err := newPasswordResetToken()
	if err != nil {
		return nil, fmt.Errorf("invite token: %w", err)
	}
	tokenHashBytes := sha256.Sum256([]byte(rawToken))
	tokenHash := hex.EncodeToString(tokenHashBytes[:])
	now := s.clk.Now()
	expiresAt := now.Add(inviteTTL)

	// Story 7.1a (D12) — dedup with expired-supersede. The partial unique index
	// idx_invites_center_email_active guarantees ≤1 unaccepted row per
	// (center, LOWER(email)). If that row exists and is NON-expired → 409
	// INVITE_EMAIL_TAKEN (unchanged 2.6 behavior). If it exists but is EXPIRED
	// → refresh it IN PLACE (new token/expiry/role/name/class_id) instead of
	// 409 — resolves the previously un-invitable-email deadlock (there is no
	// resend/revoke endpoint yet). Either branch preserves the ≤1-row index
	// invariant. Case-insensitive on email.
	var inviteID pgtype.UUID
	var existingID pgtype.UUID
	var existingExpiresAt time.Time
	lookupErr := tx.QueryRow(ctx,
		`SELECT id, expires_at FROM invites
		 WHERE center_id = $1 AND LOWER(email) = LOWER($2) AND accepted_at IS NULL
		 LIMIT 1`,
		centerUUID, normalizedEmail,
	).Scan(&existingID, &existingExpiresAt)
	switch {
	case lookupErr == nil:
		if existingExpiresAt.After(now) {
			// A live unaccepted invite still owns the slot — 409.
			_ = tx.Rollback(context.WithoutCancel(ctx))
			return nil, &InviteEmailTakenError{Email: normalizedEmail}
		}
		// Expired — supersede in place (D12). The `AND accepted_at IS NULL`
		// guard closes a TOCTOU race: the lookup SELECT above is unlocked, so a
		// concurrent AcceptInvite could mark this row accepted between read and
		// update. Without the guard the supersede would rotate token/expiry/role/
		// class_id on an already-accepted invite; with it the UPDATE matches 0
		// rows and we fall back to the same 409 as a live invite.
		tag, err := tx.Exec(ctx,
			`UPDATE invites
			 SET token_hash = $1, expires_at = $2, role = $3, name = $4, class_id = $5, inviter_id = $6
			 WHERE id = $7 AND accepted_at IS NULL`,
			tokenHash, expiresAt, role, nameArg, classArg, userUUID, existingID,
		)
		if err != nil {
			return nil, fmt.Errorf("supersede expired invite: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// The row was accepted concurrently — the slot is taken.
			_ = tx.Rollback(context.WithoutCancel(ctx))
			return nil, &InviteEmailTakenError{Email: normalizedEmail}
		}
		inviteID = existingID
	case errors.Is(lookupErr, pgx.ErrNoRows):
		if err := tx.QueryRow(ctx,
			`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at, name, class_id)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING id`,
			centerUUID, userUUID, normalizedEmail, role, tokenHash, expiresAt, nameArg, classArg,
		).Scan(&inviteID); err != nil {
			// Belt-and-suspenders: a concurrent invite for the same
			// (center, email) can slip past the app gate and collide on
			// idx_invites_center_email_active. Map 23505 to the same 409.
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolationCode {
				return nil, &InviteEmailTakenError{Email: normalizedEmail}
			}
			return nil, fmt.Errorf("insert invite: %w", err)
		}
	default:
		return nil, fmt.Errorf("check duplicate invite: %w", lookupErr)
	}

	// Look up centerName + inviterName for the email BEFORE commit (both are
	// tenant-scoped reads under the open tx).
	centerName, _ := fetchCenterName(ctx, tx, pgtype.UUID{Bytes: centerUUID, Valid: true})
	var inviterName string
	if caller, err := txQ.GetUserByID(ctx, pgtype.UUID{Bytes: userUUID, Valid: true}); err == nil {
		inviterName = caller.FullName
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit invite tx: %w", err)
	}

	// Story 7.1a (D2/D17b) — REAL invite email, best-effort. The accept URL
	// carries the raw token as ?token=<raw> for POST /api/auth/accept-invite.
	// centerName + inviterName are CRLF-stripped (SMTP-header-injection guard —
	// centers.name has no CRLF ban); the welcomeNote is HTML-escaped when
	// appended. Enqueue failure NEVER fails the committed invite write (AC22 —
	// mirrors the class-spawn best-effort pattern).
	acceptURL := s.inviteAcceptURL + "?token=" + rawToken
	subject, body := RenderInviteEmail(stripCRLFAndControls(centerName), stripCRLFAndControls(inviterName), role, acceptURL)
	if in.WelcomeNote != nil && strings.TrimSpace(*in.WelcomeNote) != "" {
		body = appendInviteWelcomeNote(body, *in.WelcomeNote)
	}
	if s.retry != nil {
		_ = s.retry.Enqueue(EmailJob{To: normalizedEmail, Subject: subject, HTML: body})
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

// appendInviteWelcomeNote injects an HTML-ESCAPED welcome-note paragraph into
// the rendered invite email body (D2). The note is anchored after the fixed
// intro sentence; if the template ever changes so the anchor is gone, it falls
// back to inserting before </body>. HTML-escaping is the load-bearing guard
// (AC22 — a <script> welcomeNote must not survive into the body); the note is
// also run through stripCRLFAndControls first, uniform with centerName/
// inviterName, so CR/LF/control chars never leak if the note is ever reused in
// a subject or plaintext part (defense-in-depth against header injection).
func appendInviteWelcomeNote(body, note string) string {
	const anchor = `This link is valid for 7 days.</p>`
	noteHTML := `<p style="margin: 0 0 24px; padding: 12px; background: #f3f4f6; border-radius: 6px;">` +
		html.EscapeString(stripCRLFAndControls(strings.TrimSpace(note))) + `</p>`
	if strings.Contains(body, anchor) {
		return strings.Replace(body, anchor, anchor+noteHTML, 1)
	}
	if strings.Contains(body, "</body>") {
		return strings.Replace(body, "</body>", noteHTML+"</body>", 1)
	}
	return body + noteHTML
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
