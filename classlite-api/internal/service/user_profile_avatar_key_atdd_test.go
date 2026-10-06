// Story 9.4 — Task 0 / AC9 (D13) acceptance test (now GREEN — build tag stripped).
//
// This was authored red-first (//go:build atdd_red_phase) before the UserService
// seam existed — the ONLY red-first assertion in 9.4 (D13): the presign-path half
// of AC9 is inherited/shipped (SEC-8 R2_KEY_PREFIX_MISMATCH on POST
// /api/uploads/confirm), but the PUT /api/users/me client-supplied-key guard is
// NET-NEW code at MAX impact (a cross-tenant object reference persisted onto a
// globally-rendered <img src>). The guard now lives in
// UserService.resolveAvatarURL: a value shaped like an R2 key whose {center_id}
// segment != tc.CenterID (or tc.CenterID == "") is rejected and NOTHING persists.
package service_test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestStory94_AC9_UpdateProfile_RejectsCrossTenantAvatarKey(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()

	// Seed a verified user whose JWT resolves to center A.
	centerA := uuid.NewString()
	centerB := uuid.NewString()
	var userID pgtype.UUID
	if err := db.QueryRow(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1, $2, true) RETURNING id`,
		test.UniqueEmail("ac9-cross-tenant"), "Avatar Victim",
	).Scan(&userID); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	svc := service.NewUserService(db, service.BcryptHasher{Cost: 4}, service.NewMockStorageService(), "https://cdn.example.com", clock.RealClock{})

	tc := model.TenantContext{UserID: test.UUIDString(userID), CenterID: centerA, EmailVerified: true}
	crossTenantKey := centerB + "/avatars/" + uuid.NewString() + ".png"
	name := "Avatar Victim"
	lang := "vi"
	badKey := crossTenantKey

	_, err := svc.UpdateProfile(ctx, tc, service.UpdateProfileInput{
		FullName:     name,
		AvatarURL:    &badKey,
		LanguagePref: lang,
		NotificationSettings: service.NotificationSettings{
			SchemaVersion:       1,
			EmailOnSubmission:   true,
			EmailOnQuestion:     true,
			EmailOnAnnouncement: true,
		},
	})
	if err == nil {
		t.Fatal("AC9 VIOLATION: UpdateProfile accepted a cross-tenant avatar key")
	}

	// Persists NOTHING — the avatar_url column must be unchanged (still NULL).
	q := generated.New(db)
	row, gerr := q.GetUserByID(ctx, userID)
	if gerr != nil {
		t.Fatalf("re-read user: %v", gerr)
	}
	if row.AvatarUrl.Valid {
		t.Fatalf("AC9 VIOLATION: cross-tenant key was persisted: %q", row.AvatarUrl.String)
	}
}
