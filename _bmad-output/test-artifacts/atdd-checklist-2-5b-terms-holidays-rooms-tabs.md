---
storyId: '2.5b'
storyKey: '2-5b-terms-holidays-rooms-tabs'
storyFile: '_bmad-output/implementation-artifacts/2-5b-terms-holidays-rooms-tabs.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-2-5b-terms-holidays-rooms-tabs.md'
detectedStack: 'fullstack (Go backend + React/Vite/Playwright frontend)'
inputDocuments:
  - 'docs/project-context.md'
  - 'docs/bmad-story-conventions.md'
  - '_bmad-output/implementation-artifacts/2-5b-terms-holidays-rooms-tabs.md'
  - '_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab.md'
  - '_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/atdd-checklist-2-2-class-template-and-spawning-api.md'
  - 'classlite-api/internal/test/class_templates_rls_test.go'
  - 'classlite-api/internal/test/helpers.go'
  - 'classlite-api/internal/test/story_2_2_helpers.go'
  - 'classlite-api/internal/test/story_2_5a_helpers.go'
  - 'classlite-api/internal/handler/settings_handler.go'
  - 'classlite-api/internal/handler/settings_handler_atdd_test.go'
  - 'classlite-api/internal/service/settings.go'
  - 'classlite-web/src/features/settings/SettingsPage.tsx'
  - 'classlite-web/src/features/settings/ProfileTab.tsx'
  - 'classlite-web/src/features/settings/api/settingsKeys.ts'
  - 'classlite-web/src/features/settings/api/__tests__/handlers.ts'
  - 'classlite-web/src/features/settings/__tests__/SettingsPage.test.tsx'
  - 'classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts'
  - 'classlite-web/e2e/route-bundle-boundaries.spec.ts'
generatedTestFiles:
  - 'classlite-api/internal/test/terms_rls_test.go'         # NEW — 4 RLS tests
  - 'classlite-api/internal/test/holidays_rls_test.go'      # NEW — 2 RLS tests
  - 'classlite-api/internal/test/rooms_rls_test.go'         # NEW — 3 RLS + 1 AC6 UNIQUE test
  - 'classlite-web/src/features/settings/api/__tests__/handlers.ts'  # EXTENDED — terms/holidays/rooms MSW factories + roomNameTaken409 + list*500 error variants + settingsHandlers2_5b handler set
  - 'classlite-web/src/features/settings/__tests__/TermCalendarTab.test.tsx'  # NEW — 12 tests
  - 'classlite-web/src/features/settings/__tests__/RoomsTab.test.tsx'         # NEW — 12 tests
  - 'classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts'  # EXTENDED — STORY_2_5B_KEYS block (57 keys) + prefix ratchet + interpolation parity
  - 'classlite-web/e2e/route-bundle-boundaries.spec.ts'  # EXTENDED — Story 2-5b AC14 block
generationMode: 'ai-sequential-in-process'
stepsCompleted:
  - 'step-01-preflight-and-context'
  - 'step-02-generation-mode'
  - 'step-03-test-strategy'
  - 'step-04-generate-tests'
  - 'step-05-validate-and-complete'
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-15'
riskDischarge:
  - 'R1 (score=9): 10 RLS tests across terms/holidays/rooms (8-row minimum per story-spec AC12 + John ACCEPT compromise met; UNIQUE-constraint AC6 test added on rooms table)'
  - 'R38 (score=6): STORY_2_5B_KEYS closed-literal (57 keys) + 3-prefix ratchet + assertI18nInterpolationParity — inherited framework from Story 1-7c'
---

# ATDD Red-Phase Checklist — Story 2.5b

**Story:** `2-5b-terms-holidays-rooms-tabs`
**Baseline commit:** `1a01f9c` (Story 2-5a `/bmad-code-review 2-5a` Round 1 `review → done`)
**ATDD invocation:** `/bmad-tea AT 2-5b` on 2026-07-15
**Status:** RED phase specimens committed. Ready for `/bmad-dev-story 2-5b` hand-off.

