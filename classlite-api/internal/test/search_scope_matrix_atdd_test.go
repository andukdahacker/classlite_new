// search_scope_matrix_atdd_test.go — Story 8-4a (AC6/7/8 · D5/D11 · R-1/R-2 · risk=8
// · WF-8 HARD GATE). The role×type scope matrix, PAIRED-CONTROL per Murat B1-B4:
// every absence assertion shares its `q` token with a seeded positive in the SAME
// response body, and a real would-leak negative fixture exists — so a NULL/NULL
// scope refactor (R-2) or a cross-teacher leak (R-1) reds, and an empty-for-everyone
// bug cannot false-pass.
//
// GREEN-PHASE (authored red-first per [[reference_atdd_red_convention]] against the
// service.NewSearchService / (*SearchService).Search / SearchResults seams; committed
// un-tagged like 8-1a). One center, two teachers (A owns *A resources, B owns *B),
// all resources share the token "Falcon"; the student caller is enrolled ONLY in
// classA. Callers are driven through the real ungated dashboardChain.
package test

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const searchMatrixToken = "Falcon"

type searchMatrixSeed struct {
	centerID       string
	owner          pgtype.UUID
	admin          pgtype.UUID
	teacherA       pgtype.UUID
	studentCaller  pgtype.UUID
	classA, classB uuid.UUID
}

// searchSeedMatrixCenter seeds the shared matrix fixture under `centerPg`'s RLS.
func searchSeedMatrixCenter(t *testing.T, db *TxDB, centerPg pgtype.UUID) searchMatrixSeed {
	t.Helper()
	_ = TenantContext(t, db, centerPg)
	cid := dashPGToUUID(t, centerPg)

	teacherA := CreateUser(t, db, "ta@matrix.test", "Teacher A")
	teacherB := CreateUser(t, db, "tb@matrix.test", "Teacher B")
	owner := CreateUser(t, db, "owner@matrix.test", "Owner Person")
	admin := CreateUser(t, db, "admin@matrix.test", "Admin Person")
	CreateCenterMember(t, db, teacherA.ID, centerPg, "teacher")
	CreateCenterMember(t, db, teacherB.ID, centerPg, "teacher")
	CreateCenterMember(t, db, owner.ID, centerPg, "owner")
	CreateCenterMember(t, db, admin.ID, centerPg, "admin")
	tA := dashPGToUUID(t, teacherA.ID)
	tB := dashPGToUUID(t, teacherB.ID)

	classA := searchSeedClass(t, db, cid, tA, searchMatrixToken+" Class A")
	classB := searchSeedClass(t, db, cid, tB, searchMatrixToken+" Class B")
	exA := searchSeedExercise(t, db, cid, tA, searchMatrixToken+" Ex A")
	exB := searchSeedExercise(t, db, cid, tB, searchMatrixToken+" Ex B")
	searchSeedAssignment(t, db, cid, classA, exA, tA)
	searchSeedAssignment(t, db, cid, classB, exB, tB)
	searchSeedFile(t, db, cid, tA, searchMatrixToken+" File A")
	searchSeedFile(t, db, cid, tB, searchMatrixToken+" File B")

	// A real student enrolled ONLY in teacherB's class — the teacher-scope negative.
	studB := searchSeedStudentNamed(t, db, cid, "studb@matrix.test", searchMatrixToken+" Stud B")
	insertEnrollmentRaw(t, db, cid, studB, classB, "active")
	// A real student enrolled in teacherA's class — the teacher-scope positive.
	studA := searchSeedStudentNamed(t, db, cid, "studa@matrix.test", searchMatrixToken+" Stud A")
	insertEnrollmentRaw(t, db, cid, studA, classA, "active")

	// The student CALLER — enrolled ONLY in classA (so classB is the non-enrolled
	// negative). Its own name matches the token but students is empty for a student.
	caller := searchSeedStudentNamed(t, db, cid, "caller@matrix.test", searchMatrixToken+" Caller")
	insertEnrollmentRaw(t, db, cid, caller, classA, "active")

	return searchMatrixSeed{
		centerID:      UUIDString(centerPg),
		owner:         owner.ID,
		admin:         admin.ID,
		teacherA:      teacherA.ID,
		studentCaller: pgUUID(caller),
		classA:        classA,
		classB:        classB,
	}
}

