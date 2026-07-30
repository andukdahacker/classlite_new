// Package handler — presigned upload endpoints (Story 1.2e, hardened in 4.4a).
//
// Presign: validates the MIME allowlist + extension↔Content-Type lock, enforces
// the A9 per-feature size cap on the declared sizeBytes BEFORE signing (layer 2
// — 413 FILE_TOO_LARGE), and does an ADVISORY storage pre-check (409 fast-fail,
// NON-authoritative) so the user isn't told "ok" then rejected after a 50 MB PUT.
//
// Confirm: re-checks the {center_id} key prefix vs the JWT tenant (403
// R2_KEY_PREFIX_MISMATCH + audit — AC9a) BEFORE touching storage, then for a
// `knowledge` key hands off to FileService.ConfirmUpload, which HeadObject-
// re-validates size/type (delete-on-mismatch), enforces the storage ceiling
// under a per-center lock, and creates the idempotent files row. Non-knowledge
// features keep the Story 1.2e verify-and-return-metadata behavior.
//
// Tenant resolution reads the canonical TenantContext (set by ExtractTenant on
// the knowledge chain) and falls back to the model.TenantID string key so the
// pre-middleware ATDD harnesses keep working.
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

const presignExpiry = 5 * time.Minute // A10 #4 — locked at 5 min (do not regress to 1.2e's 15).

// UploadHandler handles presigned URL upload operations. Files/Audit/Clock are
// optional: the presign-only ATDD canary constructs the struct with just
// Storage. The knowledge confirm→create path requires Files; the prefix-mismatch
// audit requires Audit.
type UploadHandler struct {
	Storage service.StorageService
	Files   *service.FileService
	Audit   *service.AuditService
	Clock   clock.Clock
}

// NewUploadHandler wires the full hardened handler (production + confirm tests).
func NewUploadHandler(files *service.FileService, storage service.StorageService, audit *service.AuditService, clk clock.Clock) *UploadHandler {
	return &UploadHandler{Storage: storage, Files: files, Audit: audit, Clock: clk}
}

type presignRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Feature     string `json:"feature"`
	SizeBytes   int64  `json:"sizeBytes"`
}

type presignResponse struct {
	URL string `json:"url"`
	Key string `json:"key"`
}

type confirmRequest struct {
	Key       string  `json:"key"`
	Name      *string `json:"name"`
	FolderID  *string `json:"folderId"`
	SizeBytes int64   `json:"sizeBytes"`
}

// tenantForUpload reads the canonical TenantContext, falling back to the raw
// model.TenantID string (ATDD harnesses that bypass ExtractTenant set only that).
func tenantForUpload(r *http.Request) (model.TenantContext, error) {
	if tc, ok := model.TenantFromContext(r.Context()); ok && tc.CenterID != "" {
		return tc, nil
	}
	if centerID, _ := r.Context().Value(model.TenantID).(string); centerID != "" {
		return model.TenantContext{CenterID: centerID}, nil
	}
	return model.TenantContext{}, model.ForbiddenError{Reason: "tenant context required for uploads"}
}

