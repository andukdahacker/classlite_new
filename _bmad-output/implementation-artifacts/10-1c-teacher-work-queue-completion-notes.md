# Story 10-1c: Completion Notes

_Implementation record for [`10-1c-teacher-work-queue.md`](./10-1c-teacher-work-queue.md). Status: review._

## Dev Agent Record

### Debug Log

- **BE no-guard controls (dev-handoff ask).** Confirmed both isolation predicates bite by mutation, then reverted:
  - Neutralized `c.teacher_id = caller` → `(c.teacher_id = caller OR TRUE)` ⇒ AC3 (`TestTeacherQueue_TeacherScope`) FAILED with a cross-teacher leak (A saw B's rows; owner got 2 rows instead of 0). The service-layer teacher scope is load-bearing (RLS does NOT isolate same-tenant teachers — the 7-2a class).
  - Dropped the release-oracle disjunction `(cg.id IS NULL OR cg.released_at IS NULL)` → `cg.id IS NULL` ⇒ AC2 (`TestTeacherQueue_Contract`) FAILED (the `ai_processing` + unreleased-draft row wrongly dropped; total 3 vs 4). The `released_at IS NULL` branch is load-bearing.
- **codegen path gotcha.** `scripts/codegen.sh` must run from the repo root (it `cd`s into `classlite-api`/`classlite-web` itself). A stray `./scripts/codegen.sh` from inside `classlite-api` no-ops silently — verify the generated diff after each run.
- **Stale test-DB pollution (not a code defect).** `TestInbox_MarkAllRead_...ArchivedStaysUnread_ATDD` failed on `idx_users_email` duplicate for the fixed-email cross-tenant fixture `n101b-tenantB@example.com` — a committed superuser-pool row left by a hard-killed prior run (its `t.Cleanup` never fired). Deleted the orphaned `users`/`center_members` row; the suite then passed. No code change.
- **Stale-LSP flood.** The editor LSP flagged ~a dozen "property does not exist on client schemas" / "cannot find module" errors on the just-regenerated `client.ts` + the new modules. Confirmed stale-cache (the 10-1b observation): CLI `tsc -b` is clean. The gate is `tsc -b`, not the LSP.

### Completion Notes

All 10 ACs met; all 7 tasks / 18 subtasks complete. Backend + frontend shipped in one change (WF-4).

- **BE — one additive derived-read endpoint.** `GET /api/inbox/teacher-queue` on the ungated `questionChain`. `ListTeacherQueue`/`CountTeacherQueue` sqlc queries clone the 8-1a `ListGradingBacklog` shape + `{is_late, class_id, assignment_id, LIMIT/OFFSET, late_only}`; `teacher_id` is a REQUIRED arg bound to `tc.UserID` (Ducdo Q4 — never the center-wide narg). `NotificationService.ListTeacherQueue` mirrors `ListInbox` (clamp + `math.MaxInt32` overflow guards, one `inTenantTx`, server-built grading `link`). `overdue` is clock-injected; `isLate` is the submit snapshot (both emitted, DD6). NO migration / table / RLS policy.
- **FE — teacher merged feed (DD3).** The teacher branch of the shared `InboxView` fetches BOTH sources at `INBOX_QUEUE_FETCH_SIZE` (100), maps each to `InboxRowData`, merges + sorts by `occurredAt` DESC, and client-paginates the merged array by `INBOX_PAGE_SIZE` — one coherent pager (`total` = merged length). Submission rows: Grade → `navigate(link)`; archive/read suppressed (`suppressArchive` on `InboxRowData`). Chips widened to `all · unread · questions · submissions · late`; `late` refetches server-side (`late_only=true`, Q3); the active queue chip carries the queue `total` as its count; the in-feed "N to grade" line surfaces the backlog (NOT the nav badge, Q2). The DD3 ceiling seam (`inbox.teacher.queueCeiling`) shows when a source's server total exceeds the bounded fetch. Other role views are behaviourally unchanged.
- **Mapper is a SIBLING (AC8).** `toInboxRowFromQueueItem` is a new pure mapper — `NotificationType` stays a 7-member enum and `toInboxRow`'s `never`-exhaustive switch is untouched.
- **Badge untouched (AC9).** `AppLayout` was not edited; no new count query feeds the nav badge.

### Deviations from spec

- **DD4 chip-count scope — pragmatic.** The spec implies the Submissions AND Late chips both carry counts at all times. Since only ONE queue query runs (the active chip's `lateOnly`), the count lands on whichever queue chip matches the current fetch (Submissions when `lateOnly=false`, incl. the merged `all` view; Late when `lateOnly=true`). This avoids showing a stale/derived count and keeps AC5's server-side filter honest. The "N to grade" in-feed line shows the full ungraded total when `lateOnly=false`. A two-total variant is only needed if a product call later wants both counts visible simultaneously.
- **`InboxRow` gained an optional `suppressArchive` field** (1d-4 domain chrome) to hide the archive affordance for submission rows. Additive, defaults to current behaviour for all notification rows.
- **`InboxRoute.test.tsx` MSW boundary extended** to register `/api/inbox/teacher-queue` (the teacher role view now reads a second source). Additive test-harness update, not a behaviour change.

### Implementation Plan (summary)

1. Task 1 — `submissions.sql`: `ListTeacherQueue`/`CountTeacherQueue` → `codegen.sh` (sqlc).
2. Task 4 — `api.yaml`: `TeacherQueueItem` + `EnvelopeTeacherQueueList` + the path → `codegen.sh` (openapi-typescript → `client.ts`).
3. Task 2 — `NotificationService.ListTeacherQueue` + `TeacherQueueItem` DTO + row mapper.
4. Task 3 — `InboxHandler.TeacherQueue` + wire struct + route in `main.go`.
5. De-tagged the 4 BE ATDD reds → green; ran the two no-guard controls.
6. Task 5 — FE `inboxKeys` (+`teacherQueue`, `TeacherQueueParams`, `INBOX_QUEUE_FETCH_SIZE`), `useTeacherQueue`, `teacherQueueMapping`.
7. Task 6 — `inboxChips` (teacher `submissions`/`late` + `teacherQueueChip` resolver), `InboxView` teacher-branch merge, `InboxRow.suppressArchive`.
8. Task 7 — i18n keys (en + vi) + `STORY_10_1C_KEYS` folded into the master ratchet + flipped the superseded 10-1b teacher-chips assertion; green-phase component tests (merged feed, Grade-navigates, no-archive, Late server-filter, in-feed count, axe); full gate sweep.

## File List

### Added

- `classlite-web/src/features/inbox/api/useTeacherQueue.ts` — the teacher-queue data hook (enabled on the teacher branch only).
- `classlite-web/src/features/inbox/lib/teacherQueueMapping.ts` — `toInboxRowFromQueueItem` sibling mapper (queue → `InboxRowData`).
- `_bmad-output/implementation-artifacts/10-1c-teacher-work-queue-completion-notes.md` — this file.

### Modified

- `classlite-api/internal/store/queries/submissions.sql` — +`ListTeacherQueue`/`CountTeacherQueue` (derived read, teacher-scoped, release-aware, `late_only`).
- `classlite-api/api.yaml` — +`TeacherQueueItem`/`EnvelopeTeacherQueueList` schemas + the `GET /api/inbox/teacher-queue` path.
- `classlite-api/internal/service/notification_service.go` — +`ListTeacherQueue` method + `TeacherQueueItem` DTO + `teacherQueueItemFromRow`.
- `classlite-api/internal/handler/inbox_handler.go` — +`TeacherQueue` handler + `teacherQueueResponse` wire struct.
- `classlite-api/cmd/api/main.go` — +`GET /api/inbox/teacher-queue` route (gofmt-realigned the inbox route block).
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript): +`TeacherQueueItem`/`EnvelopeTeacherQueueList` + the path.
- `classlite-web/src/features/inbox/api/inboxKeys.ts` — +`teacherQueue` key, `TeacherQueueParams`, `INBOX_QUEUE_FETCH_SIZE`.
- `classlite-web/src/features/inbox/lib/inboxChips.ts` — teacher gains `submissions`/`late`; +`teacherQueueChip` resolver; `chipFilter` returns `{}` for queue chips.
- `classlite-web/src/features/inbox/components/InboxView.tsx` — teacher-branch merged feed (fetch both sources → merge → client-paginate; Grade nav; ceiling seam; in-feed count). Other roles unchanged.
- `classlite-web/src/components/domain/InboxRow.tsx` — +optional `suppressArchive` field + guarded archive button.
- `classlite-web/src/locales/en.json`, `classlite-web/src/locales/vi.json` — +6 net-new keys (3 submission meta variants, `inboxList.filters.late`, `inbox.teacher.toGrade`, `inbox.teacher.queueCeiling`).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — folded `STORY_10_1C_KEYS` into the master ratchet.
- `classlite-api/internal/test/story_10_1c_helpers_test.go`, `teacher_queue_scope_atdd_test.go`, `teacher_queue_cross_tenant_rls_atdd_test.go`, `teacher_queue_contract_atdd_test.go` — de-tagged `atdd_red_phase` → green.
- `classlite-web/src/features/inbox/lib/__tests__/inboxChips.test.ts` — flipped the superseded 10-1b teacher-chips assertion (`submissions` now true; `+late`).
- `classlite-web/src/features/inbox/components/__tests__/InboxView.test.tsx` — +teacher merged-feed green-phase tests (AC6/AC7/AC9/AC10).
- `classlite-web/src/features/inbox/__tests__/InboxRoute.test.tsx` — +`/api/inbox/teacher-queue` MSW handler (teacher view's second source).

### Deleted

- None.

### Not committed (regenerated in CI)

- `classlite-api/internal/store/generated/submissions.sql.go` — sqlc output; `internal/store/generated/` is gitignored.
