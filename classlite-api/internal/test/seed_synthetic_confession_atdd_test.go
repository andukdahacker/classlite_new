// seed_synthetic_confession_atdd_test.go — Story 11-1a ATDD (AC8 ·
// Mary · DD12). Every synthetic artifact STRUCTURALLY confesses it is fake —
// IN THE DATA, not merely a comment in the seed source.
//
// The failure mode is provenance collapse: a downstream query six months on
// treats seeded band-7 samples as examiner ground truth (echoes 11-0b's
// mechanism-vs-truth line). Mitigation that survives a raw DB query: a loud
// in-data marker (seed.SyntheticMarker) + non-natural-person student
// identities. Because this is an IELTS product (population includes minors),
// VN jurisdiction, and 11-8a makes staging reachable, synthetic-but-minor-
// shaped PII in a deployable env is the compliance exposure — NOT the fake
// password. Seeded students use @example.test emails + sentinel names/DOBs,
// NEVER a plausible real Vietnamese minor's identity shape.
//
// RED: `//go:build atdd_red_phase`; compile-fails on the GREENFIELD internal/seed
// seams (SyntheticMarker, SyntheticEmailDomain, Run).
//
// GREEN SEAMS (dev — Task 2):
//
//	seed.SyntheticMarker string      — e.g. "SEED_FAKE_"; a sentinel that appears
//	    in a raw-queryable column (dedicated column or identifier prefix) on EVERY
//	    seeded row class that could be mistaken for real (grades, submissions, users).
//	seed.SyntheticEmailDomain string — "@example.test"; every seeded user email ends with it.
package test

import (
	"context"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/seed"
)

// AC8 — a RAW DB query can tell seed data from real (marker survives in-data).
func TestSeed_SyntheticDataStructurallyConfesses(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()
	if _, err := seed.Run(ctx, pool, seed.Options{Clean: true}); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	sp := SuperuserPool(t)

	// Every seeded released grade must carry the in-data synthetic marker so it
	// can never be mistaken downstream for examiner ground truth.
	// current_grades carries center_id directly and has no student_id column —
	// reconciled to the real schema at green (recon 6a4eb4d).
	unmarked := CountRows(t, sp,
		`SELECT count(*) FROM current_grades g
		  WHERE g.center_id = $1
		    AND (g.feedback IS NULL OR position($2 in g.feedback) = 0)`,
		seed.CenterAID, seed.SyntheticMarker)
	if unmarked > 0 {
		t.Errorf("AC8: %d seeded grades lack the in-data synthetic marker %q — provenance collapse risk (DD12)",
			unmarked, seed.SyntheticMarker)
	}
	_ = ctx
}

// AC8 — seeded students are unmistakably non-natural-person (minors/VN compliance).
func TestSeed_StudentIdentitiesAreNonNaturalPerson(t *testing.T) {
	cleanupSeedTenants(t)
	pool := SetupRawPool(t)
	ctx := context.Background()
	if _, err := seed.Run(ctx, pool, seed.Options{Clean: true}); err != nil {
		t.Fatalf("seed run: %v", err)
	}
	sp := SuperuserPool(t)

	// Negative: NO seeded student email outside the @example.test namespace.
	bad := CountRows(t, sp,
		`SELECT count(*) FROM users u
		   JOIN center_members m ON m.user_id = u.id
		  WHERE m.center_id = $1 AND m.role = 'student'
		    AND u.email NOT LIKE $2`,
		seed.CenterAID, "%"+seed.SyntheticEmailDomain)
	if bad > 0 {
		t.Errorf("AC8: %d seeded student emails are not in the %s synthetic namespace — minor-shaped PII exposure (DD12)",
			bad, seed.SyntheticEmailDomain)
	}
	if !strings.HasPrefix(seed.SyntheticEmailDomain, "@") {
		t.Errorf("AC8: SyntheticEmailDomain must be an @-domain, got %q", seed.SyntheticEmailDomain)
	}
}
