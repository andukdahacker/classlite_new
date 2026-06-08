// auth_google_ta_test.go — Story 1.6 TA expansion (P2/P3).
//
// Adversarial state-replay + tenant-binding matrix + defensive edge
// cases that validate post-review patches P11/P12/P13/P16.
//
// Helpers reused from google_oauth_atdd_test.go: newAuthServiceWithOAuth,
// signStateForTest, mockGoogleOAuthClient.

package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// TestGoogleCallback_StateReplay_AcrossSessions (#2) proves the
// double-submit cookie defeats an attacker who captured BOTH halves
// (cookie + state query) from session A and tries to replay them into
// a callback from session B. Session B's browser ships its OWN
// oauth_state cookie, so even though state-query matches a real HMAC,
// the byte-for-byte cookie comparison rejects.
func TestGoogleCallback_StateReplay_AcrossSessions(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	// Session A's full state token (legitimately HMAC-signed).
	captured := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce:    "captured-from-A",
		IssuedAt: mockClock.Now().Unix(),
	})
	// Session B's fresh init produced its own cookie.
	sessionB := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce:    "session-B-nonce",
		IssuedAt: mockClock.Now().Unix(),
	})

	_, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code:        "any-code",
		State:       captured, // attacker pasted in the URL
		CookieState: sessionB, // browser sent its OWN cookie
		RequestHost: "my.classlite.app",
	})
	if err == nil {
		t.Fatal("HandleGoogleCallback: expected *OAuthStateInvalidError on state/cookie mismatch")
	}
	var invalid *service.OAuthStateInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("expected *OAuthStateInvalidError, got %T (%v)", err, err)
	}
}

// TestGoogleCallback_TenantBindingMatrix_CrossSubdomain (#3) validates
// the post-review P2 fix: tenant binding now reads center_members under
// a tx with SET LOCAL. This table-driven test asserts the full grid of
// (user, subdomain) → expected outcome.
func TestGoogleCallback_TenantBindingMatrix_CrossSubdomain(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "TENB")

	// alice is owner of A only.
	alice := test.CreateUser(t, db, "alice@example.com", "Alice")
	// bob is member of B only.
	bob := test.CreateUser(t, db, "bob@example.com", "Bob")
	// carol is member of BOTH centers.
	carol := test.CreateUser(t, db, "carol@example.com", "Carol")

	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, alice.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, carol.ID, centerA.ID, "teacher")
	_ = test.TenantContext(t, db, centerB.ID)
	_ = test.CreateCenterMember(t, db, bob.ID, centerB.ID, "owner")
	_ = test.CreateCenterMember(t, db, carol.ID, centerB.ID, "admin")

	// Seed google_id so resolveGoogleIdentity hits Branch A for each user.
	for email, sub := range map[string]string{
		"alice@example.com": "google-sub-alice",
		"bob@example.com":   "google-sub-bob",
		"carol@example.com": "google-sub-carol",
	} {
		if _, err := db.Exec(context.Background(),
			`UPDATE users SET google_id = $2 WHERE email = $1`,
			email, sub,
		); err != nil {
			t.Fatalf("seed google_id for %s: %v", email, err)
		}
	}

	cases := []struct {
		name        string
		userEmail   string
		userSub     string
		requestHost string
		wantErr     bool // true = OAuthTenantMismatchError, false = login succeeds
	}{
		// Alice (A only) on subdomain A → pass.
		{"alice-on-sub-A", "alice@example.com", "google-sub-alice", "tena.classlite.app", false},
		// Alice on subdomain B → mismatch.
		{"alice-on-sub-B", "alice@example.com", "google-sub-alice", "tenb.classlite.app", true},
		// Alice on apex → bypass (no tenant check) → pass.
		{"alice-on-apex", "alice@example.com", "google-sub-alice", "my.classlite.app", false},
		// Bob (B only) on subdomain A → mismatch.
		{"bob-on-sub-A", "bob@example.com", "google-sub-bob", "tena.classlite.app", true},
		// Carol (both) on subdomain A → pass.
		{"carol-on-sub-A", "carol@example.com", "google-sub-carol", "tena.classlite.app", false},
		// Carol on subdomain B → pass.
		{"carol-on-sub-B", "carol@example.com", "google-sub-carol", "tenb.classlite.app", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			oauthMock := &mockGoogleOAuthClient{
				userInfo: &service.GoogleUserInfo{
					Sub: tc.userSub, Email: tc.userEmail, EmailVerified: true, Name: tc.name,
				},
			}
			svc := newAuthServiceWithOAuth(t, db, mockClock, oauthMock)
			svc.SetAppApexHost("my.classlite.app")

			stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
				Nonce: "matrix-" + tc.name, IssuedAt: mockClock.Now().Unix(),
			})

			_, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
				Code: "code", State: stateToken, CookieState: stateToken, RequestHost: tc.requestHost,
			})
			var mismatch *service.OAuthTenantMismatchError
			if tc.wantErr {
				if err == nil || !errors.As(err, &mismatch) {
					t.Fatalf("%s: expected *OAuthTenantMismatchError, got %v", tc.name, err)
				}
			} else if err != nil {
				t.Fatalf("%s: expected success, got %v", tc.name, err)
			}
		})
	}
}

