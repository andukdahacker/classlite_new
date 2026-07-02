// Package service — Story 1.5 Login implementation (AC1, AC6, AC7).
//
// Lockout strategy: DB-backed via login_attempts (the in-process counter
// would not survive Railway dyno restarts and an attacker can trigger
// restarts for free). The lockout check runs BEFORE the user lookup so an
// attacker cannot probe whether an email is registered by timing the
// pre-lockout vs. post-lockout response paths.
//
// Timing-channel defense: the unknown-email branch does a dummy bcrypt
// compare so the wall-clock signature of "email known + wrong password"
// vs. "email unknown" is roughly the same (~250ms either way).
//
// AC9 / AC2 / AC8 (refresh rotation + reuse detection) live in auth_refresh.go.
package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

// recordLoginAttemptTimeout is the per-call deadline for the audit-write
// performed on every failed login. Story 1.5 W4: a persistent DB hiccup
// must not stall the user-facing 401, but it also must not silently let
// the attacker skate past lockout — see recordLoginAttempt for the error
// surfacing behavior.
const recordLoginAttemptTimeout = 500 * time.Millisecond

// refreshFamilyHexPattern locks the parseable family prefix to canonical
// lowercase hex. uuid.Parse is case-insensitive, which would let two
// raw tokens differing only in hex case yield the same family but
// different SHA-256 hashes — handleRefreshMiss would then revoke the
// family on a malformed-case replay.
var refreshFamilyHexPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)

// LoginInput is the user-facing input to Login. The handler decodes a JSON
// body into this shape after the per-IP rate limiter approves.
type LoginInput struct {
	Email      string
	Password   string
	RememberMe bool
}

// LoginResult bundles both tokens + expiry timestamps. The handler decides
// cookie attributes; the service just produces the values.
//
// RefreshTTL carries the literal duration the refresh token was issued for
// (7d or 30d depending on RememberMe). The handler uses it to compute the
// cookie Max-Age without going through wall-clock arithmetic — under
// MockClock the wall-clock-based `time.Until(RefreshExpiresAt)` shrinks
// to a near-zero value because the service clock and wall clock disagree.
type LoginResult struct {
	AccessToken      string
	RefreshToken     string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	RefreshTTL       time.Duration
	User             generated.User
}

// SetPassword writes a hashed password for the given user. Used as a
// service-level seed by tests AND by ResetPassword in production. Bcrypt
// runs OUTSIDE the transaction (H1).
func (s *AuthService) SetPassword(ctx context.Context, userID pgtype.UUID, password string) error {
	if len(password) < MinPasswordLength {
		return model.ValidationError{Fields: []model.FieldError{{Field: "password", Message: "too short"}}}
	}
	if len([]byte(password)) > MaxPasswordBytes {
		return model.ValidationError{Fields: []model.FieldError{{Field: "password", Message: "too long"}}}
	}
	hash, err := s.hasher.Hash([]byte(password))
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	q := generated.New(s.db)
	if err := q.UpdateUserPassword(ctx, generated.UpdateUserPasswordParams{
		ID:           userID,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	}); err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	return nil
}

