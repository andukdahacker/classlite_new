package handler

import (
	"io"
	"log/slog"
	"net/http"

	"github.com/ducdo/classlite-api/internal/service"
)

// mockR2SinkMaxBytes caps a single sink PUT so a dev-only route can never be
// used to exhaust process memory. Speaking fixtures are a few KiB; 50 MiB is far
// above any legitimate recording while staying bounded.
const mockR2SinkMaxBytes = 50 << 20 // 50 MiB

// MockR2SinkHandler is a DEV-ONLY in-process stand-in for the R2 object store's
// presigned-PUT endpoint (Story 11-5a). It exists so a browser-driven
// presign→PUT→confirm upload (the speaking money-path leg) can round-trip in a
// credentials-free stack where `MockStorageService` is wired instead of real R2.
//
// It is mounted ONLY when APP_ENV=development AND no R2 is configured
// (cmd/api/main.go), on the root mux so it bypasses auth/OriginCheck exactly
// like a real signed-URL PUT (the object key already carries the tenant prefix,
// and the mock is never reachable in production). It mimics R2's contract: it
// stores the bytes under the request's object key and returns a bare 200 with no
// envelope (R2 returns an empty 200 on a successful PUT), so the SPA's upload
// code path is unchanged from the real one.
type MockR2SinkHandler struct {
	// Storage is the in-process mock the PUT bytes are seeded into.
	Storage *service.MockStorageService
}

// NewMockR2SinkHandler constructs the dev-only sink over the given mock storage.
func NewMockR2SinkHandler(storage *service.MockStorageService) *MockR2SinkHandler {
	return &MockR2SinkHandler{Storage: storage}
}

// Put stores the request body under the object key captured from the path
// (`{key...}` wildcard), mirroring an R2 presigned PUT. The browser's upload
// code targets the URL returned by Presign (pointed here via SetSinkBase), so
// the subsequent HeadObject in `/api/uploads/confirm` sees the real stored size.
func (h *MockR2SinkHandler) Put(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if key == "" {
		http.Error(w, "missing object key", http.StatusBadRequest)
		return
	}
	// LimitReader(cap+1) lets us detect an over-cap body deterministically.
	body, err := io.ReadAll(io.LimitReader(r.Body, mockR2SinkMaxBytes+1))
	if err != nil {
		http.Error(w, "read body failed", http.StatusBadRequest)
		return
	}
	if int64(len(body)) > mockR2SinkMaxBytes {
		http.Error(w, "object too large", http.StatusRequestEntityTooLarge)
		return
	}
	// Preserve the Content-Type the client PUT with (what Presign signed), so a confirm
	// HeadObject sees the real stored type — R2 does the same. Empty → octet-stream.
	h.Storage.SeedObjectWithContentType(key, body, r.Header.Get("Content-Type"))
	slog.DebugContext(r.Context(), "mock_r2_sink_put", "object_key", key, "bytes", len(body))
	// R2 returns an empty 200 on a successful PUT — mirror that (no envelope).
	w.WriteHeader(http.StatusOK)
}
