// Package service — Story 10.1a NotificationService.
//
// The FIRST consumer of the in-process event bus (zero subscribers existed until
// now). It owns BOTH sides of the inbox:
//
//   - WRITE side (subscribers): one bus Handler per ruled event type. Each handler
//     opens its OWN tenant tx from event.CenterID (SEC-6/R3 — NEVER reuses the
//     producer's tx), resolves recipient(s) per DD3, and inserts the typed row(s).
//     Handler errors are SWALLOWED by the bus (DD2) → notification creation is
//     best-effort: a failed insert never blocks grading/enrolling/uploading.
//
//   - READ side (ListInbox/CountUnread/MarkRead/Archive/MarkAllRead): the caller's
//     OWN rows only (user_id predicate + RLS center scope), active-queue
//     (archived_at IS NULL). Role is NOT a read filter — role-scoping is baked at
//     WRITE time (DD3/DD5), so owner-only billing holds because admin never has a
//     payment_failed row (R15).
//
// Recipient role-scope is the WRITE-time invariant (DD3): the subscriber resolves
// the recipient from center_members (SEC-1 — never a JWT; there is none in a bus
// handler), addressing the right user_id. metadata is a typed, immutable
// per-type snapshot (DD1b, GO-7 schemaVersion); title/body hold an EN snapshot
// (the FE renders from type+metadata — architecture.md:257). Display-name
// enrichment is best-effort: fields the ruled event payloads don't carry
// (bandPreview, schedule old/new time, question preview) are omitted in v1 →
// FU-10-1-METADATA-ENRICH.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// notificationMetadataSchemaVersion stamps every metadata jsonb (GO-7) so a later
// shape change has an upgrade path.
const notificationMetadataSchemaVersion = 1

const notificationNotFoundCode = "NOTIFICATION_NOT_FOUND"

// NotificationService owns the notifications write subscribers + the inbox read API.
type NotificationService struct {
	db                 AuthDB
	clk                clock.Clock
	email              EmailSender
	storageSettingsURL string
}

// NewNotificationService constructs a NotificationService. email is used only by
// the storage-threshold handler (the owner Upgrade email, D3); a nil email sender
// skips that send.
func NewNotificationService(db AuthDB, clk clock.Clock, email EmailSender) *NotificationService {
	return &NotificationService{db: db, clk: clk, email: email}
}

// SetStorageSettingsURL sets the ABSOLUTE storage-settings deep link rendered into
// the storage-threshold owner email's Upgrade CTA (Story 10.1a code-review). main.go
// wires it from cfg.AppStorageSettingsURL. Empty → the email falls back to a relative
// href (dev/tests without the wiring); production always injects an absolute URL.
func (s *NotificationService) SetStorageSettingsURL(url string) {
	s.storageSettingsURL = url
}

// Register wires one subscriber per ruled event type onto the bus (AC6). Called
// once at boot on the single main.go bus instance.
func (s *NotificationService) Register(bus *event.Bus) {
	if bus == nil {
		return
	}
	bus.Subscribe(event.GradeReleased, s.handleGradeReleased)
	bus.Subscribe(event.AssignmentCreated, s.handleAssignmentCreated)
	bus.Subscribe(event.QuestionAsked, s.handleQuestionAsked)
	bus.Subscribe(event.ScheduleChanged, s.handleScheduleChanged)
	bus.Subscribe(event.EnrollmentChanged, s.handleEnrollmentChanged)
	bus.Subscribe(event.PaymentFailed, s.handlePaymentFailed)
	bus.Subscribe(event.StorageThresholdCrossed, s.handleStorageThreshold)
}

// --- typed event payloads (decoded from the producer's map/struct via JSON) ---

type gradeReleasedPayload struct {
	SubmissionID string `json:"submissionId"`
	AssignmentID string `json:"assignmentId"`
}

type assignmentCreatedPayload struct {
	AssignmentID string `json:"assignmentId"`
}

type scheduleChangedPayload struct {
	SessionID string `json:"sessionId"`
	ClassID   string `json:"classId"`
}

