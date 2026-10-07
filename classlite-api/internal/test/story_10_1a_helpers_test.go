// Story 10-1a (Inbox & Notifications — backend keystone) test helpers.
//
// RED phase: this file is tagged `atdd_red_phase` and excluded from the normal
// build. Verify RED with:
//
//	cd classlite-api && go vet -tags atdd_red_phase ./internal/test/
//
// This file is MOSTLY seam-light: the raw-SQL seeders + readers below query the
// net-new `notifications` table (and existing tables) with plain SQL, so they
// fail at RUNTIME (never reached until the migration lands), NOT at compile time
// — exactly like story_9_2a_helpers.go. The two EXCEPTIONS are the service/handler
// wiring helpers at the bottom (`n101Wire` + `newInboxSrv`): they MUST reference
// the green-phase service/handler constructors, so this file compile-FAILS on
// those documented seams until the dev builds them.
//
//	GREEN-PHASE SEAMS the 10-1a reds compile against (each file re-states the
//	subset it fails on in its own header):
//
//	MIGRATION  20261006140000_create_notifications
//	  notifications(id, center_id→centers, user_id→users, type notification_type,
//	    title, body, link, metadata jsonb, read_at, archived_at, created_at)
//	    + RLS ENABLE/FORCE 4-policy center_id grid + idx_notifications_user_active.
//
//	sqlc  internal/store/queries/notifications.sql → generated.*:
//	  · type Notification struct (all DD1 columns)
//	  · type NotificationType string + value consts:
//	      NotificationTypeGradeReleased / ...AssignmentCreated / ...EnrollmentChanged /
//	      ...QuestionAsked / ...ScheduleChanged / ...PaymentFailed / ...StorageThreshold
//	  · InsertNotification(ctx, InsertNotificationParams{
//	        CenterID, UserID pgtype.UUID; Type NotificationType;
//	        Title, Body, Link string; Metadata []byte }) (Notification, error)
//	  · ListInboxForUser(ctx, ListInboxForUserParams{
//	        CenterID, UserID pgtype.UUID; Type pgtype.Text; UnreadOnly bool;
//	        Limit, Offset int32 }) ([]Notification, error)      // active-queue: archived_at IS NULL
//	  · CountUnreadForUser(ctx, CountUnreadForUserParams{CenterID, UserID pgtype.UUID}) (int64, error)
//	  · MarkNotificationRead(ctx, MarkNotificationReadParams{
//	        ID, UserID pgtype.UUID; ReadAt pgtype.Timestamptz }) (Notification, error)   // WHERE id=$ AND user_id=$ (NOT read_at IS NULL)
//	  · ArchiveNotification(ctx, ArchiveNotificationParams{
//	        ID, UserID pgtype.UUID; ArchivedAt pgtype.Timestamptz }) (Notification, error)
//
//	event  internal/event/types.go:
//	  · const StorageThresholdCrossed = "storage.threshold.crossed"
//
//	service internal/service/notification_service.go:
//	  · NewNotificationService(db service.AuthDB, clk clock.Clock, email service.EmailSender) *NotificationService
//	  · (*NotificationService).Register(bus *event.Bus)
//	  · (*NotificationService).ListInbox(ctx, tc model.TenantContext, f InboxFilter, page, pageSize int) ([]InboxItem, PageResult, error)
//	  · (*NotificationService).CountUnread(ctx, tc model.TenantContext) (int, error)
//	  · (*NotificationService).MarkRead(ctx, tc model.TenantContext, id uuid.UUID) error
//	  · (*NotificationService).Archive(ctx, tc model.TenantContext, id uuid.UUID) error
//	  · type InboxFilter struct { Type string; UnreadOnly bool }
//	  · type InboxItem struct { ID uuid.UUID; Type, Title, Body, Link string;
//	      Metadata json.RawMessage; ReadAt, ArchivedAt *time.Time; CreatedAt time.Time }
//
//	service  internal/service/file_service.go (storage producer — DD4/Task 3.1):
//	  · (*FileService).SetEventBus(bus *event.Bus)
//	    [setter chosen over a ctor-param to avoid churning the 4-arg NewFileService
//	     callsites that are already GREEN; the story pins "constructor param" —
//	     dev may wire either way, this is the red's documented seam.]
//	    Green wires ConfirmUpload to publish event.StorageThresholdCrossed POST-COMMIT
//	    on a 94→95% crossing, payload carrying usedBytes/limitBytes.
//
//	handler  internal/handler/inbox_handler.go:
//	  · NewInboxHandler(svc *service.NotificationService, clk clock.Clock) *InboxHandler
//	  · (*InboxHandler).List / .Count / .MarkRead / .Archive  (middleware.HandlerWithError)
//
// Convention notes:
//   - Value-scan not key-scan: the readers below return the row's title/type VALUE,
//     never a bare key-presence; count assertions are reserved for fan-out/dedup
//     cardinality (legitimate per the ATDD convention).
//   - raw-pool reds (0.2 subscriber-tenant, 0.4 storage) commit real rows → self-clean
//     via n101Cleanup + unique center ids. SetupDB reds auto-rollback.
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// ---------------------------------------------------------------------------
// HTTP inbox client (GET /api/inbox + /count, POST read/archive) — reused by
// the 0.3 owner-billing + 0.5 inbox-read reds. Decodes the standard envelope.
// ---------------------------------------------------------------------------

