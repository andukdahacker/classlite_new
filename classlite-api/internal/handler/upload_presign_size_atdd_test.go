// Story 4.4a — ATDD RED canary (ACTIVE, compiles today, FAILS today).
//
// AC6 / AC7 layer 2: /uploads/presign must reject an oversized file with 413
// FILE_TOO_LARGE *before* generating the URL, using the request `sizeBytes`
// field, keyed by per-feature+extension caps (Knowledge Hub PDF 50 MB, image
// 15 MB, Listening audio 100 MB) held as named constants (CQ-3).
//
// WHY THIS IS THE ACTIVE CANARY (the only non-`_`-prefixed 4.4a scaffold):
//   - It compiles against TODAY's handler surface: it drives the existing
//     UploadHandler.Presign via middleware.ErrorMapper, and sends `sizeBytes`
//     as a raw JSON field. The current `presignRequest` struct has no such
//     field, so encoding/json silently ignores it — no compile break.
//   - It FAILS today: current Presign has no size guard and returns 200. This
//     test asserts 413, so it is genuinely RED until T4 lands the size gate.
//     That is the immediate red signal we want.
//
// GREEN CONTRACT for the dev (T4 + T7 + AC6):
//  1. api.yaml: add `sizeBytes` (int64) to the presign request body.
//  2. presignRequest gains `SizeBytes int64 json:"sizeBytes"`.
//  3. Named caps (T4/AC6, CQ-3), e.g. in a size_caps.go:
//     const knowledgePDFMaxBytes   = 50 * 1024 * 1024
//     const knowledgeImageMaxBytes = 15 * 1024 * 1024
//     const listeningAudioMaxBytes = 100 * 1024 * 1024
//     keyed by (feature, ext). Do NOT inline the literals.
//  4. Presign returns 413 with error code FILE_TOO_LARGE and an i18n message
//     that includes the cap in MB, BEFORE calling Storage.Presign.
//
// When it goes green, KEEP this file active — it is the layer-2 regression.
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

// presignSizeReq builds a presign request carrying an explicit sizeBytes.
func presignSizeReq(t *testing.T, filename, contentType, feature string, sizeBytes int64) *http.Request {
	t.Helper()
	body := fmt.Sprintf(
		`{"filename":%q,"contentType":%q,"feature":%q,"sizeBytes":%d}`,
		filename, contentType, feature, sizeBytes,
	)
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/presign", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(req.Context(), model.TenantID, "center-123")
	ctx = context.WithValue(ctx, model.RequestID, "req-test")
	return req.WithContext(ctx)
}

const oneMB = 1024 * 1024

// TestPresign_OversizedPDF_Returns413 is the RED canary.
func TestPresign_OversizedPDF_Returns413(t *testing.T) {
	h := middleware.ErrorMapper((&handler.UploadHandler{Storage: service.NewMockStorageService()}).Presign)
	// 60 MB PDF — over the 50 MB Knowledge Hub PDF cap.
	req := presignSizeReq(t, "huge.pdf", "application/pdf", "knowledge", 60*oneMB)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for a 60 MB PDF (50 MB cap), got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if resp.Error.Code != "FILE_TOO_LARGE" {
		t.Errorf("expected error code FILE_TOO_LARGE, got %q", resp.Error.Code)
	}
	// The message must surface the cap in MB so the UI can render it (AC6).
	if !bytes.Contains([]byte(resp.Error.Message), []byte("50")) {
		t.Errorf("expected 413 message to include the 50 MB cap, got %q", resp.Error.Message)
	}
}

// TestPresign_PerFeatureExtensionCaps drives the three locked A9 caps at their
// boundaries: just-under must be accepted, just-over must be 413. Table keyed
// by (feature, extension) — proves the caps are keyed, not a single global.
func TestPresign_PerFeatureExtensionCaps(t *testing.T) {
	cases := []struct {
		name        string
		filename    string
		contentType string
		feature     string
		sizeBytes   int64
		wantCode    int
	}{
		{"pdf under 50MB", "ok.pdf", "application/pdf", "knowledge", 49 * oneMB, http.StatusOK},
		{"pdf over 50MB", "big.pdf", "application/pdf", "knowledge", 51 * oneMB, http.StatusRequestEntityTooLarge},
		{"png under 15MB", "ok.png", "image/png", "knowledge", 14 * oneMB, http.StatusOK},
		{"png over 15MB", "big.png", "image/png", "knowledge", 16 * oneMB, http.StatusRequestEntityTooLarge},
		{"jpg over 15MB", "big.jpg", "image/jpeg", "knowledge", 16 * oneMB, http.StatusRequestEntityTooLarge},
		{"svg over 15MB", "big.svg", "image/svg+xml", "knowledge", 16 * oneMB, http.StatusRequestEntityTooLarge},
		// Listening/knowledge audio keeps the 100 MB cap (NO regression — Story 5.4
		// moved the shared `.webm`/`.mp3`/`.wav` audio caps behind the feature so
		// only `speaking` drops to 25 MB).
		{"mp3 under 100MB (knowledge)", "ok.mp3", "audio/mpeg", "knowledge", 99 * oneMB, http.StatusOK},
		{"mp3 over 100MB (knowledge)", "big.mp3", "audio/mpeg", "knowledge", 101 * oneMB, http.StatusRequestEntityTooLarge},
		{"wav over 100MB (knowledge)", "big.wav", "audio/wav", "knowledge", 101 * oneMB, http.StatusRequestEntityTooLarge},
		{"webm under 100MB (knowledge)", "ok.webm", "audio/webm", "knowledge", 99 * oneMB, http.StatusOK},
		// Story 5.4 (AC5,16, D3) — the 25 MB speaking cap, at its boundary, for
		// BOTH codec containers (webm on Chrome/Android, m4a on iOS Safari).
		{"speaking webm under 25MB", "take.webm", "audio/webm", "speaking", 24 * oneMB, http.StatusOK},
		{"speaking webm over 25MB", "take.webm", "audio/webm", "speaking", 26 * oneMB, http.StatusRequestEntityTooLarge},
		{"speaking m4a under 25MB", "take.m4a", "audio/mp4", "speaking", 24 * oneMB, http.StatusOK},
		{"speaking m4a over 25MB", "take.m4a", "audio/mp4", "speaking", 26 * oneMB, http.StatusRequestEntityTooLarge},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := middleware.ErrorMapper((&handler.UploadHandler{Storage: service.NewMockStorageService()}).Presign)
			req := presignSizeReq(t, tc.filename, tc.contentType, tc.feature, tc.sizeBytes)
			rec := httptest.NewRecorder()

			h.ServeHTTP(rec, req)

			if rec.Code != tc.wantCode {
				t.Errorf("%s: expected %d, got %d: %s", tc.name, tc.wantCode, rec.Code, rec.Body.String())
			}
		})
	}
}