// Login implements AC1, AC6, AC7.
func (s *AuthService) Login(ctx context.Context, in LoginInput) (*LoginResult, error) {
	parsed, err := mail.ParseAddress(strings.TrimSpace(in.Email))
	if err != nil {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "email", Message: "invalid email format"}}}
	}
	if in.Password == "" || strings.TrimSpace(in.Password) == "" {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "password", Message: "required"}}}
	}
	// Mirror the byte cap used by Register / ResetPassword. Bcrypt silently
	// truncates inputs >72 bytes; an explicit reject keeps the contract
	// uniform across endpoints and prevents an inconsistency between the
	// effective password length and the user's mental model.
	if len([]byte(in.Password)) > MaxPasswordBytes {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "password", Message: fmt.Sprintf("must be at most %d bytes", MaxPasswordBytes)}}}
	}
	normalizedEmail := normalizeEmail(parsed.Address)
	now := s.clk.Now()

	preTxQ := generated.New(s.db)

	// AC6 — lockout check BEFORE user lookup. The gate persists for the
	// full LoginLockoutDuration after the last failure: we ask not only
	// "are there N failures in the 10-min trigger window?" but also "are
	// there N failures in the 15-min sustained window?". The second gate
	// keeps the lockout active across the gap where the rolling 10-min
	// count would otherwise have dropped below threshold — preserving the
	// AC6+AC7 promise that the user is locked out until 15 min after the
	// last failure, regardless of the burst's tail.
	triggerFailed, err := preTxQ.CountFailedLoginAttemptsSince(ctx, generated.CountFailedLoginAttemptsSinceParams{
		EmailNorm:   normalizedEmail,
		AttemptedAt: pgtype.Timestamptz{Time: now.Add(-LoginLockoutWindow), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("count failed attempts (trigger): %w", err)
	}
	sustainedFailed, err := preTxQ.CountFailedLoginAttemptsSince(ctx, generated.CountFailedLoginAttemptsSinceParams{
		EmailNorm:   normalizedEmail,
		AttemptedAt: pgtype.Timestamptz{Time: now.Add(-LoginLockoutDuration), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("count failed attempts (sustained): %w", err)
	}
	if triggerFailed >= LoginLockoutThreshold || sustainedFailed >= LoginLockoutThreshold {
		lastFailedAt, err := preTxQ.LastFailedLoginAttempt(ctx, normalizedEmail)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("last failed attempt: %w", err)
		}
		if err == nil && lastFailedAt.Valid {
			lockedUntil := lastFailedAt.Time.Add(LoginLockoutDuration)
			if now.Before(lockedUntil) {
				s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
					Event:      "login.locked_out",
					EntityType: "login",
					Changes:    Changes{After: map[string]any{"emailNorm": normalizedEmail}},
				})
				return nil, &AccountLockedError{RetryAfter: lockedUntil.Sub(now)}
			}
		}
	}

	user, err := preTxQ.GetUserByEmail(ctx, normalizedEmail)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Why: a dummy bcrypt compare keeps the unknown-email response
			// time within bcrypt-cost-12 noise of the known-email path, so
			// timing alone cannot enumerate registered addresses.
			_ = bcrypt.CompareHashAndPassword([]byte(BcryptDummyHash), []byte(in.Password))
			if recErr := s.recordLoginAttempt(ctx, normalizedEmail, false); recErr != nil {
				return nil, recErr
			}
			s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
				Event:      "login.failed",
				EntityType: "login",
				Changes:    Changes{After: map[string]any{"reason": "unknown_email"}},
			})
			return nil, &InvalidCredentialsError{}
		}
		return nil, fmt.Errorf("get user by email: %w", err)
	}

	// Google-OAuth-only user (no password set yet) → same response as wrong
	// password. Story 1.3 made password_hash nullable for this case.
	if !user.PasswordHash.Valid {
		_ = bcrypt.CompareHashAndPassword([]byte(BcryptDummyHash), []byte(in.Password))
		if recErr := s.recordLoginAttempt(ctx, normalizedEmail, false); recErr != nil {
			return nil, recErr
		}
		s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
			Event:      "login.failed",
			EntityType: "login",
			Changes:    Changes{After: map[string]any{"reason": "no_password_set"}},
		})
		return nil, &InvalidCredentialsError{}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(in.Password)); err != nil {
		if recErr := s.recordLoginAttempt(ctx, normalizedEmail, false); recErr != nil {
			return nil, recErr
		}
		userUUID, _ := pgUUIDToGoogle(user.ID)
		s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
			UserID:     userUUID,
			Event:      "login.failed",
			EntityType: "login",
			EntityID:   userUUID,
			Changes:    Changes{After: map[string]any{"reason": "wrong_password"}},
		})
		return nil, &InvalidCredentialsError{}
	}

	// Success path: open tx → insert success attempt + reset counter +
	// insert fresh refresh-token row → commit. Generate JWT outside tx.
	refreshRaw, refreshHash, familyID, err := generateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
	refreshExpiry := now.Add(RefreshTokenTTLDefault)
	if in.RememberMe {
		refreshExpiry = now.Add(RefreshTokenTTLRememberMe)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin login tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)
	if err := q.InsertLoginAttempt(ctx, generated.InsertLoginAttemptParams{
		EmailNorm:   normalizedEmail,
		AttemptedAt: pgtype.Timestamptz{Time: now, Valid: true},
		Success:     true,
		IpAddress:   ipFromContext(ctx),
	}); err != nil {
		return nil, fmt.Errorf("insert login attempt: %w", err)
	}
	if err := q.DeleteLoginAttemptsByEmail(ctx, normalizedEmail); err != nil {
		return nil, fmt.Errorf("reset login attempts: %w", err)
	}
	if _, err := q.CreateRefreshToken(ctx, generated.CreateRefreshTokenParams{
		UserID:     user.ID,
		TokenHash:  refreshHash,
		FamilyID:   pgtype.UUID{Bytes: familyID, Valid: true},
		ExpiresAt:  pgtype.Timestamptz{Time: refreshExpiry, Valid: true},
		RememberMe: in.RememberMe,
	}); err != nil {
		return nil, fmt.Errorf("create refresh token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit login tx: %w", err)
	}

	// Build access JWT. Single-membership users get center_id + role baked
	// into the claim so the frontend can render immediately without a
	// follow-up call. Multi-membership (Epic 2+) leaves claims empty and
	// requires an explicit membership-select endpoint.
	access, accessExp, err := s.buildAccessToken(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}

	userUUID, _ := pgUUIDToGoogle(user.ID)
	s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
		UserID:     userUUID,
		Event:      "login.succeeded",
		EntityType: "user",
		EntityID:   userUUID,
	})

	refreshTTL := RefreshTokenTTLDefault
	if in.RememberMe {
		refreshTTL = RefreshTokenTTLRememberMe
	}
	return &LoginResult{
		AccessToken:      access,
		RefreshToken:     refreshRaw,
		AccessExpiresAt:  accessExp,
		RefreshExpiresAt: refreshExpiry,
		RefreshTTL:       refreshTTL,
		User:             user,
	}, nil
}