type n101InboxItem struct {
	ID         string          `json:"id"`
	Type       string          `json:"type"`
	Title      string          `json:"title"`
	Body       string          `json:"body"`
	Link       string          `json:"link"`
	Metadata   json.RawMessage `json:"metadata"`
	ReadAt     *string         `json:"readAt"`
	ArchivedAt *string         `json:"archivedAt"`
	CreatedAt  string          `json:"createdAt"`
}

type n101InboxEnvelope struct {
	Data []n101InboxItem `json:"data"`
	Meta struct {
		Pagination struct {
			Page       int `json:"page"`
			PageSize   int `json:"pageSize"`
			Total      int `json:"total"`
			TotalPages int `json:"totalPages"`
		} `json:"pagination"`
	} `json:"meta"`
}

func n101do(t *testing.T, srv http.Handler, method, target, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// n101GetInbox GETs /api/inbox (query may be "" or "type=…&unread_only=true")
// and returns the status + decoded envelope.
func n101GetInbox(t *testing.T, srv http.Handler, token, query string) (int, n101InboxEnvelope) {
	t.Helper()
	target := "/api/inbox"
	if query != "" {
		target += "?" + query
	}
	rec := n101do(t, srv, http.MethodGet, target, token)
	var env n101InboxEnvelope
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode inbox envelope: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec.Code, env
}

// n101CountUnread GETs /api/inbox/count → (status, unread).
func n101CountUnread(t *testing.T, srv http.Handler, token string) (int, int) {
	t.Helper()
	rec := n101do(t, srv, http.MethodGet, "/api/inbox/count", token)
	var env struct {
		Data struct {
			Unread int `json:"unread"`
		} `json:"data"`
	}
	if rec.Code == http.StatusOK {
		if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
			t.Fatalf("decode count envelope: %v (body=%s)", err, rec.Body.String())
		}
	}
	return rec.Code, env.Data.Unread
}

// n101InboxTypeCount counts envelope items of a given notification type.
func n101InboxTypeCount(env n101InboxEnvelope, ntype string) int {
	n := 0
	for _, it := range env.Data {
		if it.Type == ntype {
			n++
		}
	}
	return n
}

// notification_type enum VALUES (plain strings — the type column holds these;
// NOT a product seam, just the DD1 enum literals the readers filter on).
const (
	n101TypeGradeReleased     = "grade_released"
	n101TypeAssignmentCreated = "assignment_created"
	n101TypeEnrollmentChanged = "enrollment_changed"
	n101TypeQuestionAsked     = "question_asked"
	n101TypeScheduleChanged   = "schedule_changed"
	n101TypePaymentFailed     = "payment_failed"
	n101TypeStorageThreshold  = "storage_threshold"
)

// ---------------------------------------------------------------------------
// Event + payload builders (bus.Publish takes an event.Event; the subscriber
// reads the Payload). Map payloads mirror the EXISTING production shapes:
//   assignment.created → map{"assignmentId"}        (assignment_service.go:229)
//   grade.released     → map{"submissionId","assignmentId"}  (worker/grade_release.go:109)
// ---------------------------------------------------------------------------

func n101Event(etype, centerID, userID string, payload any) event.Event {
	return event.Event{
		Type:      etype,
		CenterID:  centerID,
		UserID:    userID,
		Payload:   payload,
		Timestamp: time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC),
	}
}

