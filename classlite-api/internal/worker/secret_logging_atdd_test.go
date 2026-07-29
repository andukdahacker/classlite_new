// Story 4.3a, AC8 / R49 (EDGE-4): secret + prompt/response must NEVER appear in
// logs — GREEN.
//
// Service-level assertion only. The CI grep-scan over shipped logs is a separate
// infra step (see FU-4-3-A). Here we capture slog output emitted across the
// enqueue → worker → gemini paths and prove the GEMINI_API_KEY value and the raw
// prompt/response text are absent — only job_id/center_id/model/type are allowed.
package worker_test

import (
	"bytes"
	"context"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

func TestSecretsAndPrompt_NeverLogged(t *testing.T) {
	const secretKeyValue = "AIzaSy-DEADBEEF-super-secret-gemini-key-do-not-log"
	const promptMarker = "SENSITIVE_PROMPT_MARKER_should_never_be_logged"
	const responseMarker = "SENSITIVE_RESPONSE_MARKER_should_never_be_logged"

	// Route ALL slog output produced during this test into a buffer.
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	_ = testpkg.TenantContext(t, h.DB, center.ID)
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	// Mock configured to (a) hold the secret key and (b) echo sensitive markers
	// into the prompt it builds and the raw response it returns.
	mock := gemini.NewMockClient(gemini.MockConfig{
		Mode:           gemini.MockValidSection,
		APIKey:         secretKeyValue,
		PromptMarker:   promptMarker,
		ResponseMarker: responseMarker,
	})

	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateSection),
		model.AIGenerateSectionParams{ExerciseID: exID.String(), Topic: promptMarker})

	_ = h.ProcessSpecific(context.Background(), t, jobID, newSectionHandler(t, h, mock))
	// Also exercise a failing path (more log lines, incl. error_details).
	failMock := gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockTransientError, APIKey: secretKeyValue})
	_ = worker.NewDispatcher(h.DB, failMock, h.Clock,
		worker.NewGenerateSectionHandler(h.DB, failMock, h.Clock)).ProcessOnce(context.Background())

	logs := buf.String()
	for _, forbidden := range []string{secretKeyValue, promptMarker, responseMarker} {
		if strings.Contains(logs, forbidden) {
			t.Errorf("R49 VIOLATION: forbidden value %q leaked into logs.\n---LOGS---\n%s", forbidden, logs)
		}
	}
	// Positive control: the allowed correlation fields SHOULD be present, proving
	// logging happened at all (an empty buffer would pass the negative check vacuously).
	if !strings.Contains(logs, testpkg.TenantAID) && !strings.Contains(logs, jobID.String()) {
		t.Error("expected job_id/center_id correlation fields in logs; buffer had neither — the negative assertion may be vacuous")
	}
}
