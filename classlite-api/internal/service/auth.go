// Package service — AuthService implements the registration / email
// verification flows for story 1.4. JWT-based login and refresh land in
// story 1.5; Google OAuth lands in story 1.6.
//
// Invariants:
//   - Bcrypt runs BEFORE pool.Begin (H1) — cost-12 hashing must not occupy a
//     pool connection.
//   - Duplicate email is detected via the DB unique index, not via a pre-check
//     (TOCTOU-safe; one round-trip).
//   - Audit and email side-effects run AFTER commit on a non-cancellable
//     context (best-effort; do not fail the user-facing request on side-effect
//     errors, and do not lose them if the client disconnects).
//   - ResendVerification enforces a 200ms constant-time floor on every 200
//     response to defeat trivial timing-based enumeration of registered
//     emails (H4). The floor is partial — see deferred-work for the
//     statistical-sampling caveat on the DB-write path.
package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// Constants from spec ACs.
const (
	MinPasswordLength             = 8
	MaxPasswordBytes              = 72 // bcrypt hard limit
	MaxFullNameRunes              = 200
	VerificationTokenByteLength   = 32
	VerificationTokenExpiry       = 24 * time.Hour
	ResendConstantTimeFloor       = 200 * time.Millisecond
	uniqueViolationPgErrorCode    = "23505"
	emailAlreadyRegisteredCode    = "EMAIL_ALREADY_REGISTERED"
	emailAlreadyRegisteredMessage = "If this email is not yet registered, you will receive a verification email shortly."
)

// EmailDelivery values surfaced to the frontend.
const (
	EmailDeliverySent    = "sent"
	EmailDeliveryDelayed = "delayed"
	EmailDeliveryFailed  = "failed"
)

// AuthDB is the combined dependency surface AuthService needs: it must be able
// to open a transaction (Begin) AND be usable directly for non-tx reads (DBTX
// implements Exec/Query/QueryRow). Both *pgxpool.Pool (production) and
// *test.TxDB (integration tests) satisfy it; requiring the combined interface
// here is what lets the service avoid the previous runtime-panic fallback.
type AuthDB interface {
	txBeginner
	generated.DBTX
}

// AuthService orchestrates registration, verification, and resend flows.
type AuthService struct {
	db        AuthDB
	hasher    Hasher
	email     EmailSender
	audit     AuthAuditLogger
	retry     EmailRetryQueue
	verifyURL string
	clock     func() time.Time
	sleep     func(time.Duration)
}

// NewAuthService wires AuthService for production. verifyURL must NOT end with
// a slash; the service appends ?token=<value>. retry must be non-nil — the
// "fail fast on misconfiguration" guarantee is enforced here so a deployment
// without a retry queue cannot silently degrade to no-email registrations.
func NewAuthService(db AuthDB, hasher Hasher, email EmailSender, audit AuthAuditLogger, retry EmailRetryQueue, verifyURL string) *AuthService {
	if retry == nil {
		panic("auth service: retry queue is required")
	}
	return &AuthService{
		db:        db,
		hasher:    hasher,
		email:     email,
		audit:     audit,
		retry:     retry,
		verifyURL: strings.TrimRight(verifyURL, "/"),
		clock:     time.Now,
		sleep:     time.Sleep,
	}
}

// RegisterRequest carries the validated inputs from the HTTP handler.
type RegisterRequest struct {
	Email    string
	Password string
	FullName string
}

// RegisterResult bundles the new user, the verify-status poll ID, and the
// email delivery hint surfaced to the frontend.
type RegisterResult struct {
	User          generated.User
	VerifyPollID  uuid.UUID
	EmailDelivery string // "sent" | "delayed" | "failed"
}

// VerifyEmailResult captures the response shape for verify-email / AC3.
type VerifyEmailResult struct {
	Verified bool
	Email    string
}

// ResendResult captures the response shape for resend-verification / AC7.
type ResendResult struct {
	VerifyPollID *uuid.UUID // nil when the email is unknown or already verified
}

// VerifyStatusResult captures the response shape for verify-status / AC8.
type VerifyStatusResult struct {
	Verified bool
	Email    string
}

