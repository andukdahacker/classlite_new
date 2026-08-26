package service

// Story 6.4a — objective auto-grading service surface (D2/D8/D9/D10/D11/D13/D15).
//
// Three responsibilities live here:
//   1. AutoGrader — the interface the submit hook calls inside its SAVEPOINT (D13). The
//      production implementation (submitAutoGrader) reads the live exercise (D14), runs
//      the pure grading.Grade engine (D15), and writes ONE auto_grade_results row.
//   2. AutoGradeService.Override — a teacher recomputes one answer's mark in place (D11).
//   3. AutoGradeService.Release — the definitive grade is APPENDED to the immutable
//      grades ledger, the submission flips submitted → graded, and the release
//      notification is enqueued, reusing the 6.1 atomic path (D2/D8/D10).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"

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
	objectiveCriterionKind      = "objective"
	autoGradeOverrideAction     = "autograde.override"
	autoGradeImmutableInvariant = "auto_grade_results_immutable_after_release"
)

// AutoGrader is the seam the submit hook invokes inside a post-flip SAVEPOINT (D13). It
// runs in the SAME tx as the submit (already tenant-scoped). ANY failure — returned error
// or panic (recovered by the caller) — rolls back to the savepoint while the outer submit
// still commits 'submitted': a grading defect must never block a student's submission.
type AutoGrader interface {
	GradeOnSubmit(ctx context.Context, tx pgx.Tx, tc model.TenantContext, submissionID uuid.UUID) error
}

// submitAutoGrader is the production AutoGrader. Storeless dependencies — it operates on
// the querier bound to the caller's tx.
type submitAutoGrader struct{}

// NewSubmitAutoGrader returns the production submit-hook auto-grader.
func NewSubmitAutoGrader() AutoGrader { return submitAutoGrader{} }

// GradeOnSubmit auto-marks an objective submission and writes one working row. Non-
// objective / malformed / zero-question content is skipped cleanly (returns nil, no row)
// so submit commits ungraded (D13). It NEVER interprets bad data as a hard error beyond
// the DB write itself.
func (submitAutoGrader) GradeOnSubmit(ctx context.Context, tx pgx.Tx, tc model.TenantContext, submissionID uuid.UUID) error {
	q := generated.New(tx)

	sub, err := q.GetSubmissionByID(ctx, pgUUID(submissionID))
	if err != nil {
		return fmt.Errorf("auto-grade: get submission: %w", err)
	}
	assignment, err := q.GetAssignmentByID(ctx, sub.AssignmentID)
	if err != nil {
		return fmt.Errorf("auto-grade: get assignment: %w", err)
	}
	exercise, err := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
	if err != nil {
		return fmt.Errorf("auto-grade: get exercise: %w", err)
	}
	content, err := store.UnmarshalExerciseContent(exercise.Content, int(exercise.SchemaVersion))
	if err != nil {
		// Malformed exercise content is not a submit-blocking error (D13): skip grading.
		slog.WarnContext(ctx, "auto-grade skipped: exercise content unreadable", "submission_id", submissionID.String())
		return nil
	}
	if !grading.HasGradableGroups(content) {
		return nil // writing/speaking or no question groups → never auto-graded (D3)
	}

	var attempt grading.AttemptContent
	if err := json.Unmarshal(sub.Content, &attempt); err != nil {
		slog.WarnContext(ctx, "auto-grade skipped: attempt content unreadable", "submission_id", submissionID.String())
		return nil
	}

	result := grading.Grade(content, attempt, content.Settings)
	if result == nil {
		return nil // zero-question / nothing gradable (D13)
	}

	answers := make([]store.AutoGradeAnswer, 0, len(result.Answers))
	for _, a := range result.Answers {
		answers = append(answers, store.AutoGradeAnswer{
			QuestionRef:    a.QuestionRef,
			StudentAnswer:  a.StudentAnswer,
			StudentFlagged: a.StudentFlagged,
			AutoMark:       string(a.AutoMark),
			OverrideMark:   nil,
		})
	}
	answersJSON, err := json.Marshal(answers)
	if err != nil {
		return fmt.Errorf("auto-grade: marshal answers: %w", err)
	}
	percentage, err := numericFromFloat(result.Percentage)
	if err != nil {
		return err
	}
	band, err := numericFromDecimal(fmt.Sprintf("%.1f", result.ProvisionalBand))
	if err != nil {
		return err
	}
	if _, err := q.InsertAutoGradeResult(ctx, generated.InsertAutoGradeResultParams{
		SubmissionID:    sub.ID,
		CenterID:        sub.CenterID,
		RawScore:        int32(result.RawScore),
		MaxScore:        int32(result.MaxScore),
		Percentage:      percentage,
		ProvisionalBand: band,
		Answers:         answersJSON,
	}); err != nil {
		return fmt.Errorf("auto-grade: insert working row: %w", err)
	}
	return nil
}

