// Package service — Story 3.5b AttendanceService.
//
// Attendance is per-session, per-student presence (present/late/absent) over the
// class's ACTIVE enrollments. This service owns the roster read + single/bulk
// UPSERT. It is modeled 1:1 on SessionContentService (readInTenantTx /
// mutateInTenantTx / authorizeSession) but adds the roster join + UPSERT + bulk
// atomicity, and deliberately keeps NO audit logging (D10 — the on-row marked_by
// + updated_at ARE the audit trail; a per-mark audit row would drown the
// staff/student activity feeds).
//
// Authz (SEC-1, service-layer — never RLS), identical to session content:
//   - assertClassRole gates owner/admin/teacher (a student is 403
//     INSUFFICIENT_ROLE — the route sessionChain has NO RequireRole).
//   - the parent session loads under the tenant tx; RLS scopes it to the caller's
//     center, so a foreign session reads as ErrNoRows → 404. assertSessionTeacher
//     Scope then 404s a teacher-not-of-this-class (teacher-sees-nothing).
//   - class_id is DERIVED from the session in-tx (GetSessionByID) — never trusted
//     from the client.
//
// No status/time gate — attendance is recordable on past AND cancelled sessions
// (D14), mirroring the session-content sibling.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// AttendanceService owns the per-session attendance roster + recording.
type AttendanceService struct {
	db AuthDB
}

// NewAttendanceService constructs an AttendanceService bound to the DB pool. No
// audit logger (D10) and no clock seam — recording is time-agnostic.
func NewAttendanceService(db AuthDB) *AttendanceService {
	return &AttendanceService{db: db}
}

// AttendanceEntry is one roster row: the active-enrolled student's display
// fields plus their recorded status/markedAt (both null when unmarked). It
// carries the pg-native nullable types so the handler reuses the shared
// textPgToPtr / tstzPgToPtr converters.
type AttendanceEntry struct {
	StudentID pgtype.UUID
	Name      string
	Email     string
	Status    pgtype.Text
	MarkedAt  pgtype.Timestamptz
}

func rosterRowToEntry(r generated.ListAttendanceRosterBySessionRow) AttendanceEntry {
	return AttendanceEntry{StudentID: r.StudentID, Name: r.StudentName, Email: r.StudentEmail, Status: r.Status, MarkedAt: r.MarkedAt}
}

func studentRowToEntry(r generated.GetAttendanceEntryForStudentRow) AttendanceEntry {
	return AttendanceEntry{StudentID: r.StudentID, Name: r.StudentName, Email: r.StudentEmail, Status: r.Status, MarkedAt: r.MarkedAt}
}

// attendanceNotEnrolled is the canonical 422 for a target studentId that is not
// an active enrollment of the session's class (AC7/AC9).
func attendanceNotEnrolled(studentID uuid.UUID) error {
	return &AttendanceNotEnrolledError{StudentID: studentID.String()}
}

// withTenantTx opens a tenant-scoped tx (SET LOCAL app.current_tenant_id — a tx
// is required even for reads, PERF-1), runs fn, and commits. Attendance has no
// audit write, so reads and mutations share one helper.
func (s *AttendanceService) withTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("attendance tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("attendance tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// authorizeSession runs the role + tenant + teacher-scope gate against the parent
// session inside an open tx and returns (centerID, classID) for the denormalized
// write + the roster join. class_id is taken from the session row, never the
// client.
func (s *AttendanceService) authorizeSession(
	ctx context.Context, txQ *generated.Queries, tc model.TenantContext, sessionID uuid.UUID,
) (centerID, classID uuid.UUID, err error) {
	if err := assertClassRole(tc); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	row, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, uuid.Nil, sessionNotFound(sessionID)
		}
		return uuid.Nil, uuid.Nil, fmt.Errorf("authorize session: load: %w", err)
	}
	if err := assertSessionTeacherScope(tc, row.ClassTeacherID, sessionID); err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return centerUUID, uuidFromPg(row.ClassID), nil
}

