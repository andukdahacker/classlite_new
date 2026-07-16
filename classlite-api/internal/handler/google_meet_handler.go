// Package handler — Story 2.5c GoogleMeetHandler.
//
// Three routes (per AC9):
//
//   GET    /api/centers/{id}/integrations/google-meet/authorize
//   GET    /api/centers/callback/google-meet
//   DELETE /api/centers/{id}/integrations/google-meet
//
// Authorize + Disconnect sit behind the settingsChain (ExtractTenant →
// RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") →
// settingsRateLimit → ErrorMapper). Both assert path{id} == tc.CenterID
// (belt) before dispatching to service (suspenders — see settings_handler.go
// requireSettingsTenant for the shared pattern).
//
// Callback sits behind oauthCallbackChain (ExtractTenant →
// RequireVerifiedEmail → RequireCenterContext → oauthCallbackRateLimit →
// ErrorMapper). No RequireRole — the state payload proves Owner intent and
// the service HandleCallback re-checks membership per AC5 step 3.
//
// DEVIATION FROM AC9 (documented in Debug Log): the callback path is
// FIXED at `/api/centers/callback/google-meet` (no `{id}` in URL). Google
// OAuth 2.0 requires the redirect_uri to match a registered URI exactly —
// no wildcard / template support — so a per-center URL is infeasible for
// multi-tenant OAuth. Tenant scoping is preserved by the state.CenterID +
// tc.CenterID binding (double-binding vs the story's triple-binding); the
// fresh membership check per AC5 step 3 discharges the same attack surface.
package handler

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// GoogleMeetHandler wires GoogleMeetService to HTTP.
type GoogleMeetHandler struct {
	svc            *service.GoogleMeetService
	clk            clock.Clock
	postConnectURL string // dev: http://localhost:5173/settings — apex-relative in prod.
}

// NewGoogleMeetHandler constructs a GoogleMeetHandler bound to the service.
// postConnectURL is the SPA route the callback redirects to on success
// (?tab=integrations&status=connected appended). On sad path the callback
// emits a JSON envelope (see package doc — errors flow through ErrorMapper).
func NewGoogleMeetHandler(svc *service.GoogleMeetService, clk clock.Clock, postConnectURL string) *GoogleMeetHandler {
	return &GoogleMeetHandler{svc: svc, clk: clk, postConnectURL: postConnectURL}
}

// googleMeetAuthorizeResponse is the wire shape returned by Authorize.
// Mirrors api.yaml GoogleMeetAuthorizeResult — no omitempty (GO-5).
type googleMeetAuthorizeResponse struct {
	AuthorizeURL string `json:"authorizeUrl"`
	ExpiresAt    string `json:"expiresAt"`
}

// Authorize builds the signed state + Google authorize URL. AC2 step 2.
// Sits inside settingsChain so tc.Role == "owner" is already asserted.
func (h *GoogleMeetHandler) Authorize(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireMeetOwnerTenant(r)
	if err != nil {
		return err
	}
	result, err := h.svc.BuildAuthorizeURL(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, googleMeetAuthorizeResponse{
		AuthorizeURL: result.AuthorizeURL,
		ExpiresAt:    result.ExpiresAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	})
	return nil
}

// Callback processes Google's OAuth 302 redirect. AC5 7-step tx flow.
// On success: 302 to postConnectURL + `?tab=integrations&status=connected`.
// On user-cancel (Google `?error=access_denied` etc.): 302 to postConnectURL
// + `?tab=integrations&status=cancelled` (no JSON error envelope — the
// cancel is not a failure).
// On any other failure: returns error → ErrorMapper emits the JSON envelope
// with the mapped HTTP status (400/403/502).
func (h *GoogleMeetHandler) Callback(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return ErrTenantContextMissing
	}
	// D2 fix (2026-07-16 code review): Google emits `?error=access_denied`
	// (or `admin_policy_enforced`, `invalid_scope`, etc.) with no `code`
	// param when the user hits Cancel on the consent screen or Google's
	// admin policy blocks the grant. Surface as a neutral 302 to
	// `?status=cancelled` — the state is fine, the user simply declined.
	// Falling through to HandleCallback would yield a misleading
	// OAUTH_STATE_INVALID (state token tampered) error banner.
	if reason := r.URL.Query().Get("error"); reason != "" {
		http.Redirect(w, r, h.buildCanceledRedirect(), http.StatusFound)
		return nil
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	// Story spec triple-binding degrades to double-binding here (see package
	// doc DEVIATION). PathID mirrors tc.CenterID so the service continues to
	// enforce the same invariant symbolically.
	_, err := h.svc.HandleCallback(r.Context(), service.HandleCallbackInput{
		Code:   code,
		State:  state,
		PathID: tc.CenterID,
		TC:     tc,
	})
	if err != nil {
		return err
	}

	http.Redirect(w, r, h.buildConnectedRedirect(), http.StatusFound)
	return nil
}

// Disconnect deletes the integration row + clears the flag + audits.
// Idempotent — repeated calls succeed cleanly. AC3.
func (h *GoogleMeetHandler) Disconnect(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireMeetOwnerTenant(r)
	if err != nil {
		return err
	}
	if err := h.svc.Disconnect(r.Context(), tc); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// buildConnectedRedirect constructs the success 302 target. Adds tab +
// status=connected query params via net/url so any existing ?fragment on
// postConnectURL survives.
func (h *GoogleMeetHandler) buildConnectedRedirect() string {
	return h.buildStatusRedirect("connected")
}

// buildCanceledRedirect constructs the user-cancel 302 target
// (`?tab=integrations&status=cancelled`). See Callback for the trigger
// condition. Frontend renders a neutral toast, not the error banner.
func (h *GoogleMeetHandler) buildCanceledRedirect() string {
	return h.buildStatusRedirect("cancelled")
}

func (h *GoogleMeetHandler) buildStatusRedirect(status string) string {
	base := h.postConnectURL
	if base == "" {
		base = "/settings"
	}
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
	}
	q := url.Values{}
	q.Set("tab", "integrations")
	q.Set("status", status)
	return base + sep + q.Encode()
}

// requireMeetOwnerTenant enforces the two shared invariants of Authorize +
// Disconnect: tenant context present + path{id} == tc.CenterID. Mirrors
// requireSettingsTenant from settings_handler.go so the two feature families
// stay in lockstep on the belt-check pattern (Winston-S3 fold).
func requireMeetOwnerTenant(r *http.Request) (model.TenantContext, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return model.TenantContext{}, ErrTenantContextMissing
	}
	pathID := r.PathValue("id")
	if pathID == "" || pathID != tc.CenterID {
		return model.TenantContext{}, &service.TenantMismatchError{
			PathCenterID:    pathID,
			ContextCenterID: tc.CenterID,
		}
	}
	return tc, nil
}
