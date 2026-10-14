package service

import (
	"context"
	"fmt"
	"net/url"
	"sync"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
)

// MockStorageService records storage operations for testing.
type MockStorageService struct {
	mu       sync.Mutex
	Objects  map[string]*ObjectMeta // Simulate stored objects.
	contents map[string][]byte      // Story 2.7 — seeded object bodies for GetObject.

	PresignError    error // Set to simulate presign failures.
	HeadObjectError error // Set to simulate head failures.
	GetObjectError  error // Set to simulate download failures.
	DeleteError     error // Set to simulate delete failures (→ orphan telemetry, Story 4.4a).

	// Deleted records every key passed to Delete, in call order — the
	// delete-on-mismatch matrix asserts which objects were (or were NOT) removed.
	Deleted []string

	// PresignGetKeys records every key passed to PresignGet, in call order — the
	// Story 5.5a zero-mint reds assert NO presign happened on gated-failure paths
	// (non-student / not-enrolled / cross-student-404 / missing-404), and exactly
	// ONE mint on the owner-terminal happy path.
	PresignGetKeys []string
	// LastPresignGetExpiry captures the TTL of the most recent PresignGet call so a
	// test can pin the 5-minute GET-URL window (Story 5.5a SEC-8 / PresignGetOwned).
	LastPresignGetExpiry time.Duration

	// GetObjectKeys records every key that reaches the underlying GetObject fetch, in
	// call order (Story 6.3b — T-A/T-B). The audio-guard reds assert it stays EMPTY
	// when GetObjectOwned's prefix guard rejects a foreign key (zero-fetch), and that a
	// valid owned fetch appears exactly once.
	GetObjectKeys []string
	// GetObjectOwnedTenants records the tc.CenterID of every GetObjectOwned call, in
	// order (Story 6.3b — T-D3/R3 re-scope). The transcode-retry ladder must re-drive
	// the owned download under the CORRECT tenant on EACH attempt (not assumed-sticky),
	// so the retry test asserts every entry is tenant A.
	GetObjectOwnedTenants []string

	// sinkBase, when non-empty, makes Presign return a PUT-able URL under this base
	// instead of the dead `mock-r2.example.com` host (Story 11-5a). It is set ONLY
	// in APP_ENV=development with no R2 configured (cmd/api/main.go), so a browser-
	// driven presign→PUT→confirm speaking upload can round-trip against an in-process
	// sink with zero external credentials. Default empty → unchanged legacy behavior.
	sinkBase string
}

// SetSinkBase points Presign at an in-process, PUT-able sink base (e.g.
// `/api/__mock_r2`) so the real upload leg can complete in a credentials-free
// dev/E2E stack (Story 11-5a). Dev-only; never set when R2 is configured.
func (m *MockStorageService) SetSinkBase(base string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sinkBase = base
}

// NewMockStorageService creates a mock with an empty object store.
func NewMockStorageService() *MockStorageService {
	return &MockStorageService{
		Objects:  make(map[string]*ObjectMeta),
		contents: make(map[string][]byte),
	}
}

// SeedObject records raw bytes for a key so GetObject can read them back — the
// test-side equivalent of a completed presigned upload (Story 2.7). A HeadObject
// entry is recorded too so the head/confirm path finds the object.
func (m *MockStorageService) SeedObject(key string, content []byte) {
	m.SeedObjectWithContentType(key, content, "application/octet-stream")
}

// SeedObjectWithContentType records raw bytes AND the stored Content-Type for a key,
// mirroring R2 which preserves the Content-Type signed into the presigned PUT (Story
// 11-5a code-review P9 — the dev mock-R2 sink threads the request Content-Type through
// here so a confirm path that validates stored Content-Type via HeadObject matches the
// real store instead of always seeing octet-stream). An empty contentType falls back to
// application/octet-stream.
func (m *MockStorageService) SeedObjectWithContentType(key string, content []byte, contentType string) {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.contents[key] = content
	m.Objects[key] = &ObjectMeta{Key: key, ContentType: contentType, Size: int64(len(content))}
}

// GetObject returns the seeded bytes for a key, or an error if the key was never
// seeded (mirrors R2 returning NoSuchKey → the service maps it to
// IMPORT_FILE_NOT_FOUND).
func (m *MockStorageService) GetObject(ctx context.Context, key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Record the fetch attempt at method entry (before the error early-return) so the
	// Story 6.3b zero-fetch reds can prove a guarded-out download never reached here.
	m.GetObjectKeys = append(m.GetObjectKeys, key)

	if m.GetObjectError != nil {
		return nil, m.GetObjectError
	}
	content, ok := m.contents[key]
	if !ok {
		// Typed not-found (mirrors R2 mapping NoSuchKey → ObjectNotFoundError) so
		// the 6.3b download classifier maps an unseeded key to TERMINAL
		// audio_unavailable, not the retryable-transport default (Story 6.3b).
		return nil, ObjectNotFoundError{Key: key}
	}
	return content, nil
}

