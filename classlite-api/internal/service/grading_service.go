// Story 6.1 — GradingService: the Writing grading keystone (grade write/release,
// revise, teacher grading read, grading queue). Lives in package `service` (not the
// grading subpackage) so it reuses the attempt tenant-tx wrappers, the answer-strip
// exercise mapper (toAttemptExercise), and the shared pg/uuid helpers; the PURE
// scorer + validation stay in internal/service/grading per the spec.
//
// Authz (SEC-1): the coarse {owner,admin,teacher} gate is the route's RequireRole
// (→ INSUFFICIENT_ROLE for students); this service additionally (a) re-validates the
// caller's DB role for WRITES (a demoted teacher with a live JWT is rejected) and
// (b) narrows a teacher to the class they teach — a same-tenant teacher on another
// class gets 403 FORBIDDEN; owner/admin bypass; cross-tenant/absent is 404 via RLS
// (no oracle). AC11.
//
// Transactional outbox (D2): the grade tx contains ONLY DB writes — grade insert +
// (grade path) submission submitted→graded + audit rows + a durable grade-release
// job row (reuse of the 4.3a jobs infra; idempotency anchor = gradeId). The
// event.GradeReleased publish + the Resend email happen POST-COMMIT off that job
// (see worker/grade_release.go). Nothing external runs inside the tx.
//
// Concurrency: GRADE takes the submission FOR UPDATE (LockSubmissionForGrading) so a
// second grade blocks, then sees status='graded' → 409 SUBMISSION_ALREADY_GRADED with
// ZERO side effects (B3); UNIQUE(submission_id,1) is the backstop. REVISE does NOT
// serialize on the submission lock — two concurrent revises both compute version=N+1
// and the UNIQUE(submission_id,version) index rejects the loser (23505 → 409 retry,
// zero side effects, AC6). A serializing lock there would make 23505 impossible.
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
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	gradeCreatedAction    = "grade.created"
	gradeReleasedAction   = "grade.released"
	gradeRevisedAction    = "grade.revised"
	gradeReReleasedAction = "grade.re_released"
	gradeAuditEntity      = "submission" // grades are audited against their submission

	submissionStatusSubmitted = "submitted"
	submissionStatusGraded    = "graded"

	initialGradeVersion = 1

	// skillWriting is the only exercise skill this grading surface accepts (s23 is
	// Writing-only; Speaking is 6.3, quiz auto-grading is 6.4).
	skillWriting = "writing"
)

// GradingService owns the Writing grading write + read paths.
type GradingService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewGradingService constructs a GradingService.
func NewGradingService(db AuthDB, audit AuditLogger, clk clock.Clock) *GradingService {
	return &GradingService{db: db, audit: audit, clk: clk}
}

// GradeWriteInput is a validated-at-the-handler grade/revise payload. OverallBand is
// NEVER carried (AC7). Reason is required for revise, ignored for grade.
type GradeWriteInput struct {
	Scores   grading.CriterionScores
	Comments []grading.Comment
	Feedback *string
	Reason   string
}

// GradeView is the domain grade returned to the teacher (parsed from the row).
type GradeView struct {
	ID           string
	SubmissionID string
	Version      int
	Scores       grading.CriterionScores
	OverallBand  float64
	Comments     []grading.Comment
	Feedback     *string
	GradedBy     string
	ReleasedAt   *time.Time
	CreatedAt    time.Time
}

// GradingStudentRef is the {id, fullName} student subset in the teacher read.
type GradingStudentRef struct {
	ID       string
	FullName string
}

// TeacherGradingView is the AC8 teacher grading read. AiSuggestion (Story 6.2a D2)
// is the latest COMPLETE ai_grade_writing suggestion for this submission, or nil —
// teacher-only, class-shared (a co-teacher/admin sees it), and NEVER on the student
// /result path.
type TeacherGradingView struct {
	Submission   SubmissionResult
	Assignment   generated.Assignment
	Student      GradingStudentRef
	Exercise     AttemptExercise
	Grade        *GradeView
	AiSuggestion *model.AIWritingGradeResult
}

