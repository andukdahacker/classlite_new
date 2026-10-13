// seed_determinism_atdd_test.go — Story 11-1a ATDD (AC1 · R-11-4
// score 6 · WF-8 HARD GATE). The deterministic, idempotent seed covering all
// roles across Epics 1–8, proven with a CONTENT-HASH + GOLDEN-DIGEST oracle
// (DD14), NOT row-count equality.
//
// Why content-hash, not counts (DD14): row-count idempotence passes while
// (i) a reseed re-randomizes UUIDs (dangling FKs), (ii) ON CONFLICT DO NOTHING
// masks a partial first run, (iii) an updatable column drifts and DO-NOTHING
// never corrects it. The oracle hashes a canonical deterministic serialization
// of the seeded rows in a stable order and asserts hash(run1)==hash(run2) AND
// ==seed.GoldenDigest. Idempotency means "don't duplicate", NOT byte-identical:
// bcrypt hashes + server-default timestamps are EXCLUDED from the canonical
// form (Winston c) or the oracle flakes.
//
// Store-layer-ONLY (DD1): the seed reuses the repository/store writers and
// replicates pure transforms (bcrypt, derived bands) inline. It MUST NOT invoke
// service-layer writers that emit domain events (Epic-10 bus), write audit_logs
// (7-3a), send email (7-1a RenderInviteEmail), or enqueue jobs (4.3a) — those
// kill determinism and pollute the "clean" tenant on first run. Each tenant's
// inserts wrap in ONE tx with store.SetTenantContext (SET LOCAL
// app.current_tenant_id) or RLS blocks/mis-tags the write.
//
// RED: real `//go:build atdd_red_phase`; excluded from `go test ./...` (stays
// green). Under `-tags=atdd_red_phase` the internal/test package compile-fails
// on the GREENFIELD `internal/seed` package import below — the red signal.
//
// GREEN SEAMS (dev — Task 1, the ONE place to reconcile):
//
//	package internal/seed:
//	  Run(ctx, pool *pgxpool.Pool, Options{Clean bool}) (*Result, error)
//	    — idempotent full seed of two deterministic tenants (CenterAID/CenterBID),
//	      store-layer-only, per-tenant SetTenantContext window, deterministic UUIDs,
//	      existence-guarded (ON CONFLICT DO NOTHING). No live R2/Gemini (mock object store).
//	  ContentHash(ctx, pool, centerIDs ...pgtype.UUID) (string, error)
//	    — canonical deterministic serialization of seeded rows; EXCLUDES bcrypt
//	      password_hash + server-default timestamps from the hashed form.
//	  GoldenDigest string — the committed golden content-hash over both tenants.
//	  CenterAID, CenterBID string — deterministic tenant UUIDs; MUST equal
//	      test.TenantAID / test.TenantBID (fixtures.go).
//	  Result{ Centers []SeededCenter, CredentialsPath string }.
package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/seed"
	"github.com/jackc/pgx/v5/pgtype"
)

// AC1 — a second seed run produces an IDENTICAL content hash, equal to the
// committed golden digest. Not row-count equality (DD14).
func TestSeed_ContentHashStableAcrossRunsAndMatchesGolden(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()

	if _, err := seed.Run(ctx, pool, seed.Options{Clean: true}); err != nil {
		t.Fatalf("seed run 1: %v", err)
	}
	hash1, err := seed.ContentHash(ctx, pool, mustPgUUID(t, seed.CenterAID), mustPgUUID(t, seed.CenterBID))
	if err != nil {
		t.Fatalf("content hash run 1: %v", err)
	}

	// Second run on the SAME DB — must not duplicate, must not drift.
	if _, err := seed.Run(ctx, pool, seed.Options{Clean: false}); err != nil {
		t.Fatalf("seed run 2: %v", err)
	}
	hash2, err := seed.ContentHash(ctx, pool, mustPgUUID(t, seed.CenterAID), mustPgUUID(t, seed.CenterBID))
	if err != nil {
		t.Fatalf("content hash run 2: %v", err)
	}

	if hash1 != hash2 {
		t.Errorf("seed not idempotent: hash(run1)=%s != hash(run2)=%s", hash1, hash2)
	}
	if hash1 != seed.GoldenDigest {
		t.Errorf("seed drifted from committed golden digest: got %s want %s", hash1, seed.GoldenDigest)
	}
	// Seed's deterministic tenants MUST reuse the adversarial fixture IDs.
	if seed.CenterAID != TenantAID || seed.CenterBID != TenantBID {
		t.Errorf("seed tenant IDs must equal fixtures: A=%s/%s B=%s/%s",
			seed.CenterAID, TenantAID, seed.CenterBID, TenantBID)
	}
}