// GetObjectOwned enforces the SEC-8 owned-key prefix guard via the shared free
// function (so the mock's guard can never drift from R2's), then delegates to this
// mock's GetObject (appending the key to the GetObjectKeys spy). It records the
// caller's tenant on every call so the transcode-retry test can prove each attempt
// re-drives the download under the correct tenant (Story 6.3b — D6/D13/D17).
func (m *MockStorageService) GetObjectOwned(ctx context.Context, key string, tc model.TenantContext) ([]byte, error) {
	m.mu.Lock()
	m.GetObjectOwnedTenants = append(m.GetObjectOwnedTenants, tc.CenterID)
	m.mu.Unlock()
	return getObjectOwned(ctx, m, key, tc)
}

// Presign returns a fake presigned URL. Records the key in Objects if not already present.
func (m *MockStorageService) Presign(ctx context.Context, key, contentType string, expiry time.Duration) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.PresignError != nil {
		return "", m.PresignError
	}

	// Record the key so HeadObject can find it in presign→confirm flow.
	if _, exists := m.Objects[key]; !exists {
		m.Objects[key] = &ObjectMeta{Key: key, ContentType: contentType, Size: 0}
	}

	// Story 11-5a — when a sink base is configured (dev/E2E, no R2), return a
	// PUT-able URL at that base so the browser upload actually lands (the sink
	// handler calls SeedObject with the real bytes → confirm sees the real size).
	if m.sinkBase != "" {
		return fmt.Sprintf("%s/%s", m.sinkBase, key), nil
	}

	return fmt.Sprintf("https://mock-r2.example.com/%s?presigned=true", key), nil
}

// PresignGet returns a fake presigned GET URL (Story 4.4b). Reuses PresignError
// so a test can simulate a signing failure; unlike Presign it does not create an
// object entry (a GET presign never brings an object into existence).
func (m *MockStorageService) PresignGet(ctx context.Context, key string, expiry time.Duration, opts PresignGetOpts) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Record the mint attempt at method entry (before the PresignError early-return)
	// so any CALL is observable — the Story 5.5a zero-mint reds prove a gated-failure
	// path never reaches PresignGet at all.
	m.PresignGetKeys = append(m.PresignGetKeys, key)
	m.LastPresignGetExpiry = expiry

	if m.PresignError != nil {
		return "", m.PresignError
	}
	// Echo the disposition into the URL so a test can prove the attachment
	// variant threaded the original filename through (Content-Disposition).
	if opts.Attachment {
		return fmt.Sprintf("https://mock-r2.example.com/%s?presigned=get&disposition=attachment&filename=%s", key, url.QueryEscape(opts.Filename)), nil
	}
	return fmt.Sprintf("https://mock-r2.example.com/%s?presigned=get", key), nil
}

// PresignGetOwned enforces the SEC-8 owned-key prefix guard, then delegates to
// this mock's PresignGet (so the mint spy fires). Shares the same prefix-guard
// implementation as the R2 impl (Story 5.5a).
func (m *MockStorageService) PresignGetOwned(ctx context.Context, key string, tc model.TenantContext, expiry time.Duration) (string, error) {
	return presignGetOwned(ctx, m, key, tc, expiry)
}

// HeadObject returns metadata for a previously stored object.
func (m *MockStorageService) HeadObject(ctx context.Context, key string) (*ObjectMeta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.HeadObjectError != nil {
		return nil, m.HeadObjectError
	}

	obj, ok := m.Objects[key]
	if !ok {
		return nil, fmt.Errorf("object %s not found", key)
	}
	return obj, nil
}

// Delete records the key and removes it from the object store. When DeleteError
// is set it returns that error WITHOUT recording the key (mirrors R2 refusing
// the delete → the caller emits orphaned_object telemetry, Story 4.4a AC9).
func (m *MockStorageService) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.DeleteError != nil {
		return m.DeleteError
	}
	m.Deleted = append(m.Deleted, key)
	delete(m.Objects, key)
	delete(m.contents, key)
	return nil
}

// Verify MockStorageService implements StorageService at compile time.
var _ StorageService = (*MockStorageService)(nil)
