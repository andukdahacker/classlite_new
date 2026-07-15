---
baseline_commit: 99d1f69
---

# Story 2.5: Center Settings & Google Meet Integration — SUPERSEDED BY SPLIT

Status: superseded

> **SUPERSEDED 2026-07-14** — split into three sub-stories after party-mode adversarial review (Sally + Winston + Amelia + Murat; John ruled). Sub-stories carry the John-accepted BLOCKER + STRONG folds. Do NOT pick up this file. See:
> - [`2-5a-backend-and-profile-tab.md`](./2-5a-backend-and-profile-tab.md) — backend migrations + centers PATCH + Profile tab + FU-2-4-D closure. Absorbs BLOCKERs B2/B3/B4/B11/B12.
> - [`2-5b-terms-holidays-rooms-tabs.md`](./2-5b-terms-holidays-rooms-tabs.md) — 3 CRUD entities + tab bodies. Absorbs STRONG S9 empty-state copy.
> - [`2-5c-google-meet-oauth-integration.md`](./2-5c-google-meet-oauth-integration.md) — OAuth flow + AES-GCM crypto + Integrations tab. Absorbs BLOCKERs B7/B8/B9 + related security STRONGs.
>
> The original spec body below preserves the shared context (project rules, prior-story references, mockup anchors) that all three sub-stories inherit. Sub-stories may reference `[Source: 2-5-superseded-see-2-5a-b-c.md#<section>]` for that shared context rather than duplicating.

---

## Original spec body (retained for shared-context reference)

Status was: ready-for-dev