// TestAssertTenantBinding_IPv6Host_Apex (#18) validates patch P13:
// IPv6 host with brackets and port is parsed via net.SplitHostPort
// rather than chopping at the first ':' inside the brackets.
func TestAssertTenantBinding_IPv6Host_Apex(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	test.CreateUser(t, db, "alice@example.com", "Alice")
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET google_id = $2 WHERE email = $1`,
		"alice@example.com", "google-sub-alice-ipv6",
	); err != nil {
		t.Fatalf("seed google_id: %v", err)
	}

	oauthMock := &mockGoogleOAuthClient{userInfo: &service.GoogleUserInfo{
		Sub: "google-sub-alice-ipv6", Email: "alice@example.com", EmailVerified: true, Name: "Alice",
	}}
	svc := newAuthServiceWithOAuth(t, db, mockClock, oauthMock)
	svc.SetAppApexHost("[::1]:8080")

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "ipv6", IssuedAt: mockClock.Now().Unix(),
	})

	// RequestHost matches the apex (after bracket/port strip both sides
	// normalize to "::1"). Expected: apex bypass — login succeeds.
	result, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code: "code", State: stateToken, CookieState: stateToken, RequestHost: "[::1]:8080",
	})
	if err != nil {
		t.Fatalf("IPv6 apex callback: expected bypass success, got %v", err)
	}
	if result.AccessToken == "" {
		t.Fatal("expected access token on apex bypass")
	}
}

// TestAssertTenantBinding_MixedCaseHost_LowerCasesSlug (#19) validates
// patch P12: the GetCenterByShortCode lookup is now LOWER()-normalized
// on both sides. A request to `TenB.classlite.app` resolves to the
// `TENB`-coded center; tenant binding then runs the membership check.
func TestAssertTenantBinding_MixedCaseHost_LowerCasesSlug(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "TENB")
	dave := test.CreateUser(t, db, "dave@example.com", "Dave")
	_ = test.TenantContext(t, db, centerB.ID)
	_ = test.CreateCenterMember(t, db, dave.ID, centerB.ID, "teacher")
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET google_id = $2 WHERE email = $1`,
		"dave@example.com", "google-sub-dave",
	); err != nil {
		t.Fatalf("seed google_id: %v", err)
	}

	oauthMock := &mockGoogleOAuthClient{userInfo: &service.GoogleUserInfo{
		Sub: "google-sub-dave", Email: "dave@example.com", EmailVerified: true, Name: "Dave",
	}}
	svc := newAuthServiceWithOAuth(t, db, mockClock, oauthMock)
	svc.SetAppApexHost("my.classlite.app")

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "case-mix", IssuedAt: mockClock.Now().Unix(),
	})

	// Mixed-case Host should resolve to centerB via LOWER() lookup.
	_, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code: "code", State: stateToken, CookieState: stateToken,
		RequestHost: "TenB.classlite.app",
	})
	if err != nil {
		t.Fatalf("Mixed-case slug should resolve to center TENB; got %v", err)
	}
}

// TestInitiateGoogleOAuth_OversizeInviteToken_Rejected (#21) validates
// the defense-in-depth length check at the service boundary (the
// handler also caps at 256 chars; this is the redundant inner check).
func TestInitiateGoogleOAuth_OversizeInviteToken_Rejected(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	bigToken := strings.Repeat("A", service.MaxInviteTokenChars+1)
	_, err := svc.InitiateGoogleOAuth(context.Background(), service.InitiateGoogleOAuthInput{
		InviteToken: bigToken,
	})
	if err == nil {
		t.Fatal("expected *InviteNotFoundError on oversize token, got nil")
	}
	var notFound *service.InviteNotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("expected *InviteNotFoundError, got %T (%v)", err, err)
	}
}

// TestHandleGoogleCallback_EmptyAppApexHost_TenantBindingStillRuns
// (#22) validates patch P11: setting appApexHost to "" used to
// short-circuit the entire check; now empty apex means "no apex
// shortcut" — the subdomain check runs normally.
func TestHandleGoogleCallback_EmptyAppApexHost_TenantBindingStillRuns(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	_ = test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "TENB")
	_ = test.CreateUser(t, db, "eve@example.com", "Eve")
	// Eve is NOT a member of centerB.
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET google_id = $2 WHERE email = $1`,
		"eve@example.com", "google-sub-eve",
	); err != nil {
		t.Fatalf("seed google_id: %v", err)
	}

	oauthMock := &mockGoogleOAuthClient{userInfo: &service.GoogleUserInfo{
		Sub: "google-sub-eve", Email: "eve@example.com", EmailVerified: true, Name: "Eve",
	}}
	svc := newAuthServiceWithOAuth(t, db, mockClock, oauthMock)
	// CRITICAL: empty apex — previously this disabled tenant binding entirely.
	svc.SetAppApexHost("")

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "empty-apex", IssuedAt: mockClock.Now().Unix(),
	})

	_, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code: "code", State: stateToken, CookieState: stateToken,
		RequestHost: "tenb.classlite.app",
	})
	// Eve is NOT a member of centerB — even with empty apex the
	// subdomain check should fire and reject.
	if err == nil {
		t.Fatal("empty apex must NOT disable subdomain tenant binding; expected *OAuthTenantMismatchError")
	}
	var mismatch *service.OAuthTenantMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("expected *OAuthTenantMismatchError, got %T (%v)", err, err)
	}
}
