package service

import "sync"

// MockHasher records hash calls without invoking bcrypt, enabling AC11's
// "hasher never invoked on validation failure" assertion and saving ~250ms
// per service unit test.
type MockHasher struct {
	mu        sync.Mutex
	CallCount int
	FakeHash  []byte
	FailWith  error
}

func (m *MockHasher) Hash(plaintext []byte) ([]byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.CallCount++
	if m.FailWith != nil {
		return nil, m.FailWith
	}
	if m.FakeHash != nil {
		return append([]byte(nil), m.FakeHash...), nil
	}
	// Why: never embed the plaintext into the default fake hash. Tests that
	// persist this value would otherwise leak the test password into the DB,
	// and an accidental non-test build using this mock would silently store
	// recoverable "hashes".
	return []byte("mock-hash"), nil
}

// Compile-time assertion that MockHasher satisfies Hasher.
var _ Hasher = (*MockHasher)(nil)
