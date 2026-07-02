// Package handler — Story 2.1 OnboardingHandler.
//
// Three routes: POST /api/onboarding/persona, PUT /api/onboarding/progress,
// GET /api/onboarding/progress. All three sit behind ExtractTenant →
// RequireVerifiedEmail → RateLimit → handler (see AC8 and cmd/api/main.go
// for the chain wiring).
package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// ErrTenantContextMissing is returned by userIDFromContext when the request
// arrived without a TenantContext (or with an unparseable UserID). This is a
// programming error — the middleware chain guarantees a valid caller before
// the handler runs — so it is a plain non-typed error that ErrorMapper's
// default branch maps to 500 INTERNAL_ERROR per AC9 P5 (mirroring
// RequireRole's missing-context posture). It is deliberately NOT a
// model.ValidationError, which would map to 422 and misclassify the fault.
var ErrTenantContextMissing = errors.New("tenant context missing (middleware misconfigured)")

// maxOnboardingBodyBytes caps every onboarding endpoint body to 16 KiB.
// Payload shape is bounded — anything larger is malformed or hostile.
const maxOnboardingBodyBytes = 16 * 1024

// OnboardingHandler wires OnboardingService to HTTP.
type OnboardingHandler struct {
	svc *service.OnboardingService
	clk clock.Clock
}

// NewOnboardingHandler constructs an OnboardingHandler with the given
// service and clock (production wires clock.RealClock).
func NewOnboardingHandler(svc *service.OnboardingService, clk clock.Clock) *OnboardingHandler {
	return &OnboardingHandler{svc: svc, clk: clk}
}

// Request DTOs — camelCase (JSON convention).
type setPersonaRequestBody struct {
	Persona string `json:"persona"`
}

type putProgressRequestBody struct {
	CurrentStep string          `json:"currentStep"`
	Payload     json.RawMessage `json:"payload"`
}

// Response DTOs — no omitempty (GO-5).
type personaResult struct {
	Persona string `json:"persona"`
}

type progressResult struct {
	CurrentStep string           `json:"currentStep"`
	Payload     *json.RawMessage `json:"payload"`
	UpdatedAt   *string          `json:"updatedAt"`
	Persona     *string          `json:"persona"`
}

type putProgressResult struct {
	CurrentStep string          `json:"currentStep"`
	Payload     json.RawMessage `json:"payload"`
	UpdatedAt   string          `json:"updatedAt"`
}

// SetPersona persists the caller's persona choice (AC1).
func (h *OnboardingHandler) SetPersona(w http.ResponseWriter, r *http.Request) error {
	userID, err := userIDFromContext(r)
	if err != nil {
		return err
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxOnboardingBodyBytes)
	var body setPersonaRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	if err := h.svc.UpdatePersona(r.Context(), userID, body.Persona); err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusOK, h.clk, personaResult{Persona: body.Persona})
	return nil
}

// GetProgress returns the caller's saved progress or the default state (AC4).
func (h *OnboardingHandler) GetProgress(w http.ResponseWriter, r *http.Request) error {
	userID, err := userIDFromContext(r)
	if err != nil {
		return err
	}

	progress, err := h.svc.GetProgress(r.Context(), userID)
	if err != nil {
		return err
	}

	out := progressResult{
		CurrentStep: progress.CurrentStep,
		Persona:     progress.Persona,
	}
	if progress.RawPayload != nil {
		raw := json.RawMessage(progress.RawPayload)
		out.Payload = &raw
	}
	if progress.UpdatedAt != nil {
		ts := progress.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
		out.UpdatedAt = &ts
	}

	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

// PutProgress upserts the caller's progress row (AC3).
func (h *OnboardingHandler) PutProgress(w http.ResponseWriter, r *http.Request) error {
	userID, err := userIDFromContext(r)
	if err != nil {
		return err
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxOnboardingBodyBytes)
	var body putProgressRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	updated, err := h.svc.UpsertProgress(r.Context(), userID, service.UpsertProgressInput{
		CurrentStep: body.CurrentStep,
		Payload:     []byte(body.Payload),
	})
	if err != nil {
		return err
	}

	out := putProgressResult{
		CurrentStep: updated.CurrentStep,
		Payload:     json.RawMessage(updated.RawPayload),
	}
	if updated.UpdatedAt != nil {
		out.UpdatedAt = updated.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00")
	}

	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

// userIDFromContext pulls the TenantContext-supplied UserID and parses it.
// Missing context (chain wired without ExtractTenant) or malformed UserID
// is a programming error — the middleware chain guarantees a valid caller
// before the handler runs. Returns ErrTenantContextMissing so ErrorMapper's
// default branch produces 500 INTERNAL_ERROR (per AC9 P5, mirroring
// RequireRole's missing-context posture) rather than 422 VALIDATION_ERROR.
func userIDFromContext(r *http.Request) (uuid.UUID, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return uuid.Nil, ErrTenantContextMissing
	}
	if tc.UserID == "" {
		return uuid.Nil, ErrTenantContextMissing
	}
	uid, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, ErrTenantContextMissing
	}
	return uid, nil
}
