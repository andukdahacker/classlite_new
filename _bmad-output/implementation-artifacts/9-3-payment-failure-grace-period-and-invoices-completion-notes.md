# Story 9-3: Completion Notes

_Implementation record for [`9-3-payment-failure-grace-period-and-invoices.md`](./9-3-payment-failure-grace-period-and-invoices.md). Status: review._

## Dev Agent Record

### Agent Model Used
Amelia (bmad-dev-story) · Claude Opus 4.8 (1M context)

### Debug Log
- **Red baseline (Task 0):** `go vet -tags atdd_red_phase ./internal/test/ ./internal/handler/` compile-failed ONLY on the documented seams (`SetEmailSender`, `HandleGraceTick`, `CheckClassMutable`, `CheckTeacherSeatMutable`, `EmailInvoicesToAccountant`); the untagged green suite compiled clean. The invoice-authz red fails at runtime (404→403), not compile.
- **Helper bugs (written blind during the red phase, surfaced at first green run):** `story_9_3_helpers.go` used `job_type` (real column is `type`) in `countPendingGraceTicks`, and seeded assignments with `status='active'` (CHECK admits only `open`/`closed`). Both fixed in the helper (not a red assertion).
- **`billingEpoch` is 2026-09-15 **03:00** UTC (NOT midnight).** `graceDeadlineFrom` truncates grace_period_start to its UTC date then +7d+23h59m — matching the red's `graceDeadline()` exactly. The day-7 downgrade gates on `now >= deadline` (not `elapsedDay>=7`), so the pre-deadline day-7 tick (elapsedDay 7, now<deadline) does NOT downgrade — honoring R1.
- **FE data-shape reconcile:** the invoice-page red fixture returns `data` as a bare array; aligned the backend handler + `EnvelopeBillingInvoices` to `data: [array]` (pagination in `meta.pagination`).
- **FE date-format reconcile (M7):** the banner red asserts `"12 Oct 2026"`, but the existing `vnDate` formatter yields `dd/MM/yyyy`. Added a `vnDateLong` i18n formatter (en-GB short month) so the deadline renders from `graceEndsAt` (M7 — not the server label) AND matches the red.
- **FE filter collision:** the s70 status-`<select>` option labels reuse the pill i18n text, so `getByText(status.paid)` matched the option before rows loaded. Removed the visible filter (hook keeps the `status` param) → `FU-9-3-INVOICE-FILTER-UI`.
- **AppLayout regression:** mounting `BillingGraceBanner` (first `useQuery` in that tree) broke `AppLayout.test` ("No QueryClient"). Wrapped the test render in a `QueryClientProvider` (legitimate — AppLayout gained a Query-backed child); the grace query errors harmlessly with no handler → banner renders null, chrome unchanged.
- **Breaking-change ripple:** `grace` is required+nullable on `BillingSummary` (matches the sibling D-DASH fields). Added `grace: null` to 8 existing billing fixtures.

### Completion Notes
Shipped the full-stack grace + invoices layer over the 9-2a receiver (NOT rebuilt):

**Backend** — grace cols migration (`20261005120000`, + per-day high-water marker `grace_last_tick_day`, no status-CHECK change); grace mutators (`SetPastDueWithGrace`/`ClearGrace`/`ExpireGraceToFree`/`IncrementGraceRetry`/`AdvanceGraceTickDay`/`CountCenterTeacherSeats`); `InsertDelayedJob`/`CancelPendingGraceTicks`; `ListInvoices`/`CountInvoices`. `ProcessPolarEvent` gained the `subscription.past_due` → `enterGraceTx` (idempotent target-state) + status-based recovery (BLOCKER-1 — independent of the genuine-change gate) cases; `resolvePolarCenter` learns the payment-failure type (SEC-7 persisted-sub-id-wins). `HandleGraceTick` runs the elapsed-day action (days 0/3/5/6 email, 3/5 re-collect counter, day-7 23:59 `ExpireGraceToFree`), per-day idempotent via the marker, emails sent post-commit. `ExpireGraceToFree` is a DISTINCT write (M1) reusing the discrete zero-deletion helpers (`captureResourceBaselinesTx` extracted, storage re-point, credit cap) — R24 PK-set snapshot proves zero deletion + re-upgrade restore. `billing_grace_tick` JobType + worker handler (self-rescheduling) on the existing queue; `main.go` wires `SetEmailSender` + the handler. Invoice read/export endpoints + `EmailInvoicesToAccountant` (SEC-11 `net/mail.ParseAddress` + CRLF-strip + subject cap); owner-gated routes; new owner+admin `GET /api/billing/grace` (R4). `BillingSummary.grace` block (D9). `insertChargeInvoice` propagates Polar status (R2 structural).

