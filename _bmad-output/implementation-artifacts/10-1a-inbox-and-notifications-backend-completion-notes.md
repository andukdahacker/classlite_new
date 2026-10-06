# Story 10-1a: Completion Notes

_Implementation record for [`10-1a-inbox-and-notifications-backend.md`](./10-1a-inbox-and-notifications-backend.md). Status: review._

## Dev Agent Record

### Debug Log
- **HTTP `GET /api/inbox` → 403 (`RequireVerifiedEmail`).** `qaSeedMember`/`CreateUser` leave `users.email_verified` at the `false` default; the inbox chain (correctly, matching production `questionChain`) requires a verified caller. Fix: added `n101VerifyCenterMembers` helper and called it after seeding in the two inbox HTTP reds (a fixture gap, not a contract change — other HTTP tests seed verified users explicitly).
- **Storage red hit the 50 MB per-file `.pdf` cap (A9).** The red uploaded 94 MB files to seed 94% of a 100 MB limit; `ConfirmUpload`'s per-file cap rejected them before the storage-ceiling crossing could run. Fix: rescaled to a 50 MB limit with 45/3/1/45 MB files (all < 50 MB cap), preserving the crossing → no-recross → delete-recross scenario exactly.
- **`story_10_1a_helpers.go` broke the non-test build.** De-tagging removed `//go:build atdd_red_phase`, so this non-`_test.go` file compiled whenever `internal/test` is imported as a regular package (e.g. by `internal/service`'s test binary) — but it references `qaSeed*` helpers that live in `_test.go` files → undefined. Fix: renamed to `story_10_1a_helpers_test.go` (matches the `story_8_4_helpers_test.go` precedent).
- **`@limit`/`@offset` sqlc parse error.** Switched to the codebase's `sqlc.arg('limit')`/`sqlc.arg('offset')` form.

### Completion Notes
- **Scope shipped:** full backend keystone — the `notifications` table + RLS, the sqlc query layer, `NotificationService` (write subscribers + inbox read API), `InboxHandler` + 4 routes, the storage-threshold producer + email, and the two missing emitters (ScheduleChanged, PaymentFailed). All 10 ACs covered; all 8 Task-0 reds green; the `t.Skip` FU-10-1-STORAGE-RACE stub preserved.
- **Bus injection via setters (deviation from DD4b "ctor param"):** `FileService`/`SessionService`/`BillingService` each got a `SetEventBus` setter + nil-tolerant publish, rather than new constructor params. This matches the ATDD-blessed FileService deviation (the red seam references `fileSvc.SetEventBus`) and avoids churning dozens of already-green `NewXService` callsites. Nil bus (the default in lean tests) → publish is inert, so no existing test regressed.
- **Metadata (DD1b):** each row carries a typed per-type metadata struct (GO-7 `schemaVersion`) with actor id + authoritative resource ids + the display fields resolvable at write time (className via `GetClassByID`, studentName via `GetUserByID`, assignmentTitle/dueAt via one new `GetAssignmentNotificationContext`/`GetGradeNotificationContext` join). api.yaml models it as a typed superset `NotificationMetadata` object (NOT a free object), not a 7-way `oneOf` (v1 maintainability).
- **Deferred — `FU-10-1-METADATA-ENRICH`:** fields the seven ruled event payloads do NOT carry are omitted in v1 (grade `bandPreview`; `schedule_changed` `oldTime`/`newTime`/`changeKind` — the session emitter publishes only `{sessionId,classId}`; `question_asked` `questionPreview`). Resolving them would require enriching producer payloads beyond this story's red contract.
- **PaymentFailed is a row only** (no email) — the grace dunning emails are Story 9.3's off-bus path (untouched). The on-bus bridge publishes post-commit, async, per the DD2 webhook-timeout carve-out.
- **StorageThreshold** publishes post-commit from `ConfirmUpload` with `used`/`limit` captured inside the advisory-locked closure (DD4); the subscriber writes the owner row + sends the EN `RenderStorageThresholdEmail` (Upgrade CTA). `used`/`limit` ride the event payload — never re-read post-commit.
- **Verification:** `go test -p 1 ./...` green (no regressions); `go vet ./...` clean; `gofmt` clean; migration `up→down→up` clean; `codegen.sh` clean (no sqlc drift); web `tsc -b` green on the regenerated `client.ts`. A no-guard control (dropping `status='active'` from the fan-out query) confirmed the AC10 cardinality red fails 4≠3, proving it bites.

### Implementation Plan (summary)
1. Migration `20261006140000_create_notifications` → `sqlc generate`.
2. `NotificationService` (7 subscribers, each own tenant tx) + read side.
3. `event.StorageThresholdCrossed` + `FileService.SetEventBus` + 95%-crossing post-commit publish + `RenderStorageThresholdEmail`.
4. `SessionService.SetEventBus` + ScheduleChanged (3 post-commit sites); `BillingService.SetEventBus` + PaymentFailed async bridge.
5. `InboxHandler` + 4 routes on the open `questionChain`; `main.go` `Register(eventBus)` + the three `SetEventBus` wirings.
6. api.yaml paths + schemas + `codegen.sh`.
7. De-tag reds, no-guard control, full green bar.

## File List

### Added
- `classlite-api/migrations/20261006140000_create_notifications.up.sql` / `.down.sql` — table + enum + 4-policy RLS + index.
- `classlite-api/internal/store/queries/notifications.sql` — Insert/Fanout/ListInbox/CountInbox/CountUnread/MarkRead/Archive/MarkAllRead + 3 recipient/context queries.
- `classlite-api/internal/store/generated/notifications.sql.go` — generated (sqlc).
- `classlite-api/internal/service/notification_service.go` — the write subscribers + inbox read service.
- `classlite-api/internal/handler/inbox_handler.go` — GET /api/inbox, /count, POST /{id}/read, /{id}/archive.
- `_bmad-output/implementation-artifacts/10-1a-inbox-and-notifications-backend-completion-notes.md` — this file.

### Modified
- `classlite-api/internal/event/types.go` — `StorageThresholdCrossed` constant.
- `classlite-api/internal/service/file_service.go` — `events` field + `SetEventBus` + `StorageNotifyThresholdPercent` + crossing capture + post-commit publish.
- `classlite-api/internal/service/email_templates.go` — `StorageThresholdEmailSubject` + `RenderStorageThresholdEmail`.
- `classlite-api/internal/service/session.go` + `session_crud.go` — `events` field + `SetEventBus` + `publishScheduleChanged` wired into Update/Cancel/DeleteSessions (3 post-commit sites).
- `classlite-api/internal/service/billing_service.go` + `billing_polar.go` — `events` field + `SetEventBus` + post-commit async PaymentFailed publish.
- `classlite-api/cmd/api/main.go` — construct + `Register` NotificationService; `SetEventBus` on billing/session/file; 4 inbox routes; InboxHandler.
- `classlite-api/api.yaml` — 4 inbox paths + `Notification`/`NotificationType`/`NotificationMetadata`/`EnvelopeNotificationList`/`EnvelopeUnreadCount`/`EnvelopeNotificationAck` schemas.
- `classlite-api/internal/store/generated/models.go` — generated `NotificationType` enum + `Notification` struct (sqlc).
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript): Notification types + inbox paths.
- `classlite-api/internal/test/*` (Task 0 reds) — de-tagged `//go:build atdd_red_phase`; `story_10_1a_helpers.go`→`story_10_1a_helpers_test.go` (+ `n101VerifyCenterMembers`); storage red file sizes rescaled; two inbox reds verify seeded callers.

### Deleted
- None (the helper file was renamed, not deleted).

## Party-Mode Review Appendix
Not applicable (pre-dev party-mode fold already captured in the story Change Log; no post-implementation review run yet).
