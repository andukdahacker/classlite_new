// Package service — Story 1.6 Google OAuth init + callback.
//
// Flow:
//
//	GET /api/auth/google → InitiateGoogleOAuth → 302 to Google
//	  ⌃
//	  └── invite token (if supplied) verified before redirect so the
//	      user never round-trips through Google to discover a dead invite.
//
//	GET /api/auth/google/callback → HandleGoogleCallback
//	  1. CSRF: cookie == state query param byte-for-byte (double-submit)
//	  2. HMAC: state signature verifies under OAUTH_STATE_SECRET
//	  3. TTL: state.IssuedAt + 10m > clock.Now()
//	  4. Exchange code for access token
//	  5. Fetch Google profile (email, email_verified, sub, name, picture)
//	  6. resolveGoogleIdentity → Branch A/B/C
//	  7. assertTenantBinding (subdomain only) → AC3 R6 mitigation
//	  8. AcceptInviteInternal (if invite_token_hash in state) → AC5
//	  9. issueSession (mint JWT + refresh row + post-commit audit)
//
// Audit events: see auth_audit.go controlled vocabulary docs.
package service

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"
	googleEndpoint "golang.org/x/oauth2/google"
)

// GoogleUserInfoURL is Google's UserInfo endpoint (OpenID Connect v3).
const GoogleUserInfoURL = "https://www.googleapis.com/oauth2/v3/userinfo"

// GoogleUserInfoTimeout caps the userinfo HTTP call so a hanging Google
// response cannot stall the OAuth callback handler indefinitely. The
// p99 of this endpoint is ~400ms; 5s is generous but bounded.
const GoogleUserInfoTimeout = 5 * time.Second

// MaxInviteTokenChars + MaxRedirectToChars cap inbound query params on
// the init endpoint. Real invite tokens are 43-char base64url. Real
// redirect targets are short paths. Anything bigger is hostile and gets
// rejected at the boundary.
const (
	MaxInviteTokenChars = 256
	MaxRedirectToChars  = 1024
	OAuthNonceBytes     = 32
)

// GoogleUserInfo is the profile shape we consume off Google's userinfo
// endpoint. Not all v3 fields are loaded — only the ones we care about
// (rest are ignored to limit log-bleed risk).
type GoogleUserInfo struct {
	Sub           string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
}

// GoogleOAuthClient abstracts the calls AuthService makes against
// Google. The interface seam means tests inject a mock that skips the
// real OAuth round-trip; production wraps oauth2.Config + an http.Client.
type GoogleOAuthClient interface {
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (*oauth2.Token, error)
	UserInfo(ctx context.Context, token *oauth2.Token) (*GoogleUserInfo, error)
}

// realGoogleOAuthClient is the production implementation. The userinfo
// fetch uses oauth2.NewClient so the bearer token authorization is
// added to the http.Client transport — never set the header manually
// (allocations + missed retries).
type realGoogleOAuthClient struct {
	cfg *oauth2.Config
}

// NewGoogleOAuthClient constructs the production client. Endpoint is
// pulled from golang.org/x/oauth2/google — never hand-typed (Google
// has rotated endpoints during their v1→v2 transition).
func NewGoogleOAuthClient(clientID, clientSecret, redirectURL string) GoogleOAuthClient {
	return &realGoogleOAuthClient{
		cfg: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{"openid", "email", "profile"},
			Endpoint:     googleEndpoint.Endpoint,
		},
	}
}

func (c *realGoogleOAuthClient) AuthCodeURL(state string) string {
	// access_type=online — we don't need offline refresh on Google's side
	// (we mint our own refresh tokens). prompt=select_account — better UX
	// for users with multiple Google accounts in the same browser.
	return c.cfg.AuthCodeURL(state,
		oauth2.AccessTypeOnline,
		oauth2.SetAuthURLParam("prompt", "select_account"),
	)
}

func (c *realGoogleOAuthClient) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	return c.cfg.Exchange(ctx, code)
}

