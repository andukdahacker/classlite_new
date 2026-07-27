// Package service — Story 4.1 ExerciseService.
//
// The exercise LIBRARY (s15) — center-scoped, teacher-authored, reusable
// content with a typed JSONB `content` blob (store.ExerciseContent, v1) + a
// companion server-authoritative `schema_version`. Full CRUD (SOFT-delete) +
// Duplicate. NOT the in-session `session_exercises` entity (Story 3.5).
//
// Authz (SEC-1, service-layer — never RLS):
//   - assertClassRole gates owner/admin/teacher on every operation (student →
//     403 INSUFFICIENT_ROLE). Reused from class_lifecycle.go — same allowlist.
//   - List picks ListExercises (owner/admin: all center rows) vs
//     ListExercisesByTeacher (teacher: created_by = self) by the DB-authoritative
//     tc.Role, mirroring ClassService.
//   - Get/Update/SoftDelete/Duplicate run assertExerciseTeacherScope: a teacher
//     touching another teacher's row gets 404 EXERCISE_NOT_FOUND (same 404 as
//     not-found — no enumeration oracle).
//
// schema_version + code are server-authoritative: Create sets them; Update
// never touches them (the query omits both columns). The request body cannot
// smuggle either — Create takes no such fields and Update ignores them.
package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	exerciseTitleMinLen = 1
	exerciseTitleMaxLen = 200
	exerciseBandMin     = 0.0
	exerciseBandMax     = 9.0
	maxExerciseTags     = 30
	maxExerciseTagLen   = 50
	// exerciseCodeRetryCap bounds the code-generation retry loop. The per-
	// (center,skill) counter makes a UNIQUE(center_id, code) collision
	// essentially impossible; the retry + UNIQUE index are belt-and-suspenders.
	exerciseCodeRetryCap = 5

	exerciseCreatedAction    = "exercise.created"
	exerciseUpdatedAction    = "exercise.updated"
	exerciseDeletedAction    = "exercise.deleted"
	exerciseDuplicatedAction = "exercise.duplicated"
	exerciseAuditEntity      = "exercise"
	exerciseNotFoundCode     = "EXERCISE_NOT_FOUND"
	exerciseConflictCode     = "CONFLICT"
	// uniqueViolationPgErrorCode ("23505") is declared in auth.go (same package).
)

// validExerciseSkills mirrors the exercises.skill CHECK + api.yaml ExerciseSkill.
var validExerciseSkills = map[string]bool{
	"reading": true, "listening": true, "writing": true, "speaking": true,
	"grammar": true, "vocabulary": true, "general": true,
}

// exerciseSkillLetters maps a skill to its EX-code letter (locale-invariant).
var exerciseSkillLetters = map[string]string{
	"reading":    "R",
	"listening":  "L",
	"writing":    "W",
	"speaking":   "S",
	"grammar":    "G",
	"vocabulary": "V",
	"general":    "X",
}

// ExerciseService owns exercise-library CRUD + Duplicate.
type ExerciseService struct {
	db    AuthDB
	audit AuditLogger
	clk   clock.Clock
}

// NewExerciseService constructs an ExerciseService bound to the DB pool, the
// audit logger, and a clock (audit timestamps).
func NewExerciseService(db AuthDB, audit AuditLogger, clk clock.Clock) *ExerciseService {
	return &ExerciseService{db: db, audit: audit, clk: clk}
}

// --- inputs / outputs ---

// CreateExerciseInput is the decoded minimal-metadata create payload (AC3).
type CreateExerciseInput struct {
	Title       string
	Skill       string
	Tags        []string
	Description *string
	TargetBand  *float64
}

// UpdateExerciseInput is the decoded partial-update payload (AC4). A nil Title/
// Skill pointer (and nil Tags) means "unchanged" (the service merges over the
// current row before the full-replace write). The nullable Description/
// TargetBand fields carry JSON tri-state (TriString/TriFloat): absent = keep,
// explicit null = clear to SQL NULL, value = set. Content nil = keep the
// existing blob; non-nil = replace. Precondition is the optimistic-concurrency
// token (required for the editor path — nil → 428).
type UpdateExerciseInput struct {
	Title        *string
	Skill        *string
	Tags         []string
	Description  TriString
	TargetBand   TriFloat
	Content      *store.ExerciseContent
	Precondition *time.Time
}

