# Story 9.2b: Upgrade, Downgrade & AI Credit Add-ons — Frontend

Status: done

---
story_key: 9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend
epic: 9
story_id: 9.2b
baseline_commit: 3fe3d0d
split_from: 9-2 (Ducdo D1, 2026-09-30)
scope: FULL-STACK   # Ducdo rulings 2026-10-04: pulled payment-method persistence (backend) + the prod arming flip INTO this story (see Dev Notes §Ducdo rulings)
depends_on: [9-2a (done), 9-1b (done)]
blocks_arming_flip_on: [FU-9-POLAR-CONTRACT staging smoke (D29a), real Polar payment-method payload shape]
unblocks: [9.3]
risk: 6   # the prod arming flip turns REAL MONEY on (R11/R22 live) — mitigations shipped 9-2a/9-1a, but the flip has hard preconditions (see §Enforcement arming)
wf8_atdd_gate: NOT-TRIGGERED-for-code   # no new score-6 CODE AC; the arming flip is a gated config action, not red-phase. CONFIRM at /bmad-tea AT pre-flight
contract_state: 9-2a api.yaml codegen'd @ 3fe3d0d; this story MUTATES it (paymentMethod no longer PROVISIONAL-null — now persisted + populated) → api.yaml edit + codegen + atomic cross-service commit (WF-1/WF-4)
---

## Story

As an **owner**,
I want **to upgrade my plan (with the prorated charge shown before I pay), schedule a downgrade for the next renewal, buy AI-credit add-on packs, and see my next invoice / scheduled changes on the billing dashboard**,
so that **I can adjust my center's plan and top up credits myself, with full price transparency and no surprise charges — while ClassLite never touches raw payment data.**

This is the **full-stack keystone of Epic 9's money half** and the story that **turns real money on**: it flips 9-1b's placeholder "Talk to us" / "See plans" CTAs into the real Polar-hosted checkout flow, persists + renders the card-on-file, and performs the production arming of `BILLING_ENFORCEMENT_ENABLED` (9-2a D3) once its preconditions are met.

> **Ducdo rulings (2026-10-04) — this story is NO LONGER frontend-only:** (1) **light up `paymentMethod` now** — persist the Polar payment method (backend) so the card-on-file renders real `{brand, last4}`; (2) **9-2b owns the prod arming flip** — flipping `BILLING_ENFORCEMENT_ENABLED` on in prod + provisioning the live `POLAR_API_KEY` is this story's DoD, gated on the preconditions below; (3) **keep the story whole.** Note: `{brand, last4}` is the Polar-provided masked descriptor — ClassLite still never touches raw payment data (epic:127-130 holds).

## Acceptance Criteria (BDD)

> The backend contract (9-2a) is **frozen** and already generated into `classlite-web/src/lib/api/client.ts`. Every AC below renders values **verbatim** from the API — the FE never recomputes money, proration, or limits.

### Upgrade flow (s71) — FR-63

1. **Upgrade modal renders proration from the server.**
   **Given** an owner clicking an "Upgrade to {tier}" affordance (on the plan picker s68, the billing dashboard s69 usage area, or a 409 `PLAN_LIMIT_EXCEEDED` dialog)
   **When** the upgrade modal (s71) opens for a target `plan` + `billingCycle`
   **Then** it calls `GET /api/billing/proration-preview?plan={plan}&billingCycle={cycle}` and shows a before→after comparison (current plan limits → target plan limits) plus the Polar-verbatim charge block rendering `subtotalVnd`, `creditAppliedVnd` (as a credit line), `vatVnd`, and `chargedTodayVnd` — each formatted with `formatVnd`, **integer VND, never recomputed client-side**
   **And** the modal implements the Loading (skeleton) / Error (inline retry) / Success trilogy over the preview query (UX-1).

2. **Upgrade confirm redirects to Polar checkout.**
   **Given** the upgrade modal with a loaded proration preview
   **When** the owner clicks "Confirm · charge {chargedTodayVnd}"
   **Then** the FE calls `POST /api/billing/checkout` with body `{ kind: "upgrade", plan, billingCycle, addonPackId: null }` and, on success, redirects the browser to the returned `data.checkoutUrl` (hosted Polar page)
   **And** no local plan/credit state is mutated by the FE — the subscription change is webhook-confirmed server-side.
   **[CONTRACT PIN]** the checkout `kind` wire value is **`"upgrade"`** (the enum in the generated `BillingCheckoutRequest`), NOT `"plan_upgrade"` (which appears in 9-2a prose but is a legacy service alias absent from the contract).

3. **Return-from-checkout reconciles via polling `GET /api/billing`.**
   **Given** the owner returns to the app after the Polar checkout
   **When** the billing dashboard/landing surface mounts
   **Then** it invalidates `billingKeys.summary()` so the (reconcile-on-GET) backend surfaces the confirmed plan/limits/credits; a short "updating your plan…" affordance bridges the window until the webhook lands (no trusted FE state change).

### Downgrade flow — FR-63

