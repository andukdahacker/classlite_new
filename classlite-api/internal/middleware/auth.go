// Package middleware — Story 1.5 ExtractTenant (AC14, AC16).
//
// Responsibilities (in order):
//  1. Parse Authorization: Bearer <token>. Missing → 401.
//  2. Verify JWT via the injected signer. Invalid (forged / expired) → 401.
//  3. Look up user by claim. Deleted → 401 AUTH_USER_GONE.
//  4. If a center_id claim is present, look up the membership row. Missing
//     or revoked → 403 INVALID_TENANT_CLAIM + audit row.
//  5. Inject model.TenantContext into the request context for downstream
//     handlers and pass through.
//
// This middleware is NOT applied to Story 1.5 auth endpoints (login, refresh,
// logout, forgot-password, reset-password are all public). Epic 2+ stories
// wire it onto authenticated routes.
package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ExtractTenant is the factory. db must satisfy service.AuthDB so the
// middleware can run sqlc queries directly without re-implementing them.
// jwt is the verifier — production uses the same signer instance wired into
// AuthService so signing-key drift cannot happen.
func ExtractTenant(db service.AuthDB, jwt service.JWTSigner) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			auth := r.Header.Get("Authorization")
			// RFC 6750 §2.1 SHOULD allow case-insensitive scheme matching;
			// some client libraries lowercase the scheme. EqualFold checks
			// the first 7 chars without allocating.
			if len(auth) < 8 || !strings.EqualFold(auth[:7], "Bearer ") {
				writeMiddlewareJSON(w, r, http.StatusUnauthorized, "AUTH_REQUIRED", "Authentication required.")
				return
			}
			raw := strings.TrimSpace(auth[7:])
			claims, err := jwt.VerifyAccess(raw)
			if err != nil {
				writeMiddlewareJSON(w, r, http.StatusUnauthorized, "AUTH_INVALID", "Authentication failed.")
				return
			}
			userUUID, err := uuid.Parse(claims.UserID)
			if err != nil {
				writeMiddlewareJSON(w, r, http.StatusUnauthorized, "AUTH_INVALID", "Authentication failed.")
				return
			}
			q := generated.New(db)
			if _, err := q.GetUserByID(r.Context(), pgtype.UUID{Bytes: userUUID, Valid: true}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					writeMiddlewareJSON(w, r, http.StatusUnauthorized, "AUTH_USER_GONE", "Authentication failed.")
					return
				}
				writeMiddlewareJSON(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
				return
			}
			// dbRole is set from the membership row when a center claim is
			// present. We trust the DB role over the JWT role so demotions
			// take effect on the next request (the JWT claim can be up to
			// AccessTokenTTL stale per EDGE-2).
			dbRole := claims.Role
			if claims.CenterID != "" {
				centerUUID, parseErr := uuid.Parse(claims.CenterID)
				if parseErr != nil {
					writeInvalidTenantClaim(db, w, r, userUUID)
					return
				}
				member, err := q.GetCenterMemberByUserAndCenter(r.Context(), generated.GetCenterMemberByUserAndCenterParams{
					UserID:   pgtype.UUID{Bytes: userUUID, Valid: true},
					CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
				})
				switch {
				case err == nil:
					dbRole = member.Role
				case errors.Is(err, pgx.ErrNoRows):
					// Genuine missing membership → 403 + audit row.
					writeInvalidTenantClaim(db, w, r, userUUID)
					return
				default:
					// Transient DB error (pool exhausted, query timeout):
					// surface 500 WITHOUT writing the invalid_tenant_claim
					// audit row — a flaky DB read shouldn't pollute the
					// forensic trail with a "stale claim" event.
					writeMiddlewareJSON(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
					return
				}
			}
			tc := model.TenantContext{
				CenterID: claims.CenterID,
				UserID:   claims.UserID,
				Role:     dbRole,
			}
			ctx := context.WithValue(r.Context(), tenantContextKey{}, tc)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// TenantFromContext extracts the model.TenantContext injected by
// ExtractTenant. Returns (zero, false) when no context was set.
func TenantFromContext(ctx context.Context) (model.TenantContext, bool) {
	tc, ok := ctx.Value(tenantContextKey{}).(model.TenantContext)
	return tc, ok
}

type tenantContextKey struct{}

func writeMiddlewareJSON(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	requestID, _ := r.Context().Value(model.RequestID).(string)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]any{
			"code":      code,
			"message":   message,
			"requestId": requestID,
			"details":   nil,
		},
	})
}

// writeInvalidTenantClaim emits the 403 response AND writes an
// auth_audit_logs row keyed on the JWT's user_id. Audit failure is logged
// via slog only; the rejection still happens (R4 invariant).
func writeInvalidTenantClaim(db service.AuthDB, w http.ResponseWriter, r *http.Request, userUUID uuid.UUID) {
	logger := service.NewPgAuthAuditLogger(db)
	_ = logger.Log(context.WithoutCancel(r.Context()), service.AuthAuditEntry{
		UserID:     userUUID,
		Event:      "invalid_tenant_claim",
		EntityType: "session",
		EntityID:   userUUID,
		Changes:    service.Changes{After: map[string]any{"reason": "no_membership"}},
	})
	writeMiddlewareJSON(w, r, http.StatusForbidden, "INVALID_TENANT_CLAIM",
		"JWT center claim does not match active membership.")
}
