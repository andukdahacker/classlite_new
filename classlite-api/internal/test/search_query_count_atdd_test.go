// search_query_count_atdd_test.go — Story 8-4a (AC14 · D8 · risk=8 · WF-8 HARD GATE).
// The R31/PERF-2 query-count keystone REUSED from 8-1a (internal/test/query_counter.go)
// — the counting boundary is the tx the SERVICE runs on, so a subtitle N+1 or a
// per-hit lookup is caught, not false-passed.
//
// GREEN-PHASE (authored red-first per [[reference_atdd_red_convention]] against the
// seams below; committed green, un-tagged, running in `go test ./...` — matches the
// 8-1a/8-2a committed shape). GREEN SEAMS this file bound to:
//   - service.NewSearchService(db, clk) *SearchService
//   - (*SearchService).Search(ctx, tc, rawQuery) (*service.SearchResults, error)
//   - service.SearchResults / SearchCategory / SearchResultItem
//   - maxSearchQueries (this file — the single-source ceiling)
//   - test.NewCountingDBTX (reused unchanged from 8-1a)
//
// N = 1 (SET LOCAL, filtered) + k sqlc calls. An OWNER runs all 5 category queries
// (widest fan-out); a student runs only 2. The ceiling is the owner's 5.
package test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// maxSearchQueries is the per-invocation business-query ceiling for the WIDEST caller
// (owner/admin — all 5 categories: classes, assignments, students, exercises, files).
// Each category is ONE set-based query; the subtitle joins are folded in (no N+1,
// PERF-2/R-5). A student runs only classes+assignments (2). CQ-3 single source.
const maxSearchQueries = 5

// searchSeedCountFixture seeds `perCategory` matching rows in EVERY category (all
// sharing the token) plus a student enrolled in many classes (the D11 fan-out probe).
// Returns the owner caller's id + the center id string.
func searchSeedCountFixture(t *testing.T, db *TxDB, centerPg pgtype.UUID, token string, perCategory int) (pgtype.UUID, string) {
	t.Helper()
	_ = TenantContext(t, db, centerPg)
	cid := dashPGToUUID(t, centerPg)

	teacher := CreateUser(t, db, "t-"+token+"@qc.test", "Teacher "+token)
	CreateCenterMember(t, db, teacher.ID, centerPg, "teacher")
	owner := CreateUser(t, db, "o-"+token+"@qc.test", "Owner "+token)
	CreateCenterMember(t, db, owner.ID, centerPg, "owner")
	tID := dashPGToUUID(t, teacher.ID)

	var classes []uuid.UUID
	for i := 0; i < perCategory; i++ {
		c := searchSeedClass(t, db, cid, tID, fmt.Sprintf("%s Class %d", token, i))
		classes = append(classes, c)
		ex := searchSeedExercise(t, db, cid, tID, fmt.Sprintf("%s Exercise %d", token, i))
		searchSeedAssignment(t, db, cid, c, ex, tID)
		searchSeedFile(t, db, cid, tID, fmt.Sprintf("%s File %d", token, i))
		st := searchSeedStudentNamed(t, db, cid, fmt.Sprintf("s-%s-%d@qc.test", token, i), fmt.Sprintf("%s Student %d", token, i))
		insertEnrollmentRaw(t, db, cid, st, c, "active")
	}
	// A student enrolled in MANY classes: a flat-JOIN subtitle would fan this out to
	// N rows (D11/R-4); a per-hit subtitle lookup would inflate the owner query count.
	if len(classes) > 0 {
		many := searchSeedStudentNamed(t, db, cid, "s-"+token+"-many@qc.test", token+" Manyclass")
		for _, c := range classes {
			insertEnrollmentRaw(t, db, cid, many, c, "active")
		}
	}
	return owner.ID, UUIDString(centerPg)
}

// AC14 — the owner query count is SIZE-INVARIANT: a 1-row-per-category fixture and a
// 6-row-per-category-plus-many-class-student fixture yield the SAME ≤N count. A
// subtitle N+1 or per-hit lookup breaks this (Murat C1/R-5).
func TestSearch_QueryCount_SizeInvariant_ATDD(t *testing.T) {
	// The two fixtures use DISTINCT center ids + tokens because both SetupDB
	// transactions stay open until this function returns (t.Cleanup) — sharing a
	// center id or a user email would make the second INSERT block on the first
	// tx's row lock in the global (non-RLS) centers/users tables.
	dbSmall := SetupDB(t)
	centerSmall := CreateCenterWithID(t, dbSmall, TenantAID, "Center A", "center-a")
	ownerSmall, centerSmallID := searchSeedCountFixture(t, dbSmall, centerSmall.ID, "Alpha", 1)

	counterSmall := NewCountingDBTX(dbSmall)
	svcSmall := service.NewSearchService(counterSmall, clock.RealClock{})
	tcSmall := model.TenantContext{CenterID: centerSmallID, UserID: UUIDString(ownerSmall), Role: "owner", EmailVerified: true}
	counterSmall.Reset()
	if _, err := svcSmall.Search(context.Background(), tcSmall, "Alpha"); err != nil {
		t.Fatalf("small owner search: %v", err)
	}
	smallCount := counterSmall.Count()

	dbLarge := SetupDB(t)
	centerLarge := CreateCenterWithID(t, dbLarge, TenantBID, "Center B", "center-b")
	ownerLarge, centerLargeID := searchSeedCountFixture(t, dbLarge, centerLarge.ID, "Bravo", 6)

	counterLarge := NewCountingDBTX(dbLarge)
	svcLarge := service.NewSearchService(counterLarge, clock.RealClock{})
	tcLarge := model.TenantContext{CenterID: centerLargeID, UserID: UUIDString(ownerLarge), Role: "owner", EmailVerified: true}
	counterLarge.Reset()
	if _, err := svcLarge.Search(context.Background(), tcLarge, "Bravo"); err != nil {
		t.Fatalf("large owner search: %v", err)
	}
	largeCount := counterLarge.Count()

	if smallCount == 0 {
		t.Fatalf("AC14 harness NO-OP: owner search counted 0 business queries — the counter is wrapping the wrong boundary")
	}
	if smallCount > maxSearchQueries {
		t.Errorf("AC14 ≤N BREACH: small owner search ran %d business queries, want ≤ %d", smallCount, maxSearchQueries)
	}
	if largeCount != smallCount {
		t.Errorf("AC14 NOT SIZE-INVARIANT: small fixture ran %d queries, large (≥6/category + many-class student) ran %d "+
			"— a subtitle N+1 or per-hit lookup crept in (PERF-2/R-5)", smallCount, largeCount)
	}
}