// --- AutoGradeService: teacher override + release ---

// AutoGradeService owns the pre-release override + the release-to-grade transition for
// objective submissions. It reuses the grades ledger + release outbox spine (6.1); it
// never touches Gemini or the credit ledger.
type AutoGradeService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewAutoGradeService constructs an AutoGradeService.
func NewAutoGradeService(db AuthDB, audit AuditLogger, clk clock.Clock) *AutoGradeService {
	return &AutoGradeService{db: db, audit: audit, clk: clk}
}

// AutoGradeOverrideInput is the teacher's single-answer override (D11, PROVISIONAL wire — D16).
type AutoGradeOverrideInput struct {
	QuestionRef string
	Mark        string // "correct" | "wrong"
}

// AutoGradeAnswerView is one answer's teacher-facing breakdown (AC11). correctAnswer /
// acceptedVariants are teacher-only — the handler strips them for any non-staff path.
type AutoGradeAnswerView struct {
	QuestionRef      string
	QuestionText     string
	StudentAnswer    string
	StudentFlagged   bool
	CorrectAnswer    string
	AcceptedVariants []string
	AutoMark         string
	OverrideMark     *string
	EffectiveMark    string
}

// AutoGradeView is the objective breakdown a teacher reviews before release (AC11).
type AutoGradeView struct {
	RawScore        int
	MaxScore        int
	Percentage      float64
	ProvisionalBand float64
	Released        bool
	Answers         []AutoGradeAnswerView
}

func (s *AutoGradeService) mutateTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, q *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("auto-grade mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("auto-grade mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// objectiveContext bundles what override + release both need after the guards pass.
type objectiveContext struct {
	submission generated.Submission
	assignment generated.Assignment
	content    store.ExerciseContent
	working    generated.AutoGradeResult
	answers    []store.AutoGradeAnswer
}

// loadObjectiveContext takes the D9 FOR UPDATE lock on the submission, then runs the
// objective-only / working-row / already-released guards in order.
func loadObjectiveContext(
	ctx context.Context, q *generated.Queries, submissionID uuid.UUID,
) (objectiveContext, error) {
	sub, err := q.LockSubmissionForGrading(ctx, pgUUID(submissionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return objectiveContext{}, submissionNotFound(submissionID)
		}
		return objectiveContext{}, fmt.Errorf("auto-grade: lock submission: %w", err)
	}
	assignment, err := q.GetAssignmentByID(ctx, sub.AssignmentID)
	if err != nil {
		return objectiveContext{}, fmt.Errorf("auto-grade: get assignment: %w", err)
	}
	exercise, err := q.GetExerciseForAttempt(ctx, assignment.ExerciseID)
	if err != nil {
		return objectiveContext{}, fmt.Errorf("auto-grade: get exercise: %w", err)
	}
	content, err := store.UnmarshalExerciseContent(exercise.Content, int(exercise.SchemaVersion))
	if err != nil {
		return objectiveContext{}, fmt.Errorf("auto-grade: unmarshal exercise: %w", err)
	}
	if !grading.HasGradableGroups(content) {
		return objectiveContext{}, notObjectiveConflict(submissionID)
	}
	working, err := q.GetAutoGradeResultBySubmission(ctx, sub.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return objectiveContext{}, autoGradeNotFoundConflict(submissionID)
		}
		return objectiveContext{}, fmt.Errorf("auto-grade: get working row: %w", err)
	}
	var answers []store.AutoGradeAnswer
	if err := json.Unmarshal(working.Answers, &answers); err != nil {
		return objectiveContext{}, fmt.Errorf("auto-grade: unmarshal working answers: %w", err)
	}
	return objectiveContext{submission: sub, assignment: assignment, content: content, working: working, answers: answers}, nil
}

