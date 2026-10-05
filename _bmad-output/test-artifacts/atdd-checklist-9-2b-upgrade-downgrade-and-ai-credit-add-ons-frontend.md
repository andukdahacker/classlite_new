---
stepsCompleted: ['step-01-preflight-and-context']
lastStep: 'step-01-preflight-and-context'
lastSaved: '2026-10-04'
storyId: '9.2b'
storyKey: '9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend'
storyFile: '_bmad-output/implementation-artifacts/9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend.md'
generatedTestFiles: []
detectedStack: 'fullstack'
inputDocuments:
  - '_bmad-output/implementation-artifacts/9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - 'docs/project-context.md'
wf8_gate_decision: 'NOT-TRIGGERED (red-phase code scaffold not mandatory)'
final_ruling: 'Ducdo 2026-10-04 — CONFIRM NOT-TRIGGERED; no red-phase scaffold generated; cover inline during dev + post-dev /bmad-tea TA'
---

> **FINAL RULING (Ducdo, 2026-10-04):** Confirm NOT-TRIGGERED. No red-phase ATDD scaffold is generated for 9-2b. Coverage = inline dev tests (trilogy, role-negative absent-not-hidden, a11y axe, i18n parity per `features/billing/__tests__/` conventions; backend store/RLS tests for the payment-method columns) → then **post-dev `/bmad-tea TA`** for P2/P3 expansion, MSW fault injection, and DoD. AC20 arming flip governed by its release precondition gate, not tests. The two money-sensitive ACs (AC15 FU-9-CONTRACT-402, AC1/AC2 proration-verbatim) are authored as P1 tests inline during dev.


# ATDD Pre-flight & WF-8 Gate — Story 9-2b

## 1. Stack & framework (prerequisites)

- **Detected stack:** `fullstack` — `classlite-web/package.json` (vitest 4.1.7 + @playwright/test 1.50 + MSW) and `classlite-api/go.mod` (go test, established `internal/test/` ATDD pattern with `//go:build atdd_red_phase` tagging).
- **Story:** ready-for-dev, 20 ACs / 13 tasks, clear BDD acceptance criteria. ✅
- **Precedent:** `atdd-checklist-9-2a-...-backend.md` (the backend red-phase that discharged the score-6 money risks).

## 2. WF-8 gate analysis — does any 9-2b AC map to a risk score ≥6?

Risk register (`test-design-architecture.md:131-141`): all Epic-9 money risks are **score 6**, all **backend-owned**, and all **discharged in 9-2a** (ATDD reds + integration tests):

| Risk | Concern | Discharged |
|---|---|---|
| R11 | Polar webhook signature forgery | 9-2a receiver (HMAC verify + dedup reds) |
| R22 | Limit-enforcement bypass via race | 9-2a write-time precheck + advisory-lock reds |
| R23 | AI credit deducted, job failed → credit lost | 9-2a/Epic-6 ledger reds |
| R24 | Downgrade deletes data (NFR-6 forbids) | 9-2a downgrade zero-delete integration test |
| (candidate) | proration-amount correctness | 9-2a `GET /proration-preview` is Polar-verbatim (D6) |
| (candidate) | add-on/upgrade double-charge via dup webhook | 9-2a event-id dedup + ledger idempotency reds |

**AC-by-AC mapping (9-2b):**
- **AC1-3 (upgrade preview/confirm/redirect):** renders proration **verbatim**, redirects to hosted checkout. No trusted FE state change. Money-correctness is server-side (9-2a). → P1 render-against-mock.
- **AC4-6 (downgrade schedule/pending/cancel):** calls API, renders pending. R24 is a 9-2a integration test. → P1.
- **AC7-10 (add-on packs/purchase/Free-block/warn):** renders catalog, redirects; tier-gate (D25) + idempotency (R22/R23) server-side. → P1.
- **AC11-13 (invoice/payment/VAT cards):** display-only. → P1/P2.
- **AC14 (dialog wiring):** wires the **already-built** 402/409 global seam into 3 (4-file) call sites. Target code exists. → P1.
- **AC15 (FU-9-CONTRACT-402):** contract test — real emitted 409/402 `details` shapes match the dialogs' assumptions. **The one risk-worthy guard** (it gates arming), but it tests existing code against a codegen-typed fixture — a P1 contract test, not a red-phase scaffold against unbuilt code.
- **AC16 (toggle persist):** UI state. → P2.
- **AC17-19 (role-negative / mobile hint / i18n+a11y):** standard cross-cutting P1 gates.
- **AC20 (prod arming flip):** a **gated config/release action**, not testable code. Correct instrument = the AC20 precondition release gate (FU-9-POLAR-CONTRACT staging smoke + D29a wire reconcile + live key/secrets), NOT a red-phase test.
- **Backend payment-method persistence (Task 11 / AC12):** webhook-capture write (rides the already-verified 9-2a receiver → R11 covered) + display read. RLS cross-tenant = standard `TEST-BE-1` store test, no money movement. → not score-6.

## 3. GATE DECISION

**WF-8 HARD ATDD red-phase gate: NOT-TRIGGERED for 9-2b.**

No 9-2b AC introduces a **new** score-6 code risk. Every score-6 risk was discharged upstream in 9-2a with its own red-phase. 9-2b is a **P1-scenario story** → per WF-8, ATDD red-phase is **engineer discretion, not mandatory** (mirrors the 9-1b precedent, which shipped with no WF-8 red phase). The single highest-consequence item — AC20 turning real money on — is governed by a **release precondition gate**, which is the right control, not a unit/acceptance red test.

## 4. Recommendation (risk vs value)

- **Default path:** confirm NOT-TRIGGERED → **no full red-phase scaffold**. Cover 9-2b via inline dev tests (trilogy, role-negative absent-not-hidden, a11y axe, i18n parity — matching the existing `features/billing/__tests__/` conventions) + backend store/RLS tests, then **post-dev `/bmad-tea TA`** for P2/P3 expansion, MSW fault injection, and DoD.
- **Optional belt-and-suspenders (thin, 2 ACs only):** if you want red-first on the money-sensitive contract surfaces before dev, generate a focused scaffold for exactly:
  1. **AC15 / FU-9-CONTRACT-402** (HIGH value) — a red contract test asserting the real 409/402 `details` shapes (`{limit,current,max,canManageBilling}` / `{available,required}`) match the dialog consumers; makes the arming precondition concrete.
  2. **AC1/AC2 proration-verbatim** (MEDIUM) — a red render test asserting the s71 modal shows `chargedTodayVnd`/`creditAppliedVnd`/`vatVnd` exactly as returned, typed against the generated `BillingProrationPreview` (guards "render verbatim, never recompute" + the codegen contract).

**Not recommended:** a full 20-AC red-phase scaffold — low value for the display/redirect/wiring ACs whose target code already exists or whose risk is server-side.