// recordLoginAttempt inserts a non-success row outside any caller-held tx.
//
// why P15: the attempt write is the substrate the lockout gate reads from
// on the next request. If we silently swallow failures, a sustained DB
// hiccup lets an attacker keep guessing without ever tripping lockout.
// We surface the error to the caller so persistent failures become 500s
// rather than free brute-force. The per-call deadline (P28) keeps a
// stalled pool from holding the user-facing response.
func (s *AuthService) recordLoginAttempt(ctx context.Context, emailNorm string, success bool) error {
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), recordLoginAttemptTimeout)
	defer cancel()
	q := generated.New(s.db)
	err := q.InsertLoginAttempt(writeCtx, generated.InsertLoginAttemptParams{
		EmailNorm:   emailNorm,
		AttemptedAt: pgtype.Timestamptz{Time: s.clk.Now(), Valid: true},
		Success:     success,
		IpAddress:   ipFromContext(ctx),
	})
	if err != nil {
		slog.WarnContext(ctx, "login_attempt_write_failed",
			"event", "login_attempt_write_failed",
			"email_norm", emailNorm,
			"success", success,
			"error", err.Error(),
		)
		return fmt.Errorf("record login attempt: %w", err)
	}
	return nil
}

// mintAccessToken signs a fresh access token for a caller-specified
// identity. Unlike buildAccessToken it does NOT read center_members — the
// caller (Story 2.1 CenterService.CreateCenter) has just inserted the
// membership row in the same tx and would race against its own uncommitted
// write. When centerID is nil, the JWT carries only UserID.
//
// Unexported so the only callable seam is *AuthService.MintAccessToken —
// preventing a future caller from smuggling an arbitrary role claim from
// outside the service package.
func mintAccessToken(jwt JWTSigner, clk clock.Clock, userID uuid.UUID, centerID *uuid.UUID, role string) (string, time.Time, error) {
	claims := AccessClaims{UserID: userID.String()}
	if centerID != nil {
		claims.CenterID = centerID.String()
		claims.Role = role
	}
	signed, err := jwt.SignAccess(claims, int(AccessTokenTTL.Seconds()))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, clk.Now().Add(AccessTokenTTL), nil
}

// MintAccessToken is the sole external seam for minting a fresh access token
// for the CenterService.CreateCenter path — the AuthService instance is
// already wired at cmd/api/main.go and CenterService consumes it through
// the accessTokenIssuer interface.
func (s *AuthService) MintAccessToken(ctx context.Context, userID uuid.UUID, centerID *uuid.UUID, role string) (string, time.Time, error) {
	return mintAccessToken(s.jwt, s.clk, userID, centerID, role)
}

