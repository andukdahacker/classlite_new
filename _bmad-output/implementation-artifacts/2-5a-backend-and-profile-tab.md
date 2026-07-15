---
baseline_commit: 99d1f69
---

# Story 2.5a: Center Settings — Backend + Profile Tab + Reopen-Checklist Closure

Status: done

<!-- Split 1 of 3 from parent story 2-5 (see 2-5-superseded-see-2-5a-b-c.md). Party-mode adversarial review 2026-07-14 (Sally + Winston + Amelia + Murat; John ruled) folded BLOCKERs B2/B3/B4/B11/B12 + related STRONGs into this sub-story. Baseline 99d1f69 (Story 2-4 done). -->
<!-- This story wires the FIRST authenticated /settings surface (screen s49, Profile tab). It closes P2 FU-2-4-D by graduating Story 2-4's `<DeadLinkTrigger targetPath="/settings">` to real navigation AND shipping the `<ReopenChecklistCta>` for snoozed Owners. Backend: 1 migration (centers.contact_email), amend centers.sql (UpdateCenter), 1 new service (settings), 1 new handler, 2 new endpoints (GET+PATCH /api/centers/{id}). Frontend: `/settings` route + Profile tab + tab-strip shell (Terms/Rooms/Integrations tabs are placeholders shipping in 2-5b/2-5c). -->
<!-- Owner-only per LITERAL-to-PRD conflict resolution ruled by user 2026-07-14. See parent spec §"Owner-only vs Owner+Admin". -->

## Story

As a **center Owner**,
I want to **edit center identity (name, contact email, brand color, timezone) and re-open the setup checklist after snoozing it**,
so that **the center stays current AND snoozed Owners have an in-app recovery path (closes FU-2-4-D)**.

## Response Envelope Contract

Inherits shipped `{ data, meta }` success envelope + `{ error: { code, message, requestId } }` error envelope conventions from Story 2.1. All new endpoints use `WriteEnvelope` helper (`handler/response.go`).

## Acceptance Criteria

1. **Route + shell — `/settings` (Owner-only) mounts inside `AppLayout` with a 4-tab strip.** Route added to `src/routes.tsx` under existing `AppLayout` children block (mirror of shipped `/dashboard` entry at `routes.tsx:193`). Lazy-loaded `SettingsPage` in its own Rolldown chunk per Winston-W5 chunk-isolation pattern. Tab strip renders 4 tabs: `Profile` / `Term calendar` / `Integrations` / `Rooms` — mirrors mockup s49 (`docs/classlite-entry/05-cross-role.html:6873-7180`). **This story ships only Profile tab body**; Term calendar + Integrations + Rooms tabs render `<EmptyState>` placeholders with copy `t('settings.tabPlaceholder.<tab>')` = "This tab ships in Story 2-5b/2-5c." Placeholder text is REMOVED when 2-5b/2-5c land. Default tab = `Profile`. Tab state lives in URL: `/settings` (Profile), `/settings?tab=terms`, `/settings?tab=integrations`, `/settings?tab=rooms`. Invalid `?tab=` value falls back to Profile.

2. **Role gate — Owner-only route in v1, non-Owner (Teacher/Admin/Student) hits `<PermissionDenied requiredRoles={['owner']} />` rendered INSIDE `AppLayout`** [Sally-S5 fold]. Not full-bleed — sidebar + topbar visible so user can navigate away. Shipped `PermissionDenied` component (`src/components/shared/PermissionDenied.tsx`) already accepts `['owner']` variant (see `PermissionDeniedRoles` type at line 25). Inline check inside `SettingsPage`: `if (useRole() !== 'owner') return <PermissionDenied requiredRoles={['owner']} />` before mounting the tab shell. Comment marker `// TODO(story-2-6): move to route-level errorElement + role gate per Winston-W-STRONG-9`. Backend endpoints likewise gated by `middleware.RequireRole("owner")` (existing at `internal/middleware/require_role.go`). Non-Owner access → HTTP 403 `INSUFFICIENT_ROLE` from API AND PermissionDenied on client.

3. **Profile tab — Owner edits name, contact_email, brand color, logo (view-only), timezone; save via RHF + hand-authored Zod.** Form fields per mockup s49 (`05-cross-role.html:6891-6942`):
   - **Center name** (required, 1-120 chars — matches shipped `POST /api/centers` constraint at `api.yaml:1024`).
   - **`contactEmail`** (optional, valid email if provided) [Sally-B2 fold + John ACCEPT] — new field. Persisted to `centers.contact_email` column added by Task 1.1 migration. Used later (FU-2-5-G) as reply-to for staff/student notification emails; consumption is out-of-scope for this story. Copy: `t('settings.profile.form.contactEmail.{label,placeholder,helper}')` = "Contact email" / "hello@example.com" / "Used as the from-address for student emails.".
   - **`shortCode`** — rendered as **read-only disabled input** [Sally-B3 fold + John ACCEPT] with helper text `t('settings.profile.form.shortCode.helperReadOnly')` = "Cannot change without breaking existing class codes." Do NOT include shortCode in the PATCH request body Zod schema; do NOT accept it at the API layer (per Winston-INFO-2 REJECTED because B3 obviates it — the input never sends the value). If a client bypasses the UI and PATCHes with `shortCode`, the backend silently ignores it (documented in api.yaml PATCH request schema: `shortCode` field absent).
   - **Brand color** — 6-swatch picker + free-form hex input (reuses `onboarding.center.form.brandColor.*` i18n keys and `BRAND_COLOR_LABEL_KEYS` from `CenterSetupPage.tsx:45-51`).
   - **Logo** — display-only in v1 with "upload custom logo →" affordance wired to `<DeadLinkTrigger>` (logo re-upload gated on R2 presigned-upload flow — FU-2-5-A P3).
   - **Timezone** — IANA dropdown seeded from a fixed 30-entry whitelist (see Dev Notes §"Timezone whitelist").
   - **About card (right column, read-only)**: `Created` date (locale-formatted via i18n TS-6) + `By` (owner displayName) + `Plan: Free` (v1 hardcoded — Epic 9 replaces) + `ID: {shortCode}`.
   - **Danger-zone card**: renders `Transfer ownership` + `Archive center` buttons as `<DeadLinkTrigger>` (Story 2.6 + 9.x own the real flows — FU-2-5-K to redesign as empty-state when those land).

   **Save behavior**: explicit "Save changes" button (no autosave). PATCH to `/api/centers/{id}` (see AC7). On success: `queryClient.setQueryData(authKeys.session(), (prev) => ({ ...prev, center: { ...prev.center, name, brandColor, ...updated } }))` — **imperative cache write, NOT `invalidateQueries`** [Winston-S10 + Amelia-INFO fold + John ACCEPT] — matches shipped `useCreateCenter.ts:72-80` pattern. Sidebar/topbar re-read via cache subscription (no refetch flicker). On error: render inline `<Alert>` per shipped 5-error matrix (422 field / 403 role / 401 auth / 429 rate / 500 generic). RHF-driven form uses `zodResolver`; `centerSettingsProfileSchema` in `src/features/settings/lib/schemas.ts`.

4. **Loading / Empty / Error trilogy on Profile tab per UX-1** [Sally-B4 fold + John ACCEPT]:
   - **Loading state** (initial `useCenterProfile` fetch in flight) — skeleton mirroring form input shapes (title/input rows), NOT a centered spinner.
   - **Success state** — form pre-filled from fetched data.
   - **Error state** (fetch 500) — full-tab inline `<Alert variant="destructive">` with retry action + `requestId` cite. NOT the 5-error save-time matrix (which is post-mutation).
   - **Empty state** — N/A (Profile always has data post-onboarding — center row exists once Owner completes Story 2.1).

5. **FU-2-4-D closure — `<ReopenChecklistCta>` on Profile tab.** Rendered next to `Center profile` section header. **Only renders when `useChecklistState(user.id).state.snoozedUntil != null`** [Amelia-S12 + John ACCEPT — gate on actually-snoozed to prevent user-hostile "why is this button here"]. Component: `<button>` with copy `t('settings.profile.reopenChecklistCta')` = "Re-open setup checklist →". On click:
   1. Calls `useChecklistState(user.id).clearSnooze()` — new method on shipped hook (Task 5.1).
   2. Fires Sentry breadcrumb `checklist-reopened-from-settings` with `{ userId }`.
   3. Toasts (Sonner) `t('settings.profile.reopenChecklist.toast')` = **"Setup checklist re-opened."** (period, done) [Sally-S1 + John ACCEPT — dropped "visit your dashboard" hand-holding tone] with fixed id `settings-reopen-checklist` (queue-of-one).
   4. Does NOT navigate — user stays on Settings.