// Presign generates a presigned PUT URL for direct browser upload.
func (h *UploadHandler) Presign(w http.ResponseWriter, r *http.Request) error {
	var req presignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	var fields []model.FieldError
	if req.Filename == "" {
		fields = append(fields, model.FieldError{Field: "filename", Message: "required"})
	}
	if req.ContentType == "" {
		fields = append(fields, model.FieldError{Field: "contentType", Message: "required"})
	}
	if req.Feature == "" {
		fields = append(fields, model.FieldError{Field: "feature", Message: "required"})
	}
	// sizeBytes is optional (0/absent = unknown; layer-4 confirm is authoritative
	// for knowledge). A negative value is never valid and would silently defeat
	// both the layer-2 413 gate and the advisory storage pre-check below.
	if req.SizeBytes < 0 {
		fields = append(fields, model.FieldError{Field: "sizeBytes", Message: "must not be negative"})
	}
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}

	ext := strings.ToLower(filepath.Ext(req.Filename))
	expectedMIME, extAllowed := service.AllowedExtensions[ext]
	if !extAllowed {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "filename", Message: fmt.Sprintf("file type %s is not allowed", ext)},
		}}
	}
	if req.ContentType != expectedMIME {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "contentType", Message: fmt.Sprintf("expected %s for %s files", expectedMIME, ext)},
		}}
	}
	if !service.AllowedFeatures[req.Feature] {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "feature", Message: fmt.Sprintf("unknown feature %q", req.Feature)},
		}}
	}

	tc, err := tenantForUpload(r)
	if err != nil {
		return err
	}

	// A9 layer 2 — reject over-cap BEFORE signing (413 FILE_TOO_LARGE, message
	// carries the cap in MB). The authoritative guard is the confirm HeadObject
	// re-validation (layer 4); this is the fast client-facing rejection.
	if cap, ok := service.MaxUploadBytes(req.Feature, ext); ok && req.SizeBytes > cap {
		return service.FileTooLargeError{Feature: req.Feature, Ext: ext, LimitBytes: cap, GotBytes: req.SizeBytes}
	}

	// Advisory storage pre-check (AC12) — a fast-fail UX 409 so the user isn't
	// told "ok" then rejected after uploading. EXPLICITLY non-authoritative: the
	// binding ceiling is re-checked under a per-center lock at confirm. Skipped
	// when no FileService is wired (the presign-only canary).
	if h.Files != nil {
		used, limit, uerr := h.Files.StorageUsage(r.Context(), tc)
		if uerr != nil {
			return uerr
		}
		if used+req.SizeBytes > limit {
			return service.StorageFullError{UsedBytes: used, LimitBytes: limit, RequestedBytes: req.SizeBytes}
		}
	}

	key := fmt.Sprintf("%s/%s/%s%s", tc.CenterID, req.Feature, uuid.New().String(), ext)
	url, err := h.Storage.Presign(r.Context(), key, req.ContentType, presignExpiry)
	if err != nil {
		return fmt.Errorf("generate presigned url: %w", err)
	}

	WriteJSON(w, http.StatusOK, presignResponse{URL: url, Key: key})
	return nil
}

// Confirm verifies a completed upload. For a knowledge key it creates the files
// row (hardened + serialized + idempotent); other features keep the 1.2e
// verify-and-return-metadata behavior.
func (h *UploadHandler) Confirm(w http.ResponseWriter, r *http.Request) error {
	var req confirmRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if req.Key == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "key", Message: "required"}}}
	}

	tc, err := tenantForUpload(r)
	if err != nil {
		return err
	}

	// SEC-8 — the key's {center_id} prefix MUST match the caller's tenant. This
	// precedes ANY storage access. A mismatch is audited (AC9a) then 403.
	if !strings.HasPrefix(req.Key, tc.CenterID+"/") {
		h.auditPrefixMismatch(r, tc, req.Key)
		return service.KeyPrefixMismatchError{}
	}

	_, feature, _, ok := service.ParseObjectKey(req.Key)
	if !ok {
		return model.ValidationError{Fields: []model.FieldError{{Field: "key", Message: "malformed object key"}}}
	}

	// Knowledge uploads become Hub files (hardened confirm→create).
	if feature == service.FeatureKnowledge && h.Files != nil {
		folderID, ferr := parseOptionalUUIDString(req.FolderID, "folderId")
		if ferr != nil {
			return ferr
		}
		name := ""
		if req.Name != nil {
			name = *req.Name
		}
		file, cerr := h.Files.ConfirmUpload(r.Context(), tc, service.ConfirmUploadInput{
			ObjectKey: req.Key,
			Name:      name,
			SizeBytes: req.SizeBytes,
			FolderID:  folderID,
		})
		if cerr != nil {
			return cerr
		}
		WriteJSON(w, http.StatusCreated, fileToResponse(*file))
		return nil
	}

	// Non-knowledge features (imports/speaking/avatars) — Story 1.2e behavior:
	// verify the object exists and echo its metadata.
	meta, err := h.Storage.HeadObject(r.Context(), req.Key)
	if err != nil {
		return model.NotFoundError{Resource: "upload", ID: req.Key, Code: "UPLOAD_NOT_FOUND"}
	}
	WriteJSON(w, http.StatusOK, meta)
	return nil
}

// auditPrefixMismatch records the R2_KEY_PREFIX_MISMATCH security event (AC9a).
// Best-effort: an audit failure never changes the 403 outcome. Skipped when no
// audit logger or no acting user is available (the production knowledge chain
// always supplies both).
func (h *UploadHandler) auditPrefixMismatch(r *http.Request, tc model.TenantContext, key string) {
	if h.Audit == nil || tc.UserID == "" {
		return
	}
	_ = h.Audit.Log(r.Context(), tc, "R2_KEY_PREFIX_MISMATCH", "upload", uuid.Nil,
		service.Changes{After: map[string]any{"attemptedKey": key}})
}
