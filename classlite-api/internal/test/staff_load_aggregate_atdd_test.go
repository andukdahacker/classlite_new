// Story 7.1a (AC7/AC8 · D5/D6/D16 · risk=7) — the staff LOAD + LAST-ACTIVE
// aggregates, store level, real DB in tx. These are the ★ bound-`now` boundary +
// fan-out reds Murat/Amelia named at party-mode: SQL now() is non-deterministic
// (deleted-later flake), so the window takes a BOUND `now` sqlc.arg injected from
// the fake clock (D16). Runs under SET LOCAL ROLE classlite_app (SetupDB) so RLS
// is actually enforced.
//
// RED (this file is `//go:build atdd_red_phase`, quarantined from `go test ./...`
// per WF-8): compile-fails on the GREENFIELD store seam only —
//
//	generated.ListStaffMembers / ListStaffMembersParams / ListStaffMembersRow.
//
// Everything else (insertClassRaw, insertSessionRaw, CreateCenterWithID,
// CreateUser, CreateCenterMember, TenantContext) is shipped.
//
// GREEN SEAMS (dev — Task 3 `queries/staff.sql` + regen):
//
//	ListStaffMembers(ctx, ListStaffMembersParams{CenterID pgtype.UUID, Now pgtype.Timestamptz})
//	  → []ListStaffMembersRow, one row per center_members row with role IN
//	    ('admin','teacher') joined to users. Row fields exercised here:
//	    UserID pgtype.UUID · Role string · NextSevenDaysSessionCount int64 ·
//	    Heavy bool · LastActiveAt pgtype.Timestamptz (nullable).
//	  - nextSevenDaysSessionCount = COUNT(sessions s JOIN classes c ON s.class_id=c.id
//	      WHERE c.teacher_id = users.id AND s.status='scheduled'
//	      AND s.starts_at >= @now AND s.starts_at < @now + interval '7 days').
//	      HALF-OPEN [now, now+7d) — reuse ListSessionsByRange's convention verbatim.
//	      @now is the BOUND arg, NOT SQL now() (D16).
//	    heavy = nextSevenDaysSessionCount >= HeavyLoadThresholdSessionsPerWeek (8).
//	    lastActiveAt = MAX(refresh_tokens.created_at) for users.id, else NULL (D6).
//
// NB (schema truth flagged to dev): sessions.status CHECK is 2-valued
// ('scheduled','cancelled') — the AC7 prose "completed/in_progress excluded" has
// no column basis today; the scheduled-only red asserts scheduled-IN / cancelled-OUT.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// fixedLoadNow is the deterministic clock instant the load window is anchored to.
// The window is [fixedLoadNow, fixedLoadNow+7d). A fixed instant is the whole point
// of D16 — SQL now() would drift between seed and assert.
var fixedLoadNow = time.Date(2026, 9, 1, 12, 0, 0, 0, time.UTC)

func loadNowArg() pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: fixedLoadNow, Valid: true}
}

// assignClassToTeacher sets classes.teacher_id (insertClassRaw leaves it NULL).
// Tenant context must be set by the caller.
func assignClassToTeacher(t *testing.T, db *TxDB, classID, teacherUserID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`UPDATE classes SET teacher_id = $1 WHERE id = $2`, teacherUserID, classID); err != nil {
		t.Fatalf("assign class %s to teacher %s: %v", classID, teacherUserID, err)
	}
}