// StorageThresholdPayload is the event.StorageThresholdCrossed payload FileService
// publishes post-commit on a 94→95% crossing (DD4). used/limit are computed inside
// the locked closure and carried on the event — the subscriber does NOT re-read.
type StorageThresholdPayload struct {
	UsedBytes  int64 `json:"usedBytes"`
	LimitBytes int64 `json:"limitBytes"`
}

// --- typed per-type metadata (DD1b, immutable snapshot) ---

type gradeReleasedMeta struct {
	SchemaVersion   int    `json:"schemaVersion"`
	ActorID         string `json:"actorId"`
	SubmissionID    string `json:"submissionId"`
	AssignmentID    string `json:"assignmentId"`
	AssignmentTitle string `json:"assignmentTitle"`
	ClassName       string `json:"className"`
}

type assignmentCreatedMeta struct {
	SchemaVersion   int    `json:"schemaVersion"`
	ActorID         string `json:"actorId"`
	AssignmentID    string `json:"assignmentId"`
	AssignmentTitle string `json:"assignmentTitle"`
	ClassName       string `json:"className"`
	DueAt           string `json:"dueAt"`
}

type questionAskedMeta struct {
	SchemaVersion int    `json:"schemaVersion"`
	ActorID       string `json:"actorId"`
	QuestionID    string `json:"questionId"`
	StudentName   string `json:"studentName"`
	ClassName     string `json:"className"`
}

type scheduleChangedMeta struct {
	SchemaVersion int    `json:"schemaVersion"`
	SessionID     string `json:"sessionId"`
	ClassName     string `json:"className"`
}

type enrollmentChangedMeta struct {
	SchemaVersion int    `json:"schemaVersion"`
	EnrollmentID  string `json:"enrollmentId"`
	StudentID     string `json:"studentId"`
	StudentName   string `json:"studentName"`
	Action        string `json:"action"`
	FromClassID   string `json:"fromClassId"`
	ToClassID     string `json:"toClassId"`
}

type paymentFailedMeta struct {
	SchemaVersion int `json:"schemaVersion"`
}

type storageThresholdMeta struct {
	SchemaVersion int   `json:"schemaVersion"`
	UsedBytes     int64 `json:"usedBytes"`
	LimitBytes    int64 `json:"limitBytes"`
}

// --- tx helper ---

// inTenantTx opens a tenant tx, sets the RLS GUC (PERF-1 — required even for
// reads), runs fn, and commits iff fn returns nil. An empty/invalid CenterID is
// rejected by SetTenantContext (no blank-GUC fall-through — 0.2c) and surfaces as
// an error the bus swallows (DD2). Each call opens its own pooled connection, so a
// subscriber genuinely re-establishes tenant context (R3) rather than inheriting
// the producer's.
func (s *NotificationService) inTenantTx(ctx context.Context, tc model.TenantContext, fn func(q *generated.Queries) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("notification tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("notification tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// decodePayload normalizes the bus payload (a producer map OR a typed struct) into
// a typed shape via a JSON round-trip, so the subscriber reads the same fields
// regardless of how the producer constructed the payload.
func decodePayload[T any](payload any) (T, error) {
	var out T
	raw, err := json.Marshal(payload)
	if err != nil {
		return out, fmt.Errorf("marshal payload: %w", err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("unmarshal payload: %w", err)
	}
	return out, nil
}

func metaBytes(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		// A typed struct cannot fail to marshal; fall back to an empty object so a
		// bug here never produces a NULL metadata (NOT NULL column).
		return []byte(`{}`)
	}
	return b
}

// --- write subscribers (DD3) ---

// handleGradeReleased: grade.released {submissionId} → the student (1 row).
func (s *NotificationService) handleGradeReleased(ctx context.Context, ev event.Event) error {
	p, err := decodePayload[gradeReleasedPayload](ev.Payload)
	if err != nil {
		return err
	}
	submissionID, err := uuid.Parse(p.SubmissionID)
	if err != nil {
		return fmt.Errorf("grade.released: parse submission id: %w", err)
	}
	return s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		gctx, gerr := q.GetGradeNotificationContext(ctx, pgUUID(submissionID))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return nil // submission gone/invisible — nothing to notify (best-effort)
			}
			return fmt.Errorf("grade.released: context: %w", gerr)
		}
		meta := gradeReleasedMeta{
			SchemaVersion:   notificationMetadataSchemaVersion,
			ActorID:         ev.UserID,
			SubmissionID:    p.SubmissionID,
			AssignmentID:    uuidStringFromPg(gctx.AssignmentID),
			AssignmentTitle: gctx.ExerciseTitle,
			ClassName:       gctx.ClassName,
		}
		_, ierr := q.InsertNotification(ctx, generated.InsertNotificationParams{
			CenterID: pgUUID(centerUUID),
			UserID:   gctx.StudentID,
			Type:     generated.NotificationTypeGradeReleased,
			Title:    "Your grade is ready",
			Body:     fmt.Sprintf("Your work on %q has been graded.", gctx.ExerciseTitle),
			Link:     "/assignments/" + uuidStringFromPg(gctx.AssignmentID) + "/result",
			Metadata: metaBytes(meta),
		})
		return ierr
	})
}

