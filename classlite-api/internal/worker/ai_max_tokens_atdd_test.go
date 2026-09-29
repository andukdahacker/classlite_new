// Story 9-1a, AC23 (D18) — every credit-consuming Gemini call is bound to a per-job
// max-output-tokens ceiling, so 1 credit == a BOUNDED spend (not merely a job count) —
// the piece that truly closes FU-11-CREDITCAP. A capturing client records the request
// the worker hands the Gemini seam; the assertion is that MaxOutputTokens is the named
// per-feature const for BOTH the generation and the grading services.
package worker_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
)

// capturingGeminiClient records the last GenerateRequest, then delegates to a real mock
// so the worker still gets a valid canned response.
type capturingGeminiClient struct {
	inner gemini.Client
	last  gemini.GenerateRequest
}

func (c *capturingGeminiClient) Generate(ctx context.Context, req gemini.GenerateRequest) (json.RawMessage, error) {
	c.last = req
	return c.inner.Generate(ctx, req)
}

func TestAIGenerate_BindsMaxOutputTokens(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	exID := seedExerciseForTenant(t, h, uuid.MustParse(testpkg.TenantAID))

	cap := &capturingGeminiClient{inner: gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidSection})}
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGenerateSection),
		model.AIGenerateSectionParams{ExerciseID: exID.String(), Topic: "Present perfect"})

	if err := h.ProcessSpecific(context.Background(), t, jobID, newSectionHandler(t, h, cap)); err != nil {
		t.Fatalf("generate section: %v", err)
	}
	if cap.last.MaxOutputTokens != gemini.MaxOutputTokensGenerate {
		t.Errorf("generation Gemini call MaxOutputTokens = %d, want %d (D18 bounded spend)",
			cap.last.MaxOutputTokens, gemini.MaxOutputTokensGenerate)
	}
}

func TestAIGradeWriting_BindsMaxOutputTokens(t *testing.T) {
	h := workers.SetupWorkerHarness(t)
	_ = testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Tenant A", "TENA")
	subID := testpkg.SeedWritingSubmissionForTenant(t, h.DB, uuid.MustParse(testpkg.TenantAID))

	cap := &capturingGeminiClient{inner: gemini.NewMockClient(gemini.MockConfig{Mode: gemini.MockValidWritingGrade})}
	jobID := h.EnqueueJob(t, testpkg.TenantAID, string(model.JobTypeAIGradeWriting),
		model.AIGradeWritingParams{SubmissionID: subID.String()})

	if err := h.ProcessSpecific(context.Background(), t, jobID, newGradeWritingHandler(t, h, cap)); err != nil {
		t.Fatalf("grade writing: %v", err)
	}
	if cap.last.MaxOutputTokens != gemini.MaxOutputTokensGrade {
		t.Errorf("grade Gemini call MaxOutputTokens = %d, want %d (D18 bounded spend)",
			cap.last.MaxOutputTokens, gemini.MaxOutputTokensGrade)
	}
}
