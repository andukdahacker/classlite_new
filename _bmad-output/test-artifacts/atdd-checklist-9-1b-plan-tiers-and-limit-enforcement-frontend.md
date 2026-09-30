---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-checklist-and-handoff']
lastStep: 'step-05-checklist-and-handoff'
lastSaved: '2026-09-30'
storyId: '9.1b'
storyKey: '9-1b-plan-tiers-and-limit-enforcement-frontend'
storyFile: '_bmad-output/implementation-artifacts/9-1b-plan-tiers-and-limit-enforcement-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-9-1b-plan-tiers-and-limit-enforcement-frontend.md'
detectedStack: 'frontend'
generationMode: 'ai-generation (sequential, self-executed — full frozen-contract context held)'
generatedTestFiles:
  - 'classlite-web/src/features/billing/__tests__/PlanPickerPage.test.tsx'
  - 'classlite-web/src/features/billing/__tests__/BillingDashboardPage.test.tsx'
  - 'classlite-web/src/features/billing/__tests__/BillingRoutesGate.test.tsx'
  - 'classlite-web/src/components/domain/__tests__/PlanUsageMeter.test.tsx'
  - 'classlite-web/src/features/billing/__tests__/planLimitDialogs.test.tsx'
inputDocuments:
  - '_bmad-output/implementation-artifacts/9-1b-plan-tiers-and-limit-enforcement-frontend.md'
  - 'classlite-api/api.yaml (billing paths 7062-7280; ErrorBody 10389-10404)'
  - 'classlite-api/internal/plan/plan.go (locked catalog)'
  - 'classlite-api/internal/middleware/error_mapper.go (409/402 details)'
  - 'classlite-web/src/lib/api/client.ts (generated billing types)'
  - 'docs/project-context.md (TEST-FE-1..6, TS-3/6, FW-3/4/7, UX-1/2/3)'
---

# ATDD Red-Phase Checklist — Story 9-1b (Plan Tiers & Limit Enforcement — Frontend)

**Test Architect:** Murat · **Date:** 2026-09-30 · **Stack:** frontend (Vitest + Testing Library + MSW + vitest-axe) · **Mode:** AI generation.

## Why ATDD is MANDATORY here (not optional)

The 9-1b v0.2 party-mode review re-scored the FE surface and found **two ≥6 risks** the v0.1 note had mis-inherited as "backend-only." Ducdo ruled 2026-09-30 that **ATDD red-first is MANDATORY for the FR1 + FR2 slices** before `in-progress`. These reds satisfy that gate:

- **FR1 — wrong price / VAT display (P2×I3 = 6):** `PlanPickerPage.test.tsx`.
- **FR2 — Free user shown a false credit/entitlement state (P2×I3 = 6):** `BillingDashboardPage.test.tsx`.
- **Contract-drift 9-1b↔9.2 (P2×I3 = 6):** mitigated by codegen-typed MSW fixtures (all reds type their fixtures against `components['schemas'][...]`, so a schema change breaks `tsc -b`) + the tracked FU-9-CONTRACT-402 on the arming story.

## RED convention (project-specific)

This repo's FE red convention is **compile-fail via missing-module imports → `tsc -b` red** (NOT generic `test.skip()`). Each red file imports a not-yet-existing `@/features/billing/*` or `@/components/domain/PlanUsageMeter` seam and documents its RED signals + green-phase seams in a header block. The assertions define the contract; they turn green when the dev builds the seam to match.

## RED VERIFICATION (executed)

`cd classlite-web && npx tsc -b` → **8 errors, 100% `TS2307` "Cannot find module", zero non-2307 errors.** The repo was green before these files (the transient LSP "type does not exist" noise on 8-x handlers was stale TS-server cache — real `tsc -b` confirms `client.ts` carries the billing/search/analytics types and the committed suite compiles). The codegen-typed fixtures compile clean, so the reds fail for exactly the intended reason: the app seams don't exist yet.

