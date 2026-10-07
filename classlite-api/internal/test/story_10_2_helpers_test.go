// Story 10-2 (Archive — past classes & exercises, read-only + reuse verbs) test
// helpers. WF-8 HARD GATE (true): the net-new role-scoped REVERSED-FILTER read
// GET /api/archive owns BOTH ≥6 isolation surfaces for the first time —
//   - cross-TEACHER scope (two teachers in one center share center_id, so RLS
//     does NOT isolate them; isolation rests on the service predicates
//     exercises.created_by = caller / classes.teacher_id = caller — the 7-2a
//     class), and
//   - cross-TENANT RLS over the reversed reads (deleted_at IS NOT NULL /
//     status='ended') — the SEC-9 soft-delete+RLS trap: a reversed filter is
//     exactly where a tenant boundary silently widens.
//
// RED (this file + the 3 specimens, all //go:build atdd_red_phase): excluded
// from the normal `go test ./...`; under `-tags atdd_red_phase` the package
// compile-FAILS on the documented seam below — service.NewArchiveService /
// handler.NewArchiveHandler / (*ArchiveHandler).List — which do not exist yet.
// De-tag each specimen as the seam greens (Story 10-2 dev).
//
// GREEN SEAM CONTRACT (what the dev builds; the reds compile/run against these):
//  1. migration: classes.ended_at timestamptz (additive, nullable), stamped on
//     the →ended transition in UpdateClassStatus (CAS + class.status_changed
//     audit preserved), genesis-backfilled for existing ended rows.
//  2. sqlc internal/store/queries/archive.sql — ListArchive :many (UNION ALL of
//     archived exercises [deleted_at IS NOT NULL] + archived classes
//     [status='ended' AND ended_at IS NOT NULL AND ended_at <= @cutoff],
//     projected to a common shape, outer ORDER BY archived_at DESC, id DESC,
//     LIMIT @lim OFFSET @off, per-branch teacher narg + @type_filter) and
//     CountArchive :one mirroring the two WHEREs.
//  3. service.(*ArchiveService).List(ctx, tc, ArchiveListFilter{Type,Page,PageSize})
//     → ([]ArchiveItem, PageResult, error): clampPagination + math.MaxInt32
//     guards; role-branch teacherID = &tc.UserID for RoleTeacher else nil
//     (owner/admin center-wide); RoleStudent → ForbiddenError (403); validate
//     Type ∈ {"","class","exercise"} else ValidationError (422); cutoff :=
//     clk.Now().Add(-archiveClassGraceDays); build each exercise item's
//     link = /exercises/{id}/edit. ArchiveItem DTO: explicit json tags, NO
//     omitempty (GO-5); per-type fields nullable pointers.
//  4. handler.(*ArchiveHandler).List → tenant extractor → parseSnakePageParams
//     → read `type` query param → writePaginatedEnvelope(w, h.clk, items, meta).
//  5. route cmd/api/main.go: GET /api/archive on the staff-gated chain
//     (owner/admin/teacher); api.yaml ArchiveItem + EnvelopeArchiveList + path →
//     scripts/codegen.sh.
//
// HOUSE RULE (carried from the 8-1a/10-1c scope reds, Murat): every scope/
// isolation negative is paired with a positive in the SAME test — assert the
// caller's OWN row IS present, THEN the other party's is ABSENT. Without the
// positive half, an "empty-for-everyone" scope bug silently passes both the
// isolation and the cardinality assertions.
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
)

// newArchiveSrv wires a real ArchiveHandler onto a bare chain (extractTenant →
// requireVerified → requireCenter → ErrorMapper — NOT role-gated, like the
// exercise/class bare-mux helpers), so one test can exercise owner/admin/
// teacher/student by supplying its own bearer token; role + teacher-scope are
// enforced in the service. The greenfield symbols are service.NewArchiveService /
// handler.NewArchiveHandler / h.List — the tagged build compile-fails here until
// the dev ships them (the single documented seam).
func newArchiveSrv(t *testing.T, db storyDB, clk clock.Clock) http.Handler {
	t.Helper()
	svc := service.NewArchiveService(db, clk) // ← 10-2 net-new seam
	h := handler.NewArchiveHandler(svc, clk)  // ← 10-2 net-new seam

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	chain := func(hf middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(requireCenter(http.HandlerFunc(middleware.ErrorMapper(hf)))))
	}
	mux := http.NewServeMux()
	mux.Handle("GET /api/archive", chain(h.List)) // ← 10-2 net-new seam
	return mux
}