// TriString / TriFloat carry a PATCH field's JSON tri-state so a client can
// distinguish "leave unchanged" (key absent) from "clear to NULL" (explicit
// null) from "set" (a value). Set=false ⇒ key absent; Set=true && Value==nil ⇒
// explicit null; Set=true && Value!=nil ⇒ set to *Value. api.yaml declares
// description/targetBand nullable, so null must be able to clear them.
type TriString struct {
	Set   bool
	Value *string
}

// TriFloat is the numeric analogue of TriString (see its doc).
type TriFloat struct {
	Set   bool
	Value *float64
}

// ExerciseWithCounts is the single-row service result: the DB row + the
// detail-path section/question counts (computed in Go from the typed content).
type ExerciseWithCounts struct {
	Row           generated.Exercise
	SectionCount  int
	QuestionCount int
}

// ExerciseSkillCount is one entry in the count-tab strip (AC1).
type ExerciseSkillCount struct {
	Skill string
	Count int64
}

// ListExerciseFilter carries the (already handler-validated) list query.
type ListExerciseFilter struct {
	Skill    *string
	Tag      *string
	Band     *float64
	Page     int
	PageSize int
}

// ExerciseListResult is the List payload: the page of rows + pagination totals
// + the per-skill count strip.
type ExerciseListResult struct {
	Items       []generated.ListExercisesRow
	Total       int64
	Page        int
	PageSize    int
	TotalPages  int
	SkillCounts []ExerciseSkillCount
}

// --- helpers ---

func exerciseNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "exercise", ID: id.String(), Code: exerciseNotFoundCode}
}

// assertExerciseTeacherScope enforces AC8: a teacher may only touch exercises
// they authored. Cross-teacher access returns 404 EXERCISE_NOT_FOUND (same 404
// as not-found — no enumeration oracle). Owner/admin may touch any row in-center.
func assertExerciseTeacherScope(tc model.TenantContext, createdBy pgtype.UUID, id uuid.UUID) error {
	if tc.Role != model.RoleTeacher {
		return nil
	}
	if !createdBy.Valid || uuidStringFromPg(createdBy) != tc.UserID {
		return exerciseNotFound(id)
	}
	return nil
}

func exerciseCode(skill string, seq int32) string {
	return fmt.Sprintf("EX-%s%03d", exerciseSkillLetters[skill], seq)
}

// exerciseCopySuffix is appended to a duplicated exercise's title.
const exerciseCopySuffix = " (copy)"

// duplicatedTitle builds the clone's title, keeping the whole result within the
// exerciseTitleMaxLen cap (CR-4-1-5). A 200-rune source + " (copy)" would
// otherwise exceed the api.yaml maxLength and later 422 on its own Update; the
// base is truncated (rune-safe) so base+suffix fits, and repeat duplication
// never grows unbounded.
func duplicatedTitle(srcTitle string) string {
	suffixLen := utf8.RuneCountInString(exerciseCopySuffix)
	if utf8.RuneCountInString(srcTitle)+suffixLen <= exerciseTitleMaxLen {
		return srcTitle + exerciseCopySuffix
	}
	base := []rune(srcTitle)
	base = base[:exerciseTitleMaxLen-suffixLen]
	return string(base) + exerciseCopySuffix
}

// teacherRowsToListRows converts the teacher-scoped list rows to the canonical
// ListExercisesRow shape (sqlc emits distinct-but-identical row types per
// query; the fields line up 1:1).
func teacherRowsToListRows(rows []generated.ListExercisesByTeacherRow) []generated.ListExercisesRow {
	out := make([]generated.ListExercisesRow, len(rows))
	for i, r := range rows {
		out[i] = generated.ListExercisesRow{
			ID:            r.ID,
			CenterID:      r.CenterID,
			CreatedBy:     r.CreatedBy,
			Code:          r.Code,
			Title:         r.Title,
			Description:   r.Description,
			Skill:         r.Skill,
			Tags:          r.Tags,
			TargetBand:    r.TargetBand,
			SchemaVersion: r.SchemaVersion,
			DeletedAt:     r.DeletedAt,
			CreatedAt:     r.CreatedAt,
			UpdatedAt:     r.UpdatedAt,
			SectionCount:  r.SectionCount,
			QuestionCount: r.QuestionCount,
		}
	}
	return out
}

