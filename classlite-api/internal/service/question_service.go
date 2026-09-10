// Package service — Story 7.4a QuestionService.
//
// Anchored Q&A: a student asks a class-anchored question from inside an attempt;
// the teacher of that class replies (personal or shared visibility) and may
// resolve. Q&A is teacher↔student ONLY — Owner/Admin see nothing (R25/R26): the
// read scope elides to an empty result in the store query, and the reply/resolve
// verbs return 404 QUESTION_NOT_FOUND (non-disclosure) for any non-teaching
// caller. Notify is event-only (D4): QuestionAsked fans out post-commit to zero
// handlers today (Epic 10 Inbox subscribes later); NO email.
//
// Authz (SEC-1, service-layer — never RLS, never the JWT claim): every privilege
// decision re-reads center_members.role inside the tenant tx, so a demoted
// teacher on a stale 15-min token cannot reply/resolve even while still a class's
// teacher_id (EDGE-2). class_id/exercise_id are DERIVED server-side from the
// asking student's assignment (D3, SEC-7) — never trusted from the body.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
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

const (
	questionNotFoundCode       = "QUESTION_NOT_FOUND"
	questionTargetNotFoundCode = "QUESTION_TARGET_NOT_FOUND"

	anchorTypeItem     = "item"
	anchorTypeExercise = "exercise"

	visibilityPersonal = "personal"
	visibilityShared   = "shared"

	questionStatusOpen     = "open"
	questionStatusResolved = "resolved"

	anchorSchemaVersion = 1

	// maxBatchReply caps POST /api/questions/batch-reply (AC12) — above it → 422.
	maxBatchReply = 50

	// maxContentLen / maxAnchorExcerptLen bound the free-text fields (defense in
	// depth under the handler's 16KB whole-body cap). Mirror the api.yaml maxLength.
	maxContentLen       = 5000
	maxAnchorExcerptLen = 2000
)

// QuestionAnchor is the typed, versioned (GO-7) positional anchor stored in
// questions.anchor_ref. Exercise items carry no stable id (D2), so an item
// anchor is a positional path: a section index plus EITHER a group/question path
// (a question within a group) OR a char span (a passage selection). The
// denormalized anchor_excerpt snapshot — not this path — is authoritative for
// display; the path is best-effort re-highlighting for the 7-4b frontend.
type QuestionAnchor struct {
	SchemaVersion      int  `json:"schemaVersion"`
	SectionIndex       int  `json:"sectionIndex"`
	QuestionGroupIndex *int `json:"questionGroupIndex"`
	QuestionIndex      *int `json:"questionIndex"`
	CharStart          *int `json:"charStart"`
	CharEnd            *int `json:"charEnd"`
}

// QuestionService owns ask / list / thread / reply / resolve / batch-reply.
// events is the nil-tolerant post-commit QuestionAsked seam (D4 — no emailQueue).
type QuestionService struct {
	db     AuthDB
	clk    clock.Clock
	events *event.Bus
}

// NewQuestionService constructs a QuestionService. events is nil-tolerant so lean
// test harnesses can omit the bus (a nil bus skips the publish).
func NewQuestionService(db AuthDB, clk clock.Clock, events *event.Bus) *QuestionService {
	return &QuestionService{db: db, clk: clk, events: events}
}

// --- service-facing shapes (the handler renders these; read shapes PROVISIONAL) ---

