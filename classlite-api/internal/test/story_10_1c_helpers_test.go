// Story 10-1c (Teacher Work Queue — grading backlog in the inbox) test helpers.
//
// GREEN (de-tagged 2026-10-07, Story 10-1c dev): the compile seam below —
// handler.(*InboxHandler).TeacherQueue wired at GET /api/inbox/teacher-queue — now
// ships, so these helpers + the three specimens join the normal build.
//
// It transitively requires:
//   - service.(*NotificationService).ListTeacherQueue(ctx, tc, lateOnly, now, page, pageSize)
//     → ([]TeacherQueueItem, PageResult, error) — ALWAYS teacher_id = tc.UserID (Ducdo Q4)
//   - sqlc generated.ListTeacherQueue / generated.CountTeacherQueue
//     (internal/store/queries/submissions.sql — clone of dashboard.sql
//     List/CountGradingBacklog + is_late + ids + LIMIT/OFFSET + late_only)
//   - api.yaml TeacherQueueItem / EnvelopeTeacherQueueList (+ regenerated client.ts)
//
// Everything else is shipped / self-contained: the server chain mirrors newInboxSrv
// (story_10_1a_helpers_test.go), and the raw submission/grade seeders below query the
// EXISTING submissions/assignments/grades schema (they RUNTIME-depend on it, reached
// only after the seam compiles). No migration is introduced by 10-1c.
//
// HOUSE RULE (carried from the 8-1a scope reds, Murat): every scope/isolation
// negative is paired with a positive in the SAME test — assert the caller's OWN
// row IS present, THEN the other party's is ABSENT. Without the positive half, a
// "empty-for-everyone" scoping bug silently passes both the isolation and the
// cardinality assertions.
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

// newTeacherQueueSrv wires a real InboxHandler onto the ungated questionChain and
// registers ONLY the net-new teacher-queue route (mirrors newInboxSrv). The single
// greenfield symbol is h.TeacherQueue — the tagged build compile-fails here until
// the dev ships it.
func newTeacherQueueSrv(t *testing.T, db storyDB, clk clock.Clock) http.Handler {
	t.Helper()
	svc := service.NewNotificationService(db, clk, &service.MockEmailSender{})
	h := handler.NewInboxHandler(svc, clk)

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	chain := func(hf middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(requireCenter(http.HandlerFunc(middleware.ErrorMapper(hf)))))
	}
	mux := http.NewServeMux()
	mux.Handle("GET /api/inbox/teacher-queue", chain(h.TeacherQueue)) // ← 10-1c net-new seam
	return mux
}

// ---------------------------------------------------------------------------
// Response parse structs (mirror the api.yaml TeacherQueueItem/EnvelopeTeacherQueueList
// the dev will add; these are the test's own structs, so they compile — the red is
// purely the handler seam above).
// ---------------------------------------------------------------------------

type tqPage struct {
	Page       int   `json:"page"`
	PageSize   int   `json:"pageSize"`
	Total      int64 `json:"total"`
	TotalPages int   `json:"totalPages"`
}

type tqMeta struct {
	ServerTime string `json:"serverTime"`
	Pagination tqPage `json:"pagination"`
}

type tqItem struct {
	SubmissionID    string  `json:"submissionId"`
	StudentName     string  `json:"studentName"`
	AssignmentTitle string  `json:"assignmentTitle"`
	ClassName       string  `json:"className"`
	IsLate          bool    `json:"isLate"`
	Overdue         bool    `json:"overdue"`
	SubmittedAt     *string `json:"submittedAt"`
	ClassID         string  `json:"classId"`
	AssignmentID    string  `json:"assignmentId"`
	Link            string  `json:"link"`
}

type tqEnvelope struct {
	Data []tqItem `json:"data"`
	Meta tqMeta   `json:"meta"`
}

// tqGet issues GET /api/inbox/teacher-queue?<query> with a Bearer token and decodes
// the paginated envelope (only when 200).
func tqGet(t *testing.T, srv http.Handler, tok, query string) (int, tqEnvelope) {
	t.Helper()
	url := "/api/inbox/teacher-queue"
	if query != "" {
		url += "?" + query
	}
	req := httptest.NewRequest(http.MethodGet, url, nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	var env tqEnvelope
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode teacher-queue envelope: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec.Code, env
}

func tqHasStudent(items []tqItem, name string) bool {
	for _, it := range items {
		if it.StudentName == name {
			return true
		}
	}
	return false
}

func tqFindBySubmission(items []tqItem, subID string) (tqItem, bool) {
	for _, it := range items {
		if it.SubmissionID == subID {
			return it, true
		}
	}
	return tqItem{}, false
}

// ---------------------------------------------------------------------------
// Raw seeders over the EXISTING submissions/grades schema (seedInputSubmission
// cannot set is_late nor return the id; seedReleasedGrade only models the
// released case — 10-1c needs the unreleased-draft branch too).
// ---------------------------------------------------------------------------

// tqInsertSubmission inserts a submission with an explicit status + is_late flag and
// RETURNS its id (needed to build/verify the grading deep-link).
func tqInsertSubmission(t *testing.T, db *TxDB, centerID, assignmentID, studentID uuid.UUID, status string, submittedAt time.Time, isLate bool) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, submitted_at, is_late)
		 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		id, centerID, assignmentID, studentID, status, submittedAt, isLate); err != nil {
		t.Fatalf("tqInsertSubmission(%s,late=%v): %v", status, isLate, err)
	}
	return id
}

// tqInsertUnreleasedDraftGrade appends an UNRELEASED (released_at NULL) grade version
// to a submission. The release oracle is `current_grades.released_at IS NOT NULL`, so
// a draft/in-flight grade MUST NOT drop the row from the queue — the
// `(cg.id IS NULL OR cg.released_at IS NULL)` disjunction, exercised beyond the bare
// status filter.
func tqInsertUnreleasedDraftGrade(t *testing.T, db *TxDB, centerID, submissionID, gradedBy uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO grades (id, submission_id, center_id, graded_by, version, criterion_scores, overall_band, released_at)
		 VALUES ($1,$2,$3,$4,1,'{}'::jsonb,6.0,NULL)`,
		uuid.New(), submissionID, centerID, gradedBy); err != nil {
		t.Fatalf("tqInsertUnreleasedDraftGrade: %v", err)
	}
}