// validateExerciseMetadata validates the shared title/skill/tags/band fields.
func validateExerciseMetadata(title *string, skill *string, tags []string, band *float64) []model.FieldError {
	var fields []model.FieldError
	if title != nil {
		t := strings.TrimSpace(*title)
		if rc := utf8.RuneCountInString(t); rc < exerciseTitleMinLen || rc > exerciseTitleMaxLen {
			fields = append(fields, model.FieldError{
				Field: "title", Code: "INVALID_TITLE",
				Message: fmt.Sprintf("title must be %d–%d characters", exerciseTitleMinLen, exerciseTitleMaxLen),
			})
		}
	}
	if skill != nil && !validExerciseSkills[*skill] {
		fields = append(fields, model.FieldError{
			Field: "skill", Code: "INVALID_SKILL", Message: "unknown skill",
		})
	}
	if len(tags) > maxExerciseTags {
		fields = append(fields, model.FieldError{
			Field: "tags", Code: "TOO_MANY_TAGS",
			Message: fmt.Sprintf("at most %d tags", maxExerciseTags),
		})
	}
	for _, tag := range tags {
		if utf8.RuneCountInString(tag) > maxExerciseTagLen {
			fields = append(fields, model.FieldError{
				Field: "tags", Code: "INVALID_TAG",
				Message: fmt.Sprintf("each tag must be at most %d characters", maxExerciseTagLen),
			})
			break
		}
	}
	if band != nil {
		switch {
		case math.IsNaN(*band) || math.IsInf(*band, 0) || *band < exerciseBandMin || *band > exerciseBandMax:
			fields = append(fields, model.FieldError{
				Field: "targetBand", Code: "INVALID_TARGET_BAND",
				Message: fmt.Sprintf("targetBand must be between %g and %g", exerciseBandMin, exerciseBandMax),
			})
		case !isHalfBandStep(*band):
			// IELTS bands move in 0.5 steps; the column is numeric(2,1), so a
			// sub-0.1 value would silently round and then never match its own
			// band-equality filter (CR-4-1-10). Reject rather than corrupt.
			fields = append(fields, model.FieldError{
				Field: "targetBand", Code: "INVALID_TARGET_BAND",
				Message: "targetBand must be a multiple of 0.5",
			})
		}
	}
	return fields
}

// isHalfBandStep reports whether b is a multiple of 0.5 (IELTS band
// granularity) within a small float tolerance.
func isHalfBandStep(b float64) bool {
	scaled := b * 2
	return math.Abs(scaled-math.Round(scaled)) < 1e-9
}

// normalizeTags trims each tag and drops empties. Returns a non-nil slice so the
// column stores '{}' not NULL.
func normalizeTags(tags []string) []string {
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		t := strings.TrimSpace(tag)
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

func (s *ExerciseService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("exercise read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("exercise read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *ExerciseService) mutateInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, txQ *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("exercise mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("exercise mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// countsFromRow unmarshals a stored row's content under its column version and
// returns section/question counts. A corrupt blob surfaces as a typed error
// (→ 500 via the default mapper arm), never a panic.
func countsFromRow(row generated.Exercise) (int, int, error) {
	content, err := store.UnmarshalExerciseContent(row.Content, int(row.SchemaVersion))
	if err != nil {
		return 0, 0, fmt.Errorf("decode exercise %s content: %w", uuidStringFromPg(row.ID), err)
	}
	return content.SectionCount(), content.QuestionCount(), nil
}

// --- Create ---

// Create inserts a minimal-metadata exercise with a server-generated code, a
// v1 content shell (FR-22-default settings materialized), and schema_version=1
// (server-set — the body cannot override it). Owned by the acting user.
func (s *ExerciseService) Create(
	ctx context.Context, tc model.TenantContext, in CreateExerciseInput,
) (ExerciseWithCounts, error) {
	if err := assertClassRole(tc); err != nil {
		return ExerciseWithCounts{}, err
	}
	if fields := validateExerciseMetadata(&in.Title, &in.Skill, in.Tags, in.TargetBand); len(fields) > 0 {
		return ExerciseWithCounts{}, model.ValidationError{Fields: fields}
	}

	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return ExerciseWithCounts{}, fmt.Errorf("create exercise: parse center id: %w", err)
	}
	createdBy, err := uuid.Parse(tc.UserID)
	if err != nil {
		return ExerciseWithCounts{}, fmt.Errorf("create exercise: parse user id: %w", err)
	}
	targetBand, err := optNumeric(in.TargetBand)
	if err != nil {
		return ExerciseWithCounts{}, fmt.Errorf("create exercise: target band: %w", err)
	}
	shellBytes, err := store.NewExerciseContentShell().Marshal()
	if err != nil {
		return ExerciseWithCounts{}, fmt.Errorf("create exercise: shell: %w", err)
	}

	var created generated.Exercise
	err = s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		row, cerr := s.insertWithGeneratedCode(ctx, tx, txQ, generated.CreateExerciseParams{
			CenterID:      pgUUID(centerUUID),
			CreatedBy:     pgUUID(createdBy),
			Title:         strings.TrimSpace(in.Title),
			Description:   optText(in.Description),
			Skill:         in.Skill,
			Tags:          normalizeTags(in.Tags),
			TargetBand:    targetBand,
			Content:       shellBytes,
			SchemaVersion: store.CurrentExerciseSchemaVersion,
		})
		if cerr != nil {
			return cerr
		}
		changes := Changes{After: map[string]any{
			"code": row.Code, "title": row.Title, "skill": row.Skill,
		}}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, exerciseCreatedAction, exerciseAuditEntity, uuidFromPg(row.ID), changes); aerr != nil {
			return fmt.Errorf("create exercise: audit: %w", aerr)
		}
		created = row
		return nil
	})
	if err != nil {
		return ExerciseWithCounts{}, err
	}
	// A fresh shell is 0 sections / 0 questions — no need to re-decode.
	return ExerciseWithCounts{Row: created, SectionCount: 0, QuestionCount: 0}, nil
}

