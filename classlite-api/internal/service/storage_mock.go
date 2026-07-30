package service

import (
	"context"
	"fmt"
	"sync"
	"time"
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
