// Package worker hosts the durable job dispatcher (dispatcher.go) and the
// ai_generate_* job handlers for Story 4.3a.
//
// Each handler runs inside the caller's tenant-scoped tx (BC-1): it takes a
// generated.DBTX and issues ops directly on it — it NEVER opens its own tx and
// never re-derives tenant identity from the payload (the job-row center_id, set
// by the dispatcher before ProcessTask, is the sole trust anchor — R3/A7). The
// handler produces a validated ExerciseContent RESULT FRAGMENT and never mutates
// the exercise itself; insertion is the teacher's explicit act in Story 4.3b.
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

// Failure classification sentinels. ErrTransientGeneration wraps a provider
// (Gemini) error the dispatcher RETRIES with backoff (AC5). ErrInvalidAIResponse
// marks unparseable/invalid generation output — terminal, NOT retried (AC6).
var (
	ErrTransientGeneration = errors.New("transient generation failure")
	ErrInvalidAIResponse   = errors.New("invalid ai response")
)

// GenerationHandler is the worker's contract: it declares its job type, produces
// a typed result fragment (Generate, used by the dispatcher against a per-job
// tx), and satisfies the 3-pattern harness via ProcessTask (which runs the same
// logic against the handler's own bound DB and discards the result). The
// generate method is unexported so only the dispatcher (same package) drives the
// result-capturing path.
type GenerationHandler interface {
	JobType() model.JobType
	ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error
	generate(ctx context.Context, db generated.DBTX, gem gemini.Client, tc model.TenantContext, payload json.RawMessage) (json.RawMessage, error)
}

// --- Section handler ---

// GenerateSectionHandler generates a full section (passage + question groups).
type GenerateSectionHandler struct {
	db  generated.DBTX
	gem gemini.Client
}

// NewGenerateSectionHandler builds a section handler bound to db (the harness tx
// for the 3-pattern tests). clk is accepted for constructor parity with the
// dispatcher wiring; generation itself is time-independent (the dispatcher owns
// all timing).
func NewGenerateSectionHandler(db generated.DBTX, gem gemini.Client, _ clock.Clock) *GenerateSectionHandler {
	return &GenerateSectionHandler{db: db, gem: gem}
}

// JobType reports the section job type.
func (h *GenerateSectionHandler) JobType() model.JobType { return model.JobTypeAIGenerateSection }

// ProcessTask satisfies workers.JobHandler for the tenant-isolation harness — it
// runs the generation against the handler's bound DB and discards the result.
func (h *GenerateSectionHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, h.gem, tc, payload)
	return err
}

func (h *GenerateSectionHandler) generate(ctx context.Context, db generated.DBTX, gem gemini.Client, tc model.TenantContext, payload json.RawMessage) (json.RawMessage, error) {
	var params model.AIGenerateSectionParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return nil, fmt.Errorf("%w: unmarshal section params", ErrInvalidAIResponse)
	}
	logProcessing(tc, model.JobTypeAIGenerateSection)
	if err := readExerciseForTenant(ctx, db, params.ExerciseID); err != nil {
		return nil, err
	}
	raw, err := gem.Generate(ctx, gemini.GenerateRequest{Mode: "section", Prompt: buildSectionPrompt(params.Topic)})
	if err != nil {
		return nil, fmt.Errorf("%w: gemini", ErrTransientGeneration)
	}
	var resp model.AISectionResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("%w: parse section response", ErrInvalidAIResponse)
	}
	return validatedResult(mapSectionResponse(resp))
}

// --- Questions handler ---

// GenerateQuestionsHandler generates question groups for an existing section.
type GenerateQuestionsHandler struct {
	db  generated.DBTX
	gem gemini.Client
}

// NewGenerateQuestionsHandler builds a questions handler bound to db.
func NewGenerateQuestionsHandler(db generated.DBTX, gem gemini.Client, _ clock.Clock) *GenerateQuestionsHandler {
	return &GenerateQuestionsHandler{db: db, gem: gem}
}

// JobType reports the questions job type.
func (h *GenerateQuestionsHandler) JobType() model.JobType { return model.JobTypeAIGenerateQuestions }

// ProcessTask satisfies workers.JobHandler (see the section handler note).
func (h *GenerateQuestionsHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, h.gem, tc, payload)
	return err
}