// assertUnreleased is the service-layer release guard (the D9 trigger is the DB backstop).
func assertUnreleased(ctx context.Context, q *generated.Queries, submissionID uuid.UUID) error {
	cg, err := q.GetCurrentGrade(ctx, pgUUID(submissionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil // ungraded → not released
		}
		return fmt.Errorf("auto-grade: current grade: %w", err)
	}
	if cg.ReleasedAt.Valid {
		return alreadyReleasedConflict(submissionID)
	}
	return nil
}

// Override sets one answer's mark, recomputes the provisional score in place, audits the
// change, and returns the updated breakdown. Objective + unreleased submissions only (D11).
func (s *AutoGradeService) Override(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID, in AutoGradeOverrideInput,
) (*AutoGradeView, error) {
	if in.Mark != string(grading.MarkCorrect) && in.Mark != string(grading.MarkWrong) {
		return nil, model.ValidationError{Fields: []model.FieldError{{
			Field: "mark", Code: "INVALID_MARK", Message: "mark must be 'correct' or 'wrong'",
		}}}
	}

	var view *AutoGradeView
	err := s.mutateTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		teacherID, role, rerr := revalidateStaffRole(ctx, q, tc)
		if rerr != nil {
			return rerr
		}
		objCtx, gerr := loadObjectiveContext(ctx, q, submissionID)
		if gerr != nil {
			return gerr
		}
		// A teacher may only override their own class's submissions (owner/admin bypass) —
		// mirrors every 6.1/6.3 staff path; RLS only scopes to the center, not the class.
		if aerr := assertTeacherOfSubmissionClass(ctx, q, role, teacherID.String(), objCtx.assignment); aerr != nil {
			return aerr
		}
		if rerr := assertUnreleased(ctx, q, submissionID); rerr != nil {
			return rerr
		}

		idx := -1
		for i, a := range objCtx.answers {
			if a.QuestionRef == in.QuestionRef {
				idx = i
				break
			}
		}
		if idx == -1 {
			return model.ValidationError{Fields: []model.FieldError{{
				Field: "questionRef", Code: "INVALID_QUESTION_REF", Message: "unknown question reference",
			}}}
		}
		from := effectiveMark(objCtx.answers[idx])
		mark := in.Mark
		objCtx.answers[idx].OverrideMark = &mark

		raw, _, pct, band := provisionalScore(objCtx.answers)
		answersJSON, merr := json.Marshal(objCtx.answers)
		if merr != nil {
			return fmt.Errorf("auto-grade: marshal answers: %w", merr)
		}
		percentage, perr := numericFromFloat(pct)
		if perr != nil {
			return perr
		}
		bandNum, berr := numericFromDecimal(fmt.Sprintf("%.1f", band))
		if berr != nil {
			return berr
		}
		if _, uerr := q.UpdateAutoGradeResult(ctx, generated.UpdateAutoGradeResultParams{
			SubmissionID:    objCtx.submission.ID,
			RawScore:        int32(raw),
			Percentage:      percentage,
			ProvisionalBand: bandNum,
			Answers:         answersJSON,
		}); uerr != nil {
			return translateAutoGradeWriteError(uerr, submissionID)
		}

		changes := map[string]any{"questionRef": in.QuestionRef, "from": from, "to": mark}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, autoGradeOverrideAction, submissionAuditEntity, submissionID, changes); aerr != nil {
			return fmt.Errorf("auto-grade: audit override: %w", aerr)
		}

		built := buildAutoGradeView(objCtx.content, objCtx.answers, false)
		view = &built
		return nil
	})
	if err != nil {
		return nil, err
	}
	return view, nil
}

