package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// Allowed file extensions and their expected MIME types (SEC-8).
var allowedExtensions = map[string]string{
	".pdf":  "application/pdf",
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".svg":  "image/svg+xml",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".webm": "audio/webm",
}

// Allowed feature path segments for key generation.
var allowedFeatures = map[string]bool{
	"knowledge": true,
	"speaking":  true,
	"avatars":   true,
}

// UploadHandler handles presigned URL upload operations.
type UploadHandler struct {
	Storage service.StorageService
}

type presignRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Feature     string `json:"feature"`
}

type presignResponse struct {
	URL string `json:"url"`
	Key string `json:"key"`
}

type confirmRequest struct {
	Key string `json:"key"`
}

// Presign generates a presigned PUT URL for direct browser upload.
func (h *UploadHandler) Presign(w http.ResponseWriter, r *http.Request) error {
	var req presignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "body", Message: "invalid JSON"},
		}}
	}

	if req.Filename == "" || req.ContentType == "" || req.Feature == "" {
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
		return model.ValidationError{Fields: fields}
	}

	ext := strings.ToLower(filepath.Ext(req.Filename))
	expectedMIME, extAllowed := allowedExtensions[ext]
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

	if !allowedFeatures[req.Feature] {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "feature", Message: fmt.Sprintf("unknown feature %q", req.Feature)},
		}}
	}

	centerID, _ := r.Context().Value(model.TenantID).(string)
	if centerID == "" {
		return model.ForbiddenError{Reason: "tenant context required for uploads"}
	}

	key := fmt.Sprintf("%s/%s/%s%s", centerID, req.Feature, uuid.New().String(), ext)

	url, err := h.Storage.Presign(r.Context(), key, req.ContentType, 5*time.Minute)
	if err != nil {
		return fmt.Errorf("generate presigned url: %w", err)
	}

	WriteJSON(w, http.StatusOK, presignResponse{URL: url, Key: key})
	return nil
}

// Confirm verifies a file was uploaded to R2 and returns its metadata.
func (h *UploadHandler) Confirm(w http.ResponseWriter, r *http.Request) error {
	var req confirmRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "body", Message: "invalid JSON"},
		}}
	}

	if req.Key == "" {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "key", Message: "required"},
		}}
	}

	// Verify the key belongs to the caller's tenant (SEC-8).
	centerID, _ := r.Context().Value(model.TenantID).(string)
	if centerID == "" {
		return model.ForbiddenError{Reason: "tenant context required for uploads"}
	}
	if !strings.HasPrefix(req.Key, centerID+"/") {
		return model.ForbiddenError{Reason: "key does not belong to your center"}
	}

	meta, err := h.Storage.HeadObject(r.Context(), req.Key)
	if err != nil {
		return model.NotFoundError{Resource: "upload", ID: req.Key}
	}

	WriteJSON(w, http.StatusOK, meta)
	return nil
}
