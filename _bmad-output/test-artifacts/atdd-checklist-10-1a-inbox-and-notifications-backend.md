---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate', 'step-05-verify-red']
lastStep: 'step-05-verify-red'
lastSaved: '2026-10-06'
storyId: '10.1a'
storyKey: '10-1a-inbox-and-notifications-backend'
storyFile: '_bmad-output/implementation-artifacts/10-1a-inbox-and-notifications-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-10-1a-inbox-and-notifications-backend.md'
detectedStack: 'backend'
generationMode: 'ai-generation'
redVerified: true
generatedTestFiles:
  - 'classlite-api/internal/test/story_10_1a_helpers.go'
  - 'classlite-api/internal/test/notifications_rls_atdd_test.go'
  - 'classlite-api/internal/test/notification_subscriber_tenant_atdd_test.go'
  - 'classlite-api/internal/test/notification_owner_billing_atdd_test.go'
  - 'classlite-api/internal/test/notification_storage_threshold_atdd_test.go'
  - 'classlite-api/internal/test/inbox_read_atdd_test.go'
  - 'classlite-api/internal/test/notification_idempotency_char_atdd_test.go'
  - 'classlite-api/internal/test/notification_swallow_atdd_test.go'
  - 'classlite-api/internal/test/notification_fanout_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/10-1a-inbox-and-notifications-backend.md'
  - 'classlite-api/internal/test/_TEMPLATE_rls_test.go'
  - 'classlite-api/internal/test/story_9_2a_helpers.go'
  - 'classlite-api/internal/event/bus.go'
  - 'docs/project-context.md (reference_atdd_red_convention)'
---

# ATDD Red-Phase Checklist — Story 10-1a (Inbox & Notifications Backend)

**Stack:** backend (Go). **Mode:** AI generation. **Convention:** `//go:build atdd_red_phase` tagged-compile-fail — the reds are excluded from the normal suite and the dev strips the tag per file as each seam lands green.

**WF-8 HARD GATE SATISFIED FOR ENTRY TO in-progress:** the ACs map to R1=9 / R3=9 / R2=6 / R15=6; the red-phase specimens for all four are on the branch (see coverage map). Story stays `ready-for-dev`; next is `/bmad-dev-story 10-1a`.

## Red files (9) — specimen → file

| Task-0 | AC / Risk | File |
|---|---|---|
| 0.1 | AC2 / R1,R2 | `notifications_rls_atdd_test.go` — 6-pattern RLS grid (pattern 4 = raw DELETE; no delete query exists) |
| 0.2 | AC6 / R3 | `notification_subscriber_tenant_atdd_test.go` — **`SetupRawPool`**; row under A, independent tenant-B sees zero, empty-CenterID rejected |
| 0.3 | AC7 / R15 | `notification_owner_billing_atdd_test.go` — `payment.failed` → owner 1 / admin 0 (via HTTP `GET /api/inbox`); `enrollment.changed` → both |
| 0.4 | AC8 | `notification_storage_threshold_atdd_test.go` — drives real `ConfirmUpload` 94→95% cross, no-recross, delete-recross; 1 owner row + 1 Upgrade email; `t.Skip` FU-10-1-STORAGE-RACE stub |
| 0.5 | AC3/4/5 | `inbox_read_atdd_test.go` — own-active-only, unread count, cross-user read+archive each 404, mark-read idempotency (2nd read → 200), empty inbox |
| 0.6 | — (char.) | `notification_idempotency_char_atdd_test.go` — double-publish `grade.released` pins **2** rows (flips to 1 under FU-10-1-DURABLE) |
| 0.7 | DD2 | `notification_swallow_atdd_test.go` — failing subscriber + failed recipient resolution → Publish no-panic, zero rows, producer sentinel survives |
| 0.8 | AC10 | `notification_fanout_atdd_test.go` — 3 active + 1 withdrawn → exactly 3 (each + empty-class-zero) for `assignment.created` & `schedule.changed` |
| — | helpers | `story_10_1a_helpers.go` — seam-light: event/payload builders, raw-SQL readers (value-scan + cardinality), raw-pool seeders+cleanup, RLS counter, fan-out seeder, HTTP inbox client, `n101Wire`/`newInboxSrv` wiring |

## GREEN-PHASE SEAM CONTRACT (the reds ARE the contract — dev implements to match)

