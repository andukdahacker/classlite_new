// Package service — Story 1.6 OAuth state HMAC signer.
//
// The signer produces a self-contained token that the API emits as the
// `oauth_state` cookie (and, identically, as the `state` query param to
// Google) at /api/auth/google. On callback, the API verifies the cookie
// and the state query param match each other byte-for-byte (double-submit
// cookie pattern) AND that the HMAC verifies (defense against XSS readers
// who can't re-sign payloads) AND that the issued_at is within the 10-min
// TTL (defense against link aging / replay).
//
// Format: base64url(json_payload) + "." + base64url(hmac256(payload))
// — both halves use RawURLEncoding (no padding) so the token is safe in
// query strings without further escaping.
//
// Why a separate secret from JWT_SECRET: rotation policies differ. A
// leaked JWT signing key compromises 15-min auth tokens. A leaked OAuth
// state secret only compromises the 10-min CSRF window. Sharing them
// tangles their rotation policies — splitting them lets ops rotate
// independently in response to incidents.
package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

// OAuthStateTTL is the maximum age the state payload stays valid. After
// this the callback rejects with *OAuthStateExpiredError regardless of
// HMAC validity.
const OAuthStateTTL = 10 * time.Minute

// OAuthStateMinSecretBytes is the HMAC-SHA256 minimum keylength per RFC 2104.
// Config validation rejects shorter secrets in non-dev (AC9).
const OAuthStateMinSecretBytes = 32

// OAuthStatePayload is the JSON-marshalled inner shape of the signed
// state token. InviteTokenHash + RedirectTo are optional — empty strings
// are dropped from the persisted JSON via the omitempty tag.
//
// IssuedAt is unix-seconds since epoch (matches JWT exp encoding) so
// payloads are deterministic under MockClock (no monotonic clock
// component to vary).
//
// Story 2.5c — CenterID + UserID are OPTIONAL and populated ONLY for the
// per-center Google Meet OAuth flow. Login flow (auth_google.go) leaves
// them empty so existing signed tokens continue to verify identically.
// Meet callback enforces a triple binding: payload.CenterID == path{id} ==
// tc.CenterID AND payload.UserID == tc.UserID — any mismatch → 403
// OAUTH_STATE_MISMATCH (see google_meet.go HandleCallback per AC7).
type OAuthStatePayload struct {
	Nonce           string `json:"nonce"`
	InviteTokenHash string `json:"inviteTokenHash,omitempty"`
	RedirectTo      string `json:"redirectTo,omitempty"`
	IssuedAt        int64  `json:"issuedAt"`
	// CenterID (UUID string) is set by the Meet OAuth authorize handler
	// so the callback can prove the state was issued for THIS center.
	CenterID string `json:"centerId,omitempty"`
	// UserID (UUID string) is set by the Meet OAuth authorize handler
	// so the callback can prove the state was issued for THIS user (fresh
	// session — force-logout-between-authorize-and-callback defense).
	UserID string `json:"userId,omitempty"`
}

// OAuthStateSigner is the dependency seam AuthService consumes. Production
// uses hmacOAuthStateSigner; tests construct one with their MockClock.
type OAuthStateSigner interface {
	Sign(p OAuthStatePayload) (string, error)
	Verify(token string) (*OAuthStatePayload, error)
}

type hmacOAuthStateSigner struct {
	secret []byte
	clock  clock.Clock
}

// NewOAuthStateSigner returns a production signer backed by the wall
// clock. Production main.go calls this after Config.Validate has
// confirmed OAUTH_STATE_SECRET ≥ 32 bytes.
func NewOAuthStateSigner(secret []byte) OAuthStateSigner {
	return NewOAuthStateSignerWithClock(secret, clock.RealClock{})
}

// NewOAuthStateSignerWithClock injects a Clock so tests can advance time
// past the TTL deterministically.
func NewOAuthStateSignerWithClock(secret []byte, c clock.Clock) OAuthStateSigner {
	if c == nil {
		c = clock.RealClock{}
	}
	dup := make([]byte, len(secret))
	copy(dup, secret)
	return &hmacOAuthStateSigner{secret: dup, clock: c}
}

func (s *hmacOAuthStateSigner) Sign(p OAuthStatePayload) (string, error) {
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	bodyB64 := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(bodyB64))
	sig := mac.Sum(nil)
	sigB64 := base64.RawURLEncoding.EncodeToString(sig)
	return bodyB64 + "." + sigB64, nil
}

func (s *hmacOAuthStateSigner) Verify(token string) (*OAuthStatePayload, error) {
	// Why a single error type for malformed inputs: callers must not be
	// able to differentiate "no separator" vs "bad base64" vs "wrong
	// signature" — that would give a probing attacker a side channel.
	parts := strings.SplitN(token, ".", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return nil, &OAuthStateInvalidError{}
	}

	expectedSig, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, &OAuthStateInvalidError{}
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(parts[0]))
	computedSig := mac.Sum(nil)
	// Why subtle.ConstantTimeCompare: hmac verification with bytes.Equal
	// (or ==) exposes a timing oracle on the leading-bytes comparison.
	// subtle.ConstantTimeCompare runs in constant time regardless of
	// where the first mismatched byte sits.
	if subtle.ConstantTimeCompare(expectedSig, computedSig) != 1 {
		return nil, &OAuthStateInvalidError{}
	}

	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, &OAuthStateInvalidError{}
	}
	var p OAuthStatePayload
	if err := json.Unmarshal(body, &p); err != nil {
		return nil, &OAuthStateInvalidError{}
	}

	// AC9: TTL check. IssuedAt + TTL >= now → still valid (inclusive
	// equality at the exact second boundary, matching the godoc claim
	// "10 min" rather than 9m59s).
	expiresAt := time.Unix(p.IssuedAt, 0).Add(OAuthStateTTL)
	if s.clock.Now().After(expiresAt) {
		return nil, &OAuthStateExpiredError{}
	}

	return &p, nil
}
