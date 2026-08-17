// Story 5.5a — StorageService.PresignGetOwned (atomic SEC-8 GET presign) service
// ATDD, plus the FileService refactor-parity regression.
//
// Covers:
//   P0-8  valid-prefix key → signs a GET with a 5-minute TTL (not a PUT)
//   P0-9  foreign-prefix key → KeyPrefixMismatchError, zero mint (guard before sign)
//   P0-14 FileService.GetFileDownloadURL parity after being refactored onto
//         PresignGetOwned: still a 5-minute GET presign, still prefix-guarded
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Build-tagged `atdd_red_phase`: excluded
// from normal `go test ./...`; `go test -tags=atdd_red_phase ./...` fails to
// compile on the undefined Story-5.5a symbol (MockStorageService has no
// PresignGetOwned yet). Dev removes the tag per-file as each contract lands.
//
// PINNED CONTRACT (dev conforms):
//   StorageService.PresignGetOwned(ctx context.Context, key string,
//       tc model.TenantContext, expiry time.Duration) (string, error)
//   Behaviour: re-assert strings.HasPrefix(key, tc.CenterID+"/") else return
//   service.KeyPrefixMismatchError{} (403 R2_KEY_PREFIX_MISMATCH); otherwise
//   delegate to the existing PresignGet(ctx, key, expiry, PresignGetOpts{}) — a
//   GET, never a PUT. Callers pass expiry == 5*time.Minute. FileService.GetFile-
//   DownloadURL keeps its own assertClassRole upstream and folds its inline
//   prefix guard + PresignGet into a single PresignGetOwned call.
package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// -----------------------------------------------------------------------------
// P0-8 — valid prefix: signs a 5-minute GET (delegates to PresignGet).
// -----------------------------------------------------------------------------

func TestPresignGetOwned_ValidPrefix_SignsGet_5MinTTL(t *testing.T) {
	mock := service.NewMockStorageService()
	center := uuid.New()
	tc := reviewTC(center, uuid.New(), model.RoleTeacher)
	key := center.String() + "/knowledge/" + uuid.NewString() + ".pdf"

	url, err := mock.PresignGetOwned(context.Background(), key, tc, 5*time.Minute)
	if err != nil {
		t.Fatalf("valid-prefix PresignGetOwned errored: %v", err)
	}
	if url == "" {
		t.Fatal("expected a non-empty presigned URL")
	}
	// GET semantics, not PUT — the mock stamps "presigned=get" on PresignGet and
	// "presigned=true" on the PUT-style Presign.
	if !strings.Contains(url, "presigned=get") || strings.Contains(url, "presigned=true") {
		t.Errorf("expected a GET presign, got %q", url)
	}
	if mock.LastPresignGetExpiry != 5*time.Minute {
		t.Errorf("GET TTL = %v, want 5m", mock.LastPresignGetExpiry)
	}
	if len(mock.PresignGetKeys) != 1 || mock.PresignGetKeys[0] != key {
		t.Errorf("expected exactly one GET mint of %q, got %v", key, mock.PresignGetKeys)
	}
}

// -----------------------------------------------------------------------------
// P0-9 — foreign prefix: the guard fires BEFORE any sign → zero mint.
// -----------------------------------------------------------------------------

func TestPresignGetOwned_ForeignPrefix_KeyPrefixMismatch_ZeroMint(t *testing.T) {
	mock := service.NewMockStorageService()
	tc := reviewTC(uuid.New(), uuid.New(), model.RoleTeacher)
	// Key under a DIFFERENT center's prefix.
	foreignKey := uuid.NewString() + "/knowledge/" + uuid.NewString() + ".pdf"

	_, err := mock.PresignGetOwned(context.Background(), foreignKey, tc, 5*time.Minute)
	var kp service.KeyPrefixMismatchError
	if !errors.As(err, &kp) {
		t.Fatalf("expected KeyPrefixMismatchError for a foreign-prefix key, got %T: %v", err, err)
	}
	if len(mock.PresignGetKeys) != 0 {
		t.Errorf("prefix guard must fire before any mint, got %d mint(s)", len(mock.PresignGetKeys))
	}
}

// -----------------------------------------------------------------------------
// P0-14 — FileService.GetFileDownloadURL parity after the PresignGetOwned
// refactor: a valid-prefix file still yields a 5-minute GET presign routed
// through PresignGetOwned. The foreign-prefix 403 guard is independently proven
// by internal/handler/knowledge_hub_handler_atdd_test.go
// (TestFileDownload_KeyPrefixMismatch_Returns403), so it is not re-seeded here.
// -----------------------------------------------------------------------------

func TestFileServiceGetFileDownloadURL_Parity_OnPresignGetOwned(t *testing.T) {
	db := test.SetupDB(t)
	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	centerID := uuid.UUID(center.ID.Bytes)
	test.TenantContext(t, db, center.ID)
	owner := reviewInsertUser(t, db, "owner-"+uuid.NewString()+"@example.com")
	test.CreateCenterMember(t, db, reviewPg(owner), center.ID, "owner")

	objectKey := centerID.String() + "/knowledge/" + uuid.NewString() + ".pdf"
	slug := "doc-" + uuid.NewString()[:8]
	if _, err := db.Exec(context.Background(),
		`INSERT INTO files (center_id, name, slug, object_key, content_type, size_bytes, uploaded_by)
		 VALUES ($1, 'doc.pdf', $2, $3, 'application/pdf', 1024, $4)`,
		centerID, slug, objectKey, owner); err != nil {
		t.Fatalf("seed file: %v", err)
	}

	mock := service.NewMockStorageService()
	fileSvc := service.NewFileService(db, mock, service.NewAuditService(db), clock.RealClock{})
	tc := reviewTC(centerID, owner, model.RoleOwner)

	url, err := fileSvc.GetFileDownloadURL(context.Background(), tc, slug, false)
	if err != nil {
		t.Fatalf("download URL errored: %v", err)
	}
	if url == "" {
		t.Fatal("expected a non-empty download URL")
	}
	if mock.LastPresignGetExpiry != 5*time.Minute {
		t.Errorf("download TTL = %v, want 5m (parity after PresignGetOwned refactor)", mock.LastPresignGetExpiry)
	}
	if len(mock.PresignGetKeys) != 1 || mock.PresignGetKeys[0] != objectKey {
		t.Errorf("expected exactly one GET mint of the file's object key %q, got %v", objectKey, mock.PresignGetKeys)
	}
}