func (c *realGoogleOAuthClient) UserInfo(ctx context.Context, token *oauth2.Token) (*GoogleUserInfo, error) {
	timeoutCtx, cancel := context.WithTimeout(ctx, GoogleUserInfoTimeout)
	defer cancel()
	httpClient := c.cfg.Client(timeoutCtx, token)
	req, err := http.NewRequestWithContext(timeoutCtx, http.MethodGet, GoogleUserInfoURL, nil)
	if err != nil {
		return nil, &OAuthUserinfoError{Reason: "build request: " + err.Error()}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		// AC10 — distinguish deadline-exceeded from other transport errors
		// so the redirect surface (?error=google_timeout vs
		// ?error=google_userinfo_failed) tells operators whether they're
		// looking at a Google availability problem or a spec deviation.
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(timeoutCtx.Err(), context.DeadlineExceeded) {
			return nil, &OAuthUserinfoTimeoutError{}
		}
		return nil, &OAuthUserinfoError{Reason: "http: " + err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &OAuthUserinfoError{Reason: fmt.Sprintf("status %d", resp.StatusCode)}
	}
	var info GoogleUserInfo
	if err := jsonDecode(resp.Body, &info); err != nil {
		return nil, &OAuthUserinfoError{Reason: "decode: " + err.Error()}
	}
	return &info, nil
}

// InitiateGoogleOAuthInput drives the init endpoint.
type InitiateGoogleOAuthInput struct {
	InviteToken string
	RedirectTo  string
}

// InitiateGoogleOAuthResult is what the handler turns into a 302.
type InitiateGoogleOAuthResult struct {
	SignedState string
	AuthCodeURL string
	ExpiresAt   time.Time
}

// InitiateGoogleOAuth implements AC1. The invite-token pre-flight check
// uses the SECURITY DEFINER function (RLS bypass) so we can look up the
// invite without a tenant context yet — a 404 here saves the user from
// a wasted Google round-trip.
func (s *AuthService) InitiateGoogleOAuth(ctx context.Context, in InitiateGoogleOAuthInput) (*InitiateGoogleOAuthResult, error) {
	if s.oauth == nil || s.oauthState == nil {
		return nil, &OAuthNotConfiguredError{}
	}

	var inviteTokenHash string
	if in.InviteToken != "" {
		if len(in.InviteToken) > MaxInviteTokenChars {
			return nil, &InviteNotFoundError{}
		}
		inviteTokenHash = hashInviteTokenHex(in.InviteToken)
		// Verify the invite exists + isn't expired + isn't accepted.
		// We don't need centerName / inviterEmail here — those are only
		// echoed in error responses, not on the init happy path.
		_, _, _, _, _, _, err := loadInviteByTokenHash(ctx, s.db, inviteTokenHash, s.clk.Now())
		if err != nil {
			return nil, err
		}
	}

	// Validate redirectTo against same-origin allowlist. Silent strip on
	// mismatch — don't reject the user for a stale redirect, just drop
	// the parameter and use the default APP_POST_LOGIN_URL.
	redirectTo := ""
	if in.RedirectTo != "" && len(in.RedirectTo) <= MaxRedirectToChars && isAllowedRedirect(in.RedirectTo) {
		redirectTo = in.RedirectTo
	}

	nonce, err := randomHex(OAuthNonceBytes)
	if err != nil {
		return nil, fmt.Errorf("oauth nonce: %w", err)
	}
	issued := s.clk.Now()
	payload := OAuthStatePayload{
		Nonce:           nonce,
		InviteTokenHash: inviteTokenHash,
		RedirectTo:      redirectTo,
		IssuedAt:        issued.Unix(),
	}
	signed, err := s.oauthState.Sign(payload)
	if err != nil {
		return nil, fmt.Errorf("sign oauth state: %w", err)
	}

	return &InitiateGoogleOAuthResult{
		SignedState: signed,
		AuthCodeURL: s.oauth.AuthCodeURL(signed),
		ExpiresAt:   issued.Add(OAuthStateTTL),
	}, nil
}

// GoogleCallbackInput drives the callback.
type GoogleCallbackInput struct {
	Code        string
	State       string
	CookieState string
	RequestHost string
}

// GoogleCallbackResult is what the handler turns into a 302 + cookie.
type GoogleCallbackResult struct {
	User             generated.User
	AccessToken      string
	RefreshToken     string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	RefreshTTL       time.Duration
	InviteAccepted   bool
	CenterID         string
	CenterName       string
	Role             string
	// InviteSurface carries the redirect-friendly error if the invite
	// branch produced a recoverable failure (mismatch, expired, already
	// accepted). When non-empty, the login itself succeeded but the
	// frontend should surface a banner.
	InviteSurface error
}

// HandleGoogleCallback implements AC2 + AC3 + AC5. Steps are executed
// in the exact order documented in the story file. Each failure is a
// distinct pointer-typed error so the handler can map to a specific
// ?error=<code> redirect.
func (s *AuthService) HandleGoogleCallback(ctx context.Context, in GoogleCallbackInput) (*GoogleCallbackResult, error) {
	if s.oauth == nil || s.oauthState == nil {
		return nil, &OAuthNotConfiguredError{}
	}

	// 1. Cookie present.
	if in.CookieState == "" {
		return nil, &OAuthStateMissingError{}
	}
	// 2. Cookie equals state query byte-for-byte (double-submit cookie).
	//    Cheap reject before HMAC verification — saves crypto if the
	//    attacker swapped one half.
	if in.State == "" || in.State != in.CookieState {
		return nil, &OAuthStateInvalidError{}
	}
	// 2b. HMAC valid + 3. TTL fresh (signer combines both checks).
	payload, err := s.oauthState.Verify(in.State)
	if err != nil {
		return nil, err
	}

	// 4. Exchange code for access token.
	token, err := s.oauth.Exchange(ctx, in.Code)
	if err != nil {
		return nil, &OAuthExchangeError{UpstreamErr: err.Error()}
	}
	// 5. Fetch profile.
	profile, err := s.oauth.UserInfo(ctx, token)
	if err != nil {
		// UserInfo returns *OAuthUserinfoError already-typed.
		return nil, err
	}
	if !profile.EmailVerified {
		return nil, &OAuthEmailUnverifiedError{}
	}

	normalizedEmail := normalizeEmail(profile.Email)

	// 6. Resolve identity (Branch A / B / C).
	user, branch, err := s.resolveGoogleIdentity(ctx, profile, normalizedEmail)
	if err != nil {
		return nil, err
	}

	userUUID, err := pgUUIDToGoogle(user.ID)
	if err != nil {
		return nil, fmt.Errorf("convert user id: %w", err)
	}

	// 7. Tenant binding (subdomain only — apex bypasses).
	resolvedCenter, err := s.assertTenantBinding(ctx, userUUID, in.RequestHost)
	if err != nil {
		return nil, err
	}

	// 8. Invite binding (if state carried an inviteTokenHash).
	var inviteAcceptedResult *AcceptInviteResult
	var inviteSurface error
	if payload.InviteTokenHash != "" {
		acceptRes, acceptErr := s.AcceptInviteInternal(ctx, userUUID, payload.InviteTokenHash, normalizedEmail)
		switch {
		case acceptErr == nil:
			inviteAcceptedResult = acceptRes
		case isRecoverableInviteError(acceptErr):
			// Login still succeeds; surface to handler for redirect query.
			inviteSurface = acceptErr
		default:
			return nil, acceptErr
		}
	}

	// 9. Issue session.
	session, err := s.issueSessionForUser(ctx, user)
	if err != nil {
		return nil, err
	}

	// Post-commit audits — best-effort. Branch outcome drives the event name.
	postCtx := context.WithoutCancel(ctx)
	switch branch {
	case googleBranchAExisting:
		s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
			UserID:     userUUID,
			Event:      "auth.google_signin",
			EntityType: "user",
			EntityID:   userUUID,
			Changes:    Changes{After: map[string]any{"method": "google", "linked": false}},
		})
	case googleBranchBLinked:
		s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
			UserID:     userUUID,
			Event:      "auth.google_account_linked",
			EntityType: "user",
			EntityID:   userUUID,
			Changes:    Changes{Before: map[string]any{"googleId": nil}, After: map[string]any{"googleId": profile.Sub}},
		})
	case googleBranchCNew:
		s.logAuthAuditBestEffort(postCtx, AuthAuditEntry{
			UserID:     userUUID,
			Event:      "auth.google_account_created",
			EntityType: "user",
			EntityID:   userUUID,
			Changes:    Changes{After: map[string]any{"method": "google", "emailVerified": true}},
		})
	}

	result := &GoogleCallbackResult{
		User:             user,
		AccessToken:      session.AccessToken,
		RefreshToken:     session.RefreshToken,
		AccessExpiresAt:  session.AccessExpiresAt,
		RefreshExpiresAt: session.RefreshExpiresAt,
		RefreshTTL:       session.RefreshTTL,
		InviteSurface:    inviteSurface,
	}
	if inviteAcceptedResult != nil {
		result.InviteAccepted = true
		result.CenterID = inviteAcceptedResult.CenterID
		result.CenterName = inviteAcceptedResult.CenterName
		result.Role = inviteAcceptedResult.Role
	}
	if resolvedCenter != nil {
		// Subdomain login binds to that center. If the invite acceptance
		// also produced a center (rare, but possible if invite was for
		// the same center the subdomain points to), keep the invite's
		// values — they carry the role too.
		if result.CenterID == "" {
			result.CenterID = uuid.UUID(resolvedCenter.ID.Bytes).String()
			result.CenterName = resolvedCenter.Name
		}
	}
	return result, nil
}

