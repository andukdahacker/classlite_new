//go:build atdd_red_phase

// google_oauth_atdd_test.go — Story 1.6 ATDD red-phase scaffolds for
// the Google OAuth init + callback service-layer methods.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-01  InitiateGoogleOAuth signs state, builds auth URL, validates invite
//   AC-1.6-02  HandleGoogleCallback validates cookie==state byte-for-byte, runs HMAC, exchanges code, fetches profile
//   AC-1.6-02  Branch A — google_id match → existing user, no link
//   AC-1.6-02  Branch B — email match → LinkGoogleAccount (race-safe via WHERE google_id IS NULL)
//   AC-1.6-02  Branch C — no match → CreateUser with email_verified=true, google_id=sub
//   AC-1.6-02  email_verified=false from Google → rejected with OAuthEmailUnverifiedError
//   AC-1.6-03  Subdomain host + non-member user → OAuthTenantMismatchError + audit row (R6)
//   AC-1.6-03  Apex host → tenant binding skipped
//
// RISK MAP
//   R6 (score 6) — Google OAuth tenant binding skipped → cross-tenant signin
//   R7 (score 6, handler-side) — covered by google_oauth_handler_atdd_test.go

package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"
)

// mockGoogleOAuthClient implements service.GoogleOAuthClient.
// The "real" client wraps oauth2.Config + the userinfo HTTP call;
// tests inject this stub so they never round-trip to accounts.google.com.
type mockGoogleOAuthClient struct {
	authURL       string
	exchangeToken *oauth2.Token
	exchangeErr   error
	userInfo      *service.GoogleUserInfo
	userInfoErr   error
}

func (m *mockGoogleOAuthClient) AuthCodeURL(state string) string {
	if m.authURL != "" {
		return m.authURL + "&state=" + state
	}
	return "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=" + state
}

func (m *mockGoogleOAuthClient) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	if m.exchangeErr != nil {
		return nil, m.exchangeErr
	}
	if m.exchangeToken != nil {
		return m.exchangeToken, nil
	}
	return &oauth2.Token{AccessToken: "fake-access-token"}, nil
}

func (m *mockGoogleOAuthClient) UserInfo(ctx context.Context, token *oauth2.Token) (*service.GoogleUserInfo, error) {
	if m.userInfoErr != nil {
		return nil, m.userInfoErr
	}
	return m.userInfo, nil
}

// TestGoogleInit_AC01_HappyPath_SignsStateAndReturnsAuthURL proves that
// InitiateGoogleOAuth signs a state payload, embeds it in the Google
// auth URL, and returns both so the handler can set the cookie.
func TestGoogleInit_AC01_HappyPath_SignsStateAndReturnsAuthURL(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	result, err := svc.InitiateGoogleOAuth(context.Background(), service.InitiateGoogleOAuthInput{
		// no invite, no redirectTo — bare init
	})
	if err != nil {
		t.Fatalf("InitiateGoogleOAuth: %v", err)
	}
	if result.SignedState == "" {
		t.Fatal("SignedState: expected non-empty signed state token")
	}
	if result.AuthCodeURL == "" {
		t.Fatal("AuthCodeURL: expected non-empty Google authorization URL")
	}
	// The auth URL must carry the signed state in a `state` query param.
	if want := "state=" + result.SignedState; !contains(result.AuthCodeURL, want) {
		t.Errorf("AuthCodeURL: expected to contain %q, got %q", want, result.AuthCodeURL)
	}
}

// TestGoogleInit_AC01_UnknownInvite_Rejected proves that a bogus
// inviteToken at init time produces a clean 404 BEFORE Google is hit.
// User shouldn't round-trip through Google only to discover the invite
// is dead.
func TestGoogleInit_AC01_UnknownInvite_Rejected(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	_, err := svc.InitiateGoogleOAuth(context.Background(), service.InitiateGoogleOAuthInput{
		InviteToken: "definitely-not-a-real-invite-token",
	})
	if err == nil {
		t.Fatal("InitiateGoogleOAuth: expected *InviteNotFoundError, got nil")
	}
	var notFound *service.InviteNotFoundError
	if !errors.As(err, &notFound) {
		t.Fatalf("InitiateGoogleOAuth: expected *InviteNotFoundError, got %T (%v)", err, err)
	}
}

