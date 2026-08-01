// Story 4.5 — Task 7 TRIPWIRE (closes FU-4-1-A). The exercise LIST path counts
// sections/questions in SQL via jsonb_array_length (exercises.sql), a SECOND
// un-laddered reader of the blob shape that assumes v1. This test pins the
// invariant that the SQL count equals the Go LADDERED count (Get's detail path)
// for a v1 blob. The day a v2 reshapes sections/questionGroups/questions, the SQL
// count silently diverges from the laddered Go count and THIS TEST FAILS — the
// signal that exercises.sql must branch on schema_version or fall back to
// app-side counting. Real DB (TEST-BE-2).
package service_test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

func TestExerciseListSQLCount_MatchesLadderedGoCount_V1(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	svc := service.NewExerciseService(db, service.NewAuditService(db), clock.RealClock{})

	sfx := uuid.NewString()[:8]
	owner := test.CreateUser(t, db, "tw-owner-"+sfx+"@example.com", "TW Owner")
	center := test.CreateCenter(t, db, "TW Center", "tw-"+sfx[:5])
	test.TenantContext(t, db, center.ID)
	test.CreateCenterMember(t, db, owner.ID, center.ID, string(model.RoleOwner))

	// A populated v1 blob: 2 sections, 3 questions total.
	content := store.ExerciseContent{
		Sections: []store.ExerciseSection{
			{Type: store.SectionTypeReading, Title: "S1", QuestionGroups: []store.QuestionGroup{
				{Type: store.QuestionGroupTypeMultipleChoice, Questions: []store.Question{{Text: "q1"}, {Text: "q2"}}},
			}},
			{Type: store.SectionTypeListening, Title: "S2", QuestionGroups: []store.QuestionGroup{
				{Type: store.QuestionGroupTypeShortAnswer, Questions: []store.Question{{Text: "q3"}}},
			}},
		},
	}
	const wantSections, wantQuestions = 2, 3
	raw, err := content.Marshal()
	if err != nil {
		t.Fatalf("marshal content: %v", err)
	}
	exID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Counted','reading','{}',$5::jsonb,1)`,
		exID, center.ID, owner.ID, "EX-TW-"+exID.String()[:6], raw,
	); err != nil {
		t.Fatalf("seed populated exercise: %v", err)
	}

	tc := model.TenantContext{
		CenterID: test.UUIDString(center.ID),
		UserID:   test.UUIDString(owner.ID),
		Role:     string(model.RoleOwner),
	}

	// SQL-computed counts (jsonb_array_length, the un-laddered reader).
	list, err := svc.List(ctx, tc, service.ListExerciseFilter{Page: 1, PageSize: 50})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var sqlSections, sqlQuestions int
	found := false
	for _, row := range list.Items {
		if uuid.UUID(row.ID.Bytes) == exID {
			sqlSections, sqlQuestions = int(row.SectionCount), int(row.QuestionCount)
			found = true
		}
	}
	if !found {
		t.Fatal("seeded exercise not returned by List")
	}

	// Go laddered counts (Get's detail path decodes through UnmarshalExerciseContent).
	got, err := svc.Get(ctx, tc, exID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if sqlSections != wantSections || sqlQuestions != wantQuestions {
		t.Fatalf("SQL counts = %d sections / %d questions, want %d / %d", sqlSections, sqlQuestions, wantSections, wantQuestions)
	}
	if got.SectionCount != wantSections || got.QuestionCount != wantQuestions {
		t.Fatalf("Go laddered counts = %d / %d, want %d / %d", got.SectionCount, got.QuestionCount, wantSections, wantQuestions)
	}
	// The invariant that breaks at a reshaped v2:
	if sqlSections != got.SectionCount || sqlQuestions != got.QuestionCount {
		t.Fatalf("TRIPWIRE: SQL count (%d/%d) diverged from the laddered Go count (%d/%d) — a reshaped v2 landed; exercises.sql must branch on schema_version",
			sqlSections, sqlQuestions, got.SectionCount, got.QuestionCount)
	}
}
