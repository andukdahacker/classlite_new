// Story 11-0a (AC1/AC2/AC4/AC5/AC6 · risk R-11-6 ≥6) — the backend telemetry
// capture + PII-scrub unit surface. This is the WF-8 HARD-GATE specimen: AC4
// (the beforeSend scrubber) is the R-11-6 guardrail — if this is weak, a student
// essay, a grade, a Gemini prompt, or the API key reaches Sentry.
//
// package test — unit-level, NO DB (pure in-process Sentry client with a mock
// transport). Lives in internal/test/ (a non-empty package) rather than a new
// internal/observability/ dir so the normal build never hits "build constraints
// exclude all Go files" — the tagged file is simply excluded until dev strips
// the tag per the //go:build atdd_red_phase convention.
//
// GREEN (tag stripped 2026-10-10): the observability package + getsentry/sentry-go
// (v0.50.0) now exist and these pass. The mock transport implements the full
// v0.50.0 sentry.Transport (Flush/FlushWithContext/Configure/SendEvent/Close), and
// the arbitrary-data specimen uses event.Contexts (v0.50.0 removed the old
// event.Extra field) — the scrubber drops both. Assertions are unchanged.
//
// GREEN SEAMS (internal/observability/sentry.go):
//
//	func Init(cfg config.Config) (flush func(context.Context), err error)
//	    — wraps sentry.Init. EMPTY DSN → returns a non-nil no-op flush + nil error
//	      (DD4: dev/local/suite stays green without a DSN; never fail-fast the server).
//	func ScrubEvent(event *sentry.Event, hint *sentry.EventHint) *sentry.Event
//	    — the BeforeSend hook. ALLOWLIST scrub (DD3): drop event.Request wholesale,
//	      drop event.Extra, and run surviving strings (Message/Exception) through the
//	      existing internal/logging SigV4/presigned redaction. The ONLY request-derived
//	      data that survives is the operator-safe TAG set.
//	func CaptureError(ctx context.Context, err error)
//	func CapturePanic(ctx context.Context, rec any, stack []byte)
//	    — read model.RequestID + model.TenantFromContext from the INCOMING ctx (GO-4;
//	      never context.Background) and set request_id / center_id / user_id as TAGS
//	      (DD2 — tags are Sentry's searchable dimension; "searchable by request_id"
//	      is the literal Done-when). Only non-empty values are set.
//
// NB value-scan, not key-scan (privacy-strip convention): the scrub assertions
// marshal the whole event to JSON and assert sensitive VALUES are absent — never
// that a key is missing (a null-valued key still present would false-pass).
package test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/config"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/observability"
	"github.com/getsentry/sentry-go"
)

// sentryCaptureTransport is an in-memory sentry.Transport: it collects the
// events a real client would have sent over the wire. BeforeSend (ScrubEvent)
// has already run by the time SendEvent fires, so asserting against collected
// events is an end-to-end check of the scrub + tag pipeline.
type sentryCaptureTransport struct{ events []*sentry.Event }

func (c *sentryCaptureTransport) Configure(_ sentry.ClientOptions)        {}
func (c *sentryCaptureTransport) SendEvent(e *sentry.Event)               { c.events = append(c.events, e) }
func (c *sentryCaptureTransport) Flush(_ time.Duration) bool              { return true }
func (c *sentryCaptureTransport) FlushWithContext(_ context.Context) bool { return true }
func (c *sentryCaptureTransport) Close()                                  {}

