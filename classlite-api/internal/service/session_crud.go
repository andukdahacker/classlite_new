// Session CRUD + recurrence + scoped mutations (Story 3.4). Shares
// SessionService's tenant-tx/audit ceremony with the rest of the service layer.
// The R19 past-immutable floor + optimistic 409 live in loadTarget/resolveScope
// (session.go) and the …InScope queries (sessions.sql).
package service

import (
	"context"
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ListSessions returns sessions with starts_at in the half-open [from, to)
// window, role-scoped (owner/admin center-wide; teacher → own classes only, so
// another teacher's sessions are ABSENT from the array, not hidden). The window
// is capped at maxScheduleRangeDays.
func (s *SessionService) ListSessions(
	ctx context.Context, tc model.TenantContext, from, to time.Time, classID *uuid.UUID,
) ([]generated.ListSessionsByRangeRow, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	if !to.After(from) {
		return nil, model.ValidationError{Fields: []model.FieldError{{
			Field: "to", Code: "INVALID_RANGE", Message: "to must be after from",
		}}}
	}
	if to.Sub(from) > time.Duration(maxScheduleRangeDays)*24*time.Hour {
		return nil, &ScheduleRangeTooWideError{MaxDays: maxScheduleRangeDays}
	}

	params := generated.ListSessionsByRangeParams{
		FromTs:  pgtype.Timestamptz{Time: from, Valid: true},
		ToTs:    pgtype.Timestamptz{Time: to, Valid: true},
		ClassID: optUUID(classID),
	}
	// Teacher predicate — owner/admin pass NULL to bypass.
	if tc.Role == model.RoleTeacher {
		callerID, err := uuid.Parse(tc.UserID)
		if err != nil {
			return nil, fmt.Errorf("list sessions: parse caller id: %w", err)
		}
		params.TeacherID = pgUUID(callerID)
	}

	var out []generated.ListSessionsByRangeRow
	err := s.readInTenantTx(ctx, tc, func(txQ *generated.Queries) error {
		rows, err := txQ.ListSessionsByRange(ctx, params)
		if err != nil {
			return fmt.Errorf("list sessions: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// ListSessionsByClass returns a single class's sessions in [from, to) for the
// class-detail Sessions tab. Teacher-scope is enforced against the class.
func (s *SessionService) ListSessionsByClass(
	ctx context.Context, tc model.TenantContext, classID uuid.UUID, from, to time.Time,
) ([]generated.ListSessionsByClassRow, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	var out []generated.ListSessionsByClassRow
	err := s.readInTenantTx(ctx, tc, func(txQ *generated.Queries) error {
		class, err := txQ.GetClassByID(ctx, pgUUID(classID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return classNotFound(classID)
			}
			return fmt.Errorf("list sessions by class: get class: %w", err)
		}
		if err := assertTeacherScope(tc, class, classID); err != nil {
			return err
		}
		rows, err := txQ.ListSessionsByClass(ctx, generated.ListSessionsByClassParams{
			ClassID: pgUUID(classID),
			FromTs:  pgtype.Timestamptz{Time: from, Valid: true},
			ToTs:    pgtype.Timestamptz{Time: to, Valid: true},
		})
		if err != nil {
			return fmt.Errorf("list sessions by class: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// GetSession returns a single session + its series counts (the scope-UI oracle).
func (s *SessionService) GetSession(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID,
) (generated.GetSessionByIDRow, SeriesCounts, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.GetSessionByIDRow{}, SeriesCounts{}, err
	}
	now := s.clk.Now()
	var row generated.GetSessionByIDRow
	var counts SeriesCounts
	err := s.readInTenantTx(ctx, tc, func(txQ *generated.Queries) error {
		r, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionNotFound(sessionID)
			}
			return fmt.Errorf("get session: %w", err)
		}
		if err := assertSessionTeacherScope(tc, r.ClassTeacherID, sessionID); err != nil {
			return err
		}
		row = r
		counts, err = seriesCountsFor(ctx, txQ, r, now)
		return err
	})
	return row, counts, err
}

// seriesCountsFor returns the total/upcoming/completed counts for the row's
// series, or a one-off {total:1} when the row has no recurrence group.
func seriesCountsFor(
	ctx context.Context, txQ *generated.Queries, row generated.GetSessionByIDRow, now time.Time,
) (SeriesCounts, error) {
	if !row.RecurrenceGroupID.Valid {
		counts := SeriesCounts{Total: 1}
		if row.StartsAt.Valid && row.StartsAt.Time.Before(now) {
			counts.Completed = 1
		} else {
			counts.Upcoming = 1
		}
		return counts, nil
	}
	groupUUID := uuid.UUID(row.RecurrenceGroupID.Bytes)
	agg, err := txQ.GetSessionSeriesCounts(ctx, generated.GetSessionSeriesCountsParams{
		NowTs:   pgtype.Timestamptz{Time: now, Valid: true},
		GroupID: row.RecurrenceGroupID,
	})
	if err != nil {
		return SeriesCounts{}, fmt.Errorf("get session series counts: %w", err)
	}
	return SeriesCounts{
		GroupID:   &groupUUID,
		Total:     agg.Total,
		Upcoming:  agg.Upcoming,
		Completed: agg.Completed,
	}, nil
}

// CreateSessions materializes 1 (one-off) or N (recurrence) rows sharing one
// recurrence_group_id in a single tx, stamps recurrence_tz, and writes one
// session.created audit row. Recurring REQUIRES an endDate and is capped.
func (s *SessionService) CreateSessions(
	ctx context.Context, tc model.TenantContext, in CreateSessionInput,
) (CreateSessionsResult, error) {
	if err := assertClassRole(tc); err != nil {
		return CreateSessionsResult{}, err
	}
	if fields := validateCreateSession(&in); len(fields) > 0 {
		return CreateSessionsResult{}, model.ValidationError{Fields: fields}
	}

	spec, verr := resolveRecurrence(in)
	if verr != nil {
		return CreateSessionsResult{}, verr
	}
	occurrences := generateOccurrences(in.StartsAt, spec)
	if len(occurrences) == 0 {
		// weekly/custom whose weekdays never fall in [startsAt, endDate] would
		// otherwise insert 0 rows and 500 on the first-occurrence re-read (CR-3-4 P3).
		return CreateSessionsResult{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "recurrence.weekdays", Code: "RECURRENCE_NO_OCCURRENCES",
			Message: "no session dates fall within the recurrence range",
		}}}
	}
	if len(occurrences) > maxRecurrenceOccurrences {
		return CreateSessionsResult{}, &RecurrenceLimitExceededError{
			Cap:              maxRecurrenceOccurrences,
			MaxReachableDate: occurrences[maxRecurrenceOccurrences-1].Format("2006-01-02"),
		}
	}

	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return CreateSessionsResult{}, fmt.Errorf("create session: parse center id: %w", err)
	}

	var groupID pgtype.UUID
	var pattern pgtype.Text
	var groupPtr *uuid.UUID
	if spec.Pattern != recurrenceNone {
		g := model.NewID()
		groupID = pgUUID(g)
		groupPtr = &g
		pattern = pgtype.Text{String: spec.Pattern, Valid: true}
	}
	duration := time.Duration(in.DurationMinutes) * time.Minute

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return CreateSessionsResult{}, fmt.Errorf("create session: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return CreateSessionsResult{}, fmt.Errorf("create session: %w", err)
	}
	txQ := generated.New(tx)

	// Teacher-scope: a teacher may only schedule sessions for a class assigned
	// to them (else the class is invisible → CLASS_NOT_FOUND).
	class, err := txQ.GetClassByID(ctx, pgUUID(in.ClassID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return CreateSessionsResult{}, classNotFound(in.ClassID)
		}
		return CreateSessionsResult{}, fmt.Errorf("create session: get class: %w", err)
	}
	if err := assertTeacherScope(tc, class, in.ClassID); err != nil {
		return CreateSessionsResult{}, err
	}

	var firstID pgtype.UUID
	for i, occ := range occurrences {
		row, err := txQ.CreateSession(ctx, generated.CreateSessionParams{
			ID:                pgUUID(model.NewID()),
			CenterID:          pgUUID(centerUUID),
			ClassID:           pgUUID(in.ClassID),
			Topic:             optText(in.Topic),
			StartsAt:          pgtype.Timestamptz{Time: occ, Valid: true},
			EndsAt:            pgtype.Timestamptz{Time: occ.Add(duration), Valid: true},
			RecurrenceTz:      appScheduleTZ,
			RecurrenceGroupID: groupID,
			RecurrencePattern: pattern,
		})
		if err != nil {
			return CreateSessionsResult{}, fmt.Errorf("create session: insert occurrence %d: %w", i, err)
		}
		if i == 0 {
			firstID = row.ID
		}
	}

	// Re-read the first occurrence with the class JOIN for the response DTO.
	first, err := txQ.GetSessionByID(ctx, firstID)
	if err != nil {
		return CreateSessionsResult{}, fmt.Errorf("create session: re-read first: %w", err)
	}

	changes := Changes{Before: nil, After: map[string]any{
		"recurrence_group_id": uuidOrNil(groupID),
		"count":               len(occurrences),
		"class_id":            in.ClassID.String(),
		"starts_at":           in.StartsAt.Format(time.RFC3339Nano),
	}}
	if err := s.audit.LogWithinTx(ctx, tx, tc, sessionCreatedAction, sessionAuditEntity, uuid.UUID(firstID.Bytes), changes); err != nil {
		return CreateSessionsResult{}, fmt.Errorf("create session: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return CreateSessionsResult{}, fmt.Errorf("create session: commit: %w", err)
	}

	return CreateSessionsResult{RecurrenceGroupID: groupPtr, Count: len(occurrences), First: first}, nil
}

// UpdateSessions applies a scoped, past-immutable, optimistic field edit and
// returns the (re-read) target row.
func (s *SessionService) UpdateSessions(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, in UpdateSessionInput,
) (generated.GetSessionByIDRow, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.GetSessionByIDRow{}, err
	}
	if fields := validateUpdateSession(&in); len(fields) > 0 {
		return generated.GetSessionByIDRow{}, model.ValidationError{Fields: fields}
	}
	now := s.clk.Now()

	var out generated.GetSessionByIDRow
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		target, err := s.loadTarget(ctx, txQ, tc, sessionID, in.ExpectedUpdatedAt)
		if err != nil {
			return err
		}
		scope, err := resolveScope(target, in.ApplyScope, now)
		if err != nil {
			return err
		}
		// Reparent target must be validated like create: the class must exist,
		// be in-tenant (RLS), and — for teachers — be assigned to the caller;
		// else a teacher could move a session to a class they don't teach or to
		// an arbitrary class UUID (CR-3-4 P2).
		if in.ClassID != nil {
			class, err := txQ.GetClassByID(ctx, pgUUID(*in.ClassID))
			if err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return classNotFound(*in.ClassID)
				}
				return fmt.Errorf("update session: get target class: %w", err)
			}
			if err := assertTeacherScope(tc, class, *in.ClassID); err != nil {
				return err
			}
		}
		before := sessionRowSnapshot(target)
		var startsAt pgtype.Timestamptz
		if in.StartsAt != nil {
			startsAt = pgtype.Timestamptz{Time: *in.StartsAt, Valid: true}
		}
		affected, err := txQ.UpdateSessionsInScope(ctx, generated.UpdateSessionsInScopeParams{
			Topic:           optText(in.Topic),
			ClassID:         optUUID(in.ClassID),
			StartsAt:        startsAt,
			DurationMinutes: optInt4(in.DurationMinutes),
			NowFloor:        pgtype.Timestamptz{Time: now, Valid: true},
			Scope:           scope,
			TargetID:        pgUUID(sessionID),
			GroupID:         target.RecurrenceGroupID,
			TargetStartsAt:  target.StartsAt,
		})
		if err != nil {
			return fmt.Errorf("update sessions in scope: %w", err)
		}
		if len(affected) == 0 {
			// The scope+floor set is empty (e.g. a past-anchored future/all): the
			// mutation touched nothing. Report it rather than a misleading 200 +
			// affected:0 audit row (CR-3-4 D2).
			return &SessionAlreadyStartedError{}
		}
		updated, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
		if err != nil {
			return fmt.Errorf("update session: re-read: %w", err)
		}
		out = updated
		changes := Changes{Before: before, After: map[string]any{
			"scope": scope, "affected": len(affected), "topic": textOrNil(updated.Topic),
			"starts_at": timestamptzOrNil(updated.StartsAt),
		}}
		return s.audit.LogWithinTx(ctx, tx, tc, sessionUpdatedAction, sessionAuditEntity, sessionID, changes)
	})
	return out, err
}

// CancelSessions marks the scoped, non-past set cancelled (keeps rows, FR-17)
// and returns the (re-read) target row.
func (s *SessionService) CancelSessions(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, in CancelSessionInput,
) (generated.GetSessionByIDRow, error) {
	if err := assertClassRole(tc); err != nil {
		return generated.GetSessionByIDRow{}, err
	}
	if !validScope(in.ApplyScope) {
		return generated.GetSessionByIDRow{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "applyScope", Code: "INVALID_SCOPE", Message: "applyScope must be this, future, or all",
		}}}
	}
	now := s.clk.Now()

	var out generated.GetSessionByIDRow
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		target, err := s.loadTarget(ctx, txQ, tc, sessionID, in.ExpectedUpdatedAt)
		if err != nil {
			return err
		}
		scope, err := resolveScope(target, in.ApplyScope, now)
		if err != nil {
			return err
		}
		before := sessionRowSnapshot(target)
		affected, err := txQ.CancelSessionsInScope(ctx, generated.CancelSessionsInScopeParams{
			NowFloor:       pgtype.Timestamptz{Time: now, Valid: true},
			Scope:          scope,
			TargetID:       pgUUID(sessionID),
			GroupID:        target.RecurrenceGroupID,
			TargetStartsAt: target.StartsAt,
		})
		if err != nil {
			return fmt.Errorf("cancel sessions in scope: %w", err)
		}
		if len(affected) == 0 {
			// Nothing in the scope+floor set (past-anchored, or all already
			// cancelled): a no-op cancel is reported, not a silent 200 (CR-3-4 D2).
			return &SessionAlreadyStartedError{}
		}
		updated, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
		if err != nil {
			return fmt.Errorf("cancel session: re-read: %w", err)
		}
		out = updated
		changes := Changes{Before: before, After: map[string]any{"scope": scope, "affected": len(affected), "status": updated.Status}}
		return s.audit.LogWithinTx(ctx, tx, tc, sessionCancelledAction, sessionAuditEntity, sessionID, changes)
	})
	return out, err
}

