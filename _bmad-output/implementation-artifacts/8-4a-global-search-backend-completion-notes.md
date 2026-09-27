# Story 8-4a: Completion Notes

_Implementation record for [`8-4a-global-search-backend.md`](./8-4a-global-search-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **sqlc + `similarity`/`unaccent`:** `sqlc v1.31.1` resolved `similarity()` (from the `CREATE EXTENSION pg_trgm` in the migration) and the migration-defined `immutable_unaccent(text)` wrapper with no config gymnastics — the whole `search.sql` family generated first try. No wrapper for `similarity` was needed.
- **`string_agg` nullability:** the student subtitle `string_agg(c.name, …)` initially generated as `[]byte` (sqlc can't infer an un-cast aggregate's type). A `::text` cast produced a clean `pgtype.Text` but made sqlc treat it as **non-null** — a student with no scoped enrollment returns `NULL` → a runtime scan crash into a `string`. Reverted to the un-cast `[]byte` (nil-safe) and mapped to `*string` in Go (`bytesToStringPtr`). GO-5 null preserved.
- **Two-open-tx deadlock (test):** `TestSearch_QueryCount_SizeInvariant` opened TWO `SetupDB` transactions in one function; both inserted center id `TenantAID` + identical user emails into the global (non-RLS) `centers`/`users` tables → the second INSERT blocked on the first tx's row lock → 600s timeout. Fixed by giving the two concurrent fixtures distinct tenant ids (A/B) + tokens (Alpha/Bravo).
- **Non-test helper referencing test-only symbols:** `story_8_4_helpers.go` (a non-`_test.go` file) used `pgUUID`/`uuidFromPg`, which are defined in `_test.go` files — invisible to the non-test build, so `go test` passed but `go vet`/`go build ./...` failed. Renamed to `story_8_4_helpers_test.go`.
- **EXPLAIN specific-index assertion too strict:** at 12-row test cardinality, under RLS (the injected `center_id` predicate), the planner drives the assignments→exercises join via `idx_exercises_center_created_by` + a trigram Filter rather than `idx_exercises_title_trgm` — both index-backed (no Seq Scan). Pinning the index name is exactly the planner brittleness the green-phase scaffold avoids (8-1a N1); relaxed to the AC15 structural requirement (no Seq Scan). Trigram index existence is verified by the Task-1 migration round-trip.

### Completion Notes

- **All 8 tasks complete; 20/20 ACs satisfied.** `GET /api/search` shipped on the ungated `dashboardChain`, role-branched in-service through the single audited `searchScope` fn, accent-insensitive across 5 RLS tables.
- **WF-8 HARD gate green.** ATDD authored red-first (seam-referencing) per [[reference_atdd_red_convention]], committed un-tagged (running in `go test ./...`, matching the 8-1a/8-2a committed shape). Coverage: 20-cell paired-control role×type matrix (AC6-8), 5-category J15 both-directions grid (AC9), soft-delete + soft-deleted-exercise-assignment (AC10), wildcard escape incl. escape-order (AC3), min-length/zero-query + trim + rune (AC2), accent-insensitivity Nguyen↔Nguyễn / Toan↔Toán (AC5), max-5/hasMore/`,id` tiebreak + contract value-scan (AC4), student fan-out-one-row (AC11), CountingDBTX size-invariance ≤ 5 + synthetic-N+1 probe + student=2 (AC14), EXPLAIN no-SeqScan per category incl. assignment-through-join (AC15).
- **Query-count budget:** owner/admin/teacher = 5 business queries (one per category), student = 2 (classes+assignments only — D5), short-query = 0 (short-circuit before the tx). Size-invariant (small vs 6/category+many-class student). Evidence: `evidence/search-query-count.json`.
- **Deferrals (D3/D4):** Q&A category → **FU-8-4-QA** (privacy/security, R25/R26 owner/admin exclusion); k6 nightly SLO → **FU-8-4-PERF** (Epic 9). Both back-filled in `deferred-work.md`; epic + PRD marked PARTIAL.
- **PROVISIONAL contract:** `EnvelopeSearchResults`/`SearchResults`/`SearchCategory`/`SearchResultItem` (GO-5 explicit nulls, `type` enum, `classId`/`slug`/`subtitle` nullable, NO href, min-length-3 in the `q` description). 8-4b co-finalizes + strips the PROVISIONAL marker.
- **Gates:** `go build ./...` clean; `go vet` clean (search + core packages); `gofmt` clean on all new files; full backend suite **green `-race -p 1`** (0 failures); web `tsc -b` exit 0 on the regenerated client; `codegen.sh` ran last (WF-3).
- **No deviations from spec.** Subtitle composition per AC11 (assignment = `skill · className`; class = primary skill/status; file = folder/content-type; exercise = skill; student = aggregated class names).

### Implementation Plan (as executed)

1. Task 1 — migration pair (`pg_trgm`+`unaccent`+`immutable_unaccent` wrapper + 4 functional `gin_trgm_ops` indexes); applied + verified down/up round-trip (extensions retained).
2. Task 2 — `search.sql` family (5 `:many`); `sqlc generate`.
3. Task 3 — `SearchService` + `searchScope` (explicit student case) + wildcard escape + min-length short-circuit + category builders (hasMore via LIMIT 6 slice-5).
4. Task 4 — api.yaml PROVISIONAL contract + `SearchHandler` + route on `dashboardChain`; `codegen.sh`; `go build` + `tsc -b`.
5. Task 5 — WF-8 ATDD suite (5 files + test-server/seed helpers); greened.
6. Task 6 — EXPLAIN green-phase per category + `evidence/search-query-count.json`.
7. Task 7 — gates (build/vet/gofmt/`-race -p 1`).
8. Task 8 — deferred-work + epic + PRD amendments; this sibling.

## File List

### Added
- `classlite-api/migrations/20260924120000_add_search_trgm_unaccent.up.sql` — extensions + `immutable_unaccent` wrapper + 4 functional trigram GIN indexes (AC13).
- `classlite-api/migrations/20260924120000_add_search_trgm_unaccent.down.sql` — drops indexes + wrapper, LEAVES extensions (Winston #7).
- `classlite-api/internal/store/queries/search.sql` — 5 category `:many` queries (D5/D7/D9/D10/D11).
- `classlite-api/internal/store/generated/search.sql.go` — sqlc output (XL-1, never hand-edited).
- `classlite-api/internal/service/search_service.go` — `SearchService`, `searchScope`, escaping, min-length, category builders.
- `classlite-api/internal/handler/search_handler.go` — thin `SearchHandler`.
- `classlite-api/internal/test/story_8_4_helpers_test.go` — test server + raw label seeds + category assertions.
- `classlite-api/internal/test/search_query_count_atdd_test.go` — AC14 (size-invariance, student=2, zero-on-short, synthetic-N+1).
- `classlite-api/internal/test/search_scope_matrix_atdd_test.go` — AC6/7/8 paired-control role×type matrix.
- `classlite-api/internal/test/search_cross_tenant_rls_atdd_test.go` — AC9 J15 grid + AC10 soft-delete.
- `classlite-api/internal/test/search_query_handling_atdd_test.go` — AC2/3/4/5/11.
- `classlite-api/internal/test/search_explain_plan_atdd_test.go` — AC15 EXPLAIN no-SeqScan (green-phase).
- `classlite-api/evidence/search-query-count.json` — the query-count + EXPLAIN evidence artifact.

### Modified
- `classlite-api/api.yaml` — `GET /api/search` path + PROVISIONAL `EnvelopeSearchResults`/`SearchResults`/`SearchCategory`/`SearchResultItem` schemas (AC12).
- `classlite-api/cmd/api/main.go` — wired `searchSvc`/`searchHandler` + `mux.Handle("GET /api/search", dashboardChain(...))`.
- `classlite-web/src/lib/api/client.ts` — openapi-typescript output (codegen).
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-8-4-QA (privacy) + FU-8-4-PERF (Epic 9) + label-coverage + FU-7-3-B note.
- `_bmad-output/planning-artifacts/epics/epic-08.md` — split note, corrected deps, pg_trgm+unaccent note, k6-SLO + Q&A-matrix PARTIAL, "performance" phantom note.
- `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md` — FR-67 marked PARTIAL (5-of-6 types).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 8-4a → in-progress → review.
- `_bmad-output/implementation-artifacts/8-4a-global-search-backend.md` — task/DoD checkboxes, status, change log.

### Deleted
- (none)