// GradingQueueRow is one AC17 queue row (assignmentTitle/className are constant for
// the queue, stamped by the service).
type GradingQueueRow struct {
	SubmissionID    string
	StudentName     string
	AssignmentTitle string
	ClassName       string
	Status          string
	IsOverdue       bool
	Released        bool
	OverallBand     *float64
}

// GradeWriting creates + releases the initial grade for a submitted Writing
// submission (AC4). See the package doc for the concurrency + outbox contract.
func (s *GradingService) GradeWriting(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID, in GradeWriteInput,
) (GradeView, error) {
	if err := grading.ValidateCriterionScores(in.Scores); err != nil {
		return GradeView{}, err
	}
	var out GradeView
	err := s.mutateInGradingTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		userID, role, rerr := revalidateStaffRole(ctx, q, tc)
		if rerr != nil {
			return rerr
		}
		// Lock the submission row (B3): the already-graded check happens under the
		// lock, not as a TOCTOU pre-check.
		sub, gerr := q.LockSubmissionForGrading(ctx, pgUUID(submissionID))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return gradingSubmissionNotFound(submissionID)
			}
			return fmt.Errorf("grade writing: lock submission: %w", gerr)
		}
		assignment, aerr := loadAssignmentForGrading(ctx, q, sub)
		if aerr != nil {
			return aerr
		}
		if serr := assertTeacherOfSubmissionClass(ctx, q, role, userID.String(), assignment); serr != nil {
			return serr
		}
		if serr := assertWritingExercise(ctx, q, assignment); serr != nil {
			return serr
		}
		switch sub.Status {
		case submissionStatusSubmitted:
			// gradable
		case submissionStatusGraded:
			return alreadyGradedConflict(submissionID)
		default: // in_progress / ai_processing
			return model.ConflictError{
				Resource: "submission", ID: submissionID.String(),
				Code: "SUBMISSION_NOT_GRADABLE", Message: "submission is not ready to grade",
			}
		}

		comments, verr := grading.NormalizeComments(in.Comments, grading.EssayText(sub.Content))
		if verr != nil {
			return verr
		}
		gradeRow, ierr := s.insertGradeRow(ctx, q, sub, userID, initialGradeVersion, in, comments)
		if ierr != nil {
			return translateGradeWriteError(ierr, false)
		}
		// Guarded submitted → graded flip. 0 rows → a concurrent writer won the race
		// (should not happen under the row lock, but the guard commits zero side
		// effects for the loser). P0001 from the immutability trigger → 409.
		if _, uerr := q.GradeSubmission(ctx, generated.GradeSubmissionParams{
			ID: sub.ID, UpdatedAt: pgTimestamptz(s.clk.Now()),
		}); uerr != nil {
			if errors.Is(uerr, pgx.ErrNoRows) {
				return alreadyGradedConflict(submissionID)
			}
			return translateGradeWriteError(uerr, false)
		}
		if aerr := s.auditGrade(ctx, tx, tc, sub.ID, gradeCreatedAction, gradeRow, ""); aerr != nil {
			return aerr
		}
		if aerr := s.auditGrade(ctx, tx, tc, sub.ID, gradeReleasedAction, gradeRow, ""); aerr != nil {
			return aerr
		}
		if oerr := s.enqueueGradeReleaseOutbox(ctx, q, sub, assignment, gradeRow, userID); oerr != nil {
			return oerr
		}
		view, cerr := gradeViewFromGrade(gradeRow)
		if cerr != nil {
			return cerr
		}
		out = view
		return nil
	})
	return out, err
}

