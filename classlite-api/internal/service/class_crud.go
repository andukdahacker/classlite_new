// Class CRUD service methods (Story 3.1, AC1/AC5/AC6). Lifecycle transitions
// live in class_lifecycle.go. These share ClassService's Spawn tx/audit
// ceremony: Begin → store.SetTenantContext → generated.New(tx) → mutate →
// LogWithinTx → Commit. Placed in their own file to keep class.go focused on
// the Spawn fan-out (same package — placement is immaterial to behavior;
// story names class.go, this is a pragmatic split).
package service

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// validPrimarySkills mirrors the classes.primary_skill CHECK + api.yaml enum.
var validPrimarySkills = map[string]bool{
	"writing": true, "speaking": true, "listening": true,
	"reading": true, "listening_reading": true, "all_skills": true,
}

// classTargetBand range mirrors the api.yaml Class.targetBand bounds (0–9).
// The column is numeric(3,1) with no CHECK, so the service is the sole guard —
// an unvalidated band > 9 would persist and > 99.9 would overflow → 500.
// (Distinct from template.go's targetBandMin=1.0 — the Class contract allows 0.)
const (
	classTargetBandMin = 0.0
	classTargetBandMax = 9.0
)

// fkViolationPgErrorCode is Postgres SQLSTATE foreign_key_violation.
const fkViolationPgErrorCode = "23503"

// CreateClassInput is the decoded + parsed create payload. Optional fields are
// nil when absent (AC2: an omitted/excluded field = unset, column takes its
// NULL/DB-default — the template value is never copied server-side).
type CreateClassInput struct {
	TemplateID          *uuid.UUID
	Name                string
	Description         *string
	TargetBand          *float64
	PrimarySkill        *string
	SessionCount        *int32
	Capacity            *int32
	TeacherID           *uuid.UUID
	PendingTeacherEmail *string
	StartDate           *time.Time
	EndDate             *time.Time
	Color               *string
}

// UpdateClassInput is the decoded partial-update payload (AC6). A nil field
// means "unchanged" (COALESCE keeps the existing value). Nullable fields
// cannot be cleared to NULL this story.
type UpdateClassInput struct {
	Name                *string
	Description         *string
	TargetBand          *float64
	PrimarySkill        *string
	SessionCount        *int32
	Capacity            *int32
	StartDate           *time.Time
	EndDate             *time.Time
	Color               *string
	DueDatesEnabled     *bool
	TeacherID           *uuid.UUID
	PendingTeacherEmail *string
}