## Step 1 — Preflight & Context

**Stack detection:** `fullstack` — `classlite-api/go.mod` + `classlite-web/package.json` + `classlite-web/playwright.config.ts` all present. Effective test stack for this workflow run: **fullstack** (both surfaces exercised).

**Prerequisite check:**
- ✅ Story approved with 16 clear ACs (post party-mode fold from parent 2-5 on 2026-07-14 — all folds ACCEPTed inline).
- ✅ `playwright.config.ts` present at `classlite-web/playwright.config.ts`.
- ✅ `vitest.config.ts` present at `classlite-web/vitest.config.ts`.
- ✅ Go test infra present at `classlite-api/internal/test/` — `SetupDB`, `TenantContext`, `AssertRLSViolation`, `TenantAID`, `TenantBID`, `CreateCenterWithID` all available.
- ✅ Dev environment active (main branch, clean tree).

**TEA config resolved** (from `_bmad/tea/config.yaml`):
- `test_stack_type: auto` → fullstack effective.
- `risk_threshold: p1` — P0/P1 mandatory; P2/P3 discretionary.
- `tea_use_playwright_utils: true` — Full UI+API profile (e2e/ uses full Playwright).
- `tea_browser_automation: auto` — Playwright CLI available.

**Persistent facts loaded:** `docs/project-context.md` (83-rule contract — R1/R38/GO-1..7/TEST-FE-1..6/TEST-BE-1..5 all applied) + `docs/bmad-story-conventions.md` (600-line spec ceiling honored — story file at 274 lines with 54% headroom).

