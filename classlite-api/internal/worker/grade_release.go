// Story 6.1 — the grade-release outbox handler (D2). It is registered on the same
// pool dispatcher as the AI handlers and drives the POST-COMMIT side effects of a
// grade release: (behind GRADE_RELEASE_EMAIL_ENABLED) send the student's Resend
// email, THEN publish event.GradeReleased on the in-process bus. It is NOT an AI job
// — the gemini client is ignored. The job payload carries IDS ONLY; the recipient +
// title are re-resolved from the tenant-scoped db at send time (chunk-1 code-review
// Decision B — no stale address, no PII at rest).
//
// Idempotency (chunk-1 code-review P2, AC9): the email is attempted BEFORE the event
// is published, so a transient send failure (→ retry) never double-publishes the
// event — it is published exactly once, after a successful (or skipped) send. Coupled
// with the job's status lifecycle (claimed once via SKIP LOCKED, marked complete),
// the event fires at most once per grade_id and the email at-most-once except the
// send-fails-then-succeeds retry (correct at-least-once).
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// EmailSender is the worker's local view of the email sender (structurally
// satisfied by service.EmailSender) — keeps package worker from importing service.
type EmailSender interface {
	Send(ctx context.Context, to, subject, htmlBody string) error
}

// GradeEmailRenderer renders the release email (studentName, assignmentTitle,
// resultURL) → (subject, htmlBody). service.RenderGradeReleasedEmail satisfies it.
type GradeEmailRenderer func(studentName, assignmentTitle, resultURL string) (subject, htmlBody string)

// RecipientResolver re-reads the release email's recipient + assignment title from
// the tenant-scoped db at send time (Decision B). service.ResolveGradeReleaseRecipient
// satisfies it. Empty email → no recipient (skip, do not fail); a non-nil error is
// treated as transient (the dispatcher retries).
type RecipientResolver func(ctx context.Context, db generated.DBTX, submissionID string) (email, name, assignmentTitle string, err error)

// GradeReleaseEmailHandler processes grade_release_email outbox jobs.
type GradeReleaseEmailHandler struct {
	db            generated.DBTX
	events        *event.Bus
	email         EmailSender
	render        GradeEmailRenderer
	resolve       RecipientResolver
	enabled       bool
	resultBaseURL string
	clk           clock.Clock
}

// NewGradeReleaseEmailHandler builds the handler. enabled gates ONLY the student
// email — the event still publishes and the job still completes when it is false
// (the grade released regardless). resolve re-reads the recipient at send time.
func NewGradeReleaseEmailHandler(
	db generated.DBTX, events *event.Bus, email EmailSender, render GradeEmailRenderer,
	resolve RecipientResolver, enabled bool, resultBaseURL string, clk clock.Clock,
) *GradeReleaseEmailHandler {
	return &GradeReleaseEmailHandler{
		db: db, events: events, email: email, render: render, resolve: resolve,
		enabled: enabled, resultBaseURL: resultBaseURL, clk: clk,
	}
}

// JobType reports the grade-release job type.
func (h *GradeReleaseEmailHandler) JobType() model.JobType { return model.JobTypeGradeReleaseEmail }

// ProcessTask satisfies the tenant-isolation harness — runs the same logic and
// discards the (nil) result fragment.
func (h *GradeReleaseEmailHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, nil, tc, payload)
	return err
}

// generate sends the email (if enabled) then publishes the event. db is the
// tenant-scoped handle (used to re-resolve the recipient, Decision B); gem is unused
// (not an AI job). A bad payload is terminal (ErrInvalidAIResponse); a transient
// email/resolve failure is retried (ErrTransientGeneration). The email is sent BEFORE
// the event so a retry never double-publishes it (P2/AC9 idempotency).
func (h *GradeReleaseEmailHandler) generate(
	ctx context.Context, db generated.DBTX, _ gemini.Client, tc model.TenantContext, payload json.RawMessage,
) (json.RawMessage, error) {
	var params model.GradeReleaseEmailParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return nil, fmt.Errorf("%w: unmarshal grade release params", ErrInvalidAIResponse)
	}

	// (a) Student email — gated. Never fails the grade; a flag-off or missing
	// recipient completes the job silently. Runs BEFORE the event publish so a
	// transient send failure that reschedules the job cannot double-publish (P2).
	if err := h.sendEmail(ctx, db, params); err != nil {
		return nil, err
	}

	// (b) Publish the in-process event exactly once per completed job (payload is ids
	// only; the bus swallows subscriber errors). Subscribers (Epic 10 Inbox) attach
	// later.
	if h.events != nil {
		h.events.Publish(ctx, event.Event{
			Type:      event.GradeReleased,
			CenterID:  tc.CenterID,
			UserID:    tc.UserID,
			Payload:   map[string]any{"submissionId": params.SubmissionID, "assignmentId": params.AssignmentID},
			Timestamp: h.clk.Now(),
		})
	}
	return nil, nil
}

// sendEmail re-resolves the recipient from the tenant-scoped db (Decision B) and
// sends the release email when the flag is on. A flag-off or missing recipient is a
// silent success (the grade released regardless); a resolve/send failure is transient.
func (h *GradeReleaseEmailHandler) sendEmail(
	ctx context.Context, db generated.DBTX, params model.GradeReleaseEmailParams,
) error {
	if !h.enabled {
		slog.InfoContext(ctx, "grade release email skipped (flag off)", "grade_id", params.GradeID)
		return nil
	}
	email, name, title, err := h.resolve(ctx, db, params.SubmissionID)
	if err != nil {
		return fmt.Errorf("%w: resolve grade recipient: %v", ErrTransientGeneration, err)
	}
	if email == "" {
		slog.WarnContext(ctx, "grade release email has no recipient", "grade_id", params.GradeID)
		return nil
	}
	resultURL := h.resultBaseURL + "/assignments/" + params.AssignmentID + "/submission"
	subject, body := h.render(name, title, resultURL)
	if err := h.email.Send(ctx, email, subject, body); err != nil {
		return fmt.Errorf("%w: send grade release email: %v", ErrTransientGeneration, err)
	}
	return nil
}
