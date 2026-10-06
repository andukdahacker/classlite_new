---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests']
lastStep: 'step-04-generate-tests'
lastSaved: '2026-10-05'
storyId: '9.3'
storyKey: '9-3-payment-failure-grace-period-and-invoices'
storyFile: '_bmad-output/implementation-artifacts/9-3-payment-failure-grace-period-and-invoices.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-9-3-payment-failure-grace-period-and-invoices.md'
detectedStack: 'fullstack'
generationMode: 'ai-generation'
riskScore: 6
wf8Gate: true
generatedTestFiles:
  - classlite-api/internal/test/story_9_3_helpers.go
  - classlite-api/internal/test/grace_state_machine_atdd_test.go
  - classlite-api/internal/test/grace_zero_deletion_atdd_test.go
  - classlite-api/internal/test/grace_idempotency_atdd_test.go
  - classlite-api/internal/test/grace_cross_tenant_rls_atdd_test.go
  - classlite-api/internal/test/grace_downgrade_readonly_atdd_test.go
  - classlite-api/internal/test/invoice_email_sec11_atdd_test.go
  - classlite-api/internal/handler/billing_invoice_authz_atdd_test.go
  - classlite-web/src/features/billing/components/__tests__/BillingGraceBanner.test.tsx
  - classlite-web/src/features/billing/components/__tests__/InvoiceHistoryPage.test.tsx
reviewPunchlist: _bmad-output/implementation-artifacts/9-3-party-mode-review-punchlist.md
reviewVerdict: GO-WITH-FIXES (party mode 2026-10-05 — reds hardened; 4 Ducdo rulings pending)
greenSeams: [SetEmailSender, HandleGraceTick, EmailInvoicesToAccountant]
inputDocuments:
  - _bmad-output/implementation-artifacts/9-3-payment-failure-grace-period-and-invoices.md
  - _bmad-output/test-artifacts/test-design/test-design-architecture.md
  - docs/project-context.md
  - .claude/skills/bmad-testarch-atdd/resources/knowledge/test-quality.md
  - .claude/skills/bmad-testarch-atdd/resources/knowledge/test-priorities-matrix.md
  - classlite-api/internal/test/story_9_2a_helpers.go (reuse: pkSetSnapshot / assertPKSetPreserved / webhook builders)
  - classlite-api/internal/test/story_9_1a_helpers.go (reuse: billingEpoch / newBillingCenter / seedFreeClass)
  - classlite-api/internal/test/downgrade_no_delete_atdd_test.go (R24 precedent — scheduled-downgrade path)
  - classlite-api/internal/clock/clock.go (MockClock — the mandated time-travel seam)
---

# ATDD Red-Phase Checklist — Story 9.3 (Payment Failure, Grace Period & Invoices)

**Risk: 6 · WF-8 HARD gate TRIGGERED.** 9.3 owns two score-6 BUS risks — **R21** (grace state
machine: wrong-day transitions/emails; mitigation = full MockClock time-travel suite days
0/3/5/6/7) and **R24** (downgrade must NOT delete data — NFR-6; mitigation = PK-set no-delete +
restore test). These reds MUST be on the branch before `backlog → in-progress`
(project-context WF-8). It inherits R11 (webhook signature — already green in 9-2a).

**Stack:** fullstack. **Mode:** AI generation (backend gate reds; FE import-fail reds — no browser recording).

---

## 1. Verify RED (run these first)

**Backend — the WF-8 gate (MANDATORY red-first):**

```bash
cd classlite-api
go vet -tags atdd_red_phase ./internal/test/     # COMPILE-FAILS on svc.SetEmailSender + svc.HandleGraceTick
go vet ./internal/test/                            # GREEN suite UNAFFECTED (reds excluded; helpers seam-light)
```

Verified at authoring (2026-10-05): the tagged build compile-fails on **exactly two** green-phase
seams — `svc.SetEmailSender` and `svc.HandleGraceTick` — and nothing else; the untagged (green)
suite compiles clean. That is the intended RED signal.

**Frontend — secondary reds (import-fail / `tsc -b`):**

```bash
cd classlite-web
npx tsc -b        # red on: missing BillingGraceBanner export, missing useInvoices module, BillingSummary.grace field
```

