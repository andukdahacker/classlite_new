# Story 10-2: Completion Notes

_Implementation record for [`10-2-archive.md`](./10-2-archive.md). Status: review._

## Dev Agent Record

### Debug Log

- **sqlc UNION nullability (the one real snag).** sqlc infers a UNION column's Go type from the FIRST branch. The archive exercise branch's `e.skill` is `NOT NULL` → `string`, but the class branch projects `NULL`, which fails to `Scan` into a non-nullable `string` at runtime. Tried `NULLIF(e.skill,'')` (sqlc typed it `bool`) and `(CASE … ELSE NULL END)::text` (sqlc typed it `interface{}`, then `string` with the cast). Resolved by keeping `skill` a plain non-null `string` across the UNION — the class branch projects `''::text` and the service maps `'' → nil` (skill is a non-empty CHECK enum, so `''` unambiguously means "class / no skill"). `class_status`/`target_band` were fine as nullable (their FIRST branch is already `NULL`).
- **`generated.Class` shape preservation.** Adding `ended_at` only to `UpdateClassStatus`'s RETURNING would have made every classes query return a bespoke row struct (sqlc names the struct `Class` only when the column set matches the table). Appended `ended_at` to ALL six full-column RETURNING/SELECT lists so they keep returning `generated.Class` (now with `EndedAt`); additive, no caller churn.
- **Pre-existing inbox test pollution (NOT this story).** `TestInbox_MarkAllRead_CallerScoped_ArchivedStaysUnread_ATDD` failed on a `idx_users_email` duplicate — a committed superuser-pool fixture (`n101b-tenantB@example.com`) leaked from a prior interrupted run (its `t.Cleanup` DELETE never fired). Deleted the orphaned rows; the full `go test -p 1 ./...` then passed uninterrupted. Touches none of this story's files.
- **Stale-cache LSP flood.** The editor LSP reported `components['schemas']` missing many known types (ArchiveItem, Notification, UserProfile, …) and phantom `requiredRolesForCopy`/module errors. All stale-cache (same as the 10-1b/10-1c observation) — CLI `tsc -b` is clean. The ONE real diagnostic it surfaced (`requiredRolesForCopy` is required on RouteRoleGate) was fixed.

### Completion Notes

- Delivered the Epic-10 archive surface (FU-4-1-A): `GET /api/archive` = ONE role-scoped UNION-ALL reversed-filter read (soft-deleted exercises + ended-≥30-days classes), honestly DB-paginated; the `/archive` FE slice (read-only table, type chips, Duplicate/Edit-a-copy on exercises only); the additive `classes.ended_at` anchor.
- **WF-8 hard gate discharged:** all 4 BE ATDD reds de-tagged green; the 3 documented no-guard controls (teacher predicate / cutoff / `SET LOCAL`) each fired the right red then reverted.
- **Deviations from the spec sketch:** (1) UNION `skill` column is non-null `string` with `''→null` mapping rather than a nullable column (sqlc analyzer limitation, documented above — semantics identical). (2) `UpdateClassStatus` stamps via SQL `now()` (not an injected `@now` param) — no new ClassService clock dependency; the archive CUTOFF still uses the injected clock. (3) The `/archive` `RouteRoleGate` omits `sectionNameKey` (the `SectionNameKey` union has no `'archive'` member and adding one pulls in PermissionDenied + i18n keys outside the frozen 17-key `STORY_10_2_KEYS`); the generic denial still blocks students. (4) `targetBand` ships as a nullable `number` (float) on the wire — consistent with the exercise contract and correct for half-bands — not the `*int` the test parse-struct declares (the ATDD exercises seed `band=nil`, so no divergence).
- **Reuse honored:** exercise Duplicate is the shipped `POST /api/exercises/{id}/duplicate` via the exercises barrel (TS-7) — no net-new duplicate backend, no fork; Duplicate vs Edit-a-copy differ only in `onSuccess` (toast-and-stay vs navigate-to-editor).
- **Deferred (unchanged from the spec):** FU-10-2-{SESSIONS, CLASS-DUPLICATE, RESTORE, ARCHIVE-PERIOD-CONFIG}.

