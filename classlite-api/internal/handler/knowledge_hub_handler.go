// Package handler — Story 4.4a KnowledgeHubHandler.
//
// Folder + file management + storage usage on the knowledgeChain (extractTenant
// → requireVerified → requireCenter → ErrorMapper). Role (owner/admin/teacher;
// student → 403) is enforced in the service (SEC-1). All responses use the
// {data} / {data,meta} envelope with explicit nulls (GO-5). The confirm→create
// upload path lives on UploadHandler; this handler owns the post-upload CRUD.
package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

const (
	maxKnowledgeBodyBytes = 16 * 1024
	knowledgeTimeFormat   = time.RFC3339Nano
)

// KnowledgeHubHandler serves the folder/file/storage endpoints.
type KnowledgeHubHandler struct {
	svc *service.FileService
	clk clock.Clock
}

func NewKnowledgeHubHandler(svc *service.FileService, clk clock.Clock) *KnowledgeHubHandler {
	return &KnowledgeHubHandler{svc: svc, clk: clk}
}

// --- wire shapes ---

type fileResponse struct {
	ID          string  `json:"id"`
	CenterID    string  `json:"centerId"`
	FolderID    *string `json:"folderId"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	ObjectKey   string  `json:"objectKey"`
	ContentType string  `json:"contentType"`
	SizeBytes   int64   `json:"sizeBytes"`
	UploadedBy  *string `json:"uploadedBy"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

type folderResponse struct {
	ID             string  `json:"id"`
	CenterID       string  `json:"centerId"`
	ParentFolderID *string `json:"parentFolderId"`
	Name           string  `json:"name"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

type linkedLocationResponse struct {
	Type  string `json:"type"`
	ID    string `json:"id"`
	Label string `json:"label"`
}

type fileDetailResponse struct {
	fileResponse
	LinkedLocations []linkedLocationResponse `json:"linkedLocations"`
}

type storageUsageResponse struct {
	UsedBytes  int64 `json:"usedBytes"`
	LimitBytes int64 `json:"limitBytes"`
}

type downloadUrlResponse struct {
	URL string `json:"url"`
}

func fileToResponse(f generated.File) fileResponse {
	return fileResponse{
		ID:          uuidPgToString(f.ID),
		CenterID:    uuidPgToString(f.CenterID),
		FolderID:    uuidPgToPtr(f.FolderID),
		Name:        f.Name,
		Slug:        f.Slug,
		ObjectKey:   f.ObjectKey,
		ContentType: f.ContentType,
		SizeBytes:   f.SizeBytes,
		UploadedBy:  uuidPgToPtr(f.UploadedBy),
		CreatedAt:   f.CreatedAt.Time.UTC().Format(knowledgeTimeFormat),
		UpdatedAt:   f.UpdatedAt.Time.UTC().Format(knowledgeTimeFormat),
	}
}

func folderToResponse(f generated.Folder) folderResponse {
	return folderResponse{
		ID:             uuidPgToString(f.ID),
		CenterID:       uuidPgToString(f.CenterID),
		ParentFolderID: uuidPgToPtr(f.ParentFolderID),
		Name:           f.Name,
		CreatedAt:      f.CreatedAt.Time.UTC().Format(knowledgeTimeFormat),
		UpdatedAt:      f.UpdatedAt.Time.UTC().Format(knowledgeTimeFormat),
	}
}

// --- request bodies ---

type createFolderRequestBody struct {
	Name           string  `json:"name"`
	ParentFolderID *string `json:"parentFolderId"`
}

type updateFolderRequestBody struct {
	Name           *string      `json:"name"`
	ParentFolderID optionalUUID `json:"parentFolderId"`
}

type updateFileRequestBody struct {
	Name     *string      `json:"name"`
	FolderID optionalUUID `json:"folderId"`
}

// optionalUUID captures PATCH tri-state for a nullable folder pointer: an absent
// key never calls UnmarshalJSON (set stays false → unchanged); explicit null
// leaves value nil (move to root); a uuid string sets it (reparent).
type optionalUUID struct {
	set   bool
	value *uuid.UUID
}

func (o *optionalUUID) UnmarshalJSON(b []byte) error {
	o.set = true
	if string(b) == "null" {
		o.value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	id, err := uuid.Parse(s)
	if err != nil {
		return err
	}
	o.value = &id
	return nil
}

// --- folder handlers ---

func (h *KnowledgeHubHandler) ListFolders(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	folders, err := h.svc.ListFolders(r.Context(), tc)
	if err != nil {
		return err
	}
	items := make([]folderResponse, len(folders))
	for i, f := range folders {
		items[i] = folderToResponse(f)
	}
	WriteJSON(w, http.StatusOK, items)
	return nil
}

func (h *KnowledgeHubHandler) CreateFolder(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxKnowledgeBodyBytes)
	var body createFolderRequestBody
	if err := decodeExerciseJSONBody(r.Body, &body); err != nil {
		return err
	}
	parent, err := parseOptionalUUIDString(body.ParentFolderID, "parentFolderId")
	if err != nil {
		return err
	}
	folder, err := h.svc.CreateFolder(r.Context(), tc, service.CreateFolderInput{Name: body.Name, ParentFolderID: parent})
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusCreated, folderToResponse(*folder))
	return nil
}

func (h *KnowledgeHubHandler) UpdateFolder(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "FOLDER_NOT_FOUND", "folder")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxKnowledgeBodyBytes)
	var body updateFolderRequestBody
	if err := decodeExerciseJSONBody(r.Body, &body); err != nil {
		return err
	}
	folder, err := h.svc.RenameMoveFolder(r.Context(), tc, id, service.UpdateFolderInput{
		Name:   body.Name,
		Parent: service.TriUUID{Set: body.ParentFolderID.set, Value: body.ParentFolderID.value},
	})
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, folderToResponse(*folder))
	return nil
}

func (h *KnowledgeHubHandler) DeleteFolder(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "FOLDER_NOT_FOUND", "folder")
	if err != nil {
		return err
	}
	if err := h.svc.SoftDeleteFolder(r.Context(), tc, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- file handlers ---

func (h *KnowledgeHubHandler) ListFiles(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	var folderID *uuid.UUID
	if raw := strings.TrimSpace(r.URL.Query().Get("folderId")); raw != "" {
		id, perr := uuid.Parse(raw)
		if perr != nil {
			return model.ValidationError{Fields: []model.FieldError{{Field: "folderId", Message: "must be a uuid"}}}
		}
		folderID = &id
	}
	files, err := h.svc.ListFiles(r.Context(), tc, folderID)
	if err != nil {
		return err
	}
	items := make([]fileResponse, len(files))
	for i, f := range files {
		items[i] = fileToResponse(f)
	}
	WriteJSON(w, http.StatusOK, items)
	return nil
}

func (h *KnowledgeHubHandler) GetFileDetail(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	slug := strings.TrimSpace(r.PathValue("slug"))
	if slug == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "slug", Message: "path parameter required"}}}
	}
	detail, err := h.svc.GetFileDetail(r.Context(), tc, slug)
	if err != nil {
		return err
	}
	links := make([]linkedLocationResponse, len(detail.LinkedLocations))
	for i, l := range detail.LinkedLocations {
		links[i] = linkedLocationResponse{Type: l.Type, ID: l.ID, Label: l.Label}
	}
	WriteJSON(w, http.StatusOK, fileDetailResponse{
		fileResponse:    fileToResponse(detail.Row),
		LinkedLocations: links,
	})
	return nil
}

// DownloadFile returns a short-lived presigned GET URL for a file's stored
// object (Story 4.4b — AC5 preview/download). Resolved by slug within the
// caller's tenant; the URL itself is redacted from logs (A10).
func (h *KnowledgeHubHandler) DownloadFile(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	slug := strings.TrimSpace(r.PathValue("slug"))
	if slug == "" {
		return model.ValidationError{Fields: []model.FieldError{{Field: "slug", Message: "path parameter required"}}}
	}
	// disposition=attachment forces a download (Content-Disposition) with the
	// original filename; omitted → inline, so the same URL backs the preview.
	attachment := r.URL.Query().Get("disposition") == "attachment"
	url, err := h.svc.GetFileDownloadURL(r.Context(), tc, slug, attachment)
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, downloadUrlResponse{URL: url})
	return nil
}

func (h *KnowledgeHubHandler) UpdateFile(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "FILE_NOT_FOUND", "file")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxKnowledgeBodyBytes)
	var body updateFileRequestBody
	if err := decodeExerciseJSONBody(r.Body, &body); err != nil {
		return err
	}
	file, err := h.svc.RenameMoveFile(r.Context(), tc, id, service.UpdateFileInput{
		Name:   body.Name,
		Folder: service.TriUUID{Set: body.FolderID.set, Value: body.FolderID.value},
	})
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, fileToResponse(*file))
	return nil
}

func (h *KnowledgeHubHandler) DeleteFile(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "FILE_NOT_FOUND", "file")
	if err != nil {
		return err
	}
	if err := h.svc.SoftDeleteFile(r.Context(), tc, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// --- storage usage ---

func (h *KnowledgeHubHandler) StorageUsage(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	used, limit, err := h.svc.StorageUsage(r.Context(), tc)
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, storageUsageResponse{UsedBytes: used, LimitBytes: limit})
	return nil
}

// parseOptionalUUIDString parses a nullable *string uuid field (create-folder
// parent). nil/empty → nil (root); a value must parse as a uuid.
func parseOptionalUUIDString(raw *string, field string) (*uuid.UUID, error) {
	if raw == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, nil
	}
	id, err := uuid.Parse(trimmed)
	if err != nil {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: field, Message: "must be a uuid"}}}
	}
	return &id, nil
}
