// Package service — Hasher seam for password hashing.
//
// AC11 (story 1.4) requires asserting that bcrypt is never called when
// validation fails. We inject a Hasher interface so unit tests can swap in a
// MockHasher and check CallCount. Production wires BcryptHasher{Cost: 12} —
// see Dev Notes → "Bcrypt cost selection" for the cost-12 rationale.
package service

import "golang.org/x/crypto/bcrypt"

// Hasher abstracts password hashing for testability and provider swaps.
type Hasher interface {
	Hash(plaintext []byte) (hash []byte, err error)
}

// BcryptHasher is the production Hasher backed by golang.org/x/crypto/bcrypt.
// Cost 12 is the 2026 OWASP recommendation: ~250ms per hash on modern x86,
// fast enough not to be a DoS vector at the per-route rate limits in AC9,
// slow enough to materially harm bulk-cracking of leaked hash dumps.
type BcryptHasher struct {
	Cost int
}

func (h BcryptHasher) Hash(plaintext []byte) ([]byte, error) {
	return bcrypt.GenerateFromPassword(plaintext, h.Cost)
}