// insertWithGeneratedCode obtains a fresh per-(center,skill) sequence, builds
// the EX-code, and inserts. The UNIQUE(center_id, code) index is a belt behind
// the monotonic counter; a (near-impossible) 23505 retries with a fresh
// sequence under a savepoint so the outer tx stays usable. id is generated per
// attempt. center_id/created_by/skill/etc. come from the base params.
func (s *ExerciseService) insertWithGeneratedCode(
	ctx context.Context, tx pgx.Tx, txQ *generated.Queries, base generated.CreateExerciseParams,
) (generated.Exercise, error) {
	for attempt := 0; attempt < exerciseCodeRetryCap; attempt++ {
		seq, err := txQ.NextExerciseCode(ctx, generated.NextExerciseCodeParams{
			CenterID: base.CenterID,
			Skill:    base.Skill,
		})
		if err != nil {
			return generated.Exercise{}, fmt.Errorf("create exercise: next code: %w", err)
		}
		params := base
		params.ID = pgUUID(uuid.New())
		params.Code = exerciseCode(base.Skill, seq)

		if _, err := tx.Exec(ctx, "SAVEPOINT ex_code_insert"); err != nil {
			return generated.Exercise{}, fmt.Errorf("create exercise: savepoint: %w", err)
		}
		row, err := txQ.CreateExercise(ctx, params)
		if err == nil {
			if _, relErr := tx.Exec(ctx, "RELEASE SAVEPOINT ex_code_insert"); relErr != nil {
				return generated.Exercise{}, fmt.Errorf("create exercise: release savepoint: %w", relErr)
			}
			return row, nil
		}
		if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT ex_code_insert"); rbErr != nil {
			return generated.Exercise{}, fmt.Errorf("create exercise: rollback savepoint: %w", rbErr)
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == uniqueViolationPgErrorCode {
			continue // code collision — retry with the next sequence
		}
		return generated.Exercise{}, fmt.Errorf("create exercise: insert: %w", err)
	}
	return generated.Exercise{}, model.ConflictError{
		Resource: "exercise", Code: exerciseConflictCode,
		Message: "could not allocate a unique exercise code; please retry",
	}
}

// --- List ---

