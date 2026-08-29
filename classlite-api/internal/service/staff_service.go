// Package service — Story 7.1a StaffService: the staff roster read model
// (list + detail) and the three Owner-only actions (archive / assign-class /
// reset-password). Force-logout is NOT here — it already ships as
// AuthService.ForceLogout (D8, reuse); 7-1b wires the button.
//
// Seams honored:
//   - Every read/write runs inside a `SET LOCAL app.current_tenant_id` tx so
//     RLS tenant-scopes center_members / classes / sessions / invites /
//     audit_logs (GO-1 / PERF-1). A cross-tenant target is invisible → 404 /
//     0-row no-op, never a leak (AC17/AC18).
//   - The three actions re-fetch the caller's center_members.role == owner from
//     the DB (SEC-1, D8) — the JWT claim is never trusted for a mutating call.
//   - Staff-action audits go to `audit_logs` via AuditService (entity_type
//     `center_member`), NEVER `auth_audit_logs` (D15) — so they can feed the
//     detail recentActivity block.
//   - Owner-reset reuses only the password-reset PRIMITIVES (token mint/hash,
//     CreatePasswordReset, RenderPasswordResetEmail, retry.Enqueue) with NO
//     verified-gate / silent-return / padToFloor (D14) — those exist for the
//     public anti-enumeration path and would make an Owner reset silently
//     no-op on an unverified/pre-provisioned member.
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Staff load + activity constants (CQ-3 — no magic values). HeavyLoadThreshold
// and LoadWindowDays are passed into queries/staff.sql as bound args so the
// roster's `heavy` column and load window derive from these consts alone — one
// source of truth, no SQL/Go literal drift.
const (
	// DefaultWeeklySessionCapacity is the fixed capacity every teacher's load
	// meter is measured against (no per-teacher capacity in v1).
	DefaultWeeklySessionCapacity = 10
	// HeavyLoadThresholdSessionsPerWeek is the next-7-days scheduled-session
	// count at or above which a teacher's load is flagged "heavy".
	HeavyLoadThresholdSessionsPerWeek = 8
	// LoadWindowDays is the rolling window width for the next-7-days load count.
	LoadWindowDays = 7
	// RecentActivityLimit caps the detail recentActivity feed.
	RecentActivityLimit = 20
	// ScheduleGlanceLimit caps the detail scheduleGlance list.
	ScheduleGlanceLimit = 5
	// ScheduleGlanceWindowDays bounds how far ahead scheduleGlance looks.
	ScheduleGlanceWindowDays = 30
)

// staffStatusArchived is the derived 'archived' status (the CASE in
// queries/staff.sql: archived_at IS NOT NULL). Used to reject mutating actions
// against a deactivated member.
const staffStatusArchived = "archived"

// StaffLoad is the load-meter payload (D16 — a NEXT-7-DAYS sliding window count,
// deliberately NOT labelled "weekly").
type StaffLoad struct {
	NextSevenDaysSessionCount int
	WeeklyCapacity            int
	Heavy                     bool
}

// StaffMemberView is one accepted staff member in the roster (AC1).
type StaffMemberView struct {
	UserID          uuid.UUID
	Name            string
	Email           string
	AvatarURL       *string
	Role            string
	Status          string // "active" | "archived"
	ClassesAssigned int
	Load            StaffLoad
	LastActiveAt    *time.Time
}

// PendingInviteView is one unaccepted staff invite in the roster (AC1).
type PendingInviteView struct {
	InviteID       uuid.UUID
	Name           *string
	Email          string
	Role           string
	InvitedAt      time.Time
	ExpiresAt      time.Time
	PendingClassID *uuid.UUID
}

// StaffRoster is the split-object list response (D3).
type StaffRoster struct {
	Members        []StaffMemberView
	PendingInvites []PendingInviteView
}