4. **Downgrade confirm modal explains the at-renewal semantics.**
   **Given** an owner selecting a strictly-lower tier (e.g. "Downgrade to Pro"/"Downgrade to Free" on s68)
   **When** the downgrade-confirm modal opens
   **Then** it states "Downgrade takes effect at next renewal on {effectiveAt|vnDate}", that **data is not removed** (access is restricted only if the new tier's limits are exceeded at renewal), and that the current plan stays active until the period ends — all copy via i18n.

5. **Downgrade schedules via the API and reflects pending state.**
   **Given** a confirmed downgrade
   **When** the owner confirms
   **Then** the FE calls `POST /api/billing/downgrade` with `{ plan, billingCycle }`, and on success writes/invalidates so the dashboard shows the scheduled downgrade
   **And** a 422 `VALIDATION_ERROR` (target not a lower tier, or a paid center with no bound subscription) surfaces an inline, i18n error — never a raw code/stack (UX-1 error).

6. **Scheduled downgrade is visible and cancellable on the dashboard.**
   **Given** `GET /api/billing` returns `pendingDowngrade: { plan, effectiveAt }` (non-null)
   **When** the billing dashboard renders
   **Then** it shows "Downgrade to {plan} scheduled for {effectiveAt|vnDate}" with a "Cancel downgrade" action that calls `POST /api/billing/downgrade/cancel` and clears the pending state on success.
   **[NORMALIZE]** the pending shape differs by source — `GET /api/billing` returns `pendingDowngrade:{plan,effectiveAt}` (null when none); the downgrade/cancel endpoints return `{pendingPlan,pendingBillingCycle,effectiveAt}` (**empty-string `""`, not null, when none**). A single FE adapter must normalize both into one `PendingDowngrade | null` shape; treat `pendingPlan === ""` as "none".

### AI-credit add-on packs — FR-64

7. **Add-on packs render with locked VND pricing + VAT breakout.**
   **Given** an owner on Pro or Studio opening the "Buy more credits" surface
   **When** it loads
   **Then** it calls `GET /api/billing/addons` and renders each `{ packId, credits, priceVnd, subtotalVnd, vatVnd }` as a pack card showing credits, the total price, and the explicit VAT breakout (subtotal + VAT 10% = total), all via `formatVnd`
   **And** implements the trilogy (loading/empty/error).

8. **Add-on purchase redirects to Polar checkout.**
   **Given** the add-on pack list
   **When** the owner selects a pack
   **Then** the FE calls `POST /api/billing/checkout` with `{ kind: "addon", addonPackId, plan: null, billingCycle: null }` and redirects to `data.checkoutUrl`; credits are granted webhook-side only (confirmed on the next `GET /api/billing` poll — `usage.aiCredits.addonRemaining` increments).

9. **Free tier is blocked from add-ons with an upgrade prompt.**
   **Given** a Free-tier owner reaching the add-on surface (or a `403 ADDON_NOT_AVAILABLE` from `GET /api/billing/addons` or checkout)
   **When** it renders
   **Then** the packs are not purchasable; an upgrade prompt is shown instead ("Add-on credit packs are available on Pro and Studio — upgrade to buy them"), linking to the plan picker. `403 ADDON_NOT_AVAILABLE` is **eligibility, not payment** — never surfaced as a 402.

10. **Add-on purchase warns when a downgrade-to-Free is scheduled.**
    **Given** `pendingDowngrade.plan === "free"` on the summary
    **When** the owner attempts an add-on purchase
    **Then** the FE shows a hard, dismissible warning that the purchased credits will be paused on Free (tier-gated, D25) before proceeding — FE-side warning only (no backend block).

### Billing dashboard additions (D-DASH, deferred from 9-1b) — consumes extended `BillingSummary`

11. **Next-invoice card.** `GET /api/billing` → `nextInvoice: { amountVnd, dueDate } | null`: when non-null, render a next-invoice card ("Next invoice {amountVnd|formatVnd} on {dueDate|vnDate}"); null (Free / no period) → omit the card (no empty shell).

12. **Payment-method card renders the real card-on-file (BACKEND + FE — Ducdo ruling 1).** Persist the Polar payment method (`brand`, `last4`) server-side so `GET /api/billing` → `paymentMethod: { brand, last4 }` is populated for a paid center with a card on file; the api.yaml PROVISIONAL banner is removed (field no longer forced-null). The FE renders "{brand} •••• {last4}" when non-null, and still degrades gracefully to "Managed securely by Polar" when null (Free / no card yet / pre-first-payment) — never a broken `•••• null`. See Dev Notes §Payment-method persistence for the backend design.

13. **VAT transparency.** Every money surface that carries a VAT split in the contract (upgrade proration, add-on packs) breaks VAT out explicitly (subtotal + VAT 10% = total), integer VND, round-half-up — rendered from server fields, never computed in the FE. _(Amended 2026-10-05 code review, Ducdo ruling: the frozen 9-2a `BillingNextInvoice` carries only `amountVnd` + `dueDate` with no subtotal/VAT fields, so the next-invoice card renders the gross `amountVnd` only — scoped out of the breakout requirement here; a next-invoice VAT split is deferred to the 9.3 invoice work if the contract is extended.)_

### Enforcement-arming dialog wiring (FU-9-1B-DIALOG-WIRING, P1 — gates the prod arming flip, D3)

14. **Wire the three remaining enforcement surfaces into the existing global dialog seam.** 9-1b built the 409/402 dialog host + `reportBillingError` seam but wired only the enrolment mutation. Wire the pattern `if (reportBillingError(err)) return` (before existing error handling) into:
    - **Staff invite** (409 `PLAN_LIMIT_EXCEEDED` / `TEACHER_SEATS`) — `features/people/components/InviteStaffModal.tsx` catch block
    - **Class create** (409 `PLAN_LIMIT_EXCEEDED` / `CLASSES`) — `features/classes/components/ClassFormDialog.tsx` catch block (create path only; edit is not a limit surface)
    - **AI grade enqueue** (402 `INSUFFICIENT_CREDITS`) — **both** `features/grading/components/AiGradePanel.tsx` (writing) and `features/grading/components/AiSpeakingGradePanel.tsx` (speaking) enqueue-error paths, before their `toast.error(...)`.
    **And** each wired surface has a test proving the 409/402 opens the global dialog (not a generic toast) when the seam returns true, and falls through to existing handling otherwise.

15. **FU-9-CONTRACT-402 — prove the real emitted `details` shapes match the 9-1b assumptions.** Verify (codegen-typed MSW fixtures + a contract test) that the real 409/402 `details` shapes the wired call sites receive match what 9-1b built against: 409 `{ limit, current, max, canManageBilling }` (`limit ∈ TEACHER_SEATS|CLASSES|STUDENTS_PER_CLASS|STORAGE|AI_CREDITS`), 402 `{ available, required }`. This obligation **gates the arming flip** — do not consider the story done without it.

### Toggle persistence (FU-9-1B-TOGGLE-PERSIST) — FR-61 conversion lever

16. **Annual/monthly toggle persists across navigation within the session.** Lift `PlanPickerPage`'s local `useState(false)` annual toggle into a UI-only Zustand store (FW-5, with `initialState` + `reset()` per TEST-FE-3) so the selection survives navigation within the session (the conversion lever). The upgrade modal reads the same billing-cycle intent.

### Cross-cutting gates

17. **Owner-only, role-negative proven.** All new surfaces (upgrade modal, downgrade modal, add-on packs, next-invoice/payment/pending cards) are owner-only. Role-negative tests assert they are **absent from the DOM** (not merely hidden) for admin/teacher/student (TEST-FE-6).

18. **Mobile = honest desktop hint, not a degraded screen.** The upgrade modal and add-on purchase are **not in the mobile contract** (UX-4). On mobile widths these surfaces show an "Open on desktop to upgrade / buy credits" hint rather than a squished modal. (Billing usage view stays mobile-usable; invoice PDF + grace strip are 9.3.)

19. **i18n parity + a11y.** Every new string exists in `en.json` and `vi.json` in lockstep and is added to the `BILLING_KEYS` array in `billing-i18n-parity.test.ts`; every new surface passes `axe` with zero violations (use `DIALOG_AXE_OPTIONS` to scope off `aria-command-name` for open Base-UI dialogs, per the documented 9-1b precedent).

### Production arming (Ducdo ruling 2 — 9-2b owns the flip)

20. **Flip `BILLING_ENFORCEMENT_ENABLED` ON in production — gated on all preconditions.**
    **Given** the purchase/upgrade/downgrade UI (AC1-13), the dialog wiring (AC14), and the contract proof (AC15) are merged
    **When** the hard preconditions are all satisfied — (a) **FU-9-POLAR-CONTRACT staging smoke passed** against the real Polar sandbox; (b) the real Polar wire shapes (checkout / proration / webhook / payment-method payloads) **reconciled with current Polar docs** (D29a — they were modeled under the Jan-2026 cutoff); (c) the live `POLAR_API_KEY` provisioned in prod; (d) webhook signing secret(s) configured
    **Then** `BILLING_ENFORCEMENT_ENABLED` is flipped ON in production so live 409/402 gates fire (each now backed by a dialog), and a rollback path (flip OFF) is documented
    **And** if ANY precondition is unmet the flip does NOT happen — the code merges "armed-ready" and the flip is held. **Never flip a flag that turns real money on without the staging smoke (b/a) green.**

## Tasks / Subtasks

- [x] **Task 1 — Data layer: mutation hooks + query-key slots** (AC: 1,2,5,6,8)
  - [x] Extend `features/billing/api/billingKeys.ts` with mutation-key slots (mirror `settingsKeys.ts`): `prorationPreview(plan,cycle)`, `addons()`, and mutation keys for checkout/downgrade/cancel.
  - [x] `api/useProrationPreview.ts` — `useQuery<BillingProrationPreview, ApiError>` keyed on `(plan,cycle)`, `queryFn: apiFetch('/api/billing/proration-preview?...')`, explicit `staleTime` (short — proration is time-sensitive; justify per FW-3).
  - [x] `api/useBillingAddons.ts` — `useQuery<{addons:BillingAddonOffer[]}, ApiError>`; tolerate `403 ADDON_NOT_AVAILABLE` as a non-error "Free blocked" state (do not throw into the error trilogy — branch to the upgrade prompt).
  - [x] `api/useCreateCheckout.ts` — `useMutation`; on success `window.location.assign(data.checkoutUrl)`; `onError` calls `reportBillingError` first.
  - [x] `api/useScheduleDowngrade.ts` + `api/useCancelDowngrade.ts` — `useMutation`; FW-2 optimistic triple on `billingKeys.summary()` where it returns pending state; `onSettled` invalidates `billingKeys.summary()`.
  - [x] All hooks use plain `apiFetch` (non-paginated, TS-4 unwrap); import generated types from `@/lib/api/client`.
- [x] **Task 2 — Pending-downgrade normalizer** (AC: 6)
  - [x] `lib/pendingDowngrade.ts` — normalize both `BillingSummary.pendingDowngrade` (`{plan,effectiveAt}|null`) and the endpoint `{pendingPlan,pendingBillingCycle,effectiveAt}` (empty-string-when-none) into one `PendingDowngrade | null`. Unit-test both shapes + the empty-string "none" case.
- [x] **Task 3 — Upgrade modal (s71)** (AC: 1,2,3,13,17,18)
  - [x] `components/UpgradeModal.tsx` (Base-UI Dialog) — before→after limit comparison + Polar-verbatim charge block + "Confirm · charge {chargedTodayVnd}" footer; trilogy over the preview query; desktop-only (mobile hint).
  - [x] Trigger points: plan-picker "Upgrade to {tier}", dashboard usage CTA, and the owner branch of `PlanLimitExceededDialog` ("See plans" → open upgrade modal for the gating limit's next tier).
- [x] **Task 4 — Downgrade confirm modal + dashboard pending card** (AC: 4,5,6,17)
  - [x] `components/DowngradeConfirmModal.tsx` — at-renewal + no-data-loss copy; calls schedule mutation.
  - [x] `components/PendingDowngradeCard.tsx` on `BillingDashboardPage` — shows scheduled downgrade + cancel action.
- [x] **Task 5 — Add-on purchase surface** (AC: 7,8,9,10,13,17,18)
  - [x] `components/AddonPacksModal.tsx` (or panel) — pack cards with VAT breakout; entry CTA from the s69 AI-credits meter ("Buy more credits"); Free → upgrade prompt; downgrade-to-Free warning (AC10); desktop-only hint on mobile.
- [x] **Task 6 — Dashboard next-invoice + payment-method cards** (AC: 11,12,13)
  - [x] Add the next-invoice card (null → omit) and payment-method card (tolerant of permanent null) to `BillingDashboardPage.tsx`.
- [x] **Task 7 — Enforcement dialog wiring (FU-9-1B-DIALOG-WIRING)** (AC: 14,15)
  - [x] Insert `if (reportBillingError(err)) return` into the 3 (4-file) call sites listed in AC14; add a wiring test per site.
  - [x] Author the FU-9-CONTRACT-402 contract test (codegen-typed fixtures asserting the real `details` shapes).
- [x] **Task 8 — Annual-toggle persistence (FU-9-1B-TOGGLE-PERSIST)** (AC: 16)
  - [x] `store/useBillingCycleStore.ts` (Zustand, `initialState`+`reset()`); refactor `PlanPickerPage` to read/write it; the upgrade modal reads the cycle intent.
- [x] **Task 9 — Replace placeholder CTAs with real upgrade/downgrade verbs** (AC: 1,4)
  - [x] In `PlanCard.tsx` / `PlanPickerPage.tsx`, replace the 9-1b `mailto:` "Talk to us about {tier}" and "See plans" CTAs with "Upgrade to {tier}" / "Downgrade to {tier}" affordances that open the respective modals. (Free-PlanCard cosmetic fix — AC per Out of Scope note — is optional here.)
- [x] **Task 10 — i18n, barrel, tests** (AC: 7,11,12,17,18,19)
  - [x] Add all new keys to `en.json` + `vi.json` (lockstep) and to the `BILLING_KEYS` parity array.
  - [x] Export new hooks/components from `features/billing/index.ts`.
  - [x] Full test battery: trilogy per component, role-negative (absent not hidden), RHF/mutation form trilogy with optimistic rollback via MSW `failOnce`, a11y axe, codegen-typed MSW fixtures.
- [x] **Task 11 — BACKEND: persist + populate the Polar payment method** (AC: 12) — Ducdo ruling 1; see Dev Notes §Payment-method persistence
  - [x] Migration: add `polar_payment_method_brand` + `polar_payment_method_last4` (nullable text) to the `subscriptions` table (new migration pair; never edit existing — WF-2).
  - [x] Capture `{brand, last4}` from the Polar payload (subscription/order webhook event) in the webhook processing path (re-establish tenant context — SEC-6) and store on the subscription; write `.sql` query + `codegen.sh` (sqlc) after `migrate.sh` (WF-3 ordering).
  - [x] `billing_read.go`: populate `BillingSummary.paymentMethod` from the stored columns (null when absent).
  - [x] `api.yaml`: remove the `paymentMethod` PROVISIONAL banner (field now genuinely populated); also drop the `nextInvoice`/`pendingDowngrade` PROVISIONAL banners (co-finalized). Re-run `codegen.sh`. Atomic cross-service commit (WF-1/WF-4).
  - [x] Backend tests: store-layer persistence + RLS cross-tenant read isolation on the new columns (TEST-BE-1/2); handler test asserts populated `paymentMethod` in the envelope.
  - [x] **Depends on** the real payment-method payload shape (FU-9-POLAR-CONTRACT) — if the sandbox payload differs, reconcile before relying on it.
- [x] **Task 12 — Verify end-to-end** (AC: all) — `tsc -b` clean (0 errors) + full web billing suite green; full backend suite green `-p 1` + `gofmt`/`vet` clean + `migrate up→down→up` clean; `/run` to drive upgrade→redirect, downgrade→pending→cancel, add-on→redirect, and the card-on-file render.
- [ ] **Task 13 — PROD ARMING FLIP** (AC: 20) — the LAST task, gated. Do NOT start until Tasks 1-12 are merged AND the preconditions in AC20 are all green.
  - [ ] Confirm FU-9-POLAR-CONTRACT staging smoke passed + D29a wire-shape reconcile done + live `POLAR_API_KEY` + webhook secret(s) provisioned in prod.
  - [ ] Flip `BILLING_ENFORCEMENT_ENABLED` ON in the prod config; document the rollback (flip OFF).
  - [x] If any precondition is unmet: land the code "armed-ready", record the held flip + its blocker in the completion notes, and surface it as the story's single open item — never flip blind.

## Dev Notes

### The frozen contract (read first — everything renders verbatim)

The 9-2a backend is **done**; its api.yaml additions are **already code-generated** into `classlite-web/src/lib/api/client.ts` and committed at baseline `3fe3d0d`. **No `codegen.sh` run is needed to CONSUME them** (Tasks 1-10 build against the existing generated types). _(Task 11 does touch `api.yaml` — removing the PROVISIONAL banners + the payment-method population — and therefore re-runs `codegen.sh`; that is the one codegen in this story, committed atomically per WF-1/WF-4.)_ Import via `import type { components } from '@/lib/api/client'` → `components['schemas'][...]`. Types available: `BillingSummary`, `BillingNextInvoice`, `BillingPaymentMethod`, `BillingPendingDowngrade`, `BillingAddonOffer`, `BillingCheckoutRequest`, `BillingProrationPreview`, `BillingDowngradeRequest`, and `Envelope*` wrappers.

**Endpoints (all owner-gated; FE never calls Polar directly — epic:127-130):**

| Method · Path | Request | Success `data` | Errors (FE-handled) |
|---|---|---|---|
| `GET /api/billing` | — | `BillingSummary` (now incl. `nextInvoice`,`paymentMethod`,`pendingDowngrade`) | 403 non-owner (route-gated) |
| `GET /api/billing/addons` | — | `{ addons: BillingAddonOffer[] }` | **403 `ADDON_NOT_AVAILABLE`** (Free) |
| `GET /api/billing/proration-preview?plan=&billingCycle=` | query (both required) | `BillingProrationPreview` | 422 `VALIDATION_ERROR` |
| `POST /api/billing/checkout` | `BillingCheckoutRequest` | `{ checkoutUrl }` | **403 `ADDON_NOT_AVAILABLE`**, 422 `VALIDATION_ERROR` |
| `POST /api/billing/downgrade` | `BillingDowngradeRequest` | `{pendingPlan,pendingBillingCycle,effectiveAt}` | **422 `VALIDATION_ERROR`** (not-lower-tier / unbound sub) |
| `POST /api/billing/downgrade/cancel` | — | cleared pending | — |

**`BillingProrationPreview` (Polar-verbatim, integer VND — render as-is):** `targetPlan`, `targetBillingCycle`, `subtotalVnd`, `vatVnd`, `totalVnd`, `creditAppliedVnd`, `chargedTodayVnd`.
**`BillingAddonOffer`:** `packId` (`credits_100|credits_500|credits_2000`), `credits`, `priceVnd`, `subtotalVnd`, `vatVnd`.
**`BillingCheckoutRequest`:** `kind` (**`"upgrade"|"addon"`**), `plan` (`pro|studio|null`), `billingCycle` (`monthly|annual|null`), `addonPackId` (`string|null`).

**Locked add-on catalog (server-authoritative, for reference only — render server values):**

| packId | credits | Pro | Studio |
|---|---|---|---|
| `credits_100` | 100 | 99.000₫ | n/a |
| `credits_500` | 500 | 399.000₫ | 299.000₫ (loyalty) |
| `credits_2000` | 2.000 | n/a | 999.000₫ |

### Three contract gotchas the FE MUST handle (confirmed across all recon)

1. **checkout `kind` = `"upgrade"`**, not `"plan_upgrade"`. The generated `BillingCheckoutRequest` enum is `["upgrade","addon"]`; `"plan_upgrade"` is a legacy service-side alias not in the contract. Sending it would typecheck-fail (`tsc -b`) and is off-contract. (AC2 pin.)
2. **`pendingDowngrade` has two shapes** — the summary's nested `{plan,effectiveAt}` (null-when-none) vs the endpoint's flat `{pendingPlan,pendingBillingCycle,effectiveAt}` (**empty-string-when-none**). Normalize in `lib/pendingDowngrade.ts` (Task 2). (AC6.)
3. **`paymentMethod` is permanently null today** (9-2a ships PROVISIONAL-null; Polar payment-method persistence not built). Design the card for permanent null. (AC12 + §Co-finalization.)

### Flow model — webhook-confirmed, never a trusted FE state change (9-2a D2/D4)

`FE → our checkout endpoint → redirect to hosted Polar page → Polar collects → Polar webhook confirms (source of truth) → FE return polls GET /api/billing` (the GET triggers the D18 lost-webhook reconcile). The epic's "immediately" means "on webhook confirmation"; the poll + an "updating your plan…" affordance bridge the visual gap. The FE **never** writes plan/credit state optimistically for checkout — only the downgrade/cancel endpoints return pending state worth an optimistic write (FW-2 triple). **D26:** an upgrade cancels any pending downgrade (single slot) — reflect that the dashboard pending card clears after an upgrade poll.

### Existing scaffold to EXTEND (do not recreate — 9-1b, commit 6f78c57)

`classlite-web/src/features/billing/`:
- `api/billingKeys.ts` — `{ all, summary(), plans() }` factory (the documented 9.2 invalidation seam). **Add mutation slots here.**
- `api/useBillingSummary.ts` (`staleTime 45_000`), `api/useBillingPlans.ts` — the read hooks. **No mutation hooks exist yet — you create them.**
- `PlanPickerPage.tsx` (s68, `/settings/billing/plans`) — local `useState(false)` annual toggle (the TOGGLE-PERSIST site), `role="switch"` button, `PlanCard` grid.
- `BillingDashboardPage.tsx` (s69, `/settings/billing`) — current-plan card + 4 `PlanUsageMeter`s (credits meter gated on `summary.creditsApplicable`; Free → "See plans" link). **No invoice/payment/pending cards yet — you add them.**
- `components/PlanCard.tsx` (CTAs are `mailto:` "Talk to us" / "See plans" — Task 9 replaces), `InsufficientCreditsDialog.tsx` (402), `PlanLimitExceededDialog.tsx` (409), `BillingErrorDialogHost.tsx`.
- `store/useBillingErrorDialogStore.ts` — the reference Zustand shape (`initialState` + `reset()`).
- `lib/formatVnd.ts` (`formatVnd(amount:number):string` → `399.000₫`), `lib/planDisplay.ts` (`planDisplayName`, `buildTalkToUsMailto`, `SUPPORT_EMAIL`), `lib/typeGuards.ts` (`isPlanLimitDetails`/`isInsufficientCreditsDetails` + the `*Details` interfaces), `lib/reportBillingError.ts`.
- `index.ts` — barrel (export your new hooks/components).
- Shared: `src/components/domain/PlanUsageMeter.tsx`, `PlanLimitBanner.tsx`; `src/lib/formatDataSize.ts` (decimal GB/MB), `src/lib/formatVnDate.ts` (`{{val, vnDate}}` i18next formatter, registered in `src/lib/i18n.ts`).

### The global error-dialog seam (for Task 7 / FU-9-1B-DIALOG-WIRING)

`reportBillingError(error: unknown): boolean` (`lib/reportBillingError.ts`) returns `true` iff `error instanceof ApiError && error.code ∈ {PLAN_LIMIT_EXCEEDED, INSUFFICIENT_CREDITS}`, and in that case calls `useBillingErrorDialogStore.getState().show(error)`. The host (`BillingErrorDialogHost`) is mounted **once** at `components/shared/AppLayout.tsx:171`. **Call-site contract:** `if (reportBillingError(err)) return` at the top of the `catch`/`onError`, then fall through to existing handling. Today only `features/people/components/EnrolmentComposer.tsx:259` uses it. The 3 surfaces to wire (exact files):
- `features/people/components/InviteStaffModal.tsx` (~65-76) catch → before `mapInviteError(err)`.
- `features/classes/components/ClassFormDialog.tsx` (~154-160) catch → before `setServerError(...)` (create path).
- `features/grading/components/AiGradePanel.tsx` (~152) and `features/grading/components/AiSpeakingGradePanel.tsx` (~137) enqueue-error → before the `toast.error(...)`.

`ADDON_NOT_AVAILABLE` (403) and `VALIDATION_ERROR` (422) are **not** hard-block codes — handle them inline in the add-on/checkout flows, not via the global host.

### Enforcement arming (D3) — 9-2b OWNS the prod flip (Ducdo ruling 2)

`BILLING_ENFORCEMENT_ENABLED` is dark-launched OFF in prod. 9-2b ships the dialog wiring (AC14) + contract proof (AC15) so every live 409/402 has a UI, AND performs the prod flip (AC20, Task 13) — **but only behind hard preconditions**: the FU-9-POLAR-CONTRACT staging smoke must pass against the real Polar sandbox, the real Polar wire shapes must be reconciled with current Polar docs (D29a — modeled under the Jan-2026 cutoff), and the live `POLAR_API_KEY` + webhook secret(s) must be provisioned in prod. Until then the live key stays unset (→ mock, no real charge). **The flip is the last action and is gated: if a precondition is unmet, land the code armed-ready and HOLD the flip** (record the blocker). This is the single highest-consequence action in the epic — turning real money on. Treat it with the gate, not as a checkbox.

### Payment-method persistence (AC12, Task 11 — Ducdo ruling 1, BACKEND)

9-2a shipped `BillingSummary.paymentMethod` PROVISIONAL-null (never persisted). 9-2b lights it up:
- **Storage:** new nullable columns `polar_payment_method_brand` + `polar_payment_method_last4` on `subscriptions` (new migration pair — WF-2). `{brand, last4}` is Polar's masked descriptor (e.g. `visa` / `4242`), NOT raw card data — SEC-safe, epic:127-130 holds.
- **Capture:** read `{brand, last4}` from the Polar payload in the webhook processing path (the subscription/order event carries it) — re-establish tenant context on dequeue (SEC-6). The exact payload field names depend on the real Polar schema → **confirm against FU-9-POLAR-CONTRACT** before trusting them; if the sandbox payload differs, reconcile first.
- **Surface:** `billing_read.go` populates `paymentMethod` from the stored columns (null when absent); remove the api.yaml PROVISIONAL banner + regen (WF-1/WF-4 atomic).
- Also co-finalize the other two PROVISIONAL fields doc-only: `nextInvoice` (`amountVnd` is a local-plan display estimate — fine) and `pendingDowngrade` (shape split accepted; FE normalizes per Task 2 — not unified backend-side). Drop their banners in the same api.yaml edit.

### Risk & WF-8 gate

`risk: 6` — not because of new score-6 *code*, but because **AC20 flips real money on in prod**. All score-6 Epic-9 money risks — **R11** (webhook signature), **R22** (limit-enforcement race), **R23** (credit-loss), **R24** (downgrade-no-delete) — plus the two 9-2a candidates (proration correctness, double-charge dedup) are **discharged server-side in 9-2a**. The new FE work never calls Polar and makes no trusted state change (renders previews, redirects to hosted checkout, polls). The new BACKEND work (payment-method persistence) is a display-only read-path addition — no money movement. **WF-8 HARD ATDD red-phase gate is NOT triggered for the code** (mirrors 9-1b); the arming flip is a **gated config action with explicit preconditions (AC20)**, not a red-phase scaffold. The surface to watch — "displayed proration == Polar-returned value" — is a render-against-mock P1 test (the authoritative assertion lives in 9-2a's backend test). **Confirm at `/bmad-tea AT` pre-flight; and treat the AC20 preconditions as a release gate, not a test gate.**

### UX — s71 upgrade modal (ux-design-specification.md §8.6:517; mock docs/classlite-entry/07-billing.html #s71:6271-6415)

640px modal over the dashboard dimmed to `opacity:0.35` + a `rgba(26,31,46,0.5)` scrim with `backdrop-filter:blur(2px)`. Header: mono eyebrow "Upgrade plan", Fraunces 24px "{current} → {target}", "effective immediately". **"What changes"** 3-col grid (current card → "→" → target card, target in amber gradient `#fff7ec→#fdf6e3` with bolded new limits + green additive features). **"Today's charge — prorated"** card: line items = `subtotalVnd` → `−creditAppliedVnd` (green) → `+vatVnd` → divider → **`chargedTodayVnd`** (accent, 16px mono) → footnote "Next renewal {date} at {total}/yr". Footer: "Cancel" + "Confirm · charge {chargedTodayVnd}". **The mock shows USD placeholders and a (X days × daily rate) formula — IGNORE both: render integer VND from the preview endpoint, and the proration is Polar-verbatim `creditAppliedVnd` (9-2a D6/D29), not a client day-count.** Downgrade-confirm and add-on surfaces have no dedicated mock — design from the epic ACs, reusing the modal shell + `PlanCard`/pack-card idioms. Mobile: upgrade + add-on are NOT in the mobile contract → honest "Open on desktop" hint (UX-4 precedent `:680`).

### Conventions (hard constraints for this story)

- **Types:** import generated types (TS-2 — never hand-write API types); Zod/RHF only if a real form appears (the modals are confirm-flows, mostly not RHF — a confirm button + a redirect). **No `plan_upgrade` string.**
- **Money:** integer VND via `formatVnd`; never float, never recompute (CQ-3, money-boundary doc).
- **Dates:** ISO strings until the `{{val, vnDate}}` i18n formatter (TS-6).
- **Fetch:** plain `apiFetch` (TS-4 unwrap, TS-8 Bearer, TS-5 401-in-fetch-layer). ESLint bans raw `fetch` in features.
- **Query:** FW-2 optimistic triple on downgrade/cancel; FW-3 explicit `staleTime`; invalidate `billingKeys.summary()` after mutations (FW-6 — never from a store).
- **Zustand:** UI-only, `initialState`+`reset()` (FW-5, TEST-FE-3).
- **Routing:** modals over the existing `/settings/billing` + `/settings/billing/plans` routes (the codebase convention — "secondary flows are Dialogs not routes"); **no new routes**. Only the checkout redirect (`window.location.assign(checkoutUrl)`) leaves the SPA.
- **Components:** feature-local under `features/billing/components/`; Base-UI `Dialog` primitive (axe focus-guard → `DIALOG_AXE_OPTIONS`).
- **i18n:** every string in `en.json`+`vi.json` lockstep + `BILLING_KEYS` parity array (UX-2, TEST-FE-4).
- **Tests:** MSW the only mock seam (TEST-FE-1); codegen-typed fixtures; trilogy (TEST-FE-2); role-negative absent-not-hidden (TEST-FE-6); each file rolls its own `I18nextProvider+QueryClientProvider+MemoryRouter` wrap with `createTestQueryClient()` + `seedOwner()`; `afterEach` cleanup + store `reset()`; `new ApiError(status, code, message, requestId, details)`.
- **Verify gate:** web typecheck is **`tsc -b`** (checks test files), not `--noEmit` (false-greens).

### Project Structure Notes

New FE files land under `classlite-web/src/features/billing/{api,components,store,lib}/` + `__tests__/`; barrel `index.ts` re-exports. Wiring edits touch `features/people/`, `features/classes/`, `features/grading/` (AC14) — those are consumers calling the already-exported `reportBillingError`, so no feature-boundary violation (TS-7 — import from `@/features/billing` barrel only). Dashboard/picker edits touch `BillingDashboardPage.tsx`, `PlanPickerPage.tsx`, `PlanCard.tsx`. **Backend (Task 11):** `classlite-api/migrations/` (new pair), a `queries/*.sql` edit + sqlc regen, `internal/service/billing_read.go` + the webhook-processing path, `classlite-api/api.yaml` + `codegen.sh` (regen both `store/generated/` and `client.ts`) — an **atomic cross-service commit** (WF-4): spec → codegen → backend → frontend, breaking-change-free (additive population of an existing field). **Config (Task 13):** the prod `BILLING_ENFORCEMENT_ENABLED` flag + `POLAR_API_KEY` env — infra, flipped only when AC20 preconditions are green.

### References

- Epic: [Source: _bmad-output/planning-artifacts/epics/epic-09.md#Story-9.2 (lines 76-130)]; FR map [epics.md:351-352]
- PRD: FR-63/FR-64 [Source: _bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md:816-828]; Polar no-raw-payment [:845]
- UX: s71 [Source: _bmad-output/planning-artifacts/ux-design-specification.md#§8.6:517]; mock [Source: docs/classlite-entry/07-billing.html#s71:6271-6415]; states §6.4:376-392; mobile :607-625
- Backend contract (frozen): [Source: _bmad-output/implementation-artifacts/9-2a-upgrade-downgrade-and-ai-credit-add-ons-backend.md] + [...-completion-notes.md]; api.yaml:7062-7538; generated `classlite-web/src/lib/api/client.ts`
- FUs: [Source: _bmad-output/implementation-artifacts/deferred-work.md] FU-9-1B-DIALOG-WIRING (:67), FU-9-CONTRACT-402 (:70), FU-9-1B-TOGGLE-PERSIST (:1208), FU-9-1B-BANNER-WIRING (:1209), paymentMethod co-finalize (:1219), FU-9-POLAR-CONTRACT (:5)
- Risk: [Source: _bmad-output/test-artifacts/test-design/test-design-architecture.md:131-141 (R11/R22/R23/R24 all score 6, backend-owned)]; FE scenarios [test-design-qa.md:283-292]; [classlite_new-handoff.md:115-120]
- Conventions: [Source: docs/project-context.md] (TS-*, FW-*, UX-*, TEST-FE-*, SEC-*); [Source: docs/bmad-story-conventions.md#Money-boundary]
- 9-1b precedent (scaffold + no-WF8): [Source: _bmad-output/implementation-artifacts/9-1b-plan-tiers-and-limit-enforcement-frontend.md] + completion-notes

## Definition of Done

- [ ] All 20 ACs met; all 13 tasks checked (or AC20/Task 13 explicitly HELD with its blocker recorded — see below).
- [ ] Upgrade (preview → confirm → redirect), downgrade (schedule → pending card → cancel), and add-on (packs → purchase → redirect; Free-blocked) flows work against MSW; checkout uses `kind:"upgrade"`/`"addon"` and redirects to `checkoutUrl`.
- [ ] `pendingDowngrade` normalized across both source shapes; `paymentMethod` renders the real `{brand, last4}` for a paid card-on-file AND degrades to "Managed by Polar" when null.
- [ ] BACKEND: payment-method columns + migration (up→down→up clean); webhook capture (tenant-context re-established); `billing_read` populates the field; api.yaml PROVISIONAL banners removed + codegen atomic; RLS cross-tenant tests on the new columns.
- [ ] FU-9-1B-DIALOG-WIRING: all 3 (4-file) surfaces wired; FU-9-CONTRACT-402 contract test passes.
- [ ] FU-9-1B-TOGGLE-PERSIST: annual toggle persists via Zustand.
- [ ] Trilogy + role-negative (absent-not-hidden) + a11y (zero axe) + i18n parity on every new surface; new keys in `BILLING_KEYS`.
- [ ] `tsc -b` clean (0 errors); full web billing suite green; full backend suite green `-p 1` + `gofmt`/`vet` clean; ESLint clean (no raw fetch, no cross-feature deep imports).
- [ ] `/run` the app to drive the flows (verify skill) — not just unit tests.
- [ ] **AC20 arming flip:** either flipped ON in prod with ALL preconditions green (staging smoke + D29a reconcile + live key + webhook secrets) and a documented rollback, OR landed armed-ready with the held flip + blocker recorded as the story's single open item. **Never flipped blind.**
- [ ] WF-8 confirmed at `/bmad-tea AT` pre-flight; AC20 preconditions treated as a release gate.
- [ ] Sibling `9-2b-...-completion-notes.md` holds Dev Agent Record + File List (per bmad-story-conventions).

## Out of Scope

- **Invoice history read/export UI (s70), grace-period state machine, payment_failed/past_due handlers** → Story 9.3.
- **FU-9-1B-BANNER-WIRING (live mount)** → blocked on the roster surface (`StudentsTab` is still a `ComingSoonPanel` with no enrolled-count read); the live banner mount + role branch + shared-key unification stay deferred to the roster epic. (The amber "approaching" copy escalation per D-9-1b-2 is only meaningful once the banner is mounted — defer with the mount.)
- **FU-9-POLAR-CONTRACT staging smoke + D29a wire-shape reconcile** — NOT built as code here, but is a **hard precondition** of the AC20 arming flip (Task 13) and of trusting the payment-method payload (Task 11). This story consumes/gates on it; it does not author the sandbox harness.
- _(Now IN scope per Ducdo rulings 2026-10-04: payment-method persistence — was deferred; the prod arming flip — was ops.)_
- **Free-PlanCard "Free/not included" cosmetic** + empty-plan-catalog empty state + `formatVnDate` raw-string-on-unparseable — optional cosmetic carry-ins; fix if cheap, else leave the FU.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-10-04 | Story created via /bmad-create-story 9-2b (Amelia). 4-agent parallel recon (9-2a frozen contract · 9-1b FE scaffold+inherited FUs · epics/UX/PRD/risk · api.yaml/client/router). 3 contract gotchas pinned (kind="upgrade" · pendingDowngrade dual-shape normalize · paymentMethod null). Inherits FU-9-1B-DIALOG-WIRING+CONTRACT-402+TOGGLE-PERSIST. baseline 3fe3d0d. | Amelia |
| 2026-10-04 | **AT pre-flight done (/bmad-tea AT 9-2b, Murat).** WF-8 HARD ATDD gate **NOT-TRIGGERED** confirmed (Ducdo) — no new score-6 code AC (all R11/R22/R23/R24 + proration/double-charge discharged in 9-2a; new FE/BE work makes no trusted state change; AC20 arming = release-gate not test). No red-phase scaffold; cover inline + post-dev /bmad-tea TA. The 2 money-sensitive ACs (AC15 FU-9-CONTRACT-402, AC1/2 proration-verbatim) authored as P1 tests inline. Checklist: atdd-checklist-9-2b-...-frontend.md. | Murat |
| 2026-10-04 | **3 Ducdo rulings → story reshaped FULL-STACK.** (1) Light up paymentMethod now → Task 11 becomes backend persistence (migration + webhook capture + api.yaml co-finalize + codegen); AC12 renders real card. (2) 9-2b owns the prod arming flip → new AC20 + Task 13 (gated on FU-9-POLAR-CONTRACT staging smoke + D29a wire reconcile + live POLAR_API_KEY + webhook secrets; HOLD-not-flip-blind). (3) Keep whole. Now 20 ACs / 13 tasks; risk 4→6 (flip turns real money on). WF-8 still NOT-TRIGGERED-for-code (arming = gated release action, not red-phase). | Amelia |
| 2026-10-05 | **Implemented → review (Amelia /bmad-dev-story).** Tasks 1-12 done; AC1-19 met. FE: upgrade modal s71 (proration-verbatim) · downgrade confirm + pending card + cancel · add-on packs (Free-block/downgrade-warn) · dashboard next-invoice/payment/pending cards · annual-toggle Zustand · real upgrade/downgrade CTAs (PlanCard + dashboard + 409-dialog owner branch) · 4-file 402/409 dialog wiring + FU-9-CONTRACT-402 contract test. Backend (Task 11): subscriptions `payment_brand`/`payment_last4` cols + migration (up→down→up clean) · `SetSubscriptionPaymentMethod` captured on both webhook branches (D29a field-shape caveat flagged) · billing_read populates `paymentMethod` · api.yaml PROVISIONAL banners stripped + codegen atomic (WF-1/WF-4). Verified: tsc -b 0 · full web suite 3676/280 green · full backend suite green -p 1 · gofmt/vet clean · ESLint clean. **Task 13 (AC20) HELD** — all 4 Polar-sandbox preconditions unmet (no staging smoke / D29a reconcile / live key / webhook secret); code lands armed-ready, rollback documented. `/run` live money flow gated with AC20. Details → completion-notes sibling. | Amelia |
| 2026-10-05 | **Code review → done (Amelia /bmad-code-review 9-2b).** 3 independent adversarial Opus-4.8 layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Blind Hunter caught the diff was incomplete — `git diff HEAD` had silently dropped 19 untracked new files (the money-critical core); re-run against the complete change set. 14 findings → **3 decision-needed (all Ducdo-ruled) + 10 patch (ALL APPLIED) + 2 defer + 1 dismissed** (+2 folded false-positives). Decisions: (1) downgrade modal now names the billing cycle it schedules; (2) AC3 return-from-checkout bridge is REQUIRED → built (FE `?checkout=success` detection + summary invalidate + "updating…" affordance + backend `success_url`/`APP_BILLING_SUCCESS_URL` wiring — exact param to be validated at D29a staging smoke); (3) AC13 amended (next-invoice renders gross only vs frozen contract). Patches: checkout-failure inline error (UpgradeModal+AddonPacksModal — the HIGH silent-swallow) · unsafe/empty checkoutUrl guard · un-stacked limit→upgrade dialogs · symmetric `normalizeSummaryPending` guard · AC10 buy-gated-on-summary · cancel-downgrade inline error · owner-only summary not fired for non-owners · zero-sign suppression. 12 regression tests added. Verified: tsc -b 0 · billing suite 94/94 green · backend service/handler/billing-integration tests green -p 1 · gofmt/vet clean. 2 defers → deferred-work.md (provisional payment-method wire shape + persistence hardening, both gated behind D29a arming). | Amelia |

## Dev Agent Record

_Per docs/bmad-story-conventions.md, the Dev Agent Record (Debug Log, Completion Notes, Implementation Plan) and File List move to the sibling `9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend-completion-notes.md`, created at first dev pickup._

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Review Findings

_Code review 2026-10-05 (Amelia /bmad-code-review 9-2b — 3 independent adversarial Opus-4.8 layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). Diff re-run against the COMPLETE change set after the first pass caught that `git diff HEAD` had silently dropped 19 untracked new files (the money-critical core). 14 findings survive triage: 3 decision-needed, 8 patch, 2 defer, 1 dismissed (+2 folded false-positives)._

### Decision-needed — RESOLVED (Ducdo, 2026-10-05)

- [x] [Review][Decision→Patch] Monthly/annual *view* toggle drives the *scheduled downgrade* cycle — `PlanPickerPage.tsx:82→150`. **Ruling: keep both wirings, but make `DowngradeConfirmModal` surface the target cycle explicitly so the choice is deliberate.** → folded into patch list below.
- [x] [Review][Decision→Patch] AC3 return-from-checkout reconcile affordance NOT implemented. **Ruling: the affordance is REQUIRED** — implement the "updating your plan…" bridge + mount-time `invalidateQueries(billingKeys.summary())`, pending confirmation of the Polar return-URL param contract (not in this diff). → folded into patch list below.
- [x] [Review][Decision→AC amendment] AC13 next-invoice VAT breakout unsatisfiable against the frozen 9-2a contract. **Ruling: amend AC13 to scope the next-invoice card out of the VAT-breakout requirement** (done — AC13 text updated; next-invoice renders gross `amountVnd` only; a next-invoice VAT split deferred to 9.3 if the contract is extended). No code change; not a defect.

### Patch

- [x] [Review][Patch] Checkout POST failure silently swallowed — no inline error on the money path [`UpgradeModal.tsx:216-237`, `AddonPacksModal.tsx:63-80`, `useCreateCheckout.ts:46-50`] — `onError` only calls `reportBillingError`, which returns `false` for checkout's own codes (403 `ADDON_NOT_AVAILABLE`, 422, 500, network). Neither modal renders `checkout.isError`; the confirm/buy button disables then silently re-enables. User gets zero feedback after clicking "Confirm · charge X" and will re-click. Fix: render a `checkout.isError` alert (mirroring the proration/addons retry block) in both modals; on a checkout 403 in AddonPacksModal, re-show the eligibility prompt (AC9).
- [x] [Review][Patch] Checkout redirect navigates to an unvalidated server URL [`useCreateCheckout.ts:41-45`] — `window.location.assign(data.checkoutUrl)` with no guard. Empty `""` → reloads the current page while reporting success (dead-end on the money path); a `javascript:`/off-host URL would be followed blindly (open-redirect defense-in-depth on a payment action). Fix: guard non-empty + `new URL(...).protocol === 'https:'` before `assign`, else throw/surface an error.
- [x] [Review][Patch] Two stacked Radix dialogs open simultaneously from the limit dialog [`PlanLimitExceededDialog.tsx:102,148-155`] — `UpgradeModal` mounts as a sibling and opens via `setUpgradeOpen(true)` while the limit `Dialog` stays `open={open}`: two focus traps, limit dialog visible behind. Fix: suppress the outer dialog while the upgrade modal is open (`open={open && !upgradeOpen}`).
- [x] [Review][Patch] `normalizeSummaryPending` lacks the `isPlanId`/empty-string guard its sibling has [`pendingDowngrade.ts:36-41`] — trusts `pending.plan`/`effectiveAt` verbatim; `normalizeEndpointPending` (`:51`) validates `isPlanId`. An off-enum/`""` summary shape → `PendingDowngradeCard` renders "Downgrade to undefined scheduled for …". The whole file exists because the two wire shapes disagree on "none" — defense must be symmetric. Fix: `if (!isPlanId(pending.plan)) return null`.
- [x] [Review][Patch] AC10 downgrade-to-Free warning bypassed when the summary query is unresolved [`AddonPacksModal.tsx:58-78`] — `downgradingToFree` derives from `summaryQuery.data?.pendingDowngrade`; while pending/errored `data` is undefined → `false` → `onBuy` goes straight to `purchase` with no warning. Fix: gate the Buy actions on `summaryQuery.isSuccess` (or default to showing the warning until resolved).
- [x] [Review][Patch] Cancel-downgrade failure is silent [`PendingDowngradeCard.tsx:40-48`, `useScheduleDowngrade.ts` cancel `onError`] — `cancel.mutate()` has no `cancel.isError` UI; optimistic rollback makes the card silently reappear (looks like the click did nothing). `DowngradeConfirmModal` DOES render `schedule.isError` — inconsistent. Fix: inline `cancel.isError` alert/toast in the card.
- [x] [Review][Patch] Owner-only `GET /api/billing` fired for non-owner roles [`PlanLimitExceededDialog.tsx:63`] — `useBillingSummary()` called unconditionally; this dialog is app-wide via the global `ApiError` seam, so every non-owner 409 plan-limit hit (e.g. teacher class-create) fires a guaranteed-403 owner-only request + console noise. Degrades gracefully but wasteful. Fix: gate the summary query `enabled` on `canManageBilling` (available synchronously from `error.details`).
- [x] [Review][Patch] Credit/VAT signs prepended by the FE on a verbatim-money surface [`UpgradeModal.tsx:191,195`] — `−{formatVnd(creditAppliedVnd)}` / `+{formatVnd(vatVnd)}` is a presentational recompute on a surface whose own docblock insists amounts are rendered verbatim; renders `−0 ₫` when credit is 0 and `−−123.000` if the server ever returns a negative magnitude. Fix: suppress the sign when the value is 0 (and/or let the sign come from the server value).
- [x] [Review][Patch] (from Decision 1) Downgrade confirm must surface the target billing cycle explicitly [`PlanPickerPage.tsx:150`, `DowngradeConfirmModal.tsx`] — the picker toggle still drives `billingCycle`, but `DowngradeConfirmModal` must name the cycle it is about to schedule (e.g. "Downgrade to Pro (annual), effective …") so inheriting the price-view toggle is a deliberate, visible choice rather than a silent one.
- [x] [Review][Patch] (from Decision 2, AC3) Implement the return-from-checkout bridge [`BillingDashboardPage.tsx`, `useCreateCheckout.ts`, `en.json`/`vi.json`, `billingKeys.ts`] — on return from Polar, detect the success return (confirm the Polar return-URL param contract FIRST — not in this diff), `invalidateQueries(billingKeys.summary())` on mount, and show a transient "updating your plan…" affordance bridging the webhook-confirmation window. Add the i18n key to both locales + `BILLING_KEYS`.

### Deferred

- [x] [Review][Defer] Backend payment-method wire shape is a provisional guess [`billing_polar.go` polarEvent.payment_method, `~:190`] — deferred, explicitly gated. The flat `data.payment_method.{brand,last4}` shape is self-acknowledged PROVISIONAL and will likely decode empty against the real Polar `subscription.updated` payload; the all-or-nothing `brand != "" && last4 != ""` gate could drop a partial genuine card. AC20 arming is HELD (D29a reconcile + FU-9-POLAR-CONTRACT staging smoke are hard preconditions), so this cannot ship live until the real shape is reconciled. Tests only exercise the author's fixture.
- [x] [Review][Defer] Payment-method persistence minor hardening [`polar.sql SetSubscriptionPaymentMethod ~:291`, migration `20260930120800`] — deferred, tie to the same arming reconcile. The UPDATE bumps `updated_at` on every card-bearing event even when unchanged (non-idempotent replays; no consumer keys off `subscriptions.updated_at` today); `payment_last4` is unbounded `text` with no `CHECK (~ '^[0-9]{4}$')`/`char(4)` constraint. Add an `IS DISTINCT FROM` guard + length constraint when the real payload shape lands.

### Dismissed (not written as action items)

- AC12 payment-method card OMITTED for Free rather than degraded to "Managed by Polar" [`BillingDashboardPage.tsx:473`] — defensible (a Free center never had a card), explicitly asserted by a test. Matches intent over the AC's literal "when null (Free…)" wording.
- `UpgradeModal` renewalFootnote Invalid-Date on null `currentPeriodEnd` (first-pass Blind concern) — already guarded by `summaryQuery.data?.currentPeriodEnd ?` (`:204`).
- `normalizeEndpointPending` returns `{plan, effectiveAt: ''}` on absent date — `formatVnDate` guards empty ISO (returns input, no "Invalid Date"), and the endpoint normalizer is not wired into a live render path (mutations optimistic-write + invalidate; the summary shape renders).
