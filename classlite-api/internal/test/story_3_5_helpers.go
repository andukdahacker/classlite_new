// Story 3.5 — Session content test-server helper. Mirrors
// NewSessionTestServerBareMux: the sessionChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT owner-gated) + the 12
// content routes over db WITHOUT auth injection, so one test can exercise
// owner/admin/teacher/student roles by supplying its own bearer token. Role +
// teacher-scope are enforced in the service. No clock — content has no now-floor.
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

func NewSessionContentTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	contentSvc := service.NewSessionContentService(db, auditSvc)
	contentHandler := handler.NewSessionContentHandler(contentSvc, clock.RealClock{})

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
	mux.Handle("GET /api/sessions/{id}/notes", chain(contentHandler.ListNotes))
	mux.Handle("POST /api/sessions/{id}/notes", chain(contentHandler.CreateNote))
	mux.Handle("PATCH /api/sessions/{id}/notes/{noteId}", chain(contentHandler.UpdateNote))
	mux.Handle("DELETE /api/sessions/{id}/notes/{noteId}", chain(contentHandler.DeleteNote))
	mux.Handle("GET /api/sessions/{id}/materials", chain(contentHandler.ListMaterials))
	mux.Handle("POST /api/sessions/{id}/materials", chain(contentHandler.CreateMaterial))
	mux.Handle("PATCH /api/sessions/{id}/materials/{materialId}", chain(contentHandler.UpdateMaterial))
	mux.Handle("DELETE /api/sessions/{id}/materials/{materialId}", chain(contentHandler.DeleteMaterial))
	mux.Handle("GET /api/sessions/{id}/exercises", chain(contentHandler.ListExercises))
	mux.Handle("POST /api/sessions/{id}/exercises", chain(contentHandler.CreateExercise))
	mux.Handle("PATCH /api/sessions/{id}/exercises/{exerciseId}", chain(contentHandler.UpdateExercise))
	mux.Handle("DELETE /api/sessions/{id}/exercises/{exerciseId}", chain(contentHandler.DeleteExercise))
	return mux
}