<!-- Baseline: 99d1f69 (Story 2-4 shipped `review → done` after 3-chunk `/bmad-code-review 2-4` pass — checklist card + first-run value cards + your-classes row + Sonner DeadLinkTrigger + 42 i18n keys + 1229/1229 vitest). -->
<!-- This story wires the FIRST authenticated `/settings` surface (screen s49). It (a) graduates Story 2-4's `<DeadLinkTrigger targetPath="/settings">` to a real route + closes the P2 FU-2-4-D reopen-checklist affordance, (b) adds the backend + UI to edit center profile / manage terms + rooms / connect Google Meet, and (c) lays the OAuth-tokens-per-center foundation Epic 3 session-scheduling consumes when it auto-generates Meet links. -->
<!-- Full-stack story (`Size: L | Audience: Full-stack` per epic-02.md:209). Backend surface: 3 new migrations (terms, rooms, center_integrations OAuth-token storage), 4 new sqlc query files (centers UPDATE, terms CRUD, rooms CRUD, center_integrations upsert), 4 new services (settings/term/room/google_meet), ~14 new endpoints in api.yaml, RequireRole gate. Frontend surface: `/settings` route + tabbed shell (Profile / Term calendar / Integrations / Rooms) per UX-DR21 s49 + graduated DeadLinkTrigger + FU-2-4-D reopen affordance. -->
<!-- Spec conflict flagged for author decision: epic-02.md AC1 + AC5 allow Owner OR Admin; PRD FR-7 + FR-9 + UX §8.2 all say Owner-ONLY. Spec resolves LITERAL-TO-PRD (Owner-only in v1 — matches shipped sidebar config at sidebarNavConfig.tsx:54, matches PermissionDenied component's `['owner', 'admin']` vs `['owner']` two-mode contract). Rationale in Dev Notes §"Owner-only vs Owner+Admin — spec conflict resolution". Amend the epic doc in a follow-up commit; do NOT re-open at code review. -->
<!-- Split option flagged: this story approaches the upper edge of what fits one dev cycle. If dev picks up and finds the workload exceeds one sprint's budget, the natural split is 2-5a (backend + profile tab only, closes FU-2-4-D), 2-5b (terms + rooms tabs), 2-5c (Google Meet OAuth). Dev owns the split call at pickup; the sprint-status yaml would flip to `2-5a/b/c` accordingly. -->

## Story

As a **center Owner**,
I want to **manage center identity + timezone, curate term calendar and rooms, and connect Google Meet from a single `/settings` screen**,
so that **the center stays current without a support ticket, virtual classes get automatic Meet links, and the "Finish setting up" checklist can be re-opened after I snoozed it**.

## Acceptance Criteria

1. **Route + shell — `/settings` (Owner-only) mounts inside `AppLayout` with a 4-tab strip.** Route added to `routes.tsx` under the existing `AppLayout` children block (mirror of the shipped `/dashboard` entry at `routes.tsx:193`). Lazy-loaded `SettingsPage` in its own Rolldown chunk per Winston-W5 chunk-isolation pattern (`e2e/route-bundle-boundaries.spec.ts` extended per AC15). Tab strip renders: `Profile` / `Term calendar` / `Integrations` / `Rooms` — mirrors mockup s49 (`docs/classlite-entry/05-cross-role.html:6873-7180`). Default tab = `Profile`. Tab state lives in URL: `/settings` (Profile), `/settings?tab=terms`, `/settings?tab=integrations`, `/settings?tab=rooms` — deep-link stable, back-button restores previous tab. Invalid `?tab=` value falls back to Profile (no throw, no navigate).

2. **Role gate — Owner-only route in v1, Teachers + Students + Admins hit `<PermissionDenied requiredRoles={['owner']} />`.** Router-level guard via `errorElement`-based redirect (Story 2-6 pattern) OR inline check inside `SettingsPage` returning `<PermissionDenied requiredRoles={['owner']} />` before mounting the tab shell. Given Story 2-6 has NOT shipped the router-level role split yet, this story ships the inline check + wires a comment marker (`// TODO(story-2-6): move to route-level errorElement + role gate`). The shipped `PermissionDenied` component (`src/components/shared/PermissionDenied.tsx`) already accepts the `['owner']` requiredRoles variant (see `PermissionDeniedRoles` type at line 25) — no component work required. Backend endpoints likewise gated by `middleware.RequireRole("owner")` (existing middleware at `internal/middleware/require_role.go`). **Non-Owner** access-attempt returns HTTP 403 `INSUFFICIENT_ROLE` from the API AND renders PermissionDenied on the client.

3. **Profile tab — Owner edits name, brand color, logo, timezone; save via RHF + Zod.** Form fields per mockup s49 (`05-cross-role.html:6891-6942`): center name (required, 1-120 chars — matches shipped `POST /api/centers` constraint at api.yaml:1024), brand color (6-swatch picker + free-form hex — reuses `onboarding.center.form.brandColor.*` i18n keys), logo (existing-only view + "upload custom logo →" wired to `<DeadLinkTrigger>` for v1 — logo re-upload is a Story 2.5.x follow-up FU-2-5-A gated on the Story 2-2 R2 presigned-upload flow at api.yaml `/api/uploads/presign`), timezone (IANA dropdown seeded from a fixed 30-entry list — see Dev Notes §"Timezone whitelist"). Read-only info card (right column): `Created` date + `By` (owner displayName) + `Plan` (`Free` in v1 — Epic 9 replaces) + `ID` (shortCode). Danger-zone card renders `Transfer ownership` + `Archive center` buttons as `<DeadLinkTrigger>` (both are Story 2.6 / 9.x). **Save behavior**: PATCH to `/api/centers/{id}` (see AC7), on success invalidate `authKeys.session()` so the sidebar/topbar re-reads the new name; on error render inline `<Alert>` per shipped 5-error matrix (422 field / 403 role / 401 auth / 429 rate / 500 generic). RHF-driven form uses `zodResolver`; `centerSettingsProfileSchema` in `src/features/settings/lib/schemas.ts`. Autosave is NOT implemented (explicit "Save changes" button per mockup :6860).

4. **Term calendar tab — Owner adds/edits/deletes terms + holidays.** Renders two sections per mockup :6978-7040: `Terms & holidays` (list of `term_row` entries with name / date range / state pill Current|Upcoming|Past / Edit button) + `Holidays & breaks` (list of holiday rows). **CRUD endpoints** per AC7 (`/api/terms`, `/api/holidays`). Create/edit modal reuses the shipped shadcn `Dialog` primitive (from Story 1d-2). State pill derived client-side from `startDate` + `endDate` vs `Date.now()` — `Current` when today ∈ [start,end], `Upcoming` when today < start, `Past` when today > end. Empty state (no terms yet) renders the shipped `<EmptyState>` component (`src/components/shared/EmptyState.tsx`) with `t('settings.terms.empty.headline')` + `t('settings.terms.empty.cta')`. Loading state = `<Skeleton>` rows mirroring row height. Error state = inline `<Alert>` with retry action. **Adjacency check** — creating a term with dates overlapping an existing term is allowed (advisory `<Alert variant="warning">` in the modal, save succeeds) — matches mockup silence on overlap. Adjacency SQL-side is NOT enforced.

5. **Rooms tab — Owner adds/edits/deletes physical rooms.** Renders `room_row` entries per mockup :7132-7175: room name (required, 1-80 chars) + description (optional, up to 240 chars) + capacity (required integer, 1-500). The "Online · Google Meet" row is a **read-only synthetic entry** (rendered when `google_meet_connected === true`, sourced from client-side state — NOT a real `rooms` row) with `no limit` capacity label + `Settings` button linking to the Integrations tab. Real `rooms` rows are physical only. CRUD endpoints per AC7 (`/api/rooms`). Empty state = shipped `<EmptyState>` (no rooms yet). Deleting a room that is referenced by any `sessions` row (Epic 3 hasn't shipped yet, but the FK will land in Story 3.2) MUST return 409 `ROOM_IN_USE` in Story 3.x — for v1 (before sessions exist) delete always succeeds. Comment marker `// TODO(story-3-2): reject if referenced by sessions`.

6. **Integrations tab + Google Meet Connect flow.** Renders 4 rows per mockup :7054-7118 — Google Meet (real), Google Drive / Google Calendar / Zoom (all rendered `Not connected` + toggle disabled with `<DeadLinkTrigger>` — v1 ships Meet only per PRD `[ASSUMPTION: Google Meet is the only integration in MVP...]` at prd.md:293).

   **Google Meet Connect** — real OAuth 2.0 flow. Click "Connect Google Meet" button →
   1. Client calls `GET /api/centers/{id}/integrations/google-meet/authorize` — server returns `{ authorizeUrl }` (302-style redirect URL to `accounts.google.com/o/oauth2/v2/auth` with the calendar-write scope + state param signed like Story 1.6's OAuth state).
   2. Client navigates the browser to `authorizeUrl`. User authenticates on Google, grants calendar scope.
   3. Google redirects back to `GET /api/centers/{id}/integrations/google-meet/callback?code=...&state=...`. Handler validates state (HMAC + TTL), exchanges code for tokens (`oauth2.Config.Exchange`), persists `{ access_token, refresh_token, expiry_at, scope }` into new `center_integrations` table row (encrypted at rest — see AC7), sets `centers.google_meet_connected = true`, writes `audit_logs` `center.integration.google_meet.connected` in same tx.
   4. Callback response = 302 redirect back to `/settings?tab=integrations&status=connected` (Owner sees the toggle now green + `Connected` state pill).

   **Disconnect flow** — click the on toggle → confirmation `<AlertDialog>` → on confirm `DELETE /api/centers/{id}/integrations/google-meet` → server clears `center_integrations` row + sets `google_meet_connected = false`. Audit `center.integration.google_meet.disconnected`. Existing sessions that used the token stay valid at Google's side until the user manually revokes at accounts.google.com — v1 does NOT call Google's token-revoke endpoint (documented follow-up FU-2-5-B P3).

   **Zero synchronous Meet-link creation in this story.** Meet-link generation on session insert happens in Epic 3 (Story 3.4 / 3.5). Story 2.5 only stores the tokens + connected-flag; Story 3.x consumes both.

7. **Backend API surface — new endpoints in api.yaml.** All endpoints Owner-only per AC2, middleware chain `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") → RateLimit → handler`. Full envelope + typed error codes per shipped conventions. All bodies typed; no `additionalProperties: true`.

   | Method | Path | Purpose | Response |
   |---|---|---|---|
   | GET | `/api/centers/{id}` | Fetch center profile | `EnvelopeCenterProfile` |
   | PATCH | `/api/centers/{id}` | Update name / brand / logo / timezone | `EnvelopeCenterProfile` |
   | GET | `/api/terms` | List all terms (center-scoped) | `EnvelopeListTermsResult` |
   | POST | `/api/terms` | Create term (name, startDate, endDate, sessionCount?) | `EnvelopeTerm` |
   | PATCH | `/api/terms/{id}` | Update term | `EnvelopeTerm` |
   | DELETE | `/api/terms/{id}` | Delete term | 204 |
   | GET | `/api/holidays` | List all holidays (center-scoped) | `EnvelopeListHolidaysResult` |
   | POST | `/api/holidays` | Create holiday (name, date) | `EnvelopeHoliday` |
   | PATCH | `/api/holidays/{id}` | Update holiday | `EnvelopeHoliday` |
   | DELETE | `/api/holidays/{id}` | Delete holiday | 204 |
   | GET | `/api/rooms` | List all rooms (center-scoped) | `EnvelopeListRoomsResult` |
   | POST | `/api/rooms` | Create room (name, description?, capacity) | `EnvelopeRoom` |
   | PATCH | `/api/rooms/{id}` | Update room | `EnvelopeRoom` |
   | DELETE | `/api/rooms/{id}` | Delete room (returns 409 if referenced — Story 3.x) | 204 |
   | GET | `/api/centers/{id}/integrations/google-meet/authorize` | Return signed OAuth URL | `{ data: { authorizeUrl } }` |
   | GET | `/api/centers/{id}/integrations/google-meet/callback` | Handle OAuth callback (302 to `/settings?tab=integrations&status=connected`) | 302 |
   | DELETE | `/api/centers/{id}/integrations/google-meet` | Disconnect Google Meet | 204 |

   **Rate limits (per-route)**: `settings` bucket = 60 req/min per user (browsing tab-switching is bursty); OAuth authorize/callback = 5 req/min per IP (CSRF hardening — matches Story 1.6 pattern). GET listings honor the shared onboardingLimit bucket. Slug + shortCode fields are **not** editable in v1 (would break existing student-facing class codes) — the PATCH endpoint ignores `shortCode` in request body with a comment marker; a v2 story would need a slug-rewrite migration.

   **`{id}` MUST equal `TenantContext.CenterID`** — the handler asserts this before any DB write (defense-in-depth vs RLS). Mismatch returns 403 `TENANT_MISMATCH`. Matches Story 1.6's tenant-binding pattern (`assertTenantBinding` in `auth_google.go`).

8. **Database migrations — 3 new tables + `centers.contact_email` column.**

   - **Migration `20260714120000_add_centers_contact_email`** — adds `contact_email text` column (nullable; used as reply-to for staff/student notification emails per mockup :6932-6935). NOT required in PATCH; NULL falls through to the shipped `RESEND_FROM_EMAIL` sender.
   - **Migration `20260714120100_create_terms`** — `terms` table: `id` uuid PK, `center_id` uuid NOT NULL REFERENCES centers ON DELETE CASCADE, `name` text NOT NULL (1-120 chars enforced via CHECK), `start_date` date NOT NULL, `end_date` date NOT NULL, `session_count` integer (nullable), `created_at` timestamptz NOT NULL. CHECK: `start_date <= end_date`. RLS enabled, ENFORCE ROW LEVEL SECURITY, 4 policies (SELECT/INSERT/UPDATE/DELETE) matching Story 2.2 pattern (`class_templates.up.sql:29-55`), all tenant-scoped. Index on `(center_id, start_date DESC)`.
   - **Migration `20260714120200_create_holidays`** — `holidays` table: `id` uuid PK, `center_id` uuid NOT NULL REFERENCES centers ON DELETE CASCADE, `name` text NOT NULL (1-120 chars), `date` date NOT NULL, `created_at` timestamptz NOT NULL. RLS + 4 policies as above. Index on `(center_id, date)`.
   - **Migration `20260714120300_create_rooms`** — `rooms` table: `id` uuid PK, `center_id` uuid NOT NULL REFERENCES centers ON DELETE CASCADE, `name` text NOT NULL (1-80 chars), `description` text (nullable, ≤240 chars), `capacity` integer NOT NULL CHECK (capacity BETWEEN 1 AND 500), `created_at` timestamptz NOT NULL. RLS + 4 policies as above. Index on `(center_id, name)`. UNIQUE on `(center_id, LOWER(name))` — prevents duplicate room names per center.
   - **Migration `20260714120400_create_center_integrations`** — `center_integrations` table: `id` uuid PK, `center_id` uuid NOT NULL REFERENCES centers ON DELETE CASCADE, `provider` text NOT NULL CHECK (provider IN ('google_meet')), `access_token_encrypted` bytea NOT NULL, `refresh_token_encrypted` bytea NOT NULL, `scope` text NOT NULL, `expires_at` timestamptz NOT NULL, `created_at` + `updated_at` timestamptz. UNIQUE on `(center_id, provider)` — one integration per provider per center. RLS + 4 policies as above. **Token encryption**: AES-GCM using a 32-byte key sourced from `INTEGRATIONS_ENCRYPTION_KEY` env var (added to `config.go` + `.env.example` + validated in `Validate()` when `provider = google_meet` is registered). Do NOT store plaintext tokens.

   All `.down.sql` migrations reverse the corresponding `.up.sql` (DROP TABLE / DROP COLUMN). Down migrations MUST reverse cleanly per WF-2. Migration file naming follows `{YYYYMMDDHHMMSS}_{description}.up.sql` per project convention.

9. **Sqlc queries + generated Go — WF-3 compliance.** New `.sql` files under `classlite-api/internal/store/queries/`:
   - `centers.sql` — **AMEND** existing file: add `UpdateCenter :one` (partial-update via `COALESCE($n, col)` pattern) + `GetCenterByIDInTenant :one` (RLS-safe fetch). Do NOT edit generated files under `store/generated/`.
   - `terms.sql` — new file: `ListTermsByTenant`, `CreateTerm`, `UpdateTerm`, `DeleteTerm`, `GetTermByID`.
   - `holidays.sql` — new file: `ListHolidaysByTenant`, `CreateHoliday`, `UpdateHoliday`, `DeleteHoliday`, `GetHolidayByID`.
   - `rooms.sql` — new file: `ListRoomsByTenant`, `CreateRoom`, `UpdateRoom`, `DeleteRoom`, `GetRoomByID`.
   - `center_integrations.sql` — new file: `GetIntegration`, `UpsertIntegration`, `DeleteIntegration`.

   After sqlc changes: `./scripts/codegen.sh` MUST run before any handler/service change compiles. Per WF-3 heuristic — because this story touches `.sql` files AND `api.yaml`, `codegen.sh` MUST be the last script run before considering implementation complete.

10. **Services + handlers — new packages.** Match the shipped layer boundaries (GO-3).
    - `internal/service/settings.go` — `SettingsService.UpdateCenter(ctx, tc, input)` + `GetCenter(ctx, tc)`. Emits `center.updated` audit row with before/after JSONB diff via `AuditLogger.LogWithinTx` (Story 2.1 pattern).
    - `internal/service/term.go` — `TermService.List/Create/Update/Delete`. Audit events: `center.term.created` / `.updated` / `.deleted`.
    - `internal/service/holiday.go` — `HolidayService.List/Create/Update/Delete`. Same audit pattern.
    - `internal/service/room.go` — `RoomService.List/Create/Update/Delete`. Same audit pattern. Delete pre-checks Story 3.x FK constraint (behind a boolean `sessionsExist` flag helper) — v1 always returns false; Story 3.x wires the real check.
    - `internal/service/google_meet.go` — `GoogleMeetService.BuildAuthorizeURL(ctx, tc)` + `HandleCallback(ctx, tc, code, state)` + `Disconnect(ctx, tc)`. Reuses the `oauth2` scaffolding pattern from `auth_google.go` — separate `oauth2.Config` (calendar scope) NOT the auth-login one. State signing helpers in `oauth_state.go` can be reused (extract shared struct if needed — pragmatic in-scope refactor per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`).
    - `internal/service/integration_crypto.go` — AES-GCM sealed-box helpers (`SealToken(plaintext, key) ([]byte, error)` + `OpenToken(ciphertext, key) ([]byte, error)`) — the ONLY code that touches raw tokens. Unit-test round-trip + tamper-detection.
    - `internal/handler/settings_handler.go` — thin HTTP wrapper delegating to services. Owner tenant-binding assertion (`{id} == tc.CenterID`) at the top of every handler.
    - `internal/handler/term_handler.go`, `holiday_handler.go`, `room_handler.go`, `google_meet_handler.go` — same pattern.
    - Wire all new handlers in `cmd/api/main.go` under a dedicated `settingsChain` middleware group per AC7's chain spec.

11. **Frontend `settings` feature — new directory `src/features/settings/`.**
    - `SettingsPage.tsx` — role gate + tab-strip shell + `<Outlet>` for tab content (React Router v7 nested routes OR inline switch on `?tab=`). Chosen: inline switch on `useSearchParams()` — simpler, matches shipped `TeacherDashboard` composition pattern; nested-routes swap is a Story 3.x refactor if the tab bodies grow lazy-load-worthy.
    - `ProfileTab.tsx`, `TermCalendarTab.tsx`, `RoomsTab.tsx`, `IntegrationsTab.tsx` — one file per tab body. Each ≤200 LoC.
    - `lib/schemas.ts` — Zod schemas: `centerSettingsProfileSchema`, `termSchema`, `holidaySchema`, `roomSchema`. Generated Zod (from `api.yaml` via `openapi-zod-client`) coexists as `src/lib/api/schemas.ts`; the form schemas can `.pick()` / `.extend()` the generated shapes rather than duplicate (TS-2 pattern — never derive form types from raw API types, but composing from generated Zod is fine because Zod schemas ARE type-level contracts, not wire types).
    - `api/` — `useCenterProfile.ts` (query), `useUpdateCenterProfile.ts` (mutation with full optimistic triple per FW-2), `useTerms.ts` / `useMutateTerm.ts` / `useHolidays.ts` / `useMutateHoliday.ts` / `useRooms.ts` / `useMutateRoom.ts` / `useConnectGoogleMeet.ts` / `useDisconnectGoogleMeet.ts`.
    - `hooks/useSettingsTab.ts` — reads `?tab=` from `useSearchParams`, returns typed `'profile' | 'terms' | 'integrations' | 'rooms'`, invalid → `'profile'` fallback.
    - `components/DangerZoneCard.tsx`, `AboutCard.tsx`, `TermRow.tsx`, `HolidayRow.tsx`, `RoomRow.tsx`, `IntegrationRow.tsx`, `ConnectGoogleMeetButton.tsx`, `ReopenChecklistCta.tsx` (see AC12).
    - `SettingsPage.stories.tsx` + per-tab Storybook variants (≥3 each for locale + populated/empty states).
    - `__tests__/` — component tests per TEST-FE-* rules. MSW handlers extend the shipped `handlers.ts` catalog with the new endpoints (see AC7 table); factory helpers (`termsResult(...)`, `roomsResult(...)`) mirror the shipped `progressWithPersona(...)` factory pattern.

12. **FU-2-4-D "Reopen setup checklist" affordance.** In the Profile tab, next to the `Center profile` section header, render `<ReopenChecklistCta>`. Component: `<button>` with copy `t('settings.profile.reopenChecklistCta')` = "Re-open setup checklist →". On click:
    1. Calls `useChecklistState(user.id).clearSnooze()` — NEW method on the shipped hook at `src/features/dashboard/hooks/useChecklistState.ts` (Story 2-4). Adds a `clearSnooze()` action that writes `{ snoozedUntil: null }` to the same localStorage key and bumps the module-scope subscribers so `useSyncExternalStore` re-reads.
    2. Fires Sentry breadcrumb `checklist-reopened-from-settings` with `{ userId }`.
    3. Toasts (Sonner) `t('settings.profile.reopenChecklist.toast')` = "Setup checklist re-opened — visit your dashboard to continue." with fixed id `settings-reopen-checklist` (queue-of-one).
    4. Does NOT navigate — user stays on Settings. Discoverability affordance only.
    Test: cover `clearSnooze()` in `hooks/__tests__/useChecklistState.test.tsx` (new row: snooze → clearSnooze → isVisible true). Cover the CTA click in `components/__tests__/ReopenChecklistCta.test.tsx`.

13. **Graduate Story 2-4's `<DeadLinkTrigger targetPath="/settings">` to real navigation.** In `src/features/dashboard/lib/checklistDefinition.ts`, the `centerCreated` checklist item's target `/settings` now navigates (the item's `<DeadLinkTrigger>` swap for `<button onClick={() => navigate(item.targetPath)}>`) — 1-line change per Story 2-4 AC11. **Only the `/settings` target graduates** — `/templates`, `/classes`, `/people/staff`, `/students`, `/knowledge-hub`, `/grading` still stay on `<DeadLinkTrigger>` (Stories 2.6 / 2.7 / 3.x / 4.x / 6.x own those). Update the AC11 targetPath allow-list assertion in Story 2-4's `noTrialMechanic.test.ts` if it's coupled to the count (it isn't per shipped code — just re-verify green).

14. **i18n — pinned `STORY_2_5_KEYS` closed literal + prefix-ratchet block in `i18n-parity-coverage.test.ts`.** Append `describe('Story 2-5 i18n parity (R38)', () => { ... })` mirroring the shipped STORY_2_4_KEYS block pattern (`i18n-parity-coverage.test.ts:1017-1174` for 2-3c reference). Prefix ratchet: every key MUST start with one of `['settings.', 'error.']` (or the shared error keys). `assertI18nInterpolationParity(STORY_2_5_KEYS, ['en', 'vi'])` covers ALL keys per M-BLOCKER-5 pattern. **Estimated key count: ~90-110** (settings.tabs.\* × 4 + settings.profile.\* × ~20 + settings.terms.\* × ~15 + settings.holidays.\* × ~10 + settings.rooms.\* × ~15 + settings.integrations.\* × ~15 + settings.integrations.googleMeet.\* × ~12 + settings.dangerZone.\* × ~5 + settings.profile.reopenChecklist.\* × 3 + error.settings.\* × ~10). Pinned closed literal at dev time — same M-BLOCKER-1 discipline as Story 2-4. **VN translation is Ducdo's review at green-phase**, not code review (per feedback rule at `[[feedback_pragmatic_interpretation_of_spec_absolutes]]` — Ducdo owns VN authenticity; a raw English→VN translation is a downgrade to UX-2 "Vietnamese co-primary" invariant).

15. **Route bundle boundary — extend `e2e/route-bundle-boundaries.spec.ts` per Winston-W5.** Assert:
    - `SettingsPage-*.js` chunk exists (matches `/^SettingsPage-[\w-]+\.js$/`).
    - `SettingsPage-*.js` chunk file bytes include `data-testid="settings-tab-strip"` substring.
    - NO onboarding chunk (`OnboardingLayout-*.js`, `PersonaSelectPage-*.js`, etc.) contains `data-testid="settings-tab-strip"`.
    - NO dashboard chunk (`TeacherDashboard-*.js`) contains `data-testid="settings-tab-strip"`.
    - Deep-import discipline preserved: `useChecklistState` deep-imported from `@/features/dashboard/hooks/useChecklistState` (shared-lib-adjacent — the hook is already exported; feature-barrel avoidance per Story 2-4 W-STRONG-10). Do NOT import from a barrel `@/features/dashboard`.

16. **Accessibility gate — zero axe violations on all 4 tabs × 2 locales = 8 renders + Owner + Non-Owner variants = 10 renders total.** `vitest-axe` `toHaveNoViolations()` in `SettingsPage.test.tsx`. Semantic markup: tab strip uses `<div role="tablist">` + `<button role="tab" aria-selected>` per WAI-ARIA authoring practices, tab body wrapped in `<div role="tabpanel" tabIndex={0}>`. Focus management on tab-switch: focus moves to the active tabpanel's first focusable element (matches shipped Radix pattern). Every form field has an accessible label via `<label htmlFor>` or `aria-labelledby`. The 4-swatch brand-color picker uses `<fieldset role="radiogroup">` + `<input type="radio">` (accessible name = color name via i18n). PermissionDenied variant already tested by shipped `PermissionDenied.test.tsx`.

17. **`SettingsPage.test.tsx` NEW file — inherits shipped-page testing patterns.** Coverage matrix per TEST-FE-2 three-state + role-gated tests per TEST-FE-6:
    - Loading state — MSW delays `/api/centers/{id}` — asserts skeleton.
    - Success state — asserts tab strip renders + Profile fields pre-filled from `useCenterProfile`.
    - Error state (500) — asserts inline `<Alert>` with retry action.
    - Role gate — Owner sees tabs; Teacher / Admin / Student sees `<PermissionDenied requiredRoles={['owner']} />` (TEST-FE-6 assert what's absent — tab strip NOT in DOM for non-Owner).
    - Tab-switching via URL — `?tab=terms` mounts TermCalendarTab; invalid `?tab=xyz` falls back to Profile.
    - Profile save — PATCH round-trip via MSW, asserts `useAuth` cache invalidation triggers re-render, sidebar `settings` label re-reads.
    - Term CRUD — create term via modal → row appears; edit → row updates; delete → row disappears; empty state shows on empty list.
    - Room CRUD — same as terms; also asserts UNIQUE name conflict returns 409 rendered as field error.
    - Google Meet connect — click "Connect Google Meet" → `useConnectGoogleMeet` mutation fires → asserts `window.location.assign` called with authorizeUrl (mock `window.location`); NOT rely on real navigation.
    - Google Meet callback — mount `SettingsPage` with `?tab=integrations&status=connected` → asserts success toast + green `Connected` state pill (which comes from a subsequent `useCenterProfile` refetch).
    - Google Meet disconnect — click on toggle → AlertDialog confirm → DELETE round-trip → asserts row flips back to `Not connected`.
    - FU-2-4-D reopen — snooze the checklist (via shipped `useChecklistState.snooze()`) → mount SettingsPage → click `<ReopenChecklistCta>` → assert `useChecklistState.getState().isVisible === true` after re-render.
    - Route bundle test file `route-bundle-boundaries.spec.ts` (Playwright, NOT vitest) covers AC15.

## Tasks / Subtasks

- [ ] **Task 0 — ATDD red phase (RECOMMENDED but SKIPPABLE)** (AC: #3, #4, #5, #6, #7, #11, #12, #13, #14, #16, #17)
  - [ ] 0.1 Optionally run `/bmad-tea AT 2-5` to generate red-phase acceptance test scaffolds — target the 4 tab-body components + Google Meet OAuth handler chain + FU-2-4-D reopen affordance + i18n parity ratchet.
  - [ ] 0.2 If ATDD skipped, document choice in Debug Log per Story 2-4 Task 0.2 pattern. **This story owns NO risk score ≥6 per WF-8 protocol** (R1 RLS discharged epic 1a; R6 Google OAuth tenant binding discharged Story 1.6). ATDD is discretionary.

- [ ] **Task 1 — Migrations + sqlc + codegen** (AC: #8, #9)
  - [ ] 1.1 Author 5 migration pairs per AC8. Naming per WF-2 (`{YYYYMMDDHHMMSS}_{description}.up.sql` / `.down.sql`). Down migrations reverse cleanly.
  - [ ] 1.2 Run `./scripts/migrate.sh` locally + verify schema in psql (`\d terms`, `\d rooms`, `\d holidays`, `\d center_integrations`, `\d centers` shows new column). Verify RLS policies enforce per Story 2.2 test pattern.
  - [ ] 1.3 Author sqlc queries per AC9 (5 files: amend `centers.sql`, new `terms.sql` / `holidays.sql` / `rooms.sql` / `center_integrations.sql`).
  - [ ] 1.4 Run `./scripts/codegen.sh`. Verify generated Go under `store/generated/` compiles.
  - [ ] 1.5 RLS adversarial test (`internal/test/adversarial_test.go`) — extend with 4 rows: TenantA cannot read TenantB's terms / rooms / holidays / center_integrations. Assert both read + write isolation per TEST-BE-1.

- [ ] **Task 2 — `api.yaml` — 17 new endpoints + schemas** (AC: #7)
  - [ ] 2.1 Add 17 endpoint entries per AC7 table. Every entry: operationId, summary, description, security (bearerAuth), request/response schemas ref'd, error responses (401/403/404/409/422/429/500 as applicable — full envelope).
  - [ ] 2.2 Add 12+ schema definitions: `CenterProfile`, `UpdateCenterProfileRequest`, `Term`, `CreateTermRequest`, `UpdateTermRequest`, `ListTermsResult`, `Holiday`, `CreateHolidayRequest`, `UpdateHolidayRequest`, `Room`, `CreateRoomRequest`, `UpdateRoomRequest`, `ListRoomsResult`, `GoogleMeetAuthorizeResult`, `EnvelopeCenterProfile`, `EnvelopeTerm`, `EnvelopeHoliday`, `EnvelopeRoom`, `EnvelopeListTermsResult`, `EnvelopeListRoomsResult`, `EnvelopeListHolidaysResult`, `EnvelopeGoogleMeetAuthorizeResult`. No `additionalProperties: true`.
  - [ ] 2.3 Run `./scripts/codegen.sh`. Verify `classlite-web/src/lib/api/client.ts` + `schemas.ts` regenerated cleanly.

- [ ] **Task 3 — Backend services + handlers** (AC: #7, #10)
  - [ ] 3.1 `internal/service/settings.go` — `UpdateCenter` + `GetCenter`. Uses `AuditLogger.LogWithinTx` for `center.updated` with before/after diff shaped as `{ before: <profile>, after: <profile> }`.
  - [ ] 3.2 `internal/service/term.go` + `holiday.go` + `room.go` — CRUD services. Each `.Create/.Update/.Delete` emits an audit row within the same tx.
  - [ ] 3.3 `internal/service/integration_crypto.go` — AES-GCM `SealToken` / `OpenToken` with 32-byte key from `cfg.IntegrationsEncryptionKey`. Unit test round-trip + tamper detection (mutate ciphertext byte → OpenToken returns error).
  - [ ] 3.4 `internal/service/google_meet.go` — `BuildAuthorizeURL` (reuses `oauth_state.go` HMAC pattern from Story 1.6 — extract `SignedState` struct to a shared location if needed, pragmatic in-scope refactor) + `HandleCallback` (validates state, exchanges code via `oauth2.Config.Exchange`, seals tokens, upserts `center_integrations`, sets `centers.google_meet_connected = true`, audits `center.integration.google_meet.connected` — all in ONE tx) + `Disconnect` (deletes row, clears flag, audits).
  - [ ] 3.5 Handlers per AC10 — `settings_handler.go`, `term_handler.go`, `holiday_handler.go`, `room_handler.go`, `google_meet_handler.go`. Every handler asserts `{id} == tc.CenterID` before service dispatch. Uses `WriteEnvelope` (shipped in `handler/response.go`) for success + returns typed errors for error mapper.
  - [ ] 3.6 Wire in `cmd/api/main.go` — `settingsChain` middleware group per AC7 spec. Rate limits per AC7. Route registration under `mux.Handle("... /api/centers/{id}", settingsChain(...))` etc. Meet OAuth callback route uses `oauthCallbackChain` (no RequireRole — the state param proves the request originated from an Owner Connect click).
  - [ ] 3.7 Backend test suite per TEST-BE-1/2/3/4:
    - Store tests — real DB in transaction (per TEST-BE-2); cover UNIQUE constraints (rooms per-center name), CHECK constraints (start_date <= end_date on terms).
    - Service tests — mock store interface (per TEST-BE-4); cover business rules (Owner-only enforced at service layer defense-in-depth, tenant assertion, audit-row shape correctness).
    - Handler tests — integration via `test.NewTestServer` (per TEST-BE-3); assert full envelope + tenant-mismatch 403 + role-gate 403 + all 5 error branches.
    - Google Meet handler tests — mock `GoogleOAuthClient` (existing interface at `auth_google.go:76-80`); NEVER hit real Google.

- [ ] **Task 4 — Frontend `settings` feature — Profile tab + role gate + `SettingsPage` shell** (AC: #1, #2, #3, #11, #16, #17)
  - [ ] 4.1 `src/features/settings/SettingsPage.tsx` — role check + tab-strip shell + `useSearchParams` tab dispatch. Inline switch on `?tab=` renders one of `<ProfileTab>` / `<TermCalendarTab>` / `<IntegrationsTab>` / `<RoomsTab>`.
  - [ ] 4.2 `src/features/settings/ProfileTab.tsx` — RHF + Zod form per AC3. Fields: name / brandColor picker / logo (view + DeadLinkTrigger) / timezone dropdown. Save button. About + Danger-zone side cards. `<ReopenChecklistCta>` (Task 5).
  - [ ] 4.3 `src/features/settings/lib/schemas.ts` — `centerSettingsProfileSchema` + `timezoneWhitelist` const (see Dev Notes §"Timezone whitelist").
  - [ ] 4.4 `src/features/settings/api/useCenterProfile.ts` — TanStack Query for `GET /api/centers/{id}` (staleTime 60s per FW-3, keyed by center id).
  - [ ] 4.5 `src/features/settings/api/useUpdateCenterProfile.ts` — mutation w/ full optimistic triple per FW-2. `onSuccess` invalidates `authKeys.session()` so sidebar re-reads.
  - [ ] 4.6 Route registration in `src/routes.tsx` — new `/settings` entry under `AppLayout` children per AC1. Lazy chunk per Winston-W5.
  - [ ] 4.7 `src/features/settings/__tests__/SettingsPage.test.tsx` — role gate + loading/success/error + tab dispatch tests. `ProfileTab.test.tsx` — form field render + save round-trip + error branching.
  - [ ] 4.8 `SettingsPage.stories.tsx` + `ProfileTab.stories.tsx` — ≥4 Storybook variants each (Owner default / Owner en / Owner vi / Non-Owner permission-denied).

- [ ] **Task 5 — FU-2-4-D reopen-checklist affordance + DeadLinkTrigger graduation** (AC: #12, #13)
  - [ ] 5.1 Amend `src/features/dashboard/hooks/useChecklistState.ts` — add `clearSnooze()` action to the returned tuple; write `{ snoozedUntil: null }` to localStorage + bump subscribers.
  - [ ] 5.2 Extend `hooks/__tests__/useChecklistState.test.tsx` — new test row: snooze → clearSnooze → isVisible === true.
  - [ ] 5.3 `src/features/settings/components/ReopenChecklistCta.tsx` — button + `toast.info` + Sentry breadcrumb per AC12.
  - [ ] 5.4 `src/features/settings/components/__tests__/ReopenChecklistCta.test.tsx` — click fires clearSnooze + toast + breadcrumb; does not navigate.
  - [ ] 5.5 Graduate `<DeadLinkTrigger targetPath="/settings">` in `src/features/dashboard/lib/checklistDefinition.ts`. Only `/settings` — other 5 dead-link targets remain (Stories 2.6/2.7/3.x/4.x/6.x own those). Update Story 2-4 test in `dashboard/__tests__/` if it asserts a raw DeadLinkTrigger count for the `centerCreated` item (it does not per current code; re-verify green).

- [ ] **Task 6 — Term calendar tab + Rooms tab + CRUD hooks + tests** (AC: #4, #5, #16, #17)
  - [ ] 6.1 `TermCalendarTab.tsx` — list rendering + create/edit/delete modal via shadcn `Dialog`. State pill derivation per AC4. Empty state via shipped `<EmptyState>`. Loading skeleton. Error alert.
  - [ ] 6.2 `HolidayRow.tsx` reused inside TermCalendarTab (holidays list beneath terms list).
  - [ ] 6.3 `RoomsTab.tsx` — same pattern; UNIQUE name conflict handling in modal (409 → field error).
  - [ ] 6.4 `api/useTerms.ts` + `useMutateTerm.ts` (single mutation hook that handles create/update/delete via method+id) — optimistic triple per FW-2.
  - [ ] 6.5 Same for `holidays.ts` + `rooms.ts` API pairs.
  - [ ] 6.6 Tests per Task 4.7 pattern — cover CRUD flows, three-state, empty state, error branching, UNIQUE-conflict field-error surface.
  - [ ] 6.7 Storybook — TermCalendarTab + RoomsTab ≥3 variants each (populated / empty / vi).

- [ ] **Task 7 — Integrations tab + Google Meet OAuth flow (frontend)** (AC: #6, #16, #17)
  - [ ] 7.1 `IntegrationsTab.tsx` — 4 rows (Meet real; Drive / Calendar / Zoom placeholders w/ DeadLinkTrigger). Connect Meet button + Disconnect flow per AC6.
  - [ ] 7.2 `api/useConnectGoogleMeet.ts` — mutation calls `GET /api/centers/{id}/integrations/google-meet/authorize`, then `window.location.assign(authorizeUrl)`. On success, sets a `sessionStorage` marker so the callback-return can differentiate a real Connect from a random `?status=connected` URL.
  - [ ] 7.3 `api/useDisconnectGoogleMeet.ts` — mutation DELETE + `useCenterProfile` invalidation.
  - [ ] 7.4 `components/ConnectGoogleMeetButton.tsx` — button + confirm dialog on Disconnect.
  - [ ] 7.5 Callback-return handling — on `SettingsPage` mount, if `?status=connected` present, clear the sessionStorage marker, fire success toast, remove the query param via `useNavigate(location.pathname + '?tab=integrations', { replace: true })` so refreshing doesn't re-fire the toast.
  - [ ] 7.6 Tests per Task 4.7 — cover Connect flow (mock `window.location.assign` — assert called with the mocked authorizeUrl), Disconnect flow, callback-return status handling, `status=connected` in URL when NOT preceded by a Connect click → NO toast (sessionStorage marker absent).
  - [ ] 7.7 Storybook — IntegrationsTab ≥3 variants (Disconnected / Connected / vi).

- [ ] **Task 8 — i18n keys + parity ratchet** (AC: #14)
  - [ ] 8.1 Author ~90-110 keys per AC14 in `en.json`. VN copy in `vi.json` — Ducdo reviews at story time / green phase.
  - [ ] 8.2 Append `describe('Story 2-5 i18n parity (R38)', () => { ... })` to `i18n-parity-coverage.test.ts` with pinned closed literal `STORY_2_5_KEYS` + prefix ratchet (`settings.` prefix mandatory except shared `error.*` keys).
  - [ ] 8.3 `assertI18nInterpolationParity(STORY_2_5_KEYS, ['en', 'vi'])` covers ALL keys per M-BLOCKER-5.
  - [ ] 8.4 `npm run i18n-parity` clean.

- [ ] **Task 9 — Route bundle boundary regression** (AC: #15)
  - [ ] 9.1 Extend `e2e/route-bundle-boundaries.spec.ts` per AC15. Filename regex on `SettingsPage-*.js` + `data-testid="settings-tab-strip"` substring assertion + NO onboarding/dashboard chunk contains that testid.

- [ ] **Task 10 — Regression + Playwright smoke** (AC: all)
  - [ ] 10.1 `npm run test` — full suite green. Expected delta: ~+90-140 tests (backend + frontend).
  - [ ] 10.2 `npm run lint` clean.
  - [ ] 10.3 `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
  - [ ] 10.4 `npm run i18n-parity` clean.
  - [ ] 10.5 `cd classlite-api && go test ./...` clean; `go vet ./...` clean; `golangci-lint run` clean.
  - [ ] 10.6 `npm run build` clean; verify `SettingsPage-*.js` chunk emits + size ≤ 25 kB gzip (soft budget; Vietnam-4G perf constraint).
  - [ ] 10.7 Playwright smoke — new `e2e/settings-owner-flow.spec.ts` with 5 tests: (a) Owner lands on `/settings` → tab strip visible; (b) non-Owner (mocked role) hits PermissionDenied; (c) Profile save round-trip via stubbed API; (d) Term create → row appears; (e) `?tab=integrations&status=connected` shows success toast. Route-bundle-boundaries additions per Task 9.1 must be 10/10 green.

## Dev Notes

### Story context and epic position

Story 2.5 closes the fourth of Epic 2's seven stories — after the onboarding wizard (2.1/2.2/2.3a/b/c) and the post-onboarding first-run experience (2.4). It's the first authenticated **cross-role** surface after the dashboard: Owners edit; Admins/Teachers/Students hit PermissionDenied. It also ships the first **Google-service integration** stored per-center (Meet OAuth tokens) — the foundation Epic 3 session-scheduling consumes when it auto-generates Meet links for scheduled sessions.

**Upstream dependencies (already shipped):**
- Story 2.1 — `centers` table, `POST /api/centers`, `CenterMember` role assignment.
- Story 1.6 — Google OAuth login (`oauth_state.go` signing helpers reused; separate `oauth2.Config` for calendar scope in this story).
- Story 1-7c — `PermissionDenied` component + `AppLayout` shell + sidebar with the `settings` nav item.
- Story 1d-2 — shadcn `Dialog` + `Alert` + `AlertDialog` + `Skeleton` primitives.
- Story 2-4 — Sonner Toaster mounted at `App.tsx:74`; `useChecklistState` hook (Task 5 extends).

**Downstream dependencies of this story:**
- Story 2.6 (Roles + Permissions) — router-level role gate replaces the inline check in AC2. TODO marker planted.
- Story 3.2 (Class detail view) + 3.4/3.5 (Sessions) — Meet-link auto-generation consumes the `center_integrations` row. Room-row `DELETE` graduates from unconditional to `409 ROOM_IN_USE` when sessions FK lands.
- Story 3.x sessions consume `terms` / `holidays` for schedule-strip UI.
- Story 9.x (Billing) — replaces the hardcoded `Free` plan chip in the About card with the real subscription tier.

### Owner-only vs Owner+Admin — spec conflict resolution

`epic-02.md:217` says "Given the user is an Owner or Admin"; PRD FR-7 (`prd.md:284`) says "Only Owner role can access center settings" AND FR-9 (`prd.md:307`) says "Admin sees the same sidebar as Owner minus center settings and billing"; UX §8.2 (`ux-design-specification.md:469`) says "Center settings (`s49`, Owner-only)"; shipped `sidebarNavConfig.tsx:54` places `/settings` under the OWNER navigation group only (Admin at :62-73 has no settings row). **Resolution: LITERAL-to-PRD (Owner-only in v1)**. Every other surface — PRD, UX spec, shipped sidebar config, shipped `PermissionDenied` `['owner']` variant — agrees. The epic AC is the outlier and appears to have been a copy-paste error from FR-46 (Admin/Owner enrolment).

**Amend the epic doc in a follow-up commit** — do NOT re-open at code review (feedback rule: `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`). The amendment: `epic-02.md:217` "Given the user is an Owner or Admin" → "Given the user is an Owner"; `epic-02.md:233` "Teacher (not Owner or Admin)" → "non-Owner user (Teacher, Admin, or Student)". Filed as `FU-2-5-C`.

### `centers` table — existing columns match story needs

Per `20260601120000_create_auth_tables.up.sql:28-37`, `centers` already has: `id`, `name`, `short_code`, `brand_color`, `logo_url`, `timezone` (defaults `Asia/Ho_Chi_Minh`), `google_meet_connected` (defaults false), `created_at`. **Only NEW column needed: `contact_email` (nullable text)** per AC8. No renames, no drops.

`centers` is a **global table with NO RLS** (per Story 2.1 comment at `create_auth_tables.up.sql:26`). The tenant-binding check happens at the SERVICE layer via `assertTenantBinding` — the handler asserts `path {id} == tc.CenterID` before dispatch. This story CANNOT rely on RLS for centers; it MUST assert tenant-binding at every handler entry.

### Google Meet OAuth — separate flow from login OAuth

The shipped `auth_google.go` handles **login-time Google OAuth** — different scope (`openid email profile`), different callback path (`/api/auth/google/callback`), different downstream (mint app JWT). This story's Meet OAuth is a **second, per-center OAuth flow** — scope `https://www.googleapis.com/auth/calendar.events` (write access for Meet-link creation on Calendar events), callback path `/api/centers/{id}/integrations/google-meet/callback`, downstream is `center_integrations` row + `google_meet_connected = true`.

**What CAN be reused from `auth_google.go`:**
- The `SignedState` HMAC pattern in `oauth_state.go` — extract to a shared package or generic-ify (pragmatic in-scope refactor). State claim adds a `centerId` field so the callback binds to the initiating Owner's tenant.
- The `GoogleOAuthClient` interface at `auth_google.go:76-80` (Exchange + UserInfo methods) — for tests, mock at this interface. Real Meet flow only needs Exchange (UserInfo is login-only).

**Env vars added (config.go + .env.example):**
- `INTEGRATIONS_ENCRYPTION_KEY` — 32-byte base64. Required in non-dev; Validate() rejects empty.
- Reuses existing `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`. Add `MEET_OAUTH_REDIRECT_URL` (mirrors `GOOGLE_REDIRECT_URL` but for Meet-specific callback). If the app is deployed at a fixed domain, this MAY equal `AppInviteURLBase + '/api/centers/callback'` synthesized; explicit env var is safer for staging vs prod split.

**AES-GCM encryption** — 12-byte nonce prepended to ciphertext (standard sealed-box format). `SealToken(plaintext, key)` returns `nonce || ciphertext`; `OpenToken` splits + decrypts + validates the auth tag. Never log tokens. Never return tokens in API responses (only `google_meet_connected` boolean).

### Timezone whitelist — 30 IANA entries

The Profile tab's timezone dropdown does NOT enumerate all 425+ IANA zones (UI nightmare + i18n headache). It ships a **fixed 30-entry list** covering the ClassLite target market:

- Asia (VN + neighbors + regional gateways): `Asia/Ho_Chi_Minh` (default), `Asia/Bangkok`, `Asia/Singapore`, `Asia/Jakarta`, `Asia/Manila`, `Asia/Kuala_Lumpur`, `Asia/Hong_Kong`, `Asia/Shanghai`, `Asia/Taipei`, `Asia/Seoul`, `Asia/Tokyo`, `Asia/Dubai`, `Asia/Kolkata`, `Asia/Karachi`.
- Europe: `Europe/London`, `Europe/Paris`, `Europe/Berlin`, `Europe/Amsterdam`, `Europe/Madrid`, `Europe/Warsaw`, `Europe/Moscow`, `Europe/Istanbul`.
- Americas: `America/New_York`, `America/Chicago`, `America/Denver`, `America/Los_Angeles`, `America/Toronto`, `America/Sao_Paulo`.
- Oceania: `Australia/Sydney`, `Pacific/Auckland`.

**Pinned as a `const` in `src/features/settings/lib/timezoneWhitelist.ts` + mirror in Go** at `internal/service/settings.go` (either duplicate literal — kept small — OR a shared JSON fixture pipeline; **pick duplicate literal for v1** — 30 items × two languages is a rounding error of maintenance cost). The PATCH handler rejects timezones NOT on the whitelist with `422 UNSUPPORTED_TIMEZONE`. Existing centers with a timezone outside the whitelist (should be none in v1 since default is `Asia/Ho_Chi_Minh` and 2.1 doesn't let users set it) surface as an inline warning in the Profile tab.

### `terms` semantics vs Story 3.x schedule

`terms` in this story is a **descriptive** entity (name + date range + optional session count). It does NOT drive scheduling in v1 — no automatic session-per-week generation. Story 3.x consumes it as (a) a filter chip on the schedule view ("Show current term only") + (b) a "term boundary crossed" warning on class creation. `holidays` likewise — declared here, consumed by Story 3.x for schedule-strip red-line rendering + Story 3.3 class-creation warnings when session dates land on a holiday.

Neither `terms` nor `holidays` has any FK from other tables in this story. Deletes are always safe in v1.

### Rooms semantics vs Story 3.x sessions

`rooms` becomes referenced by `sessions.room_id` when Story 3.2 lands. Comment marker `// TODO(story-3-2): reject if referenced by sessions` on the RoomService.Delete method. For v1 (before sessions exist), the delete is unconditional.

The "Online · Google Meet" row on the Rooms tab is **synthetic** — NOT a real `rooms` row. It's rendered by the tab when `google_meet_connected === true` and clicks the Settings button to jump to Integrations. If you added it as a real row, deleting it would break Story 3.x's session-creation flow.

### MSW handler contract inventory (Task 4.7 / 6.6 / 7.6)

New MSW handlers extend `src/features/settings/api/__tests__/handlers.ts` (NEW file — mirrors `src/features/onboarding/api/__tests__/handlers.ts`). Factory helpers pinned:

| Factory | Returns |
|---|---|
| `centerProfile({ overrides })` | full CenterProfile envelope; defaults match `Asia/Ho_Chi_Minh` + not-connected |
| `termsResult(terms)` | List envelope; terms defaults `[]` for empty state |
| `holidaysResult(holidays)` | List envelope; empty by default |
| `roomsResult(rooms)` | List envelope; empty by default |
| `googleMeetAuthorize({ authorizeUrl })` | `{ data: { authorizeUrl } }` envelope |
| `errorEnvelope(code, message, status)` | Error envelope; reused across settings-error test rows |

Failure-injection MSW handlers for each endpoint's 500 / 403 / 422 branch. Never mock `useQuery` / `useMutation` per TEST-FE-1 — only the HTTP boundary.

### data-testid inventory

Fixed testid set — pinned upfront for E2E stability:

| Testid | Owner |
|---|---|
| `settings-tab-strip` | `SettingsPage.tsx` — 4-tab strip container |
| `settings-tab-profile` / `-terms` / `-integrations` / `-rooms` | Tab buttons |
| `settings-tabpanel-profile` / `-terms` / `-integrations` / `-rooms` | Tab body panels |
| `settings-profile-name-input` / `-brandColor-picker` / `-timezone-select` / `-save-button` | Profile form |
| `settings-reopen-checklist-cta` | ReopenChecklistCta button |
| `settings-terms-list` / `-holidays-list` | Term calendar tab lists |
| `settings-term-row-<id>` / `-holiday-row-<id>` | Individual rows |
| `settings-term-create-cta` / `-holiday-create-cta` | Add buttons |
| `settings-term-modal` / `-holiday-modal` / `-room-modal` | Create/edit dialogs |
| `settings-rooms-list` | Rooms tab list |
| `settings-room-row-<id>` | Individual room rows |
| `settings-integration-row-<provider>` | Integration rows |
| `settings-connect-google-meet-button` | Meet connect button |
| `settings-disconnect-google-meet-confirm` | Meet disconnect confirm dialog |
| `settings-permission-denied` | PermissionDenied surface for non-Owner |

Sonner toasts portalled — assert via `findByRole('status')` or `findByText`, NOT testid (matches Story 2-4 discipline).

### Files to touch — inventory

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Task 2 — 17 endpoints + 22+ schemas |
| `classlite-api/migrations/20260714120000_add_centers_contact_email.up.sql` + `.down.sql` | NEW | Task 1.1 |
| `classlite-api/migrations/20260714120100_create_terms.up.sql` + `.down.sql` | NEW | Task 1.1 |
| `classlite-api/migrations/20260714120200_create_holidays.up.sql` + `.down.sql` | NEW | Task 1.1 |
| `classlite-api/migrations/20260714120300_create_rooms.up.sql` + `.down.sql` | NEW | Task 1.1 |
| `classlite-api/migrations/20260714120400_create_center_integrations.up.sql` + `.down.sql` | NEW | Task 1.1 |
| `classlite-api/internal/store/queries/centers.sql` | UPDATE | Task 1.3 — add UpdateCenter + GetCenterByIDInTenant |
| `classlite-api/internal/store/queries/terms.sql` | NEW | Task 1.3 |
| `classlite-api/internal/store/queries/holidays.sql` | NEW | Task 1.3 |
| `classlite-api/internal/store/queries/rooms.sql` | NEW | Task 1.3 |
| `classlite-api/internal/store/queries/center_integrations.sql` | NEW | Task 1.3 |
| `classlite-api/internal/store/generated/*` | AUTOGEN | Task 1.4 — `codegen.sh` output |
| `classlite-api/internal/service/settings.go` + `_test.go` | NEW | Task 3.1 |
| `classlite-api/internal/service/term.go` + `_test.go` | NEW | Task 3.2 |
| `classlite-api/internal/service/holiday.go` + `_test.go` | NEW | Task 3.2 |
| `classlite-api/internal/service/room.go` + `_test.go` | NEW | Task 3.2 |
| `classlite-api/internal/service/integration_crypto.go` + `_test.go` | NEW | Task 3.3 |
| `classlite-api/internal/service/google_meet.go` + `_test.go` | NEW | Task 3.4 |
| `classlite-api/internal/service/oauth_state.go` | UPDATE | Task 3.4 — extract shared SignedState struct if needed |
| `classlite-api/internal/handler/settings_handler.go` + `_test.go` | NEW | Task 3.5 |
| `classlite-api/internal/handler/term_handler.go` + `_test.go` | NEW | Task 3.5 |
| `classlite-api/internal/handler/holiday_handler.go` + `_test.go` | NEW | Task 3.5 |
| `classlite-api/internal/handler/room_handler.go` + `_test.go` | NEW | Task 3.5 |
| `classlite-api/internal/handler/google_meet_handler.go` + `_test.go` | NEW | Task 3.5 |
| `classlite-api/cmd/api/main.go` | UPDATE | Task 3.6 — register new routes + chains |
| `classlite-api/internal/config/config.go` | UPDATE | Task 3.4 — add `IntegrationsEncryptionKey` + `MeetOAuthRedirectURL` |
| `classlite-api/internal/test/adversarial_test.go` | UPDATE | Task 1.5 — RLS cross-tenant rows |
| `classlite-web/src/lib/api/*` | AUTOGEN | Task 2.3 — `codegen.sh` regen |
| `classlite-web/src/routes.tsx` | UPDATE | Task 4.6 — `/settings` route |
| `classlite-web/src/features/settings/SettingsPage.tsx` + `.stories.tsx` + `__tests__/SettingsPage.test.tsx` | NEW | Task 4.1 / 4.7 / 4.8 |
| `classlite-web/src/features/settings/ProfileTab.tsx` + `.stories.tsx` + `__tests__/ProfileTab.test.tsx` | NEW | Task 4.2 |
| `classlite-web/src/features/settings/TermCalendarTab.tsx` + `.stories.tsx` + `__tests__/TermCalendarTab.test.tsx` | NEW | Task 6.1 |
| `classlite-web/src/features/settings/RoomsTab.tsx` + `.stories.tsx` + `__tests__/RoomsTab.test.tsx` | NEW | Task 6.3 |
| `classlite-web/src/features/settings/IntegrationsTab.tsx` + `.stories.tsx` + `__tests__/IntegrationsTab.test.tsx` | NEW | Task 7.1 |
| `classlite-web/src/features/settings/lib/schemas.ts` | NEW | Task 4.3 |
| `classlite-web/src/features/settings/lib/timezoneWhitelist.ts` | NEW | Task 4.3 |
| `classlite-web/src/features/settings/hooks/useSettingsTab.ts` | NEW | Task 4.1 |
| `classlite-web/src/features/settings/api/useCenterProfile.ts` + `useUpdateCenterProfile.ts` | NEW | Task 4.4 / 4.5 |
| `classlite-web/src/features/settings/api/useTerms.ts` + `useMutateTerm.ts` | NEW | Task 6.4 |
| `classlite-web/src/features/settings/api/useHolidays.ts` + `useMutateHoliday.ts` | NEW | Task 6.5 |
| `classlite-web/src/features/settings/api/useRooms.ts` + `useMutateRoom.ts` | NEW | Task 6.5 |
| `classlite-web/src/features/settings/api/useConnectGoogleMeet.ts` + `useDisconnectGoogleMeet.ts` | NEW | Task 7.2 / 7.3 |
| `classlite-web/src/features/settings/api/__tests__/handlers.ts` | NEW | Task 4.7 MSW factory |
| `classlite-web/src/features/settings/components/*` | NEW | 7 components per Task 4.2 / 6 / 7 |
| `classlite-web/src/features/dashboard/hooks/useChecklistState.ts` | UPDATE | Task 5.1 — add `clearSnooze()` |
| `classlite-web/src/features/dashboard/hooks/__tests__/useChecklistState.test.tsx` | UPDATE | Task 5.2 |
| `classlite-web/src/features/dashboard/lib/checklistDefinition.ts` | UPDATE | Task 5.5 — graduate `/settings` DeadLinkTrigger |
| `classlite-web/src/locales/en.json` + `vi.json` | UPDATE | Task 8.1 — ~90-110 new keys |
| `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` | UPDATE | Task 8.2 — STORY_2_5_KEYS block |
| `classlite-web/e2e/route-bundle-boundaries.spec.ts` | UPDATE | Task 9.1 |
| `classlite-web/e2e/settings-owner-flow.spec.ts` | NEW | Task 10.7 — Playwright smoke |
| `.env.example` | UPDATE | Task 3.4 — new env vars |

**Files to READ before touching anything else** (pre-flight per `[[feedback_check_prior_story_artifacts_before_generating]]`):

- `classlite-api/migrations/20260601120000_create_auth_tables.up.sql:28-37` — existing `centers` schema.
- `classlite-api/migrations/20260703120000_create_class_templates.up.sql` — RLS 4-policy pattern to mirror.
- `classlite-api/internal/service/auth_google.go` — Google OAuth reference implementation.
- `classlite-api/internal/service/oauth_state.go` — HMAC state signing (extract or reuse).
- `classlite-api/internal/service/center.go` — Story 2.1 create-center service; audit-log-within-tx pattern.
- `classlite-api/internal/handler/center_handler.go` — thin handler pattern to mirror.
- `classlite-api/internal/middleware/require_role.go` — Owner-only gate.
- `classlite-api/cmd/api/main.go:222-304` — Story 2.1/2.2 chain registration pattern.
- `classlite-web/src/features/dashboard/hooks/useChecklistState.ts` — the hook Task 5.1 extends.
- `classlite-web/src/features/dashboard/lib/checklistDefinition.ts:72` — the DeadLinkTrigger target Task 5.5 graduates.
- `classlite-web/src/features/onboarding/CenterSetupPage.tsx` — brand-color picker + timezone patterns to reuse.
- `classlite-web/src/features/onboarding/api/useCreateCenter.ts` — mutation + cache-write pattern to mirror.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — role-gate component + accepted `['owner']` variant.
- `classlite-web/src/components/domain/sidebarNavConfig.tsx:52-55` — the shipped `/settings` sidebar entry.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts:1017-1174` — STORY_2_3C_KEYS block pattern to mirror.
- `classlite-web/src/features/dashboard/components/DeadLinkTrigger.tsx` — Sonner + Sentry pattern that the ReopenChecklistCta mirrors.
- `docs/classlite-entry/05-cross-role.html:6819-7180` — s49 mockup for all 4 tabs.
- `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.5` — canonical epic-level 6 ACs.
- `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-7,FR-8` — canonical FR contracts.
- `_bmad-output/planning-artifacts/ux-design-specification.md#8.2` — s49 UX design.
- `docs/project-context.md#GO-1..7, FW-1..7, SEC-1..11, WF-1..8, TEST-FE-1..6, TEST-BE-1..5` — cross-cutting rules.
- `docs/bmad-story-conventions.md` — 600-line ceiling + sibling completion-notes split.

### WF-8 ATDD applicability

Story 2.5 owns NO risk score ≥6 per `_bmad-output/test-artifacts/test-design/test-design-architecture.md` risk register:
- R1 (RLS cross-tenant, score 9) — discharged Epic 1A; RLS pattern replicated at Task 1.5 adversarial-test extension.
- R6 (Google OAuth callback tenant binding, score 6) — discharged Story 1.6; Meet OAuth callback replicates the `assertTenantBinding` pattern.
- R38 (i18n parity, score 6) — discharged Story 1-7c + inherited via per-story STORY_2_5_KEYS block per AC14 pattern from Stories 2-3a/b/c and 2-4.

**ATDD is RECOMMENDED but SKIPPABLE.** Task 0.2 records the choice at dev pickup.

### Filed follow-ups (NOT this story's work)

- **`FU-2-5-A`** — Logo re-upload on Profile tab. Requires the Story 2-2 R2 presigned-upload flow (`/api/uploads/presign` + `/api/uploads/confirm`) to be wired into a `<LogoUploader>` component. Priority: P3.
- **`FU-2-5-B`** — Google Meet disconnect calls Google's token-revoke endpoint (`https://oauth2.googleapis.com/revoke`) at server, so revoking in the app also revokes at Google's side. v1 only deletes the local row; user must revoke at accounts.google.com manually if they want to be thorough. Priority: P3.
- **`FU-2-5-C`** — Amend `epic-02.md` per spec-conflict resolution above. Trivial doc-only edit. Priority: P2.
- **`FU-2-5-D`** — Google Drive integration (per PRD `[ASSUMPTION: Google Drive integration is deferred.]` at prd.md:293). Depends on Knowledge Hub (Story 4.4) landing first. Priority: P3.
- **`FU-2-5-E`** — Zoom integration (mockup s49 has the row but PRD assumption defers all non-Meet integrations). Priority: P4.
- **`FU-2-5-F`** — Transfer ownership + Archive center flows (Danger Zone). Depends on Story 2.6 role assignment + Story 9.x subscription cleanup. Priority: P3.
- **`FU-2-5-G`** — Contact-email `reply-to` propagation. Once Story 2-5 adds the `contact_email` column, staff/student notification emails need a follow-up story to actually use it as the reply-to. Priority: P3.
- **`FU-2-5-H`** — Router-level role-gate replaces the inline check in SettingsPage. Story 2.6 pickup. Priority: P2 (Story 2.6 owns it).

### Testing standards inheritance

- **TEST-FE-1**: MSW at HTTP boundary. `useConnectGoogleMeet` calls `window.location.assign(authorizeUrl)` — spy on `window.location.assign`, do NOT mock `useMutation`.
- **TEST-FE-2**: Three-state coverage on SettingsPage + every tab body that fetches.
- **TEST-FE-3**: `beforeEach(() => window.localStorage.clear())` in `ReopenChecklistCta.test.tsx` per Story 2-4 W-STRONG-6 fold.
- **TEST-FE-4**: AC14 pins closed enumeration STORY_2_5_KEYS + prefix ratchet + `assertI18nInterpolationParity` over ALL keys.
- **TEST-FE-5**: axe zero violations per AC16 matrix.
- **TEST-FE-6**: Assert what's absent — non-Owner tab strip NOT in DOM (not visually hidden).
- **TEST-BE-1**: RLS adversarial per Task 1.5 for 4 new tables. Read + write isolation both.
- **TEST-BE-2**: Store tests real DB in tx per Story 2.2 pattern.
- **TEST-BE-3**: Handler tests via `test.NewTestServer` — full envelope assertions.
- **TEST-BE-4**: Service tests mock store interface — cover tenant-binding assertions + audit-row shape + Owner-only role check.
- **TEST-BE-5**: Google Meet worker (if any — but Meet-link creation is Epic 3, not this story) — for this story, only test `HandleCallback` directly with a mocked `GoogleOAuthClient`.

### Project Structure Notes

- **NEW feature directory**: `classlite-web/src/features/settings/` — no existing feature to extend.
- **Backend NEW packages**: 4 new services + 5 new handlers under existing `internal/service/` + `internal/handler/`.
- **Shared/extended files**:
  - `useChecklistState.ts` — Task 5.1 adds `clearSnooze` method (backward compatible; existing consumers unaffected).
  - `checklistDefinition.ts` — Task 5.5 swaps one `DeadLinkTrigger` for `<button onClick={navigate('/settings')}>` — 1-line change per Story 2-4 AC11 design.
  - `oauth_state.go` — pragmatic in-scope refactor if `SignedState` struct extract is needed for Meet OAuth reuse.
- **cross-service atomic commit** (WF-4) — this story is a breaking-change: api.yaml + generated types + backend handler + frontend consumer land in ONE commit. Split at code-review boundary if diff exceeds sensible chunk limits (Story 2-4 shipped in 3 chunks; this story likely 4-5 chunks — backend/frontend/OAuth split).
- **codegen order (WF-3)**: `.sql` files + api.yaml touched → `codegen.sh` MUST be the last script run before final push.
- **`git status` at hand-off** MUST show: all backend files, all frontend files, story artifacts, sprint-status. NO cross-package changes outside the listed paths.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.5` lines 207-239] — canonical epic-level 6 ACs.
- [Source: `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-7,FR-8` lines 280-293] — Owner-only + Google Meet single integration assumption.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#8.2` line 469] — Owner-only s49 tabbed screen.
- [Source: `docs/classlite-entry/05-cross-role.html:6819-7180`] — s49 mockup (Profile / Terms / Integrations / Rooms tabs).
- [Source: `classlite-api/migrations/20260601120000_create_auth_tables.up.sql:28-37`] — existing `centers` schema (timezone + google_meet_connected already present).
- [Source: `classlite-api/migrations/20260703120000_create_class_templates.up.sql:26-55`] — RLS 4-policy pattern for tenant-scoped tables.
- [Source: `classlite-api/internal/service/auth_google.go`] — Google OAuth login reference; Meet flow mirrors the state-signing + Exchange pattern.
- [Source: `classlite-api/internal/service/oauth_state.go`] — HMAC state signing helpers to reuse.
- [Source: `classlite-api/internal/service/center.go`] — audit-log-within-tx pattern from Story 2.1.
- [Source: `classlite-api/internal/middleware/require_role.go`] — Owner-only gate.
- [Source: `classlite-web/src/features/dashboard/hooks/useChecklistState.ts`] — hook Task 5.1 extends.
- [Source: `classlite-web/src/features/dashboard/lib/checklistDefinition.ts:72`] — DeadLinkTrigger target Task 5.5 graduates.
- [Source: `classlite-web/src/components/shared/PermissionDenied.tsx`] — role-gate component + `['owner']` variant.
- [Source: `classlite-web/src/components/domain/sidebarNavConfig.tsx:52-55`] — shipped `/settings` sidebar entry (owner-only).
- [Source: `classlite-web/src/features/onboarding/CenterSetupPage.tsx`] — brand-color picker pattern to reuse.
- [Source: `classlite-web/src/features/onboarding/api/useCreateCenter.ts`] — mutation + cache-write pattern.
- [Source: `_bmad-output/implementation-artifacts/2-4-post-onboarding-checklist-and-first-ai-grade-card.md`] — Sonner + DeadLinkTrigger + STORY_KEYS block pattern; FU-2-4-D dependency this story closes.
- [Source: `docs/project-context.md#GO-1..7, FW-1..7, SEC-1..11, WF-1..8, TEST-FE-1..6, TEST-BE-1..5`] — cross-cutting rules.
- [Source: `docs/bmad-story-conventions.md`] — 600-line ceiling + sibling completion-notes split.
- [Source: `_bmad-output/test-artifacts/test-design/test-design-architecture.md` risk register] — R1/R6/R38 discharge confirmations.

## Definition of Done

1. All 17 ACs green (functional + typed + tested).
2. `npm run test` clean — expected delta ~+90-140 tests (backend + frontend); no regression on 2-1..2-4 suites.
3. `npm run lint` clean.
4. `npm run i18n-parity` clean — pinned `STORY_2_5_KEYS` (est. ~90-110 keys) + prefix-ratchet (`settings.` mandatory) + `assertI18nInterpolationParity` over ALL keys per AC14.
5. `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
6. `axe-core` zero violations per AC16 matrix — 10 renders total (4 tabs × 2 locales + Owner + Non-Owner).
7. Storybook: SettingsPage ≥4 variants; ProfileTab ≥4; TermCalendarTab ≥3; RoomsTab ≥3; IntegrationsTab ≥3.
8. `git status` shows ONLY backend + frontend + story artifacts + `sprint-status.yaml` + `.env.example`. `codegen.sh` was the LAST script run before push (WF-3 heuristic).
9. `cd classlite-api && go test ./...` clean; `go vet ./...` clean; `golangci-lint run` clean. RLS adversarial tests cover 4 new tenant-scoped tables.
10. `npm run build` clean; `SettingsPage-*.js` chunk emits + size ≤ 25 kB gzip.
11. Playwright smoke green — `e2e/settings-owner-flow.spec.ts` per Task 10.7 (5 tests). `route-bundle-boundaries.spec.ts` extended assertions green.
12. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-5-center-settings-and-google-meet-integration-completion-notes.md`, recording actual key count vs estimate, Storybook variant counts, deviations from AC1-17, RLS adversarial-test row count, and MSW handler-catalog runtime map.
13. Change Log updated: pre-dev context entry + ATDD choice + spec-conflict-resolution cite + FU-2-4-D closure cite + all 5 migration files + codegen.sh runtime record.
14. Sprint-status `2-5-center-settings-and-google-meet-integration` flipped `ready-for-dev → in-progress → review` at hand-off; if the split option is exercised, `2-5-...` splits into `2-5a-...` / `2-5b-...` / `2-5c-...` entries in sprint-status via sprint-planning update BEFORE dev pickup.

## Out of Scope

- Google Drive integration — FU-2-5-D + PRD assumption.
- Zoom integration — FU-2-5-E + PRD assumption.
- Meet-link creation on session insert — Epic 3 (Story 3.4/3.5). This story only stores tokens + connected-flag.
- Transfer ownership + Archive center — FU-2-5-F (deps on Story 2.6 + Story 9.x).
- Logo re-upload UI — FU-2-5-A (deps on R2 presigned upload wire from Story 2-2).
- Slug (shortCode) editing — v2 story (would break existing student-facing class codes).
- Contact-email as reply-to on outbound emails — FU-2-5-G (column ships this story; consumption is a follow-up).
- Router-level role-gate — FU-2-5-H (Story 2.6 owns).
- Google's token-revoke on Disconnect — FU-2-5-B.
- Term/holiday-driven auto-scheduling — Story 3.x consumes; not built here.
- Room capacity live-check on session assign — Story 3.x consumes.

## Change Log

| Date | Note |
|---|---|
| 2026-07-14 | Story created backlog → ready-for-dev. Amelia's pre-dev context-engine pass against baseline `99d1f69`. 6 epic-level ACs elaborated into 17 detailed ACs. Full-stack ship: 5 new migrations + 17 new endpoints + 4 new sqlc query files + 4 new services + 5 new handlers + AES-GCM sealed-token storage for Google Meet OAuth + full RLS 4-policy pattern per Story 2.2 discipline. Frontend `/settings` route + 4-tab shell + RHF-driven Profile / CRUD Term calendar + Rooms + Google Meet Connect flow + FU-2-4-D closure via `<ReopenChecklistCta>` + graduation of `/settings` `<DeadLinkTrigger>` to real navigation. Owner-only per LITERAL-to-PRD resolution of epic AC conflict (FU-2-5-C files the epic-doc amendment). ~90-110 new i18n keys with STORY_2_5_KEYS pinned closed literal + prefix ratchet. Sibling completion-notes convention per `docs/bmad-story-conventions.md`. Split option flagged for dev pickup if scope exceeds one sprint (natural split: 2-5a backend + Profile, 2-5b Terms + Rooms, 2-5c Google Meet OAuth). ATDD RECOMMENDED skippable (no risk score ≥6). 8 FUs filed. Story file target ≤600 lines. |
