// Story 9.4 — UserService integration tests (real DB in a rolled-back tx, the
// repo's TEST-BE-2 idiom). Covers the load-bearing data-safety ACs:
//   - D5 clobber: an avatar-intent full-snapshot PUT preserves name/lang/notif.
//   - AC9/D11: a cross-tenant / empty-center avatar key persists NOTHING.
//   - D9: languagePref ∉ {vi,en} → 422.
//   - AC12: notification_settings jsonb round-trips; an unknown schemaVersion
//     upcasts-with-defaults (never 500).
//   - AC10(b)(2): change-password leaves OTHER refresh_tokens rows intact
//     (store-state proof — never exercises POST /api/auth/refresh).
package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const testAvatarBase = "https://cdn.example.com"

func seedProfileUser(t *testing.T, db *test.TxDB, name, lang string) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := db.QueryRow(context.Background(),
		`INSERT INTO users (email, full_name, email_verified, language_pref) VALUES ($1, $2, true, $3) RETURNING id`,
		test.UniqueEmail("profile"), name, lang,
	).Scan(&id); err != nil {
		t.Fatalf("seed profile user: %v", err)
	}
	return id
}

func defaultNotif() service.NotificationSettings {
	return service.DefaultNotificationSettings()
}

func TestUpdateProfile_AvatarIntentPreservesOtherFields(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "Original Name", "en")

	// A completed avatar upload: seed the HeadObject metadata (image/png, small).
	mock := service.NewMockStorageService()
	key := centerID + "/avatars/" + uuid.NewString() + ".png"
	mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "image/png", Size: 2048}

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, mock, testAvatarBase, clock.RealClock{})
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}

	// Avatar-change INTENT = full snapshot carrying the UNCHANGED name/lang/notif
	// + the new avatar key (what the client's merge-into-cache flow sends, D5).
	avatarKey := key
	profile, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName:             "Original Name",
		AvatarURL:            &avatarKey,
		LanguagePref:         "en",
		NotificationSettings: defaultNotif(),
	})
	if err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}

	// The avatar persisted as a FULL public URL (D6-A).
	wantURL := testAvatarBase + "/" + key
	if profile.AvatarURL == nil || *profile.AvatarURL != wantURL {
		t.Fatalf("avatar URL = %v, want %q", profile.AvatarURL, wantURL)
	}
	// D5 — the other three fields are PRESERVED, not blanked.
	if profile.FullName != "Original Name" {
		t.Fatalf("D5 CLOBBER: fullName = %q, want preserved", profile.FullName)
	}
	if profile.LanguagePref != "en" {
		t.Fatalf("D5 CLOBBER: languagePref = %q, want preserved", profile.LanguagePref)
	}
	if !profile.NotificationSettings.EmailOnSubmission {
		t.Fatal("D5 CLOBBER: notificationSettings were reset")
	}
}

func TestUpdateProfile_RejectsEmptyCenterAvatarKey(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	userID := seedProfileUser(t, db, "Limbo User", "vi")

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})
	// D11 — a membership-limbo caller (empty CenterID) cannot set ANY R2 key.
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: "", EmailVerified: true}
	key := uuid.NewString() + "/avatars/" + uuid.NewString() + ".png"

	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName:             "Limbo User",
		AvatarURL:            &key,
		LanguagePref:         "vi",
		NotificationSettings: defaultNotif(),
	})
	var mismatch service.KeyPrefixMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("D11 VIOLATION: empty-center avatar key should be rejected, got %v", err)
	}
	assertAvatarNull(t, db, userID)
}

func TestUpdateProfile_LanguagePrefValidated(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	userID := seedProfileUser(t, db, "Lang User", "vi")

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: uuid.NewString(), EmailVerified: true}

	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName:             "Lang User",
		AvatarURL:            nil,
		LanguagePref:         "fr", // D9 — not in {vi,en}
		NotificationSettings: defaultNotif(),
	})
	var verr model.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("D9 VIOLATION: languagePref='fr' should 422, got %v", err)
	}
}

func TestUpdateProfile_EmptyFullNameRejected(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	userID := seedProfileUser(t, db, "Has Name", "vi")

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: uuid.NewString(), EmailVerified: true}

	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName:             "   ",
		AvatarURL:            nil,
		LanguagePref:         "vi",
		NotificationSettings: defaultNotif(),
	})
	var verr model.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("D5 VIOLATION: empty fullName should 422 (self-blank guard), got %v", err)
	}
}

func TestUpdateProfile_NotificationSettingsRoundTrip(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "Notif User", "vi")

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}

	custom := service.NotificationSettings{SchemaVersion: 1, EmailOnSubmission: true, EmailOnQuestion: false, EmailOnAnnouncement: true}
	if _, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "Notif User", AvatarURL: nil, LanguagePref: "vi", NotificationSettings: custom,
	}); err != nil {
		t.Fatalf("UpdateProfile: %v", err)
	}
	got, err := svc.GetProfile(ctx, tc)
	if err != nil {
		t.Fatalf("GetProfile: %v", err)
	}
	if got.NotificationSettings != custom {
		t.Fatalf("notif round-trip mismatch: got %+v, want %+v", got.NotificationSettings, custom)
	}
}

