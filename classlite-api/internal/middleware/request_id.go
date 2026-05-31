package middleware

import (
	"context"
	"net/http"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/google/uuid"
)

// RequestID generates a unique request ID for each request, injects it into
// the context, sets the X-Request-ID response header, and logs the request.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.New().String()
		ctx := context.WithValue(r.Context(), model.RequestID, id)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
