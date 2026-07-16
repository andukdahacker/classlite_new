// Package service — Story 2.5c Google Meet OAuth per-center integration.
//
// Separate flow from Story 1.6 login OAuth (auth_google.go):
//   - scope: https://www.googleapis.com/auth/calendar.events
//   - callback path: /api/centers/callback/google-meet (browser 302 target)
//   - downstream: center_integrations row + centers.google_meet_connected=true
//
// Security invariants (see docs/project-context.md §SEC-3 + Story 2.5c AC5):
//   1. OAuth state signed w/ HMAC (same signer as login) + 10-min TTL.
//   2. state.CenterID == path{id} == tc.CenterID triple binding (AC7).
//   3. state.UserID == tc.UserID (freshness — force-logout defense per AC5 step 3).
//   4. Fresh owner membership re-check via center_members lookup — reject if
//      revoked between authorize and callback (OAuthMembershipRevokedError).
//   5. Tokens sealed via AES-256-GCM (integration_crypto.go) before persistence.
//   6. Upsert + centers UPDATE + audit row all commit atomically inside one tx.
//
// Nothing here logs plaintext tokens or the encryption key — Task 10 grep-audit
// pins the invariant.
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"
	googleEndpoint "golang.org/x/oauth2/google"
)

// GoogleMeetScope is the Calendar API OAuth scope required for Meet-link
// creation via Calendar events (Story 3.x will consume the sealed tokens).
const GoogleMeetScope = "https://www.googleapis.com/auth/calendar.events"

// GoogleMeetProvider is the string persisted in center_integrations.provider
// and the audit action prefix. Locked to the CHECK-constraint value.
const GoogleMeetProvider = "google_meet"

const (
	auditActionMeetConnected    = "center.integration.google_meet.connected"
	auditActionMeetDisconnected = "center.integration.google_meet.disconnected"
	auditEntityTypeIntegration  = "center_integration"
)

// GoogleMeetOAuthClient abstracts the Google OAuth2 calls the Meet service
// makes. Interface seam mirrors Story 1.6 GoogleOAuthClient — tests inject a
// mock that skips the real Google round-trip.
type GoogleMeetOAuthClient interface {
	AuthCodeURL(state string) string
	Exchange(ctx context.Context, code string) (*oauth2.Token, error)
}

// realGoogleMeetOAuthClient wraps oauth2.Config with the calendar.events
// scope. Constructed in main.go from Config.GoogleClientID/Secret and the
// Story 2.5c MEET_OAUTH_REDIRECT_URL.
type realGoogleMeetOAuthClient struct {
	cfg *oauth2.Config
}

// NewGoogleMeetOAuthClient constructs the production client. Uses the same
// client_id / secret as the login OAuth flow — Google routes based on the
// redirect URI (Meet-specific) and scope, not by app identity.
func NewGoogleMeetOAuthClient(clientID, clientSecret, redirectURL string) GoogleMeetOAuthClient {
	return &realGoogleMeetOAuthClient{
		cfg: &oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Scopes:       []string{GoogleMeetScope},
			Endpoint:     googleEndpoint.Endpoint,
		},
	}
}

func (c *realGoogleMeetOAuthClient) AuthCodeURL(state string) string {
	// access_type=offline — Meet flow NEEDS the refresh token so Story 3.x
	// session workers can create Meet links long after the initial connect.
	// prompt=consent — forces Google to always return a refresh token even
	// when the user has previously granted the scope.
	return c.cfg.AuthCodeURL(state,
		oauth2.AccessTypeOffline,
		oauth2.SetAuthURLParam("prompt", "consent"),
	)
}

func (c *realGoogleMeetOAuthClient) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	return c.cfg.Exchange(ctx, code)
}

// GoogleMeetService is the SettingsService peer for Story 2.5c. Owner-only.
// The handler layer asserts {id} == tc.CenterID + tc.Role == "owner" via the
// settingsChain BEFORE dispatching to this service (belt); the service
// re-validates the state/tenant/user triple binding + fresh membership
// inside HandleCallback (suspenders per AC5).
type GoogleMeetService struct {
	db            AuthDB
	oauth         GoogleMeetOAuthClient
	oauthState    OAuthStateSigner
	audit         AuditLogger
	clk           clock.Clock
	encryptionKey []byte
	// authorizedByAccess is a dependency seam for the fresh-membership
	// re-check. Kept as a function so tests can inject a fake without
	// spinning a full auth service. Production defaults to a
	// generated.GetCenterMemberByUserAndCenter call.
	authorizedByAccess func(ctx context.Context, userID, centerID uuid.UUID) (bool, error)
}