// AC1 — coverage: all roles across Epics 1–8 so chapters 1–5+8 render non-empty.
// Negative control: NO Epic-9/10 (chapter 6/7) entities — that is 11-1b.
func TestSeed_CoversAllRolesAndEpics1to8(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()
	if _, err := seed.Run(ctx, pool, seed.Options{Clean: true}); err != nil {
		t.Fatalf("seed run: %v", err)
	}

	// Coverage counts read through the superuser pool: the seeded rows are
	// COMMITTED, but a context-less app connection sees zero under the RLS
	// null-guard. We are asserting existence, so read past RLS (same idiom as
	// TestSeed_StoreLayerOnly). Reconciled to the RLS surface at green.
	sp := SuperuserPool(t)
	centerA := mustPgUUID(t, seed.CenterAID)
	for _, want := range []struct {
		label string
		sql   string
		args  []any
		min   int
	}{
		{"owner", `SELECT count(*) FROM center_members WHERE center_id=$1 AND role='owner'`, []any{seed.CenterAID}, 1},
		{"admin", `SELECT count(*) FROM center_members WHERE center_id=$1 AND role='admin'`, []any{seed.CenterAID}, 1},
		{"teacher", `SELECT count(*) FROM center_members WHERE center_id=$1 AND role='teacher'`, []any{seed.CenterAID}, 1},
		{"students>=2", `SELECT count(*) FROM center_members WHERE center_id=$1 AND role='student'`, []any{seed.CenterAID}, 2},
		{"classes active+ended", `SELECT count(DISTINCT status) FROM classes WHERE center_id=$1`, []any{seed.CenterAID}, 2},
		{"enrollments", `SELECT count(*) FROM enrollments e JOIN classes c ON c.id=e.class_id WHERE c.center_id=$1`, []any{seed.CenterAID}, 1},
		{"exercises 4 skills", `SELECT count(DISTINCT skill) FROM exercises WHERE center_id=$1 AND skill IN ('reading','listening','writing','speaking')`, []any{seed.CenterAID}, 4},
		{"assignments", `SELECT count(*) FROM assignments a JOIN classes c ON c.id=a.class_id WHERE c.center_id=$1`, []any{seed.CenterAID}, 1},
		// current_grades carries center_id directly (view over grades); it has no
		// student_id column — reconciled to the real schema at green (recon 6a4eb4d).
		{"released grades", `SELECT count(*) FROM current_grades g WHERE g.center_id=$1 AND g.released_at IS NOT NULL`, []any{seed.CenterAID}, 1},
		// The table is `attendance` (migration 20260903120000_create_attendance),
		// not `attendance_records` — reconciled to the real schema at green.
		{"attendance", `SELECT count(*) FROM attendance WHERE center_id=$1`, []any{seed.CenterAID}, 1},
		{"files", `SELECT count(*) FROM files WHERE center_id=$1`, []any{seed.CenterAID}, 1},
	} {
		got := CountRows(t, sp, want.sql, want.args...)
		if got < want.min {
			t.Errorf("coverage %q: got %d rows, want >= %d", want.label, got, want.min)
		}
	}
	_ = centerA

	// Negative: chapters 6/7 (Epic 9/10) stay empty in 11-1a (defer to 11-1b).
	if n := CountRows(t, sp, `SELECT count(*) FROM subscriptions WHERE center_id=$1`, seed.CenterAID); n != 0 {
		t.Errorf("Epic-9 subscriptions must be empty in 11-1a (that is 11-1b): got %d", n)
	}
}

// AC1/DD1 — store-layer-only: the seed produces NO service-layer side effects.
// A clean seed must leave audit_logs and notifications empty for the tenant.
func TestSeed_StoreLayerOnly_NoServiceSideEffects(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()
	if _, err := seed.Run(ctx, pool, seed.Options{Clean: true}); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	sp := SuperuserPool(t) // audit_logs/notifications are RLS-guarded; read past it to prove ZERO, not RLS-hidden.
	for _, tbl := range []string{"audit_logs", "notifications"} {
		if n := CountRows(t, sp, `SELECT count(*) FROM `+tbl+` WHERE center_id=$1`, seed.CenterAID); n != 0 {
			t.Errorf("store-only violation: seed emitted %d %s rows (service writers are PROHIBITED, DD1)", n, tbl)
		}
	}
}

// mustPgUUID parses a canonical UUID string into a pgtype.UUID (distinct from
// the google/uuid-returning mustUUID in storage_quota_race_test.go).
func mustPgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return u
}