// Release appends the definitive objective grade to the grades ledger (kind=objective
// discriminator, D8), flips the submission submitted → graded, audits grade.created +
// grade.released, and enqueues the release outbox — all in one tx (D2/D10). Unresolved
// needs_review counts as WRONG in the definitive grade (D10). Objective + unreleased only.
func (s *AutoGradeService) Release(
	ctx context.Context, tc model.TenantContext, submissionID uuid.UUID,
) (*GradeView, error) {
	var gradeView *GradeView
	err := s.mutateTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		teacherID, role, rerr := revalidateStaffRole(ctx, q, tc)
		if rerr != nil {
			return rerr
		}
		objCtx, gerr := loadObjectiveContext(ctx, q, submissionID)
		if gerr != nil {
			return gerr
		}
		// A teacher may only release their own class's submissions (owner/admin bypass) —
		// mirrors every 6.1/6.3 staff path; RLS only scopes to the center, not the class.
		if aerr := assertTeacherOfSubmissionClass(ctx, q, role, teacherID.String(), objCtx.assignment); aerr != nil {
			return aerr
		}
		if rerr := assertUnreleased(ctx, q, submissionID); rerr != nil {
			return rerr
		}

		// Definitive score: unresolved needs_review counts as wrong (D10).
		raw, max, pct, band := definitiveScore(objCtx.answers)
		criterionJSON, merr := json.Marshal(objectiveCriterionScores{
			Kind:          objectiveCriterionKind,
			SchemaVersion: 1,
			RawScore:      raw,
			MaxScore:      max,
			Percentage:    pct,
		})
		if merr != nil {
			return fmt.Errorf("release: marshal criterion: %w", merr)
		}
		bandNum, berr := numericFromDecimal(fmt.Sprintf("%.1f", band))
		if berr != nil {
			return berr
		}
		nextVersion, verr := q.MaxGradeVersion(ctx, objCtx.submission.ID)
		if verr != nil {
			return fmt.Errorf("release: max grade version: %w", verr)
		}
		now := s.clk.Now()
		gradeRow, ierr := q.InsertGrade(ctx, generated.InsertGradeParams{
			SubmissionID:    objCtx.submission.ID,
			CenterID:        objCtx.submission.CenterID,
			GradedBy:        pgUUID(teacherID),
			Version:         nextVersion + 1,
			CriterionScores: criterionJSON,
			OverallBand:     bandNum,
			Comments:        []byte("[]"),
			Feedback:        pgTextFromPtr(nil),
			ReleasedAt:      pgTimestamptz(now),
			CreatedAt:       pgTimestamptz(now),
		})
		if ierr != nil {
			return translateGradeWriteError(ierr, false)
		}

		// Guarded submitted → graded flip (0 rows → a concurrent release won; belt-and-
		// braces with the assertUnreleased guard above under the FOR UPDATE lock).
		if _, ferr := q.GradeSubmission(ctx, generated.GradeSubmissionParams{
			ID: objCtx.submission.ID, UpdatedAt: pgTimestamptz(now),
		}); ferr != nil {
			if errors.Is(ferr, pgx.ErrNoRows) {
				return alreadyReleasedConflict(submissionID)
			}
			return translateGradeWriteError(ferr, false)
		}

		if aerr := s.auditGrade(ctx, tx, tc, submissionID, gradeCreatedAction, gradeRow); aerr != nil {
			return aerr
		}
		if aerr := s.auditGrade(ctx, tx, tc, submissionID, gradeReleasedAction, gradeRow); aerr != nil {
			return aerr
		}
		if oerr := s.enqueueGradeReleaseOutbox(ctx, q, objCtx.submission, objCtx.assignment, gradeRow, teacherID); oerr != nil {
			return oerr
		}

		gv, verr2 := gradeViewFromGrade(gradeRow)
		if verr2 != nil {
			return verr2
		}
		gradeView = &gv
		return nil
	})
	if err != nil {
		return nil, err
	}
	return gradeView, nil
}