// NewGoogleMeetService wires the production service.
func NewGoogleMeetService(
	db AuthDB,
	oauthClient GoogleMeetOAuthClient,
	stateSigner OAuthStateSigner,
	audit AuditLogger,
	clk clock.Clock,
	encryptionKey []byte,
) *GoogleMeetService {
	s := &GoogleMeetService{
		db:            db,
		oauth:         oauthClient,
		oauthState:    stateSigner,
		audit:         audit,
		clk:           clk,
		encryptionKey: encryptionKey,
	}
	s.authorizedByAccess = s.defaultCheckOwnerMembership
	return s
}

// SetOwnerMembershipCheck lets tests inject a stub for the fresh-membership
// re-check (AC5 step 3). Production paths never call this.
func (s *GoogleMeetService) SetOwnerMembershipCheck(fn func(ctx context.Context, userID, centerID uuid.UUID) (bool, error)) {
	s.authorizedByAccess = fn
}

// BuildAuthorizeURLResult is what handler.Authorize turns into a JSON envelope.
type BuildAuthorizeURLResult struct {
	AuthorizeURL string
	ExpiresAt    time.Time
}

// BuildAuthorizeURL implements AC2 step 1-3. Signs state{Nonce, CenterID,
// UserID, IssuedAt} + returns Google's authorize URL. The handler layer
// serializes {authorizeUrl}; the client calls window.location.assign to
// navigate the browser to Google.
func (s *GoogleMeetService) BuildAuthorizeURL(ctx context.Context, tc model.TenantContext) (*BuildAuthorizeURLResult, error) {
	if s.oauth == nil || s.oauthState == nil {
		return nil, &OAuthNotConfiguredError{}
	}
	if err := requireOwnerTenantContext(tc); err != nil {
		return nil, err
	}
	nonce, err := randomHex(OAuthNonceBytes)
	if err != nil {
		return nil, fmt.Errorf("meet oauth nonce: %w", err)
	}
	issued := s.clk.Now()
	payload := OAuthStatePayload{
		Nonce:    nonce,
		IssuedAt: issued.Unix(),
		CenterID: tc.CenterID,
		UserID:   tc.UserID,
	}
	signed, err := s.oauthState.Sign(payload)
	if err != nil {
		return nil, fmt.Errorf("sign meet oauth state: %w", err)
	}
	return &BuildAuthorizeURLResult{
		AuthorizeURL: s.oauth.AuthCodeURL(signed),
		ExpiresAt:    issued.Add(OAuthStateTTL),
	}, nil
}

// HandleCallbackInput drives the callback handler. tc is the CALLBACK-request
// tenant context (fresh JWT), which the service verifies against state.
type HandleCallbackInput struct {
	Code       string
	State      string
	PathID     string
	TC         model.TenantContext
}

