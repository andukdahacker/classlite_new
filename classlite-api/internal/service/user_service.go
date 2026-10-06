// Package service — Story 9.4 self-profile service.
//
// Three operations, all self-scoped by TenantContext.UserID (users is a GLOBAL
// / no-RLS table, so self-scoping is a service responsibility — never a user-id
// param): GetProfile, UpdateProfile (full-snapshot replace, D5), ChangePassword.
//
// Key guards:
//   - UpdateProfile is a FULL-SNAPSHOT replace (D5): the client always sends all
//     four editable fields, so a partial PUT cannot blank a field. The service
//     rejects an empty fullName / a languagePref outside {vi,en} / a bad
//     notificationSettings schema with 422.
//   - Avatar URL is bimodal (D6): a previously-stored full public URL (our R2
//     base) or an external provider URL (Google) is tolerated verbatim; a fresh
//     presign KEY is re-validated against the caller's center prefix (AC9/D11)
//     and HeadObject-rechecked for real size/content-type (D7 — the avatar flow
//     skips /uploads/confirm, so this is where the authoritative check lives),
//     then stored as a full public URL.
//   - ChangePassword hashes OUTSIDE any tx (D10 — no tx at all: one read + one
//     idempotent self-scoped write) and NEVER calls DeleteAllRefreshTokensForUser
//     (AC4/AC10 — the contrast with password RESET; other sessions survive).
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/crypto/bcrypt"
)

// CurrentNotificationSchemaVersion is the live notification_settings schema
// (AC12 / GO-7). A write must carry this version; a read of an older/unknown
// version upcasts-with-defaults (never 500).
const CurrentNotificationSchemaVersion = 1

// supportedLanguagePrefs gates users.language_pref (AC3 / D9 — the column has no
// CHECK constraint, so the service is the only gate).
var supportedLanguagePrefs = map[string]bool{"vi": true, "en": true}

// NotificationSettings is the typed notification_settings jsonb (AC12 / GO-7 —
// never map[string]interface{}). The v1 set is a small fixed boolean group; the
// live consumer (inbox event routing) lands in Epic 10 and is authoritative over
// these persisted values.
type NotificationSettings struct {
	SchemaVersion       int  `json:"schemaVersion"`
	EmailOnSubmission   bool `json:"emailOnSubmission"`
	EmailOnQuestion     bool `json:"emailOnQuestion"`
	EmailOnAnnouncement bool `json:"emailOnAnnouncement"`
}

// DefaultNotificationSettings is the canonical v1 set — all booleans opted in,
// matching the migration column default.
func DefaultNotificationSettings() NotificationSettings {
	return NotificationSettings{
		SchemaVersion:       CurrentNotificationSchemaVersion,
		EmailOnSubmission:   true,
		EmailOnQuestion:     true,
		EmailOnAnnouncement: true,
	}
}

