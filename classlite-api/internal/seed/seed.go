// Package seed builds a deterministic, idempotent, structurally-confessed-
// synthetic dataset spanning Epics 1–8 across two multi-role tenants (Story
// 11-1a). It is verification infrastructure, not a feature: 11-2 mints real
// sessions from the credentials this emits, 11-5a drives the money-path against
// this dataset.
//
// Design constraints (project-context.md + story DD1/DD12/DD14):
//   - STORE LAYER ONLY. The seed writes rows via direct parametrized SQL inside
//     a tenant-scoped transaction (store.SetTenantContext). The SERVICE layer is
//     PROHIBITED — it would emit domain events (Epic-10 bus), write audit_logs,
//     send email, or enqueue jobs, each of which kills determinism and pollutes
//     the "clean" tenant on first run (DD1). The store's generated writers mint
//     gen_random_uuid() PKs for several tables, which are incompatible with the
//     content-hash determinism oracle (DD14); the seed therefore uses raw
//     parametrized INSERT ... ON CONFLICT DO NOTHING with DETERMINISTIC UUIDs.
//     This is store-layer in spirit (no service orchestration, proven by the
//     store-layer-only ATDD test asserting audit_logs/notifications stay empty).
//   - DETERMINISTIC + IDEMPOTENT. Every id is derived, every write is existence-
//     guarded (ON CONFLICT DO NOTHING). A second run neither duplicates nor
//     drifts (ContentHash proves it).
//   - SYNTHETIC CONFESSION. Every row that could be mistaken for real carries the
//     SyntheticMarker in-data (DD12); students are unmistakably non-natural-person
//     (@example.test, "Student Fixture" names) — no plausible VN minor identity.
package seed