- **Migration `20261006140000_create_notifications`:** table (DD1 cols) + `notification_type` enum + ENABLE/FORCE 4-policy center_id RLS grid + `idx_notifications_user_active`.
- **sqlc `generated`:** `Notification` struct; `NotificationType` + consts `{GradeReleased,AssignmentCreated,EnrollmentChanged,QuestionAsked,ScheduleChanged,PaymentFailed,StorageThreshold}`; `InsertNotification(+Params{CenterID,UserID pgtype.UUID; Type NotificationType; Title,Body,Link string; Metadata []byte})→Notification`; `ListInboxForUser(+Params{CenterID,UserID; Type pgtype.Text; UnreadOnly bool; Limit,Offset int32})→[]Notification` (active-queue `archived_at IS NULL`); `CountUnreadForUser(+Params{CenterID,UserID})→int64`; `MarkNotificationRead(+Params{ID,UserID,ReadAt})→Notification` (**SQL `WHERE id=$ AND user_id=$`, NOT `read_at IS NULL`** — the idempotency-vs-404 trap); `ArchiveNotification(+Params{ID,UserID,ArchivedAt})→Notification`.
- **event:** `const StorageThresholdCrossed = "storage.threshold.crossed"`.
- **service:** `NewNotificationService(db service.AuthDB, clk clock.Clock, email service.EmailSender) *NotificationService` + `.Register(bus *event.Bus)`, `.ListInbox(ctx,tc,InboxFilter,page,pageSize)([]InboxItem,PageResult,error)`, `.CountUnread(ctx,tc)(int,error)`, `.MarkRead(ctx,tc,uuid.UUID)error`, `.Archive(ctx,tc,uuid.UUID)error`; `InboxFilter{Type string; UnreadOnly bool}`; `InboxItem{ID uuid.UUID; Type,Title,Body,Link string; Metadata json.RawMessage; ReadAt,ArchivedAt *time.Time; CreatedAt time.Time}` (carry the DD1b typed metadata through `Metadata`).
- **storage producer:** `(*FileService).SetEventBus(bus *event.Bus)` — ⚠️ **deviation from spec DD4b** (pinned "constructor param"). The author chose a **setter** to avoid churning the already-green 4-arg `NewFileService` callsites. **Dev's call at pickup:** either keep the setter or switch to the ctor param per DD4b and adjust the one red reference (`fileSvc.SetEventBus` in `notification_storage_threshold_atdd_test.go`). Green wires `ConfirmUpload` to publish `event.StorageThresholdCrossed` **post-commit** on a 94→95% crossing (DD4: capture `crossed` inside the locked closure, publish after it returns nil).
- **handler:** `NewInboxHandler(svc *service.NotificationService, clk clock.Clock) *InboxHandler` + `.List/.Count/.MarkRead/.Archive` (middleware.HandlerWithError); routes `GET /api/inbox`, `GET /api/inbox/count`, `POST /api/inbox/{id}/read`, `POST /api/inbox/{id}/archive` on the open `questionChain`.

## RED verification (2026-10-06)

- `gofmt -l` on all 9 files → **clean**.
- Untagged `go build ./...` → **exit 0**; `go vet ./...` → **exit 0** (tagged reds excluded — they do not pollute the main suite).
- Tagged compile `go test -tags atdd_red_phase -c ./internal/test/` → **exit 1, failing ONLY on documented seams**: `service.NewNotificationService`/`NotificationService`, `generated.{InsertNotification(Params),ListInboxForUser(Params),MarkNotificationRead(Params),NotificationTypePaymentFailed}`, `event.StorageThresholdCrossed`, `handler.NewInboxHandler`, `(*FileService).SetEventBus`. No incidental errors. (Un-surfaced seams — `ArchiveNotification`, `CountUnreadForUser`, `generated.Notification`, the service/handler methods — are masked by the undefined-type cascade and surface as the dev implements incrementally; all documented above.)

## Green-phase guidance (for `/bmad-dev-story 10-1a`)

1. Implement seams substrate-first: migration → `sqlc generate` → service → handler → `main.go` wiring (`Register(eventBus)` + the 3 missing emitters per DD4b).
2. Strip `//go:build atdd_red_phase` from each red file as its seams land green; run that file untagged.
3. Run the **no-guard controls** to prove the load-bearing invariants actually bite: 0.2 must FAIL if the subscriber reuses the producer's tenant (not its own tx); 0.7 must FAIL if a handler error propagates; 0.8 must FAIL if fan-out includes withdrawn enrollments.
4. Full green bar: `go test -p 1 ./...` (reds de-tagged), `migrate.sh` up→down→up, `codegen.sh` clean, `tsc -b` on the regenerated web client.

## Specimens that are runtime (not compile) gated — noted
- 0.4 crossing-publish wiring, 0.2 empty-CenterID rejection, AC2 RLS behavior, and mark-read idempotency are **runtime** assertions that go live once the migration/queries exist; the compile seams gate them until then.
- 0.7 pins the **error**-swallow (the bus's documented behavior); a panicking handler is intentionally NOT used — the synchronous bus does not recover panics, so that would propagate rather than prove the contract.