// TestGoogleCallback_AC02_BranchC_NoMatch_CreatesUserWithEmailVerified
// proves AC2 Branch C: a brand-new Google user (no google_id match, no
// email match) results in a fresh users row with email_verified=true
// (Google already verified).
func TestGoogleCallback_AC02_BranchC_NoMatch_CreatesUserWithEmailVerified(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	mockOAuth := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub:           "google-sub-new-user-001",
			Email:         "newuser@example.com",
			EmailVerified: true,
			Name:          "New User",
			Picture:       "https://lh3.googleusercontent.com/a/avatar",
		},
	}
	svc := newAuthServiceWithOAuth(t, db, mockClock, mockOAuth)

	// Mint a state payload the way InitiateGoogleOAuth would.
	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce:    "happy-path-nonce",
		IssuedAt: mockClock.Now().Unix(),
	})

	result, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code:        "fake-auth-code-from-google",
		State:       stateToken,
		CookieState: stateToken, // matching double-submit cookie
		RequestHost: "my.classlite.app",
	})
	if err != nil {
		t.Fatalf("HandleGoogleCallback: %v", err)
	}
	if result.AccessToken == "" {
		t.Fatal("AccessToken: expected non-empty JWT")
	}
	if !result.User.EmailVerified {
		t.Fatal("User.EmailVerified: expected true (Google already verified)")
	}
	if result.User.Email != "newuser@example.com" {
		t.Errorf("User.Email: want %q, got %q", "newuser@example.com", result.User.Email)
	}
	// google_id must be persisted; query directly.
	var storedGoogleID pgtype.Text
	if err := db.QueryRow(context.Background(),
		`SELECT google_id FROM users WHERE email = $1`, "newuser@example.com",
	).Scan(&storedGoogleID); err != nil {
		t.Fatalf("lookup stored google_id: %v", err)
	}
	if !storedGoogleID.Valid || storedGoogleID.String != "google-sub-new-user-001" {
		t.Fatalf("stored google_id: want %q, got %+v", "google-sub-new-user-001", storedGoogleID)
	}
}

// TestGoogleCallback_AC02_BranchB_EmailMatch_LinksGoogleID proves Branch
// B: an existing email/password user signing in with Google for the
// first time has their google_id set via LinkGoogleAccount.
func TestGoogleCallback_AC02_BranchB_EmailMatch_LinksGoogleID(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	// Pre-existing email/password user without a google_id.
	existing := test.CreateUser(t, db, "alice@example.com", "Alice")

	mockOAuth := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub:           "google-sub-alice-newly-linked",
			Email:         "alice@example.com",
			EmailVerified: true,
			Name:          "Alice From Google",
		},
	}
	svc := newAuthServiceWithOAuth(t, db, mockClock, mockOAuth)

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "link-nonce", IssuedAt: mockClock.Now().Unix(),
	})

	result, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code: "code", State: stateToken, CookieState: stateToken, RequestHost: "my.classlite.app",
	})
	if err != nil {
		t.Fatalf("HandleGoogleCallback: %v", err)
	}
	if uuid.UUID(result.User.ID.Bytes) != uuid.UUID(existing.ID.Bytes) {
		t.Fatal("expected to receive existing user, got a different one")
	}
	// google_id must now be set on the existing row.
	var stored pgtype.Text
	if err := db.QueryRow(context.Background(),
		`SELECT google_id FROM users WHERE id = $1`, existing.ID,
	).Scan(&stored); err != nil {
		t.Fatalf("lookup google_id: %v", err)
	}
	if !stored.Valid || stored.String != "google-sub-alice-newly-linked" {
		t.Fatalf("google_id after link: want %q, got %+v", "google-sub-alice-newly-linked", stored)
	}
}