> Note: the LSP/editor currently shows stale false-negative diagnostics across committed billing
> files (e.g. "cannot find BillingDashboardPage"). The generated `src/lib/api/client.ts` **does**
> contain the billing schemas and `git status src/lib/api/` is clean — the committed baseline is
> sound. Trust command-line `tsc -b`, not the editor index. Run `scripts/codegen.sh` after the
> `api.yaml` additions so `BillingSummary.grace` / `BillingInvoice` land before relying on `tsc -b`
> as the green gate.

---

## 2. Generated red files

### Backend (WF-8 gate)

| File | Covers | Tag |
|---|---|---|
| `internal/test/story_9_3_helpers.go` | builders (`polarPaymentFailed`, `polarRecoveryActive`), readers (`readGraceState`, `countPendingGraceTicks`, `countAICreditsRows`), R24 content seeders (`seedGraceContent` + `seedGrace{Exercise,Assignment,Submission,File}`), `graceSnapshotTables` | **untagged** (seam-light foundation) |
| `internal/test/grace_state_machine_atdd_test.go` | **R21** — AC3/4/5/6: MockClock days 0/3/5/6/7 emails + retries + day-7 downgrade; non-scheduled-day no-op | `atdd_red_phase` |
| `internal/test/grace_zero_deletion_atdd_test.go` | **R24** — AC6/7/10: PK-set zero-deletion through grace-expiry downgrade + re-upgrade restore | `atdd_red_phase` |
| `internal/test/grace_idempotency_atdd_test.go` | AC2/5/9: payment_failed re-delivery no-restart, re-run-tick no-op, recovery-cancels-ticks | `atdd_red_phase` |

### Frontend (secondary)

| File | Covers | Red signal |
|---|---|---|
| `src/features/billing/components/__tests__/BillingGraceBanner.test.tsx` | AC11/12/13 — owner-only red strip; TEST-FE-6 absent-from-DOM for non-owners; clears on recovery; i18n lockstep | missing `BillingGraceBanner` export + `BillingSummary.grace` |
| `src/features/billing/components/__tests__/InvoiceHistoryPage.test.tsx` | AC14/15/16 — s70 trilogy, status pills, PDF https-guard/omit-when-null, CSV + email-to-accountant | missing `InvoiceHistoryPage` export + `useInvoices` module |

---

## 3. Green-phase seams (the reds ARE the contract)

Implement these to turn the reds green — **do NOT rebuild the 9-2a receiver / dedup / verifier /
invoices write path** (scope boundary, story Dev Notes):

1. **`BillingService.SetEmailSender(service.EmailSender)`** — grace emails need a sender
   (`BillingService` has none today). Mirror the `SetCheckoutSuccessURL` setter; wire from `main.go`.
2. **`BillingService.HandleGraceTick(ctx, tc) error`** — the per-center tick the
   `billing_grace_tick` worker calls on dequeue (GFW-7/SEC-6 re-establish tenant). Computes the
   elapsed-day action at `clk.Now()`: day 0/3/5/6 warning email; day 3/5 Polar re-collect request +
   `grace_retry_count++`; day 7 `ExpireGraceToFree` via the 9-2a zero-deletion apply +
   `CaptureResourceBaselines`; idempotent per day; reschedules the next tick via `next_attempt_at`;
   recovery/day-7 cancel pending ticks.
3. **`ProcessPolarEvent` new dispatch cases** (no new signature): payment-failure event → enter
   grace (set `past_due`, `grace_period_start`, `payment_failed_at`, enqueue first tick; idempotent
   target-state — a second failure while `past_due` must NOT restart the clock); `order.paid` /
   `subscription.active` while `past_due` → recovery (`ClearGrace` + cancel ticks + restore `active`).
4. **Migration `20261005120000+`** — `subscriptions.grace_period_start` / `payment_failed_at` /
   `grace_retry_count` (NO status-CHECK change — `past_due`/`cancelled` already admitted);
   `billing_grace_tick` JobType + worker handler; `SetPastDueWithGrace` / `ClearGrace` /
   `ExpireGraceToFree` / `IncrementGraceRetry` queries.