// StaffAssignedClass is one class a teacher owns (detail).
type StaffAssignedClass struct {
	ClassID uuid.UUID
	Name    string
}

// StaffScheduleGlanceItem is one upcoming scheduled session (detail, D9).
type StaffScheduleGlanceItem struct {
	SessionID uuid.UUID
	ClassID   uuid.UUID
	ClassName string
	StartsAt  time.Time
	EndsAt    time.Time
}

// StaffActivityItem is one recentActivity row (detail, D9/D15).
type StaffActivityItem struct {
	Event      string
	EntityType string
	At         time.Time
}

// StaffMemberDetail is the s40 detail read (AC4).
type StaffMemberDetail struct {
	UserID          uuid.UUID
	Name            string
	Email           string
	AvatarURL       *string
	LanguagePref    string
	Role            string
	Status          string
	AssignedClasses []StaffAssignedClass
	ScheduleGlance  []StaffScheduleGlanceItem
	Load            StaffLoad
	LastActiveAt    *time.Time
	RecentActivity  []StaffActivityItem
}

// ArchiveResult carries the D17c ghost — how many classes the archived teacher
// still owns (classes are NOT auto-unassigned; the UI warns with this count).
type ArchiveResult struct {
	AssignedClassCount int
}

// StaffService orchestrates the staff roster reads and Owner-only actions.
type StaffService struct {
	db       AuthDB
	audit    *AuditService
	retry    EmailRetryQueue
	clk      clock.Clock
	resetURL string
}

// NewStaffService constructs a StaffService. The AuthAuditLogger parameter is
// intentionally unused: staff-action audits MUST land in `audit_logs` (D15),
// which is the AuditService's table — NOT the AuthAuditLogger's `auth_audit_logs`.
// It is accepted to keep the constructor uniform with the auth-spine services.
func NewStaffService(db AuthDB, _ AuthAuditLogger, retry EmailRetryQueue, clk clock.Clock) *StaffService {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &StaffService{
		db:       db,
		audit:    NewAuditService(db),
		retry:    retry,
		clk:      clk,
		resetURL: "http://localhost:5173/reset-password",
	}
}

// SetResetURLBase overrides the default reset URL base (production main.go).
func (s *StaffService) SetResetURLBase(base string) {
	s.resetURL = trimTrailingSlash(base)
}