```
PlanUsageMeter.test.tsx        → @/components/domain/PlanUsageMeter
PlanPickerPage.test.tsx        → @/features/billing/PlanPickerPage
BillingDashboardPage.test.tsx  → @/features/billing/BillingDashboardPage
BillingRoutesGate.test.tsx     → @/features/billing/{BillingDashboardPage,PlanPickerPage}
planLimitDialogs.test.tsx      → @/features/billing/lib/typeGuards,
                                  @/features/billing/components/{PlanLimitExceededDialog,InsufficientCreditsDialog}
```

## Test strategy — AC → level → priority

All coverage is **component-level** (Vitest + RTL + MSW at the HTTP boundary, TEST-FE-1). No Playwright e2e in 9-1b: the 409/402 dialogs have zero e2e reachability until 9.2 arms `BILLING_ENFORCEMENT_ENABLED` (dark-launch), so MSW/synthetic `ApiError` is the only available signal.

| Matrix | Scenario | AC | File | Pri |
|---|---|---|---|---|
| C1/C2 | Locked VND prices per tier (monthly+annual) + server VAT split rendered verbatim + VAT caption | AC3 | PlanPickerPage | P0 |
| C7-toggle | Monthly/annual toggle shows the right figure + savings callout | AC4 | PlanPickerPage | P0 |
| AC5 | Current-plan flagged + neutralized; non-current CTAs = "Talk to us" `mailto:`, no "Upgrade" verb (D-9-1b-1) | AC5 | PlanPickerPage | P0 |
| C3 | isFree=true → "See plans" CTA present AND AI-credits meter ABSENT (FR2 negative half) | AC9 | BillingDashboardPage | P0 |
| C4/C5 | isFree=false → meter present AND lead-CTA absent; creditsApplicable both | AC9 | BillingDashboardPage | P0 |
| C9 | max=null → "Unlimited", no ratio, `.warn` SUPPRESSED despite approaching=true | AC8/H | BillingDashboardPage + PlanUsageMeter | P0 |
| C10 | approaching=true → `.warn`; false → no `.warn` | AC8 | BillingDashboardPage + PlanUsageMeter | P1 |
| AC10 | credit meter: available + i18n-formatted resetAt (no `new Date()`) | AC10 | BillingDashboardPage + PlanUsageMeter | P0 |
| C15 | three-state trilogy (skeleton / data / error alert) | AC7 | BillingDashboardPage | P0 |
| C6 | non-owner (teacher/student/admin) → PermissionDenied 'billing' AND billing data ABSENT from DOM (incl. raw leaked field) | AC6/11/20 | BillingRoutesGate | P0 |
| AC21 | PlanUsageMeter variant contract (count/bytes/credits; null-max; warn from prop) | AC21 | PlanUsageMeter | P0 |
| C7 | 409 → limit/current/max named, copy on `code`, owner "See plans" CTA, no "Upgrade" | AC14 | planLimitDialogs | P0 |
| C11 | canManageBilling owner→CTA present; teacher→"ask owner", CTA ABSENT | AC13/14 | planLimitDialogs | P1 |
| C8 | 402 → available/required named; type-guard discriminates (409 obj / FieldError[] / null rejected) | AC15/16 | planLimitDialogs | P0 |

**Deferred to green-phase (not scaffolded red):** C13 billing.* i18n EN+VI parity (covered inside the component reds via `i18n.t('billing.*')` assertions — a dedicated `billing-i18n-parity.test.ts` follows the landing precedent in green); C14 axe on s68/s69 + dialogs (P1); C16 Zustand reset hygiene. C1 landing price (AC1) is already covered by the existing `classlite-landing` PricingCard parity tests + CI `LOCKED_PRICES` guard — verify, don't duplicate.

## GREEN-PHASE SEAM CONTRACT (what the dev builds to turn each red green)