// HandleCallback executes the 7-step tx flow per AC5. On success, returns
// the resolved center_id (used by the handler to build the 302 URL). On any
// error, no side-effects persist (tx rolled back, no partial state).
func (s *GoogleMeetService) HandleCallback(ctx context.Context, in HandleCallbackInput) (string, error) {
	if s.oauth == nil || s.oauthState == nil {
		return "", &OAuthNotConfiguredError{}
	}
	if err := requireOwnerTenantContext(in.TC); err != nil {
		return "", err
	}
	if in.Code == "" || in.State == "" {
		return "", &OAuthStateInvalidError{}
	}

	// Step 2 — validate state HMAC + TTL. Verify() returns
	// *OAuthStateInvalidError or *OAuthStateExpiredError already-typed.
	payload, err := s.oauthState.Verify(in.State)
	if err != nil {
		return "", err
	}

	// AC7 — triple binding.
	if payload.CenterID == "" || payload.UserID == "" {
		return "", &OAuthStateMismatchError{Reason: "state missing binding fields"}
	}
	if payload.CenterID != in.PathID {
		return "", &OAuthStateMismatchError{Reason: "state center id ≠ path center id"}
	}
	if payload.CenterID != in.TC.CenterID {
		return "", &OAuthStateMismatchError{Reason: "state center id ≠ session tenant"}
	}
	if payload.UserID != in.TC.UserID {
		return "", &OAuthStateMismatchError{Reason: "state user id ≠ session user"}
	}

	centerUUID, err := uuid.Parse(in.TC.CenterID)
	if err != nil {
		return "", &OAuthStateMismatchError{Reason: "invalid center id format"}
	}
	userUUID, err := uuid.Parse(in.TC.UserID)
	if err != nil {
		return "", &OAuthStateMismatchError{Reason: "invalid user id format"}
	}

	// Step 3 — fresh Owner membership re-check.
	// P10 fix (2026-07-16 code review Chunk 2, Edge Case #5): a DB blip
	// during the membership lookup previously returned a plain wrapped
	// error, so ErrorMapper fell through to INTERNAL_ERROR (500). Surface
	// as IntegrationConnectFailedError so the callback returns the same
	// stable 502 code as other transient-upstream failures (Google
	// exchange, upsert). UpstreamErr captures the underlying error for
	// server-side forensics without echoing to the client.
	stillOwner, err := s.authorizedByAccess(ctx, userUUID, centerUUID)
	if err != nil {
		return "", &IntegrationConnectFailedError{
			Provider:    GoogleMeetProvider,
			UpstreamErr: fmt.Sprintf("membership check: %s", err.Error()),
		}
	}
	if !stillOwner {
		return "", &OAuthMembershipRevokedError{
			UserID:   in.TC.UserID,
			CenterID: in.TC.CenterID,
		}
	}

	// Step 4-5 — begin tx + SET LOCAL app.current_tenant_id (required for
	// center_integrations RLS INSERT / UPDATE).
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("meet callback: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, in.TC); err != nil {
		return "", fmt.Errorf("meet callback: set tenant context: %w", err)
	}

	// Step 6 — exchange code for tokens.
	token, err := s.oauth.Exchange(ctx, in.Code)
	if err != nil {
		return "", &IntegrationConnectFailedError{Provider: GoogleMeetProvider, UpstreamErr: err.Error()}
	}
	if token.AccessToken == "" || token.RefreshToken == "" {
		return "", &IntegrationConnectFailedError{
			Provider:    GoogleMeetProvider,
			UpstreamErr: "google exchange returned incomplete token pair",
		}
	}

	// Step 7 — seal both tokens with AES-256-GCM.
	sealedAccess, err := SealToken([]byte(token.AccessToken), s.encryptionKey)
	if err != nil {
		return "", fmt.Errorf("meet callback: seal access token: %w", err)
	}
	sealedRefresh, err := SealToken([]byte(token.RefreshToken), s.encryptionKey)
	if err != nil {
		return "", fmt.Errorf("meet callback: seal refresh token: %w", err)
	}

	// Step 8 — upsert integration row (atomic INSERT ... ON CONFLICT UPDATE).
	q := generated.New(tx)
	expiry := token.Expiry
	if expiry.IsZero() {
		// Google occasionally omits expires_in for offline access; fall back
		// to a conservative 1-hour default matching Google's Meet/Calendar
		// token lifetime.
		expiry = s.clk.Now().Add(time.Hour)
	}
	integration, err := q.UpsertIntegration(ctx, generated.UpsertIntegrationParams{
		CenterID:              pgUUID(centerUUID),
		Provider:              GoogleMeetProvider,
		AccessTokenEncrypted:  sealedAccess,
		RefreshTokenEncrypted: sealedRefresh,
		Scope:                 GoogleMeetScope,
		ExpiresAt:             pgtype.Timestamptz{Time: expiry, Valid: true},
	})
	if err != nil {
		return "", &IntegrationConnectFailedError{Provider: GoogleMeetProvider, UpstreamErr: err.Error()}
	}

	// Step 9 — flip centers.google_meet_connected = true.
	if _, err := q.SetCenterGoogleMeetConnected(ctx, generated.SetCenterGoogleMeetConnectedParams{
		ID:                  pgUUID(centerUUID),
		GoogleMeetConnected: true,
	}); err != nil {
		return "", &IntegrationConnectFailedError{Provider: GoogleMeetProvider, UpstreamErr: err.Error()}
	}

	// Step 10 — audit row inside the same tx.
	// P7 fix (2026-07-16 code review): use UpsertIntegration.WasInserted to
	// record the real pre-state so a reconnect (INSERT ON CONFLICT UPDATE)
	// does not falsely audit as a first-connect. Frontend / SOC forensics
	// can then distinguish "initial connect" from "account switch".
	integrationUUID := uuidFromPg(integration.ID)
	if err := s.audit.LogWithinTx(
		ctx, tx, in.TC,
		auditActionMeetConnected, auditEntityTypeIntegration,
		integrationUUID,
		Changes{
			Before: map[string]any{"connected": !integration.WasInserted, "provider": GoogleMeetProvider},
			After: map[string]any{
				"connected": true,
				"provider":  GoogleMeetProvider,
				"scope":     GoogleMeetScope,
			},
		},
	); err != nil {
		return "", &IntegrationConnectFailedError{Provider: GoogleMeetProvider, UpstreamErr: err.Error()}
	}

	// Step 11 — commit.
	if err := tx.Commit(ctx); err != nil {
		return "", &IntegrationConnectFailedError{Provider: GoogleMeetProvider, UpstreamErr: err.Error()}
	}
	return in.TC.CenterID, nil
}

