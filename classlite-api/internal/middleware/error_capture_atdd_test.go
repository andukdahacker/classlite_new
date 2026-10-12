// Story 11-0a (AC2/AC3 · the funnel WIRING) — proves ErrorMapper actually
// routes the UNEXPECTED paths (panic + unhandled/500 default arm) to Sentry
// capture, and does NOT capture the MAPPED 4xx arms (a 403 is not an incident;
// capturing them would drown the signal — DD1).
//
// package middleware_test — mirrors error_mapper_test.go (same external pkg,
// same errorEnvelope/request-id idiom).
//
// GREEN (tag stripped 2026-10-10): the observability package exists and the two
// capture calls are wired into error_mapper.go:
//
//	panic arm:            observability.CapturePanic(WithHTTPTags(r.Context(),…), rec, stack)
//	default/unhandled arm: observability.CaptureError(WithHTTPTags(r.Context(),…), err)
//	4xx arms (NotFound/Forbidden/Validation/Conflict/Gone): NO capture call (AC3).
//
// The mock transport implements the full v0.50.0 sentry.Transport interface
// (Flush/FlushWithContext/Configure/SendEvent/Close).
package middleware_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/observability"
	"github.com/getsentry/sentry-go"
)

type captureTransport struct{ events []*sentry.Event }

func (c *captureTransport) Configure(_ sentry.ClientOptions)        {}
func (c *captureTransport) SendEvent(e *sentry.Event)               { c.events = append(c.events, e) }
func (c *captureTransport) Flush(_ time.Duration) bool              { return true }
func (c *captureTransport) FlushWithContext(_ context.Context) bool { return true }
func (c *captureTransport) Close()                                  {}

func newCaptureClient(t *testing.T) *captureTransport {
	t.Helper()
	tr := &captureTransport{}
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:        "https://public@example.test/1",
		Transport:  tr,
		BeforeSend: observability.ScrubEvent,
	}); err != nil {
		t.Fatalf("sentry.Init: %v", err)
	}
	t.Cleanup(func() { sentry.Flush(time.Second) })
	return tr
}

// reqWithTelemetry carries both the request_id and a resolved TenantContext,
// as the real middleware chain would by the time a handler runs.
func reqWithTelemetry() *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/api/thing", nil)
	ctx := context.WithValue(req.Context(), model.RequestID, "req-err-999")
	ctx = model.WithTenantContext(ctx, model.TenantContext{
		CenterID: "center-1", UserID: "user-1", Role: "teacher",
	})
	return req.WithContext(ctx)
}

// AC2 — a panic through ErrorMapper is captured with the request_id tag.
func TestErrorCapture_AC2_Panic_IsCapturedWithRequestID(t *testing.T) {
	tr := newCaptureClient(t)

	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		panic("kaboom")
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithTelemetry())

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 after panic, got %d", rec.Code)
	}
	sentry.Flush(time.Second)
	if len(tr.events) != 1 {
		t.Fatalf("panic should capture exactly 1 event, got %d", len(tr.events))
	}
	if tr.events[0].Tags["request_id"] != "req-err-999" {
		t.Errorf("captured panic missing request_id tag: %v", tr.events[0].Tags)
	}
}

// AC2 — an unmapped (unexpected) error through the default arm is captured.
func TestErrorCapture_AC2_UnhandledError_IsCaptured(t *testing.T) {
	tr := newCaptureClient(t)

	h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
		return errors.New("some unexpected failure")
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, reqWithTelemetry())

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("expected 500 for unmapped error, got %d", rec.Code)
	}
	sentry.Flush(time.Second)
	if len(tr.events) != 1 {
		t.Fatalf("unhandled error should capture 1 event, got %d", len(tr.events))
	}
}

// AC3 — mapped business errors (4xx) are NOT captured.
func TestErrorCapture_AC3_MappedErrors_AreNotCaptured(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"forbidden", model.ForbiddenError{Reason: "not a member"}, http.StatusForbidden},
		{"notfound", model.NotFoundError{Resource: "student", ID: "abc"}, http.StatusNotFound},
		{"validation", model.ValidationError{Fields: []model.FieldError{{Field: "name", Message: "required"}}}, http.StatusUnprocessableEntity},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tr := newCaptureClient(t)
			h := middleware.ErrorMapper(func(w http.ResponseWriter, r *http.Request) error {
				return tc.err
			})
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, reqWithTelemetry())

			if rec.Code != tc.code {
				t.Errorf("expected %d, got %d", tc.code, rec.Code)
			}
			sentry.Flush(time.Second)
			if len(tr.events) != 0 {
				t.Errorf("mapped %s must NOT be captured, got %d events", tc.name, len(tr.events))
			}
		})
	}
}
