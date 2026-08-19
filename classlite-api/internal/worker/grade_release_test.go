package worker

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// gradeReleaseParams builds an IDS-ONLY outbox payload (Decision B — no PII at rest).
func gradeReleaseParams(t *testing.T) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(model.GradeReleaseEmailParams{
		GradeID: "g1", SubmissionID: "s1", AssignmentID: "a1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// stubResolver returns a RecipientResolver that ignores the db and yields the given
// recipient — the send-time re-resolution seam (Decision B) under unit test.
func stubResolver(email, name, title string) RecipientResolver {
	return func(_ context.Context, _ generated.DBTX, _ string) (string, string, string, error) {
		return email, name, title, nil
	}
}

func subscribeCount(bus *event.Bus) *int32 {
	var count int32
	bus.Subscribe(event.GradeReleased, func(_ context.Context, _ event.Event) error {
		atomic.AddInt32(&count, 1)
		return nil
	})
	return &count
}

func TestGradeReleaseHandler_HappyPath_EventAndEmail(t *testing.T) {
	bus := event.NewBus()
	count := subscribeCount(bus)
	mock := &service.MockEmailSender{}
	h := NewGradeReleaseEmailHandler(nil, bus, mock, service.RenderGradeReleasedEmail,
		stubResolver("stu@example.com", "Stu", "Task 1"), true, "https://app.test", clock.RealClock{})

	tc := model.TenantContext{CenterID: "c1", UserID: "u1"}
	if err := h.ProcessTask(context.Background(), tc, gradeReleaseParams(t)); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}
	if atomic.LoadInt32(count) != 1 {
		t.Errorf("event published %d times, want 1", atomic.LoadInt32(count))
	}
	if mock.Count() != 1 {
		t.Fatalf("email sent %d times, want 1", mock.Count())
	}
	sent := mock.Snapshot()[0]
	if sent.To != "stu@example.com" {
		t.Errorf("recipient = %q, want stu@example.com", sent.To)
	}
	if !strings.Contains(sent.HTML, "/assignments/a1/submission") {
		t.Errorf("email body missing result deep link, got: %s", sent.HTML)
	}
}

func TestGradeReleaseHandler_FlagOff_EventButNoEmail(t *testing.T) {
	bus := event.NewBus()
	count := subscribeCount(bus)
	mock := &service.MockEmailSender{}
	h := NewGradeReleaseEmailHandler(nil, bus, mock, service.RenderGradeReleasedEmail,
		stubResolver("stu@example.com", "Stu", "Task 1"), false, "https://app.test", clock.RealClock{})

	if err := h.ProcessTask(context.Background(), model.TenantContext{}, gradeReleaseParams(t)); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}
	if atomic.LoadInt32(count) != 1 {
		t.Errorf("event should still publish when the email flag is off; got %d", atomic.LoadInt32(count))
	}
	if mock.Count() != 0 {
		t.Errorf("email should NOT send when the flag is off; got %d", mock.Count())
	}
}

// TestGradeReleaseHandler_NoRecipient_EventButNoEmail proves the send-time re-resolve
// path: when the recipient resolves empty (student/submission gone), the email is
// skipped but the event still publishes and the job completes.
func TestGradeReleaseHandler_NoRecipient_EventButNoEmail(t *testing.T) {
	bus := event.NewBus()
	count := subscribeCount(bus)
	mock := &service.MockEmailSender{}
	h := NewGradeReleaseEmailHandler(nil, bus, mock, service.RenderGradeReleasedEmail,
		stubResolver("", "", ""), true, "https://app.test", clock.RealClock{})

	if err := h.ProcessTask(context.Background(), model.TenantContext{}, gradeReleaseParams(t)); err != nil {
		t.Fatalf("ProcessTask: %v", err)
	}
	if atomic.LoadInt32(count) != 1 {
		t.Errorf("event should publish even with no recipient; got %d", atomic.LoadInt32(count))
	}
	if mock.Count() != 0 {
		t.Errorf("no email should send when the recipient is empty; got %d", mock.Count())
	}
}

func TestGradeReleaseHandler_BadPayload_Terminal(t *testing.T) {
	h := NewGradeReleaseEmailHandler(nil, event.NewBus(), &service.MockEmailSender{},
		service.RenderGradeReleasedEmail, stubResolver("stu@example.com", "Stu", "Task 1"),
		true, "https://app.test", clock.RealClock{})
	err := h.ProcessTask(context.Background(), model.TenantContext{}, json.RawMessage(`not json`))
	if !errors.Is(err, ErrInvalidAIResponse) {
		t.Fatalf("bad payload should be terminal (ErrInvalidAIResponse), got %v", err)
	}
}

func TestGradeReleaseHandler_SendFailure_Transient(t *testing.T) {
	mock := &service.MockEmailSender{SendError: errors.New("smtp down")}
	h := NewGradeReleaseEmailHandler(nil, event.NewBus(), mock, service.RenderGradeReleasedEmail,
		stubResolver("stu@example.com", "Stu", "Task 1"), true, "https://app.test", clock.RealClock{})
	err := h.ProcessTask(context.Background(), model.TenantContext{}, gradeReleaseParams(t))
	if !errors.Is(err, ErrTransientGeneration) {
		t.Fatalf("send failure should be transient (ErrTransientGeneration, retried), got %v", err)
	}
}

// TestGradeReleaseHandler_TransientRetry_NoDuplicateEvent is the P2/AC9 idempotency
// guard: because the email is attempted BEFORE the event publish, a transient send
// failure (which reschedules the job) does NOT publish the event — so a retry that
// succeeds publishes it exactly once. A pre-reorder handler would have published the
// event on the failed attempt AND again on the retry.
func TestGradeReleaseHandler_TransientRetry_NoDuplicateEvent(t *testing.T) {
	bus := event.NewBus()
	count := subscribeCount(bus)
	resolve := stubResolver("stu@example.com", "Stu", "Task 1")
	ctx := context.Background()
	payload := gradeReleaseParams(t)

	// Attempt 1: SMTP down → transient, event NOT published.
	failing := &service.MockEmailSender{SendError: errors.New("smtp down")}
	h1 := NewGradeReleaseEmailHandler(nil, bus, failing, service.RenderGradeReleasedEmail,
		resolve, true, "https://app.test", clock.RealClock{})
	if err := h1.ProcessTask(ctx, model.TenantContext{}, payload); !errors.Is(err, ErrTransientGeneration) {
		t.Fatalf("attempt 1 should be transient, got %v", err)
	}
	if got := atomic.LoadInt32(count); got != 0 {
		t.Fatalf("event must NOT publish on a failed send; got %d", got)
	}

	// Attempt 2 (retry): send succeeds → event published exactly once, email once.
	ok := &service.MockEmailSender{}
	h2 := NewGradeReleaseEmailHandler(nil, bus, ok, service.RenderGradeReleasedEmail,
		resolve, true, "https://app.test", clock.RealClock{})
	if err := h2.ProcessTask(ctx, model.TenantContext{}, payload); err != nil {
		t.Fatalf("attempt 2 (retry): %v", err)
	}
	if got := atomic.LoadInt32(count); got != 1 {
		t.Errorf("event published %d times across a fail+retry, want exactly 1", got)
	}
	if ok.Count() != 1 {
		t.Errorf("email sent %d times on the successful retry, want 1", ok.Count())
	}
}
