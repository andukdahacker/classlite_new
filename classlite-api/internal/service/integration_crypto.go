// Package service — Story 2.5c AES-256-GCM sealed-box crypto for
// per-center OAuth tokens (google_meet + future providers).
//
// Format: `nonce (12 bytes) || ciphertext (variable) || authTag (16 bytes)`
// — the standard AES-GCM Seal() output with the nonce prepended so
// consumers can recover it. `cipher.NewGCM` returns nonce-size 12 by
// default; the code asserts it and never accepts a shorter nonce (guards
// against a runtime downgrade if the stdlib default ever shifts).
//
// This is the ONLY code path in the API that touches plaintext tokens.
// Everything upstream (handler, service.HandleCallback, sqlc.Upsert)
// works with encrypted bytea. The Task 10 log-scrub audit greps for
// `access_token|refresh_token|IntegrationsEncryptionKey` outside this
// module + tests to enforce the boundary.
package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
)

// AESGCMKeyBytes is the required AES-256-GCM key length. Config.Validate
// asserts INTEGRATIONS_ENCRYPTION_KEY decodes to exactly this many bytes.
const AESGCMKeyBytes = 32

// AESGCMNonceBytes is the standard GCM nonce length used by cipher.NewGCM.
// SealToken/OpenToken assert against this constant so a stdlib nonce-size
// shift surfaces at test time instead of at token-read time.
const AESGCMNonceBytes = 12

// ErrEmptyEncryptionKey is returned when SealToken or OpenToken is called
// with a zero-length key. Guards against an operator config-load bug
// where the byte slice is nil but the caller forgot to fail-fast at boot.
var ErrEmptyEncryptionKey = errors.New("integration encryption key is empty")

// ErrInvalidEncryptionKeyLength is returned when SealToken or OpenToken is
// called with a non-zero key whose length is not AESGCMKeyBytes (32). Guards
// against a silent AES-128/192 downgrade: `aes.NewCipher` accepts 16/24/32
// byte keys, so a caller passing a truncated 16-byte key would produce
// AES-128 ciphertext despite the module doc claiming AES-256. Config.Validate
// blocks non-32 keys at boot for non-dev, but this guard is the last line of
// defense against a future caller (worker, refactor, test) with a bad key.
// (P1 fix from Round 1 /bmad-code-review Chunk 2 2026-07-16.)
var ErrInvalidEncryptionKeyLength = errors.New("integration encryption key must be exactly 32 bytes (AES-256)")

// SealToken produces `nonce || ciphertext || authTag` given a plaintext
// and a 32-byte AES-256 key. Nonce is fresh from crypto/rand on every
// call — reusing a nonce under the same key would break GCM confidentiality.
func SealToken(plaintext, key []byte) ([]byte, error) {
	if len(key) == 0 {
		return nil, ErrEmptyEncryptionKey
	}
	if len(key) != AESGCMKeyBytes {
		return nil, ErrInvalidEncryptionKeyLength
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("new aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}
	if gcm.NonceSize() != AESGCMNonceBytes {
		return nil, fmt.Errorf("unexpected gcm nonce size: %d", gcm.NonceSize())
	}
	nonce := make([]byte, AESGCMNonceBytes)
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("read nonce: %w", err)
	}
	// Seal(dst, nonce, plaintext, additionalData) — passing nonce as dst
	// prepends it to the returned slice (standard sealed-box format).
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return sealed, nil
}

// OpenToken splits the first 12 bytes as nonce, runs AES-GCM Open which
// validates the auth tag, and returns plaintext. Any tamper (ciphertext
// body, prepended nonce, or wrong key) surfaces as a non-nil error and
// zero-length plaintext — callers MUST treat any error as a hard reject.
func OpenToken(sealed, key []byte) ([]byte, error) {
	if len(key) == 0 {
		return nil, ErrEmptyEncryptionKey
	}
	if len(key) != AESGCMKeyBytes {
		return nil, ErrInvalidEncryptionKeyLength
	}
	if len(sealed) < AESGCMNonceBytes {
		return nil, errors.New("sealed token shorter than nonce header")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("new aes cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("new gcm: %w", err)
	}
	nonce := sealed[:AESGCMNonceBytes]
	body := sealed[AESGCMNonceBytes:]
	plaintext, err := gcm.Open(nil, nonce, body, nil)
	if err != nil {
		return nil, fmt.Errorf("gcm open: %w", err)
	}
	return plaintext, nil
}