// DeleteSessions hard-deletes the scoped, non-past set (204). expectedUpdatedAt
// is optional (absent skips the optimistic guard).
func (s *SessionService) DeleteSessions(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, scope string, expectedUpdatedAt *time.Time,
) error {
	if err := assertClassRole(tc); err != nil {
		return err
	}
	if !validScope(scope) {
		return model.ValidationError{Fields: []model.FieldError{{
			Field: "scope", Code: "INVALID_SCOPE", Message: "scope must be this, future, or all",
		}}}
	}
	now := s.clk.Now()

	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		// Lock the target first so the optimistic guard is atomic (CR-3-4 P4).
		if _, err := txQ.LockSession(ctx, pgUUID(sessionID)); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionNotFound(sessionID)
			}
			return fmt.Errorf("delete session: lock target: %w", err)
		}
		target, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionNotFound(sessionID)
			}
			return fmt.Errorf("delete session: get target: %w", err)
		}
		if err := assertSessionTeacherScope(tc, target.ClassTeacherID, sessionID); err != nil {
			return err
		}
		// Required after authz/visibility so a student→403 / cross-teacher→404
		// isn't masked by a 422 (AC2; CR-3-4 P10).
		if expectedUpdatedAt == nil {
			return model.ValidationError{Fields: []model.FieldError{{
				Field: "expectedUpdatedAt", Code: "REQUIRED", Message: "expectedUpdatedAt is required",
			}}}
		}
		if !target.UpdatedAt.Valid || !target.UpdatedAt.Time.Equal(*expectedUpdatedAt) {
			return sessionConflict()
		}
		resolvedScope, err := resolveScope(target, scope, now)
		if err != nil {
			return err
		}
		before := sessionRowSnapshot(target)
		affected, err := txQ.DeleteSessionsInScope(ctx, generated.DeleteSessionsInScopeParams{
			NowFloor:       pgtype.Timestamptz{Time: now, Valid: true},
			Scope:          resolvedScope,
			TargetID:       pgUUID(sessionID),
			GroupID:        target.RecurrenceGroupID,
			TargetStartsAt: target.StartsAt,
		})
		if err != nil {
			return fmt.Errorf("delete sessions in scope: %w", err)
		}
		if len(affected) == 0 {
			// Empty scope+floor set (past-anchored): nothing deleted → report it
			// rather than a misleading 204 (CR-3-4 D2).
			return &SessionAlreadyStartedError{}
		}
		changes := Changes{Before: before, After: map[string]any{"scope": resolvedScope, "deleted": len(affected)}}
		return s.audit.LogWithinTx(ctx, tx, tc, sessionDeletedAction, sessionAuditEntity, sessionID, changes)
	})
}