// List returns a filtered, paginated page of exercises scoped to the caller
// role, plus pagination totals and the per-skill count strip. Page/pageSize are
// expected pre-validated + clamped by the handler.
func (s *ExerciseService) List(
	ctx context.Context, tc model.TenantContext, f ListExerciseFilter,
) (ExerciseListResult, error) {
	if err := assertClassRole(tc); err != nil {
		return ExerciseListResult{}, err
	}
	teacherScoped := tc.Role == model.RoleTeacher
	var createdBy pgtype.UUID
	if teacherScoped {
		uid, err := uuid.Parse(tc.UserID)
		if err != nil {
			return ExerciseListResult{}, fmt.Errorf("list exercises: parse user id: %w", err)
		}
		createdBy = pgUUID(uid)
	}

	skillArg := optText(f.Skill)
	tagArg := optText(f.Tag)
	bandArg, err := optNumeric(f.Band)
	if err != nil {
		return ExerciseListResult{}, fmt.Errorf("list exercises: band filter: %w", err)
	}
	offset := int32((f.Page - 1) * f.PageSize)
	limit := int32(f.PageSize)

	result := ExerciseListResult{Page: f.Page, PageSize: f.PageSize}
	err = s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		var listErr error
		if teacherScoped {
			teacherRows, terr := q.ListExercisesByTeacher(ctx, generated.ListExercisesByTeacherParams{
				CreatedBy: createdBy, Skill: skillArg, Tag: tagArg, TargetBand: bandArg,
				PageLimit: limit, PageOffset: offset,
			})
			listErr = terr
			result.Items = teacherRowsToListRows(teacherRows)
		} else {
			result.Items, listErr = q.ListExercises(ctx, generated.ListExercisesParams{
				Skill: skillArg, Tag: tagArg, TargetBand: bandArg,
				PageLimit: limit, PageOffset: offset,
			})
		}
		if listErr != nil {
			return fmt.Errorf("list exercises: %w", listErr)
		}

		if teacherScoped {
			result.Total, listErr = q.CountExercisesByTeacher(ctx, generated.CountExercisesByTeacherParams{
				CreatedBy: createdBy, Skill: skillArg, Tag: tagArg, TargetBand: bandArg,
			})
		} else {
			result.Total, listErr = q.CountExercises(ctx, generated.CountExercisesParams{
				Skill: skillArg, Tag: tagArg, TargetBand: bandArg,
			})
		}
		if listErr != nil {
			return fmt.Errorf("count exercises: %w", listErr)
		}

		if teacherScoped {
			rows, cerr := q.CountPerSkillByTeacher(ctx, generated.CountPerSkillByTeacherParams{
				CreatedBy: createdBy, Tag: tagArg, TargetBand: bandArg,
			})
			if cerr != nil {
				return fmt.Errorf("count per skill: %w", cerr)
			}
			result.SkillCounts = make([]ExerciseSkillCount, len(rows))
			for i, r := range rows {
				result.SkillCounts[i] = ExerciseSkillCount{Skill: r.Skill, Count: r.Total}
			}
		} else {
			rows, cerr := q.CountPerSkill(ctx, generated.CountPerSkillParams{
				Tag: tagArg, TargetBand: bandArg,
			})
			if cerr != nil {
				return fmt.Errorf("count per skill: %w", cerr)
			}
			result.SkillCounts = make([]ExerciseSkillCount, len(rows))
			for i, r := range rows {
				result.SkillCounts[i] = ExerciseSkillCount{Skill: r.Skill, Count: r.Total}
			}
		}
		return nil
	})
	if err != nil {
		return ExerciseListResult{}, err
	}
	result.TotalPages = int(math.Ceil(float64(result.Total) / float64(f.PageSize)))
	return result, nil
}

// --- Get ---

// Get returns a single exercise incl. counts computed from the full typed
// content (detail path). 404 if absent / soft-deleted / cross-teacher.
func (s *ExerciseService) Get(
	ctx context.Context, tc model.TenantContext, id uuid.UUID,
) (ExerciseWithCounts, error) {
	if err := assertClassRole(tc); err != nil {
		return ExerciseWithCounts{}, err
	}
	var out ExerciseWithCounts
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		row, err := q.GetExerciseByID(ctx, pgUUID(id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return exerciseNotFound(id)
			}
			return fmt.Errorf("get exercise: %w", err)
		}
		if err := assertExerciseTeacherScope(tc, row.CreatedBy, id); err != nil {
			return err
		}
		sections, questions, cerr := countsFromRow(row)
		if cerr != nil {
			return cerr
		}
		out = ExerciseWithCounts{Row: row, SectionCount: sections, QuestionCount: questions}
		return nil
	})
	return out, err
}

// --- Update ---

