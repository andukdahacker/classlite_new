# Story 9-2b: Completion Notes

_Implementation record for [`9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend.md`](./9-2b-upgrade-downgrade-and-ai-credit-add-ons-frontend.md). Status: review (FE Tasks 1-10 + backend Task 11 done & verified; Task 13 prod arming flip HELD on the Polar-sandbox preconditions — the story's single open item)._

## Dev Agent Record

### Agent Model Used
claude-opus-4-8 (Amelia / bmad-dev-story)

### Debug Log

- **Baseline `tsc -b` was RED at `3fe3d0d`** (4 errors): the 9-1b billing test fixtures (`billing-a11y`, `BillingDashboardPage`, `PlanPickerPage` tests) predated 9-2a adding `nextInvoice`/`paymentMethod`/`pendingDowngrade` to the shared `BillingSummary`. Fixed by adding the three explicit-null fields to each fixture — expected in-scope cleanup (9-2b consumes those fields).
- **LSP inline diagnostics are stale/false here** — they report generated `components['schemas']['Billing*']` types as "does not exist". The real `tsc -b` resolves them fine (confirmed: 0 errors). Gated on `tsc -b` per the `reference_web_typecheck_gate_is_tsc_b` convention; ignored the LSP noise throughout.
- **Global dialog now fetches**: wiring the 409 `PlanLimitExceededDialog` owner branch to open the s71 upgrade modal (Task 3 / AC2 third entry point) made it call `useBillingSummary()`, so every place the global `BillingErrorDialogHost` is mounted in a test now needs a `QueryClientProvider` + a billing-summary stub. Updated `BillingErrorDialogHost.test`, `planLimitDialogs.test` accordingly. Production is unaffected (host sits under the root provider at `AppLayout:171`); and the host returns `null` when no error is queued, so `useBillingSummary` never fires on a normal render.

### Completion Notes (FE — Tasks 1-10 + 7)

- **Data layer (Task 1/2):** `billingKeys` extended (addons, prorationPreview, 3 mutation keys); hooks `useProrationPreview` (short staleTime), `useBillingAddons` (folds 403 `ADDON_NOT_AVAILABLE` → `eligible:false`, not the error trilogy), `useCreateCheckout` (redirects to `checkoutUrl`, `kind:"upgrade"|"addon"`), `useScheduleDowngrade`/`useCancelDowngrade` (FW-2 optimistic triple on `summary()`). `lib/pendingDowngrade.ts` normalizes BOTH wire shapes (summary nested null-when-none vs endpoint flat empty-string-when-none).
- **Upgrade modal s71 (Task 3):** before→after limits + Polar-verbatim charge block (`subtotal → −credit → +VAT → chargedToday`, all `formatVnd`, never recomputed), trilogy, desktop-only mobile hint. Entry points: PlanPickerPage card CTAs, dashboard "Upgrade" CTA, AND the owner branch of `PlanLimitExceededDialog` (opens the modal for the next tier up). The 9-1b "no Upgrade verb" constraint on that dialog is intentionally reversed here (purchase is live).
- **Downgrade (Task 4):** `DowngradeConfirmModal` (at-renewal + no-data-loss copy, inline 422), `PendingDowngradeCard` on the dashboard (shows + cancel).
- **Add-ons (Task 5):** `AddonPacksModal` — VAT-broken-out pack cards, Polar redirect, Free→upgrade-prompt (eligibility not 402), downgrade-to-Free hard warning before purchase, desktop-only.
- **Dashboard cards (Task 6):** next-invoice (null→omit), payment-method (real `{brand,last4}` or "Managed securely by Polar" when null; omitted for Free — never `•••• null`).
- **Dialog wiring (Task 7 / FU-9-1B-DIALOG-WIRING):** `if (reportBillingError(err)) return` inserted into `InviteStaffModal` (409 TEACHER_SEATS), `ClassFormDialog` create catch (409 CLASSES), `AiGradePanel` + `AiSpeakingGradePanel` enqueue-error (402 INSUFFICIENT_CREDITS). Each has a wiring test proving the global dialog opens (not the toast). FU-9-CONTRACT-402 contract test (`billing-contract-402.test.tsx`) freezes the real 409/402 `details` shapes vs the type-guards + dialogs — **this is the arming-gate proof (AC15)**.
- **Toggle persist (Task 8):** `useBillingCycleStore` (Zustand `initialState`+`reset()`); `PlanPickerPage` reads/writes it; survives unmount/remount (tested).
- **CTAs (Task 9):** `PlanCard` `mailto:` "Talk to us" replaced with rank-aware "Upgrade to {tier}" / "Downgrade to {tier}" opening the modals. Removed now-dead `buildTalkToUsMailto`/`SUPPORT_EMAIL` + the `billing.picker.talkToUs` key (CQ-1).
- **i18n/tests (Task 10):** ~50 new keys in en+vi lockstep, all in `BILLING_KEYS`; trilogy + role-negative (absent-not-hidden, via the owner-route gate) + a11y axe on the 3 new dialogs + i18n parity.

**Verification:** `tsc -b` 0 errors; full web suite **3676 tests / 280 files green**; ESLint clean on all changed areas (no raw fetch, no cross-feature deep imports — grading/classes/people import `reportBillingError` from the `@/features/billing` barrel per TS-7).

### Scope note / deviation
- None material. AC2's "409 dialog" entry point was fully implemented (not deferred) — the owner-branch CTA opens the s71 modal directly for the next tier up (Studio centers with no higher tier fall back to the picker link).

### Implementation Plan (summary)
1. Fixed RED baseline fixtures → 2. data layer hooks + normalizer (+tests) → 3. upgrade modal (+P1 money-verbatim test) → 4. downgrade modal + pending card → 5. add-on modal → 6. dashboard cards → 8. toggle store → 9. PlanCard/Picker CTAs → 7. 4-file dialog wiring + contract test → 10. i18n/barrel/cross-cutting tests → PlanLimitExceededDialog direct-open → full-suite verify. **Backend Task 11 + Task 12 /run + Task 13 arming flip pending.**

## File List

### Added (FE)
- `classlite-web/src/features/billing/api/useProrationPreview.ts`
- `classlite-web/src/features/billing/api/useBillingAddons.ts`
- `classlite-web/src/features/billing/api/useCreateCheckout.ts`
- `classlite-web/src/features/billing/api/useScheduleDowngrade.ts` (schedule + cancel)
- `classlite-web/src/features/billing/lib/pendingDowngrade.ts`
- `classlite-web/src/features/billing/store/useBillingCycleStore.ts`
- `classlite-web/src/features/billing/components/UpgradeModal.tsx`
- `classlite-web/src/features/billing/components/DowngradeConfirmModal.tsx`
- `classlite-web/src/features/billing/components/PendingDowngradeCard.tsx`
- `classlite-web/src/features/billing/components/AddonPacksModal.tsx`
- Tests: `__tests__/pendingDowngrade.test.ts`, `billing-mutations.test.tsx`, `UpgradeModal.test.tsx`, `DowngradeConfirmModal.test.tsx`, `AddonPacksModal.test.tsx`, `billing-contract-402.test.tsx`

### Modified (FE)
- `classlite-web/src/features/billing/api/billingKeys.ts` — new query/mutation slots
- `classlite-web/src/features/billing/BillingDashboardPage.tsx` — pending/next-invoice/payment cards + upgrade & buy-credits CTAs + modals
- `classlite-web/src/features/billing/PlanPickerPage.tsx` — store-backed toggle + upgrade/downgrade modals
- `classlite-web/src/features/billing/components/PlanCard.tsx` — real upgrade/downgrade CTAs
- `classlite-web/src/features/billing/components/PlanLimitExceededDialog.tsx` — owner CTA opens the s71 upgrade modal
- `classlite-web/src/features/billing/lib/planDisplay.ts` — removed dead `buildTalkToUsMailto`/`SUPPORT_EMAIL`
- `classlite-web/src/features/billing/index.ts` — barrel exports
- `classlite-web/src/features/people/components/InviteStaffModal.tsx` — 409 wiring
- `classlite-web/src/features/classes/components/ClassFormDialog.tsx` — 409 wiring (create)
- `classlite-web/src/features/grading/components/AiGradePanel.tsx` — 402 wiring
- `classlite-web/src/features/grading/components/AiSpeakingGradePanel.tsx` — 402 wiring
- `classlite-web/src/locales/en.json`, `vi.json` — ~50 keys added; `billing.picker.talkToUs` removed
- Tests updated: `billing-i18n-parity`, `billing-a11y`, `BillingDashboardPage`, `PlanPickerPage`, `BillingRoutesGate`, `BillingErrorDialogHost`, `planLimitDialogs`, `AiGradePanel`, `AiSpeakingGradePanel`, `ClassFormDialog`, `InviteStaffModal` tests

### Backend (Task 11 — done)

**Payment-method persistence (AC12).** The Polar card-on-file now persists and `GET /api/billing.paymentMethod` renders the real `{brand, last4}`.

- Migration `20260930120800_add_subscriptions_payment_method.{up,down}.sql` adds nullable `payment_brand` + `payment_last4` to `subscriptions` (up→down→up clean against the live DB). **Naming deviation:** the task suggested `polar_payment_method_brand/last4`; I used the shorter `payment_brand/payment_last4` (cleaner, same semantics — Polar-masked descriptor, SEC-safe).
- `polarEvent.Data.PaymentMethod {brand, last4}` added (JSON `payment_method`). **D29a caveat:** these wire field names are PROVISIONAL (modeled under the Jan-2026 cutoff) — a bold comment flags they MUST be reconciled against the real Polar subscription payload before arming (FU-9-POLAR-CONTRACT); absent fields → empty strings → the stored card is left untouched.
- `setPlanFromPolarTx` captures the card via a NEW dedicated `SetSubscriptionPaymentMethod` query, placed **before** the genuine/no-op split — so a payment-method-edit `subscription.updated` (the non-genuine no-op branch) still persists the card. The reconcile path (`ResolvedSubscription` carries no card) passes empty strings; the card lands on the next subscription event.
- `billing_read.go` builds `PaymentMethod` from the stored columns (null when either absent); `api.yaml` PROVISIONAL banners stripped from `paymentMethod`/`nextInvoice`/`pendingDowngrade` + the two section comments; `codegen.sh` regenerated `store/generated/` **and** `classlite-web/src/lib/api/client.ts` (atomic, WF-1/WF-4; no PROVISIONAL text remains in client.ts).
- Tests: `billing_payment_method_test.go` (capture on genuine change · capture on NON-genuine update · null when no card · absent-payload-doesn't-blank · RLS cross-tenant on the new columns) + handler `billing_read_test.go` (explicit-null key GO-5 · populated `{visa,4242}`). **Debug note:** first full-suite run surfaced a non-idempotent-test bug — fixed eventIDs collided with `polar_webhook_events` (global, non-rolled-back) from an earlier pass → dedup skipped the dispatch; switched to `uuid`-unique eventIDs. The production code was always correct.

**Verification (Task 12).** `tsc -b` 0 errors; full web suite **3676/280 green**; full backend suite **green `-p 1`, 0 failures**; `gofmt`/`vet` clean on all touched files; `migrate up→down→up` clean. The interactive `/run` of the live upgrade→Polar-checkout→return flow is **bounded by the unprovisioned Polar sandbox** (the live key is intentionally unset → mock; a real hosted checkout cannot be driven without it) — it is folded into the AC20 release gate below rather than runnable now. Every renderable step (modals, proration-verbatim, pending card + cancel, add-on redirect-attempt, card-on-file render, dialog wiring) is exercised by the MSW suite.

### Task 13 — PROD ARMING FLIP: **HELD** (the story's single open item)

AC20 mandates HOLD-not-flip-blind. **None** of the hard preconditions are met in this environment, so `BILLING_ENFORCEMENT_ENABLED` is NOT flipped; the code lands armed-ready (dialog wiring AC14 + contract proof AC15 merged):

- ❌ **FU-9-POLAR-CONTRACT staging smoke** — not built (explicitly out of scope; the sandbox harness is a precondition, not authored here).
- ❌ **D29a wire-shape reconcile** — the Polar checkout/proration/webhook/**payment-method** payload field names are still modeled under the Jan-2026 cutoff (the `payment_method.{brand,last4}` shape in `polarEvent` is unconfirmed).
- ❌ **live `POLAR_API_KEY`** — not provisioned in prod (unset → mock, no real charge).
- ❌ **webhook signing secret(s)** — not provisioned in prod.

**Rollback (when armed):** flip `BILLING_ENFORCEMENT_ENABLED` OFF (reverts to dark-launch; the live key can also be unset → mock). No data migration involved.

## File List — Backend (Task 11)

### Added
- `classlite-api/migrations/20260930120800_add_subscriptions_payment_method.up.sql` / `.down.sql`
- `classlite-api/internal/test/billing_payment_method_test.go`

### Modified
- `classlite-api/internal/store/queries/billing.sql` — `GetSubscription` + `InsertSubscriptionDefault` SELECT/RETURNING add `payment_brand`, `payment_last4`
- `classlite-api/internal/store/queries/polar.sql` — new `SetSubscriptionPaymentMethod`
- `classlite-api/internal/service/billing_polar.go` — `polarEvent.payment_method`; `setPlanFromPolarTx` captures card on both branches (+2 callers threaded)
- `classlite-api/internal/service/billing_read.go` — populate `PaymentMethod` from the stored columns
- `classlite-api/api.yaml` — PROVISIONAL banners removed from `paymentMethod`/`nextInvoice`/`pendingDowngrade` + 2 section comments; getBilling description updated
- `classlite-api/internal/store/generated/**` + `classlite-web/src/lib/api/client.ts` — regenerated (codegen, atomic)
- `classlite-api/internal/test/story_9_2a_helpers.go` — `polarSubscriptionUpdatedWithCard` builder + `readSubscriptionPaymentMethod`
- `classlite-api/internal/handler/billing_read_test.go` — explicit-null + populated paymentMethod assertions
