// Package service — Story 1.6 invite acceptance.
//
// Two surfaces:
//
//	AcceptInvite(ctx, AcceptInviteInput) — POST /api/auth/accept-invite
//	  Public REST endpoint. Handles new-user (creates user + member)
//	  and existing-user (adds member) branches. Errors map to JSON
//	  envelopes via middleware/error_mapper.go.
//
//	AcceptInviteInternal(ctx, userID, hash, oauthEmail) — invoked from
//	  HandleGoogleCallback. Asserts oauthEmail == invite.email; on
//	  mismatch returns *InviteEmailMismatchError + writes a forensic
//	  audit row. The Google sign-in itself still succeeds (the user's
//	  identity is valid; they just can't join this specific invite).
//
// RLS: the invite token lookup goes through the SECURITY DEFINER
// function (bypasses RLS — invite acceptance is PRE-tenant). The
// center_members INSERT runs AFTER `SET LOCAL app.current_tenant_id`
// via parameter-bind (same pattern as auth_admin.go).
package service

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// AcceptInviteInput drives POST /api/auth/accept-invite.
type AcceptInviteInput struct {
	Token    string
	FullName string // required only on the new-user branch
	Password string // required only on the new-user branch
}

// AcceptInviteResult is the unified shape both the password-path and
// OAuth-path produce. CenterName + Role power the post-login UI hints.
type AcceptInviteResult struct {
	User             generated.User
	AccessToken      string
	RefreshToken     string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	RefreshTTL       time.Duration
	CenterID         string
	CenterName       string
	Role             string
	InviteID         uuid.UUID
}

// AcceptInvite implements AC4.
func (s *AuthService) AcceptInvite(ctx context.Context, in AcceptInviteInput) (*AcceptInviteResult, error) {
	rawToken := strings.TrimSpace(in.Token)
	if rawToken == "" {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "inviteToken", Message: "required"}}}
	}
	if len(rawToken) > MaxInviteTokenChars {
		return nil, &InviteNotFoundError{}
	}

	now := s.clk.Now()
	tokenHash := hashInviteTokenHex(rawToken)

	inviteID, centerID, _, inviteEmail, inviteRole, _, err := loadInviteByTokenHash(ctx, s.db, tokenHash, now)
	if err != nil {
		return nil, err
	}

	normalizedInviteEmail := normalizeEmail(inviteEmail)

	preTxQ := generated.New(s.db)
	existing, lookupErr := preTxQ.GetUserByEmail(ctx, normalizedInviteEmail)
	isExisting := lookupErr == nil
	if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
		return nil, fmt.Errorf("lookup user by email: %w", lookupErr)
	}

	var user generated.User
	if isExisting {
		// Existing-user branch (AC4 step 4).
		// AC4: password supplied for an OAuth-only user → 409. Silent
		// ignore would allow an attacker holding an invite token to
		// mint a password for an OAuth account.
		if !existing.PasswordHash.Valid && in.Password != "" {
			return nil, &PasswordNotAllowedForOAuthUserError{}
		}

		if err := s.acceptInviteAddMembership(ctx, existing.ID, centerID, inviteRole, inviteID); err != nil {
			return nil, err
		}
		user = existing
	} else {
		// New-user branch (AC4 step 5).
		// Validate fullName + password BEFORE bcrypt to avoid wasted hashes.
		var fields []model.FieldError
		trimmedName := strings.TrimSpace(in.FullName)
		if trimmedName == "" {
			fields = append(fields, model.FieldError{Field: "fullName", Message: "required"})
		} else if utf8.RuneCountInString(trimmedName) > MaxFullNameRunes {
			fields = append(fields, model.FieldError{Field: "fullName", Message: fmt.Sprintf("must be at most %d characters", MaxFullNameRunes)})
		}
		if len(in.Password) < MinPasswordLength {
			fields = append(fields, model.FieldError{Field: "password", Message: fmt.Sprintf("must be at least %d characters", MinPasswordLength)})
		}
		if len([]byte(in.Password)) > MaxPasswordBytes {
			fields = append(fields, model.FieldError{Field: "password", Message: fmt.Sprintf("must be at most %d bytes", MaxPasswordBytes)})
		}
		// Defense-in-depth: the invite email should already be a parseable
		// address, but if a malformed row slipped past creation, fail loud
		// rather than silently CREATE a user with junk email.
		if _, parseErr := mail.ParseAddress(normalizedInviteEmail); parseErr != nil {
			return nil, fmt.Errorf("invite has malformed email %q", inviteEmail)
		}
		if len(fields) > 0 {
			return nil, model.ValidationError{Fields: fields}
		}

		hash, err := s.hasher.Hash([]byte(in.Password))
		if err != nil {
			return nil, fmt.Errorf("hash password: %w", err)
		}

		created, err := s.acceptInviteCreateUserAndMember(ctx, normalizedInviteEmail, trimmedName, string(hash), centerID, inviteRole, inviteID)
		if err != nil {
			return nil, err
		}
		user = created
	}

	// Issue session.
	session, err := s.issueSessionForUser(ctx, user)
	if err != nil {
		return nil, err
	}

	centerName, _ := fetchCenterName(ctx, s.db, pgtype.UUID{Bytes: centerID, Valid: true})
	userUUID, _ := pgUUIDToGoogle(user.ID)
	inviteUUID := inviteID

	// Audit invite acceptance via password path.
	postCtx := context.WithoutCancel(ctx)
	s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
		UserID:      userUUID,
		ActorUserID: userUUID, // self-initiated (user clicked the link)
		Event:       "invite.accepted",
		EntityType:  "invite",
		EntityID:    inviteUUID,
		Changes: Changes{After: map[string]any{
			"centerId": centerID.String(),
			"role":     inviteRole,
			"method":   "password",
		}},
	})

	return &AcceptInviteResult{
		User:             user,
		AccessToken:      session.AccessToken,
		RefreshToken:     session.RefreshToken,
		AccessExpiresAt:  session.AccessExpiresAt,
		RefreshExpiresAt: session.RefreshExpiresAt,
		RefreshTTL:       session.RefreshTTL,
		CenterID:         centerID.String(),
		CenterName:       centerName,
		Role:             inviteRole,
		InviteID:         inviteUUID,
	}, nil
}