// AC14 — a STUDENT runs ONLY the classes + assignments queries (2), never the other
// three (D5 hard scope). Documents the exact student budget the evidence records.
func TestSearch_QueryCount_StudentTwoQueries_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	seed := searchSeedMatrixCenter(t, db, center.ID) // has a student caller enrolled in classA

	counter := NewCountingDBTX(db)
	svc := service.NewSearchService(counter, clock.RealClock{})
	tc := model.TenantContext{CenterID: seed.centerID, UserID: UUIDString(seed.studentCaller), Role: "student", EmailVerified: true}
	counter.Reset()
	if _, err := svc.Search(context.Background(), tc, searchMatrixToken); err != nil {
		t.Fatalf("student search: %v", err)
	}
	if got := counter.Count(); got != 2 {
		t.Errorf("AC14 student budget: student ran %d business queries, want exactly 2 (classes + assignments only — D5)", got)
	}
}

// AC2 — a <3-rune query issues ZERO category business queries (short-circuit BEFORE
// the tx, D7/Murat C2). The palette polls per keystroke; "type more" must be free.
func TestSearch_QueryCount_ZeroOnShortQuery_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	owner, centerID := searchSeedCountFixture(t, db, center.ID, "Alpha", 1)

	counter := NewCountingDBTX(db)
	svc := service.NewSearchService(counter, clock.RealClock{})
	tc := model.TenantContext{CenterID: centerID, UserID: UUIDString(owner), Role: "owner", EmailVerified: true}

	for _, q := range []string{"", "  ", "ab", " a "} {
		counter.Reset()
		if _, err := svc.Search(context.Background(), tc, q); err != nil {
			t.Fatalf("short-query search %q: %v", q, err)
		}
		if got := counter.Count(); got != 0 {
			t.Errorf("AC2 short query %q issued %d category queries, want 0 (must short-circuit before the tx)", q, got)
		}
	}

	// Review-hardening short-circuits (/code-review 8-4a) — each must ALSO issue zero
	// category queries and return no error, never a Seq-Scanning '%%' pattern, an
	// unbounded pattern, or a 500-inducing bad param.
	hardening := []struct {
		name string
		q    string
	}{
		// P1 — a query of bare combining diacritics (U+0301) is 3 RAW runes but
		// immutable_unaccent collapses it to empty; the UNACCENTED-length floor (D9)
		// must treat it as too-short, not ship a '%%' pattern that Seq-Scans 5 tables.
		{"combining-marks-collapse-to-empty", "́́́"},
		// P2 — over the SearchMaxQueryLength ceiling: the amplification guard short-circuits.
		{"over-max-length", strings.Repeat("a", service.SearchMaxQueryLength+1)},
		// P3 — invalid UTF-8 would be rejected by pgx as a 500; the guard returns empty.
		{"invalid-utf8", "\xff\xfe\xfd\xfc"},
	}
	for _, tc2 := range hardening {
		counter.Reset()
		res, err := svc.Search(context.Background(), tc, tc2.q)
		if err != nil {
			t.Errorf("hardening %s: want nil error (graceful empty), got %v", tc2.name, err)
			continue
		}
		if got := counter.Count(); got != 0 {
			t.Errorf("hardening %s issued %d category queries, want 0 (must short-circuit before the tx)", tc2.name, got)
		}
		if res == nil || len(res.Classes.Items) != 0 || len(res.Students.Items) != 0 ||
			len(res.Exercises.Items) != 0 || len(res.Assignments.Items) != 0 || len(res.Files.Items) != 0 {
			t.Errorf("hardening %s: want all-empty results", tc2.name)
		}
	}
}

// AC14 — PROVE the counter is not a no-op: a synthetic N+1 on the counting tx must
// exceed the ceiling (else every ≤N assertion here false-passes). Mirrors the 8-1a probe.
func TestSearch_QueryCount_DetectsSyntheticNPlus1_ATDD(t *testing.T) {
	db := SetupDB(t)
	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	_ = TenantContext(t, db, center.ID)

	counter := NewCountingDBTX(db)
	ctx := context.Background()
	tx, err := counter.Begin(ctx)
	if err != nil {
		t.Fatalf("counting begin: %v", err)
	}
	counter.Reset()

	const syntheticRows = maxSearchQueries + 5
	var one int
	for i := 0; i < syntheticRows; i++ {
		if err := tx.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
			t.Fatalf("synthetic query %d: %v", i, err)
		}
	}
	if counter.Count() <= maxSearchQueries {
		t.Errorf("AC14 harness is a NO-OP: a synthetic %d-query N+1 counted only %d (≤ ceiling %d) — "+
			"the counting boundary is wrong; every ≤N assertion would false-pass", syntheticRows, counter.Count(), maxSearchQueries)
	}
}
