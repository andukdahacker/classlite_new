// Package observability wires backend error tracking (Sentry) onto the
// substrate the architecture promised "from day one" but never activated:
// request_id generation (middleware.RequestID), per-request tenant context
// (model.TenantContext), the single HTTP error funnel (middleware.ErrorMapper),
// and the worker funnels (worker.Dispatcher). It is cross-cutting infra — a
// peer of internal/logging, importable from any layer (GO-3) — not a
// Store/Service/Handler tier.
//
// Story 11-0a. The security contract (R-11-6, the WF-8 hard gate): student
// submission text, grades, Gemini prompt content, cookies, Authorization, and
// the Gemini API key must NEVER reach Sentry. ScrubEvent is the single
// enforcement point and takes an ALLOWLIST posture — only an operator-safe tag
// set survives; all free-form request/error payloads are dropped. Triage detail
// lives in request-scoped stdout logs, joinable by the request_id TAG (DD6).
package observability

import (
	"context"
	"fmt"
	"reflect"
	"strconv"
	"time"

	"github.com/ducdo/classlite-api/internal/config"
	"github.com/ducdo/classlite-api/internal/logging"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/getsentry/sentry-go"
)

// tracesSampleRate is a deliberately low performance-trace sample (CQ-3 — named,
// not a magic literal). 11-0a is about error capture, not tracing throughput; a
// 10% sample keeps transaction volume (and cost) negligible while leaving the
// door open for later tuning (Out of Scope: performance tuning).
const tracesSampleRate = 0.1

// FlushTimeout bounds how long graceful shutdown waits for the async transport
// to drain buffered events before the process exits (AC6). Kept short so a
// deploy is not stalled by a slow Sentry endpoint; buffered events beyond this
// window are dropped rather than blocking the restart.
const FlushTimeout = 2 * time.Second

// allowedTags is the operator-safe allowlist (DD3). Only these tag keys survive
// ScrubEvent — everything else on an event is dropped. request_id/center_id/
// user_id are UUIDs an operator needs to correlate; route/method/status are
// non-sensitive request shape. None of them is student PII.
var allowedTags = map[string]struct{}{
	"request_id": {},
	"center_id":  {},
	"user_id":    {},
	"route":      {},
	"method":     {},
	"status":     {},
	// error_type is the Go type name of the captured error (e.g. *fmt.wrapError);
	// reason is a stable operator-chosen label (e.g. invalid_ai_response). Both are
	// non-PII and both feed issue grouping (applyGrouping) so a blanked exception
	// value no longer collapses distinct incidents into one empty-titled issue.
	"error_type": {},
	"reason":     {},
}

// httpTagsKey is the context key carrying operator-safe HTTP request tags from
// the error funnel to the capture helpers. Unexported typed key (GFW-4).
type httpTagsKey struct{}

type httpTags struct {
	method string
	route  string
	status int
}

// WithHTTPTags stashes the operator-safe request shape (method, matched route
// template, status) in ctx so CaptureError / CapturePanic can tag it (DD2). The
// route is the ServeMux pattern (e.g. "GET /api/students/{id}"), never the raw
// path — a raw path can embed ids; a pattern cannot. Worker captures simply
// omit this, so their events carry no HTTP tags.
func WithHTTPTags(ctx context.Context, method, route string, status int) context.Context {
	return context.WithValue(ctx, httpTagsKey{}, httpTags{method: method, route: route, status: status})
}

// reasonKey carries a stable, operator-safe failure label (e.g. a worker terminal
// reason) from a capture call site to the tag/grouping helpers. Unexported typed
// key (GFW-4).
type reasonKey struct{}

// WithReason stashes an operator-safe reason label in ctx so CaptureError tags it
// (reason) and folds it into the fingerprint. The caller is responsible for the
// label being non-PII — it is a fixed enum/sentinel (e.g. invalid_ai_response),
// never free-form content.
func WithReason(ctx context.Context, reason string) context.Context {
	return context.WithValue(ctx, reasonKey{}, reason)
}

