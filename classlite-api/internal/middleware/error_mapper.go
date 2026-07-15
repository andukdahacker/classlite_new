package middleware

import (
	"errors"
	"log/slog"
	"math"
	"net/http"
	"runtime/debug"
	"strconv"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

// HandlerWithError is a handler that returns an error for the error mapper to process.
type HandlerWithError func(w http.ResponseWriter, r *http.Request) error

// Story 1.6 — typed details payloads echoed in the error envelope so the
// frontend can render UX recovery without re-fetching the invite row.
// Names follow the API camelCase convention (CQ wire format rules).
type inviteExpiredDetails struct {
	CenterName   string `json:"centerName"`
	InviterEmail string `json:"inviterEmail"`
}

type inviteAlreadyAcceptedDetails struct {
	CenterName string `json:"centerName"`
}

type inviteEmailMismatchDetails struct {
	InvitedEmail string `json:"invitedEmail"`
	OAuthEmail   string `json:"oauthEmail"`
}

// ErrorMapper wraps a HandlerWithError, mapping domain errors to HTTP responses.
// It also recovers from panics and returns 500 without leaking internals.
func ErrorMapper(h HandlerWithError) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				requestID, _ := r.Context().Value(model.RequestID).(string)
				slog.Error("panic recovered",
					"panic", rec,
					"stack", string(debug.Stack()),
					"request_id", requestID,
				)
				handler.WriteError(w, r, http.StatusInternalServerError,
					"INTERNAL_ERROR", "An unexpected error occurred.", nil)
			}
		}()

		err := h(w, r)
		if err == nil {
			return
		}

		requestID, _ := r.Context().Value(model.RequestID).(string)

		// Story 1.5 pointer-typed service errors (checked BEFORE the legacy
		// value-typed model errors because errors.As walks the chain in
		// order; matching the pointer form first keeps the mapper from
		// accidentally landing on a structurally-compatible value type).
		var invalidCreds *service.InvalidCredentialsError
		var accountLocked *service.AccountLockedError
		var tokenReuse *service.TokenReuseDetectedError
		var resetConsumed *service.ResetTokenConsumedError
		var forbiddenSvc *service.ForbiddenError
		var refreshInvalid *service.RefreshTokenInvalidError
		var userGone *service.AuthUserGoneError
		var invalidTenant *service.InvalidTenantClaimError
		// Story 1.6 invite-acceptance pointer-typed errors (REST path).
		// OAuth callback errors are mapped to 302 redirects at the
		// handler level, NOT here.
		var inviteNotFound *service.InviteNotFoundError
		var inviteExpired *service.InviteExpiredError
		var inviteAlreadyAccepted *service.InviteAlreadyAcceptedError
		var inviteEmailMismatch *service.InviteEmailMismatchError
		var passwordNotAllowedOAuth *service.PasswordNotAllowedForOAuthUserError
		var googleIDAlreadyLinked *service.GoogleIDAlreadyLinkedError
		// Story 2-5a settings errors.
		var unsupportedTimezone *service.UnsupportedTimezoneError
		var tenantMismatch *service.TenantMismatchError
		var payloadTooLarge *service.PayloadTooLargeError
		// Story 2-5b settings taxonomy errors.
		var roomNameTaken *service.RoomNameTakenError

		switch {
		case errors.As(err, &invalidCreds):
			handler.WriteError(w, r, http.StatusUnauthorized,
				"INVALID_CREDENTIALS", "Email or password is incorrect.", nil)
			return
		case errors.As(err, &accountLocked):
			seconds := int(math.Ceil(accountLocked.RetryAfter.Seconds()))
			if seconds < 1 {
				seconds = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(seconds))
			minutes := int(math.Ceil(accountLocked.RetryAfter.Minutes()))
			if minutes < 1 {
				minutes = 1
			}
			msg := "Too many failed attempts. Try again in " + strconv.Itoa(minutes) + " minute(s)."
			handler.WriteError(w, r, http.StatusTooManyRequests,
				"ACCOUNT_LOCKED", msg, nil)
			return
		case errors.As(err, &tokenReuse):
			handler.WriteError(w, r, http.StatusUnauthorized,
				"REFRESH_TOKEN_REUSE_DETECTED", "Your session has been signed out for security.", nil)
			return
		case errors.As(err, &resetConsumed):
			handler.WriteError(w, r, http.StatusConflict,
				"RESET_TOKEN_CONSUMED", "This password reset link has already been used.", nil)
			return
		case errors.As(err, &forbiddenSvc):
			code := "FORBIDDEN"
			if forbiddenSvc.Reason == "insufficient role" {
				code = "INSUFFICIENT_ROLE"
			}
			handler.WriteError(w, r, http.StatusForbidden,
				code, forbiddenSvc.Error(), nil)
			return
		case errors.As(err, &refreshInvalid):
			handler.WriteError(w, r, http.StatusUnauthorized,
				"REFRESH_TOKEN_INVALID", "Refresh token invalid.", nil)
			return
		case errors.As(err, &userGone):
			handler.WriteError(w, r, http.StatusUnauthorized,
				"AUTH_USER_GONE", "Authentication failed.", nil)
			return
		case errors.As(err, &invalidTenant):
			handler.WriteError(w, r, http.StatusForbidden,
				"INVALID_TENANT_CLAIM", "JWT center claim does not match active membership.", nil)
			return
		case errors.As(err, &inviteNotFound):
			handler.WriteError(w, r, http.StatusNotFound,
				"INVITE_NOT_FOUND", "This invite link is no longer valid.", nil)
			return
		case errors.As(err, &inviteExpired):
			handler.WriteError(w, r, http.StatusGone,
				"INVITE_EXPIRED", "This invite link has expired.",
				inviteExpiredDetails{
					CenterName:   inviteExpired.CenterName,
					InviterEmail: inviteExpired.InviterEmail,
				})
			return
		case errors.As(err, &inviteAlreadyAccepted):
			handler.WriteError(w, r, http.StatusConflict,
				"INVITE_ALREADY_ACCEPTED", "This invite has already been accepted.",
				inviteAlreadyAcceptedDetails{CenterName: inviteAlreadyAccepted.CenterName})
			return
		case errors.As(err, &inviteEmailMismatch):
			handler.WriteError(w, r, http.StatusConflict,
				"INVITE_EMAIL_MISMATCH", "Invite email does not match signed-in account.",
				inviteEmailMismatchDetails{
					InvitedEmail: inviteEmailMismatch.InvitedEmail,
					OAuthEmail:   inviteEmailMismatch.OAuthEmail,
				})
			return
		case errors.As(err, &passwordNotAllowedOAuth):
			handler.WriteError(w, r, http.StatusConflict,
				"PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER",
				"This account uses Google sign-in. Continue with Google to accept the invite.", nil)
			return
		case errors.As(err, &googleIDAlreadyLinked):
			handler.WriteError(w, r, http.StatusConflict,
				"GOOGLE_ID_ALREADY_LINKED",
				"Google account is already linked to another user.", nil)
			return
		case errors.As(err, &unsupportedTimezone):
			handler.WriteError(w, r, http.StatusUnprocessableEntity,
				"UNSUPPORTED_TIMEZONE", unsupportedTimezone.Error(), nil)
			return
		case errors.As(err, &tenantMismatch):
			handler.WriteError(w, r, http.StatusForbidden,
				"TENANT_MISMATCH", tenantMismatch.Error(), nil)
			return
		case errors.As(err, &payloadTooLarge):
			handler.WriteError(w, r, http.StatusRequestEntityTooLarge,
				"PAYLOAD_TOO_LARGE", payloadTooLarge.Error(), nil)
			return
		case errors.As(err, &roomNameTaken):
			// Story 2-5b AC6 — surface as inline field error on `name`, not toast.
			handler.WriteError(w, r, http.StatusConflict,
				"ROOM_NAME_TAKEN",
				"A room with this name already exists in this center.",
				[]model.FieldError{{Field: "name", Message: "room name must be unique (case-insensitive)"}})
			return
		}

		// Legacy model.* value-typed errors (Story 1.2–1.4).
		var notFound model.NotFoundError
		var forbidden model.ForbiddenError
		var validation model.ValidationError
		var conflict model.ConflictError
		var gone model.GoneError

		switch {
		case errors.As(err, &notFound):
			code := notFound.Code
			if code == "" {
				code = "NOT_FOUND"
			}
			handler.WriteError(w, r, http.StatusNotFound,
				code, notFound.Error(), nil)
		case errors.As(err, &forbidden):
			handler.WriteError(w, r, http.StatusForbidden,
				"FORBIDDEN", forbidden.Error(), nil)
		case errors.As(err, &validation):
			fields := validation.Fields
			if fields == nil {
				fields = []model.FieldError{}
			}
			handler.WriteError(w, r, http.StatusUnprocessableEntity,
				"VALIDATION_ERROR", "Validation failed.", fields)
		case errors.As(err, &conflict):
			code := conflict.Code
			if code == "" {
				code = "CONFLICT"
			}
			handler.WriteError(w, r, http.StatusConflict,
				code, conflict.Error(), nil)
		case errors.As(err, &gone):
			handler.WriteError(w, r, http.StatusGone,
				gone.Code, gone.Reason, nil)
		default:
			slog.Error("unhandled error",
				"error", err,
				"request_id", requestID,
			)
			handler.WriteError(w, r, http.StatusInternalServerError,
				"INTERNAL_ERROR", "An unexpected error occurred.", nil)
		}
	}
}
