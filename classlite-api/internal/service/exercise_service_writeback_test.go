// Story 4.5 — AC1 write-back proven at the SERVICE layer (Murat #1), not merely
// the store round-trip. A row stored at synthetic v1 is upgraded through the real
// lazy-upgrade ladder when the REAL ExerciseService.Update runs (changing one
// unrelated field), the column is advanced to current (2) in that SAME single
// UPDATE (no separate eager-rewrite pass), and a subsequent read is idempotent.
//
// Uses a test-scoped ladder (store.OverrideExerciseSchemaForTest) so a real
// version bump is exercised WITHOUT shipping a speculative production v2
// (DISASTER 1). Real DB via test.SetupDB (TEST-BE-2 — never mock pgx).
package service_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// writeBackSentinelMinutes is the observable marker the synthetic 1→2 rung stamps
// into settings.timeLimitMinutes — a value the v1 seed (0) never carries, so its
// presence proves the ladder ran.
const writeBackSentinelMinutes = 4242

func TestExerciseService_Update_WritesBackUpgradedContentAtCurrentVersion(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()
	auditSvc := service.NewAuditService(db)
	svc := service.NewExerciseService(db, auditSvc, clock.RealClock{})

	// Seed a center + owner + a v1 exercise row (schema_version = 1).
	sfx := uuid.NewString()[:8]
	owner := test.CreateUser(t, db, "wb-owner-"+sfx+"@example.com", "WB Owner")
	center := test.CreateCenter(t, db, "WB Center", "wb-"+sfx[:5])
	test.TenantContext(t, db, center.ID) // RLS WITH CHECK for member + exercise seed
	test.CreateCenterMember(t, db, owner.ID, center.ID, string(model.RoleOwner))

	exID := uuid.New()
	if _, err := db.Exec(ctx,
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, tags, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Seed Title','reading','{}','{"sections":[],"settings":{}}',1)`,
		exID, center.ID, owner.ID, "EX-WB-"+exID.String()[:6],
	); err != nil {
		t.Fatalf("seed v1 exercise: %v", err)
	}
	var seededUpdatedAt pgtype.Timestamptz
	if err := db.QueryRow(ctx, `SELECT updated_at FROM exercises WHERE id=$1`, exID).Scan(&seededUpdatedAt); err != nil {
		t.Fatalf("read seeded updated_at: %v", err)
	}

	// Install a synthetic current=2 ladder whose 1→2 rung stamps the sentinel into
	// settings — an observable, ExerciseContent-valid upgrade.
	restore := store.OverrideExerciseSchemaForTest(2, map[int]model.UpgradeFunc{
		1: func(raw json.RawMessage) (json.RawMessage, error) {
			var c store.ExerciseContent
			if err := json.Unmarshal(raw, &c); err != nil {
				return nil, err
			}
			c.Settings.TimeLimitEnabled = true
			c.Settings.TimeLimitMinutes = writeBackSentinelMinutes
			return c.Marshal()
		},
	})
	defer restore()

	tc := model.TenantContext{
		CenterID: test.UUIDString(center.ID),
		UserID:   test.UUIDString(owner.ID),
		Role:     string(model.RoleOwner),
	}

	// Real service update, changing ONLY the title (in.Content nil → the write-back
	// path, not a caller-supplied blob).
	newTitle := "Write-back Title"
	precond := seededUpdatedAt.Time
	res, err := svc.Update(ctx, tc, exID, service.UpdateExerciseInput{
		Title:        &newTitle,
		Precondition: &precond,
	})
	if err != nil {
		t.Fatalf("service Update: %v", err)
	}

	// The returned row is at current (2) with the upgraded content.
	if res.Row.SchemaVersion != 2 {
		t.Fatalf("returned schema_version = %d, want 2 (written back to current)", res.Row.SchemaVersion)
	}
	assertUpgradedSentinel(t, res.Row.Content, "service result")

	// The PERSISTED row is at 2 with the upgraded blob (re-read straight from DB).
	var gotVersion int32
	var gotContent []byte
	var afterUpdate pgtype.Timestamptz
	if err := db.QueryRow(ctx,
		`SELECT schema_version, content, updated_at FROM exercises WHERE id=$1`, exID,
	).Scan(&gotVersion, &gotContent, &afterUpdate); err != nil {
		t.Fatalf("re-read persisted row: %v", err)
	}
	if gotVersion != 2 {
		t.Fatalf("persisted schema_version = %d, want 2", gotVersion)
	}
	assertUpgradedSentinel(t, gotContent, "persisted row")
	if res.Row.Title != newTitle {
		t.Fatalf("title = %q, want %q (the update must still apply)", res.Row.Title, newTitle)
	}

	// Idempotent + exactly-one-UPDATE: a subsequent READ performs no further
	// upgrade and no write — Get is read-only, so updated_at must not move (there
	// is no eager-rewrite-on-read pass). The ladder at 2→2 is a passthrough.
	got, err := svc.Get(ctx, tc, exID)
	if err != nil {
		t.Fatalf("service Get after write-back: %v", err)
	}
	if got.Row.SchemaVersion != 2 {
		t.Fatalf("Get schema_version = %d, want 2 (idempotent)", got.Row.SchemaVersion)
	}
	var afterGet pgtype.Timestamptz
	if err := db.QueryRow(ctx, `SELECT updated_at FROM exercises WHERE id=$1`, exID).Scan(&afterGet); err != nil {
		t.Fatalf("re-read updated_at after Get: %v", err)
	}
	if !afterGet.Time.Equal(afterUpdate.Time) {
		t.Fatalf("updated_at moved on a READ (%v → %v): a read-triggered eager rewrite happened, violating 'exactly one UPDATE'",
			afterUpdate.Time, afterGet.Time)
	}
}

func assertUpgradedSentinel(t *testing.T, raw []byte, where string) {
	t.Helper()
	var c store.ExerciseContent
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("%s: decode content: %v", where, err)
	}
	if !c.Settings.TimeLimitEnabled || c.Settings.TimeLimitMinutes != writeBackSentinelMinutes {
		t.Fatalf("%s: settings = %+v, want the 1→2 sentinel (enabled + %d minutes) — the ladder did not run",
			where, c.Settings, writeBackSentinelMinutes)
	}
}