// Update merges the partial input over the current row and full-replaces the
// mutable columns (never schema_version / code). The optimistic-concurrency
// precondition is mandatory (nil → 428); a stale precondition → 409 CONFLICT
// (never a silent last-writer-wins clobber).
func (s *ExerciseService) Update(
	ctx context.Context, tc model.TenantContext, id uuid.UUID, in UpdateExerciseInput,
) (ExerciseWithCounts, error) {
	if err := assertClassRole(tc); err != nil {
		return ExerciseWithCounts{}, err
	}
	if in.Precondition == nil {
		return ExerciseWithCounts{}, &PreconditionRequiredError{}
	}
	// Only a set-with-value targetBand needs range/step validation; an explicit
	// null (clear) or an absent field carries a nil Value and is skipped.
	if fields := validateExerciseMetadata(in.Title, in.Skill, in.Tags, in.TargetBand.Value); len(fields) > 0 {
		return ExerciseWithCounts{}, model.ValidationError{Fields: fields}
	}

	var out ExerciseWithCounts
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		current, err := txQ.GetExerciseByID(ctx, pgUUID(id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return exerciseNotFound(id)
			}
			return fmt.Errorf("update exercise: get: %w", err)
		}
		if err := assertExerciseTeacherScope(tc, current.CreatedBy, id); err != nil {
			return err
		}
		// Stale-precondition check against the freshly-read row (loud 409, not a
		// silent clobber). The SQL `updated_at = precondition` below is the belt
		// for a concurrent writer between this read and the write.
		if !current.UpdatedAt.Valid || !current.UpdatedAt.Time.Equal(*in.Precondition) {
			return model.ConflictError{
				Resource: "exercise", ID: id.String(), Code: exerciseConflictCode,
				Message: "the exercise was modified by someone else; reload and retry",
			}
		}

		// Merge partial metadata over the current row.
		title := current.Title
		if in.Title != nil {
			title = strings.TrimSpace(*in.Title)
		}
		skill := current.Skill
		if in.Skill != nil {
			skill = *in.Skill
		}
		// description/targetBand are tri-state (TriString/TriFloat): absent keeps
		// the current value, explicit null clears to SQL NULL, a value sets it.
		description := current.Description
		if in.Description.Set {
			if in.Description.Value == nil {
				description = pgtype.Text{Valid: false}
			} else {
				description = pgtype.Text{String: *in.Description.Value, Valid: true}
			}
		}
		tags := current.Tags
		if in.Tags != nil {
			tags = normalizeTags(in.Tags)
		}
		targetBand := current.TargetBand
		if in.TargetBand.Set {
			if in.TargetBand.Value == nil {
				targetBand = pgtype.Numeric{Valid: false}
			} else {
				tb, terr := optNumeric(in.TargetBand.Value)
				if terr != nil {
					return fmt.Errorf("update exercise: target band: %w", terr)
				}
				targetBand = tb
			}
		}

		// Content: replace only when the caller sent a new blob (4.2/Duplicate);
		// otherwise carry the current bytes. Enforce the size cap on replacement.
		contentBytes := current.Content
		if in.Content != nil {
			raw, merr := in.Content.Marshal()
			if merr != nil {
				return fmt.Errorf("update exercise: marshal content: %w", merr)
			}
			if len(raw) > store.MaxContentBytes {
				return &PayloadTooLargeError{LimitBytes: store.MaxContentBytes}
			}
			contentBytes = raw
		}

		updated, err := txQ.UpdateExercise(ctx, generated.UpdateExerciseParams{
			Title:                 title,
			Description:           description,
			Skill:                 skill,
			Tags:                  tags,
			TargetBand:            targetBand,
			Content:               contentBytes,
			ID:                    pgUUID(id),
			PreconditionUpdatedAt: pgtype.Timestamptz{Time: *in.Precondition, Valid: true},
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// A concurrent writer won between the read and this write.
				return model.ConflictError{
					Resource: "exercise", ID: id.String(), Code: exerciseConflictCode,
					Message: "the exercise was modified by someone else; reload and retry",
				}
			}
			return fmt.Errorf("update exercise: update: %w", err)
		}

		changes := Changes{
			Before: map[string]any{"title": current.Title, "skill": current.Skill},
			After:  map[string]any{"title": updated.Title, "skill": updated.Skill},
		}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, exerciseUpdatedAction, exerciseAuditEntity, id, changes); aerr != nil {
			return fmt.Errorf("update exercise: audit: %w", aerr)
		}

		sections, questions, cerr := countsFromRow(updated)
		if cerr != nil {
			return cerr
		}
		out = ExerciseWithCounts{Row: updated, SectionCount: sections, QuestionCount: questions}
		return nil
	})
	return out, err
}