// callerUUID resolves the acting user id (marked_by, NOT NULL). A malformed
// tenant context is a 403 rather than a NOT NULL violation at the DB.
func callerUUID(tc model.TenantContext) (uuid.UUID, error) {
	id, err := uuid.Parse(tc.UserID)
	if err != nil {
		return uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	return id, nil
}

// GetRoster returns every active enrollment of the session's class with its
// status/markedAt or null (AC4).
func (s *AttendanceService) GetRoster(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID,
) ([]AttendanceEntry, error) {
	var out []AttendanceEntry
	err := s.withTenantTx(ctx, tc, func(q *generated.Queries) error {
		_, classID, err := s.authorizeSession(ctx, q, tc, sessionID)
		if err != nil {
			return err
		}
		rows, err := q.ListAttendanceRosterBySession(ctx, generated.ListAttendanceRosterBySessionParams{
			SessionID: pgUUID(sessionID),
			ClassID:   pgUUID(classID),
		})
		if err != nil {
			return fmt.Errorf("list attendance roster: %w", err)
		}
		out = make([]AttendanceEntry, len(rows))
		for i, r := range rows {
			out[i] = rosterRowToEntry(r)
		}
		return nil
	})
	return out, err
}

// SetOne records one student's attendance (AC6/AC7). The studentId must be an
// active enrollment of the class (else 422 NOT_ENROLLED) — validated BEFORE the
// upsert. Returns the updated roster entry.
func (s *AttendanceService) SetOne(
	ctx context.Context, tc model.TenantContext, sessionID, studentID uuid.UUID, status string,
) (AttendanceEntry, error) {
	var out AttendanceEntry
	err := s.withTenantTx(ctx, tc, func(q *generated.Queries) error {
		centerID, classID, err := s.authorizeSession(ctx, q, tc, sessionID)
		if err != nil {
			return err
		}
		markedBy, err := callerUUID(tc)
		if err != nil {
			return err
		}
		if _, err := q.GetActiveEnrollment(ctx, generated.GetActiveEnrollmentParams{
			ClassID:   pgUUID(classID),
			StudentID: pgUUID(studentID),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return attendanceNotEnrolled(studentID)
			}
			return fmt.Errorf("validate enrollment: %w", err)
		}
		if _, err := q.UpsertAttendance(ctx, generated.UpsertAttendanceParams{
			CenterID:  pgUUID(centerID),
			SessionID: pgUUID(sessionID),
			StudentID: pgUUID(studentID),
			Status:    status,
			MarkedBy:  pgUUID(markedBy),
		}); err != nil {
			return fmt.Errorf("upsert attendance: %w", err)
		}
		entry, err := q.GetAttendanceEntryForStudent(ctx, generated.GetAttendanceEntryForStudentParams{
			SessionID: pgUUID(sessionID),
			ClassID:   pgUUID(classID),
			StudentID: pgUUID(studentID),
		})
		if err != nil {
			return fmt.Errorf("read back attendance entry: %w", err)
		}
		out = studentRowToEntry(entry)
		return nil
	})
	return out, err
}

// BulkMark upserts many students to one status atomically (AC8/AC9). With no
// studentIDs, targets every active-enrolled student of the class. With
// studentIDs, EVERY id must be an active enrollment — validated in full BEFORE
// the first upsert (validate-all-before-write, D6), so one bad id rejects the
// whole batch with zero writes. Returns the full refreshed roster.
func (s *AttendanceService) BulkMark(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, status string, studentIDs []uuid.UUID,
) ([]AttendanceEntry, error) {
	var out []AttendanceEntry
	err := s.withTenantTx(ctx, tc, func(q *generated.Queries) error {
		centerID, classID, err := s.authorizeSession(ctx, q, tc, sessionID)
		if err != nil {
			return err
		}
		markedBy, err := callerUUID(tc)
		if err != nil {
			return err
		}

		roster, err := q.ListEnrolledStudentsByClass(ctx, pgUUID(classID))
		if err != nil {
			return fmt.Errorf("resolve active roster: %w", err)
		}
		active := make(map[uuid.UUID]struct{}, len(roster))
		for _, r := range roster {
			active[uuidFromPg(r.StudentID)] = struct{}{}
		}

		// Resolve targets. Empty/omitted → all active students; else the given
		// ids, EVERY one validated against the active set FIRST (D6).
		var targets []uuid.UUID
		if len(studentIDs) == 0 {
			targets = make([]uuid.UUID, 0, len(active))
			for id := range active {
				targets = append(targets, id)
			}
		} else {
			for _, id := range studentIDs {
				if _, ok := active[id]; !ok {
					return attendanceNotEnrolled(id)
				}
			}
			targets = studentIDs
		}

		for _, id := range targets {
			if _, err := q.UpsertAttendance(ctx, generated.UpsertAttendanceParams{
				CenterID:  pgUUID(centerID),
				SessionID: pgUUID(sessionID),
				StudentID: pgUUID(id),
				Status:    status,
				MarkedBy:  pgUUID(markedBy),
			}); err != nil {
				return fmt.Errorf("bulk upsert attendance: %w", err)
			}
		}

		rows, err := q.ListAttendanceRosterBySession(ctx, generated.ListAttendanceRosterBySessionParams{
			SessionID: pgUUID(sessionID),
			ClassID:   pgUUID(classID),
		})
		if err != nil {
			return fmt.Errorf("refresh attendance roster: %w", err)
		}
		out = make([]AttendanceEntry, len(rows))
		for i, r := range rows {
			out[i] = rosterRowToEntry(r)
		}
		return nil
	})
	return out, err
}