// AC6 — Owner AND Admin see all five categories center-wide. Each positive control is
// a resource the caller does NOT own (teacherB's) — an own-scope bug would drop it.
// Admin is its own cell (admin owns nothing → strongest control), not aliased to owner.
func TestSearch_Scope_OwnerAndAdmin_CenterWide_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	seed := searchSeedMatrixCenter(t, db, center.ID)

	for _, c := range []struct {
		role   string
		caller pgtype.UUID
	}{
		{"owner", seed.owner},
		{"admin", seed.admin},
	} {
		t.Run(c.role, func(t *testing.T) {
			srv := NewSearchTestServerForRole(t, db, c.caller, seed.centerID, c.role)
			rec, env := searchDo(t, srv, searchMatrixToken)
			if rec.Code != 200 {
				t.Fatalf("%s search want 200, got %d (body=%s)", c.role, rec.Code, rec.Body.String())
			}
			// Positive controls: teacherB-owned resources (caller owns nothing).
			if !searchCategoryHasTitle(env.Data.Classes, searchMatrixToken+" Class B") {
				t.Errorf("AC6 %s: center-wide classes must include teacherB's %q Class B (own-scope leak drops it)", c.role, searchMatrixToken)
			}
			if !searchCategoryHasTitle(env.Data.Exercises, searchMatrixToken+" Ex B") {
				t.Errorf("AC6 %s: center-wide exercises must include teacherB's %q Ex B", c.role, searchMatrixToken)
			}
			if !searchCategoryHasTitle(env.Data.Files, searchMatrixToken+" File B") {
				t.Errorf("AC6 %s: center-wide files must include teacherB's %q File B", c.role, searchMatrixToken)
			}
			if !searchCategoryHasTitle(env.Data.Students, searchMatrixToken+" Stud B") {
				t.Errorf("AC6 %s: center-wide students must include %q Stud B (enrolled in teacherB's class)", c.role, searchMatrixToken)
			}
			// Assignments center-wide: both teachers' assignment titles present.
			if !searchCategoryHasTitle(env.Data.Assignments, searchMatrixToken+" Ex B") {
				t.Errorf("AC6 %s: center-wide assignments must include teacherB's assignment (title %q Ex B)", c.role, searchMatrixToken)
			}
		})
	}
}

