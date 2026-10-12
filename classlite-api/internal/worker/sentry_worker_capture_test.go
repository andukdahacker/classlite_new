// Story 11-0a AC5 (SEC-6) — proves the REAL dispatcher, not just the capture
// helper, sends a terminally-failed job to Sentry tagged with the job ROW's
// center_id and with the scrubber applied. The unit test in internal/test
// (TestSentry_AC5_*) proves observability.CaptureError tags a worker-style ctx;
// this proves the dispatcher actually calls it with the row's tenant (the SEC-6
// wiring — the Go ctx carries no tenant, so workerTenantCtx must inject it).
//
// Mock transport implements the full v0.50.0 sentry.Transport. The global Sentry
// client is process-wide; this test is not parallel and flushes on cleanup.
package worker_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/getsentry/sentry-go"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/observability"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
)

type workerSentryTransport struct{ events []*sentry.Event }

func (c *workerSentryTransport) Configure(_ sentry.ClientOptions)        {}
func (c *workerSentryTransport) SendEvent(e *sentry.Event)               { c.events = append(c.events, e) }
func (c *workerSentryTransport) Flush(_ time.Duration) bool              { return true }
func (c *workerSentryTransport) FlushWithContext(_ context.Context) bool { return true }
func (c *workerSentryTransport) Close()                                  {}

func TestWorkerCapture_AC5_TerminalFail_TaggedWithCenterID(t *testing.T) {
	tr := &workerSentryTransport{}
	if err := sentry.Init(sentry.ClientOptions{
		Dsn:        "https://public@example.test/1",
		Transport:  tr,
		BeforeSend: observability.ScrubEvent,
	}); err != nil {
		t.Fatalf("sentry.Init: %v", err)
	}
	t.Cleanup(func() {
		sentry.Flush(time.Second)
		// Restore a disabled global client so sibling worker_test cases that hit a
		// capture funnel do not send into this (discarded) mock transport.
		_ = sentry.Init(sentry.ClientOptions{})
	})

	h := workers.SetupWorkerHarness(t)
	// MockMalformed → unparseable bytes → terminal invalid_ai_response in one pass.
	mock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockMalformed})
	d := newDispatcherForTest(t, h, mock)
	jobID := enqueueDeductedJob(t, h)

	if err := d.ProcessOnce(context.Background()); err != nil {
		t.Logf("process (terminal expected): %v", err)
	}
	if got := h.JobStatus(t, jobID); got != workers.StatusFailed {
		t.Fatalf("job status = %q, want failed", got)
	}

	sentry.Flush(time.Second)
	if len(tr.events) == 0 {
		t.Fatal("a terminally-failed job must capture a Sentry event (AC5)")
	}

	// SEC-6: the event is tagged with the job ROW's center_id (never the payload).
	var tagged *sentry.Event
	for _, ev := range tr.events {
		if ev.Tags["center_id"] == testpkg.TenantAID {
			tagged = ev
			break
		}
	}
	if tagged == nil {
		t.Fatalf("no captured event carried center_id=%s (SEC-6 wiring); got %d event(s)", testpkg.TenantAID, len(tr.events))
	}

	// The scrubber runs on worker events too — the free-form exception value
	// (e.g. "job terminal: invalid_ai_response") must be blanked.
	raw, err := json.Marshal(tagged)
	if err != nil {
		t.Fatalf("marshal event: %v", err)
	}
	if strings.Contains(string(raw), "job terminal:") {
		t.Errorf("R-11-6: scrubber did not blank the worker exception value\n%s", string(raw))
	}
}
