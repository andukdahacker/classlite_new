# Story 10-1b: Completion Notes

_Implementation record for [`10-1b-role-scoped-inbox-frontend.md`](./10-1b-role-scoped-inbox-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Stale LSP flood (expected).** Editing `client.ts` (codegen) + new modules triggered a large transient LSP diagnostic flood ("`BillingSummary`/`Notification` does not exist on type {…293 more…}", pre-existing billing/profile modules "missing"). Confirmed harmless exactly as the ATDD checklist warned: `git diff --numstat client.ts` = **+62 / −0** (purely additive), and CLI `npx tsc -b` → **exit 0**. The CLI gate — not the IDE — is authoritative.
- **1d-4 `inboxRow.*.main` keys are unusable for the mapper.** They bake in vars the real 10-1a metadata never carries (`band`, `plan`, billing `status`, integration `action`, `exercise`). Built a null-safe `inboxRow.{lane}.title` / `.titleGeneric` catalog instead; documented in `notificationMapping.ts`.
- **No `<Trans>` in the project.** Rendered the empty-state italic-accent word via the StudentWelcome precedent (`title` + separate `titleAccent` key in a `<span className="italic">`), NOT embedded HTML in the i18n value. Added `.titleAccent` keys.
- **Double mark-read double-decrement race.** An awaited `cancelQueries` at the top of `onMutate` let two concurrent `markRead` calls both snapshot the stale unread state → count −2. Fixed by making `onMutate` SYNCHRONOUS (snapshot+guard+patch before any await; `void cancelQueries`), so the second call sees the first's optimistic `readAt` → nets ONE decrement. Covered by a test.
- **Archive undo has no server verb.** 10-1a ships no un-archive endpoint, so undo cannot be a rollback-after-commit (next poll re-drops the row). Implemented DEFERRED-commit: optimistic drop immediately, the `POST /archive` fires only after a `ARCHIVE_UNDO_WINDOW_MS` (6s) window; `undo()` cancels the pending commit + restores the snapshot (no server call ever made). Covered by two timer tests.
- **Reply composer testid.** The private visibility toggle uses the API value `personal` (`inbox-reply-visibility-personal`), label "Private" — fixed a test that queried `-private`.

### Completion Notes

All 8 tasks + 10 ACs implemented and green.

- **Task 1 (BE, the only backend):** `InboxHandler.MarkAllRead` → existing `svc.MarkAllRead` → net-new `EnvelopeStatusAck` (`{data:{status:"ok"}}`, no `id`). Route `POST /api/inbox/read-all` on the open `questionChain` (main.go + the test helper `newInboxSrv`). api.yaml + `codegen.sh` (openapi-typescript only — **no sqlc drift, no migration**). The ATDD red `inbox_mark_all_read_atdd_test.go` de-tagged → green (caller-scoped → 0, BH7 archived-stays-unread, other-user untouched).
- **Task 2 (hooks):** `inboxKeys` (TS-3), `useInbox` (`apiFetchWithMeta`, snake_case params, keepPreviousData), `useInboxCount` (poller, `INBOX_POLL_INTERVAL_MS = 45_000`, `refetchIntervalInBackground:false`, `enabled`-gated), `useInboxActions` (optimistic triple on list+count, two-key ctx, `max(0)` floor, guarded decrement, deferred archive undo).
- **Task 3 (mapper):** `toInboxRow` compile-time-exhaustive (`never` default → flagged `INBOX_FALLBACK_KEY`), null-safe per-lane titles; `relativeTime` (core `src/lib/`) + `{{val, relativeTime}}` i18n formatter.
- **Task 4 (views):** `InboxRoute` dispatcher (no gate) + 4 lazy role views over ONE shared `InboxView` (DRY — avoids the copy-paste-drift risk). Route added to `routes.tsx`.
- **Task 5 (reply):** `InboxReplyComposer` (RHF+zod, visibility toggle shared/personal, resolve off) reusing `useReplyToQuestion` from the questions barrel.
- **Task 6 (badge):** `AppLayout` reads the single `useInboxCount` poller, injects `badgeCount` onto the `/inbox` sidebar item + `unreadByTab={{inbox}}` on MobileTabBar; fixed the stale `usePolling.ts` header.
- **Task 7 (trilogy/mobile/i18n):** `InboxStates` (skeleton/error/role-toned empty with italic-accent headline), shell chip bar now scrolls horizontally on mobile (`md:` keeps desktop wrap), all new keys in en+vi + `STORY_10_1B_KEYS` folded into the master ratchet.

### Deviations from spec (engineering calls, documented)

1. **`relativeTime.ts` placed in `src/lib/` (core), not `features/inbox/lib/`** — so the `i18n.ts` formatter registration imports it without a core→feature edge. It's a cross-cutting formatter. (Story allows overrides with written reason.)
2. **Relative time renders via `inbox.time.*` i18n keys, not raw `Intl.RelativeTimeFormat`** — keeps all user-facing strings under the R38 parity ratchet (the keys are explicitly in STORY_10_1B_KEYS). The formatter wraps this.
3. **`InboxListShell` gained an optional `emptyState?: ReactNode` prop** (backward-compatible; default = the 1d-4 text) — the DD9 "feed role-toned copy into the shell's empty slot" needs a slot; this is a presentational extension, not a fork.
4. **Added i18n keys beyond AC10's illustrative list:** `inbox.error.message`/`inbox.error.retry` (AC2 error branch), `inbox.empty.*.titleAccent` (italic-accent split per the StudentWelcome precedent), and the `inboxRow.{lane}.title*` + `inboxRow.meta.*` + `inboxRow.fallback` mapper catalog. All in both locales + STORY_10_1B_KEYS.
5. **Mobile touch-target sizing (AC9 ≥44px) is bounded by the 1d-4 InboxRow chrome** (`size="xs"` buttons). Feature-level mobile responsiveness shipped (scrolling chips, full-screen-push detail via `n.link` navigation, responsive header); row-action button sizing is a shared-chrome concern for 10-3/10-4 polish — NOT forked here per the story's "do not fork the domain chrome" rule.

### Implementation Plan (as executed)

1. BE route (Task 1) → codegen → de-tag + green the mark-all-read ATDD red.
2. Mapper + chips + relativeTime (Task 3) → green the two `tsc -b` seams + the golden/chips reds.
3. i18n keys → both locales + STORY_10_1B_KEYS + master ratchet → green the parity red.
4. Data hooks (Task 2) + inline tests (optimistic/floor/double-fire/undo, poller).
5. Views + dispatcher + route (Task 4) + reply composer (Task 5) + inline tests (dispatch, three-state, faithful-render, axe, reply).
6. Badge wiring (Task 6) + `usePolling` header fix + badge test.
7. Trilogy + empties + mobile chip scroll (Task 7).
8. Verify (Task 8): `tsc -b`, full vitest, ESLint, BE gates, codegen.

## File List

### Added

- `classlite-web/src/lib/relativeTime.ts` — core relative-time formatter logic.
- `classlite-web/src/features/inbox/lib/notificationMapping.ts` — `toInboxRow` anti-corruption mapper.
- `classlite-web/src/features/inbox/lib/inboxChips.ts` — per-role chip derivation + filter resolver.
- `classlite-web/src/features/inbox/api/inboxKeys.ts` — query-key factory + constants.
- `classlite-web/src/features/inbox/api/useInbox.ts` — paginated list hook.
- `classlite-web/src/features/inbox/api/useInboxCount.ts` — badge-count poller.
- `classlite-web/src/features/inbox/api/useInboxActions.ts` — optimistic mark-read/archive/mark-all + deferred undo.
- `classlite-web/src/features/inbox/components/InboxStates.tsx` — skeleton / error / role-toned empty.
- `classlite-web/src/features/inbox/components/InboxView.tsx` — shared inbox surface.
- `classlite-web/src/features/inbox/components/InboxReplyComposer.tsx` — teacher reply composer.
- `classlite-web/src/features/inbox/{InboxRoute,StudentInbox,TeacherInbox,AdminInbox,OwnerInbox}.tsx` — dispatcher + role views.
- `classlite-web/src/features/inbox/index.ts` — barrel.
- `classlite-web/src/features/inbox/api/__tests__/{useInboxActions,useInboxCount}.test.tsx` — hook tests.
- `classlite-web/src/features/inbox/components/__tests__/{InboxView,InboxReplyComposer}.test.tsx` — component tests.
- `classlite-web/src/features/inbox/__tests__/InboxRoute.test.tsx` — dispatch test.
- `classlite-web/src/components/shared/__tests__/AppLayout.inboxBadge.test.tsx` — badge wiring test.

### Modified

- `classlite-api/internal/handler/inbox_handler.go` — `+MarkAllRead`.
- `classlite-api/cmd/api/main.go` — `+POST /api/inbox/read-all` route.
- `classlite-api/internal/test/story_10_1a_helpers_test.go` — `+read-all` route in `newInboxSrv`.
- `classlite-api/internal/test/inbox_mark_all_read_atdd_test.go` — de-tagged (red → green).
- `classlite-api/api.yaml` — `+/api/inbox/read-all` path + `EnvelopeStatusAck` schema.
- `classlite-web/src/lib/api/client.ts` — regenerated (additive: op + schema).
- `classlite-web/src/lib/i18n.ts` — `+relativeTime` formatter.
- `classlite-web/src/locales/{en,vi}.json` — new inbox keys (both locales).
- `classlite-web/src/features/inbox/__tests__/inboxI18nKeys.ts` — expanded STORY_10_1B_KEYS (mapper catalog, error, titleAccent).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — folded STORY_10_1B_KEYS into the master ratchet.
- `classlite-web/src/components/domain/InboxListShell.tsx` — `+emptyState` slot + mobile chip scroll.
- `classlite-web/src/components/shared/AppLayout.tsx` — badge wiring (sidebar + mobile).
- `classlite-web/src/hooks/usePolling.ts` — corrected the stale "inbox badge" header comment.
- `classlite-web/src/routes.tsx` — `+/inbox` lazy route.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 10-1b → in-progress → review.

### Deleted

- None.