**Frontend** — `InvoiceHistoryPage` (s70): List-table, 6 status pills, trilogy, PDF passthrough (https-guard + omit-when-null), declined-Retry, CSV export (reused `downloadCsv`), email-to-accountant dialog. `BillingGraceBanner` (s73): owner actionable (deadline + Update-payment link + recovery timeline) / admin informational (no link) / teacher-student absent + no fetch (R4/TEST-FE-6), wired into `AppShell.banner` via `AppLayout`. Hooks `useInvoices`/`useEmailInvoices`/`useGrace`; `vnDateLong` formatter; i18n `billing.grace.*` + `billing.invoices.*` (en+vi lockstep + BILLING_KEYS parity); dashboard entry link.

**Scope deviations (pragmatic, documented in deferred-work.md):** FU-9-3-READONLY pulled in (guards ship + proven; per-endpoint call-site wiring remains); FU-9-3-INVOICE-FILTER-UI; FU-9-3-INVOICE-STATUS-PRODUCER (declined/refunded row producers + declined→paid transition — append-only table + unverified Polar shape); FU-9-3-PDF-PRODUCER (C3); D-green-1 worker-cadence red + M2 store-RLS red (TA-phase). AC4 is counter-only (M5, Dev-accepted). `/run` live smoke NOT executed — verification is via the comprehensive red+green suites (recommended as a manual follow-up before arming).

### Verification
- Backend: full suite green `-p 1` (14 pkgs, 0 fail); `gofmt`/`go vet` clean on authored files; migrate down→up→down→up clean.
- Web: `tsc -b` 0 errors; full billing suite green (15 files / 107 tests) incl. both ex-reds; full web suite 3700/3701 (the lone failure was a confirmed mid-edit race in the i18n-parity test — green in isolation); ESLint clean on all new files (one PRE-EXISTING 9-2b lint error in the checkout-return effect, untouched).
- WF-8 HARD gate: R21 MockClock time-travel (days 0/3/5/6/7-23:59 + recovery-cancels + idempotency) + R24 PK-set zero-deletion/restore — RED-first then GREEN; `atdd_red_phase` tags stripped (tests now in the default suite).

## File List

### Added
- `classlite-api/migrations/20261005120000_alter_subscriptions_grace_period.{up,down}.sql`
- `classlite-api/internal/service/billing_grace.go` — grace state machine, read-only guards, grace block, email-to-accountant.
- `classlite-api/internal/service/billing_invoices.go` — s70 invoice read model.
- `classlite-api/internal/worker/billing_grace_tick.go` — grace-tick worker handler.
- `classlite-web/src/lib/formatVnDateLong.ts` — long VN date formatter (M7).
- `classlite-web/src/features/billing/api/{useInvoices,useEmailInvoices,useGrace}.ts`
- `classlite-web/src/features/billing/components/{InvoiceHistoryPage,BillingGraceBanner}.tsx`
- `9-3-...-completion-notes.md` (this file)

### Modified
- `classlite-api/internal/store/queries/{billing,polar,jobs}.sql` — grace mutators + invoice reads + delayed-job/cancel; grace cols on subscription SELECT/RETURNING.
- `classlite-api/internal/model/job_types.go` — `JobTypeBillingGraceTick` + params.
- `classlite-api/internal/service/{billing_service,billing_polar,billing_read}.go` — `SetEmailSender`; dispatch cases + recovery + status-propagating invoice; `grace` on BillingSummary + `captureResourceBaselinesTx` extract.
- `classlite-api/internal/service/email_templates.go` — `RenderPaymentFailedEmail` + `RenderInvoiceHistoryEmail`.
- `classlite-api/internal/handler/billing_handler.go` — GetGrace / ListInvoices / EmailInvoices + DTOs.
- `classlite-api/cmd/api/main.go` — SetEmailSender, grace-tick handler, grace/invoice routes (+ owner+admin grace chain).
- `classlite-api/api.yaml` — grace block + BillingGrace + invoice paths/schemas + grace path.
- `classlite-api/internal/store/generated/**`, `classlite-web/src/lib/api/client.ts` — codegen output.
- `classlite-api/internal/test/story_9_3_helpers.go` — helper bug fixes (`type` column, assignment `open` status).
- `classlite-web/src/lib/i18n.ts` — `vnDateLong` formatter.
- `classlite-web/src/locales/{en,vi}.json` — grace + invoice + invoiceHistory keys.
- `classlite-web/src/features/billing/{index.ts,api/billingKeys.ts,BillingDashboardPage.tsx}` — barrel, keys, entry link.
- `classlite-web/src/components/shared/AppLayout.tsx` — mount BillingGraceBanner in the banner slot.
- `classlite-web/src/routes.tsx` — owner-gated `/settings/billing/invoices`.
- `classlite-web/src/features/billing/__tests__/*` — `grace: null` on 8 fixtures; BILLING_KEYS += new keys; AppLayout.test QueryClientProvider wrap.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 9.3 follow-ups.

### Deleted
- None.

---

## Code Review (2026-10-06, Amelia — /bmad-code-review 9-3)

