// Story 7.2a — student roster + detail + notes test-server helper.
//
// Mounts the six student routes on the EXACT production middleware chain
// (cmd/api/main.go): RequireRole("owner","admin","teacher") — students → 403 at
// the edge; role-scope + 404 non-disclosure + note-write SEC-1 live in the
// service. Mirrors NewStaffTestServerForRole (story_7_1a_helpers.go): the test
// controls the caller's DB role via CreateCenterMember (what ExtractTenant reads
// and RequireRole enforces); this helper only marks the caller email_verified
// and injects the Bearer token.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/time/rate"
)

// NewStudentTestServerForRole mounts the student routes with a caller whose JWT
// claims match `role`. The caller's center_members row is created by the test.
func NewStudentTestServerForRole(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	role string,
) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newStudentSrv(t, db), token: tok}
}

func newStudentSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	studentSvc := service.NewStudentService(db, clock.RealClock{})
	studentHandler := handler.NewStudentHandler(studentSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireStudentReadRole := middleware.RequireRole("owner", "admin", "teacher")
	studentLimit := middleware.RateLimitByKey(
		"students-7-2a-test-"+uuid.NewString(),
		rate.Every(60*time.Second),
		600,
		middleware.UserAndIPKeyFn,
	)
	readChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireStudentReadRole(
						studentLimit(http.HandlerFunc(middleware.ErrorMapper(h))),
					),
				),
			),
		)
	}
	mux.Handle("GET /api/students", readChain(studentHandler.List))
	mux.Handle("GET /api/students/{id}", readChain(studentHandler.GetDetail))
	mux.Handle("GET /api/students/{id}/notes", readChain(studentHandler.ListNotes))
	mux.Handle("POST /api/students/{id}/notes", readChain(studentHandler.CreateNote))
	mux.Handle("PATCH /api/students/{id}/notes/{noteId}", readChain(studentHandler.SetNoteFlag))
	mux.Handle("DELETE /api/students/{id}/notes/{noteId}", readChain(studentHandler.DeleteNote))
	return mux
}