// ---------------------------------------------------------------------------
// Response parse structs (mirror the api.yaml ArchiveItem/EnvelopeArchiveList
// the dev will add; these are the test's own structs so they compile — the red
// is purely the handler/service seam above).
// ---------------------------------------------------------------------------

type arPage struct {
	Page       int   `json:"page"`
	PageSize   int   `json:"pageSize"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
}

type arMeta struct {
	ServerTime string `json:"serverTime"`
	Pagination arPage `json:"pagination"`
}

type arItem struct {
	Type        string  `json:"type"` // "class" | "exercise"
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Subtitle    string  `json:"subtitle"`
	ArchivedAt  *string `json:"archivedAt"`
	ClassStatus *string  `json:"classStatus"`
	Skill       *string  `json:"skill"`
	TargetBand  *float64 `json:"targetBand"` // wire is number/format:float (half-bands) — NOT *int
	Link        string   `json:"link"`
}

type arEnvelope struct {
	Data []arItem `json:"data"`
	Meta arMeta   `json:"meta"`
}

// arGet issues GET /api/archive?<query> with a Bearer token and decodes the
// paginated envelope (only when 200).
func arGet(t *testing.T, srv http.Handler, tok, query string) (int, arEnvelope) {
	t.Helper()
	url := "/api/archive"
	if query != "" {
		url += "?" + query
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	var env arEnvelope
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode archive envelope: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec.Code, env
}

func arHasTitle(items []arItem, title string) bool {
	for _, it := range items {
		if it.Title == title {
			return true
		}
	}
	return false
}

func arFindByID(items []arItem, id string) (arItem, bool) {
	for _, it := range items {
		if it.ID == id {
			return it, true
		}
	}
	return arItem{}, false
}

func arHasID(items []arItem, id string) bool {
	_, ok := arFindByID(items, id)
	return ok
}

// ---------------------------------------------------------------------------
// Raw seeders over the EXISTING exercises/classes schema. Tenant context must be
// set by the caller. These RUNTIME-depend on the green schema — arInsertEndedClass
// writes classes.ended_at, which the 10-2 migration adds; reached only AFTER the
// seam compiles (at red, the handler/service seam fails first, so the SQL is
// never evaluated).
// ---------------------------------------------------------------------------

// arSeedArchivedExercise inserts an exercise then soft-deletes it (deleted_at set)
// — i.e. an ARCHIVED exercise. Returns its id. (insertExerciseRaw lives in
// exercises_rls_test.go — same package.)
func arSeedArchivedExercise(t *testing.T, db *TxDB, centerID, createdBy uuid.UUID, code, skill string) uuid.UUID {
	t.Helper()
	id := insertExerciseRaw(t, db, centerID, createdBy, code, skill, nil)
	if _, err := db.Exec(context.Background(),
		`UPDATE exercises SET deleted_at = now() WHERE id = $1`, id); err != nil {
		t.Fatalf("arSeedArchivedExercise soft-delete: %v", err)
	}
	return id
}

// arSeedActiveExercise inserts a live (deleted_at NULL) exercise — must NOT
// appear in the archive (AC2 negative). Returns its id.
func arSeedActiveExercise(t *testing.T, db *TxDB, centerID, createdBy uuid.UUID, code, skill string) uuid.UUID {
	t.Helper()
	return insertExerciseRaw(t, db, centerID, createdBy, code, skill, nil)
}

// arInsertClass inserts a class with an explicit status, teacher_id and optional
// ended_at. ended_at is the 10-2 green column; a NULL endedAt leaves it unset.
func arInsertClass(t *testing.T, db *TxDB, centerID, teacherID uuid.UUID, name, status string, endedAt *time.Time) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id, start_date, ended_at)
		 VALUES ($1,$2,$3,$4,$5, current_date - interval '120 days', $6)`,
		id, centerID, name, status, teacherID, endedAt); err != nil {
		t.Fatalf("arInsertClass(%s,%s): %v", name, status, err)
	}
	return id
}
