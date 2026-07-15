---
baseline_commit: TBD-after-2-5a
---

# Story 2.5b: Center Settings — Terms + Holidays + Rooms Tabs

Status: backlog

<!-- Split 2 of 3 from parent story 2-5. Depends on 2-5a shipping the /settings shell + tab-strip + Profile tab. Baseline commit updates to whatever 2-5a lands as `done`. -->
<!-- Ships 3 CRUD entities (terms, holidays, rooms) + 3 tab body implementations. Backend: 3 new tenant-scoped tables + RLS 4-policy per table + 12 CRUD endpoints + 3 services + 3 handlers. Frontend: 3 tab bodies replacing the placeholders 2-5a shipped. -->
<!-- Owner-only inherited from 2-5a. All new tables tenant-scoped with RLS 4-policy per Winston-B2 + John ACCEPT. -->

## Story

As a **center Owner**,
I want to **manage the term calendar, public holidays, and physical rooms from `/settings`**,
so that **Story 3.x class scheduling has calendar boundaries + room options ready to consume**.

## Response Envelope Contract

Inherits shipped `{ data, meta }` success + `{ error: { code, message, requestId } }` error envelopes.

## Acceptance Criteria

1. **Term calendar tab replaces the 2-5a placeholder** (mockup s49:6978-7040). Two sections:
   - `Terms` — list of term rows (name / date range / state pill Current|Upcoming|Past / Edit button). State pill derived client-side from `startDate`/`endDate` vs `Date.now()`.
   - `Holidays & breaks` — list of holiday rows (name / date / state pill).

   **All rows render `Edit` button uniformly** [Sally-S6 REJECTED — mockup shows Edit uniformly; add view/edit split adds state permutation for zero user demand]. Past-term retroactive edit is Owner's discretion; audit-log-within-tx captures every change for accountability.

2. **Rooms tab replaces the 2-5a placeholder** (mockup s49:7132-7175). List of room rows: name (required, 1-80 chars) + description (optional, ≤240 chars) + capacity (required int 1-500). Plus the "Online · Google Meet" **synthetic row** — rendered only when `google_meet_connected === true` (from `useCenterProfile.data`). When disconnected, the synthetic row disappears [Sally-S7 + John ACCEPT — pin behavior]. The synthetic row's `Settings` button navigates to `/settings?tab=integrations` (2-5c-shipped tab). If Story 3.x sessions later reference `Online·Meet` when disconnected, Story 3.x owns that DeadLinkTrigger surface — Story 2-5b has no session-visibility concern.

3. **Empty states — encouraging tone per Sally-S9 + John ACCEPT.** First-visit Owner sees empty Terms + empty Rooms simultaneously; both empty states MUST feel "when you're ready" not "you're incomplete":
   - `settings.terms.empty.headline` = "No terms scheduled yet."
   - `settings.terms.empty.body` = "Terms help you group classes by academic period and flag boundary crossings. Add one when you're ready."
   - `settings.terms.empty.cta` = "+ Add term"
   - `settings.holidays.empty.{headline,body}` = "No holidays declared." / "Classes scheduled on declared holidays are flagged for reschedule automatically."
   - `settings.rooms.empty.{headline,body,cta}` = "No physical rooms yet." / "Add one when you're ready, or skip if you're online-only." / "+ Add room"

4. **Loading / Empty / Error trilogy per UX-1** — every tab body covers all three states:
   - **Loading**: `<Skeleton>` rows mirroring row height (3 skeleton rows).
   - **Success**: rendered list.
   - **Empty**: shipped `<EmptyState>` component with copy per AC3.
   - **Error**: inline `<Alert variant="destructive">` with retry action.