func TestGetProfile_UpcastsUnknownSchemaVersion(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	userID := seedProfileUser(t, db, "Future User", "vi")
	// Simulate a row written by a FUTURE schema the current code doesn't know.
	if _, err := db.Exec(ctx,
		`UPDATE users SET notification_settings = '{"schemaVersion":99,"somethingNew":true}'::jsonb WHERE id = $1`,
		userID,
	); err != nil {
		t.Fatalf("seed future schema: %v", err)
	}
	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: uuid.NewString(), EmailVerified: true}

	got, err := svc.GetProfile(ctx, tc) // AC12 — must NOT 500.
	if err != nil {
		t.Fatalf("AC12 VIOLATION: unknown schemaVersion should upcast, got error %v", err)
	}
	if got.NotificationSettings.SchemaVersion != service.CurrentNotificationSchemaVersion {
		t.Fatalf("schemaVersion = %d, want normalized to %d", got.NotificationSettings.SchemaVersion, service.CurrentNotificationSchemaVersion)
	}
	if !got.NotificationSettings.EmailOnSubmission {
		t.Fatal("absent fields should default true on upcast")
	}
}

func TestChangePassword_OtherSessionsSurvive_StoreState(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()

	hash, err := (service.BcryptHasher{Cost: 4}).Hash([]byte("current-pass-123"))
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	var userID pgtype.UUID
	if err := db.QueryRow(ctx,
		`INSERT INTO users (email, full_name, email_verified, password_hash) VALUES ($1, $2, true, $3) RETURNING id`,
		test.UniqueEmail("cp-survive"), "Session Keeper", string(hash),
	).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// Two refresh_tokens rows in DIFFERENT families (two live sessions/devices).
	for i := 0; i < 2; i++ {
		if _, err := db.Exec(ctx,
			`INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at)
			 VALUES ($1, $2, gen_random_uuid(), now() + interval '7 days')`,
			userID, uuid.NewString(),
		); err != nil {
			t.Fatalf("seed refresh token %d: %v", i, err)
		}
	}

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})
	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: uuid.NewString(), EmailVerified: true}

	if err := svc.ChangePassword(ctx, tc, "current-pass-123", "a-brand-new-pass-456"); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}

	// AC10(b)(2) — BOTH rows still present AND unrevoked (store-state, no /refresh).
	var live int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, userID,
	).Scan(&live); err != nil {
		t.Fatalf("count live tokens: %v", err)
	}
	if live != 2 {
		t.Fatalf("AC10b VIOLATION: expected 2 live refresh tokens after change-password, got %d", live)
	}

	// And the password actually changed (compile-time use of generated to keep the
	// store honest about the write).
	q := generated.New(db)
	row, gerr := q.GetUserByID(ctx, userID)
	if gerr != nil {
		t.Fatalf("re-read user: %v", gerr)
	}
	if row.PasswordHash.String == string(hash) {
		t.Fatal("expected the password hash to change")
	}
}

// newAvatarSvc wires a UserService with a mock storage holding a single seeded
// avatar object at `key` with the given content-type/size — the shape of a
// completed presigned avatar upload the D7 re-check inspects.
func newAvatarSvc(t *testing.T, db *test.TxDB, key, contentType string, size int64) *service.UserService {
	t.Helper()
	mock := service.NewMockStorageService()
	mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: contentType, Size: size}
	return service.NewUserService(db, service.BcryptHasher{Cost: 4}, mock, testAvatarBase, clock.RealClock{})
}

// TestUpdateProfile_RejectsOversizeAvatar — D7/P1: the authoritative HeadObject
// re-check rejects an object whose REAL stored size exceeds the 5 MB avatar cap,
// even though the client never sent a size (client SizeBytes is untrusted).
func TestUpdateProfile_RejectsOversizeAvatar(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "Big Avatar", "en")
	key := centerID + "/avatars/" + uuid.NewString() + ".png"
	svc := newAvatarSvc(t, db, key, "image/png", 6*1024*1024) // > 5 MB cap

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}
	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "Big Avatar", AvatarURL: &key, LanguagePref: "en", NotificationSettings: defaultNotif(),
	})
	var tooLarge service.FileTooLargeError
	if !errors.As(err, &tooLarge) {
		t.Fatalf("D7 VIOLATION: oversize avatar should be rejected, got %v", err)
	}
	assertAvatarNull(t, db, userID)
}