**Anchors read for context-engineering** (parent context loaded before generation, sequential in-process mode elected — subagent dispatch declined per prior 2-3c/2-4 precedent):
- **Story spec:** 16 ACs + 10 tasks + inventory of ~30 file paths.
- **Pattern mirrors:** `class_templates_rls_test.go` (J15 6-pattern grid to mirror for 3 new tenant-scoped tables); `settings_handler_atdd_test.go` (Story 2-5a's 2-endpoint pattern extended by 12 more); `SettingsPage.test.tsx` + `ProfileTab.test.tsx` (shipped tab-render patterns).
- **MSW seam:** `src/features/settings/api/__tests__/handlers.ts` (extended in-place with 3 entity factories + 4 error variants).
- **i18n parity anchor:** `i18n-parity-coverage.test.ts` STORY_2_5A_KEYS block at line 1200-1281 (mirrored shape for STORY_2_5B_KEYS at line 1290+).
- **Bundle boundary anchor:** `route-bundle-boundaries.spec.ts` Story 2-5a block at line 568-616.

## Step 2 — Generation Mode

**Decision: sequential in-process.** Parent context has every anchor loaded (14 files listed above). Subagent dispatch would re-load the same 25k-token surface with no context gain and 3× wall-clock cost. Matches Story 2-3c + 2-4 precedent.

## Step 3 — Test Strategy

Story 2-5b lands 3 new tenant-scoped resource families (`terms`, `holidays`, `rooms`) + 12 REST endpoints + 2 tab bodies replacing 2-5a placeholders. The **R1 discharge protocol** requires per-table cross-tenant matrices; the **AC6 UNIQUE(center_id, LOWER(name))** invariant requires a separate DB-layer constraint test; the **AC13 i18n parity** ratchet requires a closed-literal STORY_2_5B_KEYS block with prefix guard.

**Mock discipline honored end-to-end:**
- Backend RLS: real DB in `SetupDB(t)` transaction; NEVER mock pgx (TEST-BE-2).
- Backend handler ATDD (deferred to green-phase Task 5 per story spec — thin CRUD wrappers, inline dev tests cover the surface): real middleware + real service + real DB via `NewTestServer` pattern (TEST-BE-3).
- Frontend tab tests: real QueryClient + real Zustand + MSW at HTTP boundary (TEST-FE-1). One MSW seam per test file. `retry: false` in QueryClient.
- i18n parity: `assertI18nParity` + `assertI18nInterpolationParity` from Story 1-7c's shipped four-layer framework.

**Deviation from Story 2.2's ATDD footprint:** Story 2.2 shipped 6 backend red-phase files including full handler ATDD + service branch matrix (`teacher resolution branches A/B/C/D`, invite dedup + race, audit atomicity). Story 2-5b's handlers are **thin CRUD wrappers** with no comparable business-logic complexity (no branch matrix, no invite fanout, no race resolution). Handler + service ATDD is DEFERRED to green-phase Task 5 (per story spec's "Backend test suite" bullet with detailed inline instructions). This ATDD run focuses red-phase evidence on the two irreducible risks:
- **R1** (RLS enforcement across 3 new tables) — mandatory pre-green.
- **R38** (i18n parity) + **AC14** (bundle boundary) — mandatory pre-green.

**AC → file matrix**

| AC | Requirement | Red-phase file(s) | Test count |
|---|---|---|---|
| AC1 | Term calendar tab body = Terms + Holidays sections, uniform Edit button, state pill client-derived | `TermCalendarTab.test.tsx` | 5 (three-state + uniform Edit + state pill) |
| AC2 | Rooms tab body + synthetic Google Meet row visible/hidden by `google_meet_connected` | `RoomsTab.test.tsx` | 5 (three-state + synthetic-visible + synthetic-hidden) |
| AC3 | Empty state pinned copy (Sally-S9 encouraging tone) | `TermCalendarTab.test.tsx` + `RoomsTab.test.tsx` | 2 |
| AC4 | Loading / Empty / Error trilogy per UX-1 | folded into three-state tests above | (covered) |
| AC5 | CRUD via shadcn `<Dialog>` + `<AlertDialog>` | `TermCalendarTab.test.tsx` + `RoomsTab.test.tsx` | 6 (Add/Edit/Delete × 2 tabs) |
| AC6 | UNIQUE(center_id, LOWER(name)) 409 → inline field error | `rooms_rls_test.go` (DB constraint) + `RoomsTab.test.tsx` (frontend surface) | 2 (SQLSTATE 23505 assertion + inline field error surface) |
| AC7 | 12 endpoints + middleware chain | DEFERRED to green-phase Task 5 (handler ATDD inline per story spec) | 0 (see deviation note) |
| AC8 | RLS 4-policy per table | `terms_rls_test.go` + `holidays_rls_test.go` + `rooms_rls_test.go` — covered inside cross-tenant grid | (covered) |
| AC9 | sqlc queries (`ListXxxByTenant`, CRUD × 3) | Compile-time gate at green-phase Task 1 (sqlc generate) | 0 |
| AC10 | Services + handlers + audit-on-mutation | DEFERRED (see AC7 note) | 0 |
| AC11 | Replace 3 tab placeholders in `SettingsPage.tsx` | `TermCalendarTab.test.tsx` + `RoomsTab.test.tsx` (tabpanel testid presence) | (covered) |
| AC12 | 8-row RLS adversarial matrix minimum | `terms_rls_test.go` + `holidays_rls_test.go` + `rooms_rls_test.go` | **10 (>= 8 minimum)** |
| AC13 | STORY_2_5B_KEYS closed literal + prefix ratchet + interpolation parity | `i18n-parity-coverage.test.ts` — extended | 57 keys + 3 tests (parity, interpolation, prefix) |
| AC14 | Route-bundle chunk isolation for terms + rooms tabpanels | `route-bundle-boundaries.spec.ts` — extended | 1 Playwright test |
| AC15 | Axe zero violations across new tab bodies × 2 locales | `TermCalendarTab.test.tsx` + `RoomsTab.test.tsx` | 4 (en + vi × 2 tabs) |
| AC16 | Test coverage delta ~+80-120 tests (comprehensive per spec) | GREEN-phase Task 5 + 7 (inline dev + expansion) | (RED ships ~32 tests + ~57 parity keys; balance lands during green) |

**Red-phase deliverable size:** 8 files, ~32 tests + 57 parity keys.

**Green-phase runway (dev inline expansion to reach spec's ~+80-120 tests):**
- Backend service ATDD (Task 5): ~15 tests (List/Create/Update/Delete × 3 entities + tenant-mismatch + audit atomicity)
- Backend handler ATDD (Task 5): ~30 tests (CRUD × 4 methods × 3 entities + envelope + 401/403/429 with Retry-After + ROOM_NAME_TAKEN 409)
- Backend store integration (Task 5): folded into service tests via real DB in tx
- Frontend hook tests (Task 7): ~30 tests (useTerms + useMutateTerm × 3 entities × cache-invalidation + optimistic-rollback + query-key structure)
- Total: RED ~32 + GREEN inline ~75 = ~107 tests. Sits inside the story-spec ~+80-120 range.

## Step 4 — Files Generated (this run)

```
classlite-api/internal/test/terms_rls_test.go              4 tests (READ, INSERT, UPDATE, DELETE)
classlite-api/internal/test/holidays_rls_test.go           2 tests (READ, INSERT)
classlite-api/internal/test/rooms_rls_test.go              4 tests (READ, INSERT, UPDATE, AC6 UNIQUE)
classlite-web/src/features/settings/api/__tests__/handlers.ts             EXTENDED (terms/holidays/rooms factories + roomNameTaken409 + list*500 + settingsHandlers2_5b)
classlite-web/src/features/settings/__tests__/TermCalendarTab.test.tsx    12 tests
classlite-web/src/features/settings/__tests__/RoomsTab.test.tsx           12 tests
classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts         EXTENDED (STORY_2_5B_KEYS 57 keys + prefix ratchet + interpolation parity)
classlite-web/e2e/route-bundle-boundaries.spec.ts                          EXTENDED (Story 2-5b AC14 block — settings-tabpanel-terms + -rooms)
```

## Step 5 — Red-Phase Verification

**Backend RLS tests (runtime red signal):**
```
go test -run "TestRLS_(Term|Holiday|Room)" ./internal/test/
```
Result: **10/10 FAIL** with `ERROR: relation "{terms|holidays|rooms}" does not exist (SQLSTATE 42P01)` — mapping 1:1 to green-phase Task 1 (migrations). AC6 UNIQUE test fails on the same missing-table signal until Task 1.3 lands the UNIQUE index.

**Backend package compile still clean:**
```
go build ./...   # clean
go vet ./internal/test/...   # clean
```
Shipped test suites (Story 2-5a handler tests + Story 2-2 RLS tests) confirmed green — no regression from the new RLS files (they use raw SQL, no shared-symbol changes).

**Frontend tsc red signal:**
```
npx tsc --noEmit -p tsconfig.app.json
```
Result: **exactly 2 TS2307 errors** on the two expected missing modules:
- `Cannot find module '@/features/settings/TermCalendarTab'` — mapping 1:1 to green-phase Task 6.1
- `Cannot find module '@/features/settings/RoomsTab'` — mapping 1:1 to green-phase Task 6.2

`npx tsc --noEmit -p tsconfig.e2e.json` — **clean**.

**Frontend i18n parity red signal:**
```
npx vitest run i18n-parity-coverage.test.ts
```
Result: **1 failed / 349 passed** — `assertI18nParity(STORY_2_5B_KEYS)` fails on all 57 missing keys with full readable diff. Zero regression on shipped STORY_2_5A_KEYS block or Epic 1D per-story parity blocks. Amelia flips green by adding the 57 keys to `en.json` + `vi.json` per Task 8.

## Green-phase task order (recommended by TEA)

Optimized for fastest visible feedback per §3.6:

1. **Task 8.1** — Add STORY_2_5B_KEYS (57 keys) to `en.json` + `vi.json`. `i18n-parity-coverage.test.ts` Story 2-5b block goes green immediately.
2. **Task 1.1** — Migration `20260714120100_create_terms.up.sql` + `.down.sql` (mirror `class_templates.up.sql:29-55` 4-policy pattern). `terms_rls_test.go` 4 tests go green.
3. **Task 1.2** — Migration `20260714120200_create_holidays.up.sql`. `holidays_rls_test.go` 2 tests go green.
4. **Task 1.3** — Migration `20260714120300_create_rooms.up.sql` including `UNIQUE(center_id, LOWER(name))` index. `rooms_rls_test.go` 4 tests go green (including AC6 UNIQUE).
5. **Task 1.4-1.6** — sqlc queries for terms/holidays/rooms + `scripts/codegen.sh`. Generated Go compiles.
6. **Task 3** — api.yaml + regen (12 endpoints + ~15 schemas).
7. **Task 4** — Services + handlers + `ROOM_NAME_TAKEN` error code + settingsChain wiring in `main.go`.
8. **Task 5** — Backend test suite (service ATDD + handler ATDD + store integration + 429 with Retry-After). Follows the shipped `settings_handler_atdd_test.go` pattern.
9. **Task 6.1** — `TermCalendarTab.tsx` (list + form dialog + delete confirm + terms/holidays sections). `TermCalendarTab.test.tsx` 12 tests go green.
10. **Task 6.2** — `RoomsTab.tsx` (list + form dialog + delete + synthetic Meet row + UNIQUE-conflict field error). `RoomsTab.test.tsx` 12 tests go green.
11. **Task 6.3-6.7** — settingsKeys extensions + useTerms/useHolidays/useRooms + useMutateTerm/useMutateHoliday/useMutateRoom + form components.
12. **Task 7** — Frontend hook tests + Storybook (per-tab ≥3 variants per DoD).
13. **Task 9** — `npm run build` + `npx playwright test route-bundle-boundaries.spec.ts` — Story 2-5b bundle assertion goes green.
14. **Task 10** — Full regression sweep + Storybook + `codegen.sh` last (per WF-3).

## Deferred to green-phase inline dev (per §3 strategy)

- **Backend service ATDD** (~15 tests) — TermService/HolidayService/RoomService List/Create/Update/Delete + audit-on-mutation + tenant-mismatch. Mirror shipped `settings_service_test.go` mock-store pattern per TEST-BE-4.
- **Backend handler ATDD** (~30 tests) — TermHandler/HolidayHandler/RoomHandler CRUD × envelope + 401/403/429 with `Retry-After` header + ROOM_NAME_TAKEN 409 mapping + tenant mismatch. Follow shipped `settings_handler_atdd_test.go` pattern with new `NewSettings2_5BTestServerForUser` helper in `story_2_5b_helpers.go`.
- **Frontend hook tests** (~30 tests) — cache-invalidation on mutations + optimistic-triple rollback per FW-2 + query-key structure per TS-3.

## What is NOT in scope for this ATDD run

- **Storybook variants** — deferred to green-phase Task 7 (per DoD-6 which pins ≥3 variants per tab body).
- **Playwright smoke for full CRUD flow** — deferred to green-phase Task 10.4 (session-cache seeding still outstanding per FU-2-4-J).
- **Term adjacency SQL constraint** — filed as FU-2-5-O (v1 advisory-only per AC1).
- **Room capacity live-check on session assign** — FU-2-5-P (Story 3.x consumer).
- **ROOM_IN_USE 409 on DELETE** — Story 3.2 planted marker per AC7 table row.
- **Google Meet OAuth wire-up** — Story 2-5c.

## Hand-off

Story `2-5b` sprint status: `ready-for-dev` (transitioned from `backlog` during preflight — 2-5a gate cleared at commit `1a01f9c`). Story file frontmatter: `baseline_commit: 1a01f9c`. Story file Status: `ready-for-dev`.

Task 0.1 checked (`/bmad-tea AT 2-5b` executed). Task 0.2 recorded N/A.

**Recommended next command:** `/bmad-dev-story 2-5b` on Amelia's context (same LLM — Ducdo has invoked this run inside the same dev-story session).