func n101GradeReleasedPayload(submissionID, assignmentID string) map[string]any {
	return map[string]any{"submissionId": submissionID, "assignmentId": assignmentID}
}

func n101AssignmentCreatedPayload(assignmentID string) map[string]any {
	return map[string]any{"assignmentId": assignmentID}
}

func n101ScheduleChangedPayload(sessionID, classID string) map[string]any {
	return map[string]any{"sessionId": sessionID, "classId": classID}
}

// ---------------------------------------------------------------------------
// Wiring: build the real NotificationService + register its subscribers on a
// fresh bus. (COMPILE SEAM: service.NewNotificationService / .Register.)
// ---------------------------------------------------------------------------

func n101Wire(t *testing.T, db service.AuthDB, clk clock.Clock, email service.EmailSender) (*event.Bus, *service.NotificationService) {
	t.Helper()
	bus := event.NewBus()
	svc := service.NewNotificationService(db, clk, email)
	svc.SetStorageSettingsURL(n101StorageSettingsURL) // code-review: absolute Upgrade CTA in the storage email.
	svc.Register(bus)
	return bus, svc
}

// n101StorageSettingsURL is the absolute storage-settings deep link the test wiring
// injects so the storage-threshold email's Upgrade CTA renders an absolute href
// (code-review fix — a relative href does not resolve in a mail client).
const n101StorageSettingsURL = "https://app.classlite.test/settings/storage"

// newInboxSrv mounts the four inbox routes on the open authenticated-tenant
// chain (extractTenant → requireVerified → requireCenter → ErrorMapper — role
// enforced nowhere: every role has an inbox, DD5). (COMPILE SEAM:
// service.NewNotificationService / handler.NewInboxHandler + methods.)
func newInboxSrv(t *testing.T, db storyDB, clk clock.Clock) http.Handler {
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
	mux.Handle("GET /api/inbox", chain(h.List))
	mux.Handle("GET /api/inbox/count", chain(h.Count))
	mux.Handle("POST /api/inbox/{id}/read", chain(h.MarkRead))
	mux.Handle("POST /api/inbox/{id}/archive", chain(h.Archive))
	mux.Handle("POST /api/inbox/read-all", chain(h.MarkAllRead)) // 10.1b AC6
	return mux
}

// ---------------------------------------------------------------------------
// raw-SQL readers over `notifications` (RUNTIME-only until the migration lands).
// Pass SuperuserPool for the committed raw-pool reds (bypass RLS); pass a
// tenant-scoped *TxDB for the SetupDB reds (same uncommitted tx).
// ---------------------------------------------------------------------------