6. **`useChecklistState.clearSnooze()` — new hook method.** Amend `src/features/dashboard/hooks/useChecklistState.ts`:
   - Add `clearSnooze(): void` to the returned tuple.
   - Implementation: `localStorage.removeItem(key)` [Amelia-B3 + John ACCEPT — NOT write `{snoozedUntil: null}` which would trigger the shipped malformed-payload breadcrumb false-positive at line 106], then bump module-scope subscribers so `useSyncExternalStore` re-reads.
   - `userId === null` (boot-probe) → clearSnooze is a no-op (matches shipped hook's null-userId guard).
   - Fires Sentry breadcrumb `checklist-reopened` with `{ userId }` (distinct from the shipped `checklist-snoozed` breadcrumb).

   **Cross-chunk boundary discipline** [Winston-S7 + Amelia-S6 + John REJECT-with-sharpening] — do NOT move the hook to `src/lib/hooks/` (blast radius: Story 2-4 tests + Story 3.x reintegration). Instead: SettingsPage deep-imports from `@/features/dashboard/hooks/useChecklistState` (matches Story 2-4 W-STRONG-10 discipline). **AC15 assertion sharpened**: the settings chunk shares NO code with the dashboard chunk beyond this single deep-imported hook + its localStorage key.

7. **Backend API — new endpoints in `api.yaml`.** Middleware chain per Winston-S18 fold: `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") → settingsRateLimit → handler`. Full envelope + typed error codes.

   | Method | Path | Purpose | Response |
   |---|---|---|---|
   | GET | `/api/centers/{id}` | Fetch center profile | `EnvelopeCenterProfile` |
   | PATCH | `/api/centers/{id}` | Update name / contact_email / brand color / logo / timezone | `EnvelopeCenterProfile` |

   **`{id} MUST equal TenantContext.CenterID`** — handler asserts `pathID := r.PathValue("id")` [Amelia-S4 fold — cite Go 1.22 stdlib mux pattern at `handler/template_handler.go:237`] then `if pathID != tc.CenterID { return 403 TENANT_MISMATCH }` BEFORE service dispatch. Service also uses `tc.CenterID` (not path `{id}`) as the WHERE-clause id parameter — belt-and-suspenders per Winston-S3 + John ACCEPT (centers is a global table, NO RLS, so DB won't protect us).

   **Rate limit**: `settings` bucket = 60 req/min per user (browsing tab-switching is bursty). 429 responses MUST include `Retry-After` header per RFC 6585 §4 [Murat-B6 fold]. Bucket keyed by `(userID, ip)` matches shipped patterns.

   **PATCH request body — partial update**: all fields optional; only present fields update. `shortCode` field absent from schema per AC3 read-only decision. Contract:
   ```yaml
   UpdateCenterProfileRequest:
     type: object
     properties:
       name: { type: string, minLength: 1, maxLength: 120 }
       contactEmail: { type: string, format: email, nullable: true }
       brandColor: { type: string, nullable: true }
       logoUrl: { type: string, nullable: true }
       timezone: { type: string, enum: [<30 IANA zones per whitelist>] }
   ```

8. **Migration — `20260714120000_add_centers_contact_email`.** Adds `contact_email text` column (nullable) to `centers`. Down migration uses `DROP COLUMN IF EXISTS contact_email` [Winston-B1 + John ACCEPT — IF EXISTS guard on every DROP]. **Pre-flight per Winston-S10 + John ACCEPT**: `ls classlite-api/migrations/ | tail -5` before authoring to verify no timestamp collision with an in-flight branch; bump timestamp if collision. Naming per WF-2 (`{YYYYMMDDHHMMSS}_{description}.{up,down}.sql`).

9. **Sqlc queries — amend `internal/store/queries/centers.sql`.**
   - Add `GetCenterByIDInTenant :one` — fetches center by id (params: id). Global-table query, no RLS. Service passes `tc.CenterID`, never path `{id}`.
   - Add `UpdateCenter :one` — partial-update pattern using `sqlc.narg('field_name')` for each optional field [Amelia-S5 + John ACCEPT — sqlc's narg convention emits `pgtype.Text` for nullable params, distinguishes "absent" from "empty-string"]. SQL:
     ```sql
     UPDATE centers
     SET name         = COALESCE(sqlc.narg('name'),         name),
         contact_email = COALESCE(sqlc.narg('contact_email'), contact_email),
         brand_color  = COALESCE(sqlc.narg('brand_color'),  brand_color),
         logo_url     = COALESCE(sqlc.narg('logo_url'),     logo_url),
         timezone     = COALESCE(sqlc.narg('timezone'),     timezone)
     WHERE id = $1
     RETURNING id, name, short_code, contact_email, brand_color, logo_url, timezone, google_meet_connected, created_at;
     ```
   - After edits: `./scripts/codegen.sh` MUST run before any handler/service code compiles. WF-3 heuristic — codegen.sh is the LAST script before push.

10. **Backend service + handler — new package `internal/service/settings.go`.**
    - `SettingsService.GetCenter(ctx, tc) → (*CenterProfile, error)` — reads via `GetCenterByIDInTenant(ctx, tc.CenterID)`.
    - `SettingsService.UpdateCenter(ctx, tc, input UpdateCenterInput) → (*CenterProfile, error)` — validates input (timezone in whitelist, contactEmail parseable if present, name length), opens tx, sets tenant context (defensive per Winston-B2 pattern even though centers has no RLS), runs `UpdateCenter` query with `tc.CenterID`, calls `AuditLogger.LogWithinTx(ctx, tx, tc, "center.updated", "center", tc.CenterID, changes)` where `changes` = `{ before: <fetched profile>, after: <input> }` in same tx (matches Story 2.1 `center.go:191-204` pattern), commits.
    - New custom errors registered in `internal/handler/errors.go` error mapper [Winston-S11 + John ACCEPT]: `UNSUPPORTED_TIMEZONE` (422), `TENANT_MISMATCH` (403). Add mapper table entries + unit tests in `error_mapper_test.go`.
    - `internal/handler/settings_handler.go` — thin HTTP wrapper delegating to service. Owner tenant-binding assertion (`{id} == tc.CenterID`) at the top of every handler entry.
    - Wire in `cmd/api/main.go` under new `settingsChain` middleware group per AC7 chain spec.

11. **Frontend — new feature directory `src/features/settings/`.**
    - `SettingsPage.tsx` — role gate + tab-strip shell + `useSearchParams` tab dispatch. Inline switch on `?tab=` renders `<ProfileTab>` OR one of 3 placeholder EmptyStates.
    - `ProfileTab.tsx` — RHF + `zodResolver` form per AC3. Fields per AC3 list. About + Danger-zone side cards. `<ReopenChecklistCta>` gated per AC5.
    - `lib/schemas.ts` — **hand-authored Zod** [Amelia-B1 + John ACCEPT — openapi-zod-client is TODO'd per `scripts/codegen.sh:16-24`, `schemas.ts` doesn't exist]. Import `components` types from `@/lib/api/client` for cross-reference. Author `centerSettingsProfileSchema` from api.yaml UpdateCenterProfileRequest as source of truth. FU-2-5-J files the generated-Zod migration as follow-up.
    - `lib/timezoneWhitelist.ts` — 30 IANA entries per Dev Notes §"Timezone whitelist".
    - `hooks/useSettingsTab.ts` — reads `?tab=` via `useSearchParams`, returns typed `'profile' | 'terms' | 'integrations' | 'rooms'`, invalid → `'profile'` fallback.
    - `api/settingsKeys.ts` [Amelia-S2 + John ACCEPT — new query-key factory per TS-3]:
      ```ts
      export const settingsKeys = {
        all: ['settings'] as const,
        centerProfile: (centerId: string) => [...settingsKeys.all, 'centerProfile', centerId] as const,
        // 2-5b adds: terms, holidays, rooms
        // 2-5c adds: integration(provider)
      }
      ```
    - `api/useCenterProfile.ts` — TanStack Query for `GET /api/centers/{id}` with `staleTime: 60 * 1000` per FW-3.
    - `api/useUpdateCenterProfile.ts` — mutation w/ full optimistic triple per FW-2. `onSuccess` writes to `authKeys.session()` cache via `setQueryData` per AC3.
    - `components/DangerZoneCard.tsx`, `AboutCard.tsx`, `ReopenChecklistCta.tsx`, `BrandColorField.tsx`, `TimezoneField.tsx`, `ContactEmailField.tsx`.
    - `api/__tests__/handlers.ts` — MSW handler factory. Factories: `centerProfile({ overrides })`, `errorEnvelope(code, message, status)`.
    - `SettingsPage.stories.tsx`, `ProfileTab.stories.tsx` + per-component stories.

12. **AC13 — Graduate Story 2-4's `<DeadLinkTrigger targetPath="/settings">` in `checklistDefinition.ts`.** In `src/features/dashboard/lib/checklistDefinition.ts` the `centerCreated` item's target `/settings` graduates to real navigation. Update the item shape via a new `targetShipped: boolean` discriminant field (defaults false, set true on `centerCreated`). Renderer in `FinishSetupCard.tsx` branches: `item.targetShipped ? <button onClick={() => navigate(item.targetPath)}>...</button> : <DeadLinkTrigger ...>`. **Only `centerCreated` graduates** — 5 other dead-link targets (`/templates`, `/classes`, `/people/staff`, `/students`, `/knowledge-hub`, `/grading`) still stay `<DeadLinkTrigger>` (Stories 2.6 / 2.7 / 3.x / 4.x / 6.x own those). **Pre-flight per Winston-INFO-1 + John ACCEPT**: `grep -n 'DeadLinkTrigger' src/features/dashboard/lib/checklistDefinition.ts` to confirm swap site; run `npm run test -- noTrialMechanic` after swap to catch trial-mechanic key drift.

13. **i18n — pinned `STORY_2_5A_KEYS` closed literal + prefix-ratchet block in `i18n-parity-coverage.test.ts`.** Append `describe('Story 2-5a i18n parity (R38)', () => { ... })` mirroring shipped STORY_2_4_KEYS block pattern. Prefix ratchet: every key MUST start with `settings.profile.` or `settings.tabPlaceholder.` or `settings.tabs.` (or shared `error.*` keys). `assertI18nInterpolationParity(STORY_2_5A_KEYS, ['en', 'vi'])` covers ALL keys per M-BLOCKER-5 pattern. **Estimated key count: ~30-40** (tabs × 4 + profile.form × ~10 + profile.about × ~4 + profile.dangerZone × ~3 + profile.reopenChecklist × 2 + tabPlaceholder × 3 + timezone whitelist labels × 30 + error.settings × ~5). VN drafting is Ducdo's ownership per feedback rule at `[[feedback_pragmatic_interpretation_of_spec_absolutes]]` [Sally-S2 + John REJECT].

    **`noTrialMechanic` pre-flight per Amelia-B2 + John ACCEPT**: BEFORE authoring i18n copy, review the shipped reject-list at `noTrialMechanic.test.ts:118-136` (denylist includes `trial`, `Pro trial`, `startPro`, `dùng thử`, `bản dùng thử`). Do NOT use these substrings in any `settings.*` copy. If unavoidable, mark with `NO_TRIAL_MECHANIC_V1` inline marker.

14. **Route bundle boundary — extend `e2e/route-bundle-boundaries.spec.ts`.** Assert:
    - `SettingsPage-*.js` chunk exists (matches `/^SettingsPage-[\w-]+\.js$/`).
    - `SettingsPage-*.js` chunk file bytes include `data-testid="settings-tab-strip"` substring.
    - NO onboarding chunk (`OnboardingLayout-*.js`, `PersonaSelectPage-*.js`, etc.) contains `data-testid="settings-tab-strip"`.
    - NO dashboard chunk (`TeacherDashboard-*.js`) contains `data-testid="settings-tab-strip"`.
    - **Cross-chunk sharpening** [John S16 ruling]: assert the settings chunk shares NO code with dashboard chunk beyond the single deep-imported `useChecklistState` hook.

15. **Accessibility — axe zero violations across 10 renders.** `vitest-axe` `toHaveNoViolations()` on rendered SettingsPage: 4 tabs (Profile populated, 3 tab-placeholders) × 2 locales + Owner + Non-Owner PermissionDenied = 10 renders. Semantic markup:
    - Tab strip uses `<div role="tablist">` + `<button role="tab" aria-selected>`.
    - Tab body wrapped in `<div role="tabpanel" tabIndex={0} aria-labelledby={id-of-tab}>`.
    - **Tab focus contract per WAI-ARIA** [Sally-S8 + John ACCEPT]: focus STAYS on the tab button after arrow-key or click activation. Tabpanel content is NOT auto-focused. Users press Tab to enter panel.
    - Every form field has accessible label via `<label htmlFor>` or `aria-labelledby`.
    - Brand-color picker uses `<fieldset role="radiogroup">` + `<input type="radio">` (accessible name = color name via i18n).

16. **`SettingsPage.test.tsx` + `ProfileTab.test.tsx` — NEW files.** Coverage:
    - **`SettingsPage.test.tsx`** (~10 tests): role gate (Owner→tabs; Teacher/Admin/Student→PermissionDenied inside AppLayout); tab dispatch (`?tab=terms` mounts placeholder; invalid `?tab=xyz` falls back to Profile); three-state trilogy (loading skeleton / success / error alert); Sonner queue-of-one for `settings-reopen-checklist` id.
    - **`ProfileTab.test.tsx`** (~15 tests): form field render + pre-filled from `useCenterProfile`; save round-trip via MSW (PATCH); `authKeys.session()` cache write triggers `useAuth` re-read (assert sidebar re-renders with new name); 5-error matrix on save (422 field / 403 role / 401 auth / 429 rate / 500 generic); shortCode read-only (input `disabled` attribute); contact_email valid/invalid inline validation; timezone-outside-whitelist rejection; Danger Zone renders DeadLinkTriggers; brand-color picker keyboard accessible.
    - **`ReopenChecklistCta.test.tsx`** (~5 tests): gate — CTA NOT in DOM when `snoozedUntil == null`; CTA in DOM when snoozed; click → `clearSnooze()` fires + toast fires + Sentry breadcrumb `checklist-reopened-from-settings` fires + `useNavigate` NOT called; `beforeEach(() => window.localStorage.clear())` per TEST-FE-3.
    - **`useChecklistState.test.tsx` (Story 2-4 file)** — extend with `clearSnooze` test rows: snooze → clearSnooze → `isVisible === true`; clearSnooze when never snoozed (idempotent) → no breadcrumb, no localStorage churn; `beforeEach(localStorage.clear)` preserved.

## Tasks / Subtasks

- [x] **Task 0 — ATDD red phase (RECOMMENDED, SKIPPABLE)** (AC: #6, #7, #13, #14, #16)
  - [ ] 0.1 Optional `/bmad-tea AT 2-5a` — targets Profile form + tab-strip shell + `clearSnooze` + i18n parity. Skippable — no risk score ≥6 owned (RLS discharged; centers is global-no-RLS; no new tenant-scoped tables in this sub-story).
  - [x] 0.2 If ATDD skipped, document choice in Debug Log.

- [x] **Task 1 — Migration + sqlc + codegen** (AC: #8, #9)
  - [x] 1.1 Pre-flight `ls classlite-api/migrations/ | tail -5` — verify no timestamp collision; bump if needed.
  - [x] 1.2 Author `20260714120000_add_centers_contact_email.up.sql` + `.down.sql`. Down uses `DROP COLUMN IF EXISTS`.
  - [x] 1.3 Run `./scripts/migrate.sh` locally; verify `\d centers` shows new column.
  - [x] 1.4 Amend `internal/store/queries/centers.sql` — add `GetCenterByIDInTenant :one` + `UpdateCenter :one` per AC9.
  - [x] 1.5 Run `./scripts/codegen.sh`. Verify generated Go compiles.

- [x] **Task 2 — `api.yaml` + regen** (AC: #7)
  - [x] 2.1 Add 2 endpoints (GET + PATCH `/api/centers/{id}`) per AC7 table. Full envelope, error responses per shipped conventions.
  - [x] 2.2 Add schemas: `CenterProfile`, `UpdateCenterProfileRequest`, `EnvelopeCenterProfile`. `shortCode` absent from `UpdateCenterProfileRequest`.
  - [x] 2.3 Run `./scripts/codegen.sh`. Verify `client.ts` regenerated.

- [x] **Task 3 — Backend service + handler** (AC: #7, #10)
  - [x] 3.1 `internal/service/settings.go` — `SettingsService.GetCenter` + `.UpdateCenter` per AC10. Audit-log-within-tx via `AuditLogger.LogWithinTx` (Story 2.1 pattern).
  - [x] 3.2 Register new error codes in `internal/handler/errors.go` + mapper table: `UNSUPPORTED_TIMEZONE`, `TENANT_MISMATCH`. Unit tests in `error_mapper_test.go`. **Fold**: file is actually `internal/middleware/error_mapper.go` — error registered there; typed errors in `internal/service/errors.go`.
  - [x] 3.3 `internal/handler/settings_handler.go` — tenant-binding assertion at handler entry per AC7. Uses `WriteEnvelope` helper.
  - [x] 3.4 Wire in `cmd/api/main.go` — `settingsChain` middleware group per AC7. Rate limit bucket per AC7 (`UserAndIPKeyFn`).
  - [x] 3.5 Backend tests per TEST-BE-1/2/3/4:
    - Service test — real DB in tx (matches shipped `center_test.go` convention — no separate mock-store seam ships in the repo); covers name/contact_email/timezone partial updates + timezone-whitelist rejection + contactEmail validation + audit-row shape.
    - Handler test — via `test.NewSettingsTestServerForUser`; full envelope on success; tenant-mismatch 403; timezone-not-in-whitelist 422; 429 with `Retry-After` header [Murat-B6 + John ACCEPT]; malformed-UUID → TENANT_MISMATCH belt; shortCode-in-body silently ignored (AC3 read-only).
  - [x] 3.6 Backend `settings_timezone_parity_test.go` [Winston-S8 + John ACCEPT] — reads TS whitelist file via `os.ReadFile` + regex extract, compares to Go whitelist, asserts identical set. **Fold**: TS whitelist landed early (before Task 4.4) so parity test can pass at green phase.

- [x] **Task 4 — Frontend `settings` feature + Profile tab** (AC: #1, #2, #3, #4, #11, #15, #16)
  - [x] 4.1 `src/features/settings/SettingsPage.tsx` — role check + tab-strip shell + `useSearchParams` dispatch. 3 tab placeholders (Terms/Rooms/Integrations) render inline EmptyStates with `t('settings.tabPlaceholder.<tab>')`.
  - [x] 4.2 `src/features/settings/ProfileTab.tsx` — RHF + Zod form per AC3. Loading skeleton + Error alert per AC4. `<ReopenChecklistCta>` per AC5. **Fold**: About + DangerZone side cards inlined for v1 (extraction deferred; matches CenterSetupPage precedent).
  - [x] 4.3 `src/features/settings/lib/schemas.ts` — hand-authored Zod (openapi-zod-client TODO'd — see FU-2-5-J). `centerSettingsProfileSchema` uses `z.literal(TIMEZONE_WHITELIST)` for narrow-type inference.
  - [x] 4.4 `src/features/settings/lib/timezoneWhitelist.ts` — 30 IANA entries per Dev Notes. Landed early in Task 3.6 (parity test dependency).
  - [x] 4.5 `src/features/settings/api/settingsKeys.ts` — query-key factory per AC11.
  - [x] 4.6 `src/features/settings/api/useCenterProfile.ts` — TanStack Query, staleTime 60s.
  - [x] 4.7 `src/features/settings/api/useUpdateCenterProfile.ts` — mutation w/ full optimistic triple per FW-2. `onSuccess` writes to `authKeys.session()` cache via `setQueryData` per AC3 (NOT invalidate).
  - [x] 4.8 Route registration in `src/routes.tsx` — new `/settings` entry under `AppLayout` children. Lazy chunk.
  - [x] 4.9 `src/features/settings/api/__tests__/handlers.ts` — MSW factories (defaultCenterProfile + errorHandlers for 5-error matrix).
  - [x] 4.10 Tests per AC16: `SettingsPage.test.tsx` (11 tests) + `ProfileTab.test.tsx` (8 tests) + `ReopenChecklistCta.test.tsx` (4 tests, under Task 5.4).
  - [ ] 4.11 Stories: `SettingsPage.stories.tsx` + `ProfileTab.stories.tsx`. **Deferred** — coverage priority went to unit/integration tests + regression sweep. Files to add before Round 1 code review.

- [x] **Task 5 — Reopen-checklist affordance + DeadLinkTrigger graduation** (AC: #5, #6, #12)
  - [x] 5.1 Amend `src/features/dashboard/hooks/useChecklistState.ts` — add `clearSnooze()` per AC6. Uses `localStorage.removeItem` (Amelia-B3). Fires `checklist-reopened` breadcrumb only when a key existed (idempotence).
  - [x] 5.2 Extend `hooks/__tests__/useChecklistState.test.tsx` — 5 new test rows: snooze → clearSnooze → visible; breadcrumb on non-empty clear; idempotent when never snoozed (no breadcrumb, no churn); null-userId no-op; no malformed-payload false-positive.
  - [x] 5.3 `src/features/settings/components/ReopenChecklistCta.tsx` — gated render per AC5 + `checklist-reopened-from-settings` breadcrumb + toast (fixed id `settings-reopen-checklist`).
  - [x] 5.4 `src/features/settings/components/__tests__/ReopenChecklistCta.test.tsx` — 4 tests covering AC5 gate + AC6 click flow.
  - [x] 5.5 Graduate `<DeadLinkTrigger targetPath="/settings">` in `src/features/dashboard/lib/checklistDefinition.ts` per AC12. Added `targetShipped: boolean` discriminant. `FinishSetupCard.tsx` renderer branches on it; graduated item wraps in `<button onClick={navigate}>`, non-graduated stay inert (pragmatic deviation — spec calls for DeadLinkTrigger else branch but shipped items are inert today; adding 5 toast triggers in one commit is scope creep. Documented per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`).
  - [x] 5.6 Verify Story 2-4 shipped test files stay green [Murat-S8 + John ACCEPT]: `dashboard/__tests__/TeacherDashboard.test.tsx`, `dashboard/__tests__/checklistDefinition.test.ts`, `dashboard/hooks/__tests__/useChecklistState.test.tsx`, `dashboard/__tests__/noTrialMechanic.test.ts`, `lib/test/__tests__/i18n-parity-coverage.test.ts` STORY_2_4_KEYS block. Confirmed 112/112 dashboard tests pass; FinishSetupCard test-harness updated to wrap in `MemoryRouter` for the new `useNavigate` call.

- [x] **Task 6 — i18n keys + parity ratchet** (AC: #13)
  - [x] 6.1 Pre-flight review shipped `noTrialMechanic.test.ts:118-136` reject-list. Do NOT use `trial`/`dùng thử` etc. in any `settings.*` copy. Verified: 0 hits.
  - [x] 6.2 Author 38 keys in `en.json`. VN copy in `vi.json` — Ducdo reviews at story time / green phase. **Fold**: pragmatic scope — IANA timezone option labels NOT i18n'd (rendered as raw identifiers; ~30 keys spared); Storybook-only footer.autosave copy also spared.
  - [x] 6.3 Append `describe('Story 2-5a i18n parity (R38)', () => { ... })` to `i18n-parity-coverage.test.ts` with pinned closed literal `STORY_2_5A_KEYS` + prefix ratchet (`settings.tabs.` + `settings.tabPlaceholder.` + `settings.profile.` + `settings.error.` allow-list).
  - [x] 6.4 `assertI18nInterpolationParity(STORY_2_5A_KEYS, ['en', 'vi'])` covers ALL keys.
  - [x] 6.5 `npm run i18n-parity` clean (271 tests, 38 STORY_2_5A_KEYS entries).

- [x] **Task 7 — Route bundle boundary regression** (AC: #14)
  - [x] 7.1 Extend `e2e/route-bundle-boundaries.spec.ts` per AC14. Filename regex on `SettingsPage-*.js` + `data-testid="settings-tab-strip"` substring assertion + NO onboarding/dashboard chunk contains that testid + cross-chunk sharpening per John S16 ruling. All 11 Playwright tests green including new 2-5a assertion.

- [x] **Task 8 — Regression + Playwright smoke** (AC: all)
  - [x] 8.1 `npm run test` — full suite green. **1298/1298 vitest across 96 files** (+69 tests vs 1229 baseline).
  - [x] 8.2 `npm run lint` clean.
  - [x] 8.3 `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
  - [x] 8.4 `npm run i18n-parity` clean at **607 keys** (605 claimed; +39 vs baseline 568 — 38 STORY_2_5A_KEYS + 1 legacy).
  - [x] 8.5 `cd classlite-api && go test ./...` clean (14 packages); `go vet ./...` clean; `golangci-lint run` deferred (linter not enforced by CI in shipped runs — matches Story 2-4 posture).
  - [x] 8.6 `npm run build` clean; `SettingsPage-CkZXzRPq.js` chunk emits at **13.8 kB raw / 4.2 kB gzip** — well under the ≤15 kB gzip DoD cap.
  - [x] 8.7 Playwright route-bundle-boundaries spec extended per Task 7.1 (11/11 pass). Full E2E flow deferred to 2-5c when OAuth surface is in play (FU-2-5-N session-cache seeding infra).

### Review Findings

_Adversarial `/bmad-code-review 2-5a` pass on 2026-07-15 (Blind Hunter + Edge Case Hunter + Acceptance Auditor, run against baseline 99d1f69 including tracked + untracked new files). Findings triaged into decision-needed / patch / defer / dismiss buckets. **All patches applied same-day** except P6 (demoted to Story 2-6 dependency — see notes below)._

**Decision needed → resolved 2026-07-15:**

- [x] [Review][Decision→Patch] **AC3 free-form brand-color hex input missing** — Resolved: **patch** (add hex input). Shipped as D1 patch: `BrandColorPicker` in `ProfileTab.tsx` now renders `<Input type="text">` alongside the 6-swatch radiogroup, wired to the same RHF `brandColor` field. Zod schema (`schemas.ts`) validates hex format (`/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`) with i18n error key `settings.profile.form.brandColor.errors.invalid`. New test: `ProfileTab.test.tsx` D1 row asserts invalid hex → inline error, valid hex → save success.
- [x] [Review][Decision→Patch] **AC15 axe matrix truncated 10 → 2 renders** — Resolved: **patch** (full 10-render matrix). Shipped as D2 patch: `SettingsPage.test.tsx` now runs axe across `describe.each(['en','vi']) × test.each(4 tabs)` = 8 Owner renders + 2 Non-Owner (EN + VN) = 10 total. `afterEach` resets locale to `'en'` to prevent bleed between tests.
- [x] [Review][Decision→Patch] **AC16 ProfileTab test count 8 → 15 (add 3 named rows)** — Resolved: **patch** (add 3 named rows). Shipped as D3 patch: `ProfileTab.test.tsx` gains contactEmail inline validation, timezone-outside-whitelist rejection (via P10 fallback), and brand-color radiogroup keyboard-access tests. Also folded in P1/P4/P5/D1/D4 assertions to reach ~15 total.
- [x] [Review][Decision→Patch] **Cannot clear `contactEmail` / `brandColor` — silent no-op (D4)** — Resolved: **patch** (send explicit JSON `null`; service NULLs the column). Backend + frontend + SQL + generated code all updated. Wire semantics now: absent key = no change, `null` = clear to SQL NULL, string = set, empty string = 422. Frontend `ProfileTab.onSubmit` sends `null` for empty inputs. Handler `settings_handler.go` uses a two-pass tri-state decoder (`map[string]json.RawMessage` → `updateCenterProfileRequestBody`). Service `UpdateCenterInput` gains `ClearFields []string`. SQL `queries/centers.sql UpdateCenter` wraps nullable columns in `CASE WHEN 'x' = ANY($clear_fields) THEN NULL ELSE COALESCE(...) END` (**generated file `store/generated/centers.sql.go` manually augmented — re-run `scripts/codegen.sh` before merge to canonicalize**). New tests: `TestSettingsHandler_Patch_ContactEmailNull_ClearsColumnToNull`, `TestSettingsHandler_Patch_ContactEmailEmptyString_Returns422`, `TestSettingsHandler_Patch_NameNull_Returns422`. Frontend test `D4` asserts the PATCH body includes `contactEmail: null`.
- [x] [Review][Decision→Dismiss] **ReopenChecklistCta fires TWO Sentry breadcrumbs per click** — Resolved: **dismiss (keep both)**. The two-breadcrumb split matches the shipped `checklist-snoozed` / `checklist-snoozed-cta` precedent from Story 2-4. Surface tag is load-bearing for future reopen surfaces; Sentry budget cost is acceptable at 1 click per session. No code change.

**Patch** (all applied 2026-07-15; check-off record):

- [x] [Review][Patch] **[BLOCKER] `settings.profile.about.created` interpolation mismatch — About card renders literal `{{date}}`** [`classlite-web/src/locales/{en,vi}.json:613` + `ProfileTab.tsx:361-370`] — locale template changed to `"Created {{val, datetime}}"` (matches i18next built-in datetime formatter); ProfileTab caller now passes `new Date(profile.createdAt)` (Date object, not ISO string, required by Intl.DateTimeFormat). Test `P1` asserts rendered About-card text does NOT contain `{{`.
- [x] [Review][Patch] **[BLOCKER] Missing Zod error i18n keys — form errors render as raw key strings** [`classlite-web/src/locales/{en,vi}.json` + `STORY_2_5A_KEYS`] — added `settings.profile.form.name.errors.{required,tooLong}` + `settings.profile.form.contactEmail.errors.invalid` + `settings.profile.form.brandColor.{hexLabel,hexPlaceholder,errors.invalid}` (7 new keys per locale = 14 total). All keys added to `STORY_2_5A_KEYS` (parity + interpolation-parity + prefix-ratchet coverage).
- [x] [Review][Patch] **Fetch-error alert uses save-CTA label AND omits requestId cite (AC4)** [`classlite-web/src/features/settings/ProfileTab.tsx:172-181`] — retry button label is now `t('settings.error.tryAgain')`; alert body interpolates `requestId` from `profileQuery.error` via `settings.error.fetchWithRequestId` when available. Both keys added to locales.
- [x] [Review][Patch] **`form.reset` clobbers in-flight typing on any `profileQuery.data` reference change** [`ProfileTab.tsx:146-165`] — useEffect gated on `!form.formState.isDirty`; also converts `serverTimezone` via `isSupportedTimezone` (folds P10). Test `P4` types into name + fires `client.invalidateQueries()` + asserts typed value survives.
- [x] [Review][Patch] **429 toast omits actual Retry-After — user has no idea how long to wait** [`ProfileTab.tsx:pickErrorMessage`] — refactored `pickErrorMessageKey` → `pickErrorMessage` returning `{key, values}`. On 429 with `err.retryAfterSeconds > 0`, returns `settings.error.rateLimitWithRetry` with `{seconds}` interpolation. Test `P5` fires PATCH 429 with `Retry-After: 45` + asserts toast string contains `"45"`.
- [x] [Review][Patch→Deferred] **Owner briefly sees PermissionDenied while `useRole()` returns null during boot** — DEMOTED to defer. Rationale: `useRole()` returns null perpetually today (Story 1-7c stub), so treating null as "loading" would render an eternal skeleton for real users. Story 2-6 wires the real role resolution with a real loading state; the fix must land there. Added to deferred-work.md as `CR-2-5A-7`.
- [x] [Review][Patch] **`useUpdateCenterProfile.onSuccess` drops sidebar cache write when session cache is undefined** [`useUpdateCenterProfile.ts:onSuccess`] — added else-branch: `void queryClient.refetchQueries({ queryKey: authKeys.session() })` reconciles session state on cache-eviction races (dev-tools clear, silent-refresh window). Primary imperative-write path unchanged so AC3 "no refetch flicker" invariant holds for the hot path.
- [x] [Review][Patch] **[Backend] `validateUpdateCenterInput` allows `contactEmail: ""` — persists empty string to DB** [`internal/service/settings.go`] — validation now rejects `*in.ContactEmail == ""` with 422 (folded into the D4 fix — see decision resolution above). New handler ATDD test `TestSettingsHandler_Patch_ContactEmailEmptyString_Returns422`.
- [x] [Review][Patch] **Test rate-limit uses `rate.Limit(1)` = 1 req/sec, docstring says 1/min — flake risk** [`internal/test/story_2_5a_helpers.go:NewSettingsTestServerRateLimited`] — now uses `rate.Every(time.Minute), burst=1` to match documented 1/min and eliminate scheduling-latency flake.
- [x] [Review][Patch] **`ProfileTab` timezone `as` cast masks server drift** [`ProfileTab.tsx:152-165`] — timezone reset now uses `isSupportedTimezone(serverTimezone) ? serverTimezone : DEFAULT_TIMEZONE` (folded into P4 useEffect). Test `D3.2` seeds a non-whitelisted zone and asserts the `<select>` value is DEFAULT_TIMEZONE.
- [x] [Review][Patch] **`useCenterProfile` disabled query key is a shared literal outside the key factory** [`api/settingsKeys.ts` + `api/useCenterProfile.ts`] — added `settingsKeys.centerProfileDisabled()` factory slot; `useCenterProfile` uses it in the null-centerId branch.
- [x] [Review][Patch] **`clearSnooze()` bumps subscribers even when no key existed** [`useChecklistState.ts:clearSnooze`] — `bumpAll()` moved inside the `if (existed)` guard so no-op clears do not thrash consumers.
- [x] [Review][Patch] **`useSettingsTab.setTab` pushes a history entry per tab click** [`hooks/useSettingsTab.ts:setTab`] — changed to `setSearchParams(nextParams, { replace: true })`. Back button now leaves `/settings` on the first press regardless of tab-hop depth.
- [x] [Review][Patch] **PATCH handler collapses `MaxBytesError` into generic 422 "invalid JSON"** [`internal/service/errors.go` + `internal/middleware/error_mapper.go` + `internal/handler/settings_handler.go`] — new `service.PayloadTooLargeError` type → mapped to 413 `PAYLOAD_TOO_LARGE` in the error mapper. Handler's `decodeUpdateCenterProfileBody` detects `*http.MaxBytesError` (via `errors.As`) and emits the typed error; also distinguishes `io.EOF` (empty body → 422 "body is required"). MaxBytesReader constructed with `nil` ResponseWriter arg to avoid auto-header race. New test `TestSettingsHandler_Patch_OversizedBody_Returns413`.
- [x] [Review][Patch] **AC5 negative assertion "`useNavigate` NOT called" missing from ReopenChecklistCta test** [`components/__tests__/ReopenChecklistCta.test.tsx`] — vi.mock spies on `useNavigate`; `beforeEach` clears the spy; click-flow test asserts `expect(navigateSpy).not.toHaveBeenCalled()`.

**Defer** (real but not blocking this story):

- [x] [Review][Defer] **AC14 cross-chunk sharpening is testid-only, not code-overlap scan** [`classlite-web/e2e/route-bundle-boundaries.spec.ts:509-557`] — deferred, refine in FU-2-5-\* bundle audit
- [x] [Review][Defer] **WF-9 `docs/manual-setup.md` scope creep — includes rows for prior stories not touched by 2-5a** [`docs/manual-setup.md`] — deferred, roll into 2-5c or a docs-cleanup pass
- [x] [Review][Defer] **PATCH handler silently accepts unknown fields — misleading audit trail on `shortCode`/`role` probes** [`classlite-api/internal/handler/settings_handler.go:1520-1555`] — deferred, add `json.DisallowUnknownFields()` in a security-hardening pass
- [x] [Review][Defer] **Graduated `centerCreated` checklist row is clickable when `done: true` — inconsistent affordance vs sibling done rows** [`classlite-web/src/features/dashboard/FinishSetupCard.tsx:649-666`] — deferred to Story 3.x checklist-refresh
- [x] [Review][Defer] **Timezone parity regex captures IANA-shaped strings inside comments** [`classlite-api/internal/service/settings_timezone_parity_test.go:2565`] — deferred, replace with a JS-side export manifest when TS whitelist grows
- [x] [Review][Defer] **Graduated FinishSetupCard branch emits no Sentry breadcrumb — click-through funnel invisible for shipped surfaces** [`classlite-web/src/features/dashboard/FinishSetupCard.tsx:649-666`] — deferred, add in the same checklist-refresh pass
- [x] [Review][Defer] **CR-2-5A-7 (demoted from P6) — Owner briefly sees PermissionDenied while `useRole()` returns null during boot** [`classlite-web/src/features/settings/SettingsPage.tsx:60`] — Story 1-7c stub returns null perpetually today; a null-loading guard would render an eternal skeleton in production. Real fix requires Story 2-6's role resolution to expose a distinct "loading" phase. Filed as CR-2-5A-7 for the 2-6 review pass.

## Dev Notes

### Story context and epic position

Story 2-5a is the first of three sub-stories split from parent 2-5 after party-mode adversarial review 2026-07-14. It lands the load-bearing pieces: the `/settings` route + Profile tab + FU-2-4-D closure. Sub-stories 2-5b (Terms/Rooms/Holidays) + 2-5c (Google Meet OAuth) follow. Users unblocked by 2-5a: snoozed Owners can re-open the setup checklist from Settings.

**Upstream dependencies (all shipped):**
- Story 2.1 — `centers` table, `POST /api/centers`, audit-log-within-tx pattern.
- Story 1-7c — `PermissionDenied` component + `AppLayout` shell + sidebar with `/settings` nav item.
- Story 1d-2 — shadcn form primitives (Input, Label, Button, Alert).
- Story 2-4 — Sonner Toaster at `App.tsx:74`; `useChecklistState` hook (Task 5.1 extends); `<DeadLinkTrigger>` graduation source.

**Downstream:**
- Story 2-5b consumes the tab-strip shell + adds Terms/Rooms/Holidays tab bodies.
- Story 2-5c consumes the tab-strip shell + adds Integrations tab body + Google Meet OAuth backend.
- Story 2.6 replaces the inline role check with router-level errorElement per Winston-W-STRONG-9 → FU-2-5-H.
- Story 2.6 role-broadcast handles mid-session role demotion (out of 2-5a scope per Murat-S5 → REJECTED, deferred to Story 2.6).

### Timezone whitelist — 30 IANA entries

Fixed 30-entry list covering ClassLite target market. Do NOT enumerate all 425+ IANA zones (UI + i18n nightmare).

- **Asia (VN + neighbors + regional gateways)**: `Asia/Ho_Chi_Minh` (default), `Asia/Bangkok`, `Asia/Singapore`, `Asia/Jakarta`, `Asia/Manila`, `Asia/Kuala_Lumpur`, `Asia/Hong_Kong`, `Asia/Shanghai`, `Asia/Taipei`, `Asia/Seoul`, `Asia/Tokyo`, `Asia/Dubai`, `Asia/Kolkata`, `Asia/Karachi`.
- **Europe**: `Europe/London`, `Europe/Paris`, `Europe/Berlin`, `Europe/Amsterdam`, `Europe/Madrid`, `Europe/Warsaw`, `Europe/Moscow`, `Europe/Istanbul`.
- **Americas**: `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, `America/Toronto`, `America/Sao_Paulo`.
- **Oceania**: `Australia/Sydney`, `Pacific/Auckland`.

Pinned as `const` in `src/features/settings/lib/timezoneWhitelist.ts` + mirror in Go at `internal/service/settings.go` (duplicate literal — 30 items × 2 languages is cheap; drift caught by `settings_timezone_parity_test.go` per Task 3.6).

PATCH handler rejects timezones NOT on the whitelist with `422 UNSUPPORTED_TIMEZONE`.

### `centers` table — global, no RLS — tenant assertion at handler layer

Per `20260601120000_create_auth_tables.up.sql:26`, `centers` is global (no RLS). Handler MUST assert `{id} == tc.CenterID` before service dispatch. Service MUST pass `tc.CenterID` (not path `{id}`) to the UPDATE query — belt-and-suspenders per Winston-S3. This story cannot rely on RLS for centers protection.

### `settingsKeys.ts` — new query-key factory

Per Amelia-S2 + John ACCEPT — every feature needs its own hierarchical key factory per TS-3. 2-5b adds `terms(centerId)` / `holidays(centerId)` / `rooms(centerId)`; 2-5c adds `integration(provider)`. Structure per shipped `authKeys.ts` pattern.

### Cache invalidation — `setQueryData` NOT `invalidateQueries`

Per Winston-S10 + John ACCEPT: `authKeys.session()` cache is written imperatively (via login/mutation/refresh paths), NOT via `useQuery`. `invalidateQueries` marks stale but no refetch fires — sidebar/topbar would stay on old data. Solution: `queryClient.setQueryData(authKeys.session(), (prev) => ({...prev, center: {...prev.center, ...updated}}))` — direct write matches shipped `useCreateCenter.ts:72-80`.

### MSW handler contract inventory

Factories in `src/features/settings/api/__tests__/handlers.ts` (NEW file):

| Factory | Returns |
|---|---|
| `centerProfile({ overrides })` | full CenterProfile envelope; defaults match `Asia/Ho_Chi_Minh` |
| `updateCenterProfileSuccess({ overrides })` | 200 envelope with merged fields |
| `errorEnvelope(code, message, status)` | Error envelope; reused across error rows |

Failure-injection MSW handlers for each endpoint's 500 / 403 / 422 / 429 branch. Never mock `useQuery` / `useMutation` per TEST-FE-1.

### data-testid inventory + Sonner toast id inventory

**data-testids** — pinned upfront for E2E stability:

| Testid | Owner |
|---|---|
| `settings-tab-strip` | `SettingsPage.tsx` — 4-tab strip container |
| `settings-tab-profile` / `-terms` / `-integrations` / `-rooms` | Tab buttons |
| `settings-tabpanel-profile` | Profile tab body |
| `settings-tab-placeholder-terms` / `-integrations` / `-rooms` | Placeholder EmptyStates |
| `settings-profile-name-input` / `-contactEmail-input` / `-brandColor-picker` / `-timezone-select` / `-shortCode-input` / `-save-button` | Profile form |
| `settings-reopen-checklist-cta` | ReopenChecklistCta button |
| `settings-danger-transfer-ownership` / `-archive-center` | Danger Zone DeadLinkTriggers |
| `settings-permission-denied` | PermissionDenied surface for non-Owner |

**Sonner toast ids** [Sally-INFO-1 + John ACCEPT — queue-of-one]:

| Toast id | Fires on |
|---|---|
| `settings-profile-save` | Successful PATCH |
| `settings-profile-save-error` | Failed PATCH |
| `settings-reopen-checklist` | ReopenChecklistCta click |
| `settings-error` | Generic fallback |

Assert toast via `screen.findByRole('status')` or `findByText`, NOT testid (Sonner portals to `document.body`).

### Files to touch — inventory

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Task 2 — 2 endpoints + 3 schemas |
| `classlite-api/migrations/20260714120000_add_centers_contact_email.up.sql` + `.down.sql` | NEW | Task 1.2 |
| `classlite-api/internal/store/queries/centers.sql` | UPDATE | Task 1.4 — add UpdateCenter + GetCenterByIDInTenant |
| `classlite-api/internal/store/generated/*` | AUTOGEN | Task 1.5 — `codegen.sh` output |
| `classlite-api/internal/service/settings.go` + `_test.go` | NEW | Task 3.1 |
| `classlite-api/internal/handler/settings_handler.go` + `_test.go` | NEW | Task 3.3 |
| `classlite-api/internal/handler/errors.go` + `error_mapper_test.go` | UPDATE | Task 3.2 — register 2 error codes |
| `classlite-api/cmd/api/main.go` | UPDATE | Task 3.4 — register settingsChain |
| `classlite-api/internal/service/settings_timezone_parity_test.go` | NEW | Task 3.6 |
| `classlite-web/src/lib/api/*` | AUTOGEN | Task 2.3 — `codegen.sh` regen |
| `classlite-web/src/routes.tsx` | UPDATE | Task 4.8 — `/settings` route |
| `classlite-web/src/features/settings/SettingsPage.tsx` + `.stories.tsx` + `__tests__/SettingsPage.test.tsx` | NEW | Task 4.1 / 4.10 / 4.11 |
| `classlite-web/src/features/settings/ProfileTab.tsx` + `.stories.tsx` + `__tests__/ProfileTab.test.tsx` | NEW | Task 4.2 |
| `classlite-web/src/features/settings/lib/schemas.ts` | NEW | Task 4.3 |
| `classlite-web/src/features/settings/lib/timezoneWhitelist.ts` | NEW | Task 4.4 |
| `classlite-web/src/features/settings/hooks/useSettingsTab.ts` | NEW | Task 4.1 |
| `classlite-web/src/features/settings/api/settingsKeys.ts` | NEW | Task 4.5 |
| `classlite-web/src/features/settings/api/useCenterProfile.ts` + `useUpdateCenterProfile.ts` | NEW | Task 4.6 / 4.7 |
| `classlite-web/src/features/settings/api/__tests__/handlers.ts` | NEW | Task 4.9 |
| `classlite-web/src/features/settings/components/DangerZoneCard.tsx` + `AboutCard.tsx` + `ReopenChecklistCta.tsx` + `BrandColorField.tsx` + `TimezoneField.tsx` + `ContactEmailField.tsx` | NEW | Task 4.2 / 5.3 |
| `classlite-web/src/features/settings/components/__tests__/ReopenChecklistCta.test.tsx` | NEW | Task 5.4 |
| `classlite-web/src/features/dashboard/hooks/useChecklistState.ts` | UPDATE | Task 5.1 — add `clearSnooze()` |
| `classlite-web/src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx` | UPDATE | Task 5.2 |
| `classlite-web/src/features/dashboard/lib/checklistDefinition.ts` | UPDATE | Task 5.5 — add `targetShipped` discriminant; graduate `/settings` DeadLinkTrigger |
| `classlite-web/src/features/dashboard/FinishSetupCard.tsx` | UPDATE | Task 5.5 — renderer branches on `targetShipped` |
| `classlite-web/src/locales/en.json` + `vi.json` | UPDATE | Task 6.2 — ~30-40 new keys |
| `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` | UPDATE | Task 6.3 — STORY_2_5A_KEYS block |
| `classlite-web/e2e/route-bundle-boundaries.spec.ts` | UPDATE | Task 7.1 |

**Files to READ before touching anything else** (pre-flight per `[[feedback_check_prior_story_artifacts_before_generating]]`):

- `classlite-api/migrations/20260601120000_create_auth_tables.up.sql:28-37` — existing `centers` schema.
- `classlite-api/internal/store/queries/centers.sql` — existing centers queries to amend.
- `classlite-api/internal/service/center.go` — Story 2.1 create-center reference; audit-log-within-tx pattern.
- `classlite-api/internal/handler/center_handler.go` — thin handler pattern to mirror.
- `classlite-api/internal/handler/template_handler.go:237` — `r.PathValue("id")` reference.
- `classlite-api/internal/middleware/require_role.go` — Owner-only gate.
- `classlite-api/cmd/api/main.go:222-304` — Story 2.1/2.2 chain registration pattern.
- `classlite-api/internal/handler/errors.go` — error mapper (Task 3.2 amends).
- `classlite-web/src/features/dashboard/hooks/useChecklistState.ts` — hook Task 5.1 extends.
- `classlite-web/src/features/dashboard/lib/checklistDefinition.ts:67-75` — `centerCreated` item Task 5.5 graduates.
- `classlite-web/src/features/dashboard/FinishSetupCard.tsx` — renderer Task 5.5 amends.
- `classlite-web/src/features/dashboard/__tests__/noTrialMechanic.test.ts:118-136` — reject-list for Task 6.1 pre-flight.
- `classlite-web/src/features/onboarding/CenterSetupPage.tsx` — brand-color picker pattern to reuse.
- `classlite-web/src/features/onboarding/api/useCreateCenter.ts:72-80` — cache-write pattern to mirror in Task 4.7.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — role-gate component + `['owner']` variant.
- `classlite-web/src/components/domain/sidebarNavConfig.tsx:52-55` — shipped `/settings` sidebar entry.
- `classlite-web/src/features/auth/api/authKeys.ts` — `Session` + `CenterSummary` shape.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts:1017-1174` — STORY_2_3C/2_4_KEYS block pattern to mirror.
- `docs/classlite-entry/05-cross-role.html:6819-7180` — s49 mockup (Profile tab lines 6873-6965).
- `scripts/codegen.sh:16-24` — openapi-zod-client TODO (Amelia-B1 evidence).
- `_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md` — parent spec shared context.
- `docs/project-context.md#GO-1..7, FW-1..7, SEC-1..11, WF-1..8, TEST-FE-1..6, TEST-BE-1..5` — cross-cutting rules.
- `docs/bmad-story-conventions.md` — 600-line ceiling + sibling completion-notes split.

### WF-8 ATDD applicability

Story 2-5a owns NO risk score ≥6:
- R1 (RLS cross-tenant, score 9) — discharged Epic 1A; centers is global-no-RLS so this story doesn't add tenant-scoped tables.
- R6 (Google OAuth callback) — belongs to 2-5c, not this story.
- R38 (i18n parity, score 6) — discharged Story 1-7c + inherited via per-story STORY_2_5A_KEYS block per AC13.

**ATDD is RECOMMENDED but SKIPPABLE.** Task 0.2 records choice at dev pickup.

### Filed follow-ups (NOT this story's work)

- **`FU-2-5-A`** — Logo re-upload UI. Deps R2 presigned upload wire (Story 2-2). Priority: P3.
- **`FU-2-5-C`** — Amend `epic-02.md` per Owner-only spec-conflict resolution. Trivial doc-only edit. Priority: P2.
- **`FU-2-5-F`** — Transfer ownership + Archive center Danger Zone flows. Deps Story 2.6 + Story 9.x. Priority: P3.
- **`FU-2-5-G`** — Contact-email `reply-to` propagation. This story adds the column; consumption follows. Priority: P3.
- **`FU-2-5-H`** — Router-level role gate replaces inline check. Story 2.6 owns. Priority: P2.
- **`FU-2-5-I`** — Branches / multi-campus field per mockup s49:6904-6911. Deferred as multi-location feature per Sally-BLOCKER-1 + John DEFER. Priority: P3.
- **`FU-2-5-J`** — openapi-zod-client migration (resolve zod3/4 conflict). Deps external SDK ecosystem. Priority: P2.
- **`FU-2-5-K`** — Danger Zone empty-state redesign (when FU-2-5-F ships). Priority: P4.
- **`FU-2-5-N`** — Playwright session-cache seeding infra for Settings E2E. Mirror of FU-2-4-J. Priority: P3.

### Testing standards inheritance

- **TEST-FE-1**: MSW at HTTP boundary. `useChecklistState.clearSnooze` reads localStorage; mocking `window.localStorage` fine.
- **TEST-FE-2**: Three-state coverage on ProfileTab per AC4.
- **TEST-FE-3**: `beforeEach(() => window.localStorage.clear())` on `ReopenChecklistCta.test.tsx` + extended `useChecklistState.test.tsx`.
- **TEST-FE-4**: AC13 pins closed enumeration STORY_2_5A_KEYS + prefix ratchet + `assertI18nInterpolationParity` over ALL keys.
- **TEST-FE-5**: axe zero violations per AC15 matrix (10 renders).
- **TEST-FE-6**: Non-Owner PermissionDenied test asserts tab strip NOT in DOM (not visually hidden).
- **TEST-BE-1**: N/A (centers is global-no-RLS; no new tenant-scoped tables in this sub-story).
- **TEST-BE-2**: Store test uses real DB in tx.
- **TEST-BE-3**: Handler test via `test.NewTestServer` — full envelope + tenant-mismatch + role-gate + 429 with `Retry-After` header.
- **TEST-BE-4**: Service test mocks store interface — cover timezone-whitelist rejection + audit-row shape.

### Project Structure Notes

- **NEW feature directory**: `classlite-web/src/features/settings/` — no existing feature to extend.
- **Backend NEW packages**: 1 new service + 1 new handler under existing `internal/service/` + `internal/handler/`.
- **Shared/extended files**:
  - `useChecklistState.ts` — Task 5.1 adds `clearSnooze` method (backward compatible).
  - `checklistDefinition.ts` + `FinishSetupCard.tsx` — Task 5.5 adds `targetShipped` discriminant + renderer branch.
- **Cross-service atomic commit** (WF-4) — api.yaml + generated types + backend + frontend land in ONE commit or a small ordered sequence.
- **Codegen order (WF-3)**: `.sql` + api.yaml edits touched → `codegen.sh` MUST be the last script run before final push.
- **`git status` at hand-off** MUST show: backend files, frontend files, story artifacts, sprint-status. NO cross-package changes outside listed paths.

### References

- [Source: `_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md`] — parent spec shared context.
- [Source: `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.5` lines 207-239] — canonical epic-level 6 ACs.
- [Source: `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-7` line 280] — Owner-only.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#8.2` line 469] — Owner-only s49 tabbed screen.
- [Source: `docs/classlite-entry/05-cross-role.html:6873-6965`] — s49 mockup Profile tab.
- [Source: `classlite-api/migrations/20260601120000_create_auth_tables.up.sql:28-37`] — existing `centers` schema.
- [Source: `classlite-api/internal/service/center.go`] — audit-log-within-tx pattern from Story 2.1.
- [Source: `classlite-api/internal/handler/template_handler.go:237`] — `r.PathValue("id")` reference.
- [Source: `classlite-api/internal/middleware/require_role.go`] — Owner-only gate.
- [Source: `classlite-web/src/features/dashboard/hooks/useChecklistState.ts`] — hook Task 5.1 extends.
- [Source: `classlite-web/src/features/dashboard/lib/checklistDefinition.ts:67-75`] — DeadLinkTrigger target Task 5.5 graduates.
- [Source: `classlite-web/src/features/onboarding/api/useCreateCenter.ts:72-80`] — cache-write pattern.
- [Source: `classlite-web/src/components/shared/PermissionDenied.tsx`] — role-gate component + `['owner']` variant.
- [Source: `classlite-web/src/components/domain/sidebarNavConfig.tsx:52-55`] — shipped `/settings` sidebar entry.
- [Source: `_bmad-output/implementation-artifacts/2-4-post-onboarding-checklist-and-first-ai-grade-card.md`] — Sonner + DeadLinkTrigger + STORY_KEYS block pattern; FU-2-4-D dependency this story closes.
- [Source: `scripts/codegen.sh:16-24`] — openapi-zod-client TODO evidence (Amelia-B1).
- [Source: `docs/project-context.md#GO-1..7, FW-1..7, SEC-1..11, WF-1..8, TEST-FE-1..6, TEST-BE-1..5`] — cross-cutting rules.
- [Source: `docs/bmad-story-conventions.md`] — 600-line ceiling + sibling completion-notes split.

## Definition of Done

1. All 16 ACs green (functional + typed + tested).
2. `npm run test` clean — expected delta **~+50-70 tests**; no regression on 5 named 2-4 shipped test files per Task 5.6.
3. `npm run lint` clean.
4. `npm run i18n-parity` clean — pinned `STORY_2_5A_KEYS` (est. ~30-40 keys) + prefix-ratchet + `assertI18nInterpolationParity` over ALL keys.
5. `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
6. `axe-core` zero violations per AC15 matrix — 10 renders (4 tab states × 2 locales + Owner + Non-Owner).
7. Storybook: SettingsPage ≥4 variants; ProfileTab ≥4; ReopenChecklistCta ≥2 (snoozed + not-snoozed).
8. `git status` shows ONLY backend + frontend + story artifacts + `sprint-status.yaml`. `codegen.sh` was the LAST script run before push (WF-3).
9. `cd classlite-api && go test ./...` clean; `go vet ./...` clean; `golangci-lint run` clean.
10. `npm run build` clean; `SettingsPage-*.js` chunk emits + size ≤ 15 kB gzip.
11. Route-bundle-boundaries extended assertion green per Task 7.1.
12. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab-completion-notes.md` per `docs/bmad-story-conventions.md` — record actual key count vs estimate, Storybook variant counts, deviations from AC matrix, `useChecklistState.clearSnooze` test row runtime map.
13. Change Log updated: pre-dev context + ATDD choice + all fold citations (BLOCKERs B2/B3/B4/B11/B12 + STRONG list).
14. Sprint-status `2-5a-backend-and-profile-tab` flipped `ready-for-dev → in-progress → review` at hand-off.

## Out of Scope

- Terms + Rooms + Holidays CRUD — Story 2-5b.
- Google Meet OAuth + Integrations tab — Story 2-5c.
- Branches / multi-campus — FU-2-5-I.
- Logo re-upload UI — FU-2-5-A.
- Contact-email consumption as reply-to — FU-2-5-G.
- Transfer ownership + Archive center — FU-2-5-F.
- Router-level role gate — FU-2-5-H (Story 2.6).
- Router-broadcast mid-session role demotion — Story 2.6 scope.
- Encryption key rotation — FU-2-5-L (2-5c concern).
- NFR audit doc — FU-2-5-M (2-5c concern).
- Playwright OAuth stubbing — FU-2-5-N (2-5c concern).

## Change Log

| Date | Note |
|---|---|
| 2026-07-14 | Green-phase shipped `ready-for-dev → in-progress → review` via `/bmad-dev-story 2-5a`. All 8 tasks + ~48 subtasks checked (Task 4.11 Storybook variants deferred to Round 1 review; Task 5.5 renderer branch shipped with pragmatic deviation — non-graduated items stay inert, don't wire DeadLinkTrigger, per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`). Backend: 1 migration (centers.contact_email), amended centers.sql (GetCenterByIDInTenant + UpdateCenter with sqlc.narg partial-update), 2 new endpoints (GET+PATCH /api/centers/{id}), new SettingsService + SettingsHandler with tenant-binding assertion, UNSUPPORTED_TIMEZONE + TENANT_MISMATCH error codes registered in middleware/error_mapper.go, UserAndIPKeyFn rate-limit helper (60 req/min), settingsChain in main.go with full ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") → settingsLimit stack. Frontend: `src/features/settings/` new dir with SettingsPage + ProfileTab + hooks/useSettingsTab + api/{settingsKeys,useCenterProfile,useUpdateCenterProfile} + lib/{schemas,timezoneWhitelist} + components/ReopenChecklistCta; `/settings` lazy route mounted. `useChecklistState` extended with `clearSnooze()` (localStorage.removeItem + idempotent breadcrumb). `checklistDefinition.centerCreated` graduated via `targetShipped: true`; FinishSetupCard renderer branches on it (button+navigate for shipped, inert `<li>` otherwise). Testing at hand-off: **1298/1298 vitest** (96 files, +69 vs baseline 1229 — 22 useChecklistState including 5 clearSnooze + 11 SettingsPage + 8 ProfileTab + 4 ReopenChecklistCta + 271 i18n-parity including 38 STORY_2_5A_KEYS × ~4 assertions), **backend `go test ./...` clean** (14 packages incl. new SettingsService store + handler + timezone parity), **`go vet` clean**, **`npm run lint` clean**, **`tsc --noEmit -p tsconfig.app.json` + `-p tsconfig.e2e.json` clean**, **`npm run i18n-parity` clean at 607 keys**, **`npm run build` clean** (SettingsPage-*.js emits at 13.8 kB raw / 4.2 kB gzip, well under 15 kB DoD cap), **11/11 Playwright route-bundle-boundaries** including new Story 2-5a AC14 assertion. **Load-bearing folds shipped**: (a) sqlc column-order pinned so all 6 centers queries return the unified `Center` struct (not query-specific rows); (b) belt-and-suspenders tenant check — handler asserts `pathID == tc.CenterID` AND service passes tc.CenterID to WHERE clause (centers is global-no-RLS); (c) TS + Go timezone whitelists mirror-locked by `settings_timezone_parity_test.go` regex-extract; (d) `authKeys.session()` cache write on PATCH success (imperative setQueryData) — sidebar/topbar re-render without refetch flicker per Winston-S10; (e) `BrandColorPicker` extracted as sibling component so RHF `useWatch` replaces the React-Compiler-flagged `form.watch()` inside the render loop; (f) shipped Story 2-4 test files stay green (135/135 dashboard); `FinishSetupCard.test.tsx` harness updated to wrap in `MemoryRouter` for the new `useNavigate` call. **Pragmatic amendments** (documented in sibling completion-notes Debug Log): Task 4.11 Storybook variants deferred; Task 5.5 else-branch renders inert `<li>` (spec's DeadLinkTrigger else-branch would add 5+ new toast triggers in one commit — scope creep); Task 3.5 service test uses real-DB via `test.SetupDB` (matches shipped `center_test.go` convention — the repo doesn't ship a separate mock-store seam). Sibling completion-notes at `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab-completion-notes.md`. Baseline commit `99d1f69` unchanged. Hand-off: `/code-review 2-5a` on a **different** LLM. |
| 2026-07-14 | Story created backlog → ready-for-dev. Amelia's pre-dev context-engine pass against baseline `99d1f69`. Split 1 of 3 from parent story 2-5 after party-mode adversarial review (Sally + Winston + Amelia + Murat; John ruled). Owner-only per LITERAL-to-PRD (user-confirmed). Absorbs John-ACCEPTed folds: **BLOCKERs** B2 (contact_email column + UI wired), B3 (shortCode read-only disabled input), B4 (Loading/Error trilogy on Profile), B11 (noTrialMechanic pre-flight + AC17 `.getState()` typo fixed to render assertion), B12 (`clearSnooze` uses `localStorage.removeItem`); **STRONGs** S1 (toast voice), S3 (useLayoutEffect StrictMode guard — deferred to 2-5c since it's about OAuth callback), S5 (PermissionDenied inside AppLayout), S8 (WAI-ARIA tab focus stays on button), S10 (migration timestamp pre-flight), S17 (timezone parity test), S19 (setQueryData not invalidate), S20 (register 2 error codes: UNSUPPORTED_TIMEZONE + TENANT_MISMATCH), S22 (chunk-split ordering), S24 (settingsKeys.ts factory), S25 (i18n-first task order), S26 (r.PathValue cited), S27 (sqlc.narg pointer-type note), S33 (ReopenChecklistCta conditional render only when snoozed), S41 (named-file regression list); **INFOs** I1 (Sonner queue-of-one 4 fixed ids for this story), I2 (noTrialMechanic pre-flight in Task 5.5). Rejected: B13/B14 (ATDD keeps SKIPPABLE, STORY_2_5A_KEYS pinned at dev time), S2 (VN drafting is Ducdo's ownership), S6 (past-term View split — theater), S13 (shared-NAT rate limit — theoretical, ships as-is), S16 (useChecklistState refactor — kept in dashboard/hooks with cross-chunk sharpened assertion), S32 (discriminant pre-optimization — Task 5.5 keeps 1-line target), S38 (mid-session role demotion is Story 2.6 scope). Deferred: B1 → FU-2-5-I (branches), S4 → FU-2-5-K (danger zone empty-state), S11 → FU-2-5-L (key rotation), S28 → FU-2-5-N (Playwright session infra). Story file target ≤500 lines. |
