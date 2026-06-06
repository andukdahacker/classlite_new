//go:build atdd_red_phase

// signing_key_validation_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-15  JWT signing key < 256 bits OR missing → API refuses to
//              start with a clear error message
//
// The impl point is in cmd/api/main.go's config-loading path. The test
// exercises a pure helper (validateSigningKey) so it doesn't have to
// boot the server.

package main

import (
	"strings"
	"testing"
)

func TestSigningKey_AC15_ValidKey256Bits_OK(t *testing.T) {
	key := strings.Repeat("a", 32) // 32 bytes = 256 bits, minimum
	if err := validateSigningKey([]byte(key)); err != nil {
		t.Fatalf("256-bit key: expected nil, got %v", err)
	}
}

func TestSigningKey_AC15_KeyTooShort_Rejected(t *testing.T) {
	key := strings.Repeat("a", 16) // 16 bytes = 128 bits, too short
	err := validateSigningKey([]byte(key))
	if err == nil {
		t.Fatal("128-bit key: expected rejection, got nil")
	}
	if !strings.Contains(err.Error(), "256") {
		t.Fatalf("rejection error must mention 256-bit minimum, got %q", err.Error())
	}
}

func TestSigningKey_AC15_EmptyKey_Rejected(t *testing.T) {
	err := validateSigningKey([]byte{})
	if err == nil {
		t.Fatal("empty key: expected rejection, got nil")
	}
}

func TestSigningKey_AC15_NilKey_Rejected(t *testing.T) {
	err := validateSigningKey(nil)
	if err == nil {
		t.Fatal("nil key: expected rejection, got nil")
	}
}
