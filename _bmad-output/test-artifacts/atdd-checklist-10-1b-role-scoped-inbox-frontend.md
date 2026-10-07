---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate', 'step-05-verify-red']
lastStep: 'step-05-verify-red'
lastSaved: '2026-10-07'
storyId: '10.1b'
storyKey: '10-1b-role-scoped-inbox-frontend'
storyFile: '_bmad-output/implementation-artifacts/10-1b-role-scoped-inbox-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-10-1b-role-scoped-inbox-frontend.md'
detectedStack: 'fullstack'
generationMode: 'ai-generation'
redVerified: true
generatedTestFiles:
  - 'classlite-web/src/features/inbox/lib/__tests__/notificationMapping.golden.test.ts'
  - 'classlite-web/src/features/inbox/lib/__tests__/inboxChips.test.ts'
  - 'classlite-web/src/features/inbox/__tests__/inboxI18nKeys.ts'
  - 'classlite-web/src/features/inbox/__tests__/inboxI18nParity.test.ts'
  - 'classlite-api/internal/test/inbox_mark_all_read_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-1b-role-scoped-inbox-frontend.md'
  - '_bmad-output/implementation-artifacts/10-1a-inbox-and-notifications-backend.md (frozen contract)'
  - 'classlite-web/src/features/search/__tests__/searchI18nKeys.ts (STORY_8_4B_KEYS parity precedent)'
  - 'classlite-api/internal/test/inbox_read_atdd_test.go + story_10_1a_helpers_test.go (n101 seam)'
  - 'classlite-web/src/components/domain/InboxRow.tsx / InboxListShell.tsx (1d-4 chrome types)'
  - 'docs/project-context.md (reference_atdd_red_convention; TEST-FE-*, WF-8)'
---

# ATDD Red-Phase Checklist — Story 10-1b (Role-Scoped Inbox Frontend)

**Stack:** fullstack (FE vitest + MSW; one thin BE Go route). **Mode:** AI generation. **Conventions:** FE red = import a not-yet-existing module → `tsc -b` fails; BE red = `//go:build atdd_red_phase` (runtime-gated here). Dev greens each seam and de-tags/implements per file.

**WF-8 — lightweight RED-FIRST (not a full ceremony).** The ≥6 *backend* risks (R1/R3/R15) are owned+gated in 10-1a and are NOT reopened. 10-1b **maps to two FE-side ≥6**: the **cross-role MIS-render** (mapper/chip-config drift across four near-identical role views) and **R38 i18n-parity** (net-new key families). The red-first control for both is on the branch (below). Story stays `ready-for-dev`; next is `/bmad-dev-story 10-1b`. Remaining P1 coverage (optimistic failure modes, poller, three-state, axe) ships inline during dev + TA.

## Red files (5) — specimen → file

| AC / Risk | File | Red mechanism |
|---|---|---|
| **AC3 / AC8a — FE-owned mis-render 6** | `notificationMapping.golden.test.ts` | `tsc -b` compile-fail on `../notificationMapping`. Pins 7-type lane routing, i18n render en+vi with NO `undefined`/empty/dangling residue (value-scan), per-field null matrix, flagged `body` fallback. |
| **AC8b — FE-owned mis-render 6** | `inboxChips.test.ts` | `tsc -b` compile-fail on `../inboxChips`. Pins per-role chip derivation — **admin has NO Billing/Alerts chip**, owner DOES; no permanently-empty chips. |
| **AC10 — R38 parity 6** | `inboxI18nKeys.ts` (array) + `inboxI18nParity.test.ts` | Runtime: `assertI18nParity(STORY_10_1B_KEYS)` throws until the net-new keys exist in BOTH locales. |
| **AC6 / Task 1.4 — P0 BE** | `inbox_mark_all_read_atdd_test.go` | `//go:build atdd_red_phase`, runtime-gated: `POST /api/inbox/read-all` → 404 until mounted. Pins caller-unread→0, **BH7 archived-stays-unread**, same-center other-user untouched. |

## GREEN-PHASE SEAM CONTRACT (the reds ARE the contract — dev implements to match)

**FE — `src/features/inbox/lib/notificationMapping.ts`:**
- `export const INBOX_FALLBACK_KEY = 'inboxRow.fallback'`
- `export function toInboxRow(n: Notification): InboxRowData` — `Notification = components['schemas']['Notification']`; `InboxRowData` from `@/components/domain/InboxRow`.
- Lane map (exhaustive): `grade_released→grade · assignment_created→assignment · schedule_changed→schedule · question_asked→question · enrollment_changed→enrolment · payment_failed→billing · storage_threshold→integration`. **Switch MUST have a `never` default (`assertNever`)** (Winston — compile-time anti-drift).
- `mainTextKey`/`metaKey` from the 1d-4 `inboxRow.*` catalog; `mainTextVars`/`metaVars` built null-safe from `metadata` (omit band clause, generic schedule variant, neutral class label when name null). `occurredAt = n.createdAt` (ISO, TS-6); `occurredAtLabel = relativeTime(createdAt)`; `unread = n.readAt == null`.
- All-thin escape hatch → `mainTextKey = INBOX_FALLBACK_KEY` carrying `{ body: n.body }` (the ONE EN-snapshot path — flagged/greppable). Treat ALL metadata fields as runtime-nullable regardless of DD1b "required" wording until `FU-10-1-METADATA-ENRICH`.

