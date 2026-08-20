// Story 6.2a — the AI Writing-grade enqueue endpoint.
//
//	POST /api/submissions/{submissionId}/ai-grade → 202 {data:{jobId}}  (enqueue)
//	                                              → 200 {data:{jobId}}  (idempotent: existing in-flight job — D6)
//
// It rides the same aiChain as the 4.3a AI routes (extractTenant → requireVerified →
// requireCenter → AI rate limiter → ErrorMapper), so the ~20/min cost-based limiter
// applies. submissionId comes from the PATH; the request has no body (SEC-7 — nothing
// to smuggle). All authz + the atomic {job insert + -1 deduct} + enqueue idempotency
// live in the service (D9). It never calls Gemini (PERF-3). Poll the returned jobId at
// GET /api/jobs/{jobId}; a reopened grading read rehydrates the suggestion via
// TeacherGradingView.aiSuggestion.
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// AIGradeHandler serves the AI Writing-grade enqueue endpoint.
type AIGradeHandler struct {
	svc *service.AIGradeService
	clk clock.Clock
}

// NewAIGradeHandler constructs the handler.
func NewAIGradeHandler(svc *service.AIGradeService, clk clock.Clock) *AIGradeHandler {
	return &AIGradeHandler{svc: svc, clk: clk}
}

// Enqueue enqueues an ai_grade_writing job for the path submission and returns the
// job id — 202 on a fresh enqueue, 200 when an in-flight job already exists (D6).
func (h *AIGradeHandler) Enqueue(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	jobID, existing, err := h.svc.EnqueueAIGrade(r.Context(), tc, submissionID)
	if err != nil {
		return err
	}
	status := http.StatusAccepted // 202 — a new job was enqueued
	if existing {
		status = http.StatusOK // 200 — an in-flight job already existed (idempotent, no second deduct)
	}
	WriteEnvelope(w, status, h.clk, enqueueResponse{JobID: jobID.String()})
	return nil
}
