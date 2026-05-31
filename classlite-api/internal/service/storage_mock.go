package service

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// MockStorageService records storage operations for testing.
type MockStorageService struct {
	mu      sync.Mutex
	Objects map[string]*ObjectMeta // Simulate stored objects.

	PresignError    error // Set to simulate presign failures.
	HeadObjectError error // Set to simulate head failures.
}

// NewMockStorageService creates a mock with an empty object store.
func NewMockStorageService() *MockStorageService {
	return &MockStorageService{
		Objects: make(map[string]*ObjectMeta),
	}
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

// Verify MockStorageService implements StorageService at compile time.
var _ StorageService = (*MockStorageService)(nil)