// auditGrade writes one grade-lifecycle audit row (mirrors GradingService.auditGrade).
func (s *AutoGradeService) auditGrade(
	ctx context.Context, tx pgx.Tx, tc model.TenantContext, submissionID uuid.UUID,
	action string, grade generated.Grade,
) error {
	changes := map[string]any{
		"gradeId":     uuidStringFromPg(grade.ID),
		"version":     grade.Version,
		"overallBand": overallBandString(grade.OverallBand),
	}
	return s.audit.LogWithinTx(ctx, tx, tc, action, gradeAuditEntity, submissionID, changes)
}

// enqueueGradeReleaseOutbox enqueues the release-email outbox job (mirrors GradingService).
func (s *AutoGradeService) enqueueGradeReleaseOutbox(
	ctx context.Context, q *generated.Queries, sub generated.Submission,
	assignment generated.Assignment, grade generated.Grade, gradedBy uuid.UUID,
) error {
	params, err := json.Marshal(model.GradeReleaseEmailParams{
		GradeID:      uuidStringFromPg(grade.ID),
		SubmissionID: uuidStringFromPg(sub.ID),
		AssignmentID: uuidStringFromPg(assignment.ID),
	})
	if err != nil {
		return fmt.Errorf("release outbox: marshal params: %w", err)
	}
	if _, err := q.InsertJob(ctx, generated.InsertJobParams{
		CenterID:            sub.CenterID,
		CreatedBy:           pgUUID(gradedBy),
		Type:                string(model.JobTypeGradeReleaseEmail),
		Params:              params,
		ParamsSchemaVersion: model.GradeReleaseEmailParamsSchemaVersion,
	}); err != nil {
		return fmt.Errorf("release outbox: insert job: %w", err)
	}
	return nil
}

// --- scoring + view helpers ---

type objectiveCriterionScores struct {
	Kind          string  `json:"kind"`
	SchemaVersion int     `json:"schemaVersion"`
	RawScore      int     `json:"rawScore"`
	MaxScore      int     `json:"maxScore"`
	Percentage    float64 `json:"percentage"`
}

func effectiveMark(a store.AutoGradeAnswer) string {
	if a.OverrideMark != nil {
		return *a.OverrideMark
	}
	return a.AutoMark
}

// provisionalScore excludes unresolved needs_review from the denominator (D6/D7) — the
// pre-release teacher-facing view.
func provisionalScore(answers []store.AutoGradeAnswer) (raw, max int, pct, band float64) {
	max = len(answers)
	unresolved := 0
	for _, a := range answers {
		switch effectiveMark(a) {
		case string(grading.MarkCorrect):
			raw++
		case string(grading.MarkNeedsReview):
			unresolved++
		}
	}
	denom := max - unresolved
	if denom <= 0 {
		pct = 0
	} else {
		pct = float64(raw) / float64(denom) * 100
	}
	band = grading.PercentageToBand(pct)
	return raw, max, pct, band
}

// definitiveScore counts unresolved needs_review as wrong over the full denominator (D10)
// — the released grade.
func definitiveScore(answers []store.AutoGradeAnswer) (raw, max int, pct, band float64) {
	max = len(answers)
	for _, a := range answers {
		if effectiveMark(a) == string(grading.MarkCorrect) {
			raw++
		}
	}
	if max <= 0 {
		pct = 0
	} else {
		pct = float64(raw) / float64(max) * 100
	}
	band = grading.PercentageToBand(pct)
	return raw, max, pct, band
}