// DecodeNotificationSettings upcasts a stored jsonb blob to the current schema,
// defaulting any absent/unknown field (AC12 — an older/unknown schemaVersion
// never 500s). A corrupt blob falls back to the all-defaults set.
func DecodeNotificationSettings(raw []byte) NotificationSettings {
	out := DefaultNotificationSettings()
	if len(raw) == 0 {
		return out
	}
	var probe struct {
		EmailOnSubmission   *bool `json:"emailOnSubmission"`
		EmailOnQuestion     *bool `json:"emailOnQuestion"`
		EmailOnAnnouncement *bool `json:"emailOnAnnouncement"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return out // corrupt → safe defaults, never surface a 500
	}
	if probe.EmailOnSubmission != nil {
		out.EmailOnSubmission = *probe.EmailOnSubmission
	}
	if probe.EmailOnQuestion != nil {
		out.EmailOnQuestion = *probe.EmailOnQuestion
	}
	if probe.EmailOnAnnouncement != nil {
		out.EmailOnAnnouncement = *probe.EmailOnAnnouncement
	}
	// schemaVersion is normalized to current on read — the upcast.
	out.SchemaVersion = CurrentNotificationSchemaVersion
	return out
}

// UserProfile is the self-profile DTO returned by GetProfile / UpdateProfile.
type UserProfile struct {
	ID                   uuid.UUID
	Email                string
	FullName             string
	AvatarURL            *string
	LanguagePref         string
	NotificationSettings NotificationSettings
	EmailVerified        bool
	IsOAuthOnly          bool // no password hash → signs in with Google (AC7).
}

// UpdateProfileInput is the validated full-snapshot payload (D5).
type UpdateProfileInput struct {
	FullName             string
	AvatarURL            *string // nil / "" clears; a key is validated+rewritten; a URL is tolerated.
	LanguagePref         string
	NotificationSettings NotificationSettings
}

// changePasswordStore is the narrow seam ChangePassword writes through. It
// INCLUDES DeleteAllRefreshTokensForUser deliberately — so the AC10b unit test
// can prove the password-RESET flow's session nuke is NEVER invoked on a
// password CHANGE (the AC4 regression guard: a future copy-paste from
// auth_reset.go would trip it). *generated.Queries satisfies it in production.
type changePasswordStore interface {
	GetUserByID(ctx context.Context, id pgtype.UUID) (generated.User, error)
	UpdateUserPassword(ctx context.Context, arg generated.UpdateUserPasswordParams) error
	DeleteAllRefreshTokensForUser(ctx context.Context, userID pgtype.UUID) error
}

// UserService owns the self-profile operations.
type UserService struct {
	db               generated.DBTX
	hasher           Hasher
	storage          StorageService // may be nil in dev (no R2) → avatar HeadObject re-check skipped.
	publicAvatarBase string         // R2_PUBLIC_AVATAR_BASE, trailing slash trimmed.
	clk              clock.Clock
	cpStore          changePasswordStore
}

// NewUserService wires the self-profile service. publicAvatarBase is the stable
// public URL prefix the avatars/ R2 prefix is served from (D6-A).
func NewUserService(db generated.DBTX, hasher Hasher, storage StorageService, publicAvatarBase string, clk clock.Clock) *UserService {
	return &UserService{
		db:               db,
		hasher:           hasher,
		storage:          storage,
		publicAvatarBase: strings.TrimRight(publicAvatarBase, "/"),
		clk:              clk,
		cpStore:          generated.New(db),
	}
}

// GetProfile returns the caller's own profile (AC6 / D1).
func (s *UserService) GetProfile(ctx context.Context, tc model.TenantContext) (*UserProfile, error) {
	userID, err := parseSelfUserID(tc)
	if err != nil {
		return nil, err
	}
	row, err := generated.New(s.db).GetUserProfile(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "user", ID: tc.UserID, Code: "USER_NOT_FOUND"}
		}
		return nil, fmt.Errorf("get user profile %s: %w", tc.UserID, err)
	}
	return &UserProfile{
		ID:                   uuid.UUID(row.ID.Bytes),
		Email:                row.Email,
		FullName:             row.FullName,
		AvatarURL:            textToPtr(row.AvatarUrl),
		LanguagePref:         row.LanguagePref,
		NotificationSettings: DecodeNotificationSettings(row.NotificationSettings),
		EmailVerified:        row.EmailVerified,
		IsOAuthOnly:          !row.PasswordHash.Valid,
	}, nil
}

// UpdateProfile applies a full-snapshot replace of the four editable fields (AC6 / D5).
func (s *UserService) UpdateProfile(ctx context.Context, tc model.TenantContext, in UpdateProfileInput) (*UserProfile, error) {
	name := strings.TrimSpace(in.FullName)
	var fields []model.FieldError
	if name == "" {
		fields = append(fields, model.FieldError{Field: "fullName", Message: "required"})
	}
	if !supportedLanguagePrefs[in.LanguagePref] {
		fields = append(fields, model.FieldError{Field: "languagePref", Message: "must be one of: vi, en"})
	}
	if in.NotificationSettings.SchemaVersion != CurrentNotificationSchemaVersion {
		fields = append(fields, model.FieldError{Field: "notificationSettings", Message: fmt.Sprintf("schemaVersion must be %d", CurrentNotificationSchemaVersion)})
	}
	if len(fields) > 0 {
		return nil, model.ValidationError{Fields: fields}
	}

	userID, err := parseSelfUserID(tc)
	if err != nil {
		return nil, err
	}

	// Read the current row BEFORE resolving the avatar: it confirms the row
	// exists (a clean 404) and yields the currently-stored avatar_url, which
	// resolveAvatarURL needs to distinguish a genuine no-op re-send of the stored
	// avatar from an attempt to set a NEW arbitrary full URL (D1 review patch).
	currentRow, err := generated.New(s.db).GetUserProfile(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "user", ID: tc.UserID, Code: "USER_NOT_FOUND"}
		}
		return nil, fmt.Errorf("get user profile %s: %w", tc.UserID, err)
	}
	currentAvatar := ""
	if currentRow.AvatarUrl.Valid {
		currentAvatar = currentRow.AvatarUrl.String
	}

	avatarStored, err := s.resolveAvatarURL(ctx, tc, in.AvatarURL, currentAvatar)
	if err != nil {
		return nil, err
	}

	notifJSON, err := json.Marshal(in.NotificationSettings)
	if err != nil {
		return nil, fmt.Errorf("marshal notification settings: %w", err)
	}

	row, err := generated.New(s.db).UpdateUserProfile(ctx, generated.UpdateUserProfileParams{
		ID:                   userID,
		FullName:             name,
		AvatarUrl:            avatarStored,
		LanguagePref:         in.LanguagePref,
		NotificationSettings: notifJSON,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "user", ID: tc.UserID, Code: "USER_NOT_FOUND"}
		}
		return nil, fmt.Errorf("update user profile %s: %w", tc.UserID, err)
	}
	return &UserProfile{
		ID:                   uuid.UUID(row.ID.Bytes),
		Email:                row.Email,
		FullName:             row.FullName,
		AvatarURL:            textToPtr(row.AvatarUrl),
		LanguagePref:         row.LanguagePref,
		NotificationSettings: DecodeNotificationSettings(row.NotificationSettings),
		EmailVerified:        row.EmailVerified,
		IsOAuthOnly:          !row.PasswordHash.Valid,
	}, nil
}

// ChangePassword verifies the current password and stores a new one WITHOUT
// invalidating other sessions (AC4 / AC10 / D10).
func (s *UserService) ChangePassword(ctx context.Context, tc model.TenantContext, currentPassword, newPassword string) error {
	userID, err := parseSelfUserID(tc)
	if err != nil {
		return err
	}
	user, err := s.cpStore.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.NotFoundError{Resource: "user", ID: tc.UserID, Code: "USER_NOT_FOUND"}
		}
		return fmt.Errorf("get user %s: %w", tc.UserID, err)
	}

	// D10 / AC4 — guard the OAuth-only (null hash) case BEFORE the compare, so an
	// OAuth user gets a typed 409 rather than a bcrypt error / 500.
	if !user.PasswordHash.Valid {
		return &PasswordNotSetError{}
	}
	if berr := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash.String), []byte(currentPassword)); berr != nil {
		return &InvalidCurrentPasswordError{}
	}

	// Validate the new password against the SHARED reset constants (AC4).
	if len(newPassword) < MinPasswordLength {
		return model.ValidationError{Fields: []model.FieldError{{Field: "newPassword", Message: fmt.Sprintf("must be at least %d characters", MinPasswordLength)}}}
	}
	if strings.TrimSpace(newPassword) == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "newPassword", Message: "must not be whitespace-only"}}}
	}
	if len([]byte(newPassword)) > MaxPasswordBytes {
		return model.ValidationError{Fields: []model.FieldError{{Field: "newPassword", Message: fmt.Sprintf("must be at most %d bytes", MaxPasswordBytes)}}}
	}

	// D10 — hash OUTSIDE any transaction. ChangePassword is one read + one
	// idempotent self-scoped write; wrapping it in a tx (PERF-1) would pin a
	// pooled connection across ~250ms of CPU hashing on a rate-limited endpoint.
	hash, err := s.hasher.Hash([]byte(newPassword))
	if err != nil {
		return fmt.Errorf("hash new password: %w", err)
	}
	if err := s.cpStore.UpdateUserPassword(ctx, generated.UpdateUserPasswordParams{
		ID:           userID,
		PasswordHash: pgtype.Text{String: string(hash), Valid: true},
	}); err != nil {
		return fmt.Errorf("update user password %s: %w", tc.UserID, err)
	}

	// AC4 / AC10 — DELIBERATELY NOT calling s.cpStore.DeleteAllRefreshTokensForUser:
	// a password CHANGE leaves other sessions intact (unlike a password RESET).
	return nil
}

// resolveAvatarURL maps the client-supplied avatarUrl to the value to persist.
// It is bimodal (D6): the caller's CURRENTLY-STORED avatar (our own public URL,
// or an external Google URL) is tolerated verbatim as a full-snapshot no-op
// re-send; a fresh presign KEY is prefix-guarded (AC9/D11) + HeadObject-rechecked
// (D7) then rewritten to a full public URL; nil/empty clears the avatar.
//
// D1 review patch — a full URL is accepted ONLY when it equals `current` (the
// stored value). Any OTHER full URL is rejected: tolerating arbitrary http(s)
// values let a caller sidestep the center-prefix guard, the png/jpeg/webp +
// 5 MB caps, and the D7 HeadObject re-check (the stored URL is rendered raw as a
// session-wide <img src>), which defeated the very AC9/D11 control it guards.
func (s *UserService) resolveAvatarURL(ctx context.Context, tc model.TenantContext, in *string, current string) (pgtype.Text, error) {
	if in == nil {
		return pgtype.Text{}, nil
	}
	v := strings.TrimSpace(*in)
	if v == "" {
		return pgtype.Text{}, nil
	}
	// No-op re-send of the already-stored avatar (our own public URL or an
	// external Google URL) → tolerate verbatim. This is the ONLY path by which a
	// full URL is accepted from a client.
	if current != "" && v == current {
		return pgtype.Text{String: v, Valid: true}, nil
	}
	// Any other full URL is never acceptable from a client — it would bypass the
	// prefix/type/size/content checks below (D1 review patch).
	if strings.HasPrefix(v, "http://") || strings.HasPrefix(v, "https://") {
		return pgtype.Text{}, KeyPrefixMismatchError{}
	}
	// Otherwise treat as a fresh R2 object KEY from a presign.
	centerID, feature, ext, ok := ParseObjectKey(v)
	if !ok {
		return pgtype.Text{}, model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: "malformed avatar object key"}}}
	}
	// AC9 / D11 — the key's {center_id} segment MUST match the caller's center.
	// An empty-center caller (membership limbo) can never set an R2 key.
	if tc.CenterID == "" || centerID != tc.CenterID {
		return pgtype.Text{}, KeyPrefixMismatchError{}
	}
	if feature != FeatureAvatars {
		return pgtype.Text{}, model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: "object key is not an avatar upload"}}}
	}
	if !FeatureAllowsExtension(FeatureAvatars, ext) {
		return pgtype.Text{}, model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: fmt.Sprintf("avatar type %s is not allowed", ext)}}}
	}
	// P4 review patch — a bare key can only become a servable public URL if a base
	// is configured. With no base we would persist a broken root-relative
	// "/{center}/avatars/..." path, so fail closed (D7 principle) rather than
	// claim to "degrade gracefully" by storing garbage.
	if s.publicAvatarBase == "" {
		return pgtype.Text{}, model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: "avatar storage is not configured"}}}
	}
	// D7 — the avatar flow skips /uploads/confirm, so this is the authoritative
	// server-side re-check of the REAL stored object (client SizeBytes untrusted).
	if s.storage != nil {
		meta, herr := s.storage.HeadObject(ctx, v)
		if herr != nil {
			// Fail closed — never persist a URL we could not verify.
			return pgtype.Text{}, model.ValidationError{Fields: []model.FieldError{{Field: "avatarUrl", Message: "uploaded avatar could not be verified"}}}
		}
		if cap, hasCap := MaxUploadBytes(FeatureAvatars, ext); hasCap && meta.Size > cap {
			return pgtype.Text{}, FileTooLargeError{Feature: FeatureAvatars, Ext: ext, LimitBytes: cap, GotBytes: meta.Size}
		}
		// P1 review patch — an empty/absent Content-Type is UNVERIFIABLE, so it
		// fails closed (was fail-open). This is the path that compensates for
		// skipping /uploads/confirm; a .png-named key holding SVG/HTML bytes with a
		// stripped Content-Type must not slip through (D8 stored-XSS guard).
		expectedMIME := AllowedExtensions[ext]
		if meta.ContentType == "" || !mediaTypeMatches(meta.ContentType, expectedMIME) {
			return pgtype.Text{}, ContentTypeMismatchError{Expected: expectedMIME, Got: meta.ContentType}
		}
	}
	return pgtype.Text{String: s.publicAvatarBase + "/" + v, Valid: true}, nil
}

// parseSelfUserID converts the token's UserID claim into a pgtype.UUID. A blank
// or malformed claim is a programming error (the route is mounted without
// ExtractTenant) → ForbiddenError, never a panic.
func parseSelfUserID(tc model.TenantContext) (pgtype.UUID, error) {
	if tc.UserID == "" {
		return pgtype.UUID{}, model.ForbiddenError{Reason: "authentication required"}
	}
	id, err := uuid.Parse(tc.UserID)
	if err != nil {
		return pgtype.UUID{}, model.ForbiddenError{Reason: "authentication required"}
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// textToPtr converts a nullable pgtype.Text to *string (GO-5: null → nil → JSON null).
func textToPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}