- [ ] **`@/features/billing/api/{billingKeys,useBillingSummary,useBillingPlans}.ts`** — key factory (TS-3), `useQuery<T, ApiError>`, explicit `staleTime` (FW-3); `useBillingPlans` unwraps `EnvelopePlanCatalog` → `{ plans: PlanCatalogEntry[] }`.
- [ ] **`@/features/billing/lib/formatVnd.ts`** — integer VND + `.` thousands + `₫/tháng|/năm` (CQ-3, no float).
- [ ] **`@/features/billing/PlanPickerPage.tsx`** — 3 `data-testid="plan-card-{tier}"` cards; prices + `vat` split from `PlanCatalogEntry` (verbatim, never re-derived); `role="switch"` annual toggle (`billing.picker.annualToggle`) + savings callout (`billing.picker.annualSavings`); current-plan flag (`billing.picker.currentPlan`); non-current CTA = `role="link"` `mailto:` (`billing.picker.talkToUs`).
- [ ] **`@/features/billing/BillingDashboardPage.tsx`** — `data-testid="billing-dashboard"`; current-plan card + 4 meters `data-testid="plan-usage-meter-{key}"`; `billing-dashboard-skeleton` (loading) + `role="alert"` (error); isFree branch → `billing.dashboard.seePlans` link + `billing.dashboard.aiNotIncluded`, AI-credits meter absent.
- [ ] **`@/components/domain/PlanUsageMeter.tsx`** (+ Storybook) — props `{ value, max|null, unit:'count'|'bytes'|'credits', warn, resetAt? }`; wraps `ui/progress.tsx`; `role="progressbar"` + `aria-valuenow/aria-valuemax` for count; `max===null` → `billing.meter.unlimited`, no bar, `data-warn` never `true`; `unit:'bytes'` via `lib/formatBytes`; `unit:'credits'` shows value + `billing.meter.resetAt`; `data-warn` reflects `warn`.
- [ ] **`@/features/billing/lib/typeGuards.ts`** — `isPlanLimitDetails` / `isInsufficientCreditsDetails` narrowing `unknown` (D-9-1b-4; reject `null`, `FieldError[]`, and the other error's shape).
- [ ] **`@/features/billing/lib/errorKey.ts`** — code → `billing.error.*` i18n key (copy on `code`, not `error.message`).
- [ ] **`@/features/billing/components/{PlanLimitExceededDialog,InsufficientCreditsDialog}.tsx`** — props `{ open, error }`; 409 branches on `details.canManageBilling` (owner → `billing.dashboard.seePlans`; teacher → `billing.error.askOwner`, no CTA); 402 surfaces `available`+`required`; mount at a **global `ApiError` seam**, wire enrolment only (FU staff/class/AI → 9.2).
- [ ] **routes.tsx** — `/settings/billing` + `/settings/billing/plans` behind `RouteRoleGate allowedRoles={['owner']} requiredRolesForCopy={['owner']} sectionNameKey="billing"`.
- [ ] **i18n** — `billing.*` namespace in `en.json` + `vi.json` (lockstep): `vatCaption`, `picker.{annualToggle,annualSavings,currentPlan,talkToUs}`, `dashboard.{seePlans,aiNotIncluded}`, `meter.{unlimited,resetAt}`, `error.{planLimitExceeded,insufficientCredits,askOwner}` + one shared "owner's job" key (AC19). `billing.meter.resetAt` uses the i18n date formatter (`dd/MM/yyyy` vi, TS-6).

## Handoff

- **Next:** `/bmad-dev-story 9-1b` — implement to green; each seam above satisfies its red file. Remove nothing; the reds ARE the AC contract.
- **Green gate:** `cd classlite-web && npx tsc -b` = 0, then `npm run test` (vitest) green for the 5 files.
- **Post-dev:** `/bmad-tea TA` (expand P1/P2 — C10/C11/C12/C14/C16 + the dedicated billing-i18n-parity test) then `/bmad-tea RV`.
- **Do NOT** attempt to trigger the 409/402 dialogs by real user action — enforcement is dark-launched OFF; MSW is the only signal in 9-1b (armed by 9.2).
