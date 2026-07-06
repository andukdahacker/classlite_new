// Package handler — Story 2.2 TemplateHandler.
//
// Three routes: GET /api/templates, POST /api/templates,
// POST /api/templates/{id}/spawn. All three sit behind ExtractTenant →
// onboardingLimit → RequireVerifiedEmail → RequireCenterContext → handler
// (see AC8 and cmd/api/main.go for the chain wiring).
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// requireJSONContent enforces `Content-Type: application/json` on POST bodies
// (R2-P23 fix). Clients sending `application/x-www-form-urlencoded` bodies that
// happen to parse as JSON otherwise slip through — CSRF via an HTML form becomes
// possible because HTML forms cannot set application/json. Returns true when
// the check passed; when false, a 415 envelope has already been written to w
// and the handler must return nil.
func requireJSONContent(w http.ResponseWriter, r *http.Request) bool {
	ct := r.Header.Get("Content-Type")
	// Trim media-type parameters like `; charset=utf-8` before comparing.
	if semi := strings.Index(ct, ";"); semi >= 0 {
		ct = ct[:semi]
	}
	ct = strings.TrimSpace(strings.ToLower(ct))
	if ct != "application/json" {
		WriteError(w, r, http.StatusUnsupportedMediaType,
			"UNSUPPORTED_MEDIA_TYPE",
			"Content-Type must be application/json.",
			nil)
		return false
	}
	return true
}

// preflightContentLength short-circuits requests whose declared Content-Length
// exceeds the per-endpoint limit (R2-P24 fix). MaxBytesReader will still catch
// oversize bodies mid-stream, but the pre-check fails fast before the wrapper
// starts reading. ContentLength of -1 (chunked / unknown) falls through to the
// stream-level check.
func preflightContentLength(r *http.Request, limit int64) error {
	if r.ContentLength > limit {
		return decodeError(&http.MaxBytesError{Limit: limit}, limit)
	}
	return nil
}

// decodeError translates the various JSON decode failure modes into a
// consistent 422 ValidationError so the wizard router keys on the right
// field. C2-12 review fix — previously all decode errors collapsed to
// `{field: "body", message: "invalid JSON"}`, hiding actual type / offset
// details. C2-05 covers oversize bodies (MaxBytesReader returns *http.MaxBytesError).
func decodeError(err error, limitBytes int64) error {
	var maxBytesErr *http.MaxBytesError
	if errors.As(err, &maxBytesErr) {
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   "body",
			Message: fmt.Sprintf("request body exceeds %d bytes", limitBytes),
		}}}
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   "body",
			Message: "request body is required",
		}}}
	}
	var typeErr *json.UnmarshalTypeError
	if errors.As(err, &typeErr) {
		field := typeErr.Field
		if field == "" {
			field = "body"
		}
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   field,
			Message: fmt.Sprintf("expected %s", typeErr.Type),
		}}}
	}
	var syntaxErr *json.SyntaxError
	if errors.As(err, &syntaxErr) {
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   "body",
			Message: fmt.Sprintf("invalid JSON at byte %d", syntaxErr.Offset),
		}}}
	}
	return model.ValidationError{Fields: []model.FieldError{{
		Field:   "body",
		Message: "invalid JSON",
	}}}
}

// maxTemplateBodyBytes caps CreateTemplate to 16 KiB and Spawn to 32 KiB —
// spawn is bigger because up to 20 classes × ~1.5 KiB each.
const (
	maxCreateTemplateBodyBytes = 16 * 1024
	maxSpawnBodyBytes          = 32 * 1024
	minSystemSeedTemplates     = 5 // per AC1b — Sally-S1 amendment raised from 4 to 5
)

// TemplateHandler wires TemplateService + ClassService to HTTP.
type TemplateHandler struct {
	templateSvc *service.TemplateService
	classSvc    *service.ClassService
	clk         clock.Clock
}

// NewTemplateHandler constructs a TemplateHandler.
func NewTemplateHandler(templateSvc *service.TemplateService, classSvc *service.ClassService, clk clock.Clock) *TemplateHandler {
	return &TemplateHandler{templateSvc: templateSvc, classSvc: classSvc, clk: clk}
}

// Request DTOs — camelCase (JSON convention).
type templateSessionInputBody struct {
	Title       string  `json:"title"`
	Description *string `json:"description"`
}

type createTemplateRequestBody struct {
	Name         string                     `json:"name"`
	TargetBand   float64                    `json:"targetBand"`
	PrimarySkill string                     `json:"primarySkill"`
	SessionCount int                        `json:"sessionCount"`
	Color        *string                    `json:"color"`
	Sessions     []templateSessionInputBody `json:"sessions"`
}