// buildAccessToken signs a 15-minute JWT carrying the user's id and, when
// the user has exactly ONE active center_members row, the (center_id, role)
// pair as additional claims.
func (s *AuthService) buildAccessToken(ctx context.Context, userID pgtype.UUID) (string, time.Time, error) {
	uid, err := pgUUIDToGoogle(userID)
	if err != nil {
		return "", time.Time{}, err
	}
	claims := AccessClaims{UserID: uid.String()}

	// Single-membership lookup. RLS on center_members would normally hide
	// rows without an app.current_tenant_id, but this query needs to read
	// across tenants — it runs from a non-tenant context (login). Story
	// 1.5 does not add an explicit sqlc helper because the lookup is
	// transient: Epic 2 introduces a proper membership-select endpoint
	// that replaces this auto-binding heuristic. Until then, only emit
	// claims when the user has exactly one membership.
	var centerID pgtype.UUID
	var role string
	var cnt int
	if err := s.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM center_members WHERE user_id = $1`, userID).Scan(&cnt); err == nil && cnt == 1 {
		row := s.db.QueryRow(ctx,
			`SELECT center_id, role FROM center_members WHERE user_id = $1`, userID)
		if scanErr := row.Scan(&centerID, &role); scanErr == nil && centerID.Valid {
			claims.CenterID = uuid.UUID(centerID.Bytes).String()
			claims.Role = role
		}
	}

	signed, err := s.jwt.SignAccess(claims, int(AccessTokenTTL.Seconds()))
	if err != nil {
		return "", time.Time{}, err
	}
	return signed, s.clk.Now().Add(AccessTokenTTL), nil
}

// HashRefreshToken is the canonical hash function used to derive the
// storage hash from the raw refresh token. Exported so tests can match
// rows by hash without leaking the raw token. Uses sha256 over the entire
// raw token (family + dot + random suffix); attempting to substitute the
// family alone yields a different hash.
func HashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// HashResetToken is the canonical hash function used to derive the
// storage hash from the raw password-reset token. The raw value only ever
// exists in transit (HTTP body, outgoing email); the DB column stores the
// hex-encoded sha256 of it.
func HashResetToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// generateRefreshToken returns (raw, hash, familyID) suitable for a brand-new
// session. The raw token is "<familyHex>.<base64url(32-bytes)>".
func generateRefreshToken() (raw, hash string, familyID uuid.UUID, err error) {
	familyID = uuid.New()
	b := make([]byte, RefreshTokenRandomBytes)
	if _, err = rand.Read(b); err != nil {
		return "", "", uuid.Nil, fmt.Errorf("read random: %w", err)
	}
	familyHex := strings.ReplaceAll(familyID.String(), "-", "")
	raw = familyHex + "." + base64.RawURLEncoding.EncodeToString(b)
	hash = HashRefreshToken(raw)
	return raw, hash, familyID, nil
}

// rotateRefreshToken returns (new raw, new hash) preserving the given family.
func rotateRefreshTokenValue(familyID uuid.UUID) (raw, hash string, err error) {
	b := make([]byte, RefreshTokenRandomBytes)
	if _, err = rand.Read(b); err != nil {
		return "", "", fmt.Errorf("read random: %w", err)
	}
	familyHex := strings.ReplaceAll(familyID.String(), "-", "")
	raw = familyHex + "." + base64.RawURLEncoding.EncodeToString(b)
	hash = HashRefreshToken(raw)
	return raw, hash, nil
}

// parseRefreshTokenFamily extracts the family UUID encoded as the leading
// segment of the raw refresh token. Returns an error on any malformed shape.
//
// why strict lowercase hex: uuid.Parse is case-insensitive, so two raw
// tokens differing only in hex case yield the same family but different
// SHA-256 hashes — handleRefreshMiss would then fire on a malformed-case
// replay and revoke the family. The canonical encoding our own emitter
// produces is lowercase hex; rejecting anything else here closes that
// surface.
func parseRefreshTokenFamily(raw string) (uuid.UUID, error) {
	parts := strings.SplitN(raw, ".", 2)
	if len(parts) != 2 || parts[1] == "" {
		return uuid.Nil, errors.New("refresh token: malformed")
	}
	if !refreshFamilyHexPattern.MatchString(parts[0]) {
		return uuid.Nil, errors.New("refresh token: bad family hex")
	}
	// Reinsert dashes so uuid.Parse succeeds: 8-4-4-4-12.
	hex := parts[0]
	dashed := hex[:8] + "-" + hex[8:12] + "-" + hex[12:16] + "-" + hex[16:20] + "-" + hex[20:]
	id, err := uuid.Parse(dashed)
	if err != nil {
		return uuid.Nil, fmt.Errorf("refresh token: bad family hex: %w", err)
	}
	return id, nil
}

// ipFromContext reads the request IP that ClientIP middleware injected.
// Returns NULL pgtype.Text when absent (test contexts, internal calls).
func ipFromContext(ctx context.Context) pgtype.Text {
	if ip, ok := ctx.Value(model.IPAddress).(string); ok && ip != "" {
		return pgtype.Text{String: ip, Valid: true}
	}
	return pgtype.Text{}
}