**FE — `src/features/inbox/lib/inboxChips.ts`:**
- `export function deriveInboxChips(role: Role): InboxFilterChip[]` — `Role` from `@/features/auth/api/authKeys`; `InboxFilterChip` from `@/components/domain/InboxListShell`.
- Derive from the role's available v1 types (DD8); lead with `all` + `unread`. student = all·unread·grades·assignments·schedule · teacher = all·unread·questions · admin = all·unread·enrolments · owner = all·unread·enrolments·billing·alerts. `chip.key` = the i18n label key (reuse `inboxList.filters.{grades,assignments,questions,enrolments,billing}` from 1d-4; net-new `unread`/`schedule`/`alerts`).

**FE — i18n:** add every `STORY_10_1B_KEYS` entry to `en.json` + `vi.json`; then fold `STORY_10_1B_KEYS` into the master ratchet import (`i18n-parity-coverage.test.ts`, 8-4b pattern). Register a `{{val, relativeTime}}` i18n formatter (`src/lib/i18n.ts`, beside `vnDate`) wrapping `Intl.RelativeTimeFormat('en'|'vi')`.

**BE — `classlite-api`:**
- `handler.InboxHandler.MarkAllRead(w,r) error` → `h.svc.MarkAllRead(r.Context(), tc)` (**service method ALREADY EXISTS**, `notification_service.go:681`) → `WriteEnvelope{status:"ok"}` via a **net-new `EnvelopeStatusAck`** (`{data:{status}}`, no `id`).
- Route: `mux.Handle("POST /api/inbox/read-all", questionChain(inboxHandler.MarkAllRead))` in `cmd/api/main.go` AND in the test helper `newInboxSrv` (`story_10_1a_helpers_test.go`) so the red can reach it.
- api.yaml: add the path + `EnvelopeStatusAck`; run `scripts/codegen.sh` (openapi-typescript only; no sqlc/migration — WF-3). `MarkAllReadForUser` already retains `AND archived_at IS NULL` (10-1a BH7 patch) — do NOT regress it.

## RED verification (2026-10-07)

- **FE** `npx tsc -b` → **exit 1 on EXACTLY 2 errors**, both intended seams: `features/inbox/lib/__tests__/inboxChips.test.ts` (`../inboxChips`) and `notificationMapping.golden.test.ts` (`../notificationMapping`). **Zero** incidental errors (a transient LSP cache flagged billing/profile modules; the CLI gate proved the on-disk tree is clean — ignore the IDE noise). The golden's i18n assertions + the parity spec are **runtime-red** under vitest once those modules exist / while keys are missing.
- **BE** `gofmt -l` → clean. Untagged `go build ./...` → **exit 0**; `go vet ./...` → clean (the tagged red is excluded from the normal suite). `go test -tags atdd_red_phase -c ./internal/test/` → **compiles (exit 0)**; the file is **runtime-gated** (`POST /api/inbox/read-all` → 404 until the route is mounted), mirroring 10-1a's 0.4 crossing-publish specimen.

## Green-phase guidance (for `/bmad-dev-story 10-1b`)

1. Ship the BE route FIRST (Task 1) so `codegen.sh` regenerates `client.ts` before the FE wires against it (WF-1/WF-4, one atomic commit).
2. Implement `notificationMapping.ts` + `inboxChips.ts` → the two `tsc -b` seams go green; run both FE goldens.
3. Add all `STORY_10_1B_KEYS` to en + vi, register the `relativeTime` formatter → the parity spec goes green; fold the array into the master ratchet.
4. De-tag `inbox_mark_all_read_atdd_test.go` + add the route to `newInboxSrv` → the runtime 404 clears.
5. **No-guard controls** (prove the reds bite): mis-route `payment_failed` to a non-billing lane → golden FAILS; widen the admin chip set to include `billing` → `inboxChips` FAILS; revert `MarkAllReadForUser`'s `AND archived_at IS NULL` → the BE BH7 assertion FAILS.
6. The remaining P1 coverage (NOT red-gated here, add inline / via `/bmad-tea TA`): optimistic rollback-on-404 restoring BOTH keys + count-underflow floor; poller hidden-tab/single-instance/null-role-disabled (MSW + fake timers, never a hook mock); three-state trilogy; axe + badge aria; teacher reply visibility toggle + reply-route MSW handler.

## Specimens that are runtime (not compile) gated — noted
- The mark-all-read BE red (404 until route mounted), the golden's i18n value-scans, and the parity spec are runtime assertions that go live once their seams exist; the two `tsc -b` compile seams gate the FE mapper/chips until then.
- Cross-**tenant** isolation for `read-all` inherits 10-1a's notifications RLS 6-grid (center_id GUC); the SetupDB red owns the net-new `user_id`-scoping + BH7. A raw-pool cross-tenant leg (SetupRawPool, per 10-1a's 0.2) is an optional green-phase addition.