// n101CountByType is the cardinality probe for fan-out / owner-only reds.
func n101CountByType(t *testing.T, q DBTX, centerID, userID pgtype.UUID, ntype string) int {
	t.Helper()
	var n int
	if err := q.QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE center_id = $1 AND user_id = $2 AND type = $3`,
		centerID, userID, ntype,
	).Scan(&n); err != nil {
		t.Fatalf("count notifications (type=%s): %v", ntype, err)
	}
	return n
}

// n101CountForCenter counts every notification row under a center (fan-out
// mis-join / double-count guard — AC10).
func n101CountForCenter(t *testing.T, q DBTX, centerID pgtype.UUID, ntype string) int {
	t.Helper()
	var n int
	if err := q.QueryRow(context.Background(),
		`SELECT count(*) FROM notifications WHERE center_id = $1 AND type = $2`,
		centerID, ntype,
	).Scan(&n); err != nil {
		t.Fatalf("count notifications for center (type=%s): %v", ntype, err)
	}
	return n
}

// n101FirstByType value-scans the newest row's human-visible columns so a red
// can assert a VALUE (type/title present + non-null), never mere key presence.
func n101FirstByType(t *testing.T, q DBTX, centerID, userID pgtype.UUID, ntype string) (title, body, link string, metadata []byte, found bool) {
	t.Helper()
	err := q.QueryRow(context.Background(),
		`SELECT title, body, link, metadata FROM notifications
		 WHERE center_id = $1 AND user_id = $2 AND type = $3
		 ORDER BY created_at DESC, id DESC LIMIT 1`,
		centerID, userID, ntype,
	).Scan(&title, &body, &link, &metadata)
	if err != nil {
		return "", "", "", nil, false
	}
	return title, body, link, metadata, true
}

// ---------------------------------------------------------------------------
// raw-pool seeders (committed; superuser so RLS does not block the setup) for
// the 0.2 + 0.4 reds. Self-clean via n101Cleanup.
// ---------------------------------------------------------------------------

// n101NewCenter creates a committed center with a storage ceiling + registers a
// cleanup that purges its notifications/members/files/center. storageLimitBytes
// <= 0 leaves the column default.
func n101NewCenter(t *testing.T, storageLimitBytes int64) pgtype.UUID {
	t.Helper()
	id := NewPGUUIDFromString(uuid.NewString())
	sp := SuperuserPool(t)
	short := "n101-" + uuid.NewString()[:8]
	if storageLimitBytes > 0 {
		if _, err := sp.Exec(context.Background(),
			`INSERT INTO centers (id, name, short_code, storage_limit_bytes) VALUES ($1,$2,$3,$4)`,
			id, "Notif Center", short, storageLimitBytes); err != nil {
			t.Fatalf("create notif center: %v", err)
		}
	} else {
		if _, err := sp.Exec(context.Background(),
			`INSERT INTO centers (id, name, short_code) VALUES ($1,$2,$3)`,
			id, "Notif Center", short); err != nil {
			t.Fatalf("create notif center: %v", err)
		}
	}
	t.Cleanup(func() { n101Cleanup(t, id) })
	return id
}

// n101SeedMemberOnPool creates a committed user + a committed center_members row
// (superuser → bypass RLS) and returns the user id.
func n101SeedMemberOnPool(t *testing.T, centerID pgtype.UUID, email, name, role string) pgtype.UUID {
	t.Helper()
	uid := NewPGUUIDFromString(uuid.NewString())
	sp := SuperuserPool(t)
	ctx := context.Background()
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (id, email, full_name, password_hash, email_verified)
		 VALUES ($1,$2,$3,'x',true)`, uid, email, name); err != nil {
		t.Fatalf("seed member user: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1,$2,$3)`,
		uid, centerID, role); err != nil {
		t.Fatalf("seed center_member (%s): %v", role, err)
	}
	t.Cleanup(func() { _, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, uid) })
	return uid
}

// n101Cleanup purges a center's rows via the superuser pool (raw-pool reds
// commit, so t.Cleanup must undo them). Order respects FKs.
func n101Cleanup(t *testing.T, centerID pgtype.UUID) {
	t.Helper()
	sp := SuperuserPool(t)
	ctx := context.Background()
	for _, tbl := range []string{"notifications", "audit_logs", "files", "folders", "center_members"} {
		_, _ = sp.Exec(ctx, "DELETE FROM "+tbl+" WHERE center_id = $1", centerID)
	}
	_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerID)
}

// n101RLSCountAs opens an INDEPENDENT classlite_app connection (RLS enforced),
// SET LOCAL app.current_tenant_id = tenantID, and counts a user's notifications
// — the 0.2 cross-tenant isolation probe (a tenant-B session must see zero of
// tenant-A's rows). Rolls back (read-only).
func n101RLSCountAs(t *testing.T, tenantID, centerID, userID pgtype.UUID) int {
	t.Helper()
	ctx := context.Background()
	tx, err := SetupRawPool(t).Begin(ctx)
	if err != nil {
		t.Fatalf("begin rls-count tx: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE classlite_app"); err != nil {
		t.Fatalf("set role: %v", err)
	}
	if _, err := tx.Exec(ctx, "SET LOCAL app.current_tenant_id = '"+UUIDString(tenantID)+"'"); err != nil {
		t.Fatalf("set tenant: %v", err)
	}
	var n int
	if err := tx.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE center_id = $1 AND user_id = $2`,
		centerID, userID,
	).Scan(&n); err != nil {
		t.Fatalf("rls count: %v", err)
	}
	return n
}

// ---------------------------------------------------------------------------
// SetupDB seeders for the fan-out / grade reds (reuse the GREEN qa* helpers
// where possible; assignments/submissions inlined as raw SQL).
// ---------------------------------------------------------------------------

// n101SeedAssignment inserts an assignment (open, future deadline) and returns
// its id. The class/exercise must already exist in the current tenant.
func n101SeedAssignment(t *testing.T, db *TxDB, centerID, exerciseID, classID, createdBy uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,'open', now() + interval '7 days', 1.0)`,
		id, centerID, exerciseID, classID, createdBy); err != nil {
		t.Fatalf("seed assignment: %v", err)
	}
	return id
}