// googleBranch identifies which arm of AC2 step 6 resolved the user.
// Used only for audit event selection.
type googleBranch int

const (
	googleBranchAExisting googleBranch = iota
	googleBranchBLinked
	googleBranchCNew
)

// resolveGoogleIdentity implements AC2 step 6 (Branches A/B/C). Returns
// the user row + the branch so the caller can audit appropriately.
func (s *AuthService) resolveGoogleIdentity(ctx context.Context, profile *GoogleUserInfo, normalizedEmail string) (generated.User, googleBranch, error) {
	q := generated.New(s.db)

	// Branch A — match by google_id.
	if profile.Sub != "" {
		user, err := q.GetUserByGoogleID(ctx, pgtype.Text{String: profile.Sub, Valid: true})
		if err == nil {
			return user, googleBranchAExisting, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return generated.User{}, 0, fmt.Errorf("lookup by google_id: %w", err)
		}
	}

	// Branch B — match by email; link via LinkGoogleAccount race-safe UPDATE.
	user, err := q.GetUserByEmail(ctx, normalizedEmail)
	if err == nil {
		avatar := pgtype.Text{}
		if profile.Picture != "" {
			avatar = pgtype.Text{String: profile.Picture, Valid: true}
		}
		rows, linkErr := q.LinkGoogleAccount(ctx, generated.LinkGoogleAccountParams{
			ID:        user.ID,
			GoogleID:  pgtype.Text{String: profile.Sub, Valid: true},
			AvatarUrl: avatar,
		})
		if linkErr != nil {
			return generated.User{}, 0, fmt.Errorf("link google account: %w", linkErr)
		}
		if rows == 0 {
			// Another linker won the race (or the row already had a
			// google_id != ours — uncommon but possible if the user
			// somehow had a non-our google_id pre-linked).
			return generated.User{}, 0, &GoogleIDAlreadyLinkedError{}
		}
		// Re-fetch with the freshly-linked row so the caller sees the
		// updated google_id / avatar / email_verified.
		refreshed, err := q.GetUserByID(ctx, user.ID)
		if err != nil {
			return generated.User{}, 0, fmt.Errorf("refetch linked user: %w", err)
		}
		return refreshed, googleBranchBLinked, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return generated.User{}, 0, fmt.Errorf("lookup by email: %w", err)
	}

	// Branch C — create a new user with email_verified=true and the
	// supplied avatar/name. PasswordHash stays NULL (Google-only).
	avatar := pgtype.Text{}
	if profile.Picture != "" {
		avatar = pgtype.Text{String: profile.Picture, Valid: true}
	}
	created, err := q.CreateUser(ctx, generated.CreateUserParams{
		Email:        normalizedEmail,
		PasswordHash: pgtype.Text{}, // NULL — Google-only account
		FullName:     profile.Name,
		GoogleID:     pgtype.Text{String: profile.Sub, Valid: true},
	})
	if err != nil {
		return generated.User{}, 0, fmt.Errorf("create google user: %w", err)
	}
	// CreateUser leaves email_verified=false by default (it's a Story 1.4
	// invariant for the password-registration path). Override here:
	// Google has already verified the email, and the avatar isn't set
	// by CreateUser either.
	if _, err := s.db.Exec(ctx,
		`UPDATE users SET email_verified = true, avatar_url = COALESCE(avatar_url, $2) WHERE id = $1`,
		created.ID, avatar,
	); err != nil {
		return generated.User{}, 0, fmt.Errorf("mark google user verified: %w", err)
	}
	refreshed, err := q.GetUserByID(ctx, created.ID)
	if err != nil {
		return generated.User{}, 0, fmt.Errorf("refetch new google user: %w", err)
	}
	return refreshed, googleBranchCNew, nil
}