// Question is one question thread head.
type Question struct {
	ID            string
	CenterID      string
	ExerciseID    string
	ClassID       string
	StudentID     string
	AnchorType    string
	AnchorRef     *QuestionAnchor
	AnchorExcerpt *string
	Content       string
	Status        string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

// QuestionReply is one reply on a thread.
type QuestionReply struct {
	ID         string
	QuestionID string
	AuthorID   string
	Content    string
	Visibility string
	CreatedAt  time.Time
}

// QuestionThread is a question plus its reader-scoped replies (AC6 GET /{id}).
type QuestionThread struct {
	Question Question
	Replies  []QuestionReply
}

// AskInput is the validated ask payload (AC4). AssignmentID drives the D3
// server-side derivation of class_id + exercise_id.
type AskInput struct {
	AssignmentID  uuid.UUID
	AnchorType    string
	AnchorRef     *QuestionAnchor
	AnchorExcerpt *string
	Content       string
}

// ReplyInput is the validated teacher-reply payload (AC8).
type ReplyInput struct {
	Content    string
	Visibility string
	Resolve    bool
}

// QuestionListFilter is the role-scoped list query (AC6).
type QuestionListFilter struct {
	ExerciseID *uuid.UUID
	ClassID    *uuid.UUID
	Status     *string
	Unanswered bool
	Page       int
	PageSize   int
}

// QuestionAskedPayload is the event.QuestionAsked payload (AC14). PII is never
// logged (the bus logs only type/center/user, EDGE-4).
type QuestionAskedPayload struct {
	QuestionID string `json:"questionId"`
	StudentID  string `json:"studentId"`
	ClassID    string `json:"classId"`
	ExerciseID string `json:"exerciseId"`
}

// --- errors ---

func questionNotFound() error {
	return model.NotFoundError{Resource: "question", Code: questionNotFoundCode}
}

func questionTargetNotFound() error {
	return model.NotFoundError{Resource: "assignment", Code: questionTargetNotFoundCode}
}

func insufficientRole() error {
	return &ForbiddenError{Reason: "insufficient role"}
}

// --- tx opener (shared by reads + writes) ---

// beginQuestionTx opens a tenant tx, sets the RLS context (PERF-1 — even reads),
// and re-reads the caller's DB role (SEC-1). The caller commits (writes) or rolls
// back (reads). Returns the tx, a queries handle bound to it, the parsed
// center/user UUIDs, and the authoritative DB role.
func (s *QuestionService) beginQuestionTx(
	ctx context.Context, tc model.TenantContext,
) (pgx.Tx, *generated.Queries, uuid.UUID, uuid.UUID, string, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, "", &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, "", &ForbiddenError{Reason: "invalid tenant context"}
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, "", fmt.Errorf("question tx: begin: %w", err)
	}
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, uuid.Nil, uuid.Nil, "", fmt.Errorf("question tx: %w", err)
	}
	txQ := generated.New(tx)

	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, uuid.Nil, uuid.Nil, "", insufficientRole()
		}
		return nil, nil, uuid.Nil, uuid.Nil, "", fmt.Errorf("question tx: get member: %w", err)
	}
	return tx, txQ, centerUUID, userUUID, member.Role, nil
}

// --- ask (student) ---