import (
	"context"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// Deterministic tenant UUIDs. MUST equal test.TenantAID / test.TenantBID
// (internal/test/fixtures.go) so the seeded tenants ARE the adversarial fixture
// tenants (AC1).
const (
	CenterAID = "00000000-0000-0000-0000-000000000001"
	CenterBID = "00000000-0000-0000-0000-000000000002"
)

// Synthetic-confession markers (DD12 / AC8).
const (
	// SyntheticMarker is a loud in-data sentinel planted on every seeded row
	// that could be mistaken downstream for examiner ground truth (grade
	// feedback) or a real person. It survives a raw DB query, unlike a comment
	// in the seed source.
	SyntheticMarker = "SEED_FAKE_"
	// SyntheticEmailDomain is the namespace every seeded user email ends with,
	// so synthetic-but-minor-shaped PII can never ride a deploy path into a
	// reachable environment as a plausible real identity.
	SyntheticEmailDomain = "@example.test"
)

// DefaultCredentialsPath is the repo-relative path (from RepoRoot) where
// cmd/seed writes the raw login inputs 11-2 POSTs to /api/auth/login. It is
// DISTINCT from classlite-web/.playwright/auth.json (the session storageState,
// 11-2's OUTPUT) and is gitignored (DD3).
const DefaultCredentialsPath = "classlite-web/tests/e2e/.auth/credentials.json"

// seedPassword is the single plaintext login password every seeded user shares.
// It is written verbatim into credentials.json and bcrypt-hashed into
// users.password_hash. It is obviously synthetic and dev/test-only.
const seedPassword = "SeedFakePassw0rd!1"

// Entity-block discriminators for deterministic child UUIDs. Each entity type
// gets a distinct 8-hex block; the tenant discriminator ("000a"/"000b") lives in
// the second group; the row index fills the final 12 digits. The result is a
// valid v4-shaped UUID that is unique across entities and tenants.
const (
	blockUser       = "00000001"
	blockClass      = "00000003"
	blockSession    = "00000004"
	blockEnrollment = "00000005"
	blockExercise   = "00000006"
	blockAssignment = "00000007"
	blockSubmission = "00000008"
	blockGrade      = "00000009"
	blockAttendance = "0000000a"
	blockFile       = "0000000b"
)

// Options controls a seed run.
type Options struct {
	// Clean resets both deterministic tenants (superuser cascade) before
	// seeding, producing a fresh deterministic build. When false, the run is a
	// pure idempotent upsert over whatever already exists.
	Clean bool
}

// SeededMember is one seeded role identity, carrying the raw login inputs for
// credentials.json.
type SeededMember struct {
	Role     string
	Email    string
	Password string
	UserID   string
}

// SeededCenter describes one seeded tenant.
type SeededCenter struct {
	ID        string
	Name      string
	ShortCode string
	Members   []SeededMember
}

// Result is what a seed run produced.
type Result struct {
	Centers         []SeededCenter
	CredentialsPath string
}

// tenantPlan is the deterministic recipe for one tenant.
type tenantPlan struct {
	centerID  string
	letter    string // UUID discriminator group: "000a" / "000b"
	tag       string // human-readable tenant tag: "a" / "b"
	shortCode string
	name      string
}

var plans = []tenantPlan{
	{centerID: CenterAID, letter: "000a", tag: "a", shortCode: "SEEDFAKEA", name: SyntheticMarker + "Center A"},
	{centerID: CenterBID, letter: "000b", tag: "b", shortCode: "SEEDFAKEB", name: SyntheticMarker + "Center B"},
}

// seedUUID builds a deterministic, valid UUID from an entity block, the tenant
// discriminator, and a row index.
func seedUUID(block, letter string, n int) string {
	return fmt.Sprintf("%s-%s-4000-8000-%012d", block, letter, n)
}

// Run builds (or idempotently re-asserts) the full two-tenant Epics 1–8 dataset.
// pool may be the app role (classlite_app) or a superuser; every write is
// tenant-scoped via store.SetTenantContext and every RLS INSERT names the tenant
// center_id explicitly. No live R2/Gemini is touched.
func Run(ctx context.Context, pool *pgxpool.Pool, opts Options) (*Result, error) {
	if pool == nil {
		return nil, fmt.Errorf("seed run: pool is nil")
	}

	if opts.Clean {
		for _, p := range plans {
			id, err := parseUUID(p.centerID)
			if err != nil {
				return nil, err
			}
			if err := Reset(ctx, pool, id); err != nil {
				return nil, fmt.Errorf("seed run: clean reset %s: %w", p.centerID, err)
			}
		}
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(seedPassword), bcrypt.MinCost)
	if err != nil {
		return nil, fmt.Errorf("seed run: bcrypt: %w", err)
	}

	result := &Result{CredentialsPath: DefaultCredentialsPath}
	for _, p := range plans {
		center, err := buildTenant(ctx, pool, p, string(hash))
		if err != nil {
			return nil, fmt.Errorf("seed run: build tenant %s: %w", p.centerID, err)
		}
		result.Centers = append(result.Centers, center)
	}
	return result, nil
}

// parseUUID converts a canonical UUID string into a pgtype.UUID.
func parseUUID(s string) (pgtype.UUID, error) {
	var u pgtype.UUID
	if err := u.Scan(s); err != nil {
		return u, fmt.Errorf("parse uuid %q: %w", s, err)
	}
	return u, nil
}

// withTenantTx opens a transaction, enforces RLS (SET LOCAL ROLE classlite_app),
// sets the tenant context, runs fn, and commits. Mirrors the canonical per-write
// pattern (store.SetTenantContext + generated writers) but lets fn issue the
// deterministic raw INSERTs the content-hash oracle requires.
func withTenantTx(ctx context.Context, pool *pgxpool.Pool, centerID string, fn func(tx pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tenant tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Enforce RLS regardless of whether pool connects as app or superuser, so a
	// mis-tagged write is rejected by the INSERT WITH CHECK rather than slipping
	// past a superuser's RLS bypass.
	if _, err := tx.Exec(ctx, "SET LOCAL ROLE classlite_app"); err != nil {
		return fmt.Errorf("set role classlite_app: %w", err)
	}
	if err := store.SetTenantContext(ctx, tx, model.TenantContext{CenterID: centerID}); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