func trimTrailingSlash(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

// ---------------- Reads ----------------

// ListStaff returns the split-object roster (AC1/AC3). RequireRole("owner",
// "admin") gates the edge; no SEC-1 re-fetch (reads are not mutating).
func (s *StaffService) ListStaff(ctx context.Context, tc model.TenantContext) (*StaffRoster, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	tx, err := s.beginTenantTx(ctx, centerUUID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	q := generated.New(tx)
	centerPg := pgtype.UUID{Bytes: centerUUID, Valid: true}
	nowPg := pgtype.Timestamptz{Time: s.clk.Now(), Valid: true}

	memberRows, err := q.ListStaffMembers(ctx, generated.ListStaffMembersParams{CenterID: centerPg, Now: nowPg, HeavyThreshold: HeavyLoadThresholdSessionsPerWeek, LoadWindowDays: LoadWindowDays})
	if err != nil {
		return nil, fmt.Errorf("list staff members: %w", err)
	}
	inviteRows, err := q.ListPendingStaffInvites(ctx, centerPg)
	if err != nil {
		return nil, fmt.Errorf("list pending invites: %w", err)
	}

	roster := &StaffRoster{
		Members:        make([]StaffMemberView, 0, len(memberRows)),
		PendingInvites: make([]PendingInviteView, 0, len(inviteRows)),
	}
	for _, r := range memberRows {
		roster.Members = append(roster.Members, staffMemberViewFromRow(r))
	}
	for _, r := range inviteRows {
		roster.PendingInvites = append(roster.PendingInvites, pendingInviteViewFromRow(r))
	}
	return roster, nil
}

// GetStaffMemberDetail composes the s40 detail (AC4). A non-member / student /
// owner target → *model.NotFoundError STAFF_NOT_FOUND (never disclose the
// owner's existence — the roster excludes owners/students, so absence IS the
// non-disclosure).
func (s *StaffService) GetStaffMemberDetail(ctx context.Context, tc model.TenantContext, targetUserID uuid.UUID) (*StaffMemberDetail, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	tx, err := s.beginTenantTx(ctx, centerUUID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	q := generated.New(tx)
	centerPg := pgtype.UUID{Bytes: centerUUID, Valid: true}
	targetPg := pgtype.UUID{Bytes: targetUserID, Valid: true}
	now := s.clk.Now()

	// Roster-row lookup drives both the load/last-active fields AND the
	// existence-non-disclosure 404 (owners/students are absent from the roster).
	rosterRows, err := q.ListStaffMembers(ctx, generated.ListStaffMembersParams{CenterID: centerPg, Now: pgtype.Timestamptz{Time: now, Valid: true}, HeavyThreshold: HeavyLoadThresholdSessionsPerWeek, LoadWindowDays: LoadWindowDays})
	if err != nil {
		return nil, fmt.Errorf("list staff members: %w", err)
	}
	var row *generated.ListStaffMembersRow
	for i := range rosterRows {
		if rosterRows[i].UserID == targetPg {
			row = &rosterRows[i]
			break
		}
	}
	if row == nil {
		return nil, model.NotFoundError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_NOT_FOUND"}
	}

	member := staffMemberViewFromRow(*row)

	// languagePref (users is global — safe to read by a proven member id).
	user, err := q.GetUserByID(ctx, targetPg)
	if err != nil {
		return nil, fmt.Errorf("get staff user: %w", err)
	}

	classes, err := q.ListClassesByTeacher(ctx, targetPg)
	if err != nil {
		return nil, fmt.Errorf("list classes by teacher: %w", err)
	}
	assigned := make([]StaffAssignedClass, 0, len(classes))
	for _, c := range classes {
		assigned = append(assigned, StaffAssignedClass{ClassID: uuid.UUID(c.ID.Bytes), Name: c.Name})
	}

	// scheduleGlance — status='scheduled' sessions in [now, now+window), Go-side
	// filtered (ListSessionsByRange returns cancelled too, D16), capped.
	sessions, err := q.ListSessionsByRange(ctx, generated.ListSessionsByRangeParams{
		FromTs:    pgtype.Timestamptz{Time: now, Valid: true},
		ToTs:      pgtype.Timestamptz{Time: now.Add(ScheduleGlanceWindowDays * 24 * time.Hour), Valid: true},
		TeacherID: targetPg,
	})
	if err != nil {
		return nil, fmt.Errorf("list sessions by range: %w", err)
	}
	glance := make([]StaffScheduleGlanceItem, 0, ScheduleGlanceLimit)
	for _, sess := range sessions {
		if sess.Status != "scheduled" {
			continue
		}
		if len(glance) >= ScheduleGlanceLimit {
			break
		}
		glance = append(glance, StaffScheduleGlanceItem{
			SessionID: uuid.UUID(sess.ID.Bytes),
			ClassID:   uuid.UUID(sess.ClassID.Bytes),
			ClassName: sess.ClassName,
			StartsAt:  sess.StartsAt.Time,
			EndsAt:    sess.EndsAt.Time,
		})
	}

	audits, err := q.ListAuditLogsByUser(ctx, generated.ListAuditLogsByUserParams{
		CenterID: centerPg,
		UserID:   targetPg,
		RowLimit: RecentActivityLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("list audit logs by user: %w", err)
	}
	activity := make([]StaffActivityItem, 0, len(audits))
	for _, a := range audits {
		activity = append(activity, StaffActivityItem{Event: a.Action, EntityType: a.EntityType, At: a.CreatedAt.Time})
	}

	return &StaffMemberDetail{
		UserID:          targetUserID,
		Name:            member.Name,
		Email:           member.Email,
		AvatarURL:       member.AvatarURL,
		LanguagePref:    user.LanguagePref,
		Role:            member.Role,
		Status:          member.Status,
		AssignedClasses: assigned,
		ScheduleGlance:  glance,
		Load:            member.Load,
		LastActiveAt:    member.LastActiveAt,
		RecentActivity:  activity,
	}, nil
}

// ---------------- Owner-only actions ----------------

// ArchiveStaff soft-archives an admin/teacher member (AC14/AC28). Owner-only
// (SEC-1). Self → 409 CANNOT_ARCHIVE_SELF; already-archived → 409
// STAFF_ALREADY_ARCHIVED; owner/non-member → 404 STAFF_NOT_FOUND. Classes are
// NOT auto-unassigned — the result carries assignedClassCount (D17c).
func (s *StaffService) ArchiveStaff(ctx context.Context, tc model.TenantContext, targetUserID uuid.UUID) (*ArchiveResult, error) {
	tx, q, centerUUID, callerUUID, err := s.beginOwnerAction(ctx, tc)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	centerPg := pgtype.UUID{Bytes: centerUUID, Valid: true}
	targetPg := pgtype.UUID{Bytes: targetUserID, Valid: true}

	if targetUserID == callerUUID {
		return nil, model.ConflictError{Resource: "staff member", ID: targetUserID.String(), Code: "CANNOT_ARCHIVE_SELF", Message: "You cannot archive yourself."}
	}
	if _, err := q.GetStaffMember(ctx, generated.GetStaffMemberParams{CenterID: centerPg, UserID: targetPg}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_NOT_FOUND"}
		}
		return nil, fmt.Errorf("archive: resolve member: %w", err)
	}

	classCount, err := q.CountClassesByTeacher(ctx, targetPg)
	if err != nil {
		return nil, fmt.Errorf("archive: count classes: %w", err)
	}

	rows, err := q.ArchiveCenterMember(ctx, generated.ArchiveCenterMemberParams{CenterID: centerPg, UserID: targetPg})
	if err != nil {
		return nil, fmt.Errorf("archive member: %w", err)
	}
	if rows == 0 {
		return nil, model.ConflictError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_ALREADY_ARCHIVED", Message: "This member is already archived."}
	}

	if err := s.auditWithinTx(ctx, tx, tc, "staff.archived", targetUserID, map[string]any{"assignedClassCount": classCount}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit archive tx: %w", err)
	}
	return &ArchiveResult{AssignedClassCount: int(classCount)}, nil
}

// AssignClass assigns a teacher member to a class (AC13). Owner-only (SEC-1).
// Target not a teacher member → 404 STAFF_NOT_FOUND; class not in center → 404
// CLASS_NOT_FOUND. Mutex-honored via UpdateClass.
func (s *StaffService) AssignClass(ctx context.Context, tc model.TenantContext, targetUserID, classID uuid.UUID) error {
	tx, q, centerUUID, _, err := s.beginOwnerAction(ctx, tc)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	centerPg := pgtype.UUID{Bytes: centerUUID, Valid: true}
	targetPg := pgtype.UUID{Bytes: targetUserID, Valid: true}
	classPg := pgtype.UUID{Bytes: classID, Valid: true}

	member, err := q.GetStaffMember(ctx, generated.GetStaffMemberParams{CenterID: centerPg, UserID: targetPg})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.NotFoundError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_NOT_FOUND"}
		}
		return fmt.Errorf("assign-class: resolve member: %w", err)
	}
	if member.Role != model.RoleTeacher {
		// Only a teacher can own a class (classes.teacher_id).
		return model.NotFoundError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_NOT_FOUND"}
	}
	if member.Status == staffStatusArchived {
		// An archived (deactivated) member must not be (re)assigned a class —
		// symmetric with the archive guards and consistent with D4/D17c intent.
		return model.ConflictError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_ARCHIVED", Message: "This member is archived; unarchive before assigning a class."}
	}
	if _, err := q.GetClassByID(ctx, classPg); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.NotFoundError{Resource: "class", ID: classID.String(), Code: "CLASS_NOT_FOUND"}
		}
		return fmt.Errorf("assign-class: resolve class: %w", err)
	}
	if _, err := q.UpdateClass(ctx, generated.UpdateClassParams{ID: classPg, TeacherID: targetPg}); err != nil {
		return fmt.Errorf("assign-class: update class: %w", err)
	}

	if err := s.auditWithinTx(ctx, tx, tc, "staff.class_assigned", targetUserID, map[string]any{"classId": classID.String()}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit assign-class tx: %w", err)
	}
	return nil
}

