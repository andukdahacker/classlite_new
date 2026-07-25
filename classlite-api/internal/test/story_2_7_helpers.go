// Story 2.7 — Bulk Student Import test harness (GRADUATED to the normal suite).
//
// Authored red-phase under `-tags atdd_red_phase`; Task 11 turned it green and
// dropped the build tag, so these helpers now compile + run in the default
// suite — exactly how enrollment_handler_atdd_test.go graduated after 3.4.5.
//
// The owner/admin route chain mirrors cmd/api/main.go settingsInviteChain
// (extractTenant → requireVerified → requireCenter → RequireRole → ErrorMapper).
package test

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// StudentImportTestServer bundles the wired mux with the in-memory storage mock
// so a test can seed the "uploaded" CSV/XLSX bytes for a given object key
// (server-side parse reads them back via StorageService.GetObject) and then
// drive the preview/confirm endpoints with its own per-role bearer token.
type StudentImportTestServer struct {
	Mux     http.Handler
	Storage *service.MockStorageService
}

// NewStudentImportTestServerBareMux mounts the two import routes on the exact
// owner/admin production chain WITHOUT auth injection, so one test can exercise
// owner/admin/teacher/student callers by supplying its own bearer token (role is
// re-validated from center_members in the service tx — SEC-1/R15). Mirrors
// NewEnrollmentTestServerBareMux (story_3_4_5_helpers.go), adding RequireRole.
func NewStudentImportTestServerBareMux(t *testing.T, db storyDB) StudentImportTestServer {
	t.Helper()

	storage := service.NewMockStorageService()
	auditSvc := service.NewAuditService(db)
	importSvc := service.NewStudentImportService(db, storage, auditSvc, clock.RealClock{})
	importHandler := handler.NewStudentImportHandler(importSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwnerAdmin := middleware.RequireRole("owner", "admin")
	chain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwnerAdmin(http.HandlerFunc(middleware.ErrorMapper(h))),
				),
			),
		)
	}

	mux := http.NewServeMux()
	mux.Handle("POST /api/students/import/preview", chain(importHandler.Preview))
	mux.Handle("POST /api/students/import", chain(importHandler.Confirm))
	return StudentImportTestServer{Mux: mux, Storage: storage}
}

// NewStudentImportServiceForTest returns the raw service + storage mock for
// integration tests that call PreviewImport/ConfirmImport directly (no HTTP),
// e.g. the concurrency, parse-edge, and RLS-isolation scenarios that need to
// assert persisted rows or drive two concurrent confirms against the committed
// pool. Pass a raw pool (SetupRawPool) when the test needs cross-connection
// visibility; a SetupDB TxDB is fine for single-connection assertions.
func NewStudentImportServiceForTest(t *testing.T, db storyDB) (*service.StudentImportService, *service.MockStorageService) {
	t.Helper()
	storage := service.NewMockStorageService()
	auditSvc := service.NewAuditService(db)
	importSvc := service.NewStudentImportService(db, storage, auditSvc, clock.RealClock{})
	return importSvc, storage
}

// failingAuditLogger returns a non-nil error from LogWithinTx so the confirm
// path's commit-time audit fails — proving the whole import rolls back (AC5).
type failingAuditLogger struct{}

func (failingAuditLogger) LogWithinTx(
	_ context.Context, _ pgx.Tx, _ model.TenantContext,
	_ string, _ string, _ uuid.UUID, _ any,
) error {
	return errors.New("injected audit failure")
}

// NewStudentImportServiceWithFailingAudit builds an import service whose audit
// LogWithinTx always fails — the INT-BULK-ROLLBACK fault seam (AC5). All row
// writes succeed inside their savepoints, then the audit error forces a full
// rollback → 0 persisted.
func NewStudentImportServiceWithFailingAudit(t *testing.T, db storyDB) (*service.StudentImportService, *service.MockStorageService) {
	t.Helper()
	storage := service.NewMockStorageService()
	importSvc := service.NewStudentImportService(db, storage, failingAuditLogger{}, clock.RealClock{})
	return importSvc, storage
}
