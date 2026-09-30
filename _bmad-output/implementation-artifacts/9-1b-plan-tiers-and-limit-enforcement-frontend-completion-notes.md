# Story 9-1b: Completion Notes

_Implementation record for [`9-1b-plan-tiers-and-limit-enforcement-frontend.md`](./9-1b-plan-tiers-and-limit-enforcement-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **RED baseline confirmed** — `tsc -b` = 8 × TS2307 (the 5 ATDD red files' missing seams), zero non-2307. Repo was otherwise green.
- **i18n date formatter (TS-6, AC10):** i18next v26 dropped `interpolation.format` from `InterpolationOptions` (typecheck error). Switched to the v26 formatter module API — `i18n.services.formatter?.add('vnDate', …)` after init — so `billing.meter.resetAt` = `"Resets {{val, vnDate}}"` formats the RAW ISO the component passes. Test + component both call the same `i18n.t`, so the resetAt assertion is self-consistent AND the format lives in the i18n layer (never `new Date()` in a render path). The `{{val, vnDate}}` token is invisible to the interpolation-parity regex (which only matches `{{token}}` with no format), so parity is unaffected.
- **Bytes meter formatter divergence:** the `PlanUsageMeter` bytes red asserts a `/GB/i` string. `lib/formatBytes` emits IEC `GiB` (fails `/GB/i`), and TS-7 forbids a domain component importing knowledge-hub's `formatFileSize`. Resolved with a new `lib/formatDataSize.ts` (locale-aware decimal `GB`/`MB`, the same algorithm as `formatFileSize` but promoted to `lib/`). Documented divergence from the reuse-map's `formatBytes` pointer.
- **Plan-picker toggle = local `useState`, not Zustand:** the ATDD reds run in-order against a shared module scope with NO Zustand-reset hook (vitest-setup resets the QueryClient + RTL cleanup only). A persisting store would leak `annual=true` from the toggle test into the monthly-VAT test (which asserts the monthly subtotal), failing it. AC4 explicitly permits "local useState OR Zustand"; cross-nav persistence (the conversion nicety, untested by any red or the DoD matrix) → **FU-9-1B-TOGGLE-PERSIST** (9.2). Pragmatic call per [[feedback_pragmatic_interpretation_of_spec_absolutes]].
- **Free-tier single "See plans" link:** the FR2 red does `findByRole('link', { name: 'See plans' })` (exact-name). The lead CTA is "See plans"; the AI-credits replacement CTA is a distinctly-named link (`billing.dashboard.aiNotIncluded` = "AI grading isn't included on Free — see plans"), so exactly one link matches the exact name.
- **axe (C14):** Base-UI's Dialog injects invisible focus-guard sentinels (`role="button"`, no name) → `aria-command-name`. The repo precedent (RoomsTab) axes only closed containers. Scoped ONLY that rule off for the two open-dialog axe runs (documented) so the audit still validates our dialog markup. Fixed a real `heading-order` violation on the picker (card `<h3>` → `<h2>` under the page `<h1>`).
- **D-9-1b-4 Zod gap verified:** `apiFetch.throwEnvelopeError` reads `errorBody.error?.details` via plain `JSON.parse` — the FE does NOT Zod-validate the error envelope. So `ErrorBody.details` (`oneOf: [null, FieldError[]]`) is doc-only; there is NO latent 9-1a parse bug. Shared `ErrorBody` schema left untouched; the runtime type-guards own the billing detail shapes.

### Completion Notes

- All 5 ATDD red files GREEN (28 assertions); +12 green-phase tests (banner C12, i18n-parity C13, global-seam + store-reset C16, axe C14) → **40 billing tests pass**. Full web `tsc -b` = 0.
- **No "Upgrade" verb anywhere** (D-9-1b-1): Free lead CTA + AI-credits replacement + dialog CTAs = "See plans" → picker; picker non-current CTAs = "Talk to us about {tier}" `mailto:hello@classlite.app`.
- **Usage banner ships calm** (D-9-1b-2): `PlanLimitBanner` renders "N of M students" + a neutral "Split into 2 classes" suggestion, dismissible, with NO limit/approaching/upgrade language (asserted negatively).
- **Global `ApiError` seam** (D-9-1b-3): `reportBillingError` → `useBillingErrorDialogStore` → `BillingErrorDialogHost` (mounted once in `AppLayout`). Wired **enrolment only** (`EnrolmentComposer.onError`); staff/class/AI wiring → FU-9-1B-DIALOG-WIRING (9.2).
- **Contract co-finalized** (AC18): PROVISIONAL stripped from `Billing*`/`PlanCatalog*` schemas in `api.yaml`, `client.ts` regenerated via openapi-typescript (types unchanged — doc-comment only). `ErrorBody` untouched (D-9-1b-4).
- **Landing (AC1/AC2):** prices/VAT/annual-badge already CI-locked (verified, `check-parity` green). Corrected tier-description contradictions in en.ts + vi.ts lockstep: Free "20 students" + "All AI grading" → "5 students, AI grading not included" (matches this story's own D24 dashboard copy + the locked catalog); Pro "200 students" → catalog limits; Studio removed the "white-label" claim (not in catalog).

### Test-infra fix (post-dev, same session)

Fixed a **pre-existing** environment bug (not a 9-1b regression, verified identical on the pristine baseline): Node 22.4+/26 ships a global WebStorage `localStorage`/`sessionStorage` that returns `undefined` without `--localstorage-file`, and since vitest's jsdom env makes `window === globalThis`, it **shadowed jsdom's native localStorage** → 323 full-suite failures across 26 storage-dependent files (`window.localStorage.clear()` → undefined). Fix (two layers): `vitest.config.ts` `test.execArgv: ['--no-experimental-webstorage']` (disables Node's global so jsdom's native brand-valid `Storage` is used — also makes `new StorageEvent({ storageArea })` valid) + a guarded fallback polyfill in `vitest-setup.ts` (installs on `Storage.prototype` so `vi.spyOn(Storage.prototype,'getItem')` is honored) for any invocation that misses the flag. **Full web suite now 274 files / 3621 tests, all green.**

### Deferrals / follow-ups raised

- **FU-9-1B-DIALOG-WIRING** (9.2) — wire the 409/402 dialogs into staff-invite / class-create / AI-grade mutations (already tracked in the story).
- **FU-9-1B-TOGGLE-PERSIST** (9.2) — persist the annual/monthly picker toggle across navigation (Zustand) once the purchase flow lands.
- **FU-9-1B-BANNER-WIRING** (future roster epic) — the `PlanLimitBanner` component ships + is tested, but the per-class roster surface (`StudentsTab`) is still a `ComingSoonPanel` with no live enrolled-count read, so there is no host to mount it on yet. Live mount lands when the per-class roster ships.

### Implementation Plan (as executed)

1. Data layer — `billingKeys`, `useBillingSummary`, `useBillingPlans`, `formatVnd`, `lib/formatVnDate` + i18n `vnDate` formatter.
2. `PlanUsageMeter` (domain) + `lib/formatDataSize` + Storybook.
3. Plan picker s68 — `PlanCard`, `planDisplay`, `PlanPickerPage`.
4. Billing dashboard s69 — `BillingDashboardPage`.
5. Latent dialogs — `typeGuards`, `errorKey`, two dialogs, global store + `reportBillingError` + `BillingErrorDialogHost`; wired `EnrolmentComposer`.
6. `PlanLimitBanner` (domain) + test.
7. i18n `billing.*` (en+vi lockstep), routes, PROVISIONAL strip + codegen, landing corrections, green-phase tests.

## File List

### Added
- `classlite-web/src/features/billing/api/billingKeys.ts` — TS-3 key factory.
- `classlite-web/src/features/billing/api/useBillingSummary.ts` — `GET /api/billing`.
- `classlite-web/src/features/billing/api/useBillingPlans.ts` — `GET /api/billing/plans`.
- `classlite-web/src/features/billing/lib/formatVnd.ts` — integer VND + ₫.
- `classlite-web/src/features/billing/lib/planDisplay.ts` — tier names + `mailto:` builder.
- `classlite-web/src/features/billing/lib/typeGuards.ts` — 409/402 detail runtime guards.
- `classlite-web/src/features/billing/lib/errorKey.ts` — code → `billing.error.*`.
- `classlite-web/src/features/billing/lib/reportBillingError.ts` — global-seam entry point.
- `classlite-web/src/features/billing/store/useBillingErrorDialogStore.ts` — dialog store.
- `classlite-web/src/features/billing/PlanPickerPage.tsx` — s68.
- `classlite-web/src/features/billing/BillingDashboardPage.tsx` — s69.
- `classlite-web/src/features/billing/components/PlanCard.tsx`
- `classlite-web/src/features/billing/components/PlanLimitExceededDialog.tsx` — 409.
- `classlite-web/src/features/billing/components/InsufficientCreditsDialog.tsx` — 402.
- `classlite-web/src/features/billing/components/BillingErrorDialogHost.tsx` — global mount.
- `classlite-web/src/features/billing/index.ts` — public barrel.
- `classlite-web/src/features/billing/__tests__/billing-i18n-parity.test.ts` — C13.
- `classlite-web/src/features/billing/__tests__/billing-a11y.test.tsx` — C14.
- `classlite-web/src/features/billing/__tests__/BillingErrorDialogHost.test.tsx` — seam + C16.
- `classlite-web/src/components/domain/PlanUsageMeter.tsx` — AC21 meter.
- `classlite-web/src/components/domain/PlanUsageMeter.stories.tsx` — Storybook.
- `classlite-web/src/components/domain/PlanLimitBanner.tsx` — AC12/13 banner.
- `classlite-web/src/components/domain/__tests__/PlanLimitBanner.test.tsx` — C12.
- `classlite-web/src/lib/formatDataSize.ts` — decimal-unit byte formatter.
- `classlite-web/src/lib/formatVnDate.ts` — VN-local `dd/MM/yyyy` (i18n layer).
- (ATDD reds, pre-existing on branch) `PlanUsageMeter.test.tsx`, `PlanPickerPage.test.tsx`, `BillingDashboardPage.test.tsx`, `BillingRoutesGate.test.tsx`, `planLimitDialogs.test.tsx`.

### Modified
- `classlite-web/src/lib/i18n.ts` — register the `vnDate` formatter (TS-6).
- `classlite-web/src/routes.tsx` — owner-gated `/settings/billing` + `/settings/billing/plans` (AC20).
- `classlite-web/src/components/shared/AppLayout.tsx` — mount `BillingErrorDialogHost` (global seam).
- `classlite-web/src/features/people/components/EnrolmentComposer.tsx` — route billing 409/402 to the seam.
- `classlite-web/src/locales/en.json` + `vi.json` — `billing.*` namespace (lockstep).
- `classlite-api/api.yaml` — strip PROVISIONAL from `Billing*`/`PlanCatalog*` (AC18).
- `classlite-web/src/lib/api/client.ts` — regenerated (doc-comment only; types unchanged).
- `classlite-landing/src/content/en.ts` + `vi.ts` — tier-description corrections (AC2).
- `classlite-web/vitest.config.ts` — `test.execArgv: ['--no-experimental-webstorage']` (test-infra fix).
- `classlite-web/src/test/vitest-setup.ts` — fallback Web Storage polyfill (test-infra fix).

### Deleted
- None.