### Implementation Plan (as executed)

1. Migration `classes.ended_at` (additive + audit-genesis backfill) → `migrate.sh up/down/up`.
2. `UpdateClassStatus` stamp + `ended_at` on all classes full-column lists → `sqlc generate`.
3. `archive.sql` `ListArchive`/`CountArchive` UNION-ALL → `sqlc generate` (iterated on the skill-nullability).
4. `ArchiveService.List` + `ArchiveItem` DTO; `ArchiveHandler.List`; route on the exercise staff chain.
5. De-tagged the 4 BE reds → green; ran the 3 WF-8 no-guard controls; added the AC7 `ended_at`-stamp store test.
6. api.yaml `ArchiveItem`/`EnvelopeArchiveList`/path → `codegen.sh` (sqlc + openapi-typescript).
7. FE slice (keys, hooks, mapping seam, states, view, route) + route registration + 17 i18n keys both locales + master-ratchet fold.
8. `ArchiveView.test.tsx` green-phase coverage + fixed `OWNER_ONLY_HREFS`.
9. Full verification: BE `go test -p 1 ./...`, gofmt/vet, codegen no-drift; FE `tsc -b`, full vitest, ESLint.

## File List

### Added

- `classlite-api/migrations/20261007120000_add_classes_ended_at.up.sql` — additive nullable `ended_at` + audit-genesis backfill.
- `classlite-api/migrations/20261007120000_add_classes_ended_at.down.sql` — drops the column.
- `classlite-api/internal/store/queries/archive.sql` — `ListArchive`/`CountArchive` UNION-ALL reversed-filter read.
- `classlite-api/internal/service/archive_service.go` — `ArchiveService` (role scope, clamp/overflow guards, type 422, cutoff) + `ArchiveItem` DTO.
- `classlite-api/internal/handler/archive_handler.go` — `ArchiveHandler.List` + wire response (GO-5 explicit nulls).
- `classlite-web/src/features/archive/` — slice: `ArchiveRoute.tsx`, `index.ts`, `api/{archiveKeys,useArchive,useDuplicateArchiveExercise}.ts`, `lib/archiveMapping.ts`, `components/{ArchiveView,ArchiveStates}.tsx`, `__tests__/ArchiveView.test.tsx`.
- (ATDD red specimens de-tagged into the normal suite: `classlite-api/internal/test/{story_10_2_helpers_test,archive_scope_atdd_test,archive_cross_tenant_rls_atdd_test,archive_contract_atdd_test}.go`; `classlite-web/src/features/archive/__tests__/{archiveI18nKeys.ts,archiveI18nParity.test.ts}` + `lib/__tests__/archiveMapping.golden.test.ts` — generated by `/bmad-tea AT 10-2`.)

### Modified

- `classlite-api/internal/store/queries/classes.sql` — `ended_at` on all full-column lists; `UpdateClassStatus` stamps it on →ended (CAS + audit preserved).
- `classlite-api/cmd/api/main.go` — construct `ArchiveService`/`ArchiveHandler` + register `GET /api/archive` on the exercise staff chain.
- `classlite-api/api.yaml` — `ArchiveItem` + `EnvelopeArchiveList` schemas + `GET /api/archive` path (params/401/403/422).
- `classlite-api/internal/test/classes_store_3_1_test.go` — AC7 `ended_at`-stamp-on-→ended store test (+ CAS guard).
- `classlite-web/src/lib/api/client.ts` — regenerated (archive schemas + path).
- `classlite-web/src/routes.tsx` — `/archive` route under AppLayout, staff `RouteRoleGate`.
- `classlite-web/src/locales/{en,vi}.json` — 17 net-new `archive.*` keys.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — import + fold `STORY_10_2_KEYS` into the master ratchet.
- `classlite-web/src/components/shared/__tests__/AppLayout.role-filtering.test.tsx` — removed `/archive` from `OWNER_ONLY_HREFS`; assert it for owner/admin/teacher, absent for student.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 10-2 → in-progress → review.

### Deleted

- None.