// insertCancelledSessionRaw seeds a status='cancelled' session (the coupling
// constraint requires cancelled_at set). Tenant context must be set by the caller.
func insertCancelledSessionRaw(t *testing.T, db *TxDB, centerID, classID uuid.UUID, startsAt time.Time) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status, cancelled_at)
		 VALUES ($1, $2, $3, 'Cancelled', $4::timestamptz, $4::timestamptz + interval '90 minutes', 'cancelled', now())`,
		uuid.New(), centerID, classID, startsAt); err != nil {
		t.Fatalf("insert cancelled session: %v", err)
	}
}

// findStaffRow returns the row for userID, failing the test if absent OR present
// more than once (the fan-out "appears exactly once" invariant, AC1/A1).
func findStaffRow(t *testing.T, rows []generated.ListStaffMembersRow, userID pgtype.UUID) generated.ListStaffMembersRow {
	t.Helper()
	var found *generated.ListStaffMembersRow
	seen := 0
	for i := range rows {
		if rows[i].UserID == userID {
			seen++
			found = &rows[i]
		}
	}
	if seen == 0 {
		t.Fatalf("staff row for %s not found in %d rows", UUIDString(userID), len(rows))
	}
	if seen != 1 {
		t.Fatalf("FAN-OUT DUP: staff row for %s appears %d times, want exactly 1", UUIDString(userID), seen)
	}
	return *found
}

// seedTeacherWithCenter creates center A + a teacher member and sets tenant ctx.
func seedTeacherWithCenter(t *testing.T, db *TxDB, email string) (centerID pgtype.UUID, teacherID uuid.UUID) {
	t.Helper()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	teacher := CreateUser(t, db, email, "Teacher")
	TenantContext(t, db, centerA.ID)
	CreateCenterMember(t, db, teacher.ID, centerA.ID, "teacher")
	return centerA.ID, uuid.UUID(teacher.ID.Bytes)
}

// AC7/D16 — ★ the half-open boundary. starts_at == now → IN; == now+7d → OUT.
func TestStaffLoad_BoundNowHalfOpenBoundary_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerID, teacherID := seedTeacherWithCenter(t, db, "boundary@example.com")
	centerUUID := uuid.UUID(centerID.Bytes)
	class := insertClassRaw(t, db, centerUUID, "Boundary Class")
	assignClassToTeacher(t, db, class, teacherID)

	// IN: exactly now (>= now).
	insertSessionRaw(t, db, centerUUID, class, fixedLoadNow, nil)
	// IN: just inside the upper bound.
	insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(7*24*time.Hour-time.Minute), nil)
	// OUT: exactly now+7d (< is exclusive).
	insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(7*24*time.Hour), nil)
	// OUT: one second before now.
	insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(-time.Second), nil)

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	row := findStaffRow(t, rows, pgtype.UUID{Bytes: [16]byte(teacherID), Valid: true})
	if row.NextSevenDaysSessionCount != 2 {
		t.Errorf("half-open window: got %d, want 2 (now IN, now+7d-1m IN, now+7d OUT, now-1s OUT)", row.NextSevenDaysSessionCount)
	}
}

// AC7 — heavy flips at the named threshold (8). 8 → heavy; 7 → not.
func TestStaffLoad_HeavyThresholdAtEight_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerID, teacherID := seedTeacherWithCenter(t, db, "heavy@example.com")
	centerUUID := uuid.UUID(centerID.Bytes)
	teacherPg := pgtype.UUID{Bytes: [16]byte(teacherID), Valid: true}

	class := insertClassRaw(t, db, centerUUID, "Heavy Class")
	assignClassToTeacher(t, db, class, teacherID)

	// 7 scheduled in-window → NOT heavy.
	for i := 0; i < 7; i++ {
		insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(time.Duration(i)*time.Hour), nil)
	}
	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers (7): %v", err)
	}
	if r := findStaffRow(t, rows, teacherPg); r.NextSevenDaysSessionCount != 7 || r.Heavy {
		t.Errorf("at 7: count=%d heavy=%v, want count=7 heavy=false", r.NextSevenDaysSessionCount, r.Heavy)
	}

	// 8th session → heavy true.
	insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(8*time.Hour), nil)
	rows, err = generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers (8): %v", err)
	}
	if r := findStaffRow(t, rows, teacherPg); r.NextSevenDaysSessionCount != 8 || !r.Heavy {
		t.Errorf("at 8: count=%d heavy=%v, want count=8 heavy=true", r.NextSevenDaysSessionCount, r.Heavy)
	}
}

// AC7 — only status='scheduled' counts. A cancelled session in-window is excluded.
// (Schema truth: sessions.status is 2-valued; completed/in_progress do not exist.)
func TestStaffLoad_ScheduledStatusOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerID, teacherID := seedTeacherWithCenter(t, db, "scheduledonly@example.com")
	centerUUID := uuid.UUID(centerID.Bytes)
	class := insertClassRaw(t, db, centerUUID, "Status Class")
	assignClassToTeacher(t, db, class, teacherID)

	insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(time.Hour), nil) // scheduled, IN
	insertCancelledSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(2*time.Hour))

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	if r := findStaffRow(t, rows, pgtype.UUID{Bytes: [16]byte(teacherID), Valid: true}); r.NextSevenDaysSessionCount != 1 {
		t.Errorf("scheduled-only: got %d, want 1 (cancelled excluded)", r.NextSevenDaysSessionCount)
	}
}

// AC7 — an admin (never a class teacher) yields sessionsPerWeek=0, heavy=false.
func TestStaffLoad_AdminYieldsZero_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	admin := CreateUser(t, db, "admin@example.com", "Admin")
	TenantContext(t, db, centerA.ID)
	CreateCenterMember(t, db, admin.ID, centerA.ID, "admin")

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerA.ID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	if r := findStaffRow(t, rows, admin.ID); r.NextSevenDaysSessionCount != 0 || r.Heavy {
		t.Errorf("admin: count=%d heavy=%v, want 0/false", r.NextSevenDaysSessionCount, r.Heavy)
	}
}

// AC7/A1 — ★ fan-out: a teacher with 2 classes × 2 in-window sessions yields the
// true SUM (4) AND appears exactly once (findStaffRow enforces the once-ness).
func TestStaffLoad_FanOutSumAppearsOnce_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerID, teacherID := seedTeacherWithCenter(t, db, "fanout@example.com")
	centerUUID := uuid.UUID(centerID.Bytes)

	for c := 0; c < 2; c++ {
		class := insertClassRaw(t, db, centerUUID, "Fan Class")
		assignClassToTeacher(t, db, class, teacherID)
		insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(time.Duration(c*2+1)*time.Hour), nil)
		insertSessionRaw(t, db, centerUUID, class, fixedLoadNow.Add(time.Duration(c*2+2)*time.Hour), nil)
	}

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	if r := findStaffRow(t, rows, pgtype.UUID{Bytes: [16]byte(teacherID), Valid: true}); r.NextSevenDaysSessionCount != 4 {
		t.Errorf("fan-out SUM: got %d, want 4 (2 classes × 2 sessions, no JOIN row-multiplication)", r.NextSevenDaysSessionCount)
	}
}

// AC8/D6 — last-active = MAX(refresh_tokens.created_at); no row → NULL.
func TestStaffLastActive_NullAndMax_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	withTok := CreateUser(t, db, "hastoken@example.com", "Has Token")
	noTok := CreateUser(t, db, "notoken@example.com", "No Token")
	TenantContext(t, db, centerA.ID)
	CreateCenterMember(t, db, withTok.ID, centerA.ID, "teacher")
	CreateCenterMember(t, db, noTok.ID, centerA.ID, "teacher")

	older := fixedLoadNow.Add(-48 * time.Hour)
	newest := fixedLoadNow.Add(-1 * time.Hour)
	seedRefreshTokenAt(t, db, uuid.UUID(withTok.ID.Bytes), older)
	seedRefreshTokenAt(t, db, uuid.UUID(withTok.ID.Bytes), newest)

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerA.ID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	if r := findStaffRow(t, rows, withTok.ID); !r.LastActiveAt.Valid || !r.LastActiveAt.Time.Equal(newest) {
		t.Errorf("lastActiveAt for token user: got valid=%v time=%v, want %v (MAX)", r.LastActiveAt.Valid, r.LastActiveAt.Time, newest)
	}
	if r := findStaffRow(t, rows, noTok.ID); r.LastActiveAt.Valid {
		t.Errorf("lastActiveAt for no-token user: got valid=true, want NULL")
	}
}

// AC8 — cross-user isolation: two users each get their own MAX, never each other's.
func TestStaffLastActive_CrossUserIsolation_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	u1 := CreateUser(t, db, "u1@example.com", "User One")
	u2 := CreateUser(t, db, "u2@example.com", "User Two")
	TenantContext(t, db, centerA.ID)
	CreateCenterMember(t, db, u1.ID, centerA.ID, "teacher")
	CreateCenterMember(t, db, u2.ID, centerA.ID, "teacher")

	t1 := fixedLoadNow.Add(-10 * time.Hour)
	t2 := fixedLoadNow.Add(-5 * time.Hour)
	seedRefreshTokenAt(t, db, uuid.UUID(u1.ID.Bytes), t1)
	seedRefreshTokenAt(t, db, uuid.UUID(u2.ID.Bytes), t2)

	rows, err := generated.New(db).ListStaffMembers(context.Background(), staffRosterParams(centerA.ID, loadNowArg()))
	if err != nil {
		t.Fatalf("ListStaffMembers: %v", err)
	}
	if r := findStaffRow(t, rows, u1.ID); !r.LastActiveAt.Valid || !r.LastActiveAt.Time.Equal(t1) {
		t.Errorf("u1 lastActiveAt: got %v, want %v (not u2's)", r.LastActiveAt.Time, t1)
	}
	if r := findStaffRow(t, rows, u2.ID); !r.LastActiveAt.Valid || !r.LastActiveAt.Time.Equal(t2) {
		t.Errorf("u2 lastActiveAt: got %v, want %v (not u1's)", r.LastActiveAt.Time, t2)
	}
}

// seedRefreshTokenAt inserts one refresh_tokens row with an explicit created_at.
func seedRefreshTokenAt(t *testing.T, db *TxDB, userID uuid.UUID, createdAt time.Time) {
	t.Helper()
	family := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, remember_me, created_at)
		 VALUES ($1, $2, $3, $4, false, $5)`,
		userID, "load-hash-"+family.String(), family, createdAt.Add(7*24*time.Hour), createdAt,
	); err != nil {
		t.Fatalf("seed refresh_token at %v: %v", createdAt, err)
	}
}