// TestGoogleCallback_AC02_StateMismatch_Rejected proves that the
// double-submit cookie pattern requires cookie value to equal state
// query param byte-for-byte. An attacker who can mint valid state
// tokens (or replay them) still loses because the cookie won't match.
func TestGoogleCallback_AC02_StateMismatch_Rejected(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	tokenA := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "from-session-A", IssuedAt: mockClock.Now().Unix(),
	})
	tokenB := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "from-session-B", IssuedAt: mockClock.Now().Unix(),
	})

	_, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code:        "code",
		State:       tokenA, // attacker pastes state from session A
		CookieState: tokenB, // browser has cookie from session B
		RequestHost: "my.classlite.app",
	})
	if err == nil {
		t.Fatal("HandleGoogleCallback: expected error on state/cookie mismatch, got nil")
	}
	var invalid *service.OAuthStateInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("HandleGoogleCallback: expected *OAuthStateInvalidError, got %T (%v)", err, err)
	}
}

// TestGoogleCallback_AC02_EmailUnverifiedByGoogle_Rejected proves that
// even if Google issues a valid auth code, an unverified Google email
// (rare but possible — some legacy / federated identities) must NOT
// short-circuit ClassLite's email-verification gate.
func TestGoogleCallback_AC02_EmailUnverifiedByGoogle_Rejected(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	mockOAuth := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub:           "google-sub-unverified-email",
			Email:         "unverified@example.com",
			EmailVerified: false, // !!
			Name:          "Unverified User",
		},
	}
	svc := newAuthServiceWithOAuth(t, db, mockClock, mockOAuth)

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "unverified-nonce", IssuedAt: mockClock.Now().Unix(),
	})

	_, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code: "code", State: stateToken, CookieState: stateToken, RequestHost: "my.classlite.app",
	})
	if err == nil {
		t.Fatal("HandleGoogleCallback: expected error on email_verified=false, got nil")
	}
	var unverified *service.OAuthEmailUnverifiedError
	if !errors.As(err, &unverified) {
		t.Fatalf("HandleGoogleCallback: expected *OAuthEmailUnverifiedError, got %T (%v)", err, err)
	}
}