// Ask creates a class-anchored question from a student's attempt (AC4). Non-
// student → 403 INSUFFICIENT_ROLE; not the attempt owner or not actively enrolled
// → 404 QUESTION_TARGET_NOT_FOUND (non-disclosure, AC5). class_id + exercise_id
// are derived from the assignment (D3). QuestionAsked publishes post-commit (D4).
func (s *QuestionService) Ask(ctx context.Context, tc model.TenantContext, in AskInput) (*Question, error) {
	if err := validateAskInput(in); err != nil {
		return nil, err
	}
	anchorBytes, err := marshalAnchor(in.AnchorRef)
	if err != nil {
		return nil, err
	}

	tx, txQ, centerUUID, userUUID, role, err := s.beginQuestionTx(ctx, tc)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if role != model.RoleStudent {
		return nil, insufficientRole()
	}

	asg, err := txQ.GetAssignmentForQuestion(ctx, pgUUID(in.AssignmentID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, questionTargetNotFound()
		}
		return nil, fmt.Errorf("ask: get assignment: %w", err)
	}

	owns, err := txQ.StudentOwnsAttempt(ctx, generated.StudentOwnsAttemptParams{
		AssignmentID: pgUUID(in.AssignmentID),
		StudentID:    pgUUID(userUUID),
	})
	if err != nil {
		return nil, fmt.Errorf("ask: attempt ownership: %w", err)
	}
	if !owns {
		return nil, questionTargetNotFound()
	}

	if _, err := txQ.GetActiveEnrollmentForQuestion(ctx, generated.GetActiveEnrollmentForQuestionParams{
		ClassID:   asg.ClassID,
		StudentID: pgUUID(userUUID),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, questionTargetNotFound()
		}
		return nil, fmt.Errorf("ask: active enrollment: %w", err)
	}

	created, err := txQ.CreateQuestion(ctx, generated.CreateQuestionParams{
		ID:            pgUUID(uuid.New()),
		CenterID:      pgUUID(centerUUID),
		ExerciseID:    asg.ExerciseID,
		ClassID:       asg.ClassID,
		StudentID:     pgUUID(userUUID),
		AnchorType:    in.AnchorType,
		AnchorRef:     anchorBytes,
		AnchorExcerpt: pgTextFromPtr(in.AnchorExcerpt),
		Content:       in.Content,
	})
	if err != nil {
		return nil, fmt.Errorf("ask: create question: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("ask: commit: %w", err)
	}

	q := questionFromModel(created)
	s.publish(ctx, tc, QuestionAskedPayload{
		QuestionID: q.ID,
		StudentID:  q.StudentID,
		ClassID:    q.ClassID,
		ExerciseID: q.ExerciseID,
	})
	return &q, nil
}

// --- read (role-scoped) ---

// List returns the caller's role-scoped questions (AC6/AC7). Scope keys off the
// DB role (SEC-1): student → own; teacher → own classes; owner/admin → empty (the
// store query matches nothing — never null, never 403).
func (s *QuestionService) List(
	ctx context.Context, tc model.TenantContext, filter QuestionListFilter,
) ([]Question, PageResult, error) {
	tx, txQ, centerUUID, userUUID, role, err := s.beginQuestionTx(ctx, tc)
	if err != nil {
		return nil, PageResult{}, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	page, pageSize, offset := clampPagination(filter.Page, filter.PageSize)

	rows, err := txQ.ListQuestionsForReader(ctx, generated.ListQuestionsForReaderParams{
		CenterID:   pgUUID(centerUUID),
		ReaderRole: role,
		ReaderID:   pgUUID(userUUID),
		ExerciseID: pgUUIDPtr(filter.ExerciseID),
		ClassID:    pgUUIDPtr(filter.ClassID),
		Status:     pgTextFromPtr(filter.Status),
		Unanswered: pgBoolFilter(filter.Unanswered),
		Limit:      int32(pageSize),
		Offset:     int32(offset),
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("list questions: %w", err)
	}
	total, err := txQ.CountQuestionsForReader(ctx, generated.CountQuestionsForReaderParams{
		CenterID:   pgUUID(centerUUID),
		ReaderRole: role,
		ReaderID:   pgUUID(userUUID),
		ExerciseID: pgUUIDPtr(filter.ExerciseID),
		ClassID:    pgUUIDPtr(filter.ClassID),
		Status:     pgTextFromPtr(filter.Status),
		Unanswered: pgBoolFilter(filter.Unanswered),
	})
	if err != nil {
		return nil, PageResult{}, fmt.Errorf("count questions: %w", err)
	}

	out := make([]Question, len(rows))
	for i, r := range rows {
		out[i] = questionFromReaderRow(r)
	}
	return out, pageResult(page, pageSize, total), nil
}

// GetThread returns one question + its reader-scoped replies (AC6 GET /{id}). A
// question the caller cannot see → 404 QUESTION_NOT_FOUND (non-disclosure).
func (s *QuestionService) GetThread(
	ctx context.Context, tc model.TenantContext, questionID uuid.UUID,
) (*QuestionThread, error) {
	tx, txQ, centerUUID, userUUID, role, err := s.beginQuestionTx(ctx, tc)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	row, err := txQ.GetQuestionForReader(ctx, generated.GetQuestionForReaderParams{
		CenterID:   pgUUID(centerUUID),
		QuestionID: pgUUID(questionID),
		ReaderRole: role,
		ReaderID:   pgUUID(userUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, questionNotFound()
		}
		return nil, fmt.Errorf("get thread: question: %w", err)
	}

	replies, err := txQ.ListRepliesForReader(ctx, generated.ListRepliesForReaderParams{
		CenterID:   pgUUID(centerUUID),
		QuestionID: pgUUID(questionID),
		ReaderRole: role,
		ReaderID:   pgUUID(userUUID),
	})
	if err != nil {
		return nil, fmt.Errorf("get thread: replies: %w", err)
	}

	thread := &QuestionThread{Question: questionFromSingleReaderRow(row)}
	thread.Replies = make([]QuestionReply, len(replies))
	for i, r := range replies {
		thread.Replies[i] = replyFromReaderRow(r)
	}
	return thread, nil
}

// --- reply / resolve (teacher) ---

// Reply inserts a teacher reply and, if Resolve, flips the question resolved in
// the same tx (AC8/AC11). Authz (SEC-1, DB role): student → 403 INSUFFICIENT_ROLE
// (FIND-1 ruling: the asker can see their own thread, so a 404 would be
// dishonest — this is the ONLY verb where a student gets 403, resolve/batch give
// 404); owner/admin/non-teaching-teacher → 404 QUESTION_NOT_FOUND.
func (s *QuestionService) Reply(
	ctx context.Context, tc model.TenantContext, questionID uuid.UUID, in ReplyInput,
) (*QuestionReply, error) {
	if err := validateReplyInput(in); err != nil {
		return nil, err
	}

	tx, txQ, centerUUID, userUUID, role, err := s.beginQuestionTx(ctx, tc)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := s.authorizeTeacherOfQuestion(ctx, txQ, questionID, userUUID, role, insufficientRole()); err != nil {
		return nil, err
	}

	created, err := txQ.CreateReply(ctx, generated.CreateReplyParams{
		ID:         pgUUID(uuid.New()),
		CenterID:   pgUUID(centerUUID),
		QuestionID: pgUUID(questionID),
		AuthorID:   pgUUID(userUUID),
		Content:    in.Content,
		Visibility: in.Visibility,
	})
	if err != nil {
		return nil, fmt.Errorf("reply: create: %w", err)
	}

	if in.Resolve {
		if _, err := txQ.ResolveQuestion(ctx, pgUUID(questionID)); err != nil {
			return nil, fmt.Errorf("reply: resolve: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("reply: commit: %w", err)
	}
	reply := replyFromModel(created)
	return &reply, nil
}

// Resolve flips a question open→resolved (AC11), one-way. Same teacher-of-class
// authz as Reply (SEC-1), but a student caller gets 404 QUESTION_NOT_FOUND (not
// 403) — resolve is a teacher-only verb the student never sees (AC11, D1).
func (s *QuestionService) Resolve(ctx context.Context, tc model.TenantContext, questionID uuid.UUID) error {
	tx, txQ, _, userUUID, role, err := s.beginQuestionTx(ctx, tc)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := s.authorizeTeacherOfQuestion(ctx, txQ, questionID, userUUID, role, questionNotFound()); err != nil {
		return err
	}
	if _, err := txQ.ResolveQuestion(ctx, pgUUID(questionID)); err != nil {
		return fmt.Errorf("resolve: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("resolve: commit: %w", err)
	}
	return nil
}

// BatchReply inserts one reply per listed question and (if Resolve) resolves each
// — all in ONE transaction (AC12). If the teacher does not teach the class of ANY
// listed question, the whole request is 404 QUESTION_NOT_FOUND with zero writes
// (partial success is impossible; a student caller likewise → 404, not 403, D1).
// Duplicate ids are a client error (422) — "one reply per listed question" (AC12).
// Above maxBatchReply → 422.
func (s *QuestionService) BatchReply(
	ctx context.Context, tc model.TenantContext, questionIDs []uuid.UUID, in ReplyInput,
) ([]QuestionReply, error) {
	if len(questionIDs) == 0 {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "questionIds", Message: "at least one question id is required"}}}
	}
	if len(questionIDs) > maxBatchReply {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "questionIds", Message: fmt.Sprintf("at most %d questions per batch", maxBatchReply)}}}
	}
	seen := make(map[uuid.UUID]struct{}, len(questionIDs))
	for _, qid := range questionIDs {
		if _, dup := seen[qid]; dup {
			return nil, model.ValidationError{Fields: []model.FieldError{{Field: "questionIds", Message: "must not contain duplicate ids"}}}
		}
		seen[qid] = struct{}{}
	}
	if err := validateReplyInput(in); err != nil {
		return nil, err
	}

	tx, txQ, centerUUID, userUUID, role, err := s.beginQuestionTx(ctx, tc)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	out := make([]QuestionReply, 0, len(questionIDs))
	for _, qid := range questionIDs {
		if _, err := s.authorizeTeacherOfQuestion(ctx, txQ, qid, userUUID, role, questionNotFound()); err != nil {
			// Any single un-taught question fails the whole batch (rollback via defer).
			return nil, err
		}
		created, err := txQ.CreateReply(ctx, generated.CreateReplyParams{
			ID:         pgUUID(uuid.New()),
			CenterID:   pgUUID(centerUUID),
			QuestionID: pgUUID(qid),
			AuthorID:   pgUUID(userUUID),
			Content:    in.Content,
			Visibility: in.Visibility,
		})
		if err != nil {
			return nil, fmt.Errorf("batch reply: create: %w", err)
		}
		if in.Resolve {
			if _, err := txQ.ResolveQuestion(ctx, pgUUID(qid)); err != nil {
				return nil, fmt.Errorf("batch reply: resolve: %w", err)
			}
		}
		out = append(out, replyFromModel(created))
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("batch reply: commit: %w", err)
	}
	return out, nil
}

// authorizeTeacherOfQuestion is the SEC-1 reply/resolve gate. role is the
// DB-fetched center_members.role. The student disposition is caller-supplied
// (FIND-1, Ducdo D1 2026-09-10): the reply verb passes 403 INSUFFICIENT_ROLE (the
// asker can see their own thread, so a 404 would be dishonest), while resolve /
// batch-reply pass 404 QUESTION_NOT_FOUND to match AC11/AC12 + api.yaml. owner/
// admin → 404; teacher who does not teach the question's class (or a missing
// question) → 404 (non-disclosure). Returns the question row on success.
func (s *QuestionService) authorizeTeacherOfQuestion(
	ctx context.Context, txQ *generated.Queries, questionID, userUUID uuid.UUID, role string, studentErr error,
) (generated.GetQuestionForAuthzRow, error) {
	if role == model.RoleStudent {
		return generated.GetQuestionForAuthzRow{}, studentErr
	}
	if role != model.RoleTeacher {
		// owner/admin → non-disclosure 404 (never learn the thread exists).
		return generated.GetQuestionForAuthzRow{}, questionNotFound()
	}
	q, err := txQ.GetQuestionForAuthz(ctx, pgUUID(questionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.GetQuestionForAuthzRow{}, questionNotFound()
		}
		return generated.GetQuestionForAuthzRow{}, fmt.Errorf("authz: get question: %w", err)
	}
	if !q.ClassTeacherID.Valid || uuid.UUID(q.ClassTeacherID.Bytes) != userUUID {
		return generated.GetQuestionForAuthzRow{}, questionNotFound()
	}
	return q, nil
}

// --- event publish (post-commit, nil-tolerant) ---

// publish fans out QuestionAsked to zero handlers today (Epic 10 Inbox subscribes
// later). Nil-tolerant so lean test harnesses can omit the bus.
func (s *QuestionService) publish(ctx context.Context, tc model.TenantContext, payload QuestionAskedPayload) {
	if s.events == nil {
		return
	}
	s.events.Publish(ctx, event.Event{
		Type:      event.QuestionAsked,
		CenterID:  tc.CenterID,
		UserID:    tc.UserID,
		Payload:   payload,
		Timestamp: s.clk.Now(),
	})
}

// --- validation ---

func validateAskInput(in AskInput) error {
	var fields []model.FieldError
	if strings.TrimSpace(in.Content) == "" {
		fields = append(fields, model.FieldError{Field: "content", Message: "content is required"})
	} else if len(in.Content) > maxContentLen {
		fields = append(fields, model.FieldError{Field: "content", Message: fmt.Sprintf("must be at most %d characters", maxContentLen)})
	}
	if in.AnchorExcerpt != nil && len(*in.AnchorExcerpt) > maxAnchorExcerptLen {
		fields = append(fields, model.FieldError{Field: "anchorExcerpt", Message: fmt.Sprintf("must be at most %d characters", maxAnchorExcerptLen)})
	}
	switch in.AnchorType {
	case anchorTypeExercise:
		if in.AnchorRef != nil {
			fields = append(fields, model.FieldError{Field: "anchorRef", Message: "must be null when anchorType is exercise"})
		}
	case anchorTypeItem:
		if in.AnchorRef == nil {
			fields = append(fields, model.FieldError{Field: "anchorRef", Message: "is required when anchorType is item"})
		} else if !anchorHasTarget(in.AnchorRef) {
			fields = append(fields, model.FieldError{Field: "anchorRef", Message: "must carry a group/question path or a char span"})
		} else {
			fields = append(fields, validateItemAnchor(in.AnchorRef)...)
		}
	default:
		fields = append(fields, model.FieldError{Field: "anchorType", Message: "must be item or exercise"})
	}
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

// anchorHasTarget reports whether an item anchor carries at least a group/question
// path OR a char span (a bare sectionIndex is not enough to re-highlight).
func anchorHasTarget(a *QuestionAnchor) bool {
	hasItemPath := a.QuestionGroupIndex != nil && a.QuestionIndex != nil
	hasCharSpan := a.CharStart != nil && a.CharEnd != nil
	return hasItemPath || hasCharSpan
}

// validateItemAnchor sanity-checks the positional indices of an item anchor: no
// negative index, and a char span must be well-ordered (charStart <= charEnd).
// (Cross-validation of indices against the exercise's actual structure is deferred
// per D2 — the anchor_excerpt snapshot is authoritative for display.)
func validateItemAnchor(a *QuestionAnchor) []model.FieldError {
	var fields []model.FieldError
	if a.SectionIndex < 0 {
		fields = append(fields, model.FieldError{Field: "anchorRef.sectionIndex", Message: "must not be negative"})
	}
	if a.QuestionGroupIndex != nil && *a.QuestionGroupIndex < 0 {
		fields = append(fields, model.FieldError{Field: "anchorRef.questionGroupIndex", Message: "must not be negative"})
	}
	if a.QuestionIndex != nil && *a.QuestionIndex < 0 {
		fields = append(fields, model.FieldError{Field: "anchorRef.questionIndex", Message: "must not be negative"})
	}
	if a.CharStart != nil && *a.CharStart < 0 {
		fields = append(fields, model.FieldError{Field: "anchorRef.charStart", Message: "must not be negative"})
	}
	if a.CharEnd != nil && *a.CharEnd < 0 {
		fields = append(fields, model.FieldError{Field: "anchorRef.charEnd", Message: "must not be negative"})
	}
	if a.CharStart != nil && a.CharEnd != nil && *a.CharStart > *a.CharEnd {
		fields = append(fields, model.FieldError{Field: "anchorRef.charEnd", Message: "must be greater than or equal to charStart"})
	}
	return fields
}

func validateReplyInput(in ReplyInput) error {
	var fields []model.FieldError
	if strings.TrimSpace(in.Content) == "" {
		fields = append(fields, model.FieldError{Field: "content", Message: "content is required"})
	} else if len(in.Content) > maxContentLen {
		fields = append(fields, model.FieldError{Field: "content", Message: fmt.Sprintf("must be at most %d characters", maxContentLen)})
	}
	if in.Visibility != visibilityPersonal && in.Visibility != visibilityShared {
		fields = append(fields, model.FieldError{Field: "visibility", Message: "must be personal or shared"})
	}
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

// marshalAnchor serializes the anchor to JSONB, stamping the schema version.
// A nil anchor (anchor_type='exercise') yields nil bytes → SQL NULL.
func marshalAnchor(a *QuestionAnchor) ([]byte, error) {
	if a == nil {
		return nil, nil
	}
	stamped := *a
	stamped.SchemaVersion = anchorSchemaVersion
	b, err := json.Marshal(stamped)
	if err != nil {
		return nil, fmt.Errorf("marshal anchor: %w", err)
	}
	return b, nil
}

// unmarshalAnchor parses stored anchor_ref bytes into a typed anchor (nil bytes →
// nil, an exercise-anchored question).
func unmarshalAnchor(b []byte) *QuestionAnchor {
	if len(b) == 0 {
		return nil
	}
	var a QuestionAnchor
	if err := json.Unmarshal(b, &a); err != nil {
		// A stored anchor that no longer parses (schema drift / corruption) renders
		// as anchorRef:null rather than failing the read — but never silently: the
		// excerpt snapshot stays authoritative for display (D2). Log metadata only
		// (positional indices, no PII — EDGE-4).
		slog.Warn("question anchor_ref failed to unmarshal; rendering anchorRef as null", "error", err, "bytes", len(b))
		return nil
	}
	return &a
}

// --- converters ---

func questionFromModel(q generated.Question) Question {
	return Question{
		ID:            uuid.UUID(q.ID.Bytes).String(),
		CenterID:      uuid.UUID(q.CenterID.Bytes).String(),
		ExerciseID:    uuid.UUID(q.ExerciseID.Bytes).String(),
		ClassID:       uuid.UUID(q.ClassID.Bytes).String(),
		StudentID:     uuid.UUID(q.StudentID.Bytes).String(),
		AnchorType:    q.AnchorType,
		AnchorRef:     unmarshalAnchor(q.AnchorRef),
		AnchorExcerpt: pgTextToPtr(q.AnchorExcerpt),
		Content:       q.Content,
		Status:        q.Status,
		CreatedAt:     q.CreatedAt.Time,
		UpdatedAt:     q.UpdatedAt.Time,
	}
}

func questionFromReaderRow(r generated.ListQuestionsForReaderRow) Question {
	return Question{
		ID:            uuid.UUID(r.QuestionID.Bytes).String(),
		ExerciseID:    uuid.UUID(r.ExerciseID.Bytes).String(),
		ClassID:       uuid.UUID(r.ClassID.Bytes).String(),
		StudentID:     uuid.UUID(r.StudentID.Bytes).String(),
		AnchorType:    r.AnchorType,
		AnchorRef:     unmarshalAnchor(r.AnchorRef),
		AnchorExcerpt: pgTextToPtr(r.AnchorExcerpt),
		Content:       r.Content,
		Status:        r.Status,
		CreatedAt:     r.CreatedAt.Time,
	}
}

func questionFromSingleReaderRow(r generated.GetQuestionForReaderRow) Question {
	return Question{
		ID:            uuid.UUID(r.QuestionID.Bytes).String(),
		ExerciseID:    uuid.UUID(r.ExerciseID.Bytes).String(),
		ClassID:       uuid.UUID(r.ClassID.Bytes).String(),
		StudentID:     uuid.UUID(r.StudentID.Bytes).String(),
		AnchorType:    r.AnchorType,
		AnchorRef:     unmarshalAnchor(r.AnchorRef),
		AnchorExcerpt: pgTextToPtr(r.AnchorExcerpt),
		Content:       r.Content,
		Status:        r.Status,
		CreatedAt:     r.CreatedAt.Time,
	}
}

func replyFromModel(r generated.QuestionReply) QuestionReply {
	return QuestionReply{
		ID:         uuid.UUID(r.ID.Bytes).String(),
		QuestionID: uuid.UUID(r.QuestionID.Bytes).String(),
		AuthorID:   uuid.UUID(r.AuthorID.Bytes).String(),
		Content:    r.Content,
		Visibility: r.Visibility,
		CreatedAt:  r.CreatedAt.Time,
	}
}

func replyFromReaderRow(r generated.ListRepliesForReaderRow) QuestionReply {
	return QuestionReply{
		ID:         uuid.UUID(r.ReplyID.Bytes).String(),
		QuestionID: uuid.UUID(r.QuestionID.Bytes).String(),
		AuthorID:   uuid.UUID(r.AuthorID.Bytes).String(),
		Content:    r.Content,
		Visibility: r.Visibility,
		CreatedAt:  r.CreatedAt.Time,
	}
}

// pgBoolFilter maps a Go bool filter to a nullable pg bool: false ⇒ absent
// (Valid=false, no filter), true ⇒ present-and-true (restrict to open).
func pgBoolFilter(v bool) pgtype.Bool {
	if !v {
		return pgtype.Bool{Valid: false}
	}
	return pgtype.Bool{Bool: true, Valid: true}
}
