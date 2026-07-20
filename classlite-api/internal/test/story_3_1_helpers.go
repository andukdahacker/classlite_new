// Story 3.1 — Class CRUD test-server helper + SeedClass fixture.
//
// NewClassTestServerBareMux wires the classChain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT owner-gated) + the 5
// class routes over db WITHOUT auth injection: each request supplies its own
// bearer token, so one test can exercise owner/admin/teacher roles.
package test

import (
	"context"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

func NewClassTestServerBareMux(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	auditSvc := service.NewAuditService(db)
	inviter := service.NewEmailRetryQueue(&service.MockEmailSender{}, 4)
	classSvc := service.NewClassService(db, auditSvc, inviter, clock.RealClock{})
	classHandler := handler.NewClassHandler(classSvc, clock.RealClock{})

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
	mux.Handle("GET /api/classes", chain(classHandler.List))
	mux.Handle("POST /api/classes", chain(classHandler.Create))
	mux.Handle("GET /api/classes/{id}", chain(classHandler.Get))
	mux.Handle("PATCH /api/classes/{id}", chain(classHandler.Update))
	mux.Handle("POST /api/classes/{id}/status", chain(classHandler.TransitionStatus))
	return mux
}

// SeedClass inserts a class row via the superuser pool (bypasses FORCE RLS)
// for store + handler test setup. Honors classes_teacher_mutex: pass exactly
// one of teacherID / pendingEmail non-nil.
func SeedClass(t *testing.T, centerID, name, status string, teacherID, pendingEmail *string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := superuserPool(t).Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id, pending_teacher_email, start_date)
		 VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6, current_date + interval '30 days')`,
		id, centerID, name, status, teacherID, pendingEmail,
	)
	if err != nil {
		t.Fatalf("SeedClass(%s, %s): %v", name, status, err)
	}
	return id
}
