// GREEN (de-tagged 2026-09-10, Story 7.4a dev): the create_questions /
// create_question_replies migrations shipped the standard mutable 4-policy
// FORCE-RLS grid (NOT the append-only REVOKE lock) — see the GREEN SEAMS block
// below. Folded into the permanent suite.
//
// Story 7.4a (AC1/AC2/AC15 · R1–R3 tenant isolation · TEST-BE-1) — the cross-tenant
// RLS grid for the two NET-NEW Q&A tables, `questions` and `question_replies`.
// Real DB in tx under FORCE RLS (SetupDB sets ROLE classlite_app; a superuser
// bypasses RLS). Standard 4-policy grid mirroring `enrollments`
// (enrollments_rls_test.go) — NOT the append-only REVOKE lock of
// enrollment_history: Q&A is a MUTABLE domain (questions.status flips
// open→resolved), so an in-tenant UPDATE must SUCCEED while a cross-tenant one
// silently affects 0 rows. The append-only-vs-mutable distinction is asserted
// explicitly below so a dev cannot accidentally clone the wrong idiom.
//
// Shared qa* seed helpers live in question_role_scope_atdd_test.go (same package,
// same tag). This file adds no new helpers.
//
// RED (`//go:build atdd_red_phase`): the package compile-fails on the greenfield
// store seams referenced by its sibling files; these raw-SQL RLS tests are
// additionally RUNTIME-red until the create_questions / create_question_replies
// migrations land the tables.
//
// GREEN SEAMS (dev — Task 1 migrations):
//
//	questions / question_replies: ENABLE + FORCE ROW LEVEL SECURITY;
//	  4 policies FOR SELECT/INSERT/UPDATE/DELETE, each USING/WITH CHECK
//	    (center_id = current_setting('app.current_tenant_id')::uuid).
//	  NO REVOKE UPDATE/DELETE (mutable domain — do NOT copy enrollment_history).
package test

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// questions — cross-tenant isolation
// ---------------------------------------------------------------------------

func TestRLS_Questions_CrossTenantRead_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	cbID := qaUUIDFromPg(centerB.ID)
	author := qaSeedMember(t, db, cbID, "rls-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cbID, author)
	teacher := qaSeedMember(t, db, cbID, "rls-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cbID, teacher)
	student := qaSeedMember(t, db, cbID, "rls-student@example.com", "Student", "student")
	qaInsertQuestion(t, db, cbID, ex, class, student, "item")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM questions WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant-B questions, expected 0", visible)
	}
}