// ReviseGrade appends a new grade version N+1 and re-releases (AC6). The submission
// row is NOT updated (stays graded — D1). Relies on UNIQUE(submission_id,version) for
// concurrent-revise safety (23505 → 409 retry).
func (s *GradingService) ReviseGrade(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID, in GradeWriteInput,
) (GradeView, error) {
	if strings.TrimSpace(in.Reason) == "" {
		return GradeView{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "reason", Code: "REQUIRED", Message: "a revision reason is required",
		}}}
	}
	if err := grading.ValidateCriterionScores(in.Scores); err != nil {
		return GradeView{}, err
	}
	var out GradeView
	err := s.mutateInGradingTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		userID, role, rerr := revalidateStaffRole(ctx, q, tc)
		if rerr != nil {
			return rerr
		}
		sub, gerr := q.GetSubmissionByID(ctx, pgUUID(submissionID))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return gradingSubmissionNotFound(submissionID)
			}
			return fmt.Errorf("revise grade: get submission: %w", gerr)
		}
		assignment, aerr := loadAssignmentForGrading(ctx, q, sub)
		if aerr != nil {
			return aerr
		}
		if serr := assertTeacherOfSubmissionClass(ctx, q, role, userID.String(), assignment); serr != nil {
			return serr
		}
		if serr := assertWritingExercise(ctx, q, assignment); serr != nil {
			return serr
		}
		maxVersion, merr := q.MaxGradeVersion(ctx, sub.ID)
		if merr != nil {
			return fmt.Errorf("revise grade: max version: %w", merr)
		}
		if maxVersion == 0 {
			return model.NotFoundError{Resource: "grade", ID: submissionID.String(), Code: "GRADE_NOT_FOUND"}
		}
		comments, verr := grading.NormalizeComments(in.Comments, grading.EssayText(sub.Content))
		if verr != nil {
			return verr
		}
		gradeRow, ierr := s.insertGradeRow(ctx, q, sub, userID, int(maxVersion)+1, in, comments)
		if ierr != nil {
			return translateGradeWriteError(ierr, true) // 23505 → GRADE_REVISE_CONFLICT
		}
		if aerr := s.auditGrade(ctx, tx, tc, sub.ID, gradeRevisedAction, gradeRow, in.Reason); aerr != nil {
			return aerr
		}
		if aerr := s.auditGrade(ctx, tx, tc, sub.ID, gradeReReleasedAction, gradeRow, in.Reason); aerr != nil {
			return aerr
		}
		if oerr := s.enqueueGradeReleaseOutbox(ctx, q, sub, assignment, gradeRow, userID); oerr != nil {
			return oerr
		}
		view, cerr := gradeViewFromGrade(gradeRow)
		if cerr != nil {
			return cerr
		}
		out = view
		return nil
	})
	return out, err
}

// GetSubmissionForGrading is the AC8 teacher grading read (full submission — NOT
// answer-stripped — assignment, student, exercise, latest grade|null).
func (s *GradingService) GetSubmissionForGrading(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID,
) (TeacherGradingView, error) {
	if err := assertGradingRole(tc.Role); err != nil {
		return TeacherGradingView{}, err
	}
	var view TeacherGradingView
	err := s.readInGradingTx(ctx, tc, func(q *generated.Queries) error {
		sub, gerr := q.GetSubmissionByID(ctx, pgUUID(submissionID))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return gradingSubmissionNotFound(submissionID)
			}
			return fmt.Errorf("grading read: get submission: %w", gerr)
		}
		assignment, aerr := loadAssignmentForGrading(ctx, q, sub)
		if aerr != nil {
			return aerr
		}
		if serr := assertTeacherOfSubmissionClass(ctx, q, tc.Role, tc.UserID, assignment); serr != nil {
			return serr
		}
		studentRow, uerr := q.GetUserByID(ctx, sub.StudentID)
		if uerr != nil {
			return fmt.Errorf("grading read: get student: %w", uerr)
		}
		exRow, xerr := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
		if xerr != nil {
			return fmt.Errorf("grading read: get exercise: %w", xerr)
		}
		exContent, derr := store.UnmarshalExerciseContent(exRow.Content, int(exRow.SchemaVersion))
		if derr != nil {
			return fmt.Errorf("grading read: decode exercise %s: %w", uuidStringFromPg(exRow.ID), derr)
		}
		content, cerr := submissionContentJSON(sub)
		if cerr != nil {
			return cerr
		}
		view.Submission = SubmissionResult{Row: sub, Content: content}
		view.Assignment = assignment
		view.Student = GradingStudentRef{ID: uuidStringFromPg(sub.StudentID), FullName: studentRow.FullName}
		view.Exercise = toAttemptExercise(exContent, uuidFromPg(exRow.ID), exRow.Title, exRow.Skill)

		if serr := populateAISuggestion(ctx, q, submissionID, &view); serr != nil {
			return serr
		}

		cg, cgErr := q.GetCurrentGrade(ctx, sub.ID)
		if cgErr != nil {
			if errors.Is(cgErr, pgx.ErrNoRows) {
				return nil // ungraded → grade stays nil
			}
			return fmt.Errorf("grading read: current grade: %w", cgErr)
		}
		gv, gvErr := gradeViewFromCurrent(cg)
		if gvErr != nil {
			return gvErr
		}
		view.Grade = &gv
		return nil
	})
	return view, err
}

