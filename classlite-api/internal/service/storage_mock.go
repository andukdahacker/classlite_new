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
	m.mu.Lock()
	defer m.mu.Unlock()
	m.contents[key] = content
	m.Objects[key] = &ObjectMeta{Key: key, ContentType: "application/octet-stream", Size: int64(len(content))}
}

// GetObject returns the seeded bytes for a key, or an error if the key was never
// seeded (mirrors R2 returning NoSuchKey → the service maps it to
// IMPORT_FILE_NOT_FOUND).
func (m *MockStorageService) GetObject(ctx context.Context, key string) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.GetObjectError != nil {
		return nil, m.GetObjectError
	}
	content, ok := m.contents[key]
	if !ok {
		return nil, fmt.Errorf("object %s not found", key)
	}
	return content, nil
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