// Init wraps sentry.Init. An empty DSN returns a non-nil no-op flush and a nil
// error (DD4): dev/local and the full test suite stay green without a DSN, and
// the server never fails-fast on a missing or bad DSN — an API serving without
// telemetry beats an API not serving. On a valid DSN it configures
// Environment = cfg.AppEnv, Release = cfg.ReleaseSHA (when set), the low
// tracesSampleRate, and BeforeSend = ScrubEvent. No session replay is
// configured — the backend has no replay surface, and replay stays OFF
// everywhere per the Epic 11 ruling (DD5).
func Init(cfg config.Config) (func(context.Context), error) {
	noop := func(context.Context) {}
	if cfg.SentryDSN == "" {
		return noop, nil
	}
	err := sentry.Init(sentry.ClientOptions{
		Dsn:              cfg.SentryDSN,
		Environment:      cfg.AppEnv,
		Release:          cfg.ReleaseSHA,
		TracesSampleRate: tracesSampleRate,
		BeforeSend:       ScrubEvent,
		// Transaction/span events run through BeforeSendTransaction, NOT BeforeSend,
		// so the error scrubber alone would let a sampled transaction ship an
		// unscrubbed request URL or span description. Route transactions through the
		// same allowlist (which also nulls event.Spans) so no tracing surface can
		// egress PII — even though no transaction source is wired in 11-0a (R-11-6).
		BeforeSendTransaction: ScrubEvent,
	})
	if err != nil {
		return noop, err
	}
	flush := func(ctx context.Context) {
		timeout := FlushTimeout
		if deadline, ok := ctx.Deadline(); ok {
			remaining := time.Until(deadline)
			switch {
			case remaining <= 0:
				// Shutdown budget already spent — Flush(0) returns immediately instead
				// of blocking process exit up to FlushTimeout past the deadline.
				timeout = 0
			case remaining < timeout:
				timeout = remaining
			}
		}
		sentry.Flush(timeout)
	}
	return flush, nil
}

// ScrubEvent is the BeforeSend hook and the sole R-11-6 enforcement point (AC4).
// It takes an ALLOWLIST posture (DD3): anything that could carry student
// submission text, grades, Gemini prompt content, secrets, or PII is dropped
// outright, because a denylist loses the first time someone adds a field that
// carries an essay body.
//
//   - event.Request (body, cookies, Authorization/Cookie headers) → dropped.
//   - event.Contexts / Breadcrumbs / User → dropped (none operator-safe; Contexts
//     is the sentry-go carrier for arbitrary attached data).
//   - event.Tags → filtered to allowedTags.
//   - event.Message → dropped. It is free-form text (hub.Recover routes string /
//     non-error panic values here, as does any CaptureMessage) and cannot be
//     allowlisted; searchability is via tags, not the message.
//   - event.Spans → dropped; event.Transaction → SigV4/presigned-redacted.
//   - Exception values → blanked. An error string is free-form text that can
//     embed submission/prompt content (a worker error "invalid response for
//     <essay>"), and it is not allowlistable; only the Go type (the issue title)
//     and the code-location stacktrace survive. The scrubbed-away detail remains
//     in request-scoped stdout logs, joinable by the request_id tag (DD6).
//
// Returns the event (never nil) — scrubbed events still send; the tags are what
// make them searchable.
func ScrubEvent(event *sentry.Event, _ *sentry.EventHint) *sentry.Event {
	if event == nil {
		return nil
	}
	event.Request = nil
	event.Contexts = nil
	event.Breadcrumbs = nil
	event.Spans = nil
	event.User = sentry.User{}
	event.Tags = allowlistTags(event.Tags)
	// Message is free-form text: sentry-go routes a string / non-error panic value
	// (hub.Recover) and any CaptureMessage call into it, so it can carry an essay
	// body or a Gemini prompt. The allowlist posture never trusts free-form content
	// — searchability is via the operator-safe TAGS, not the message — so drop it
	// outright rather than lean on the narrow SigV4/URL denylist, which would miss
	// arbitrary PII. (CapturePanic additionally wraps panics as exceptions so they
	// still produce a titled, grouped issue rather than an empty message event.)
	event.Message = ""
	// Transaction is a route-like name kept for grouping; still run it through the
	// SigV4/presigned redaction in case a signed URL reached it.
	event.Transaction = logging.RedactString(event.Transaction)
	for i := range event.Exception {
		// Keep Type (the stdlib/typed error name — the issue title, operator-safe)
		// and the stacktrace (code locations; Go never populates frame Vars);
		// blank the free-form Value.
		event.Exception[i].Value = ""
	}
	return event
}

// allowlistTags returns a copy of tags containing only the allowedTags keys.
func allowlistTags(tags map[string]string) map[string]string {
	if tags == nil {
		return nil
	}
	out := make(map[string]string, len(tags))
	for key, value := range tags {
		if _, ok := allowedTags[key]; ok {
			out[key] = value
		}
	}
	return out
}

