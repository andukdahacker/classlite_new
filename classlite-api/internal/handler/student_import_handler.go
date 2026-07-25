// Package handler — Story 2.7 StudentImportHandler.
//
// Two endpoints on the owner/admin invite chain (extractTenant → requireVerified
// → requireCenter → RequireRole("owner","admin") → limit → ErrorMapper). The
// middleware RequireRole gates the JWT-claimed role; the service RE-validates the
// role from center_members on confirm (SEC-1/R15), so a stale/elevated JWT still
// 403s. Responses use the {data,meta} envelope (GFW-5).
package handler

import (
	"encoding/json"
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

const maxImportBodyBytes = 16 * 1024

// StudentImportHandler binds the import service to the two HTTP routes.
type StudentImportHandler struct {
	svc *service.StudentImportService
	clk clock.Clock
}

// NewStudentImportHandler constructs the handler.
func NewStudentImportHandler(svc *service.StudentImportService, clk clock.Clock) *StudentImportHandler {
	return &StudentImportHandler{svc: svc, clk: clk}
}

type importPreviewRequest struct {
	Key string `json:"key"`
}

type importConfirmRequest struct {
	Key      string `json:"key"`
	ImportID string `json:"importId"`
}

// Preview — POST /api/students/import/preview. Advisory parse + classify.
func (h *StudentImportHandler) Preview(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBodyBytes)
	var body importPreviewRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if body.Key == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "key", Message: "required"}}}
	}

	preview, err := h.svc.PreviewImport(r.Context(), tc, body.Key)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, preview)
	return nil
}

// Confirm — POST /api/students/import. Authoritative re-classify + commit.
func (h *StudentImportHandler) Confirm(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBodyBytes)
	var body importConfirmRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if body.Key == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "key", Message: "required"}}}
	}
	// importId is `required` + `format: uuid` in api.yaml (P6) — enforce it so a
	// blank/garbage correlation id can't reach the audit payload.
	if _, err := uuid.Parse(body.ImportID); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "importId", Message: "required and must be a valid UUID"}}}
	}

	result, err := h.svc.ConfirmImport(r.Context(), tc, body.Key, body.ImportID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, result)
	return nil
}