// TestGoogleCallback_AC03_SubdomainHost_NonMemberUser_Rejected is the
// R6 mitigation: an Owner of center A signing in via the subdomain of
// center B must NOT be issued a session bound to center B.
//
// The user (alice) belongs ONLY to center A. The request arrives at
// `tenb.classlite.app`, which resolves to centerB. AssertTenantBinding
// looks up the (alice, centerB) membership row — none exists — and
// returns OAuthTenantMismatchError.
//
// An auth_audit_logs row MUST be written with event =
// "auth.oauth_tenant_mismatch" for SOC scanning.
func TestGoogleCallback_AC03_SubdomainHost_NonMemberUser_Rejected(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	// Set up two centers; alice belongs only to A.
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	centerB := test.CreateCenterWithID(t, db, test.TenantBID, "Tenant B", "tenb")
	alice := test.CreateUser(t, db, "alice@example.com", "Alice")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, alice.ID, centerA.ID, "owner")

	// Existing google_id already linked (Branch A) so resolveGoogleIdentity
	// returns the existing user; the tenant-binding check then fires.
	_, err := db.Exec(context.Background(),
		`UPDATE users SET google_id = $2 WHERE id = $1`,
		alice.ID, "google-sub-alice-001",
	)
	if err != nil {
		t.Fatalf("seed google_id: %v", err)
	}

	mockOAuth := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub:           "google-sub-alice-001",
			Email:         "alice@example.com",
			EmailVerified: true,
			Name:          "Alice",
		},
	}
	svc := newAuthServiceWithOAuth(t, db, mockClock, mockOAuth)
	svc.SetAppApexHost("my.classlite.app")

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "cross-tenant-nonce", IssuedAt: mockClock.Now().Unix(),
	})

	_, err = svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code:        "code",
		State:       stateToken,
		CookieState: stateToken,
		RequestHost: "tenb.classlite.app", // centerB's subdomain, alice has no membership
	})
	if err == nil {
		t.Fatal("HandleGoogleCallback: expected *OAuthTenantMismatchError, got nil")
	}
	var mismatch *service.OAuthTenantMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("HandleGoogleCallback: expected *OAuthTenantMismatchError, got %T (%v)", err, err)
	}

	// Audit row must be present.
	_ = test.TenantContext(t, db, centerB.ID)
	var attemptCount int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs WHERE event = 'auth.oauth_tenant_mismatch' AND user_id = $1`,
		alice.ID,
	).Scan(&attemptCount); err != nil {
		t.Fatalf("count audit log rows: %v", err)
	}
	if attemptCount == 0 {
		t.Fatal("expected auth_audit_logs row for auth.oauth_tenant_mismatch, got none")
	}
}

// TestGoogleCallback_AC03_ApexHost_SkipsTenantBinding proves the apex
// host is the unscoped sign-in surface — tenant binding is intentionally
// skipped because the frontend post-login flow handles center selection.
func TestGoogleCallback_AC03_ApexHost_SkipsTenantBinding(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	// Alice exists but is NOT a member of any center — yet the apex
	// host bypass means she still signs in successfully.
	test.CreateUser(t, db, "alice@example.com", "Alice")

	mockOAuth := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub:           "google-sub-alice-apex",
			Email:         "alice@example.com",
			EmailVerified: true,
			Name:          "Alice",
		},
	}
	svc := newAuthServiceWithOAuth(t, db, mockClock, mockOAuth)
	svc.SetAppApexHost("my.classlite.app")

	stateToken := signStateForTest(t, mockClock, service.OAuthStatePayload{
		Nonce: "apex-nonce", IssuedAt: mockClock.Now().Unix(),
	})

	result, err := svc.HandleGoogleCallback(context.Background(), service.GoogleCallbackInput{
		Code:        "code",
		State:       stateToken,
		CookieState: stateToken,
		RequestHost: "my.classlite.app", // apex — bypass
	})
	if err != nil {
		t.Fatalf("HandleGoogleCallback (apex host): expected success, got %v", err)
	}
	if result.AccessToken == "" {
		t.Fatal("AccessToken: expected non-empty token from apex-host login")
	}
}

// -- helpers --------------------------------------------------------

// newAuthServiceWithOAuth constructs an AuthService wired with the
// mock Google client and an OAuth state signer using testStateSecret.
func newAuthServiceWithOAuth(t *testing.T, db *test.TxDB, c clock.Clock, oauthClient service.GoogleOAuthClient) *service.AuthService {
	t.Helper()
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", c)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), c))
	svc.SetGoogleOAuth(oauthClient, service.NewOAuthStateSignerWithClock([]byte(testStateSecret), c))
	svc.SetAppApexHost("my.classlite.app")
	svc.SetAppPostLoginURL("http://localhost:5173/")
	svc.SetAppLoginErrorURLBase("http://localhost:5173/login")
	return svc
}

// signStateForTest signs a payload with the test secret. Returned token
// matches what the production InitiateGoogleOAuth would emit so the
// callback test can reuse it as both `state` query and cookie value.
func signStateForTest(t *testing.T, c clock.Clock, payload service.OAuthStatePayload) string {
	t.Helper()
	signer := service.NewOAuthStateSignerWithClock([]byte(testStateSecret), c)
	tok, err := signer.Sign(payload)
	if err != nil {
		t.Fatalf("sign state: %v", err)
	}
	return tok
}

// contains is a local strings.Contains alias to avoid importing "strings"
// just for the sentinel check (keeps the test imports tight).
func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	n := len(sub)
	if n == 0 {
		return 0
	}
	for i := 0; i+n <= len(s); i++ {
		if s[i:i+n] == sub {
			return i
		}
	}
	return -1
}

// _ pin imports that the rest of the file already needs but go vet
// might complain about during partial implementation.
var _ = generated.User{}