// AcceptInviteInternal is invoked by HandleGoogleCallback after profile
// resolution. The OAuth path differs from AcceptInvite in two ways:
// (1) the user is already created/resolved, (2) the email-mismatch
// check fires here (UX surface — the Google sign-in still succeeds
// even if the invite is rejected).
func (s *AuthService) AcceptInviteInternal(ctx context.Context, userID uuid.UUID, inviteTokenHash, oauthEmail string) (*AcceptInviteResult, error) {
	now := s.clk.Now()
	inviteID, centerID, _, inviteEmail, inviteRole, _, err := loadInviteByTokenHash(ctx, s.db, inviteTokenHash, now)
	if err != nil {
		return nil, err
	}

	if normalizeEmail(oauthEmail) != normalizeEmail(inviteEmail) {
		// Audit the mismatch with both emails for forensics.
		s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
			UserID:      userID,
			ActorUserID: userID,
			Event:       "invite.email_mismatch",
			EntityType:  "invite",
			EntityID:    inviteID,
			Changes: Changes{After: map[string]any{
				"invitedEmail": inviteEmail,
				"oauthEmail":   oauthEmail,
				"decision":     "rejected",
			}},
		})
		return nil, &InviteEmailMismatchError{InvitedEmail: inviteEmail, OAuthEmail: oauthEmail}
	}

	// Add membership inside the tenant context. The existing-user branch
	// shape — but the user came from Google rather than email/password,
	// which is irrelevant past this point.
	userPg := pgtype.UUID{Bytes: userID, Valid: true}
	if err := s.acceptInviteAddMembership(ctx, userPg, centerID, inviteRole, inviteID); err != nil {
		return nil, err
	}

	centerName, _ := fetchCenterName(ctx, s.db, pgtype.UUID{Bytes: centerID, Valid: true})

	// Audit invite acceptance via OAuth path.
	postCtx := context.WithoutCancel(ctx)
	s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
		UserID:      userID,
		ActorUserID: userID,
		Event:       "invite.accepted_via_oauth",
		EntityType:  "invite",
		EntityID:    inviteID,
		Changes: Changes{After: map[string]any{
			"centerId": centerID.String(),
			"role":     inviteRole,
			"method":   "google",
		}},
	})

	return &AcceptInviteResult{
		CenterID:   centerID.String(),
		CenterName: centerName,
		Role:       inviteRole,
		InviteID:   inviteID,
	}, nil
}