// TestUpdateProfile_RejectsWrongContentType — D7/D8: the stored object's real
// Content-Type must match the key extension; a mismatch (e.g. a .png key holding
// a gif) is rejected so a type-spoofed upload never becomes a session-wide avatar.
func TestUpdateProfile_RejectsWrongContentType(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "Spoof Avatar", "en")
	key := centerID + "/avatars/" + uuid.NewString() + ".png"
	svc := newAvatarSvc(t, db, key, "image/gif", 2048) // CT disagrees with .png

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}
	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "Spoof Avatar", AvatarURL: &key, LanguagePref: "en", NotificationSettings: defaultNotif(),
	})
	var mismatch service.ContentTypeMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("D7 VIOLATION: content-type mismatch should be rejected, got %v", err)
	}
	assertAvatarNull(t, db, userID)
}

// TestUpdateProfile_RejectsEmptyContentType — P1: an empty/absent Content-Type is
// UNVERIFIABLE, so the re-check fails CLOSED (previously it fell open on "", the
// exact path a stripped-Content-Type stored-XSS payload would take, D8).
func TestUpdateProfile_RejectsEmptyContentType(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "Empty CT", "en")
	key := centerID + "/avatars/" + uuid.NewString() + ".png"
	svc := newAvatarSvc(t, db, key, "", 2048) // no Content-Type reported

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}
	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "Empty CT", AvatarURL: &key, LanguagePref: "en", NotificationSettings: defaultNotif(),
	})
	var mismatch service.ContentTypeMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("P1 VIOLATION: empty content-type should fail closed, got %v", err)
	}
	assertAvatarNull(t, db, userID)
}

// TestUpdateProfile_RejectsUnverifiableAvatar — D7: a HeadObject failure fails
// CLOSED (a validation error, not a 500) — we never persist a URL we could not
// verify against the real stored object.
func TestUpdateProfile_RejectsUnverifiableAvatar(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "No Head", "en")
	key := centerID + "/avatars/" + uuid.NewString() + ".png"
	mock := service.NewMockStorageService()
	mock.HeadObjectError = errors.New("r2 unavailable")
	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, mock, testAvatarBase, clock.RealClock{})

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}
	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "No Head", AvatarURL: &key, LanguagePref: "en", NotificationSettings: defaultNotif(),
	})
	var verr model.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("D7 VIOLATION: an unverifiable avatar should fail closed with a validation error, got %v", err)
	}
	assertAvatarNull(t, db, userID)
}

// TestUpdateProfile_RejectsArbitraryExternalURL — D1 review patch: a client may
// NOT set an arbitrary full URL as its avatar (it would bypass the center guard +
// type/size/content re-check and render as a session-wide <img src>). Only a
// no-op re-send of the ALREADY-STORED value is tolerated (see the next test).
func TestUpdateProfile_RejectsArbitraryExternalURL(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "URL Setter", "en")
	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}
	evil := "https://attacker.example/tracking-pixel.png"
	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "URL Setter", AvatarURL: &evil, LanguagePref: "en", NotificationSettings: defaultNotif(),
	})
	var mismatch service.KeyPrefixMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("D1 VIOLATION: an arbitrary external avatar URL should be rejected, got %v", err)
	}
	assertAvatarNull(t, db, userID)
}

// TestUpdateProfile_ToleratesStoredAvatarResend — D1/D6: a full-snapshot name
// edit re-sends the user's ALREADY-STORED avatar URL (e.g. a Google OAuth URL)
// verbatim; it must be tolerated as a no-op, not rejected as a new full URL.
func TestUpdateProfile_ToleratesStoredAvatarResend(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	centerID := uuid.NewString()
	userID := seedProfileUser(t, db, "Google User", "en")
	stored := "https://lh3.googleusercontent.com/a/abc123"
	if _, err := db.Exec(ctx, `UPDATE users SET avatar_url = $2 WHERE id = $1`, userID, stored); err != nil {
		t.Fatalf("seed stored avatar: %v", err)
	}
	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), testAvatarBase, clock.RealClock{})

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerID, EmailVerified: true}
	resend := stored
	profile, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName: "Google User Renamed", AvatarURL: &resend, LanguagePref: "en", NotificationSettings: defaultNotif(),
	})
	if err != nil {
		t.Fatalf("no-op re-send of the stored avatar should be tolerated, got %v", err)
	}
	if profile.AvatarURL == nil || *profile.AvatarURL != stored {
		t.Fatalf("stored avatar URL = %v, want preserved %q", profile.AvatarURL, stored)
	}
}

func assertAvatarNull(t *testing.T, db *test.TxDB, userID pgtype.UUID) {
	t.Helper()
	q := generated.New(db)
	row, err := q.GetUserByID(context.Background(), userID)
	if err != nil {
		t.Fatalf("re-read user: %v", err)
	}
	if row.AvatarUrl.Valid {
		t.Fatalf("expected avatar_url to stay NULL, got %q", row.AvatarUrl.String)
	}
}