// populateAISuggestion sets view.AiSuggestion to the latest COMPLETE ai_grade_writing
// job's result for this submission, or leaves it nil when none exists (Story 6.2a
// D2). The query is RLS-scoped and class-shared (not creator-scoped), so a co-teacher
// /admin sees the suggestion; the deterministic ORDER BY completed_at DESC, id DESC
// picks the newest on same-instant completions (D11).
func populateAISuggestion(
	ctx context.Context, q *generated.Queries, submissionID uuid.UUID, view *TeacherGradingView,
) error {
	job, err := q.GetLatestCompleteAIGradeJobForSubmission(ctx, []byte(submissionID.String()))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // no completed AI grade → aiSuggestion stays nil
		}
		return fmt.Errorf("grading read: latest ai suggestion: %w", err)
	}
	var suggestion model.AIWritingGradeResult
	if uerr := json.Unmarshal(job.Result, &suggestion); uerr != nil {
		// Degrade, don't fail: a single undecodable suggestion (schema skew across a
		// rolling deploy, or a legacy/hand-inserted row) must not 500 the core teacher
		// grading view — leave the AI panel empty and log for correlation.
		slog.ErrorContext(ctx, "grading read: decode ai suggestion failed; suppressing",
			"job_id", uuidStringFromPg(job.ID), "error", uerr)
		return nil
	}
	view.AiSuggestion = &suggestion
	return nil
}

// ListGradingQueue is the AC17 teacher grading queue for one assignment.
func (s *GradingService) ListGradingQueue(
	ctx context.Context, tc model.TenantContext, classID, assignmentID uuid.UUID,
) ([]GradingQueueRow, error) {
	if err := assertGradingRole(tc.Role); err != nil {
		return nil, err
	}
	var rows []GradingQueueRow
	err := s.readInGradingTx(ctx, tc, func(q *generated.Queries) error {
		class, cerr := q.GetClassByID(ctx, pgUUID(classID))
		if cerr != nil {
			if errors.Is(cerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "class", ID: classID.String(), Code: "CLASS_NOT_FOUND"}
			}
			return fmt.Errorf("grading queue: get class: %w", cerr)
		}
		if serr := assertTeacherOfClass(tc.Role, class, tc.UserID); serr != nil {
			return serr
		}
		assignment, aerr := q.GetAssignmentByID(ctx, pgUUID(assignmentID))
		if aerr != nil {
			if errors.Is(aerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "assignment", ID: assignmentID.String(), Code: "ASSIGNMENT_NOT_FOUND"}
			}
			return fmt.Errorf("grading queue: get assignment: %w", aerr)
		}
		if uuidStringFromPg(assignment.ClassID) != classID.String() {
			return model.NotFoundError{Resource: "assignment", ID: assignmentID.String(), Code: "ASSIGNMENT_NOT_FOUND"}
		}
		exRow, xerr := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
		if xerr != nil {
			return fmt.Errorf("grading queue: get exercise: %w", xerr)
		}
		queue, qerr := q.ListGradingQueue(ctx, pgUUID(assignmentID))
		if qerr != nil {
			return fmt.Errorf("grading queue: list: %w", qerr)
		}
		rows = make([]GradingQueueRow, 0, len(queue))
		for _, r := range queue {
			row := GradingQueueRow{
				SubmissionID:    uuidStringFromPg(r.SubmissionID),
				StudentName:     r.StudentName,
				AssignmentTitle: exRow.Title,
				ClassName:       class.Name,
				Status:          r.Status,
				IsOverdue:       r.IsLate,
				Released:        r.Released,
			}
			if r.OverallBand.Valid {
				f, ferr := float64FromNumeric(r.OverallBand)
				if ferr != nil {
					return ferr
				}
				row.OverallBand = &f
			}
			rows = append(rows, row)
		}
		return nil
	})
	return rows, err
}