func TestRLS_Questions_CrossTenantInsertRejected_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// Seed the FK parents (exercise/class/student) in B.
	TenantContext(t, db, centerB.ID)
	cbID := qaUUIDFromPg(centerB.ID)
	author := qaSeedMember(t, db, cbID, "rls2-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cbID, author)
	teacher := qaSeedMember(t, db, cbID, "rls2-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cbID, teacher)
	student := qaSeedMember(t, db, cbID, "rls2-student@example.com", "Student", "student")

	// As tenant A, attempt to write a question stamped for center B → WITH CHECK reject.
	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(ctx,
		`INSERT INTO questions
		   (id, center_id, exercise_id, class_id, student_id, anchor_type, anchor_ref, anchor_excerpt, content, status)
		 VALUES ($1, $2, $3, $4, $5, 'exercise', NULL, NULL, 'sneaky', 'open')`,
		uuid.New(), centerB.ID, ex, class, student)
	AssertRLSViolation(t, err, "questions cross-tenant INSERT")
}

func TestRLS_Questions_CrossTenantWrite_NoMutation_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	cbID := qaUUIDFromPg(centerB.ID)
	author := qaSeedMember(t, db, cbID, "rls3-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cbID, author)
	teacher := qaSeedMember(t, db, cbID, "rls3-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cbID, teacher)
	student := qaSeedMember(t, db, cbID, "rls3-student@example.com", "Student", "student")
	qID := qaInsertQuestion(t, db, cbID, ex, class, student, "item")

	// Tenant A tries to resolve tenant B's question → 0 rows, target unchanged.
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx, "UPDATE questions SET status = 'resolved' WHERE id = $1", qID)
	if err != nil {
		t.Fatalf("cross-tenant UPDATE returned an error (expected silent 0-rows): %v", err)
	}
	if tag.RowsAffected() != 0 {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE affected %d rows, expected 0", tag.RowsAffected())
	}

	TenantContext(t, db, centerB.ID)
	var status string
	if err := db.QueryRow(ctx, "SELECT status FROM questions WHERE id = $1", qID).Scan(&status); err != nil {
		t.Fatalf("re-read as B: %v", err)
	}
	if status != "open" {
		t.Errorf("RLS VIOLATION: tenant B's question status = %q, expected 'open' (untouched)", status)
	}
}

// AC1 positive: Q&A is MUTABLE — an in-tenant UPDATE (resolve) SUCCEEDS. Guards
// against a dev accidentally cloning the enrollment_history REVOKE (append-only)
// idiom onto questions.
func TestQuestions_InTenantResolve_Succeeds_NotAppendOnly_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cID := qaUUIDFromPg(center.ID)
	author := qaSeedMember(t, db, cID, "rls4-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cID, author)
	teacher := qaSeedMember(t, db, cID, "rls4-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cID, teacher)
	student := qaSeedMember(t, db, cID, "rls4-student@example.com", "Student", "student")
	qID := qaInsertQuestion(t, db, cID, ex, class, student, "item")

	tag, err := db.Exec(ctx, "UPDATE questions SET status = 'resolved' WHERE id = $1", qID)
	if err != nil {
		t.Fatalf("in-tenant UPDATE must succeed (questions is mutable, NOT append-only): %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Errorf("in-tenant resolve affected %d rows, expected 1 — questions must have a working UPDATE policy", tag.RowsAffected())
	}
}

func TestRLS_Questions_UnsetTenant_ZeroRows_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	cID := qaUUIDFromPg(center.ID)
	author := qaSeedMember(t, db, cID, "rls5-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cID, author)
	teacher := qaSeedMember(t, db, cID, "rls5-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cID, teacher)
	student := qaSeedMember(t, db, cID, "rls5-student@example.com", "Student", "student")
	qaInsertQuestion(t, db, cID, ex, class, student, "exercise")

	// Reset RLS context to the empty/null-guard value → policy must return 0 rows.
	if _, err := db.Exec(ctx, "SET LOCAL app.current_tenant_id = '00000000-0000-0000-0000-000000000000'"); err != nil {
		t.Fatalf("reset tenant context: %v", err)
	}
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM questions").Scan(&visible); err != nil {
		t.Fatalf("count under null-guard tenant: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: null-guard tenant saw %d questions, expected 0", visible)
	}
}

// ---------------------------------------------------------------------------
// question_replies — cross-tenant isolation
// ---------------------------------------------------------------------------

func TestRLS_QuestionReplies_CrossTenantRead_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	cbID := qaUUIDFromPg(centerB.ID)
	author := qaSeedMember(t, db, cbID, "rlsr-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cbID, author)
	teacher := qaSeedMember(t, db, cbID, "rlsr-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cbID, teacher)
	student := qaSeedMember(t, db, cbID, "rlsr-student@example.com", "Student", "student")
	qID := qaInsertQuestion(t, db, cbID, ex, class, student, "item")
	qaInsertReply(t, db, cbID, qID, teacher, "shared")

	TenantContext(t, db, centerA.ID)
	var visible int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM question_replies WHERE center_id = $1", centerB.ID).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant-B question_replies, expected 0", visible)
	}
}

func TestRLS_QuestionReplies_CrossTenantInsertRejected_ATDD(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	cbID := qaUUIDFromPg(centerB.ID)
	author := qaSeedMember(t, db, cbID, "rlsr2-author@example.com", "Author", "admin")
	ex := qaSeedExercise(t, db, cbID, author)
	teacher := qaSeedMember(t, db, cbID, "rlsr2-teacher@example.com", "Teacher", "teacher")
	class := qaSeedClassWithTeacher(t, db, cbID, teacher)
	student := qaSeedMember(t, db, cbID, "rlsr2-student@example.com", "Student", "student")
	qID := qaInsertQuestion(t, db, cbID, ex, class, student, "item")

	TenantContext(t, db, centerA.ID)
	_, err := db.Exec(ctx,
		`INSERT INTO question_replies (id, center_id, question_id, author_id, content, visibility)
		 VALUES ($1, $2, $3, $4, 'sneaky', 'shared')`,
		uuid.New(), centerB.ID, qID, teacher)
	AssertRLSViolation(t, err, "question_replies cross-tenant INSERT")
}