// --- SoftDelete ---

// SoftDelete stamps deleted_at (AC5). 404 if absent / already deleted /
// cross-teacher. The row is recoverable (Epic 10 restore UI).
func (s *ExerciseService) SoftDelete(
	ctx context.Context, tc model.TenantContext, id uuid.UUID,
) error {
	if err := assertClassRole(tc); err != nil {
		return err
	}
	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		current, err := txQ.GetExerciseByID(ctx, pgUUID(id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return exerciseNotFound(id)
			}
			return fmt.Errorf("soft-delete exercise: get: %w", err)
		}
		if err := assertExerciseTeacherScope(tc, current.CreatedBy, id); err != nil {
			return err
		}
		if _, err := txQ.SoftDeleteExercise(ctx, pgUUID(id)); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return exerciseNotFound(id)
			}
			return fmt.Errorf("soft-delete exercise: %w", err)
		}
		changes := Changes{Before: map[string]any{"code": current.Code, "title": current.Title}}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, exerciseDeletedAction, exerciseAuditEntity, id, changes); aerr != nil {
			return fmt.Errorf("soft-delete exercise: audit: %w", aerr)
		}
		return nil
	})
}

// --- Duplicate ---

// Duplicate clones an exercise: title suffixed "(copy)", same skill/tags/band,
// a DEEP copy of the content (unmarshal → re-marshal), a fresh unique code, and
// created_by = the duplicator. Mutating the copy never touches the original —
// separate rows, separate content bytes. 404 if the source is absent /
// soft-deleted / cross-teacher.
func (s *ExerciseService) Duplicate(
	ctx context.Context, tc model.TenantContext, id uuid.UUID,
) (ExerciseWithCounts, error) {
	if err := assertClassRole(tc); err != nil {
		return ExerciseWithCounts{}, err
	}
	duplicator, err := uuid.Parse(tc.UserID)
	if err != nil {
		return ExerciseWithCounts{}, fmt.Errorf("duplicate exercise: parse user id: %w", err)
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return ExerciseWithCounts{}, fmt.Errorf("duplicate exercise: parse center id: %w", err)
	}

	var out ExerciseWithCounts
	err = s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		src, err := txQ.GetExerciseByID(ctx, pgUUID(id))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return exerciseNotFound(id)
			}
			return fmt.Errorf("duplicate exercise: get source: %w", err)
		}
		if err := assertExerciseTeacherScope(tc, src.CreatedBy, id); err != nil {
			return err
		}
		// Deep copy via typed round-trip (also validates the source is v1).
		content, derr := store.UnmarshalExerciseContent(src.Content, int(src.SchemaVersion))
		if derr != nil {
			return fmt.Errorf("duplicate exercise: decode source content: %w", derr)
		}
		clonedContent, merr := content.Marshal()
		if merr != nil {
			return fmt.Errorf("duplicate exercise: marshal clone content: %w", merr)
		}

		clone, err := s.insertWithGeneratedCode(ctx, tx, txQ, generated.CreateExerciseParams{
			CenterID:      pgUUID(centerUUID),
			CreatedBy:     pgUUID(duplicator),
			Title:         duplicatedTitle(src.Title),
			Description:   src.Description,
			Skill:         src.Skill,
			Tags:          src.Tags,
			TargetBand:    src.TargetBand,
			Content:       clonedContent,
			SchemaVersion: store.CurrentExerciseSchemaVersion,
		})
		if err != nil {
			return err
		}
		changes := Changes{After: map[string]any{
			"code": clone.Code, "title": clone.Title, "duplicated_from": id.String(),
		}}
		if aerr := s.audit.LogWithinTx(ctx, tx, tc, exerciseDuplicatedAction, exerciseAuditEntity, uuidFromPg(clone.ID), changes); aerr != nil {
			return fmt.Errorf("duplicate exercise: audit: %w", aerr)
		}
		out = ExerciseWithCounts{Row: clone, SectionCount: content.SectionCount(), QuestionCount: content.QuestionCount()}
		return nil
	})
	return out, err
}