// handleAssignmentCreated: assignment.created {assignmentId} → each ACTIVE enrolled
// student (N rows via one INSERT … SELECT — AC10/PERF-2).
func (s *NotificationService) handleAssignmentCreated(ctx context.Context, ev event.Event) error {
	p, err := decodePayload[assignmentCreatedPayload](ev.Payload)
	if err != nil {
		return err
	}
	assignmentID, err := uuid.Parse(p.AssignmentID)
	if err != nil {
		return fmt.Errorf("assignment.created: parse assignment id: %w", err)
	}
	return s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		actx, aerr := q.GetAssignmentNotificationContext(ctx, pgUUID(assignmentID))
		if aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("assignment.created: context: %w", aerr)
		}
		meta := assignmentCreatedMeta{
			SchemaVersion:   notificationMetadataSchemaVersion,
			ActorID:         ev.UserID,
			AssignmentID:    p.AssignmentID,
			AssignmentTitle: actx.ExerciseTitle,
			ClassName:       actx.ClassName,
			DueAt:           wireTimestamp(actx.DeadlineAt),
		}
		_, ferr := q.FanoutNotificationToActiveStudents(ctx, generated.FanoutNotificationToActiveStudentsParams{
			CenterID: pgUUID(centerUUID),
			Type:     generated.NotificationTypeAssignmentCreated,
			Title:    "New assignment",
			Body:     fmt.Sprintf("A new assignment %q was posted to %s.", actx.ExerciseTitle, actx.ClassName),
			Link:     "/assignments/" + p.AssignmentID,
			Metadata: metaBytes(meta),
			ClassID:  actx.ClassID,
		})
		return ferr
	})
}

// handleQuestionAsked: question.asked → the class teacher (1 row).
func (s *NotificationService) handleQuestionAsked(ctx context.Context, ev event.Event) error {
	p, err := decodePayload[QuestionAskedPayload](ev.Payload)
	if err != nil {
		return err
	}
	classID, err := uuid.Parse(p.ClassID)
	if err != nil {
		return fmt.Errorf("question.asked: parse class id: %w", err)
	}
	return s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		class, cerr := q.GetClassByID(ctx, pgUUID(classID))
		if cerr != nil {
			if errors.Is(cerr, pgx.ErrNoRows) {
				return nil
			}
			return fmt.Errorf("question.asked: class: %w", cerr)
		}
		if !class.TeacherID.Valid {
			return nil // no teacher assigned — nobody to notify
		}
		meta := questionAskedMeta{
			SchemaVersion: notificationMetadataSchemaVersion,
			ActorID:       p.StudentID,
			QuestionID:    p.QuestionID,
			StudentName:   s.lookupUserName(ctx, q, p.StudentID),
			ClassName:     class.Name,
		}
		_, ierr := q.InsertNotification(ctx, generated.InsertNotificationParams{
			CenterID: pgUUID(centerUUID),
			UserID:   class.TeacherID,
			Type:     generated.NotificationTypeQuestionAsked,
			Title:    "New question",
			Body:     fmt.Sprintf("A student asked a question in %s.", class.Name),
			Link:     "/questions/" + p.QuestionID,
			Metadata: metaBytes(meta),
		})
		return ierr
	})
}

