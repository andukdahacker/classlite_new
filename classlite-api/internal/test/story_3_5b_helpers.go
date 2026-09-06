// Story 3.5b — Attendance test-server helper. Mirrors
// NewSessionContentTestServerBareMux: the sessionChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT owner-gated) + the 3
// attendance routes over db WITHOUT auth injection, so one test can exercise
// owner/admin/teacher/student roles by supplying its own bearer token. Role
// (student → 403) + teacher-scope (non-owning teacher → 404) are enforced in the
// service. No clock — attendance has no now-floor.
package test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

func NewAttendanceTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	attendanceSvc := service.NewAttendanceService(db)
	attendanceHandler := handler.NewAttendanceHandler(attendanceSvc, clock.RealClock{})

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
	mux.Handle("GET /api/sessions/{id}/attendance", chain(attendanceHandler.GetRoster))
	mux.Handle("PUT /api/sessions/{id}/attendance/{studentId}", chain(attendanceHandler.SetOne))
	mux.Handle("POST /api/sessions/{id}/attendance/bulk", chain(attendanceHandler.BulkMark))
	return mux
}
