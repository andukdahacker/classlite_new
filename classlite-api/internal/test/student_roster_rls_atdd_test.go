// Story 7.2a (AC2/AC5/AC15/AC16 · D2/D3/D10/D13 · risk=7) — the student roster
// read model: cross-tenant RLS isolation + the ★ NEW teacher role-scope axis +
// pagination. Real DB in tx under FORCE RLS (a superuser bypasses it). Mirrors
// staff_roster_rls_atdd_test.go (the 7-1a sibling) + the ★ Murat house rule: a
// teacher seeing zero of another teacher's students is only proof when the OTHER
// teacher genuinely CAN see that student — so every scope red seeds a positive
// control (the owner/other-teacher sees the row) alongside the negative.
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// store seams only — generated.ListStudents / ListStudentsParams / ListStudentsRow
// / CountStudents (+ CountStudentsParams). Task 3 builds queries/students.sql.
//
// GREEN SEAMS (dev — Task 3 queries/students.sql):
//
//	ListStudents(ctx, ListStudentsParams{
//	    CenterID pgtype.UUID,
//	    TeacherID pgtype.UUID,   // Valid=false ⇒ center-wide (admin/owner); Valid=true ⇒ ONLY students
//	                             //   with an active enrollment in a class WHERE classes.teacher_id = TeacherID (D3, the R-SEC axis)
//	    ClassID   pgtype.UUID,   // Valid=false ⇒ all classes; Valid=true ⇒ narrow to that class
//	    Now       pgtype.Timestamptz, // bound clock instant for at-risk windows (D4/D16 — NOT SQL now())
//	    Limit     int32,         // page_size (clamped [1,MaxPageSize] by the service)
//	    Offset    int32,         // (page-1)*page_size (XL-2)
//	}) → []ListStudentsRow
//	  Row: StudentID · Name · Email · AvatarUrl (nullable) · ActiveEnrollmentCount int64 ·
//	       OverallBand (pgtype.Numeric, nullable) · ArchivedAt (nullable) · JoinedAt · role='student' ONLY.
//	       (at-risk INPUT columns — attendance num/denom, consecutive-miss run, last-4 band slice —
//	        ride the same row so the service batch-classifies the page with NO N+1; asserted in
//	        student_aggregates_atdd_test.go.)
//	CountStudents(ctx, CountStudentsParams{CenterID, TeacherID, ClassID}) → int64  // meta.total under the SAME filter
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// --- local uuid<->pgtype converters (unique names; the package idiom is
// pgtype.UUID{Bytes:…,Valid:true} / uuid.UUID(x.Bytes)) ---

func pgUUID(id uuid.UUID) pgtype.UUID  { return pgtype.UUID{Bytes: id, Valid: true} }
func uuidFromPg(x pgtype.UUID) uuid.UUID { return uuid.UUID(x.Bytes) }

// --- local raw seeds (tagged; the red must not depend on greenfield writers) ---

func seedStudentMember(t *testing.T, db *TxDB, centerID uuid.UUID, email, name string) uuid.UUID {
	t.Helper()
	u := CreateUser(t, db, email, name)
	CreateCenterMember(t, db, u.ID, pgUUID(centerID), "student")
	return uuidFromPg(u.ID)
}