// assertTenantBinding implements AC3. Apex host → no check (returns nil
// resolved center). Subdomain host → look up center by slug + assert
// membership; missing membership → *OAuthTenantMismatchError + audit row.
//
// Defense-in-depth: an empty appApexHost would otherwise short-circuit
// the entire check. Treat that as a misconfiguration and run the
// membership check anyway — the worst case is that legitimate logins
// fail loudly until the operator fixes APP_APEX_HOST.
func (s *AuthService) assertTenantBinding(ctx context.Context, userUUID uuid.UUID, requestHost string) (*generated.Center, error) {
	host := strings.ToLower(strings.TrimSpace(requestHost))
	if host == "" {
		return nil, nil
	}
	// Strip port via net.SplitHostPort so IPv6 hosts like "[::1]:8080"
	// don't get chopped at the first ':' inside the brackets.
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(host, "[]")
	apex := strings.ToLower(strings.TrimSpace(s.appApexHost))
	if apex != "" {
		if h, _, err := net.SplitHostPort(apex); err == nil {
			apex = h
		}
		apex = strings.Trim(apex, "[]")
		if host == apex {
			return nil, nil
		}
	}
	// Extract the leading label as the slug.
	dot := strings.IndexByte(host, '.')
	if dot < 0 {
		// No dot — host is a bare label, treat as apex.
		return nil, nil
	}
	slug := strings.ToLower(host[:dot])
	if slug == "" {
		return nil, nil
	}

	// centers is a global (no-RLS) table — safe to query off the bare pool.
	q := generated.New(s.db)
	center, err := q.GetCenterByShortCode(ctx, slug)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Unknown subdomain — treat the same as a non-member. The
			// audit captures the slug so SOC can spot probing.
			s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
				UserID:     userUUID,
				Event:      "auth.oauth_tenant_mismatch",
				EntityType: "user",
				EntityID:   userUUID,
				Changes:    Changes{After: map[string]any{"requestedTenantSlug": slug, "userHasMembership": false, "reason": "unknown_slug"}},
			})
			return nil, &OAuthTenantMismatchError{RequestedHost: requestHost, UserID: userUUID.String()}
		}
		return nil, fmt.Errorf("get center by slug: %w", err)
	}

	// center_members is RLS-protected (FORCE ROW LEVEL SECURITY) so the
	// read MUST run inside a tx with SET LOCAL app.current_tenant_id —
	// without it, the policy filter is `center_id = NULL::uuid` and every
	// legitimate member surfaces as 0 rows. Same pattern as auth_admin.go.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tenant-binding tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		uuid.UUID(center.ID.Bytes).String(),
	); err != nil {
		return nil, fmt.Errorf("set tenant local: %w", err)
	}
	txQ := generated.New(tx)
	_, err = txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgtype.UUID{Bytes: userUUID, Valid: true},
		CenterID: center.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Roll the read tx back BEFORE the audit write so we don't
			// hold a connection while writing the audit row.
			_ = tx.Rollback(context.WithoutCancel(ctx))
			s.logAuthAuditBestEffort(context.WithoutCancel(ctx), AuthAuditEntry{
				UserID:     userUUID,
				Event:      "auth.oauth_tenant_mismatch",
				EntityType: "user",
				EntityID:   userUUID,
				Changes:    Changes{After: map[string]any{"requestedTenantSlug": slug, "userHasMembership": false}},
			})
			return nil, &OAuthTenantMismatchError{RequestedHost: requestHost, UserID: userUUID.String()}
		}
		return nil, fmt.Errorf("center member lookup: %w", err)
	}
	return &center, nil
}

