// Story 4.4a — AC12 storage-ceiling concurrency (the party-mode HIGHEST-severity
// finding). Quota is a TOCTOU race unless the SUM(size_bytes) check runs INSIDE
// the confirm tx, serialized per-center. This test MUST use SetupRawPool — not
// SetupDB — because SetupDB wraps the whole test in ONE pgx.Tx that serializes
// goroutine writes, so a broken (un-serialized) quota check would still pass.
package test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const quotaRaceWaitTimeout = 30 * time.Second

// newQuotaCenter creates a committed center (superuser, no RLS) with a specific
// ceiling and returns its id + a tenant context (owner role; no user → confirm
// skips audit). Random id so parallel test binaries never collide.
func newQuotaCenter(t *testing.T, limitBytes int64) (pgtype.UUID, model.TenantContext) {
	t.Helper()
	centerID := NewPGUUIDFromString(uuid.NewString())
	sp := SuperuserPool(t)
	short := "quota-" + uuid.NewString()[:8]
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO centers (id, name, short_code, storage_limit_bytes) VALUES ($1, $2, $3, $4)`,
		centerID, "Quota Center", short, limitBytes,
	); err != nil {
		t.Fatalf("create quota center: %v", err)
	}
	t.Cleanup(func() { CleanupKnowledgeHub(t, centerID) })
	return centerID, model.TenantContext{CenterID: UUIDString(centerID), Role: string(model.RoleOwner)}
}

// TestStorage_ConcurrentConfirm_ExactlyOneWinsAtCeiling — two 6 MB confirms
// against a 10 MB ceiling → exactly one 200, one STORAGE_FULL, one persisted row.
func TestStorage_ConcurrentConfirm_ExactlyOneWinsAtCeiling(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()

	centerID, tc := newQuotaCenter(t, 10*oneMB)
	mock := service.NewMockStorageService()
	keyA := UUIDString(centerID) + "/knowledge/a.pdf"
	keyB := UUIDString(centerID) + "/knowledge/b.pdf"
	mock.Objects[keyA] = &service.ObjectMeta{Key: keyA, ContentType: "application/pdf", Size: 6 * oneMB}
	mock.Objects[keyB] = &service.ObjectMeta{Key: keyB, ContentType: "application/pdf", Size: 6 * oneMB}

	fileSvc := service.NewFileService(pool, mock, service.NewAuditService(pool), clock.RealClock{})

	var (
		wg   sync.WaitGroup
		errs [2]error
	)
	confirm := func(idx int, key string) {
		defer wg.Done()
		_, err := fileSvc.ConfirmUpload(ctx, tc, service.ConfirmUploadInput{
			ObjectKey: key, Name: "f", SizeBytes: 6 * oneMB,
		})
		errs[idx] = err
	}
	wg.Add(2)
	go confirm(0, keyA)
	go confirm(1, keyB)

	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(quotaRaceWaitTimeout):
		t.Fatalf("quota race hung — a ConfirmUpload goroutine did not complete within %s", quotaRaceWaitTimeout)
	}

	var successes, storageFull int
	for _, e := range errs {
		switch {
		case e == nil:
			successes++
		case errors.As(e, &service.StorageFullError{}):
			storageFull++
		default:
			t.Fatalf("unexpected ConfirmUpload error: %v", e)
		}
	}
	if successes != 1 || storageFull != 1 {
		t.Fatalf("expected exactly 1 success + 1 STORAGE_FULL, got %d success / %d full", successes, storageFull)
	}
	if n := CountLiveFiles(t, centerID); n != 1 {
		t.Errorf("expected exactly 1 persisted file after the race, got %d", n)
	}
}

// TestStorage_SoftDeleteFreesSpaceAndUnblocks — accounting uses deleted_at IS
// NULL: fill to the ceiling → STORAGE_FULL, soft-delete, then the same upload
// succeeds.
func TestStorage_SoftDeleteFreesSpaceAndUnblocks(t *testing.T) {
	pool := SetupRawPool(t)
	ctx := context.Background()

	centerID, tc := newQuotaCenter(t, 10*oneMB)
	mock := service.NewMockStorageService()
	fileSvc := service.NewFileService(pool, mock, service.NewAuditService(pool), clock.RealClock{})

	key1 := UUIDString(centerID) + "/knowledge/first.pdf"
	mock.Objects[key1] = &service.ObjectMeta{Key: key1, ContentType: "application/pdf", Size: 8 * oneMB}
	first, err := fileSvc.ConfirmUpload(ctx, tc, service.ConfirmUploadInput{ObjectKey: key1, Name: "first", SizeBytes: 8 * oneMB})
	if err != nil {
		t.Fatalf("first 8 MB upload should succeed: %v", err)
	}

	key2 := UUIDString(centerID) + "/knowledge/second.pdf"
	mock.Objects[key2] = &service.ObjectMeta{Key: key2, ContentType: "application/pdf", Size: 8 * oneMB}
	if _, err := fileSvc.ConfirmUpload(ctx, tc, service.ConfirmUploadInput{ObjectKey: key2, Name: "second", SizeBytes: 8 * oneMB}); !errors.As(err, &service.StorageFullError{}) {
		t.Fatalf("second upload at ceiling should be STORAGE_FULL, got %v", err)
	}

	if err := fileSvc.SoftDeleteFile(ctx, tc, mustUUID(t, first.ID)); err != nil {
		t.Fatalf("soft-delete first: %v", err)
	}
	// The STORAGE_FULL rejection best-effort-deleted key2's object (AC12 orphan
	// cleanup), so the client re-uploads before retrying confirm — re-seed it.
	mock.Objects[key2] = &service.ObjectMeta{Key: key2, ContentType: "application/pdf", Size: 8 * oneMB}
	if _, err := fileSvc.ConfirmUpload(ctx, tc, service.ConfirmUploadInput{ObjectKey: key2, Name: "second", SizeBytes: 8 * oneMB}); err != nil {
		t.Errorf("after soft-delete freed space, second upload should succeed, got %v", err)
	}
}

func mustUUID(t *testing.T, pg pgtype.UUID) uuid.UUID {
	t.Helper()
	return MustParseUUID(t, UUIDString(pg))
}