// CaptureError sends err to Sentry, reading request_id (model.RequestID) and the
// tenant identity (model.TenantFromContext) from the INCOMING ctx — never a
// fresh context (GO-4), so a worker's re-established tenant (SEC-6) or a
// post-refresh retry's rotated request_id is the one that tags the event. The
// tags are the searchable dimension (DD2): "searchable by request_id" is the
// literal Done-when. A nil err is ignored. Capture is fire-and-forget to the
// SDK's async transport and must never block the request/worker path.
func CaptureError(ctx context.Context, err error) {
	if err == nil {
		return
	}
	hub := hubForContext(ctx)
	hub.WithScope(func(scope *sentry.Scope) {
		applyTags(scope, ctx)
		applyGrouping(scope, ctx, err)
		hub.CaptureException(err)
	})
}

// CapturePanic sends a recovered panic to Sentry with the same tag set as
// CaptureError. rec is wrapped into an error and captured as an EXCEPTION rather
// than passed to hub.Recover: hub.Recover routes a string / non-error panic value
// to CaptureMessage → event.Message, which the allowlist scrubber drops entirely
// (losing the issue) and which, before the scrub hardening, leaked raw content.
// As an exception the panic's free-form value lands in Exception.Value (blanked by
// ScrubEvent) while stable grouping comes from the error_type tag + fingerprint.
// The stack argument is intentionally not attached: the SDK captures its own
// structured stacktrace and the raw stack is already in the funnel's slog.Error
// line (DD6); attaching it as free-form extra would only be dropped by the scrubber.
func CapturePanic(ctx context.Context, rec any, _ []byte) {
	err := fmt.Errorf("panic: %v", rec)
	hub := hubForContext(ctx)
	hub.WithScope(func(scope *sentry.Scope) {
		applyTags(scope, ctx)
		applyGrouping(scope, ctx, err)
		hub.CaptureException(err)
	})
}

// hubForContext honors a request-scoped hub when one is installed, falling back
// to the process hub otherwise. Tests install a mock-transport client on the
// current hub; production uses the current hub too (no per-request hub is wired).
func hubForContext(ctx context.Context) *sentry.Hub {
	if hub := sentry.GetHubFromContext(ctx); hub != nil {
		return hub
	}
	return sentry.CurrentHub()
}

// applyTags sets only non-empty operator-safe tags on the scope from ctx.
func applyTags(scope *sentry.Scope, ctx context.Context) {
	if requestID, ok := ctx.Value(model.RequestID).(string); ok && requestID != "" {
		scope.SetTag("request_id", requestID)
	}
	if tc, ok := model.TenantFromContext(ctx); ok {
		if tc.CenterID != "" {
			scope.SetTag("center_id", tc.CenterID)
		}
		if tc.UserID != "" {
			scope.SetTag("user_id", tc.UserID)
		}
	}
	if tags, ok := ctx.Value(httpTagsKey{}).(httpTags); ok {
		if tags.method != "" {
			scope.SetTag("method", tags.method)
		}
		if tags.route != "" {
			scope.SetTag("route", tags.route)
		}
		if tags.status != 0 {
			scope.SetTag("status", strconv.Itoa(tags.status))
		}
	}
	if reason, ok := ctx.Value(reasonKey{}).(string); ok && reason != "" {
		scope.SetTag("reason", reason)
	}
}

// applyGrouping sets the operator-safe error_type tag and a custom fingerprint so a
// blanked exception Value (ScrubEvent) does not collapse distinct incidents into one
// empty-titled issue. "{{ default }}" preserves Sentry's stacktrace-based grouping
// (which separates the distinct worker capture sites) while error_type plus the HTTP
// method/route and reason split the shared HTTP error funnel — whose captured stack
// is always the funnel itself — by endpoint and error class. Every component is
// non-PII (a Go type name, an HTTP method/route template, a fixed reason label).
func applyGrouping(scope *sentry.Scope, ctx context.Context, err error) {
	errorType := reflect.TypeOf(err).String()
	scope.SetTag("error_type", errorType)
	fingerprint := []string{"{{ default }}", errorType}
	if tags, ok := ctx.Value(httpTagsKey{}).(httpTags); ok {
		if tags.method != "" {
			fingerprint = append(fingerprint, tags.method)
		}
		if tags.route != "" {
			fingerprint = append(fingerprint, tags.route)
		}
	}
	if reason, ok := ctx.Value(reasonKey{}).(string); ok && reason != "" {
		fingerprint = append(fingerprint, reason)
	}
	scope.SetFingerprint(fingerprint)
}