5. **CRUD via shipped shadcn `Dialog`.** Create/edit flows render inside `<Dialog>` (from Story 1d-2). Delete confirmations render inside `<AlertDialog>`. Form validation via RHF + hand-authored Zod (openapi-zod-client TODO'd per 2-5a). Field errors surface inline. Server errors surface as `<Alert>` inside the dialog with retry action.

6. **Rooms UNIQUE(center_id, LOWER(name)) — 409 rendered as field error.** Backend rejects duplicate room names per-center with 409 `ROOM_NAME_TAKEN`; frontend surfaces as inline field error on `name` input, NOT a toast. Case-insensitive (`LOWER(name)` at index level per AC8).

7. **Backend API — 12 new endpoints per parent 2-5 AC7.** Middleware chain: `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") → settingsRateLimit → handler`. Full envelope + typed error codes + 429 with `Retry-After` header per Murat-B6.

   | Method | Path | Purpose |
   |---|---|---|
   | GET | `/api/terms` | List terms (center-scoped) |
   | POST | `/api/terms` | Create term |
   | PATCH | `/api/terms/{id}` | Update term |
   | DELETE | `/api/terms/{id}` | Delete term |
   | GET | `/api/holidays` | List holidays |
   | POST | `/api/holidays` | Create holiday |
   | PATCH | `/api/holidays/{id}` | Update holiday |
   | DELETE | `/api/holidays/{id}` | Delete holiday |
   | GET | `/api/rooms` | List rooms |
   | POST | `/api/rooms` | Create room |
   | PATCH | `/api/rooms/{id}` | Update room |
   | DELETE | `/api/rooms/{id}` | Delete room (v1 unconditional; Story 3.x adds `409 ROOM_IN_USE` check when sessions FK lands — planted marker) |

   All entity-scoped endpoints assert entity's `center_id == tc.CenterID` at handler entry (belt vs RLS suspenders); mismatch → 403 `TENANT_MISMATCH`. Rate limit: `settings` bucket = 60 req/min per user (inherited from 2-5a).

8. **Migrations — 3 new tenant-scoped tables with FULL 4-policy RLS per Winston-B2 + John ACCEPT.** Pre-flight `ls migrations/ | tail -5` for timestamp collision per Winston-S10. All `.down.sql` use `DROP TABLE IF EXISTS` per Winston-B1.

   **`20260714120100_create_terms.up.sql`:**
   ```sql
   CREATE TABLE terms (
       id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
       center_id     uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
       name          text        NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
       start_date    date        NOT NULL,
       end_date      date        NOT NULL,
       session_count integer,
       created_at    timestamptz NOT NULL DEFAULT now(),
       CHECK (start_date <= end_date)
   );
   CREATE INDEX idx_terms_center_id ON terms (center_id, start_date DESC);
   ALTER TABLE terms ENABLE ROW LEVEL SECURITY;
   ALTER TABLE terms FORCE ROW LEVEL SECURITY;
   -- 4 policies per Winston-B2 (mirror class_templates.up.sql:29-55):
   CREATE POLICY terms_select ON terms FOR SELECT
       USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   CREATE POLICY terms_insert ON terms FOR INSERT
       WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   CREATE POLICY terms_update ON terms FOR UPDATE
       USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
       WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   CREATE POLICY terms_delete ON terms FOR DELETE
       USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   ```

   **`20260714120200_create_holidays.up.sql`:** same 4-policy pattern. Table: `id` uuid PK, `center_id` uuid NOT NULL REFERENCES centers ON DELETE CASCADE, `name` text NOT NULL CHECK length 1-120, `date` date NOT NULL, `created_at` timestamptz NOT NULL. Index on `(center_id, date)`.

   **`20260714120300_create_rooms.up.sql`:** same 4-policy pattern. Table: `id` uuid PK, `center_id` uuid NOT NULL REFERENCES centers ON DELETE CASCADE, `name` text NOT NULL CHECK length 1-80, `description` text CHECK length ≤240, `capacity` integer NOT NULL CHECK (capacity BETWEEN 1 AND 500), `created_at` timestamptz NOT NULL. **UNIQUE index on `(center_id, LOWER(name))`** — prevents duplicate room names per center; enforces AC6.

9. **Sqlc queries — 3 new files.**
   - `terms.sql`: `ListTermsByTenant`, `CreateTerm`, `UpdateTerm`, `DeleteTerm`, `GetTermByID`.
   - `holidays.sql`: `ListHolidaysByTenant`, `CreateHoliday`, `UpdateHoliday`, `DeleteHoliday`, `GetHolidayByID`.
   - `rooms.sql`: `ListRoomsByTenant`, `CreateRoom`, `UpdateRoom`, `DeleteRoom`, `GetRoomByID`.
   
   `UpdateXxx` uses `sqlc.narg('field')` partial-update pattern per Amelia-S5. All queries assume RLS via `SET LOCAL app.current_tenant_id` at handler entry — do NOT filter by `center_id` in query WHERE clauses (RLS handles isolation).

10. **Backend services + handlers — 3 new services + 3 new handlers.**
    - `internal/service/term.go` — `TermService.List/Create/Update/Delete`. Every mutating op emits `center.term.{created,updated,deleted}` audit row via `AuditLogger.LogWithinTx` in same tx per Story 2.1 pattern.
    - `internal/service/holiday.go` — same pattern with `center.holiday.*` audit events.
    - `internal/service/room.go` — same pattern with `center.room.*` audit events. Delete pre-check for Story 3.x FK (behind `sessionsExist` helper — always false in v1; marker `// TODO(story-3-2): reject if referenced by sessions`).
    - `internal/handler/{term,holiday,room}_handler.go` — thin HTTP wrappers. Handler entry asserts entity's `center_id == tc.CenterID` for path-`{id}` operations (belt vs RLS suspenders).
    - Register 1 new error code `ROOM_NAME_TAKEN` (409) in `internal/handler/errors.go` per Winston-S11.
    - Wire in `cmd/api/main.go` — extend the `settingsChain` middleware group from 2-5a.

11. **Frontend — replace 3 tab placeholders in `SettingsPage.tsx`.**
    - `src/features/settings/TermCalendarTab.tsx` — list + create/edit `Dialog` + delete `AlertDialog`. Fetches via `useTerms(centerId)` + `useHolidays(centerId)`. Empty state per AC3.
    - `src/features/settings/RoomsTab.tsx` — list + create/edit `Dialog` + delete `AlertDialog`. Fetches via `useRooms(centerId)`. Synthetic Meet row per AC2. Empty state per AC3.
    - `src/features/settings/IntegrationsTab.tsx` — remains placeholder (2-5c wires the real body). Do NOT touch.
    - `lib/schemas.ts` — extend with `termSchema`, `holidaySchema`, `roomSchema` (hand-authored Zod per Amelia-B1).
    - `api/settingsKeys.ts` — extend with `terms(centerId)`, `holidays(centerId)`, `rooms(centerId)` factories.
    - `api/useTerms.ts` + `useMutateTerm.ts` (single mutation hook handling create/update/delete via method+id) — full optimistic triple per FW-2.
    - Same pairs for `holidays.ts` + `rooms.ts`.
    - `components/TermRow.tsx`, `HolidayRow.tsx`, `RoomRow.tsx`, `TermFormDialog.tsx`, `HolidayFormDialog.tsx`, `RoomFormDialog.tsx`, `DeleteConfirmDialog.tsx` (shared).

12. **RLS adversarial tests per Task 1.5** — mirror shipped `class_templates_rls_test.go` (Story 2.2) pattern. **8 adversarial rows minimum** per Winston-B2/Murat-B2 + John ACCEPT compromise (Story 2.2's shipped pattern, not Murat's 96-test ceiling):
    - Cross-tenant READ (Tenant A cannot see Tenant B's rows) × 3 tables = 3 tests
    - Cross-tenant INSERT (Tenant A cannot insert row with Tenant B's center_id — WITH CHECK guard) × 3 tables = 3 tests
    - Cross-tenant UPDATE (Tenant A cannot mutate Tenant B's rows) × 1 sample table (rooms) = 1 test
    - Cross-tenant DELETE (Tenant A cannot delete Tenant B's rows) × 1 sample table (terms) = 1 test
    
    Add per-table `terms_rls_test.go`, `holidays_rls_test.go`, `rooms_rls_test.go` OR extend `adversarial_test.go` — dev's discretion, latter is lighter.

13. **i18n — pinned `STORY_2_5B_KEYS` closed literal.** Append `describe('Story 2-5b i18n parity (R38)', () => { ... })` to `i18n-parity-coverage.test.ts`. Prefix ratchet: every key starts with `settings.terms.` OR `settings.holidays.` OR `settings.rooms.` (or shared `error.*`). Est **~50-65 keys** (tab body headings + CRUD dialog copy + row state pills + delete confirmations + validation messages + empty-state copy). `assertI18nInterpolationParity` covers ALL keys. VN copy per Ducdo ownership per feedback rule.

    **noTrialMechanic pre-flight** per Amelia-B2 — no `trial`/`dùng thử` in settings copy.

14. **Route bundle boundary** — extend `e2e/route-bundle-boundaries.spec.ts`: `SettingsPage-*.js` chunk still contains `data-testid="settings-tab-strip"` + now contains `data-testid="settings-tabpanel-terms"` + `-rooms`; no cross-chunk leakage.

15. **Accessibility — axe zero violations across new tab bodies × 2 locales = 4 renders (TermCalendarTab + RoomsTab × 2 locales).** Modals covered by shipped `Dialog`/`AlertDialog` primitive tests per Murat-S3 REJECTED (already axe-tested in Story 1d-2). Semantic markup: lists use `<ol>`; row state pills are `<span>` with visible text (not color-alone); modal-open state uses shadcn's Radix-native focus trap.

16. **Test coverage** — new test files:
    - `TermCalendarTab.test.tsx` (~12 tests): three-state + CRUD × 4 + empty + adjacency overlap warning (advisory-only, save succeeds).
    - `RoomsTab.test.tsx` (~12 tests): three-state + CRUD × 4 + empty + UNIQUE-conflict field error + synthetic Meet row visible/hidden per `google_meet_connected`.
    - `useTerms.test.ts` + `useMutateTerm.test.ts` (~5 each): cache invalidation + optimistic rollback + query key structure.
    - Same pairs for `holidays` + `rooms`.
    - Regression on 2-5a shipped tests per Task 5.6 pattern.

## Tasks / Subtasks

- [ ] **Task 0 — ATDD red phase (RECOMMENDED, SKIPPABLE)** — R1 replication on 3 new tenant-scoped tables per Task 12; ATDD helps but skippable if dev is comfortable with Story 2.2's `class_templates_rls_test.go` pattern.
- [ ] **Task 1 — Migrations + sqlc + codegen** (AC: #8, #9): pre-flight timestamp check; author 3 migrations + `.down.sql` w/ IF EXISTS; migrate; author 3 sqlc query files; codegen; verify generated Go compiles.
- [ ] **Task 2 — RLS adversarial tests** (AC: #12): 8-row minimum matrix per John compromise; per-table OR extended `adversarial_test.go`.
- [ ] **Task 3 — api.yaml + regen** (AC: #7): 12 endpoints + ~15 schemas; codegen.
- [ ] **Task 4 — Backend services + handlers** (AC: #7, #10): 3 services + 3 handlers + `ROOM_NAME_TAKEN` error code; wire settingsChain in main.go.
- [ ] **Task 5 — Backend test suite** (AC: all): store tests real DB in tx per TEST-BE-2; service tests mock store per TEST-BE-4; handler tests via `test.NewTestServer` per TEST-BE-3 including 429 `Retry-After` assertions.
- [ ] **Task 6 — Frontend tabs** (AC: #1, #2, #3, #4, #5, #6, #11): replace 2-5a placeholders; hand-authored Zod extension; keys factory extension; TanStack Query hooks with full optimistic triple.
- [ ] **Task 7 — Frontend component tests** (AC: #16): per-tab tests + hook tests + regression on 2-5a shipped files.
- [ ] **Task 8 — i18n keys + parity ratchet** (AC: #13): noTrialMechanic pre-flight; ~50-65 keys; STORY_2_5B_KEYS closed literal + prefix ratchet.
- [ ] **Task 9 — Route bundle boundary regression** (AC: #14).
- [ ] **Task 10 — Regression + Playwright smoke** (AC: all): full test suite; expected delta **~+80-120 tests**; Playwright extension optional (session-cache seeding still deferred FU-2-5-N).

## Dev Notes

### Story context

Story 2-5b is the second sub-story from split 2-5. Depends on 2-5a shipping first (baseline `TBD-after-2-5a` — update frontmatter at pickup). 2-5a shipped the `/settings` shell + tab-strip + Profile tab + placeholders for the 3 tabs this story replaces.

### RLS 4-policy pattern discipline

All 3 new tables mirror `class_templates.up.sql:29-55` shipped pattern per Winston-B2 + John ACCEPT: SELECT + INSERT (WITH CHECK) + UPDATE (USING + WITH CHECK) + DELETE, all keyed by `center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`. FORCE ROW LEVEL SECURITY on every table.

### `settingsKeys.ts` factory extension

Extend the factory shipped in 2-5a Task 4.5:
```ts
export const settingsKeys = {
  all: ['settings'] as const,
  centerProfile: (centerId: string) => [...settingsKeys.all, 'centerProfile', centerId] as const,
  terms: (centerId: string) => [...settingsKeys.all, 'terms', centerId] as const,
  holidays: (centerId: string) => [...settingsKeys.all, 'holidays', centerId] as const,
  rooms: (centerId: string) => [...settingsKeys.all, 'rooms', centerId] as const,
  // 2-5c adds: integration(provider)
}
```

### Room name uniqueness handling

`UNIQUE(center_id, LOWER(name))` at index level → sqlc-emitted error `pgconn.PgError` with SQLSTATE `23505` → service maps to `ROOM_NAME_TAKEN` (409) → frontend surfaces as field error on `name` input, NOT toast. Case-insensitive match ("Room A" and "room a" collide).

### Files to touch — inventory

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Task 3 — 12 endpoints + 15 schemas |
| `classlite-api/migrations/20260714120100_create_terms.up.sql` + `.down.sql` | NEW | Task 1 |
| `classlite-api/migrations/20260714120200_create_holidays.up.sql` + `.down.sql` | NEW | Task 1 |
| `classlite-api/migrations/20260714120300_create_rooms.up.sql` + `.down.sql` | NEW | Task 1 |
| `classlite-api/internal/store/queries/terms.sql` + `holidays.sql` + `rooms.sql` | NEW | Task 1 |
| `classlite-api/internal/service/term.go` + `holiday.go` + `room.go` + `_test.go` | NEW | Task 4 |
| `classlite-api/internal/handler/term_handler.go` + `holiday_handler.go` + `room_handler.go` + `_test.go` | NEW | Task 4 |
| `classlite-api/internal/handler/errors.go` + `error_mapper_test.go` | UPDATE | Task 4 — add `ROOM_NAME_TAKEN` |
| `classlite-api/cmd/api/main.go` | UPDATE | Task 4 — extend settingsChain |
| `classlite-api/internal/test/adversarial_test.go` | UPDATE | Task 2 — 8-row RLS matrix |
| `classlite-web/src/features/settings/SettingsPage.tsx` | UPDATE | Task 6 — replace TermCalendar + Rooms placeholders |
| `classlite-web/src/features/settings/TermCalendarTab.tsx` + `.stories.tsx` + `__tests__/TermCalendarTab.test.tsx` | NEW | Task 6 / 7 |
| `classlite-web/src/features/settings/RoomsTab.tsx` + `.stories.tsx` + `__tests__/RoomsTab.test.tsx` | NEW | Task 6 / 7 |
| `classlite-web/src/features/settings/lib/schemas.ts` | UPDATE | Task 6 — extend with 3 new schemas |
| `classlite-web/src/features/settings/api/settingsKeys.ts` | UPDATE | Task 6 — extend with 3 new factories |
| `classlite-web/src/features/settings/api/useTerms.ts` + `useMutateTerm.ts` + tests | NEW | Task 6 / 7 |
| `classlite-web/src/features/settings/api/useHolidays.ts` + `useMutateHoliday.ts` + tests | NEW | Task 6 / 7 |
| `classlite-web/src/features/settings/api/useRooms.ts` + `useMutateRoom.ts` + tests | NEW | Task 6 / 7 |
| `classlite-web/src/features/settings/api/__tests__/handlers.ts` | UPDATE | Task 6 — extend factories |
| `classlite-web/src/features/settings/components/{TermRow,HolidayRow,RoomRow,TermFormDialog,HolidayFormDialog,RoomFormDialog,DeleteConfirmDialog}.tsx` | NEW | Task 6 |
| `classlite-web/src/locales/en.json` + `vi.json` | UPDATE | Task 8 — ~50-65 new keys |
| `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` | UPDATE | Task 8 — STORY_2_5B_KEYS block |
| `classlite-web/e2e/route-bundle-boundaries.spec.ts` | UPDATE | Task 9 |

**Files to READ before touching**:
- `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab.md` — parent sub-story.
- `_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md` — shared context.
- `classlite-api/migrations/20260703120000_create_class_templates.up.sql:29-55` — RLS 4-policy pattern to mirror.
- `classlite-api/internal/test/adversarial_test.go` — RLS test seed.
- `classlite-api/internal/store/queries/class_templates.sql` — sqlc query pattern.
- `classlite-api/internal/service/audit.go` — `AuditLogger.LogWithinTx` pattern.
- `docs/classlite-entry/05-cross-role.html:6967-7175` — s49 mockup Terms + Rooms tabs.
- `docs/project-context.md#GO-1..7, WF-1..8, TEST-FE-1..6, TEST-BE-1..5`.

### WF-8 ATDD applicability

Story 2-5b owns R1 replication for 3 new tenant-scoped tables (score 9). **ATDD RECOMMENDED**. Skippable if dev commits to shipping `class_templates_rls_test.go`-equivalent adversarial matrix per Task 2 in the green-phase pass. Task 0 pre-flight optional; Task 2 is mandatory regardless.

### Filed follow-ups

- **`FU-2-5-O`** — Term adjacency overlap enforcement (SQL-side EXCLUDE constraint). v1 is advisory-only. Priority: P4.
- **`FU-2-5-P`** — Room capacity live-check on session assign. Story 3.x consumer. Priority: P3.

### References

- [Source: `_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md`] — parent shared context.
- [Source: `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab.md`] — sibling sub-story.
- [Source: `classlite-api/migrations/20260703120000_create_class_templates.up.sql:29-55`] — RLS 4-policy pattern.
- [Source: `classlite-api/internal/service/center.go`] — audit-log-within-tx pattern.
- [Source: `docs/classlite-entry/05-cross-role.html:6967-7175`] — s49 mockup Terms + Rooms tabs.

## Definition of Done

1. All 16 ACs green.
2. `npm run test` clean — expected delta **~+80-120 tests**; no regression on 2-5a + Story 2-1..2-4 shipped test files.
3. `npm run lint` + `tsc` clean.
4. `npm run i18n-parity` clean — pinned `STORY_2_5B_KEYS` (~50-65) + ratchet.
5. `axe-core` zero violations per AC15.
6. Storybook: TermCalendarTab ≥3 variants; RoomsTab ≥3 variants.
7. `go test ./...` + `go vet ./...` + `golangci-lint run` clean; RLS adversarial matrix per Task 2 all green.
8. `git status` shows only backend + frontend + story artifacts + sprint-status. `codegen.sh` last script per WF-3.
9. `npm run build` clean.
10. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-5b-terms-holidays-rooms-tabs-completion-notes.md`.
11. Change Log updated with fold citations.
12. Sprint-status `2-5b-terms-holidays-rooms-tabs` flipped `backlog → ready-for-dev → in-progress → review` — dev owns pickup after 2-5a ships.

## Out of Scope

- Google Meet OAuth + Integrations tab — Story 2-5c.
- Term adjacency SQL constraint — FU-2-5-O.
- Room capacity live-check on session assign — Story 3.x + FU-2-5-P.
- Session-referencing FK ROOM_IN_USE check — Story 3.2 planted marker.

## Change Log

| Date | Note |
|---|---|
| 2026-07-14 | Story created as split 2 of 3 from parent 2-5 after party-mode adversarial review. Owner-only inherited from 2-5a. Absorbs John-ACCEPTed folds: **BLOCKERs** B5 (`.down.sql` IF EXISTS), B6 (RLS 4-policy enumeration for 3 new tables + Task 2 8-row adversarial matrix per Story 2.2 shipped pattern), B15 (429 + Retry-After header intent); **STRONGs** S6 REJECTED (uniform Edit button), S7 (synthetic Meet row disappears when disconnected), S9 (encouraging empty-state copy pinned in AC3), S17 (test-count intent — realistic +80-120 for this sub-story). Baseline commit TBD until 2-5a lands. Backlog until 2-5a ships. |