3 adversarial Opus-4.8 layers (Blind Hunter · Edge Case Hunter · Acceptance Auditor) over the full tracked+untracked diff (the 9-2b lesson: `git diff HEAD` drops untracked — rebuilt a complete diff incl. the 21 untracked code files). Core R21 grace state machine + R24 zero-deletion verified solid & well-tested.

**Dismissed (2):** Blind Hunter's day-7 tick "self-delete lock hang" — false premise: `claimJob` commits the `processing` claim BEFORE `processClaimed` runs in a fresh tx (dispatcher.go:443/121), so no job-row lock is held during processing, and `MarkJobComplete`'s `status='processing'` 0-row guard handles the deleted row. `capString` byte-truncation of UTF-8 — latent only (subjects are hardcoded ASCII).

**Applied (16 — 8 decision-needed all ruled Patch now + 8 patch):**
- **D1 (High, revenue bypass):** `isRecoveryEligibleEvent(ev polarEvent)` now inspects the payload, not just the type — `order.paid` recovers only a subscription charge (not an add-on, via `plan.AddonPackByID(...).Credits==0`); `subscription.active` requires non-failed status; `subscription.updated` requires `status=="active"`. **P3:** new `lockClassSubscription` advisory lock taken by both `ProcessPolarEvent` and `handleGraceTickTx` (before `lockClassCredit` → consistent order) serializes a last-minute recovery vs the day-7 downgrade.
- **D2:** `CheckClassMutableTx`/`CheckTeacherSeatMutableTx` wired into the enrollment-enroll and invite-staff endpoints — ALWAYS-ON (outside `billingEnforcementEnabled()`), so the C8a/C8b downgrade pause is real in prod with the add-flag dark.
- **D3:** declined→paid invoice lifecycle — `InsertDeclinedInvoice` (on grace entry) + `MarkLatestDeclinedInvoicePaid` (on recovery); needed migration `20261006120000_alter_invoices_declined_updatable` (adds `updated_at` + a tenant-scoped `invoices_update` RLS policy — invoices were append-only). Refunded stays render-only (FU-9-REFUND).
- **D4:** `insertChargeInvoice` persists `polar_invoice_id` from a new `data.hosted_invoice_url` field → AC15 Download-PDF renders.
- **D5:** visible invoice status-filter `<select>` (distinct option text from the pills to avoid getByText collisions).
- **D6:** `polar.Client.RetrySubscriptionCharge` + MockClient (`RetryChargeCount`/`FailRetryCharge`), called POST-COMMIT best-effort on grace days 3/5.
- **D7:** accountant email uses `ListAllInvoices` (no 100-row cap); FE shows an honest "showing most recent N" note at the cap.
- **D8:** live day/hour countdown in BillingGraceBanner (60s timer; absolute-epoch math, TZ-agnostic).
- **P1/P8:** `ListInvoicesPage` returns the EFFECTIVE page/pageSize; invoice envelope meta now `$ref`s the shared `PaginationMeta`.
- **P2:** `handleGraceTickTx` catch-up loop over `[lastMarker+1 … elapsed]` — a late tick no longer drops a skipped day-3/5 email + re-collect (emails collapse to the most-recent missed day).
- **P4:** `ExpireGraceToFree` clears `pending_plan`/`pending_billing_cycle`/`pending_effective_at`.
- **P5:** grace warning email links to `cfg.AppBillingSettingsURL` (new) not the checkout return URL.
- **P6:** store-level grace-columns RLS adversarial test (both directions) + positive control.
- **P7:** email-to-accountant dialog → Base-UI `Dialog` (focus trap / Escape) + an axe test.

**New regression tests:** P2 catch-up (`TestGraceStateMachine_LateTick_CatchesUpSkippedDay`) · D1 add-on-no-recover · D3 declined→paid lifecycle · P6 store-level grace RLS · P7 dialog axe. The pre-existing `TestGraceStateMachine_NonScheduledDay_NoAction` was updated (tick day 3 first) to reflect the P2 catch-up semantics.

**Verify (all green):** `codegen.sh` clean · migrate up→down→up clean · `go test -p 1 ./...` 16 pkgs pass · `tsc -b` 0 · web billing+AppLayout 116/116 · gofmt/vet clean.

**⚠ Arming caveats (FU-9-POLAR-CONTRACT — verify at the D29a staging smoke, Jan-2026 cutoff):**
- `RetrySubscriptionCharge` POSTs `/v1/subscriptions/{id}/retry-charge` — PROVISIONAL. If Polar auto-retries natively with no manual trigger, make the prod client method a logged no-op (the DB counter + emails still drive dunning).
- `data.hosted_invoice_url` is a PROVISIONAL wire name (candidates: `invoice_url`/`receipt_url`) — reconcile against the real Polar order/subscription payload before relying on Download-PDF.
- The payment-failure event name (`subscription.past_due`) remains the single pinned candidate to confirm.