// Create inserts a class with server-forced status='upcoming' (AC1), writes a
// class.created audit row in-tx, and returns the new row. Allowed for
// owner/admin/teacher (classChain — not owner-gated). A teacher caller with no
// explicit assignment defaults teacher_id to self; owner/admin MUST supply a
// teacher_id or pendingTeacherEmail (no auto-assign). due_dates ship OFF (AC3).
func (s *ClassService) Create(
	ctx context.Context, tc model.TenantContext, in CreateClassInput,
) (generated.Class, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Class{}, err
	}
	fields := validateCreateClass(&in)

	// Teacher assignment (AC1) — mutex: at most one of teacher_id /
	// pending_teacher_email; owner/admin must set one, teacher defaults to self.
	teacherID, pendingEmail := in.TeacherID, in.PendingTeacherEmail
	if teacherID != nil && pendingEmail != nil {
		fields = append(fields, model.FieldError{
			Field: "teacherId", Code: "TEACHER_ASSIGNMENT_CONFLICT",
			Message: "provide either teacherId or pendingTeacherEmail, not both",
		})
	} else if teacherID == nil && pendingEmail == nil {
		if tc.Role == model.RoleTeacher {
			callerID, err := uuid.Parse(tc.UserID)
			if err != nil {
				return generated.Class{}, fmt.Errorf("create class: parse caller id: %w", err)
			}
			teacherID = &callerID
		} else {
			fields = append(fields, model.FieldError{
				Field: "teacherId", Code: "TEACHER_ASSIGNMENT_REQUIRED",
				Message: "owner/admin must assign a teacher or a pending teacher email",
			})
		}
	}

	if len(fields) > 0 {
		return generated.Class{}, model.ValidationError{Fields: fields}
	}

	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return generated.Class{}, fmt.Errorf("create class: parse center id: %w", err)
	}
	targetBand, err := optNumeric(in.TargetBand)
	if err != nil {
		return generated.Class{}, fmt.Errorf("create class: target band: %w", err)
	}

	classID := model.NewID()
	params := generated.CreateClassParams{
		ID:                  pgUUID(classID),
		CenterID:            pgUUID(centerUUID),
		TemplateID:          optUUID(in.TemplateID),
		Name:                strings.TrimSpace(in.Name),
		TargetBand:          targetBand,
		PrimarySkill:        optText(in.PrimarySkill),
		SessionCount:        optInt4(in.SessionCount),
		Status:              ClassStatusUpcoming,
		TeacherID:           optUUID(teacherID),
		PendingTeacherEmail: optText(pendingEmail),
		StartDate:           optDate(in.StartDate),
		Description:         optText(in.Description),
		Capacity:            optInt4(in.Capacity),
		DueDatesEnabled:     false,
		EndDate:             optDate(in.EndDate),
		Color:               optText(in.Color),
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return generated.Class{}, fmt.Errorf("create class: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return generated.Class{}, fmt.Errorf("create class: %w", err)
	}
	txQ := generated.New(tx)

	row, err := txQ.CreateClass(ctx, params)
	if err != nil {
		if verr := classFKViolationError(err); verr != nil {
			return generated.Class{}, verr
		}
		return generated.Class{}, fmt.Errorf("create class: insert: %w", err)
	}

	changes := Changes{Before: nil, After: classAuditSnapshot(row)}
	if err := s.audit.LogWithinTx(ctx, tx, tc, classCreatedAction, classAuditEntity, classID, changes); err != nil {
		return generated.Class{}, fmt.Errorf("create class: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return generated.Class{}, fmt.Errorf("create class: commit: %w", err)
	}
	return row, nil
}

// List returns ALL center classes (AC5 owner/admin scope), tenant-scoped by
// RLS. Reads run inside a SetTenantContext tx (PERF-1 — SET LOCAL needs a tx).
func (s *ClassService) List(ctx context.Context, tc model.TenantContext) ([]generated.Class, error) {
	var out []generated.Class
	err := s.readInTenantTx(ctx, tc, func(txQ *generated.Queries) error {
		rows, err := txQ.ListClasses(ctx)
		if err != nil {
			return fmt.Errorf("list classes: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// ListForTeacher returns ONLY classes where teacher_id = teacherID (AC5 teacher
// scope). Still runs inside a SetTenantContext tx so RLS belt-and-suspenders
// the tenant boundary. The role branch lives here/at the handler — never RLS.
func (s *ClassService) ListForTeacher(
	ctx context.Context, tc model.TenantContext, teacherID uuid.UUID,
) ([]generated.Class, error) {
	var out []generated.Class
	err := s.readInTenantTx(ctx, tc, func(txQ *generated.Queries) error {
		rows, err := txQ.ListClassesByTeacher(ctx, pgUUID(teacherID))
		if err != nil {
			return fmt.Errorf("list classes by teacher: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// Get returns a single class for edit-form prefill (AC6). 404 CLASS_NOT_FOUND
// if absent OR invisible under teacher-scope.
func (s *ClassService) Get(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID,
) (generated.Class, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Class{}, err
	}
	var out generated.Class
	err := s.readInTenantTx(ctx, tc, func(txQ *generated.Queries) error {
		row, err := txQ.GetClassByID(ctx, pgUUID(classID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return classNotFound(classID)
			}
			return fmt.Errorf("get class: %w", err)
		}
		if err := assertTeacherScope(tc, row, classID); err != nil {
			return err
		}
		out = row
		return nil
	})
	return out, err
}

// Update applies a partial update (AC6), sets updated_at, writes a class.updated
// audit row with a Before/After diff, and returns the updated row. Teacher-scope
// authz: a teacher may only update a class assigned to them; otherwise 404.
func (s *ClassService) Update(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID, in UpdateClassInput,
) (generated.Class, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.Class{}, err
	}
	if fields := validateUpdateClass(&in); len(fields) > 0 {
		return generated.Class{}, model.ValidationError{Fields: fields}
	}
	if in.TeacherID != nil && in.PendingTeacherEmail != nil {
		return generated.Class{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "teacherId", Code: "TEACHER_ASSIGNMENT_CONFLICT",
			Message: "provide either teacherId or pendingTeacherEmail, not both",
		}}}
	}

	targetBand, err := optNumeric(in.TargetBand)
	if err != nil {
		return generated.Class{}, fmt.Errorf("update class: target band: %w", err)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return generated.Class{}, fmt.Errorf("update class: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return generated.Class{}, fmt.Errorf("update class: %w", err)
	}
	txQ := generated.New(tx)

	current, err := txQ.GetClassByID(ctx, pgUUID(classID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.Class{}, classNotFound(classID)
		}
		return generated.Class{}, fmt.Errorf("update class: get class: %w", err)
	}
	if err := assertTeacherScope(tc, current, classID); err != nil {
		return generated.Class{}, err
	}

	updated, err := txQ.UpdateClass(ctx, generated.UpdateClassParams{
		ID:                  pgUUID(classID),
		Name:                optTextTrimmed(in.Name),
		Description:         optText(in.Description),
		TargetBand:          targetBand,
		PrimarySkill:        optText(in.PrimarySkill),
		SessionCount:        optInt4(in.SessionCount),
		Capacity:            optInt4(in.Capacity),
		StartDate:           optDate(in.StartDate),
		EndDate:             optDate(in.EndDate),
		Color:               optText(in.Color),
		DueDatesEnabled:     optBool(in.DueDatesEnabled),
		TeacherID:           optUUID(in.TeacherID),
		PendingTeacherEmail: optText(in.PendingTeacherEmail),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return generated.Class{}, classNotFound(classID)
		}
		if verr := classFKViolationError(err); verr != nil {
			return generated.Class{}, verr
		}
		return generated.Class{}, fmt.Errorf("update class: update: %w", err)
	}

	changes := Changes{Before: classAuditSnapshot(current), After: classAuditSnapshot(updated)}
	if err := s.audit.LogWithinTx(ctx, tx, tc, classUpdatedAction, classAuditEntity, classID, changes); err != nil {
		return generated.Class{}, fmt.Errorf("update class: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return generated.Class{}, fmt.Errorf("update class: commit: %w", err)
	}
	return updated, nil
}

// readInTenantTx opens a tenant-scoped tx (SET LOCAL app.current_tenant_id),
// runs fn against the tx-bound queries, and commits. Shared by the read paths.
func (s *ClassService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// --- validation ---

func validateCreateClass(in *CreateClassInput) []model.FieldError {
	var fields []model.FieldError
	name := strings.TrimSpace(in.Name)
	if rc := utf8.RuneCountInString(name); rc < cohortNameMinLen || rc > cohortNameMaxLen {
		fields = append(fields, model.FieldError{
			Field: "name", Code: "INVALID_NAME",
			Message: fmt.Sprintf("name must be %d–%d characters", cohortNameMinLen, cohortNameMaxLen),
		})
	}
	fields = appendScalarClassFieldErrors(fields, in.PrimarySkill, in.Capacity, in.SessionCount, in.TargetBand)
	if in.PendingTeacherEmail != nil {
		if _, err := mail.ParseAddress(*in.PendingTeacherEmail); err != nil {
			fields = append(fields, model.FieldError{
				Field: "pendingTeacherEmail", Code: "INVALID_TEACHER_EMAIL", Message: "invalid email address",
			})
		}
	}
	return fields
}

func validateUpdateClass(in *UpdateClassInput) []model.FieldError {
	var fields []model.FieldError
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if rc := utf8.RuneCountInString(name); rc < cohortNameMinLen || rc > cohortNameMaxLen {
			fields = append(fields, model.FieldError{
				Field: "name", Code: "INVALID_NAME",
				Message: fmt.Sprintf("name must be %d–%d characters", cohortNameMinLen, cohortNameMaxLen),
			})
		}
	}
	fields = appendScalarClassFieldErrors(fields, in.PrimarySkill, in.Capacity, in.SessionCount, in.TargetBand)
	if in.PendingTeacherEmail != nil {
		if _, err := mail.ParseAddress(*in.PendingTeacherEmail); err != nil {
			fields = append(fields, model.FieldError{
				Field: "pendingTeacherEmail", Code: "INVALID_TEACHER_EMAIL", Message: "invalid email address",
			})
		}
	}
	return fields
}

// appendScalarClassFieldErrors validates the fields shared by create + update.
func appendScalarClassFieldErrors(
	fields []model.FieldError, primarySkill *string, capacity, sessionCount *int32, targetBand *float64,
) []model.FieldError {
	if primarySkill != nil && !validPrimarySkills[*primarySkill] {
		fields = append(fields, model.FieldError{
			Field: "primarySkill", Code: "INVALID_PRIMARY_SKILL", Message: "unknown primary skill",
		})
	}
	if capacity != nil && *capacity <= 0 {
		fields = append(fields, model.FieldError{
			Field: "capacity", Code: "INVALID_CAPACITY", Message: "capacity must be greater than 0",
		})
	}
	if sessionCount != nil && *sessionCount <= 0 {
		fields = append(fields, model.FieldError{
			Field: "sessionCount", Code: "INVALID_SESSION_COUNT", Message: "sessionCount must be greater than 0",
		})
	}
	if targetBand != nil && (*targetBand < classTargetBandMin || *targetBand > classTargetBandMax) {
		fields = append(fields, model.FieldError{
			Field: "targetBand", Code: "INVALID_TARGET_BAND",
			Message: fmt.Sprintf("targetBand must be between %g and %g", classTargetBandMin, classTargetBandMax),
		})
	}
	return fields
}

// classFKViolationError maps a Postgres foreign-key violation (SQLSTATE 23503)
// on a class INSERT/UPDATE to a 422 ValidationError naming the offending field,
// so a well-formed-but-nonexistent teacherId/templateId is a client validation
// failure rather than a 500 (CR-3-1 review, decision → option b). Membership +
// center-scope checks on those references are out of scope this story
// (CR-3-1-5, Epic 7). Returns nil for any non-23503 error.
func classFKViolationError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != fkViolationPgErrorCode {
		return nil
	}
	field, code := "reference", "INVALID_REFERENCE"
	switch pgErr.ConstraintName {
	case "classes_teacher_id_fkey":
		field, code = "teacherId", "INVALID_TEACHER_ID"
	case "classes_template_id_fkey":
		field, code = "templateId", "INVALID_TEMPLATE_ID"
	}
	return model.ValidationError{Fields: []model.FieldError{{
		Field: field, Code: code, Message: "referenced record does not exist",
	}}}
}

// --- optional-field pgtype converters ---

func optText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// optTextTrimmed is optText with a leading/trailing whitespace trim — used for
// the name on Update so the stored value matches Create (which trims at insert)
// rather than persisting the padded input a validated rune-count accepted.
func optTextTrimmed(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: strings.TrimSpace(*s), Valid: true}
}

func optInt4(i *int32) pgtype.Int4 {
	if i == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *i, Valid: true}
}

func optBool(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}

func optUUID(id *uuid.UUID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return pgUUID(*id)
}

func optDate(t *time.Time) pgtype.Date {
	if t == nil {
		return pgtype.Date{}
	}
	return pgtype.Date{Time: *t, Valid: true}
}

func optNumeric(f *float64) (pgtype.Numeric, error) {
	if f == nil {
		return pgtype.Numeric{}, nil
	}
	return floatToNumeric(*f)
}

// --- audit snapshot ---

// classAuditSnapshot renders the forensically-useful class fields for a
// class.created / class.updated audit row. Invalid (NULL) pgtype values render
// as JSON null (explicit-null discipline, GO-5 in spirit).
func classAuditSnapshot(c generated.Class) map[string]any {
	return map[string]any{
		"name":                  c.Name,
		"status":                c.Status,
		"template_id":           uuidOrNil(c.TemplateID),
		"teacher_id":            uuidOrNil(c.TeacherID),
		"pending_teacher_email": textOrNil(c.PendingTeacherEmail),
		"description":           textOrNil(c.Description),
		"target_band":           numericOrNil(c.TargetBand),
		"primary_skill":         textOrNil(c.PrimarySkill),
		"session_count":         int4OrNil(c.SessionCount),
		"capacity":              int4OrNil(c.Capacity),
		"due_dates_enabled":     c.DueDatesEnabled,
		"start_date":            dateOrNil(c.StartDate),
		"end_date":              dateOrNil(c.EndDate),
		"color":                 textOrNil(c.Color),
	}
}

func textOrNil(t pgtype.Text) any {
	if !t.Valid {
		return nil
	}
	return t.String
}

func int4OrNil(i pgtype.Int4) any {
	if !i.Valid {
		return nil
	}
	return i.Int32
}

func uuidOrNil(u pgtype.UUID) any {
	if !u.Valid {
		return nil
	}
	return uuidStringFromPg(u)
}

func dateOrNil(d pgtype.Date) any {
	if !d.Valid {
		return nil
	}
	return d.Time.Format("2006-01-02")
}

func numericOrNil(n pgtype.Numeric) any {
	if !n.Valid {
		return nil
	}
	f, err := numericToFloat(n)
	if err != nil {
		return nil
	}
	return f
}