// Register implements AC1, AC2, AC11, AC12, AC13 (registration branch).
func (s *AuthService) Register(ctx context.Context, req RegisterRequest) (*RegisterResult, error) {
	// Step 1: validate inputs BEFORE hashing. AC11 / H2 — bcrypt must not be invoked.
	normalizedEmail, trimmedName, err := s.validateRegisterRequest(req)
	if err != nil {
		return nil, err
	}

	// Step 2: hash OUTSIDE the transaction (H1).
	hash, err := s.hasher.Hash([]byte(req.Password))
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	// Step 3: generate the verification token.
	token, err := newVerificationToken()
	if err != nil {
		return nil, fmt.Errorf("generate verification token: %w", err)
	}

	// Step 4: single transaction for the DB writes.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	queries := generated.New(tx)

	user, err := queries.CreateUser(ctx, generated.CreateUserParams{
		Email:        normalizedEmail,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
		FullName:     trimmedName,
		GoogleID:     pgtype.Text{}, // invariant: Register sets google_id NULL (Story 1.3 W3 closed by callsite invariant)
	})
	if err != nil {
		if isUniqueViolation(err) {
			return nil, model.ConflictError{
				Resource: "email",
				Code:     emailAlreadyRegisteredCode,
				Message:  emailAlreadyRegisteredMessage,
			}
		}
		return nil, fmt.Errorf("create user: %w", err)
	}

	expiresAt := s.clock().Add(VerificationTokenExpiry)
	verification, err := queries.CreateEmailVerification(ctx, generated.CreateEmailVerificationParams{
		UserID:    user.ID,
		Token:     token,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("create email verification: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	userUUID, err := pgUUIDToGoogle(user.ID)
	if err != nil {
		return nil, fmt.Errorf("convert user id: %w", err)
	}
	verifyPollID, err := pgUUIDToGoogle(verification.ID)
	if err != nil {
		return nil, fmt.Errorf("convert verification id: %w", err)
	}

	// Step 5: post-commit side effects (best-effort, never fail the response,
	// never lost on client disconnect — use a non-cancellable context).
	postCtx := context.WithoutCancel(ctx)

	s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
		UserID:     userUUID,
		Action:     "user.registered",
		EntityType: "user",
		EntityID:   userUUID,
		Changes:    Changes{Before: nil, After: map[string]any{"emailVerified": false}},
	})

	delivery := s.enqueueVerificationEmail(postCtx, userUUID, verifyPollID, user.Email, user.FullName, token)

	return &RegisterResult{
		User:          user,
		VerifyPollID:  verifyPollID,
		EmailDelivery: delivery,
	}, nil
}

// VerifyEmail implements AC3, AC4, AC5, AC6.
func (s *AuthService) VerifyEmail(ctx context.Context, token string) (*VerifyEmailResult, error) {
	if token == "" {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "token", Message: "required"}}}
	}

	preTxQueries := generated.New(s.db)
	verification, err := preTxQueries.GetEmailVerificationByToken(ctx, token)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{
				Resource: "verification_token",
				Code:     "VERIFICATION_TOKEN_INVALID",
			}
		}
		return nil, fmt.Errorf("lookup verification: %w", err)
	}

	user, err := preTxQueries.GetUserByID(ctx, verification.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Orphaned token — user FK row gone. Treat as an unknown token rather
			// than 500 so error mapping stays consistent with AC6.
			return nil, model.NotFoundError{
				Resource: "verification_token",
				Code:     "VERIFICATION_TOKEN_INVALID",
			}
		}
		return nil, fmt.Errorf("lookup user: %w", err)
	}

	// AC5: idempotent 200 if the user is already verified, regardless of which
	// token (current or rotated-out) was POSTed.
	if user.EmailVerified {
		return &VerifyEmailResult{Verified: true, Email: user.Email}, nil
	}

	// AC4: token expired (and user not yet verified) → 410.
	if verification.VerifiedAt.Valid {
		// Consumed but user not verified — data-corruption defense. Treat as expired.
		return nil, model.GoneError{
			Code:   "VERIFICATION_TOKEN_EXPIRED",
			Reason: "This verification link has expired. Please request a new one.",
		}
	}
	if !verification.ExpiresAt.Valid || verification.ExpiresAt.Time.Before(s.clock()) {
		return nil, model.GoneError{
			Code:   "VERIFICATION_TOKEN_EXPIRED",
			Reason: "This verification link has expired. Please request a new one.",
		}
	}

	// AC3 + M2: single atomic transaction for the three writes.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin verify tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)

	// Why: the UPDATE is guarded on verified_at IS NULL. If a concurrent
	// verify request beat us to it, the row affected count is 0 — we treat
	// that as idempotent success (the other request already audited the
	// transition) and short-circuit before emitting a duplicate audit row.
	rowsAffected, err := q.MarkEmailVerificationVerified(ctx, verification.ID)
	if err != nil {
		return nil, fmt.Errorf("mark verified: %w", err)
	}
	if rowsAffected == 0 {
		// Another request consumed the row first. Rollback this empty tx and
		// return the idempotent 200 response (the user's verified flag has
		// already been set by the winning request, or will be once their
		// transaction commits).
		return &VerifyEmailResult{Verified: true, Email: user.Email}, nil
	}

	if err := q.InvalidateUnconsumedEmailVerificationsForUser(ctx, verification.UserID); err != nil {
		return nil, fmt.Errorf("invalidate unconsumed verifications: %w", err)
	}
	if err := q.UpdateUserEmailVerified(ctx, verification.UserID); err != nil {
		return nil, fmt.Errorf("update user email_verified: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit verify tx: %w", err)
	}

	userUUID, err := pgUUIDToGoogle(user.ID)
	if err != nil {
		return nil, fmt.Errorf("convert user id: %w", err)
	}
	postCtx := context.WithoutCancel(ctx)
	s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
		UserID:     userUUID,
		Action:     "user.email_verified",
		EntityType: "user",
		EntityID:   userUUID,
		Changes: Changes{
			Before: map[string]any{"emailVerified": false},
			After:  map[string]any{"emailVerified": true},
		},
	})

	return &VerifyEmailResult{Verified: true, Email: user.Email}, nil
}

