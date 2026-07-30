// Story 4.4a test harness — a bare-mux knowledge-hub + hardened-upload server
// (open chain: extractTenant → requireVerified → requireCenter → ErrorMapper,
// role enforced in-service) with an injectable StorageService so confirm/presign
// tests can drive HeadObject/Delete behavior. Mirrors NewExerciseTestServerBareMux.
package test

import (
	"context"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
)

// oneMB is the byte unit shared by the Story 4.4a test-package tests (the
// handler_test package defines its own).
const oneMB = 1024 * 1024

// NewKnowledgeHubTestServerBareMux mounts every Story 4.4a route with the given
// storage injected. Pass a seeded MockStorageService for confirm/presign tests;
// a fresh mock is fine for folder/file CRUD (which never touches storage).
func NewKnowledgeHubTestServerBareMux(t *testing.T, db storyDB, storage service.StorageService) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	fileSvc := service.NewFileService(db, storage, auditSvc, clock.RealClock{})
	uploadHandler := handler.NewUploadHandler(fileSvc, storage, auditSvc, clock.RealClock{})
	khHandler := handler.NewKnowledgeHubHandler(fileSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux := http.NewServeMux()
	mux.Handle("POST /api/uploads/presign", chain(uploadHandler.Presign))
	mux.Handle("POST /api/uploads/confirm", chain(uploadHandler.Confirm))
	mux.Handle("GET /api/storage/usage", chain(khHandler.StorageUsage))
	mux.Handle("GET /api/knowledge-hub/folders", chain(khHandler.ListFolders))
	mux.Handle("POST /api/knowledge-hub/folders", chain(khHandler.CreateFolder))
	mux.Handle("PATCH /api/knowledge-hub/folders/{id}", chain(khHandler.UpdateFolder))
	mux.Handle("DELETE /api/knowledge-hub/folders/{id}", chain(khHandler.DeleteFolder))
	mux.Handle("GET /api/knowledge-hub/files", chain(khHandler.ListFiles))
	mux.Handle("GET /api/knowledge-hub/files/{slug}", chain(khHandler.GetFileDetail))
	mux.Handle("GET /api/knowledge-hub/files/{slug}/download", chain(khHandler.DownloadFile))
	mux.Handle("PATCH /api/knowledge-hub/files/{id}", chain(khHandler.UpdateFile))
	mux.Handle("DELETE /api/knowledge-hub/files/{id}", chain(khHandler.DeleteFile))
	return mux
}

// SetCenterStorageLimit sets a center's ceiling via the superuser pool (the
// column is read-only in 4.4a, so tests poke it directly). Used by the
// storage-quota race + usage tests.
func SetCenterStorageLimit(t *testing.T, centerID pgtype.UUID, limitBytes int64) {
	t.Helper()
	sp := SuperuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`UPDATE centers SET storage_limit_bytes = $2 WHERE id = $1`, centerID, limitBytes,
	); err != nil {
		t.Fatalf("set storage limit: %v", err)
	}
}

// CountLiveFiles counts a center's non-deleted files via the superuser pool
// (bypasses RLS, so it reads correctly without a tenant context on the raw pool).
func CountLiveFiles(t *testing.T, centerID pgtype.UUID) int {
	t.Helper()
	sp := SuperuserPool(t)
	var n int
	if err := sp.QueryRow(context.Background(),
		`SELECT count(*) FROM files WHERE center_id = $1 AND deleted_at IS NULL`, centerID,
	).Scan(&n); err != nil {
		t.Fatalf("count live files: %v", err)
	}
	return n
}

// CleanupKnowledgeHub removes a center's Story 4.4a rows + memberships + the
// center itself + the given users via the superuser pool. Registered with
// t.Cleanup by the raw-pool tests (which commit, unlike the SetupDB tx tests).
func CleanupKnowledgeHub(t *testing.T, centerID pgtype.UUID, users ...pgtype.UUID) {
	t.Helper()
	sp := SuperuserPool(t)
	ctx := context.Background()
	_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE center_id = $1`, centerID)
	_, _ = sp.Exec(ctx, `DELETE FROM files WHERE center_id = $1`, centerID)
	_, _ = sp.Exec(ctx, `DELETE FROM folders WHERE center_id = $1`, centerID)
	_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerID)
	_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerID)
	for _, u := range users {
		_, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, u)
	}
}
