// Story 2.1 Task 7.6 — MintAccessToken unit test.
//
// The green-phase contract: MintAccessToken produces a JWT whose UserID,
// CenterID, and Role claims round-trip through VerifyAccess intact — with
// or without an explicit centerID.
//
// This is an internal (package service) test because the mint helper is
// unexported after the story-2-1 code review — the free function was
// downgraded to lowercase `mintAccessToken` so only same-package callers
// can reach it. External callers go through *AuthService.MintAccessToken.
package service

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/google/uuid"
)

func TestMintAccessToken_WithCenterAndRole(t *testing.T) {
	jwt := NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), clock.RealClock{})
	uid := uuid.New()
	cid := uuid.New()

	token, expiresAt, err := mintAccessToken(jwt, clock.RealClock{}, uid, &cid, "owner")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	if token == "" {
		t.Fatalf("mint: empty token")
	}
	if expiresAt.IsZero() {
		t.Fatalf("mint: zero expiresAt")
	}

	claims, err := jwt.VerifyAccess(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UserID != uid.String() {
		t.Errorf("claims.UserID = %q, want %q", claims.UserID, uid.String())
	}
	if claims.CenterID != cid.String() {
		t.Errorf("claims.CenterID = %q, want %q", claims.CenterID, cid.String())
	}
	if claims.Role != "owner" {
		t.Errorf("claims.Role = %q, want owner", claims.Role)
	}
}

func TestMintAccessToken_WithoutCenter(t *testing.T) {
	// Pre-center-creation scenario: user has verified email but no center yet.
	// The token must carry ONLY UserID; CenterID + Role stay empty (JWT
	// `omitempty` shape drops them). ExtractTenant reads this correctly per
	// Story 2.1 Dev Notes.
	jwt := NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), clock.RealClock{})
	uid := uuid.New()

	token, _, err := mintAccessToken(jwt, clock.RealClock{}, uid, nil, "")
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	claims, err := jwt.VerifyAccess(token)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UserID != uid.String() {
		t.Errorf("claims.UserID = %q, want %q", claims.UserID, uid.String())
	}
	if claims.CenterID != "" {
		t.Errorf("claims.CenterID = %q, want empty (pre-center scenario)", claims.CenterID)
	}
	if claims.Role != "" {
		t.Errorf("claims.Role = %q, want empty", claims.Role)
	}
}