// ResendVerification implements AC7 including the H4 constant-time floor.
func (s *AuthService) ResendVerification(ctx context.Context, email string) (*ResendResult, error) {
	startedAt := s.clock()

	parsed, err := mail.ParseAddress(strings.TrimSpace(email))
	if err != nil {
		// Validation 422 bypasses the constant-time floor — the timing channel
		// only matters on 200 responses (per AC7 Step 5).
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "email", Message: "invalid email format"}}}
	}
	normalized := normalizeEmail(parsed.Address)

	result, err := s.resendInner(ctx, normalized)
	if err != nil {
		// Internal errors also bypass the floor — they will surface as 500.
		return nil, err
	}

	// H4: pad every 200 response to ≥ 200ms.
	if elapsed := s.clock().Sub(startedAt); elapsed < ResendConstantTimeFloor {
		s.sleep(ResendConstantTimeFloor - elapsed)
	}

	return result, nil
}

func (s *AuthService) resendInner(ctx context.Context, normalizedEmail string) (*ResendResult, error) {
	preTxQueries := generated.New(s.db)
	user, err := preTxQueries.GetUserByEmail(ctx, normalizedEmail)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Unknown email → ambiguous response per AC7 clause 2.
			return &ResendResult{VerifyPollID: nil}, nil
		}
		return nil, fmt.Errorf("lookup user by email: %w", err)
	}

	if user.EmailVerified {
		// Already verified → ambiguous response per AC7 clause 2.
		return &ResendResult{VerifyPollID: nil}, nil
	}

	token, err := newVerificationToken()
	if err != nil {
		return nil, fmt.Errorf("generate token: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin resend tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)
	if err := q.InvalidateUnconsumedEmailVerificationsForUser(ctx, user.ID); err != nil {
		return nil, fmt.Errorf("invalidate prior verifications: %w", err)
	}
	expiresAt := s.clock().Add(VerificationTokenExpiry)
	verification, err := q.CreateEmailVerification(ctx, generated.CreateEmailVerificationParams{
		UserID:    user.ID,
		Token:     token,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("create resend verification: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit resend tx: %w", err)
	}

	userUUID, err := pgUUIDToGoogle(user.ID)
	if err != nil {
		return nil, fmt.Errorf("convert user id: %w", err)
	}
	verificationUUID, err := pgUUIDToGoogle(verification.ID)
	if err != nil {
		return nil, fmt.Errorf("convert verification id: %w", err)
	}
	postCtx := context.WithoutCancel(ctx)
	s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
		UserID:     userUUID,
		Action:     "user.verification_resent",
		EntityType: "user",
		EntityID:   userUUID,
	})

	_ = s.enqueueVerificationEmail(postCtx, userUUID, verificationUUID, user.Email, user.FullName, token)

	return &ResendResult{VerifyPollID: &verificationUUID}, nil
}

// VerifyStatus implements AC8. The 24h pollId TTL filter lives in the sqlc
// query (GetEmailVerificationByID), so expired / unknown / malformed pollIds
// all collapse into a single ErrNoRows path.
func (s *AuthService) VerifyStatus(ctx context.Context, pollID uuid.UUID) (*VerifyStatusResult, error) {
	preTxQueries := generated.New(s.db)
	verification, err := preTxQueries.GetEmailVerificationByID(ctx, pgtype.UUID{Bytes: pollID, Valid: true})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{
				Resource: "verify_poll",
				Code:     "POLL_ID_NOT_FOUND",
			}
		}
		return nil, fmt.Errorf("lookup verification: %w", err)
	}
	user, err := preTxQueries.GetUserByID(ctx, verification.UserID)
	if err != nil {
		return nil, fmt.Errorf("lookup user: %w", err)
	}
	return &VerifyStatusResult{Verified: user.EmailVerified, Email: user.Email}, nil
}