// --- shared write helpers ---

func (s *GradingService) insertGradeRow(
	ctx context.Context, q *generated.Queries, sub generated.Submission, gradedBy uuid.UUID,
	version int, in GradeWriteInput, comments []grading.Comment,
) (generated.Grade, error) {
	scoresJSON, err := json.Marshal(criterionScoresWire{
		TaskResponse:      in.Scores.TaskResponse,
		CoherenceCohesion: in.Scores.CoherenceCohesion,
		LexicalResource:   in.Scores.LexicalResource,
		GrammaticalRange:  in.Scores.GrammaticalRange,
	})
	if err != nil {
		return generated.Grade{}, fmt.Errorf("marshal criterion scores: %w", err)
	}
	if comments == nil {
		comments = []grading.Comment{}
	}
	commentsJSON, err := json.Marshal(comments)
	if err != nil {
		return generated.Grade{}, fmt.Errorf("marshal comments: %w", err)
	}
	band := grading.OverallBand(in.Scores)
	overall, err := numericFromDecimal(band.Decimal())
	if err != nil {
		return generated.Grade{}, err
	}
	now := s.clk.Now()
	return q.InsertGrade(ctx, generated.InsertGradeParams{
		SubmissionID:    sub.ID,
		CenterID:        sub.CenterID,
		GradedBy:        pgUUID(gradedBy),
		Version:         int32(version),
		CriterionScores: scoresJSON,
		OverallBand:     overall,
		Comments:        commentsJSON,
		Feedback:        pgTextFromPtr(in.Feedback),
		ReleasedAt:      pgTimestamptz(now),
		CreatedAt:       pgTimestamptz(now),
	})
}

// enqueueGradeReleaseOutbox writes the durable grade-release job row inside the grade
// tx (D2). The dispatcher publishes the event + sends the email post-commit. The
// payload carries IDS ONLY — the recipient + title are re-resolved at send time via
// ResolveGradeReleaseRecipient (Decision B: no stale address, no PII at rest).
func (s *GradingService) enqueueGradeReleaseOutbox(
	ctx context.Context, q *generated.Queries, sub generated.Submission,
	assignment generated.Assignment, grade generated.Grade, gradedBy uuid.UUID,
) error {
	params, err := json.Marshal(model.GradeReleaseEmailParams{
		GradeID:      uuidStringFromPg(grade.ID),
		SubmissionID: uuidStringFromPg(sub.ID),
		AssignmentID: uuidStringFromPg(assignment.ID),
	})
	if err != nil {
		return fmt.Errorf("outbox: marshal params: %w", err)
	}
	if _, err := q.InsertJob(ctx, generated.InsertJobParams{
		CenterID:            sub.CenterID,
		CreatedBy:           pgUUID(gradedBy),
		Type:                string(model.JobTypeGradeReleaseEmail),
		Params:              params,
		ParamsSchemaVersion: model.GradeReleaseEmailParamsSchemaVersion,
	}); err != nil {
		return fmt.Errorf("outbox: insert job: %w", err)
	}
	return nil
}