// sessionTokens bundles what issueSessionForUser produces. Shared with
// the invite-acceptance flow which also mints a session post-commit.
type sessionTokens struct {
	AccessToken      string
	RefreshToken     string
	AccessExpiresAt  time.Time
	RefreshExpiresAt time.Time
	RefreshTTL       time.Duration
}

// issueSessionForUser mints an access JWT + persists a refresh-token
// row. Mirrors the Login success path. Audit rows are best-effort
// after-commit.
func (s *AuthService) issueSessionForUser(ctx context.Context, user generated.User) (*sessionTokens, error) {
	refreshRaw, refreshHash, familyID, err := generateRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("generate refresh token: %w", err)
	}
	now := s.clk.Now()
	refreshExpiry := now.Add(RefreshTokenTTLDefault)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin session tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	q := generated.New(tx)
	if _, err := q.CreateRefreshToken(ctx, generated.CreateRefreshTokenParams{
		UserID:     user.ID,
		TokenHash:  refreshHash,
		FamilyID:   pgtype.UUID{Bytes: familyID, Valid: true},
		ExpiresAt:  pgtype.Timestamptz{Time: refreshExpiry, Valid: true},
		RememberMe: false,
	}); err != nil {
		return nil, fmt.Errorf("create refresh token: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit session tx: %w", err)
	}

	access, accessExp, _, err := s.buildAccessToken(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("sign access token: %w", err)
	}
	// role deliberately dropped — Google callback returns a redirect, not
	// a JSON body, so role never lands on a wire that a frontend Session
	// cache reads. The freshly-minted access token still carries the
	// role claim (baked in by buildAccessToken); the next /api/auth/refresh
	// call from the SPA will surface it in the LoginResult envelope.
	return &sessionTokens{
		AccessToken:      access,
		RefreshToken:     refreshRaw,
		AccessExpiresAt:  accessExp,
		RefreshExpiresAt: refreshExpiry,
		RefreshTTL:       RefreshTokenTTLDefault,
	}, nil
}

