// Story 2.5c — AES-256-GCM sealed-token crypto matrix. 5-row per
// Murat-B4 + John ACCEPT compromise (Task 3 discharge for R6).

package service

import (
	"bytes"
	"errors"
	"testing"
)

// key32Bytes returns a deterministic 32-byte test key. Byte pattern is
// distinct from the dev fallback in config.go so tests can distinguish
// "wrong key" scenarios.
func key32Bytes() []byte {
	k := make([]byte, AESGCMKeyBytes)
	for i := range k {
		k[i] = byte(i) ^ 0x5a
	}
	return k
}

// keyAltBytes is a second 32-byte key. Used for the wrong-key rejection
// scenario — Seal with key A → Open with key B → error.
func keyAltBytes() []byte {
	k := make([]byte, AESGCMKeyBytes)
	for i := range k {
		k[i] = byte(i) ^ 0xa5
	}
	return k
}

// ---------------------------------------------------------------------------
// Row 1 — Round-trip happy path (Seal → Open → plaintext matches).
// ---------------------------------------------------------------------------
func TestSealToken_RoundTripPlaintextRecovered(t *testing.T) {
	key := key32Bytes()
	plaintext := []byte("ya29.a0AfH6SMBExampleAccessTokenPayload!!")

	sealed, err := SealToken(plaintext, key)
	if err != nil {
		t.Fatalf("Seal returned error: %v", err)
	}
	if len(sealed) < AESGCMNonceBytes+len(plaintext) {
		t.Fatalf("sealed shorter than nonce+plaintext: got %d bytes", len(sealed))
	}
	// Sealed output must not equal the plaintext — encryption must have taken place.
	if bytes.Contains(sealed, plaintext) {
		t.Errorf("sealed output contains plaintext substring — encryption did not run")
	}
	recovered, err := OpenToken(sealed, key)
	if err != nil {
		t.Fatalf("Open returned error: %v", err)
	}
	if !bytes.Equal(recovered, plaintext) {
		t.Errorf("round-trip plaintext mismatch: got %q, want %q", recovered, plaintext)
	}
}

// ---------------------------------------------------------------------------
// Row 2 — Ciphertext tamper: flip 1 byte in the ciphertext body → auth-tag
// rejection at Open time (GCM authenticated encryption invariant).
// ---------------------------------------------------------------------------
func TestOpenToken_CiphertextTamperRejected(t *testing.T) {
	key := key32Bytes()
	sealed, err := SealToken([]byte("token-body-must-be-longer-than-tag"), key)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	// Flip a byte inside the ciphertext body (not the nonce header, not the tag).
	tampered := make([]byte, len(sealed))
	copy(tampered, sealed)
	tamperAt := AESGCMNonceBytes + 5
	tampered[tamperAt] ^= 0x01

	if _, err := OpenToken(tampered, key); err == nil {
		t.Fatal("ciphertext tamper accepted: Open returned nil error")
	}
}

// ---------------------------------------------------------------------------
// Row 3 — Nonce tamper: flip 1 byte in the prepended nonce → auth-tag
// rejection (GCM binds nonce to auth tag).
// ---------------------------------------------------------------------------
func TestOpenToken_NonceTamperRejected(t *testing.T) {
	key := key32Bytes()
	sealed, err := SealToken([]byte("payload"), key)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	tampered := make([]byte, len(sealed))
	copy(tampered, sealed)
	// Flip the middle byte of the nonce header (bytes 0..11).
	tampered[6] ^= 0x01

	if _, err := OpenToken(tampered, key); err == nil {
		t.Fatal("nonce tamper accepted: Open returned nil error")
	}
}

// ---------------------------------------------------------------------------
// Row 4 — Wrong-key rejection: Seal with key A → Open with key B → error.
// Key rotation scenario: existing rows must fail to open after rotation.
// ---------------------------------------------------------------------------
func TestOpenToken_WrongKeyRejected(t *testing.T) {
	keyA := key32Bytes()
	keyB := keyAltBytes()
	if bytes.Equal(keyA, keyB) {
		t.Fatal("test setup bug: keyA == keyB — cannot verify wrong-key rejection")
	}
	sealed, err := SealToken([]byte("secret-payload"), keyA)
	if err != nil {
		t.Fatalf("Seal with keyA: %v", err)
	}
	if _, err := OpenToken(sealed, keyB); err == nil {
		t.Fatal("wrong-key accepted: Open with keyB returned nil error")
	}
}

