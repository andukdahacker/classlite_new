// Story 6.3b, AC12 · D6/D13 — StorageService.GetObjectOwned (the SEC-8-guarded
// server-side audio download) unit ATDD. RED PHASE.
//
// Build-tagged `atdd_red_phase` (6-3a convention): excluded from `go test ./...`;
// run with `go test -tags=atdd_red_phase ./internal/service/...`. FAILS TO COMPILE
// today — MockStorageService has no GetObjectOwned and no GetObjectKeys spy yet.
// Dev removes this file's build tag once the seam lands (Task 6).
//
// WHY THIS EXISTS (R3=9, the finding the party review would not let go — D13):
//
//	The whole justification for GetObjectOwned (D6) is defense-in-depth: a second
//	tenant-key prefix guard behind the RLS submission read. The specified R3
//	worker test (T-B) fails at the SUBMISSION read, so GetObjectOwned is never
//	driven with a foreign-prefix key there — a passthrough impl that FORGOT the
//	guard would stay green across the entire worker suite. This unit test drives
//	the guard DIRECTLY: a foreign-prefix key must die with KeyPrefixMismatchError
//	having fetched ZERO bytes. It pins the guard in the ONE shared free function
//	(getObjectOwned, the twin of presignGetOwned) so the R2 and mock impls cannot
//	drift (D6 — Murat STRONG: else T-A/T-B go vacuous).
//
// PINNED CONTRACT (dev conforms — Task 6):
//
//	StorageService.GetObjectOwned(ctx context.Context, key string,
//	    tc model.TenantContext) ([]byte, error)
//	Behaviour: re-assert strings.HasPrefix(key, tc.CenterID+"/") in the SHARED
//	free function getObjectOwned(ctx, s, key, tc) (mirror presignGetOwned) — else
//	return service.KeyPrefixMismatchError{} (403 R2_KEY_PREFIX_MISMATCH) having
//	fetched NOTHING; otherwise delegate to GetObject under a maxSpeakingAudioBytes
//	LimitReader. MockStorageService gains a GetObjectKeys []string spy recording
//	every key that reaches the underlying fetch (append at GetObject entry) so the
//	zero-fetch assertion is observable.
package service_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// -----------------------------------------------------------------------------
// T-A — foreign prefix: the guard fires BEFORE any fetch → zero bytes read
// (R3=9, NEW/D13). This is the load-bearing pin: a passthrough GetObjectOwned
// that forgot the prefix guard fails HERE and only here in the base set.
// -----------------------------------------------------------------------------

func TestGetObjectOwned_ForeignPrefix_KeyPrefixMismatch_ZeroFetch(t *testing.T) {
	mock := service.NewMockStorageService()

	tenantA := uuid.New()
	tenantB := uuid.New()
	tc := reviewTC(tenantA, uuid.New(), model.RoleTeacher)

	// A poisoned key: it carries tenant B's prefix while the caller is tenant A.
	// Seed B's bytes at that key so a missing guard would HAND THEM BACK — the
	// test proves they are never even fetched.
	foreignKey := tenantB.String() + "/speaking/" + uuid.NewString() + ".webm"
	mock.SeedObject(foreignKey, []byte("tenant-B-private-audio-bytes"))

	_, err := mock.GetObjectOwned(context.Background(), foreignKey, tc)

	var kp service.KeyPrefixMismatchError
	if !errors.As(err, &kp) {
		t.Fatalf("R3 BREACH: foreign-prefix GetObjectOwned did not reject with KeyPrefixMismatchError, got %T: %v", err, err)
	}
	if len(mock.GetObjectKeys) != 0 {
		t.Errorf("R3 BREACH: prefix guard must fire BEFORE any fetch, but %d fetch(es) occurred: %v", len(mock.GetObjectKeys), mock.GetObjectKeys)
	}
}

// -----------------------------------------------------------------------------
// T-A control — valid prefix: delegates to the fetch and returns the bytes.
// Without this the guard could be "reject everything" and still pass T-A.
// -----------------------------------------------------------------------------

func TestGetObjectOwned_ValidPrefix_ReturnsBytes(t *testing.T) {
	mock := service.NewMockStorageService()

	center := uuid.New()
	tc := reviewTC(center, uuid.New(), model.RoleTeacher)
	key := center.String() + "/speaking/" + uuid.NewString() + ".webm"
	want := []byte("this-center-owns-these-bytes")
	mock.SeedObject(key, want)

	got, err := mock.GetObjectOwned(context.Background(), key, tc)
	if err != nil {
		t.Fatalf("valid-prefix GetObjectOwned errored: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("GetObjectOwned returned %q, want %q", string(got), string(want))
	}
	if len(mock.GetObjectKeys) != 1 || mock.GetObjectKeys[0] != key {
		t.Errorf("expected exactly one owned fetch of %q, got %v", key, mock.GetObjectKeys)
	}
}
