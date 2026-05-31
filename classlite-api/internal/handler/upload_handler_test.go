package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

func uploadHandler() *handler.UploadHandler {
	return &handler.UploadHandler{Storage: service.NewMockStorageService()}
}

func presignReq(body string) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/presign", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.TenantID, "center-123")
	ctx = context.WithValue(ctx, model.RequestID, "req-test")
	return req.WithContext(ctx)
}

func TestPresign_ValidPDF(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	req := presignReq(`{"filename":"notes.pdf","contentType":"application/pdf","feature":"knowledge"}`)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data struct {
			URL string `json:"url"`
			Key string `json:"key"`
		} `json:"data"`
	}
	json.NewDecoder(rec.Body).Decode(&resp)

	if resp.Data.URL == "" {
		t.Error("expected presigned URL")
	}
	if resp.Data.Key == "" {
		t.Error("expected object key")
	}
	if !bytes.HasPrefix([]byte(resp.Data.Key), []byte("center-123/knowledge/")) {
		t.Errorf("key should start with center-123/knowledge/, got %s", resp.Data.Key)
	}
}

func TestPresign_DisallowedExtension(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	req := presignReq(`{"filename":"virus.exe","contentType":"application/octet-stream","feature":"knowledge"}`)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rec.Code)
	}
}

func TestPresign_MissingFields(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	req := presignReq(`{"filename":""}`)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rec.Code)
	}
}

func TestPresign_InvalidJSON(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	req := presignReq(`not json`)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rec.Code)
	}
}

func TestConfirm_ObjectExists(t *testing.T) {
	mock := service.NewMockStorageService()
	mock.Objects["center-123/knowledge/abc.pdf"] = &service.ObjectMeta{
		Key:         "center-123/knowledge/abc.pdf",
		ContentType: "application/pdf",
		Size:        12345,
	}
	uh := &handler.UploadHandler{Storage: mock}
	h := middleware.ErrorMapper(uh.Confirm)

	body := `{"key":"center-123/knowledge/abc.pdf"}`
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/confirm", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.TenantID, "center-123")
	ctx = context.WithValue(ctx, model.RequestID, "req-test")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		Data service.ObjectMeta `json:"data"`
	}
	json.NewDecoder(rec.Body).Decode(&resp)

	if resp.Data.Size != 12345 {
		t.Errorf("expected size 12345, got %d", resp.Data.Size)
	}
}

func TestConfirm_ObjectNotFound(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Confirm)

	body := `{"key":"center-123/knowledge/nonexistent.pdf"}`
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/confirm", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.TenantID, "center-123")
	ctx = context.WithValue(ctx, model.RequestID, "req-test")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rec.Code)
	}
}

func TestConfirm_EmptyKey(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Confirm)

	body := `{"key":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/confirm", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.TenantID, "center-123")
	ctx = context.WithValue(ctx, model.RequestID, "req-test")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", rec.Code)
	}
}

func TestPresign_AllowedExtensions(t *testing.T) {
	cases := []struct {
		filename    string
		contentType string
	}{
		{"test.pdf", "application/pdf"},
		{"img.png", "image/png"},
		{"photo.jpg", "image/jpeg"},
		{"pic.jpeg", "image/jpeg"},
		{"icon.svg", "image/svg+xml"},
		{"audio.mp3", "audio/mpeg"},
		{"sound.wav", "audio/wav"},
		{"video.webm", "audio/webm"},
	}
	for _, tc := range cases {
		h := middleware.ErrorMapper(uploadHandler().Presign)
		body := fmt.Sprintf(`{"filename":"%s","contentType":"%s","feature":"knowledge"}`, tc.filename, tc.contentType)
		req := presignReq(body)
		rec := httptest.NewRecorder()

		h.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("%s: expected 200, got %d: %s", tc.filename, rec.Code, rec.Body.String())
		}
	}
}

func TestPresign_MismatchedContentType(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	req := presignReq(`{"filename":"notes.pdf","contentType":"text/html","feature":"knowledge"}`)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for mismatched content type, got %d", rec.Code)
	}
}

func TestPresign_InvalidFeature(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	req := presignReq(`{"filename":"notes.pdf","contentType":"application/pdf","feature":"../../admin"}`)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422 for invalid feature, got %d", rec.Code)
	}
}

func TestPresign_NoTenantContext(t *testing.T) {
	h := middleware.ErrorMapper(uploadHandler().Presign)
	// Request without TenantID in context.
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/presign",
		bytes.NewBufferString(`{"filename":"notes.pdf","contentType":"application/pdf","feature":"knowledge"}`))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.RequestID, "req-test")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 without tenant context, got %d", rec.Code)
	}
}

func TestConfirm_CrossTenantKeyRejected(t *testing.T) {
	mock := service.NewMockStorageService()
	mock.Objects["other-center/knowledge/abc.pdf"] = &service.ObjectMeta{
		Key: "other-center/knowledge/abc.pdf", ContentType: "application/pdf", Size: 100,
	}
	uh := &handler.UploadHandler{Storage: mock}
	h := middleware.ErrorMapper(uh.Confirm)

	body := `{"key":"other-center/knowledge/abc.pdf"}`
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/confirm", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.TenantID, "center-123")
	ctx = context.WithValue(ctx, model.RequestID, "req-test")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403 for cross-tenant key, got %d", rec.Code)
	}
}