// ResetStaffPassword creates a password_resets row and enqueues a reset email
// to an admin/teacher member (AC15/AC24). Owner-only (SEC-1). Non-member → 404
// STAFF_NOT_FOUND. Reuses the reset PRIMITIVES with NO verified-gate / silent /
// padToFloor (D14). Email is best-effort AFTER commit (a send failure never
// fails the row write); the row itself is the durable result.
func (s *StaffService) ResetStaffPassword(ctx context.Context, tc model.TenantContext, targetUserID uuid.UUID) error {
	tx, q, centerUUID, _, err := s.beginOwnerAction(ctx, tc)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	centerPg := pgtype.UUID{Bytes: centerUUID, Valid: true}
	targetPg := pgtype.UUID{Bytes: targetUserID, Valid: true}

	// Member guard FIRST — a cross-tenant / non-member target 404s and NO
	// password_resets row or email is produced (AC17 — the reset seam stays
	// silent on a target outside the tenant).
	member, err := q.GetStaffMember(ctx, generated.GetStaffMemberParams{CenterID: centerPg, UserID: targetPg})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.NotFoundError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_NOT_FOUND"}
		}
		return fmt.Errorf("reset: resolve member: %w", err)
	}
	if member.Status == staffStatusArchived {
		// No password reset for a deactivated member — symmetric with assign-class.
		return model.ConflictError{Resource: "staff member", ID: targetUserID.String(), Code: "STAFF_ARCHIVED", Message: "This member is archived; unarchive before resetting their password."}
	}
	user, err := q.GetUserByID(ctx, targetPg)
	if err != nil {
		return fmt.Errorf("reset: get user: %w", err)
	}

	rawToken, err := newPasswordResetToken()
	if err != nil {
		return fmt.Errorf("reset: mint token: %w", err)
	}
	tokenHash := HashResetToken(rawToken)
	now := s.clk.Now()
	if _, err := q.CreatePasswordReset(ctx, generated.CreatePasswordResetParams{
		UserID:    targetPg,
		TokenHash: tokenHash,
		ExpiresAt: pgtype.Timestamptz{Time: now.Add(PasswordResetTTL), Valid: true},
		Email:     pgtype.Text{String: user.Email, Valid: true},
	}); err != nil {
		return fmt.Errorf("reset: create password reset: %w", err)
	}

	if err := s.auditWithinTx(ctx, tx, tc, "staff.password_reset_requested", targetUserID, map[string]any{"tokenIssuedAt": now.UTC().Format(time.RFC3339)}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit reset tx: %w", err)
	}

	// Best-effort email AFTER commit (D14 — NO padToFloor; authenticated Owner,
	// no enumeration surface). A send failure never rolls back the reset row.
	resetURL := s.resetURL + "?token=" + rawToken
	subject, body := RenderPasswordResetEmail(user.FullName, resetURL)
	if s.retry != nil {
		_ = s.retry.Enqueue(EmailJob{To: user.Email, Subject: subject, HTML: body})
	}
	return nil
}