func (h *GenerateQuestionsHandler) generate(ctx context.Context, db generated.DBTX, gem gemini.Client, tc model.TenantContext, payload json.RawMessage) (json.RawMessage, error) {
	var params model.AIGenerateQuestionsParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return nil, fmt.Errorf("%w: unmarshal questions params", ErrInvalidAIResponse)
	}
	logProcessing(tc, model.JobTypeAIGenerateQuestions)
	if err := readExerciseForTenant(ctx, db, params.ExerciseID); err != nil {
		return nil, err
	}
	raw, err := gem.Generate(ctx, gemini.GenerateRequest{Mode: "questions", Prompt: buildQuestionsPrompt(params.Count)})
	if err != nil {
		return nil, fmt.Errorf("%w: gemini", ErrTransientGeneration)
	}
	var resp model.AIQuestionsResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("%w: parse questions response", ErrInvalidAIResponse)
	}
	return validatedResult(mapQuestionsResponse(resp))
}

// --- Distractors handler ---

// GenerateDistractorsHandler generates distractor options for one MCQ question.
type GenerateDistractorsHandler struct {
	db  generated.DBTX
	gem gemini.Client
}

// NewGenerateDistractorsHandler builds a distractors handler bound to db.
func NewGenerateDistractorsHandler(db generated.DBTX, gem gemini.Client, _ clock.Clock) *GenerateDistractorsHandler {
	return &GenerateDistractorsHandler{db: db, gem: gem}
}

// JobType reports the distractors job type.
func (h *GenerateDistractorsHandler) JobType() model.JobType {
	return model.JobTypeAIGenerateDistractors
}

// ProcessTask satisfies workers.JobHandler (see the section handler note).
func (h *GenerateDistractorsHandler) ProcessTask(ctx context.Context, tc model.TenantContext, payload json.RawMessage) error {
	_, err := h.generate(ctx, h.db, h.gem, tc, payload)
	return err
}

func (h *GenerateDistractorsHandler) generate(ctx context.Context, db generated.DBTX, gem gemini.Client, tc model.TenantContext, payload json.RawMessage) (json.RawMessage, error) {
	var params model.AIGenerateDistractorsParams
	if err := json.Unmarshal(payload, &params); err != nil {
		return nil, fmt.Errorf("%w: unmarshal distractors params", ErrInvalidAIResponse)
	}
	logProcessing(tc, model.JobTypeAIGenerateDistractors)
	if err := readExerciseForTenant(ctx, db, params.ExerciseID); err != nil {
		return nil, err
	}
	raw, err := gem.Generate(ctx, gemini.GenerateRequest{Mode: "distractors", Prompt: buildDistractorsPrompt(params.Count)})
	if err != nil {
		return nil, fmt.Errorf("%w: gemini", ErrTransientGeneration)
	}
	var resp model.AIDistractorsResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, fmt.Errorf("%w: parse distractors response", ErrInvalidAIResponse)
	}
	return validatedResult(mapDistractorsResponse(resp))
}

// --- shared helpers ---

// logProcessing emits the single allowed correlation line per generation. It
// carries ONLY non-sensitive fields (center_id, type) — never the prompt,
// response, or API key (EDGE-4/R49).
func logProcessing(tc model.TenantContext, jobType model.JobType) {
	slog.Info("ai_generation_processing", "center_id", tc.CenterID, "type", string(jobType))
}

// readExerciseForTenant is the RLS gate: an RLS-scoped read of the target
// exercise BEFORE any Gemini call. A cross-tenant / missing / null-tenant read
// returns 0 rows → NotFoundError, so Gemini is never reached for a job whose
// target the caller's tenant cannot see (R3/A7). This is the load-bearing
// assertion behind the PayloadCenterIdIgnored and NullTenantContextRejected
// adversarial patterns.
func readExerciseForTenant(ctx context.Context, db generated.DBTX, exerciseID string) error {
	id, err := uuid.Parse(exerciseID)
	if err != nil {
		return exerciseNotFound(exerciseID)
	}
	if _, err := generated.New(db).GetExerciseByID(ctx, pgUUID(id)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return exerciseNotFound(exerciseID)
		}
		return fmt.Errorf("read target exercise: %w", err)
	}
	return nil
}

func exerciseNotFound(id string) error {
	return model.NotFoundError{Resource: "exercise", ID: id, Code: "EXERCISE_NOT_FOUND"}
}

// validatedResult runs the 4.2 structural validator over the mapped fragment
// (AC4) and marshals it for jobs.result. A validation failure is a terminal
// invalid_ai_response (AC6) — a malformed generation must not become an
// un-insertable result.
func validatedResult(content store.ExerciseContent) (json.RawMessage, error) {
	if err := store.ValidateExerciseContentStructural(content); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidAIResponse, err)
	}
	raw, err := content.Marshal()
	if err != nil {
		return nil, fmt.Errorf("marshal generation result: %w", err)
	}
	return raw, nil
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func pgUUIDToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	return uuid.UUID(u.Bytes).String()
}
