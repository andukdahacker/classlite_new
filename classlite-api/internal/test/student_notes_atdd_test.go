// Story 7.2a (AC12/AC13/AC14/AC15 · D7 · risk=7) — student_notes lifecycle +
// cross-tenant RLS. Real DB in tx under FORCE RLS. Store-seam reds: insert →
// chronological list → flag → soft-delete-hides, plus tenant A cannot read or
// mutate tenant B's notes (re-read AS B, assert byte-unchanged — the ★ house rule).
// The staff-only 403 + teacher-visibility + author-or-owner delete guards are
// SERVICE-seam reds (they need the greenfield StudentService + handler chain —
// see the ATDD checklist; a store-seam red can't reach an authz decision).
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// seams — generated.InsertStudentNote / ListStudentNotes / SetStudentNoteFlag /
// SoftDeleteStudentNote — and RUNTIME-fails until the Task-2 create_student_notes
// migration exists.
//
// GREEN SEAMS (dev — Task 2 migration + Task 3 queries/student_notes.sql):
//
//	student_notes(id, center_id, student_id→users, author_id→users, content text,
//	              flagged boolean DEFAULT false, attachments jsonb DEFAULT '[]',
//	              created_at, updated_at, deleted_at timestamptz NULL)  + 4-policy center_id RLS grid
//	InsertStudentNote(ctx, {CenterID, StudentID, AuthorID, Content, Flagged}) → StudentNote row
//	ListStudentNotes(ctx, {CenterID, StudentID}) → []StudentNote  -- WHERE deleted_at IS NULL ORDER BY created_at ASC
//	SetStudentNoteFlag(ctx, {CenterID, NoteID, Flagged}) → StudentNote
//	SoftDeleteStudentNote(ctx, {CenterID, NoteID}) → int64  -- (:execrows) SET deleted_at=now() WHERE deleted_at IS NULL
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
)

func seedTeacher(t *testing.T, db *TxDB, centerID uuid.UUID, email string) uuid.UUID {
	t.Helper()
	u := CreateUser(t, db, email, "Author Teacher")
	CreateCenterMember(t, db, u.ID, pgUUID(centerID), "teacher")
	return uuidFromPg(u.ID)
}

// AC12/13/14 — insert → chronological list → flag → soft-delete-hides.
func TestStudentNotes_Lifecycle_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	cid := uuidFromPg(center.ID)
	TenantContext(t, db, center.ID)

	author := seedTeacher(t, db, cid, "author@example.com")
	student := seedStudentMember(t, db, cid, "stu@example.com", "Stu")
	q := generated.New(db)

	n1, err := q.InsertStudentNote(context.Background(), generated.InsertStudentNoteParams{
		CenterID: pgUUID(cid), StudentID: pgUUID(student), AuthorID: pgUUID(author), Content: "first", Flagged: false,
	})
	if err != nil {
		t.Fatalf("insert n1: %v", err)
	}
	if _, err := q.InsertStudentNote(context.Background(), generated.InsertStudentNoteParams{
		CenterID: pgUUID(cid), StudentID: pgUUID(student), AuthorID: pgUUID(author), Content: "second", Flagged: false,
	}); err != nil {
		t.Fatalf("insert n2: %v", err)
	}

	// chronological ASC
	list, err := q.ListStudentNotes(context.Background(), generated.ListStudentNotesParams{CenterID: pgUUID(cid), StudentID: pgUUID(student)})
	if err != nil || len(list) != 2 {
		t.Fatalf("list: got len=%d err=%v, want 2", len(list), err)
	}
	if list[0].Content != "first" || list[1].Content != "second" {
		t.Fatalf("order: got [%q,%q], want [first,second]", list[0].Content, list[1].Content)
	}

	// flag toggle
	flagged, err := q.SetStudentNoteFlag(context.Background(), generated.SetStudentNoteFlagParams{CenterID: pgUUID(cid), NoteID: n1.ID, Flagged: true})
	if err != nil || !flagged.Flagged {
		t.Fatalf("flag: got flagged=%v err=%v", flagged.Flagged, err)
	}

	// soft-delete hides from list; :execrows==1 first, ==0 on double-delete
	rows, err := q.SoftDeleteStudentNote(context.Background(), generated.SoftDeleteStudentNoteParams{CenterID: pgUUID(cid), NoteID: n1.ID})
	if err != nil || rows != 1 {
		t.Fatalf("soft-delete: got rows=%d err=%v, want 1", rows, err)
	}
	rows2, _ := q.SoftDeleteStudentNote(context.Background(), generated.SoftDeleteStudentNoteParams{CenterID: pgUUID(cid), NoteID: n1.ID})
	if rows2 != 0 {
		t.Fatalf("double soft-delete: got rows=%d, want 0", rows2)
	}
	after, _ := q.ListStudentNotes(context.Background(), generated.ListStudentNotesParams{CenterID: pgUUID(cid), StudentID: pgUUID(student)})
	if len(after) != 1 || after[0].Content != "second" {
		t.Fatalf("post-delete list: got %d rows, want 1 (second only)", len(after))
	}
}

// AC15/E — cross-tenant: tenant A cannot list B's notes, and an A-scoped
// soft-delete of B's note affects 0 rows (re-read AS B, byte-unchanged).
func TestRLS_StudentNotes_CrossTenant_ATDD(t *testing.T) {
	db := SetupDB(t)
	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	bcid := uuidFromPg(centerB.ID)
	authorB := seedTeacher(t, db, bcid, "authorb@example.com")
	studentB := seedStudentMember(t, db, bcid, "stub@example.com", "Stu B")
	noteB, err := generated.New(db).InsertStudentNote(context.Background(), generated.InsertStudentNoteParams{
		CenterID: pgUUID(bcid), StudentID: pgUUID(studentB), AuthorID: pgUUID(authorB), Content: "B secret", Flagged: false,
	})
	if err != nil {
		t.Fatalf("seed B note: %v", err)
	}

	// A cannot see B's notes
	TenantContext(t, db, centerA.ID)
	acid := uuidFromPg(centerA.ID)
	aList, err := generated.New(db).ListStudentNotes(context.Background(), generated.ListStudentNotesParams{CenterID: pgUUID(acid), StudentID: pgUUID(studentB)})
	if err != nil {
		t.Fatalf("A list: %v", err)
	}
	if len(aList) != 0 {
		t.Fatalf("RLS VIOLATION: tenant A read %d of tenant B's notes", len(aList))
	}

	// A-scoped soft-delete of B's note → 0 rows
	rows, _ := generated.New(db).SoftDeleteStudentNote(context.Background(), generated.SoftDeleteStudentNoteParams{CenterID: pgUUID(acid), NoteID: noteB.ID})
	if rows != 0 {
		t.Fatalf("RLS VIOLATION: A soft-deleted B's note (rows=%d)", rows)
	}

	// re-read AS B — byte-unchanged, still visible
	TenantContext(t, db, centerB.ID)
	bList, _ := generated.New(db).ListStudentNotes(context.Background(), generated.ListStudentNotesParams{CenterID: pgUUID(bcid), StudentID: pgUUID(studentB)})
	if len(bList) != 1 || bList[0].Content != "B secret" {
		t.Fatalf("B's note was mutated across tenants: got %d rows", len(bList))
	}
}