// ---------------- helpers ----------------

// beginTenantTx opens a tx and binds app.current_tenant_id (RLS). Used by the
// read paths (no SEC-1 re-fetch — reads are gated at the edge only).
func (s *StaffService) beginTenantTx(ctx context.Context, centerUUID uuid.UUID) (pgx.Tx, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin staff tx: %w", err)
	}
	if _, err := tx.Exec(ctx,
		"SELECT set_config('app.current_tenant_id', $1::text, true)",
		centerUUID.String()); err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, fmt.Errorf("set tenant local: %w", err)
	}
	return tx, nil
}

// beginOwnerAction opens a tenant-scoped tx AND enforces SEC-1: it re-fetches
// the caller's center_members.role from the DB and rejects anything but owner
// with *ForbiddenError (the JWT claim is never trusted for a mutating call, D8).
// The caller owns the returned tx (defer Rollback; Commit on success).
func (s *StaffService) beginOwnerAction(ctx context.Context, tc model.TenantContext) (pgx.Tx, *generated.Queries, uuid.UUID, uuid.UUID, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	tx, err := s.beginTenantTx(ctx, centerUUID)
	if err != nil {
		return nil, nil, uuid.Nil, uuid.Nil, err
	}
	q := generated.New(tx)
	member, err := q.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgtype.UUID{Bytes: callerUUID, Valid: true},
		CenterID: pgtype.UUID{Bytes: centerUUID, Valid: true},
	})
	if err != nil {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "insufficient role"}
		}
		return nil, nil, uuid.Nil, uuid.Nil, fmt.Errorf("re-validate caller role: %w", err)
	}
	if member.Role != model.RoleOwner {
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return nil, nil, uuid.Nil, uuid.Nil, &ForbiddenError{Reason: "insufficient role"}
	}
	return tx, q, centerUUID, callerUUID, nil
}