// ResolveGradeReleaseRecipient re-reads the release email's recipient + title from a
// tenant-scoped db at SEND time (Decision B). It matches worker.RecipientResolver so
// main.go can inject it into the grade-release handler without package worker
// importing package service. An absent submission/student yields empty strings (the
// worker logs "no recipient" and completes — the grade is already released); a real
// DB error is returned so the dispatcher retries. db MUST already have the tenant
// context set (the dispatcher sets it from the job row before calling the handler).
func ResolveGradeReleaseRecipient(
	ctx context.Context, db generated.DBTX, submissionID string,
) (email, name, assignmentTitle string, err error) {
	subUUID, perr := uuid.Parse(submissionID)
	if perr != nil {
		return "", "", "", fmt.Errorf("resolve grade recipient: parse submission id: %w", perr)
	}
	q := generated.New(db)
	sub, serr := q.GetSubmissionByID(ctx, pgUUID(subUUID))
	if serr != nil {
		if errors.Is(serr, pgx.ErrNoRows) {
			return "", "", "", nil // submission gone → no recipient, do not retry
		}
		return "", "", "", fmt.Errorf("resolve grade recipient: get submission: %w", serr)
	}
	student, uerr := q.GetUserByID(ctx, sub.StudentID)
	if uerr != nil {
		if errors.Is(uerr, pgx.ErrNoRows) {
			return "", "", "", nil
		}
		return "", "", "", fmt.Errorf("resolve grade recipient: get student: %w", uerr)
	}
	assignment, aerr := q.GetAssignmentByID(ctx, sub.AssignmentID)
	if aerr != nil {
		if errors.Is(aerr, pgx.ErrNoRows) {
			return student.Email, student.FullName, "", nil
		}
		return "", "", "", fmt.Errorf("resolve grade recipient: get assignment: %w", aerr)
	}
	exRow, xerr := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
	if xerr != nil {
		if errors.Is(xerr, pgx.ErrNoRows) {
			return student.Email, student.FullName, "", nil
		}
		return "", "", "", fmt.Errorf("resolve grade recipient: get exercise: %w", xerr)
	}
	return student.Email, student.FullName, exRow.Title, nil
}

func (s *GradingService) auditGrade(
	ctx context.Context, tx pgx.Tx, tc model.TenantContext, submissionID pgtype.UUID,
	action string, grade generated.Grade, reason string,
) error {
	changes := map[string]any{
		"gradeId":     uuidStringFromPg(grade.ID),
		"version":     grade.Version,
		"overallBand": overallBandString(grade.OverallBand),
	}
	if reason != "" {
		changes["reason"] = reason
	}
	return s.audit.LogWithinTx(ctx, tx, tc, action, gradeAuditEntity, uuidFromPg(submissionID), changes)
}

// --- authz helpers ---

// assertGradingRole is the coarse {owner,admin,teacher} gate. Non-staff → 403.
func assertGradingRole(role string) error {
	switch role {
	case model.RoleOwner, model.RoleAdmin, model.RoleTeacher:
		return nil
	default:
		return &ForbiddenError{Reason: "insufficient role"}
	}
}

// assertTeacherOfClass narrows a teacher to the class they teach (AC11). Owner/admin
// bypass. A same-tenant teacher on another class → 403 FORBIDDEN (cross-tenant is
// already 404 via RLS).
func assertTeacherOfClass(role string, class generated.Class, userID string) error {
	if role != model.RoleTeacher {
		return nil
	}
	if !class.TeacherID.Valid || uuidStringFromPg(class.TeacherID) != userID {
		return &ForbiddenError{Reason: "not the teacher of this class"}
	}
	return nil
}

