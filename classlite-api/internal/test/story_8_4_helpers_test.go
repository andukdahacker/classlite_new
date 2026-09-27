// Story 8.4a — global-search test-server helper + raw label seeds.
//
// NewSearchTestServerForRole mounts GET /api/search on the EXACT production
// middleware chain (cmd/api/main.go): the UNGATED dashboardChain shape —
// extractTenant → requireVerified → requireCenter → ErrorMapper, with NO
// RequireRole (D5), so every role reaches the handler and the SERVICE returns its
// own scoped payload. ExtractTenant trusts the DB center_members role (auth.go:70),
// so every caller must have a CreateCenterMember row with the intended role.
//
// The seed helpers take an explicit searchable label (name/title) — the shipped
// insert*Raw helpers hardcode labels, and the whole point of these tests is to drive
// distinct query tokens. Each is context-free (a pure INSERT); the caller sets the
// tenant GUC via TenantContext(t, db, centerPg) before seeding a center's rows so the
// RLS WITH CHECK (center_id = current tenant) passes.
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// searchEnvelope decodes the {data, meta} response into the typed service DTOs so
// tests assert on typed fields AND scan the raw body for cross-tenant sentinels.
type searchEnvelope struct {
	Data service.SearchResults `json:"data"`
}

// NewSearchTestServerForRole mounts GET /api/search with a caller whose JWT + DB role
// are `role`. The caller's center_members row must be created by the test.
func NewSearchTestServerForRole(t *testing.T, db storyDB, userID pgtype.UUID, centerID, role string) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newSearchSrv(t, db), token: tok}
}

func newSearchSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()
	searchSvc := service.NewSearchService(db, clock.RealClock{})
	searchHandler := handler.NewSearchHandler(searchSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	searchChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(http.HandlerFunc(middleware.ErrorMapper(h))),
			),
		)
	}
	mux.Handle("GET /api/search", searchChain(searchHandler.Search))
	return mux
}

// searchDo issues GET /api/search?q=<q> and returns the recorder + decoded body.
func searchDo(t *testing.T, srv http.Handler, q string) (*httptest.ResponseRecorder, searchEnvelope) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/search?q="+url.QueryEscape(q), nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	var env searchEnvelope
	if rec.Code == http.StatusOK && rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode /api/search body: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec, env
}

// ── raw label seeds (context-free; caller sets TenantContext to centerID first) ──

// searchSeedClass inserts an active class named `name` taught by `teacherID`.
func searchSeedClass(t *testing.T, db *TxDB, centerID, teacherID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id, primary_skill)
		 VALUES ($1,$2,$3,'active',$4,'writing')`,
		id, centerID, name, teacherID); err != nil {
		t.Fatalf("seed search class %q: %v", name, err)
	}
	return id
}

// searchSeedStudentNamed creates a users row + a role='student' center_members row
// with the given full name (the searchable label). Returns the user id.
func searchSeedStudentNamed(t *testing.T, db *TxDB, centerID uuid.UUID, email, fullName string) uuid.UUID {
	t.Helper()
	u := CreateUser(t, db, email, fullName)
	CreateCenterMember(t, db, u.ID, pgUUID(centerID), "student")
	return uuidFromPg(u.ID)
}

// searchSeedExercise inserts a live (non-deleted) exercise titled `title`.
func searchSeedExercise(t *testing.T, db *TxDB, centerID, createdBy uuid.UUID, title string) uuid.UUID {
	t.Helper()
	return searchSeedExerciseMaybeDeleted(t, db, centerID, createdBy, title, false)
}

// searchSeedExerciseMaybeDeleted inserts an exercise; when softDeleted is true it sets
// deleted_at so the row must be hidden from every search (R-7).
func searchSeedExerciseMaybeDeleted(t *testing.T, db *TxDB, centerID, createdBy uuid.UUID, title string, softDeleted bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	code := "SX-" + uuid.NewString()[:8]
	var deletedAt any
	if softDeleted {
		deletedAt = time.Now()
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, deleted_at)
		 VALUES ($1,$2,$3,$4,$5,'writing',$6)`,
		id, centerID, createdBy, code, title, deletedAt); err != nil {
		t.Fatalf("seed search exercise %q: %v", title, err)
	}
	return id
}

// searchSeedAssignment binds `exerciseID` to `classID` with a future deadline.
func searchSeedAssignment(t *testing.T, db *TxDB, centerID, classID, exerciseID, createdBy uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, deadline_at)
		 VALUES ($1,$2,$3,$4,$5,$6)`,
		id, centerID, exerciseID, classID, createdBy, time.Now().Add(7*24*time.Hour)); err != nil {
		t.Fatalf("seed search assignment: %v", err)
	}
	return id
}

// searchSeedFile inserts a live file named `name` uploaded by `uploadedBy`.
func searchSeedFile(t *testing.T, db *TxDB, centerID, uploadedBy uuid.UUID, name string) uuid.UUID {
	t.Helper()
	return searchSeedFileMaybeDeleted(t, db, centerID, uploadedBy, name, false)
}

// searchSeedFileMaybeDeleted inserts a file; when softDeleted is true it sets
// deleted_at so the row must be hidden from every search (R-7).
func searchSeedFileMaybeDeleted(t *testing.T, db *TxDB, centerID, uploadedBy uuid.UUID, name string, softDeleted bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	slug := "file-" + uuid.NewString()[:8]
	objectKey := centerID.String() + "/knowledge-hub/" + uuid.NewString()
	var deletedAt any
	if softDeleted {
		deletedAt = time.Now()
	}
	if _, err := db.Exec(context.Background(),
		`INSERT INTO files (id, center_id, name, slug, object_key, content_type, size_bytes, uploaded_by, deleted_at)
		 VALUES ($1,$2,$3,$4,$5,'application/pdf',1024,$6,$7)`,
		id, centerID, name, slug, objectKey, uploadedBy, deletedAt); err != nil {
		t.Fatalf("seed search file %q: %v", name, err)
	}
	return id
}

// ── category assertions ──

func searchCategoryHasTitle(cat service.SearchCategory, title string) bool {
	for _, it := range cat.Items {
		if it.Title == title {
			return true
		}
	}
	return false
}

func searchCategoryHasID(cat service.SearchCategory, id uuid.UUID) bool {
	for _, it := range cat.Items {
		if it.ID == id.String() {
			return true
		}
	}
	return false
}

// searchAssignmentHasClass reports whether the assignments category has an item whose
// classId (the D10 deep-link key) equals classID.
func searchAssignmentHasClass(cat service.SearchCategory, classID uuid.UUID) bool {
	for _, it := range cat.Items {
		if it.ClassID != nil && *it.ClassID == classID.String() {
			return true
		}
	}
	return false
}