// acceptInviteAddMembership opens a tx, sets app.current_tenant_id, and
// runs CreateCenterMember + MarkInviteAcceptedGuarded. Shared by both
// the password path's existing-user branch and the OAuth-internal path.
func (s *AuthService) acceptInviteAddMembership(ctx context.Context, userID pgtype.UUID, centerID uuid.UUID, role string, inviteID uuid.UUID) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin accept-invite tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerID.String(),
	); err != nil {
		return fmt.Errorf("set tenant local: %w", err)
	}

	q := generated.New(tx)
	// Story 1.6 review decision (D1): upgrade in place for existing
	// members. Use an atomic upsert — a try-INSERT-then-UPDATE shape
	// would break here because Postgres aborts the tx on unique-PK
	// violation, leaving the surrounding MarkInviteAcceptedGuarded call
	// in a "current transaction is aborted" state.
	if _, err := q.UpsertCenterMemberWithRole(ctx, generated.UpsertCenterMemberWithRoleParams{
		UserID:   userID,
		CenterID: pgtype.UUID{Bytes: centerID, Valid: true},
		Role:     role,
	}); err != nil {
		return fmt.Errorf("upsert center member: %w", err)
	}

	rows, err := q.MarkInviteAcceptedGuarded(ctx, pgtype.UUID{Bytes: inviteID, Valid: true})
	if err != nil {
		return fmt.Errorf("mark invite accepted: %w", err)
	}
	if rows == 0 {
		// Race: another acceptance call won between our lookup and our
		// UPDATE. Surface as already-accepted so the user sees the
		// idempotent error envelope.
		centerName, _ := fetchCenterName(ctx, tx, pgtype.UUID{Bytes: centerID, Valid: true})
		return &InviteAlreadyAcceptedError{CenterName: centerName}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit accept-invite tx: %w", err)
	}
	return nil
}

// acceptInviteCreateUserAndMember handles the new-user branch: insert
// the global users row first (no tenant context — users is global),
// then SET LOCAL and insert the center_members row.
func (s *AuthService) acceptInviteCreateUserAndMember(
	ctx context.Context,
	email, fullName, passwordHash string,
	centerID uuid.UUID,
	role string,
	inviteID uuid.UUID,
) (generated.User, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return generated.User{}, fmt.Errorf("begin new-user invite tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)
	user, err := q.CreateUser(ctx, generated.CreateUserParams{
		Email:        email,
		PasswordHash: pgtype.Text{String: passwordHash, Valid: true},
		FullName:     fullName,
		GoogleID:     pgtype.Text{},
	})
	if err != nil {
		if isUniqueViolation(err) {
			// Race: someone else registered this email between the
			// pre-tx GetUserByEmail and now. The simplest recovery is to
			// re-run the existing-user branch by surfacing the conflict;
			// the user can retry. We surface a 409 with a clear code.
			return generated.User{}, model.ConflictError{
				Resource: "email",
				Code:     "EMAIL_ALREADY_REGISTERED",
				Message:  "An account for this email already exists; please log in and reaccept the invite.",
			}
		}
		return generated.User{}, fmt.Errorf("create user: %w", err)
	}

	// Mark email_verified — the invite link IS the verification.
	if err := q.UpdateUserEmailVerified(ctx, user.ID); err != nil {
		return generated.User{}, fmt.Errorf("mark invited user verified: %w", err)
	}

	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerID.String(),
	); err != nil {
		return generated.User{}, fmt.Errorf("set tenant local: %w", err)
	}

	if _, err := q.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   user.ID,
		CenterID: pgtype.UUID{Bytes: centerID, Valid: true},
		Role:     role,
	}); err != nil {
		// Soften unique-PK conflicts — the new-user race is vanishingly
		// rare (CreateUser just succeeded with no prior row) but a
		// concurrent admin path could race. Mirror the existing-user
		// branch (acceptInviteAddMembership) for consistency.
		if !isUniqueViolation(err) {
			return generated.User{}, fmt.Errorf("create center member: %w", err)
		}
	}

	rows, err := q.MarkInviteAcceptedGuarded(ctx, pgtype.UUID{Bytes: inviteID, Valid: true})
	if err != nil {
		return generated.User{}, fmt.Errorf("mark invite accepted: %w", err)
	}
	if rows == 0 {
		centerName, _ := fetchCenterName(ctx, tx, pgtype.UUID{Bytes: centerID, Valid: true})
		return generated.User{}, &InviteAlreadyAcceptedError{CenterName: centerName}
	}

	if err := tx.Commit(ctx); err != nil {
		return generated.User{}, fmt.Errorf("commit new-user invite tx: %w", err)
	}
	// Re-fetch so email_verified=true is reflected.
	refreshed, err := generated.New(s.db).GetUserByID(ctx, user.ID)
	if err != nil {
		return generated.User{}, fmt.Errorf("refetch invited user: %w", err)
	}
	return refreshed, nil
}