// auditWithinTx writes a staff-action audit to audit_logs (D15) inside the
// action tx (tenant GUC already set). entityType is always center_member.
func (s *StaffService) auditWithinTx(ctx context.Context, tx pgx.Tx, tc model.TenantContext, action string, targetUserID uuid.UUID, after map[string]any) error {
	if err := s.audit.LogWithinTx(ctx, tx, tc, action, "center_member", targetUserID, Changes{After: after}); err != nil {
		return fmt.Errorf("audit %s: %w", action, err)
	}
	return nil
}

func staffMemberViewFromRow(r generated.ListStaffMembersRow) StaffMemberView {
	view := StaffMemberView{
		UserID:          uuid.UUID(r.UserID.Bytes),
		Name:            r.Name,
		Email:           r.Email,
		Role:            r.Role,
		Status:          r.Status,
		ClassesAssigned: int(r.ClassesAssigned),
		Load: StaffLoad{
			NextSevenDaysSessionCount: int(r.NextSevenDaysSessionCount),
			WeeklyCapacity:            DefaultWeeklySessionCapacity,
			Heavy:                     r.Heavy,
		},
	}
	if r.AvatarUrl.Valid {
		v := r.AvatarUrl.String
		view.AvatarURL = &v
	}
	if r.LastActiveAt.Valid {
		t := r.LastActiveAt.Time
		view.LastActiveAt = &t
	}
	return view
}

func pendingInviteViewFromRow(r generated.ListPendingStaffInvitesRow) PendingInviteView {
	view := PendingInviteView{
		InviteID:  uuid.UUID(r.ID.Bytes),
		Email:     r.Email,
		Role:      r.Role,
		InvitedAt: r.CreatedAt.Time,
		ExpiresAt: r.ExpiresAt.Time,
	}
	if r.Name.Valid {
		v := r.Name.String
		view.Name = &v
	}
	if r.ClassID.Valid {
		c := uuid.UUID(r.ClassID.Bytes)
		view.PendingClassID = &c
	}
	return view
}