type spawnClassBody struct {
	CohortName   string  `json:"cohortName"`
	StartDate    string  `json:"startDate"`
	TeacherEmail *string `json:"teacherEmail"`
}

type spawnRequestBody struct {
	Classes []spawnClassBody `json:"classes"`
}

// List returns the dual-scope template catalog (AC1). System seeds are
// counted post-fetch — fewer than 5 signals an incomplete seed migration
// (500 SEED_INCOMPLETE per AC1 + AC13 error catalog).
func (h *TemplateHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return ErrTenantContextMissing
	}

	templates, err := h.templateSvc.ListAccessibleTemplates(r.Context(), tc)
	if err != nil {
		return err
	}
	if h.templateSvc.CountSystemTemplates(templates) < minSystemSeedTemplates {
		WriteError(w, r, http.StatusInternalServerError,
			"SEED_INCOMPLETE",
			"Template catalog is missing required system seeds. Contact support.",
			nil)
		return nil
	}

	WriteEnvelope(w, http.StatusOK, h.clk, model.ListTemplatesResponse{Templates: templates})
	return nil
}

// Create inserts a center-owned custom template + its sessions in ONE tx (AC2).
func (h *TemplateHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return ErrTenantContextMissing
	}
	if !requireJSONContent(w, r) {
		return nil
	}
	if err := preflightContentLength(r, maxCreateTemplateBodyBytes); err != nil {
		return err
	}

	// C2-05 review fix — pass `nil` as the ResponseWriter arg so MaxBytesReader
	// does NOT auto-write a 413 header (which then races the handler's 422
	// response and triggers "http: superfluous WriteHeader call"). The
	// wrapper we build below distinguishes the two failure modes.
	r.Body = http.MaxBytesReader(nil, r.Body, maxCreateTemplateBodyBytes)
	var body createTemplateRequestBody
	// C2-10 review fix — reject unknown fields so typos like `sesionCount`
	// surface as a validation error instead of silently defaulting to zero.
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return decodeError(err, maxCreateTemplateBodyBytes)
	}

	sessions := make([]model.TemplateSessionInput, len(body.Sessions))
	for i, s := range body.Sessions {
		sessions[i] = model.TemplateSessionInput{Title: s.Title, Description: s.Description}
	}
	in := model.CreateTemplateInput{
		Name:         body.Name,
		TargetBand:   body.TargetBand,
		PrimarySkill: body.PrimarySkill,
		SessionCount: body.SessionCount,
		Color:        body.Color,
		Sessions:     sessions,
	}

	result, err := h.templateSvc.CreateCustomTemplate(r.Context(), tc, in)
	if err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusCreated, h.clk, result)
	return nil
}

// Spawn fans out into N classes atomically (AC3).
func (h *TemplateHandler) Spawn(w http.ResponseWriter, r *http.Request) error {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok {
		return ErrTenantContextMissing
	}
	userID, err := userIDFromContext(r)
	if err != nil {
		return err
	}
	if !requireJSONContent(w, r) {
		return nil
	}
	if err := preflightContentLength(r, maxSpawnBodyBytes); err != nil {
		return err
	}

	rawID := r.PathValue("id")
	templateID, err := uuid.Parse(rawID)
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   "id",
			Message: "must be a valid UUID",
		}}}
	}

	r.Body = http.MaxBytesReader(nil, r.Body, maxSpawnBodyBytes)
	var body spawnRequestBody
	// C2-10 review fix — reject unknown fields so a request smuggling
	// `"centerId":"<attacker>"` at the payload root is 422'd (rather than
	// silently ignored — which was already the behavior, but tests couldn't
	// prove SEC-7 held on the request contract itself).
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return decodeError(err, maxSpawnBodyBytes)
	}

	// C2-04 review fix — enforce OpenAPI's `maxItems: 20` on `classes[]`
	// immediately after decode, before allocating N SpawnClassInput entries.
	// Previously a 32 KiB body could allocate thousands of tiny items.
	if len(body.Classes) > 20 {
		return model.ValidationError{Fields: []model.FieldError{{
			Field:   "classes",
			Message: "must be at most 20 classes per spawn request",
		}}}
	}

	classes := make([]service.SpawnClassInput, len(body.Classes))
	for i, c := range body.Classes {
		classes[i] = service.SpawnClassInput{
			CohortName:   c.CohortName,
			StartDate:    c.StartDate,
			TeacherEmail: c.TeacherEmail,
		}
	}

	result, err := h.classSvc.Spawn(r.Context(), tc, userID, templateID, service.SpawnInput{Classes: classes})
	if err != nil {
		return err
	}

	WriteEnvelope(w, http.StatusCreated, h.clk, result)
	return nil
}
