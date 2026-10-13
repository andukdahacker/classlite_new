// testmain_lifecycle_atdd_test.go — Story 11-1a ATDD (AC6 · DD16 ·
// R-11-5). The test-DB lifecycle is TestMain-owned, migrates as the NON-superuser
// role prod will use (11-8a), and resolves the immutable-GRANT replay landmine.
//
// (a) A TestMain in internal/test owns ensure-DB + `migrate up` so local == CI
//     (a CI-yaml-only migrate step widens the divergence).
// (b) Migrate runs as the SAME dedicated non-superuser migration role prod uses
//     — if the test migrate runs as superuser, CI never exercises the privilege
//     model it guards and a superuser-needing migration detonates only in prod.
// (c) The immutable 20260601110000 hardcodes GRANT CONNECT ON DATABASE classlite_dev;
//     a fresh classlite_test replaying the chain errors / grants on a dead DB.
//     Resolution (DD16d): TestMain CREATE DATABASE classlite_dev as a throwaway so
//     the old GRANT replays clean, then runs tests against classlite_test.
//
// RED: `//go:build atdd_red_phase`; compile-fails on the GREENFIELD package-test
// seams EnsureTestDB / TestDBName (and seed is not imported here).
//
// GREEN SEAMS (dev — Task 6):
//
//	test.TestDBName string          — "classlite_test".
//	test.EnsureTestDB() error       — called from TestMain; ensures classlite_test
//	    exists (+ the throwaway classlite_dev for the immutable GRANT replay) and
//	    runs `migrate up` as the non-superuser migration role via TEST_DATABASE_URL.
//	func TestMain(m *testing.M)     — ensure+migrate, then m.Run(). (NOT defined in
//	    this red file to avoid a duplicate-TestMain conflict at green.)
package test

import (
	"context"
	"testing"
)

// AC6 — after TestMain, tests run against classlite_test, migrated by a role
// that is NOT a superuser (so the privilege model is actually exercised).
func TestTestMain_MigratesAsNonSuperuserAgainstTestDB(t *testing.T) {
	if err := EnsureTestDB(); err != nil {
		t.Fatalf("ensure test db: %v", err)
	}
	pool := SetupRawPool(t)
	ctx := context.Background()

	var dbName string
	if err := pool.QueryRow(ctx, `SELECT current_database()`).Scan(&dbName); err != nil {
		t.Fatalf("current_database: %v", err)
	}
	if dbName != TestDBName {
		t.Errorf("tests must run against %q, got %q (DD16)", TestDBName, dbName)
	}

	// The connected role MUST NOT be a superuser (RLS is enforced + the privilege
	// model is exercised, DD16b).
	var isSuper bool
	if err := pool.QueryRow(ctx,
		`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`).Scan(&isSuper); err != nil {
		t.Fatalf("read rolsuper: %v", err)
	}
	if isSuper {
		t.Errorf("test connection is a SUPERUSER — RLS bypassed, privilege model not exercised (DD16b)")
	}

	// Schema was migrated (a known late-epic table exists).
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'current_grades')`).Scan(&exists); err != nil {
		t.Fatalf("check migration: %v", err)
	}
	if !exists {
		t.Errorf("TestMain did not run `migrate up` against %q", TestDBName)
	}
}