// AC7 — a Teacher caller sees ONLY own resources; every other-teacher resource
// matching the SAME token is absent in the SAME response body (R-1). Each pairs a
// present own-resource with an absent teacherB-resource.
func TestSearch_Scope_Teacher_OwnOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	seed := searchSeedMatrixCenter(t, db, center.ID)

	srv := NewSearchTestServerForRole(t, db, seed.teacherA, seed.centerID, "teacher")
	rec, env := searchDo(t, srv, searchMatrixToken)
	if rec.Code != 200 {
		t.Fatalf("teacher search want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	// Classes: own present, teacherB's absent.
	if !searchCategoryHasTitle(env.Data.Classes, searchMatrixToken+" Class A") {
		t.Errorf("AC7 classes: teacherA must see own %q Class A", searchMatrixToken)
	}
	if searchCategoryHasTitle(env.Data.Classes, searchMatrixToken+" Class B") {
		t.Errorf("AC7 CROSS-TEACHER LEAK: teacherA saw teacherB's %q Class B", searchMatrixToken)
	}
	// Students: own-class student present, teacherB-only student absent.
	if !searchCategoryHasTitle(env.Data.Students, searchMatrixToken+" Stud A") {
		t.Errorf("AC7 students: teacherA must see %q Stud A (enrolled in own class)", searchMatrixToken)
	}
	if searchCategoryHasTitle(env.Data.Students, searchMatrixToken+" Stud B") {
		t.Errorf("AC7 CROSS-TEACHER LEAK: teacherA saw %q Stud B (enrolled only in teacherB's class)", searchMatrixToken)
	}
	// Exercises: own present, teacherB's absent.
	if !searchCategoryHasTitle(env.Data.Exercises, searchMatrixToken+" Ex A") {
		t.Errorf("AC7 exercises: teacherA must see own %q Ex A", searchMatrixToken)
	}
	if searchCategoryHasTitle(env.Data.Exercises, searchMatrixToken+" Ex B") {
		t.Errorf("AC7 CROSS-TEACHER LEAK: teacherA saw teacherB's %q Ex B", searchMatrixToken)
	}
	// Files: own present, teacherB's absent.
	if !searchCategoryHasTitle(env.Data.Files, searchMatrixToken+" File A") {
		t.Errorf("AC7 files: teacherA must see own %q File A", searchMatrixToken)
	}
	if searchCategoryHasTitle(env.Data.Files, searchMatrixToken+" File B") {
		t.Errorf("AC7 CROSS-TEACHER LEAK: teacherA saw teacherB's %q File B", searchMatrixToken)
	}
	// Assignments: own-class assignment present (classId=classA), teacherB's absent.
	if !searchAssignmentHasClass(env.Data.Assignments, seed.classA) {
		t.Errorf("AC7 assignments: teacherA must see own-class assignment (classId=%s)", seed.classA)
	}
	if searchAssignmentHasClass(env.Data.Assignments, seed.classB) {
		t.Errorf("AC7 CROSS-TEACHER LEAK: teacherA saw an assignment on teacherB's class %s", seed.classB)
	}
}

// AC8 — a Student caller: classes non-empty (positive control — proves q matched and
// the endpoint ran) AND students/exercises/files all empty (the branch never runs
// those queries — a NULL/NULL refactor leak greens WITHOUT this control, Murat
// B3/Winston #4); AND a same-center class matching q the student is NOT enrolled in is
// absent (Murat B4); AND assignments only on the enrolled class.
func TestSearch_Scope_Student_ClassesAndAssignmentsOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	seed := searchSeedMatrixCenter(t, db, center.ID)

	srv := NewSearchTestServerForRole(t, db, seed.studentCaller, seed.centerID, "student")
	rec, env := searchDo(t, srv, searchMatrixToken)
	if rec.Code != 200 {
		t.Fatalf("student search want 200, got %d (body=%s)", rec.Code, rec.Body.String())
	}

	// Positive control: the enrolled class is present (endpoint ran, q matched).
	if !searchCategoryHasID(env.Data.Classes, seed.classA) {
		t.Fatalf("AC8 positive control FAILED: student must see enrolled classA %s — without this the empty "+
			"students/exercises/files below could be a vacuous empty-for-everyone pass", seed.classA)
	}
	// The three categories a student must NEVER get — even though matching seeds exist.
	if len(env.Data.Students.Items) != 0 {
		t.Errorf("AC8 SCOPE LEAK: student saw %d students, want 0 (branch must not run the students query)", len(env.Data.Students.Items))
	}
	if len(env.Data.Exercises.Items) != 0 {
		t.Errorf("AC8 SCOPE LEAK: student saw %d exercises, want 0", len(env.Data.Exercises.Items))
	}
	if len(env.Data.Files.Items) != 0 {
		t.Errorf("AC8 SCOPE LEAK: student saw %d files, want 0", len(env.Data.Files.Items))
	}
	// Non-enrolled class matching q must be absent (a "student sees all classes" bug).
	if searchCategoryHasID(env.Data.Classes, seed.classB) {
		t.Errorf("AC8 SCOPE LEAK: student saw non-enrolled classB %s (matching q but not enrolled)", seed.classB)
	}
	// Assignments only on the enrolled class.
	if !searchAssignmentHasClass(env.Data.Assignments, seed.classA) {
		t.Errorf("AC8 assignments: student must see the assignment on enrolled classA %s", seed.classA)
	}
	if searchAssignmentHasClass(env.Data.Assignments, seed.classB) {
		t.Errorf("AC8 SCOPE LEAK: student saw an assignment on non-enrolled classB %s", seed.classB)
	}

	// Belt-and-suspenders: teacherB's file/exercise/student names must not appear
	// ANYWHERE in the student's raw payload (a leak into any category, D5).
	body := rec.Body.String()
	for _, leaked := range []string{searchMatrixToken + " File B", searchMatrixToken + " Ex B", searchMatrixToken + " Stud B"} {
		if strings.Contains(body, leaked) {
			t.Errorf("AC8 SCOPE LEAK: %q appeared in the student's raw payload", leaked)
		}
	}
}