// ---------------------------------------------------------------------------
// Row 5 — Empty-key init rejection: SealToken with 0-byte key returns error.
// Guards operator config-load bug (nil slice) before AES swallows it.
// ---------------------------------------------------------------------------
func TestSealToken_EmptyKeyRejected(t *testing.T) {
	sealed, err := SealToken([]byte("payload"), nil)
	if err == nil {
		t.Fatalf("empty key accepted: Seal returned %d bytes", len(sealed))
	}
	if !errors.Is(err, ErrEmptyEncryptionKey) {
		t.Errorf("expected ErrEmptyEncryptionKey sentinel, got: %v", err)
	}
	// OpenToken must reject empty key too — mirror invariant.
	if _, err := OpenToken([]byte("stub"), nil); err == nil {
		t.Fatal("OpenToken with empty key accepted; expected error")
	} else if !errors.Is(err, ErrEmptyEncryptionKey) {
		t.Errorf("OpenToken empty-key error: expected ErrEmptyEncryptionKey, got %v", err)
	}

	// Empty (non-nil) slice must also reject — nil vs 0-len-slice must not
	// diverge (both are config-load bug shapes an operator might hit).
	if _, err := SealToken([]byte("payload"), []byte{}); err == nil {
		t.Error("SealToken with empty-slice key accepted; expected error")
	}
}

// ---------------------------------------------------------------------------
// P1 fix (2026-07-16 code review Chunk 2, Edge Case Hunter #11 CRITICAL):
// Non-32-byte-but-non-zero AES key silently downgrades to AES-128/192.
// `aes.NewCipher` accepts 16/24/32 byte keys; without an explicit length
// guard, a 16-byte key passed to SealToken produces AES-128 ciphertext
// despite the module doc claiming AES-256. Config.Validate blocks it at
// boot for non-dev, but a future caller (worker, refactor, test) with a
// bad key needs a last-line-of-defense guard.
// ---------------------------------------------------------------------------
func TestSealToken_WrongLengthKeyRejected(t *testing.T) {
	// 16 bytes → AES-128 downgrade (silent before P1 fix).
	shortKey := make([]byte, 16)
	if _, err := SealToken([]byte("payload"), shortKey); err == nil {
		t.Fatal("16-byte key accepted: Seal silently downgraded to AES-128")
	} else if !errors.Is(err, ErrInvalidEncryptionKeyLength) {
		t.Errorf("expected ErrInvalidEncryptionKeyLength for 16-byte key, got: %v", err)
	}

	// 24 bytes → AES-192 downgrade.
	medKey := make([]byte, 24)
	if _, err := SealToken([]byte("payload"), medKey); err == nil {
		t.Fatal("24-byte key accepted: Seal silently downgraded to AES-192")
	} else if !errors.Is(err, ErrInvalidEncryptionKeyLength) {
		t.Errorf("expected ErrInvalidEncryptionKeyLength for 24-byte key, got: %v", err)
	}

	// 31 bytes (off-by-one) → aes.NewCipher would reject, but our guard
	// surfaces the sentinel before hitting AES for a stable error type.
	shortByOne := make([]byte, 31)
	if _, err := SealToken([]byte("payload"), shortByOne); err == nil {
		t.Fatal("31-byte key accepted: Seal should reject")
	} else if !errors.Is(err, ErrInvalidEncryptionKeyLength) {
		t.Errorf("expected ErrInvalidEncryptionKeyLength for 31-byte key, got: %v", err)
	}

	// OpenToken must enforce the same length guard.
	if _, err := OpenToken(make([]byte, 32), shortKey); err == nil {
		t.Fatal("OpenToken with 16-byte key accepted")
	} else if !errors.Is(err, ErrInvalidEncryptionKeyLength) {
		t.Errorf("OpenToken 16-byte key: expected ErrInvalidEncryptionKeyLength, got %v", err)
	}
}