// assertTeacherOfSubmissionClass loads the submission's assignment class and applies
// assertTeacherOfClass.
func assertTeacherOfSubmissionClass(
	ctx context.Context, q *generated.Queries, role, userID string, assignment generated.Assignment,
) error {
	if role != model.RoleTeacher {
		return nil
	}
	class, err := q.GetClassByID(ctx, assignment.ClassID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &ForbiddenError{Reason: "not the teacher of this class"}
		}
		return fmt.Errorf("grading authz: get class: %w", err)
	}
	return assertTeacherOfClass(role, class, userID)
}

// revalidateStaffRole re-reads the caller's center-member role (SEC-1) for write
// paths and confirms it is owner/admin/teacher, returning the user id + fresh role.
func revalidateStaffRole(
	ctx context.Context, q *generated.Queries, tc model.TenantContext,
) (uuid.UUID, string, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.UUID{}, "", &ForbiddenError{Reason: "invalid tenant context"}
	}
	userUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.UUID{}, "", &ForbiddenError{Reason: "invalid tenant context"}
	}
	member, err := q.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(userUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.UUID{}, "", &ForbiddenError{Reason: "insufficient role"}
		}
		return uuid.UUID{}, "", fmt.Errorf("grading role revalidation: %w", err)
	}
	if err := assertGradingRole(member.Role); err != nil {
		return uuid.UUID{}, "", err
	}
	return userUUID, member.Role, nil
}

// assertWritingExercise rejects a grade/revise against a non-Writing submission
// (P1) — this endpoint (s23) grades only Writing. Without it a speaking/quiz
// submission would be stamped with four IELTS Writing bands, flipped to graded, and
// frozen, with every anchored comment silently demoted (no content.text). →
// 409 SUBMISSION_NOT_WRITING (checked inside the tx, so it commits zero side effects).
func assertWritingExercise(
	ctx context.Context, q *generated.Queries, assignment generated.Assignment,
) error {
	exRow, err := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("grading: exercise %s missing for assignment %s",
				uuidStringFromPg(assignment.ExerciseID), uuidStringFromPg(assignment.ID))
		}
		return fmt.Errorf("grading: get exercise skill: %w", err)
	}
	if exRow.Skill != skillWriting {
		return model.ConflictError{
			Resource: "submission",
			Code:     "SUBMISSION_NOT_WRITING",
			Message:  "only Writing submissions can be graded here",
		}
	}
	return nil
}

func loadAssignmentForGrading(
	ctx context.Context, q *generated.Queries, sub generated.Submission,
) (generated.Assignment, error) {
	assignment, err := q.GetAssignmentByID(ctx, sub.AssignmentID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.Assignment{}, fmt.Errorf("grading: assignment %s missing for submission %s",
				uuidStringFromPg(sub.AssignmentID), uuidStringFromPg(sub.ID))
		}
		return generated.Assignment{}, fmt.Errorf("grading: get assignment: %w", err)
	}
	return assignment, nil
}

// --- error mapping ---

func gradingSubmissionNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "submission", ID: id.String(), Code: submissionNotFoundCode}
}

func alreadyGradedConflict(id uuid.UUID) error {
	return model.ConflictError{
		Resource: "submission", ID: id.String(),
		Code: "SUBMISSION_ALREADY_GRADED", Message: "submission is already graded",
	}
}

// translateGradeWriteError maps the append-only ledger's storage errors to typed
// conflicts (AC3c / B3). 23505 on the grade path means the initial version already
// exists (already graded); on the revise path it means a concurrent revise won the
// version race (retry). P0001 is the immutability trigger.
func translateGradeWriteError(err error, isRevise bool) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case pgErr.Code == "23505" && isRevise:
			return model.ConflictError{
				Resource: "grade", Code: "GRADE_REVISE_CONFLICT",
				Message: "grade version changed concurrently; reload and retry",
			}
		case pgErr.Code == "23505":
			return model.ConflictError{
				Resource: "submission", Code: "SUBMISSION_ALREADY_GRADED",
				Message: "submission is already graded",
			}
		case pgErr.Code == "P0001" && strings.Contains(pgErr.Message, "submission_immutable_after_release"):
			return model.ConflictError{
				Resource: "submission", Code: "SUBMISSION_ALREADY_GRADED",
				Message: "submission is immutable after release",
			}
		}
	}
	return err
}