// --- recurrence + validation ---

// resolveRecurrence validates the recurrence sub-object and returns the spec.
// Recurring patterns require an endDate that is not before the start.
func resolveRecurrence(in CreateSessionInput) (RecurrenceSpec, error) {
	pattern := in.Recurrence.Pattern
	if pattern == "" {
		pattern = recurrenceNone
	}
	switch pattern {
	case recurrenceNone:
		return RecurrenceSpec{Pattern: recurrenceNone}, nil
	case recurrenceDaily, recurrenceWeekly, recurrenceCustom:
	default:
		return RecurrenceSpec{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "recurrence.pattern", Code: "INVALID_RECURRENCE_PATTERN", Message: "unknown recurrence pattern",
		}}}
	}
	if in.Recurrence.EndDate == nil {
		return RecurrenceSpec{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "recurrence.endDate", Code: "RECURRENCE_ENDDATE_REQUIRED", Message: "a recurring session requires an end date",
		}}}
	}
	end := *in.Recurrence.EndDate
	if end.Before(dateOnly(in.StartsAt)) {
		return RecurrenceSpec{}, model.ValidationError{Fields: []model.FieldError{{
			Field: "recurrence.endDate", Code: "RECURRENCE_ENDDATE_BEFORE_START", Message: "end date is before the start date",
		}}}
	}
	return RecurrenceSpec{Pattern: pattern, Weekdays: in.Recurrence.Weekdays, EndDate: end}, nil
}