// validateRegisterRequest enforces AC11. Returns the normalized email and the
// whitespace-trimmed full name on success so the caller persists exactly what
// the validator measured.
func (s *AuthService) validateRegisterRequest(req RegisterRequest) (normalizedEmail, trimmedName string, err error) {
	var fields []model.FieldError

	trimmedEmail := strings.TrimSpace(req.Email)
	var parsedAddress string
	if trimmedEmail == "" {
		fields = append(fields, model.FieldError{Field: "email", Message: "required"})
	} else if parsed, parseErr := mail.ParseAddress(trimmedEmail); parseErr != nil {
		fields = append(fields, model.FieldError{Field: "email", Message: "invalid email format"})
	} else {
		// Why: normalize on parsed.Address (the RFC mailbox) so registrations
		// of `Foo <foo@example.com>` and `foo@example.com` collide on the
		// unique index — and so subsequent ResendVerification lookups (which
		// also key on parsed.Address) actually find the row.
		parsedAddress = parsed.Address
	}

	if len(req.Password) < MinPasswordLength {
		fields = append(fields, model.FieldError{Field: "password", Message: fmt.Sprintf("must be at least %d characters", MinPasswordLength)})
	}
	if len([]byte(req.Password)) > MaxPasswordBytes {
		fields = append(fields, model.FieldError{Field: "password", Message: fmt.Sprintf("must be at most %d bytes", MaxPasswordBytes)})
	}

	trimmedName = strings.TrimSpace(req.FullName)
	if trimmedName == "" {
		fields = append(fields, model.FieldError{Field: "fullName", Message: "required"})
	} else if utf8.RuneCountInString(trimmedName) > MaxFullNameRunes {
		fields = append(fields, model.FieldError{Field: "fullName", Message: fmt.Sprintf("must be at most %d characters", MaxFullNameRunes)})
	}

	if len(fields) > 0 {
		return "", "", model.ValidationError{Fields: fields}
	}
	return normalizeEmail(parsedAddress), trimmedName, nil
}

// normalizeEmail is the single source of truth for email normalization across
// Register, ResendVerification, and the per-email rate-limit key function.
// All three sites must collapse to the same key for the uniqueness + lookup +
// rate-limit invariants to hold.
func normalizeEmail(address string) string {
	return strings.ToLower(strings.TrimSpace(address))
}

// logAuthAuditBestEffort calls AuditLogger.Log and only logs on failure.
// Audit must never fail the user-facing request (AC13).
func (s *AuthService) logAuthAuditBestEffort(ctx context.Context, entry AuthAuditEntry) {
	if s.audit == nil {
		return
	}
	if err := s.audit.Log(ctx, entry); err != nil {
		slog.ErrorContext(ctx, "auth_audit_log_failed",
			"action", entry.Action,
			"user_id", entry.UserID,
			"error", err.Error(),
		)
	}
}

// enqueueVerificationEmail returns one of the EmailDelivery* constants:
//   - "sent": the retry queue accepted the job; the actual send happens
//     asynchronously in the queue worker.
//   - "failed": the retry queue rejected the job (channel buffer full); no
//     async retry will occur. The frontend should surface a "Resend" prompt.
//     "delayed" is reserved for future use cases where the send is genuinely
//     postponed rather than dropped.
func (s *AuthService) enqueueVerificationEmail(ctx context.Context, userID, verificationID uuid.UUID, to, fullName, token string) string {
	verifyURL := s.verifyURL + "?token=" + token
	subject, body := RenderVerificationEmail(fullName, verifyURL)
	job := EmailJob{
		To:            to,
		Subject:       subject,
		HTML:          body,
		Attempts:      0,
		NextAttemptAt: s.clock(),
	}
	if accepted := s.retry.Enqueue(job); !accepted {
		slog.WarnContext(ctx, "verification_email_queue_full",
			"event", "verification_email_queue_full",
			"user_id", userID.String(),
			"email_verification_id", verificationID.String(),
		)
		return EmailDeliveryFailed
	}
	return EmailDeliverySent
}

// newVerificationToken produces 32 cryptographically random bytes encoded as
// 43-char URL-safe base64 (no padding).
func newVerificationToken() (string, error) {
	b := make([]byte, VerificationTokenByteLength)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// isUniqueViolation matches pgx unique-constraint failures so duplicate-email
// detection can run against the DB index instead of a pre-check (TOCTOU-safe).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == uniqueViolationPgErrorCode
	}
	return false
}

// pgUUIDToGoogle converts pgtype.UUID to uuid.UUID. Returns an error if the
// pgtype.UUID is invalid (NULL column) so callers handle it explicitly
// instead of silently emitting a zero UUID.
func pgUUIDToGoogle(u pgtype.UUID) (uuid.UUID, error) {
	if !u.Valid {
		return uuid.Nil, errors.New("pgtype.UUID is invalid")
	}
	var out uuid.UUID
	copy(out[:], u.Bytes[:])
	return out, nil
}