// Disconnect implements AC3 — atomic delete + flag-flip + audit inside one tx.
// Idempotent: DELETE affecting 0 rows is not an error (repeated Disconnect
// clicks or already-disconnected state).
func (s *GoogleMeetService) Disconnect(ctx context.Context, tc model.TenantContext) error {
	if err := requireOwnerTenantContext(tc); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return fmt.Errorf("disconnect meet: parse tenant center id: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("disconnect meet: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("disconnect meet: set tenant context: %w", err)
	}

	q := generated.New(tx)
	deletedIDs, err := q.DeleteIntegration(ctx, generated.DeleteIntegrationParams{
		CenterID: pgUUID(centerUUID),
		Provider: GoogleMeetProvider,
	})
	if err != nil {
		return fmt.Errorf("disconnect meet: delete integration: %w", err)
	}

	// P8 fix (2026-07-16 code review): when Disconnect finds no row to
	// delete (already disconnected — a stale button click or two-tab race),
	// skip the flag flip AND skip the audit row. Previously we always
	// updated the flag + emitted an audit; that generated spurious audit
	// entries and redundant UPDATEs for no-op calls. Still commit the tx
	// to keep the tenant-context SET LOCAL clean for observability.
	if len(deletedIDs) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("disconnect meet: commit tx: %w", err)
		}
		return nil
	}

	if _, err := q.SetCenterGoogleMeetConnected(ctx, generated.SetCenterGoogleMeetConnectedParams{
		ID:                  pgUUID(centerUUID),
		GoogleMeetConnected: false,
	}); err != nil {
		return fmt.Errorf("disconnect meet: clear centers flag: %w", err)
	}

	// P6 fix (2026-07-16 code review): audit entity_id references the
	// deleted integration's ID (matches Connect audit's entity_id) so
	// forensic queries `WHERE entity_id = <integration_id>` find both
	// Connect and Disconnect events for the same integration lifecycle.
	integrationUUID := uuidFromPg(deletedIDs[0])
	if err := s.audit.LogWithinTx(
		ctx, tx, tc,
		auditActionMeetDisconnected, auditEntityTypeIntegration,
		integrationUUID,
		Changes{
			Before: map[string]any{"connected": true, "provider": GoogleMeetProvider},
			After:  map[string]any{"connected": false},
		},
	); err != nil {
		return fmt.Errorf("disconnect meet: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("disconnect meet: commit tx: %w", err)
	}
	return nil
}

// defaultCheckOwnerMembership runs a fresh center_members lookup and asserts
// the resolved role is 'owner'. Runs on the bare pool (center_members is
// RLS-protected; we open a short-lived tx to set tenant context first — same
// pattern as auth_google.go assertTenantBinding).
func (s *GoogleMeetService) defaultCheckOwnerMembership(ctx context.Context, userID, centerID uuid.UUID) (bool, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("membership check: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerID.String(),
	); err != nil {
		return false, fmt.Errorf("membership check: set tenant local: %w", err)
	}
	q := generated.New(tx)
	member, err := q.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userID),
		CenterID: pgUUID(centerID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("membership check: lookup: %w", err)
	}
	return member.Role == "owner", nil
}

// requireOwnerTenantContext guards service entry — the handler-layer
// settingsChain already asserts tc.Role == "owner" for the API entry points;
// this is defense-in-depth so the service can be called from workers or
// tests without silently accepting a wrong role.
func requireOwnerTenantContext(tc model.TenantContext) error {
	if tc.UserID == "" || tc.CenterID == "" {
		return &ForbiddenError{Reason: "insufficient role"}
	}
	if _, err := uuid.Parse(tc.UserID); err != nil {
		return &OAuthStateMismatchError{Reason: "invalid user id format"}
	}
	if _, err := uuid.Parse(tc.CenterID); err != nil {
		return &OAuthStateMismatchError{Reason: "invalid center id format"}
	}
	if tc.Role != "owner" {
		return &ForbiddenError{Reason: "insufficient role"}
	}
	return nil
}