// n101FanoutClass seeds a class with `active` active enrollments + `withdrawn`
// withdrawn enrollments (one withdrawn row carries withdrawn_at per the 7.3a
// coupling CHECK). Returns the class id, an exercise id (for an assignment), the
// teacher id, and the active student ids. Tenant context must be set already.
type n101Fanout struct {
	classID    uuid.UUID
	exerciseID uuid.UUID
	teacherID  uuid.UUID
	active     []uuid.UUID
}

func n101FanoutClass(t *testing.T, db *TxDB, centerID uuid.UUID, active, withdrawn int) n101Fanout {
	t.Helper()
	teacher := qaSeedMember(t, db, centerID, "n101-teach-"+uuid.NewString()[:8]+"@example.com", "Fanout Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, centerID, teacher)
	ex := qaSeedExercise(t, db, centerID, teacher)

	activeIDs := make([]uuid.UUID, 0, active)
	for i := 0; i < active; i++ {
		s := qaSeedMember(t, db, centerID, "n101-act-"+uuid.NewString()[:8]+"@example.com", "Active Student", "student")
		qaSeedActiveEnrollment(t, db, centerID, s, class)
		activeIDs = append(activeIDs, s)
	}
	for i := 0; i < withdrawn; i++ {
		s := qaSeedMember(t, db, centerID, "n101-wd-"+uuid.NewString()[:8]+"@example.com", "Withdrawn Student", "student")
		qaSeedEnrollment(t, db, centerID, s, class, "withdrawn")
	}
	return n101Fanout{classID: class, exerciseID: ex, teacherID: teacher, active: activeIDs}
}

// n101SubmissionActors reads the (student, assignment) ids off a seeded
// submission via the SAME tx so the grade.released payload + the recipient
// assertion reference real ids.
func n101SubmissionActors(t *testing.T, db *TxDB, submissionID uuid.UUID) (studentID, assignmentID pgtype.UUID) {
	t.Helper()
	if err := db.QueryRow(context.Background(),
		`SELECT student_id, assignment_id FROM submissions WHERE id = $1`, submissionID,
	).Scan(&studentID, &assignmentID); err != nil {
		t.Fatalf("read submission actors: %v", err)
	}
	return
}

// n101VerifyCenterMembers marks every center member's user email_verified=true so
// the GET /api/inbox chain's RequireVerifiedEmail passes (CreateUser/qaSeedMember
// leave the column at its `false` default; a logged-in caller is always verified
// in production). Runs under the test's tenant tx (the center_members subquery is
// RLS-scoped; users has no RLS).
func n101VerifyCenterMembers(t *testing.T, db DBTX, centerID pgtype.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET email_verified = true
		 WHERE id IN (SELECT user_id FROM center_members WHERE center_id = $1)`,
		centerID,
	); err != nil {
		t.Fatalf("verify center members: %v", err)
	}
}

// n101InsertNotif inserts a notification row with explicit read/archived state
// via raw SQL (RUNTIME-only until the migration lands) and returns its id. Used
// by the 0.5 read red to stage a mixed active/read/archived queue deterministically.
func n101InsertNotif(t *testing.T, q DBTX, centerID, userID pgtype.UUID, ntype string, read, archived bool) pgtype.UUID {
	t.Helper()
	id := NewPGUUIDFromString(uuid.NewString())
	var readAt, archivedAt any
	if read {
		readAt = time.Date(2026, 10, 6, 11, 0, 0, 0, time.UTC)
	}
	if archived {
		archivedAt = time.Date(2026, 10, 6, 11, 30, 0, 0, time.UTC)
	}
	if _, err := q.Exec(context.Background(),
		`INSERT INTO notifications (id, center_id, user_id, type, title, body, link, metadata, read_at, archived_at)
		 VALUES ($1,$2,$3,$4,$5,'body','/x','{"schemaVersion":1}',$6,$7)`,
		id, centerID, userID, ntype, "Row "+ntype, readAt, archivedAt,
	); err != nil {
		t.Fatalf("insert notification (is migration 20261006140000 applied?): %v", err)
	}
	return id
}

// n101Metadata unmarshals a row's metadata jsonb for value-scan assertions.
func n101Metadata(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	if len(raw) == 0 {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal metadata: %v", err)
	}
	return m
}