// handleScheduleChanged: schedule.changed {sessionId,classId} → each ACTIVE enrolled
// student (N rows via one INSERT … SELECT — AC10).
func (s *NotificationService) handleScheduleChanged(ctx context.Context, ev event.Event) error {
	p, err := decodePayload[scheduleChangedPayload](ev.Payload)
	if err != nil {
		return err
	}
	classID, err := uuid.Parse(p.ClassID)
	if err != nil {
		return fmt.Errorf("schedule.changed: parse class id: %w", err)
	}
	return s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		className := ""
		if class, cerr := q.GetClassByID(ctx, pgUUID(classID)); cerr == nil {
			className = class.Name
		} else if !errors.Is(cerr, pgx.ErrNoRows) {
			return fmt.Errorf("schedule.changed: class: %w", cerr)
		}
		meta := scheduleChangedMeta{
			SchemaVersion: notificationMetadataSchemaVersion,
			SessionID:     p.SessionID,
			ClassName:     className,
		}
		_, ferr := q.FanoutNotificationToActiveStudents(ctx, generated.FanoutNotificationToActiveStudentsParams{
			CenterID: pgUUID(centerUUID),
			Type:     generated.NotificationTypeScheduleChanged,
			Title:    "Schedule updated",
			Body:     fmt.Sprintf("A session in %s was changed.", className),
			Link:     "/classes/" + p.ClassID,
			Metadata: metaBytes(meta),
			ClassID:  pgUUID(classID),
		})
		return ferr
	})
}

// handleEnrollmentChanged: enrollment.changed → admin AND owner (shared operational
// signal — billing is NOT shared, AC7).
func (s *NotificationService) handleEnrollmentChanged(ctx context.Context, ev event.Event) error {
	p, err := decodePayload[EnrollmentChangedPayload](ev.Payload)
	if err != nil {
		return err
	}
	return s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		recipients, rerr := q.ListCenterOwnerAdminUserIDs(ctx, pgUUID(centerUUID))
		if rerr != nil {
			return fmt.Errorf("enrollment.changed: recipients: %w", rerr)
		}
		meta := enrollmentChangedMeta{
			SchemaVersion: notificationMetadataSchemaVersion,
			EnrollmentID:  p.EnrollmentID,
			StudentID:     p.StudentID,
			StudentName:   s.lookupUserName(ctx, q, p.StudentID),
			Action:        p.Action,
			FromClassID:   derefString(p.FromClassID),
			ToClassID:     derefString(p.ToClassID),
		}
		metaRaw := metaBytes(meta)
		body := fmt.Sprintf("An enrollment was %s.", p.Action)
		for _, uid := range recipients {
			if _, ierr := q.InsertNotification(ctx, generated.InsertNotificationParams{
				CenterID: pgUUID(centerUUID),
				UserID:   uid,
				Type:     generated.NotificationTypeEnrollmentChanged,
				Title:    "Enrollment changed",
				Body:     body,
				Link:     "/students/" + p.StudentID,
				Metadata: metaRaw,
			}); ierr != nil {
				return fmt.Errorf("enrollment.changed: insert: %w", ierr)
			}
		}
		return nil
	})
}