// isRecoverableInviteError differentiates "the invite was bad but the
// login itself can still succeed" (mismatch / expired / already-accepted)
// from "the invite is so broken we should bail" (unknown token, DB
// failure). The former gets surfaced via redirect query params; the
// latter aborts the callback entirely.
func isRecoverableInviteError(err error) bool {
	var mismatch *InviteEmailMismatchError
	var expired *InviteExpiredError
	var already *InviteAlreadyAcceptedError
	return errors.As(err, &mismatch) ||
		errors.As(err, &expired) ||
		errors.As(err, &already)
}

// randomHex returns 2*n hex characters. Used for the OAuth nonce.
func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// hashInviteTokenHex is the canonical sha256-hex of an invite token.
// Used by InitiateGoogleOAuth (state-payload binding) and AcceptInvite
// (token lookup). Centralized so the two sites can't drift.
func hashInviteTokenHex(raw string) string {
	return HashResetToken(raw) // reuses sha256+hex from auth_login.go
}

// isAllowedRedirect implements AC1's same-origin allowlist for the
// optional redirectTo parameter. Anything not matching gets silently
// dropped (caller falls back to APP_POST_LOGIN_URL).
//
// MVP host shape: prefix match on https://classlite.app/, https://
// any subdomain of classlite.app/, and dev's http://localhost:5173/.
// Epic 1C subdomain routing will tighten this when DNS / cert
// provisioning lands.
func isAllowedRedirect(redirectTo string) bool {
	allowed := []string{
		"https://my.classlite.app/",
		"http://localhost:5173/",
	}
	for _, prefix := range allowed {
		if strings.HasPrefix(redirectTo, prefix) {
			return true
		}
	}
	// Allow any *.classlite.app/ subdomain in https.
	if strings.HasPrefix(redirectTo, "https://") {
		rest := redirectTo[len("https://"):]
		if dot := strings.IndexByte(rest, '/'); dot > 0 {
			host := rest[:dot]
			if strings.HasSuffix(host, ".classlite.app") {
				return true
			}
		}
	}
	return false
}