// initCaptureClient installs a fresh global Sentry client wired to a mock
// transport and the production ScrubEvent beforeSend hook, and returns the
// transport for assertions. t.Cleanup flushes so global state does not leak.
func initCaptureClient(t *testing.T) *sentryCaptureTransport {
	t.Helper()
	tr := &sentryCaptureTransport{}
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

// --- AC4: the R-11-6 scrubber (unit, ScrubEvent in isolation) ---------------

func TestSentry_AC4_ScrubEvent_StripsBodyHeadersPIISecrets(t *testing.T) {
	const (
		essay   = "SECRETESSAY-climate-change-body"
		token   = "SECRETBEARERTOKEN"
		cookie  = "SECRETSESSIONCOOKIE"
		prompt  = "SECRETGEMINIPROMPT"
		apiKey  = "SECRETGEMINIKEY"
		sigPart = "SECRETSIGV4SIGNATURE"
	)

	event := sentry.NewEvent()
	event.Message = "upload failed https://r2.example.com/c/x?X-Amz-Signature=" + sigPart + "&X-Amz-Credential=abc"
	event.Request = &sentry.Request{
		Method:  "POST",
		Data:    `{"answer":"` + essay + `"}`,
		Cookies: "session=" + cookie,
		Headers: map[string]string{
			"Authorization": "Bearer " + token,
			"Cookie":        "session=" + cookie,
			"Content-Type":  "application/json",
		},
	}
	// v0.50.0 removed event.Extra; Contexts is the carrier for arbitrary attached
	// data. The scrubber must drop it wholesale (prompt + API key must not survive).
	event.Contexts = map[string]sentry.Context{
		"worker": {"gemini_prompt": prompt, "api_key": apiKey},
	}
	// Operator-safe tags MUST survive (allowlist keeps these).
	event.Tags = map[string]string{"request_id": "keep-req", "center_id": "keep-center"}

	scrubbed := observability.ScrubEvent(event, nil)
	if scrubbed == nil {
		t.Fatal("ScrubEvent returned nil — events must still be sent, only scrubbed")
	}

	raw, err := json.Marshal(scrubbed)
	if err != nil {
		t.Fatalf("marshal scrubbed event: %v", err)
	}
	blob := string(raw)

	// VALUE-scan: none of the sensitive values may survive anywhere in the event.
	for _, secret := range []string{essay, token, cookie, prompt, apiKey, sigPart} {
		if strings.Contains(blob, secret) {
			t.Errorf("R-11-6 LEAK: scrubbed event still contains %q\n%s", secret, blob)
		}
	}

	// Allowlist: operator-safe tags are preserved (search still works).
	if scrubbed.Tags["request_id"] != "keep-req" {
		t.Errorf("scrub dropped the request_id tag: %v", scrubbed.Tags)
	}
	if scrubbed.Tags["center_id"] != "keep-center" {
		t.Errorf("scrub dropped the center_id tag: %v", scrubbed.Tags)
	}
}

// --- AC2: capture tags request_id/center_id/user_id from HTTP-style ctx ------

func TestSentry_AC2_CaptureError_TagsFromRequestContext(t *testing.T) {
	tr := initCaptureClient(t)

	ctx := context.WithValue(context.Background(), model.RequestID, "req-123")
	ctx = model.WithTenantContext(ctx, model.TenantContext{
		CenterID: "center-abc", UserID: "user-xyz", Role: "teacher",
	})

	observability.CaptureError(ctx, errors.New("boom"))
	sentry.Flush(time.Second)

	if len(tr.events) != 1 {
		t.Fatalf("expected exactly 1 captured event, got %d", len(tr.events))
	}
	tags := tr.events[0].Tags
	if tags["request_id"] != "req-123" {
		t.Errorf("request_id tag = %q, want req-123 (searchable-by-request_id is the Done-when)", tags["request_id"])
	}
	if tags["center_id"] != "center-abc" {
		t.Errorf("center_id tag = %q, want center-abc", tags["center_id"])
	}
	if tags["user_id"] != "user-xyz" {
		t.Errorf("user_id tag = %q, want user-xyz", tags["user_id"])
	}
}

// --- AC5: worker ctx (center_id present, NO request_id) → tagged + scrubbed --

func TestSentry_AC5_CaptureError_WorkerContext_TenantTaggedNoRequestID(t *testing.T) {
	tr := initCaptureClient(t)

	// Worker path: re-established tenant ctx (SEC-6), no HTTP request_id.
	ctx := model.WithTenantContext(context.Background(), model.TenantContext{
		CenterID: "worker-center", Role: "system",
	})

	observability.CaptureError(ctx, errors.New("job failed: SECRETSUBMISSIONTEXT"))
	sentry.Flush(time.Second)

	if len(tr.events) != 1 {
		t.Fatalf("expected 1 worker event, got %d", len(tr.events))
	}
	ev := tr.events[0]
	if ev.Tags["center_id"] != "worker-center" {
		t.Errorf("worker event missing center_id tag (SEC-6): %v", ev.Tags)
	}
	if ev.Tags["request_id"] != "" {
		t.Errorf("worker event should have no request_id tag, got %q", ev.Tags["request_id"])
	}
	// The scrubber applies to worker events too — the error string may carry content.
	raw, _ := json.Marshal(ev)
	if strings.Contains(string(raw), "SECRETSUBMISSIONTEXT") {
		t.Errorf("R-11-6 LEAK: worker event leaked submission text\n%s", string(raw))
	}
}

// --- AC1/AC6: empty-DSN no-op init + flush callable --------------------------

func TestSentry_AC1_Init_EmptyDSN_NoOpNoError(t *testing.T) {
	flush, err := observability.Init(config.Config{}) // SentryDSN == ""
	if err != nil {
		t.Fatalf("empty-DSN Init must not error (DD4), got %v", err)
	}
	if flush == nil {
		t.Fatal("Init must return a non-nil flush even when DSN is empty (AC6)")
	}
	// AC6: flush is callable without panic.
	flush(context.Background())
}