// handlePaymentFailed: payment.failed → the OWNER only (admin must NEVER receive
// this — R15). A center with no owner is a best-effort miss (error swallowed, DD2).
func (s *NotificationService) handlePaymentFailed(ctx context.Context, ev event.Event) error {
	return s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		owner, oerr := q.GetCenterOwnerContact(ctx, pgUUID(centerUUID))
		if oerr != nil {
			if errors.Is(oerr, pgx.ErrNoRows) {
				return nil // owner-less center — best-effort skip (matches grade/assignment/question), not an ERROR
			}
			return fmt.Errorf("payment.failed: resolve owner: %w", oerr)
		}
		meta := paymentFailedMeta{SchemaVersion: notificationMetadataSchemaVersion}
		_, ierr := q.InsertNotification(ctx, generated.InsertNotificationParams{
			CenterID: pgUUID(centerUUID),
			UserID:   owner.UserID,
			Type:     generated.NotificationTypePaymentFailed,
			Title:    "Payment failed",
			Body:     "Your most recent ClassLite payment could not be processed.",
			Link:     "/settings/billing",
			Metadata: metaBytes(meta),
		})
		return ierr
	})
}

// handleStorageThreshold: storage.threshold.crossed → the OWNER only (NOT the
// uploader), one in-app row + one EN Upgrade email (D3). used/limit come from the
// event payload (DD4 — not re-read).
func (s *NotificationService) handleStorageThreshold(ctx context.Context, ev event.Event) error {
	p, err := decodePayload[StorageThresholdPayload](ev.Payload)
	if err != nil {
		return err
	}
	var ownerEmail, ownerName string
	txErr := s.inTenantTx(ctx, model.TenantContext{CenterID: ev.CenterID}, func(q *generated.Queries) error {
		centerUUID := uuid.MustParse(ev.CenterID)
		owner, oerr := q.GetCenterOwnerContact(ctx, pgUUID(centerUUID))
		if oerr != nil {
			if errors.Is(oerr, pgx.ErrNoRows) {
				return nil // owner-less center — best-effort skip (matches grade/assignment/question), not an ERROR
			}
			return fmt.Errorf("storage.threshold: resolve owner: %w", oerr)
		}
		ownerEmail, ownerName = owner.Email, owner.FullName
		meta := storageThresholdMeta{
			SchemaVersion: notificationMetadataSchemaVersion,
			UsedBytes:     p.UsedBytes,
			LimitBytes:    p.LimitBytes,
		}
		_, ierr := q.InsertNotification(ctx, generated.InsertNotificationParams{
			CenterID: pgUUID(centerUUID),
			UserID:   owner.UserID,
			Type:     generated.NotificationTypeStorageThreshold,
			Title:    "Storage almost full",
			Body:     "Your center has used over 95% of its storage. Upgrade to Studio for more space.",
			Link:     "/settings/storage",
			Metadata: metaBytes(meta),
		})
		return ierr
	})
	if txErr != nil {
		return txErr
	}
	// Post-commit: one EN Upgrade email to the owner (best-effort; a send failure is
	// logged, not fatal — the in-app row already landed). VN deferred FU-9-4-EMAIL-LOCALE.
	if s.email != nil && ownerEmail != "" {
		subject, html := RenderStorageThresholdEmail(ownerName, s.storageSettingsURL, p.UsedBytes, p.LimitBytes)
		if serr := s.email.Send(ctx, ownerEmail, subject, html); serr != nil {
			slog.WarnContext(ctx, "storage threshold email send failed", "center_id", ev.CenterID, "error", serr)
		}
	}
	return nil
}

// lookupUserName best-effort resolves a user's display name for metadata (DD1b);
// a missing/invalid id yields "" rather than failing the notification.
func (s *NotificationService) lookupUserName(ctx context.Context, q *generated.Queries, userID string) string {
	uid, err := uuid.Parse(userID)
	if err != nil {
		return ""
	}
	u, err := q.GetUserByID(ctx, pgUUID(uid))
	if err != nil {
		return ""
	}
	return u.FullName
}

// --- read side (DD5) ---

// InboxFilter is the optional GET /api/inbox filter (AC3).
type InboxFilter struct {
	Type       string
	UnreadOnly bool
}

