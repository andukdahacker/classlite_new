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
	"github.com/ducdo/classlite-api/internal/store"
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
			user, err := q.GetUserByID(r.Context(), pgtype.UUID{Bytes: userUUID, Valid: true})
			if err != nil {
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
				// Open a tx + SET LOCAL app.current_tenant_id so RLS on
				// center_members permits the membership read. Without this,
				// the read runs under the pool's empty tenant context and
				// RLS filters out every row — every authenticated request
				// with a CenterID claim would fail with INVALID_TENANT_CLAIM
				// (mirrors the AdminInviteStaff pattern in auth_admin.go).
				tx, err := db.Begin(r.Context())
				if err != nil {
					writeMiddlewareJSON(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
					return
				}
				// R2-P5 fix: swap raw SELECT set_config to the canonical
				// store.SetTenantContext helper for consistency with the rest
				// of the codebase. The helper re-validates the UUID (already
				// parsed successfully above, so no new failure surface).
				if err := store.SetTenantContext(r.Context(), tx, model.TenantContext{CenterID: centerUUID.String()}); err != nil {
					_ = tx.Rollback(context.WithoutCancel(r.Context()))
					writeMiddlewareJSON(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.")
					return
				}
				txQ := generated.New(tx)
				member, err := txQ.GetCenterMemberByUserAndCenter(r.Context(), generated.GetCenterMemberByUserAndCenterParams{
					UserID:   pgtype.UUID{Bytes: userUUID, Valid: true},
					CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
				})
				_ = tx.Rollback(context.WithoutCancel(r.Context()))
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
				CenterID:      claims.CenterID,
				UserID:        claims.UserID,
				Role:          dbRole,
				EmailVerified: user.EmailVerified,
			}
			next.ServeHTTP(w, r.WithContext(model.WithTenantContext(r.Context(), tc)))
		})
	}
}

// TenantFromContext is the in-package re-export of
// model.TenantFromContext kept for backward-compat with Story 1.5
// callsites. New code should call model.TenantFromContext directly.
func TenantFromContext(ctx context.Context) (model.TenantContext, bool) {
	return model.TenantFromContext(ctx)
}

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