func seedClassWithTeacher(t *testing.T, db *TxDB, centerID, teacherID uuid.UUID) uuid.UUID {
	t.Helper()
	classID := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'S Class','active',$3)`,
		classID, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	return classID
}

func seedActiveEnrollment(t *testing.T, db *TxDB, centerID, studentID, classID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
}

func studentRosterParams(centerID uuid.UUID, teacherID *uuid.UUID, limit, offset int32) generated.ListStudentsParams {
	tp := pgtype.UUID{Valid: false}
	if teacherID != nil {
		tp = pgUUID(*teacherID)
	}
	return generated.ListStudentsParams{
		CenterID:  pgUUID(centerID),
		TeacherID: tp,
		ClassID:   pgtype.UUID{Valid: false},
		Now:       loadNowArg(),
		Limit:     limit,
		Offset:    offset,
	}
}

func rosterHasStudent(rows []generated.ListStudentsRow, studentID uuid.UUID) bool {
	for _, r := range rows {
		if uuidFromPg(r.StudentID) == studentID {
			return true
		}
	}
	return false
}

// AC15/E — cross-tenant READ isolation: tenant A's roster omits every tenant-B student.
func TestRLS_StudentRoster_CrossTenantRead_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	studentB := seedStudentMember(t, db, uuidFromPg(centerB.ID), "sb@example.com", "Student B")

	// positive control: B genuinely sees studentB
	rowsB, err := generated.New(db).ListStudents(context.Background(), studentRosterParams(uuidFromPg(centerB.ID), nil, 20, 0))
	if err != nil {
		t.Fatalf("B roster: %v", err)
	}
	if !rosterHasStudent(rowsB, studentB) {
		t.Fatalf("positive control failed: B cannot see its own student")
	}

	TenantContext(t, db, centerA.ID)
	rowsA, err := generated.New(db).ListStudents(context.Background(), studentRosterParams(uuidFromPg(centerA.ID), nil, 20, 0))
	if err != nil {
		t.Fatalf("A roster: %v", err)
	}
	if rosterHasStudent(rowsA, studentB) {
		t.Fatalf("RLS VIOLATION: tenant A's roster contains tenant B student %s", studentB)
	}
}

// AC16/E — ★ the NEW teacher role-scope axis (headline). Same tenant, two teachers
// with disjoint classes: T1 sees ONLY students enrolled in T1's classes; a
// T2-only student is absent from T1's teacher-scoped roster BUT present center-wide.
func TestStudentRoster_TeacherScope_Isolation_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	t1 := CreateUser(t, db, "t1@example.com", "Teacher One")
	t2 := CreateUser(t, db, "t2@example.com", "Teacher Two")
	CreateCenterMember(t, db, t1.ID, center.ID, "teacher")
	CreateCenterMember(t, db, t2.ID, center.ID, "teacher")
	t1ID, t2ID := uuidFromPg(t1.ID), uuidFromPg(t2.ID)

	class1 := seedClassWithTeacher(t, db, cid, t1ID)
	class2 := seedClassWithTeacher(t, db, cid, t2ID)

	s1 := seedStudentMember(t, db, cid, "s1@example.com", "S One") // T1's class
	s2 := seedStudentMember(t, db, cid, "s2@example.com", "S Two") // T2's class
	seedActiveEnrollment(t, db, cid, s1, class1)
	seedActiveEnrollment(t, db, cid, s2, class2)

	q := generated.New(db)

	// T1 teacher-scope: sees s1, NOT s2.
	t1Rows, err := q.ListStudents(context.Background(), studentRosterParams(cid, &t1ID, 20, 0))
	if err != nil {
		t.Fatalf("T1 roster: %v", err)
	}
	if !rosterHasStudent(t1Rows, s1) {
		t.Errorf("T1 must see own-class student s1")
	}
	if rosterHasStudent(t1Rows, s2) {
		t.Errorf("SCOPE LEAK: T1 sees T2-only student s2")
	}

	// positive control: center-wide (owner/admin) sees BOTH.
	allRows, err := q.ListStudents(context.Background(), studentRosterParams(cid, nil, 20, 0))
	if err != nil {
		t.Fatalf("center-wide roster: %v", err)
	}
	if !rosterHasStudent(allRows, s1) || !rosterHasStudent(allRows, s2) {
		t.Errorf("center-wide roster must contain both s1 and s2, got s1=%v s2=%v",
			rosterHasStudent(allRows, s1), rosterHasStudent(allRows, s2))
	}
}

// AC5/D10 — pagination: Limit/Offset page-slice + CountStudents returns the full
// filtered total (not the page size). Offset past the end → empty page, total intact.
func TestStudentRoster_Pagination_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	for i := 0; i < 5; i++ {
		seedStudentMember(t, db, cid, uuid.NewString()+"@example.com", "Student")
	}
	q := generated.New(db)

	total, err := q.CountStudents(context.Background(), generated.CountStudentsParams{
		CenterID: pgUUID(cid), TeacherID: pgtype.UUID{Valid: false}, ClassID: pgtype.UUID{Valid: false},
	})
	if err != nil {
		t.Fatalf("count: %v", err)
	}
	if total != 5 {
		t.Fatalf("total: got %d, want 5", total)
	}

	page1, err := q.ListStudents(context.Background(), studentRosterParams(cid, nil, 2, 0))
	if err != nil || len(page1) != 2 {
		t.Fatalf("page1: got len=%d err=%v, want 2", len(page1), err)
	}
	page3, err := q.ListStudents(context.Background(), studentRosterParams(cid, nil, 2, 4))
	if err != nil || len(page3) != 1 {
		t.Fatalf("page3 (offset 4): got len=%d err=%v, want 1", len(page3), err)
	}
	pastEnd, err := q.ListStudents(context.Background(), studentRosterParams(cid, nil, 2, 10))
	if err != nil || len(pastEnd) != 0 {
		t.Fatalf("offset past end: got len=%d err=%v, want 0", len(pastEnd), err)
	}
}