// isKnownNotificationType reports whether t is one of the seven ruled
// NotificationType enum values — used to 422 an unknown ?type= rather than return a
// silently empty page.
func isKnownNotificationType(t string) bool {
	switch generated.NotificationType(t) {
	case generated.NotificationTypeGradeReleased,
		generated.NotificationTypeAssignmentCreated,
		generated.NotificationTypeEnrollmentChanged,
		generated.NotificationTypeQuestionAsked,
		generated.NotificationTypeScheduleChanged,
		generated.NotificationTypePaymentFailed,
		generated.NotificationTypeStorageThreshold:
		return true
	default:
		return false
	}
}

// InboxItem is one rendered inbox row. Metadata carries the DD1b typed snapshot
// verbatim (the handler passes it through as json.RawMessage). ReadAt/ArchivedAt
// are nil-when-unset (GO-5 explicit null on the wire).
type InboxItem struct {
	ID         uuid.UUID
	Type       string
	Title      string
	Body       string
	Link       string
	Metadata   json.RawMessage
	ReadAt     *time.Time
	ArchivedAt *time.Time
	CreatedAt  time.Time
}

// ListInbox returns the caller's own active-queue rows, paginated (AC3).
func (s *NotificationService) ListInbox(ctx context.Context, tc model.TenantContext, f InboxFilter, page, pageSize int) ([]InboxItem, PageResult, error) {
	centerUUID, userUUID, err := parseTenantIdentity(tc)
	if err != nil {
		return nil, PageResult{}, err
	}
	// A non-empty ?type= must be a known NotificationType — an unknown value is a 422,
	// not a silent empty page (the api.yaml contract types it as the enum).
	if f.Type != "" && !isKnownNotificationType(f.Type) {
		return nil, PageResult{}, model.ValidationError{Fields: []model.FieldError{{Field: "type", Message: "unknown notification type"}}}
	}
	// Clamp page BEFORE clampPagination's multiply so a crafted ?page=<huge> cannot
	// overflow int64, then clamp the resulting OFFSET into int32 range (sqlc's Offset
	// is int32) — a negative OFFSET would 500 (same class as the Story 5-2a fix). A
	// page past any real inbox simply returns an empty page.
	if page > math.MaxInt32 {
		page = math.MaxInt32
	}
	page, pageSize, offset := clampPagination(page, pageSize)
	if offset > math.MaxInt32 {
		offset = math.MaxInt32
	}
	typeFilter := pgtype.Text{Valid: false}
	if f.Type != "" {
		typeFilter = pgtype.Text{String: f.Type, Valid: true}
	}

	var items []InboxItem
	var total int64
	err = s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		rows, lerr := q.ListInboxForUser(ctx, generated.ListInboxForUserParams{
			CenterID:   pgUUID(centerUUID),
			UserID:     pgUUID(userUUID),
			Type:       typeFilter,
			UnreadOnly: f.UnreadOnly,
			Limit:      int32(pageSize),
			Offset:     int32(offset),
		})
		if lerr != nil {
			return fmt.Errorf("list inbox: %w", lerr)
		}
		t, cerr := q.CountInboxForUser(ctx, generated.CountInboxForUserParams{
			CenterID:   pgUUID(centerUUID),
			UserID:     pgUUID(userUUID),
			Type:       typeFilter,
			UnreadOnly: f.UnreadOnly,
		})
		if cerr != nil {
			return fmt.Errorf("count inbox: %w", cerr)
		}
		total = t
		items = make([]InboxItem, len(rows))
		for i, r := range rows {
			items[i] = inboxItemFromRow(r)
		}
		return nil
	})
	if err != nil {
		return nil, PageResult{}, err
	}
	return items, pageResult(page, pageSize, total), nil
}

// CountUnread returns the caller's unread, non-archived count (AC4).
func (s *NotificationService) CountUnread(ctx context.Context, tc model.TenantContext) (int, error) {
	centerUUID, userUUID, err := parseTenantIdentity(tc)
	if err != nil {
		return 0, err
	}
	var count int64
	err = s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		c, cerr := q.CountUnreadForUser(ctx, generated.CountUnreadForUserParams{
			CenterID: pgUUID(centerUUID),
			UserID:   pgUUID(userUUID),
		})
		if cerr != nil {
			return fmt.Errorf("count unread: %w", cerr)
		}
		count = c
		return nil
	})
	return int(count), err
}