5. **`api.yaml` (WF-1, FIRST)** — `BillingSummary.grace` block (D9), `GET /api/billing/invoices`
   (+ `BillingInvoice`, `EnvelopeBillingInvoices` pagination meta), `POST /api/billing/invoices/email`;
   then `scripts/codegen.sh` (LAST). Frontend: `BillingGraceBanner`, `InvoiceHistoryPage`,
   `useInvoices`/`useEmailInvoices`, `billingKeys.invoices(filters)`, barrel exports, `billing.grace.*` +
   `billing.invoices.*` in `en.json`/`vi.json` lockstep + `BILLING_KEYS` parity.

### Provider-shape caveats pinned in the reds (D2/D6 — verify at dev, cite in Dev Agent Record)

- **Event name** (`polarPaymentFailedType = "subscription.past_due"`): the real Polar wire name is a
  provider fact — candidates `subscription.past_due` / `order.payment_failed` / `invoice.payment_failed`.
  Swap the const at green if the verified name differs; the dispatcher must map whichever Polar sends.
- **Retry mechanism**: whether Polar exposes a manual re-collect vs auto-retries is a provider fact.
  The reds anchor "retry requested" on `grace_retry_count` (DB-observable, provider-agnostic) — NOT on
  a MockClient call shape — so they survive either answer.

---

## 4. AC → test traceability (P0/P1 for the WF-8 gate)

| AC | Priority | Test |
|---|---|---|
| A1 grace entry | P0 | `grace_state_machine` entry assertions (status/cols/first-tick) |
| A2 idempotent re-delivery | P0 | `TestGrace_PaymentFailedRedelivery_DoesNotRestartClock` |
| B3/B4/B5 days 0/3/5/6 + retries | P0 | `TestGraceStateMachine_Days0357_EmailsRetriesThenDay7Downgrade`, `TestGraceStateMachine_NonScheduledDay_NoAction` |
| C6 day-7 downgrade | P0 | state-machine day-7 block + `grace_zero_deletion` |
| C7 zero-deletion | P0 | `TestGraceExpiry_Day7Downgrade_ZeroRowsDeleted` |
| C7/C10 restore | P0 | `TestGraceExpiry_ThenReupgrade_RestoresFullAccess` |
| D9 recovery | P0 | `TestGrace_RecoveryBeforeDay7_CancelsTicksAndClears` |
| B5 re-run tick no-op | P1 | `TestGrace_RerunTickSameDay_NoOp` |
| E11/E12/E13 owner-only strip | P1 | `BillingGraceBanner.test.tsx` |
| F14/F15/F16 invoice history | P1 | `InvoiceHistoryPage.test.tsx` |

Deferred by story (no red here — documented gaps): **AC8** FU-9-3-READONLY (heavy per-endpoint
read-only mutate-guard), **FU-9-3-EINVOICE-VN**, refund clawback render-only (FU-9-REFUND).

---

## 5. Mock-seam compliance (honored by every red)

- Backend: real DB in tx (TEST-BE-1/2), RLS never disabled, deterministic tenants via
  `newBillingCenter`; **MockClock for ALL time-travel** (TEST-BE-5 — zero `time.Sleep`);
  `MockEmailSender` the email seam; `internal/polar.MockClient` the only Polar seam (real BANNED).
- Frontend: MSW the only seam (TEST-FE-1); three-state trilogy (TEST-FE-2); role-negative
  absent-not-hidden (TEST-FE-6); i18n key-existence both locales (TEST-FE-4).

---

## 6. Definition-of-Done handoff (green phase)

- [ ] Turn reds green by landing the 5 seams above; strip `//go:build atdd_red_phase` per file as its seam lands.
- [ ] Full backend suite green `-p 1`; `gofmt`/`vet` clean; `migrate.sh` up→down→up clean.
- [ ] `tsc -b` 0 (after `codegen.sh`); full web billing suite green; ESLint clean; axe zero-violations; i18n parity + `BILLING_KEYS`.
- [ ] Post-dev: `/bmad-tea TA 9-3` (P2/P3 expansion, MSW fault injection) then `/bmad-tea RV 9-3` (flake/quality audit).