// --- content + row parsing ---

// criterionScoresWire is the criterion_scores JSONB shape (camelCase — mirrors
// api.yaml CriterionScores).
type criterionScoresWire struct {
	TaskResponse      float64 `json:"taskResponse"`
	CoherenceCohesion float64 `json:"coherenceCohesion"`
	LexicalResource   float64 `json:"lexicalResource"`
	GrammaticalRange  float64 `json:"grammaticalRange"`
}

func gradeViewFromGrade(g generated.Grade) (GradeView, error) {
	return gradeViewFrom(g.ID, g.SubmissionID, g.GradedBy, g.Version, g.CriterionScores,
		g.OverallBand, g.Comments, g.Feedback, g.ReleasedAt, g.CreatedAt)
}

func gradeViewFromCurrent(g generated.CurrentGrade) (GradeView, error) {
	return gradeViewFrom(g.ID, g.SubmissionID, g.GradedBy, g.Version, g.CriterionScores,
		g.OverallBand, g.Comments, g.Feedback, g.ReleasedAt, g.CreatedAt)
}

func gradeViewFrom(
	id, submissionID, gradedBy pgtype.UUID, version int32, scoresRaw []byte,
	overall pgtype.Numeric, commentsRaw []byte, feedback pgtype.Text,
	releasedAt, createdAt pgtype.Timestamptz,
) (GradeView, error) {
	var scores criterionScoresWire
	if err := json.Unmarshal(scoresRaw, &scores); err != nil {
		return GradeView{}, fmt.Errorf("parse criterion scores: %w", err)
	}
	comments := []grading.Comment{}
	if len(commentsRaw) > 0 {
		if err := json.Unmarshal(commentsRaw, &comments); err != nil {
			return GradeView{}, fmt.Errorf("parse comments: %w", err)
		}
	}
	if comments == nil {
		comments = []grading.Comment{}
	}
	band, err := float64FromNumeric(overall)
	if err != nil {
		return GradeView{}, err
	}
	view := GradeView{
		ID:           uuidStringFromPg(id),
		SubmissionID: uuidStringFromPg(submissionID),
		Version:      int(version),
		Scores: grading.CriterionScores{
			TaskResponse:      scores.TaskResponse,
			CoherenceCohesion: scores.CoherenceCohesion,
			LexicalResource:   scores.LexicalResource,
			GrammaticalRange:  scores.GrammaticalRange,
		},
		OverallBand: band,
		Comments:    comments,
		Feedback:    textPtrFromPg(feedback),
		GradedBy:    uuidStringFromPg(gradedBy),
		CreatedAt:   createdAt.Time,
	}
	if releasedAt.Valid {
		t := releasedAt.Time
		view.ReleasedAt = &t
	}
	return view, nil
}

func overallBandString(n pgtype.Numeric) string {
	f, err := float64FromNumeric(n)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%.1f", f)
}

// --- numeric + text helpers (grading-local) ---

func numericFromDecimal(decimal string) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	if err := n.Scan(decimal); err != nil {
		return pgtype.Numeric{}, fmt.Errorf("overall band numeric: %w", err)
	}
	return n, nil
}

func float64FromNumeric(n pgtype.Numeric) (float64, error) {
	if !n.Valid {
		return 0, fmt.Errorf("overall band numeric is null")
	}
	f, err := n.Float64Value()
	if err != nil {
		return 0, fmt.Errorf("overall band float: %w", err)
	}
	return f.Float64, nil
}

func textPtrFromPg(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	v := t.String
	return &v
}

// --- tenant tx wrappers (mirror submission_service) ---

func (s *GradingService) readInGradingTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("grading read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("grading read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *GradingService) mutateInGradingTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, txQ *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("grading mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("grading mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