// MarkRead marks a caller-owned row read (AC5). Idempotent (gated on id+user_id,
// NOT read_at IS NULL): a 2nd call is a no-op success. A row owned by another user
// (same or other tenant) → NotFoundError (404 non-disclosure, never 403).
func (s *NotificationService) MarkRead(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	_, userUUID, err := parseTenantIdentity(tc)
	if err != nil {
		return err
	}
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, merr := q.MarkNotificationRead(ctx, generated.MarkNotificationReadParams{
			ID:     pgUUID(id),
			UserID: pgUUID(userUUID),
			ReadAt: pgtype.Timestamptz{Time: s.clk.Now(), Valid: true},
		}); merr != nil {
			if errors.Is(merr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "notification", ID: id.String(), Code: notificationNotFoundCode}
			}
			return fmt.Errorf("mark read: %w", merr)
		}
		return nil
	})
}

// Archive archives a caller-owned row (AC5), removing it from the active queue and
// the unread count. Cross-user → NotFoundError (404 non-disclosure).
func (s *NotificationService) Archive(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	_, userUUID, err := parseTenantIdentity(tc)
	if err != nil {
		return err
	}
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, aerr := q.ArchiveNotification(ctx, generated.ArchiveNotificationParams{
			ID:         pgUUID(id),
			UserID:     pgUUID(userUUID),
			ArchivedAt: pgtype.Timestamptz{Time: s.clk.Now(), Valid: true},
		}); aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "notification", ID: id.String(), Code: notificationNotFoundCode}
			}
			return fmt.Errorf("archive: %w", aerr)
		}
		return nil
	})
}

// MarkAllRead stamps every unread, non-archived row for the caller read (DD5; the
// mark-all-read UI ships in 10-1b).
func (s *NotificationService) MarkAllRead(ctx context.Context, tc model.TenantContext) error {
	centerUUID, userUUID, err := parseTenantIdentity(tc)
	if err != nil {
		return err
	}
	return s.inTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, merr := q.MarkAllReadForUser(ctx, generated.MarkAllReadForUserParams{
			ReadAt:   pgtype.Timestamptz{Time: s.clk.Now(), Valid: true},
			CenterID: pgUUID(centerUUID),
			UserID:   pgUUID(userUUID),
		}); merr != nil {
			return fmt.Errorf("mark all read: %w", merr)
		}
		return nil
	})
}

// --- helpers ---

// parseTenantIdentity parses the center + user UUIDs out of a TenantContext; a
// malformed context is a programming/middleware bug surfaced as a forbidden error.
func parseTenantIdentity(tc model.TenantContext) (centerUUID, userUUID uuid.UUID, err error) {
	centerUUID, err = uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err = uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	return centerUUID, userUUID, nil
}

func inboxItemFromRow(r generated.Notification) InboxItem {
	metadata := json.RawMessage(r.Metadata)
	if len(metadata) == 0 {
		metadata = json.RawMessage(`{}`)
	}
	return InboxItem{
		ID:         uuid.UUID(r.ID.Bytes),
		Type:       string(r.Type),
		Title:      r.Title,
		Body:       r.Body,
		Link:       r.Link,
		Metadata:   metadata,
		ReadAt:     timestamptzToPtr(r.ReadAt),
		ArchivedAt: timestamptzToPtr(r.ArchivedAt),
		CreatedAt:  r.CreatedAt.Time,
	}
}

// timestamptzToPtr maps a nullable timestamptz to *time.Time (nil when NULL — GO-5).
func timestamptzToPtr(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

// wireTimestamp formats a nullable timestamptz as an RFC3339 string ("" when NULL)
// for metadata snapshots.
func wireTimestamp(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339)
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
