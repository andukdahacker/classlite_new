package middleware

import (
	"errors"
	"log/slog"
	"net/http"
	"runtime/debug"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/model"
)

// HandlerWithError is a handler that returns an error for the error mapper to process.
type HandlerWithError func(w http.ResponseWriter, r *http.Request) error

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