// jsonDecode wraps encoding/json so the realGoogleOAuthClient can keep
// the import surface tight. Failures bubble up with the underlying
// error; the caller wraps in *OAuthUserinfoError.
func jsonDecode(r io.Reader, out any) error {
	return json.NewDecoder(r).Decode(out)
}

// loadInviteByTokenHash calls the SECURITY DEFINER function via raw pgx
// (sqlc can't introspect SELECT-from-function-returning-TABLE). Returns
// all the columns AcceptInvite needs PLUS the inviter's email + center
// name (used for error envelope details). pgx.ErrNoRows → typed
// *InviteNotFoundError.
//
// expiry is the now-time injected by the service so MockClock advances
// in tests work deterministically.
//
// Return tuple (id, centerID, inviterID, email, name, role, fields...) — too
// many to enumerate cleanly; named struct InviteRow is the alternative
// but would force an additional package re-export. Keep it positional.
func loadInviteByTokenHash(ctx context.Context, db generated.DBTX, tokenHash string, now time.Time) (
	inviteID uuid.UUID,
	centerID uuid.UUID,
	inviterID uuid.UUID,
	email string,
	role string,
	acceptedAt *time.Time,
	err error,
) {
	var (
		idPg         pgtype.UUID
		centerPg     pgtype.UUID
		inviterPg    pgtype.UUID
		expiresAtPg  pgtype.Timestamptz
		acceptedAtPg pgtype.Timestamptz
	)
	row := db.QueryRow(ctx,
		`SELECT id, center_id, inviter_id, email, role, expires_at, accepted_at
		 FROM get_invite_by_token_hash($1)`,
		tokenHash,
	)
	if scanErr := row.Scan(&idPg, &centerPg, &inviterPg, &email, &role, &expiresAtPg, &acceptedAtPg); scanErr != nil {
		if errors.Is(scanErr, pgx.ErrNoRows) {
			return uuid.Nil, uuid.Nil, uuid.Nil, "", "", nil, &InviteNotFoundError{}
		}
		return uuid.Nil, uuid.Nil, uuid.Nil, "", "", nil, fmt.Errorf("get invite by token hash: %w", scanErr)
	}
	inviteID = uuid.UUID(idPg.Bytes)
	centerID = uuid.UUID(centerPg.Bytes)
	inviterID = uuid.UUID(inviterPg.Bytes)

	// AC4 idempotency check: already-accepted → 409. We need the center
	// name in the details payload, so fetch it before returning.
	if acceptedAtPg.Valid {
		t := acceptedAtPg.Time
		acceptedAt = &t
		centerName, _ := fetchCenterName(ctx, db, centerPg)
		return uuid.Nil, uuid.Nil, uuid.Nil, "", "", &t,
			&InviteAlreadyAcceptedError{CenterName: centerName}
	}

	// AC4 expiry check.
	if !expiresAtPg.Valid || !expiresAtPg.Time.After(now) {
		centerName, _ := fetchCenterName(ctx, db, centerPg)
		inviterEmail, _ := fetchUserEmail(ctx, db, inviterPg)
		return uuid.Nil, uuid.Nil, uuid.Nil, "", "", nil,
			&InviteExpiredError{CenterName: centerName, InviterEmail: inviterEmail}
	}

	return inviteID, centerID, inviterID, email, role, nil, nil
}

// fetchCenterName runs a one-shot lookup for the center.name. Best-effort
// — the audit/error paths still produce a usable response if the row is
// missing for any reason (race with a delete, etc.).
func fetchCenterName(ctx context.Context, db generated.DBTX, centerID pgtype.UUID) (string, error) {
	var name string
	row := db.QueryRow(ctx, `SELECT name FROM centers WHERE id = $1`, centerID)
	if err := row.Scan(&name); err != nil {
		return "", err
	}
	return name, nil
}

// fetchUserEmail runs a one-shot lookup for users.email by id.
func fetchUserEmail(ctx context.Context, db generated.DBTX, userID pgtype.UUID) (string, error) {
	var email string
	row := db.QueryRow(ctx, `SELECT email FROM users WHERE id = $1`, userID)
	if err := row.Scan(&email); err != nil {
		return "", err
	}
	return email, nil
}