// buildAutoGradeView joins the stored per-answer state with the live answer key (D14) into
// the teacher-facing breakdown. released is passed by the caller (false pre-release). Once
// released the block is scored DEFINITIVELY (unresolved needs_review → wrong, D10) so the
// numbers agree with the grades row; pre-release it stays provisional (needs_review excluded).
func buildAutoGradeView(content store.ExerciseContent, answers []store.AutoGradeAnswer, released bool) AutoGradeView {
	score := provisionalScore
	if released {
		score = definitiveScore
	}
	raw, max, pct, band := score(answers)
	views := make([]AutoGradeAnswerView, 0, len(answers))
	for _, a := range answers {
		question, ok := lookupQuestion(content, a.QuestionRef)
		text, correct := "", ""
		var variants []string
		if ok {
			text = question.Text
			correct = question.CorrectAnswer
			variants = question.AcceptedVariants
		}
		if variants == nil {
			variants = []string{}
		}
		views = append(views, AutoGradeAnswerView{
			QuestionRef:      a.QuestionRef,
			QuestionText:     text,
			StudentAnswer:    a.StudentAnswer,
			StudentFlagged:   a.StudentFlagged,
			CorrectAnswer:    correct,
			AcceptedVariants: variants,
			AutoMark:         a.AutoMark,
			OverrideMark:     a.OverrideMark,
			EffectiveMark:    effectiveMark(a),
		})
	}
	return AutoGradeView{
		RawScore:        raw,
		MaxScore:        max,
		Percentage:      pct,
		ProvisionalBand: band,
		Released:        released,
		Answers:         views,
	}
}

// populateAutoGrade attaches the objective breakdown to a TeacherGradingView (AC11). A
// missing working row (objective but not yet auto-graded — defensive) leaves it nil.
func populateAutoGrade(
	ctx context.Context, q *generated.Queries, submissionID pgtype.UUID,
	content store.ExerciseContent, released bool, view *TeacherGradingView,
) error {
	working, err := q.GetAutoGradeResultBySubmission(ctx, submissionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("grading read: get auto-grade: %w", err)
	}
	var answers []store.AutoGradeAnswer
	if uerr := json.Unmarshal(working.Answers, &answers); uerr != nil {
		return fmt.Errorf("grading read: unmarshal auto-grade answers: %w", uerr)
	}
	agv := buildAutoGradeView(content, answers, released)
	view.AutoGrade = &agv
	return nil
}

// lookupQuestion resolves a colon handle "{sec}:{grp}:{q}" (D5) to its live question.
func lookupQuestion(content store.ExerciseContent, ref string) (store.Question, bool) {
	parts := strings.Split(ref, ":")
	if len(parts) != 3 {
		return store.Question{}, false
	}
	sectionIndex, err1 := strconv.Atoi(parts[0])
	groupIndex, err2 := strconv.Atoi(parts[1])
	questionIndex, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return store.Question{}, false
	}
	if sectionIndex < 0 || sectionIndex >= len(content.Sections) {
		return store.Question{}, false
	}
	section := content.Sections[sectionIndex]
	if groupIndex < 0 || groupIndex >= len(section.QuestionGroups) {
		return store.Question{}, false
	}
	group := section.QuestionGroups[groupIndex]
	if questionIndex < 0 || questionIndex >= len(group.Questions) {
		return store.Question{}, false
	}
	return group.Questions[questionIndex], true
}

// numericFromFloat renders a float64 to a pgtype.Numeric with round-trip precision.
func numericFromFloat(f float64) (pgtype.Numeric, error) {
	return numericFromDecimal(strconv.FormatFloat(f, 'f', -1, 64))
}

// --- typed conflict constructors (GO-2) ---

func notObjectiveConflict(id uuid.UUID) error {
	return model.ConflictError{Resource: "submission", ID: id.String(), Code: "SUBMISSION_NOT_OBJECTIVE", Message: "submission is not objective"}
}

func autoGradeNotFoundConflict(id uuid.UUID) error {
	return model.ConflictError{Resource: "submission", ID: id.String(), Code: "AUTO_GRADE_NOT_FOUND", Message: "no auto-grade working row for submission"}
}

func alreadyReleasedConflict(id uuid.UUID) error {
	return model.ConflictError{Resource: "submission", ID: id.String(), Code: "SUBMISSION_ALREADY_RELEASED", Message: "submission grade already released"}
}

// translateAutoGradeWriteError maps the D9 immutability trigger's P0001 to a typed 409.
func translateAutoGradeWriteError(err error, id uuid.UUID) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "P0001" && strings.Contains(pgErr.Message, autoGradeImmutableInvariant) {
		return alreadyReleasedConflict(id)
	}
	return err
}
