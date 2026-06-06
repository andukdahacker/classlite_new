// Package service — JWT signer/verifier for Story 1.5.
//
// HS256 is the only accepted algorithm. The library default permits any
// algorithm the keyFn returns a key for, so jwt.WithValidMethods locks the
// parser to HS256 — defense against the classic "alg=none" and
// algorithm-substitution attacks (HS256 token verified with RS256 public
// key, etc.). See AC15 for the key-length validation done at startup.
//
// Clock injection is mandatory: every time-sensitive claim (`exp`, `iat`)
// is driven by the injected clock so tests can advance MockClock and watch
// expiry behavior deterministically.
package service

import (
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// AccessClaims is the application portion of the JWT payload. CenterID and
// Role are omitempty in the JWT but absent fields are simply not populated
// — service consumers always check `claims.CenterID != ""` before trusting.
type AccessClaims struct {
	UserID   string `json:"user_id"`
	CenterID string `json:"center_id,omitempty"`
	Role     string `json:"role,omitempty"`
}

// JWTSigner is the dependency seam used by AuthService.Login + middleware
// .ExtractTenant. Implementations MUST sign with HS256 and reject any other
// algorithm on verify.
type JWTSigner interface {
	// SignAccess returns a signed JWT carrying the given application claims
	// plus iat=now() / exp=now()+ttlSeconds (driven by the injected clock).
	SignAccess(claims AccessClaims, ttlSeconds int) (string, error)

	// VerifyAccess parses + validates a token. Returns ErrJWTExpired when
	// the token's exp has elapsed (driven by injected clock), or a generic
	// non-typed error for any other validation failure (bad signature, bad
	// algorithm, malformed). Callers map both to 401.
	VerifyAccess(token string) (*AccessClaims, error)
}

// ErrJWTExpired is returned by VerifyAccess when the token's exp has
// elapsed. Distinguishable from other parse failures so middleware can
// emit different audit events (re-auth vs. forged-token attempt).
var ErrJWTExpired = errors.New("jwt: token expired")

// hmacJWTSigner is the production JWTSigner backed by HS256.
type hmacJWTSigner struct {
	secret []byte
	clock  clock.Clock
}

// NewJWTSigner constructs a production signer using clock.RealClock. The
// secret must be ≥ 32 bytes for HS256 strength per AC15; the caller (main
// or config.Validate) is responsible for that check.
func NewJWTSigner(secret []byte) JWTSigner {
	return NewJWTSignerWithClock(secret, clock.RealClock{})
}

// NewJWTSignerWithClock is the dependency-injected variant used by tests.
func NewJWTSignerWithClock(secret []byte, c clock.Clock) JWTSigner {
	if c == nil {
		c = clock.RealClock{}
	}
	return &hmacJWTSigner{secret: secret, clock: c}
}

// jwtClaims is the wire payload — RegisteredClaims handles iat/exp;
// AccessClaims fields are spread alongside via json tags.
type jwtClaims struct {
	AccessClaims
	jwt.RegisteredClaims
}

func (s *hmacJWTSigner) SignAccess(claims AccessClaims, ttlSeconds int) (string, error) {
	now := s.clock.Now()
	// Why jti: under MockClock, two SignAccess calls at the same simulated
	// timestamp would otherwise produce byte-identical JWTs and confuse
	// rotation tests. A fresh UUID per call uniquifies the token without
	// changing claim semantics.
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwtClaims{
		AccessClaims: claims,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        uuid.NewString(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Duration(ttlSeconds) * time.Second)),
		},
	})
	signed, err := tok.SignedString(s.secret)
	if err != nil {
		return "", fmt.Errorf("jwt sign: %w", err)
	}
	return signed, nil
}

func (s *hmacJWTSigner) VerifyAccess(raw string) (*AccessClaims, error) {
	parsed, err := jwt.ParseWithClaims(
		raw,
		&jwtClaims{},
		func(token *jwt.Token) (interface{}, error) {
			// jwt.WithValidMethods below blocks non-HS256 algorithms before
			// the keyFn runs; the type assertion here is defense in depth.
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("jwt: unexpected signing method %v", token.Header["alg"])
			}
			return s.secret, nil
		},
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		// Drive expiry checking with the injected clock so tests can
		// fast-forward MockClock and exercise the AUTH_USER_GONE / expired
		// branches without sleeping.
		jwt.WithTimeFunc(s.clock.Now),
	)
	if err != nil {
		// jwt/v5 returns wrapped errors; expiration is the only case we
		// surface as a typed sentinel.
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrJWTExpired
		}
		return nil, fmt.Errorf("jwt verify: %w", err)
	}
	if !parsed.Valid {
		return nil, errors.New("jwt: invalid token")
	}
	claims, ok := parsed.Claims.(*jwtClaims)
	if !ok {
		return nil, errors.New("jwt: claims type mismatch")
	}
	// why explicit exp / user_id check: jwt/v5 only validates exp when the
	// claim is present. A token missing `exp` entirely would otherwise be
	// accepted as "permanently valid". A token missing `user_id` would
	// produce a TenantContext with an empty UserID downstream. Both must
	// be rejected at the verify boundary.
	if claims.ExpiresAt == nil {
		return nil, errors.New("jwt: missing exp claim")
	}
	if claims.UserID == "" {
		return nil, errors.New("jwt: missing user_id claim")
	}
	out := claims.AccessClaims
	return &out, nil
}