// dateOnly truncates a time to its calendar date (UTC-agnostic day comparison).
func dateOnly(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func validateCreateSession(in *CreateSessionInput) []model.FieldError {
	var fields []model.FieldError
	if in.Topic != nil && utf8.RuneCountInString(*in.Topic) > sessionTopicMaxLen {
		fields = append(fields, model.FieldError{Field: "topic", Code: "INVALID_TOPIC", Message: "topic too long"})
	}
	if in.DurationMinutes <= 0 || in.DurationMinutes > sessionMaxDurationMinutes {
		fields = append(fields, model.FieldError{Field: "durationMinutes", Code: "INVALID_DURATION", Message: "durationMinutes must be between 1 and 1440"})
	}
	if in.StartsAt.IsZero() {
		fields = append(fields, model.FieldError{Field: "startsAt", Code: "INVALID_STARTS_AT", Message: "startsAt is required"})
	}
	for _, w := range in.Recurrence.Weekdays {
		if w < 0 || w > 6 {
			fields = append(fields, model.FieldError{Field: "recurrence.weekdays", Code: "INVALID_WEEKDAY", Message: "weekdays must be 0–6"})
			break
		}
	}
	return fields
}

func validateUpdateSession(in *UpdateSessionInput) []model.FieldError {
	var fields []model.FieldError
	if !validScope(in.ApplyScope) {
		fields = append(fields, model.FieldError{Field: "applyScope", Code: "INVALID_SCOPE", Message: "applyScope must be this, future, or all"})
	}
	if in.Topic != nil && utf8.RuneCountInString(*in.Topic) > sessionTopicMaxLen {
		fields = append(fields, model.FieldError{Field: "topic", Code: "INVALID_TOPIC", Message: "topic too long"})
	}
	if in.DurationMinutes != nil && (*in.DurationMinutes <= 0 || *in.DurationMinutes > sessionMaxDurationMinutes) {
		fields = append(fields, model.FieldError{Field: "durationMinutes", Code: "INVALID_DURATION", Message: "durationMinutes must be between 1 and 1440"})
	}
	// A startsAt edit is a per-occurrence move — applying one absolute instant
	// across a future/all scope would collapse the whole series onto it, so
	// startsAt is only editable with scope 'this' (CR-3-4 D1). Moving a session
	// out of / re-spacing a series is out of scope (create-time only).
	if in.StartsAt != nil && in.ApplyScope != scopeThis {
		fields = append(fields, model.FieldError{Field: "startsAt", Code: "INVALID_STARTS_AT_SCOPE", Message: "startsAt can only be edited with applyScope 'this'"})
	}
	return fields
}
