# Story 9.1b: Plan Tiers & Limit Enforcement — Frontend (public pricing correction · plan picker s68 · billing dashboard s69 · usage banner · latent hard-block dialogs)

Status: done

---

story_key: 9-1b-plan-tiers-and-limit-enforcement-frontend
baseline_commit: 6f78c57
audience: Frontend (React 19 · Vite/Rolldown · TanStack Query · Zustand · Tailwind · shadcn/Base-UI · react-i18next EN/VI) + a small Astro landing correction. NO backend logic — consumes the frozen 9-1a read API + error contract.
depends_on: 9-1a (DONE — GET /api/billing + /api/billing/plans, the 409/402 error details, all Billing*/PlanCatalog* types already codegen'd into client.ts)
realizes: [FR-61, FR-62]   # FR-61 plan tiers/pricing display; FR-62 soft-usage + latent hard-block UI (enforcement engine is 9-1a; arming is 9.2). VND+VAT display is THIS story.
review: v0.2 — PARTY-MODE PRE-DEV REVIEWED 2026-09-30 (Sally/Amelia/Murat/Winston as independent subagents; John ruled the 3 product forks). Stays ready-for-dev; ACs hardened, risk re-scored (2 FE ≥6 risks found), DoD replaced with a gated scenario matrix. v0.1: created via /bmad-create-story 9-1b, 3-artifact parallel recon.

---

## Story

As an **owner**,
I want a **clear pricing page, an in-dashboard plan picker, live usage meters, and honest guidance as my usage grows**,
so that **I understand what each tier offers, can see how much of my plan I'm using, and know exactly how to get more — without being lied to or hitting a silent wall.**

**Frontend slice only.** 9-1a already shipped the whole enforcement engine (`billing_service`), the two Owner-only read endpoints, the typed 409/402 error contract, and all TS types. This story **renders** what 9-1a computes and **never re-derives limit logic client-side** (D22 — the server owns `approaching`, `isFree`, `creditsApplicable`).

## Decisions (D-9-1b-1..3 — Ducdo party-mode rulings 2026-09-30; D1/D4/D9/D19/D22/D24 inherited from 9-1a)

- **D-9-1b-1 — No "Upgrade" verb that can't complete. [RULED John/Ducdo]** The purchase flow is 9.2 and enforcement is dark-launched (D19), so every "Upgrade" CTA in 9-1b would dead-end. In a trust-before-conversion VN market a dead button is a broken promise. Therefore: Free-tier CTAs (dashboard lead + AI-credits replacement) read **"See plans"** and route to the picker (real, informative). The plan-picker's non-current-tier CTAs read **"Talk to us about Pro/Studio"** and open an **email contact action** (`mailto:` the center-support address; Ducdo ruled email 2026-09-30 — capture the most-motivated moment as a human conversation, the way undigitised VN centers transact a first upgrade). The latent 409/402 dialog CTAs use the **same** destinations. Zero "coming soon", zero fake waitlist.
- **D-9-1b-2 — The usage banner ships LIVE now, with the threat stripped. [RULED John/Ducdo]** The per-class banner (AC12) is a pure client-side count vs `limits.studentsPerClass`; it does NOT depend on `BILLING_ENFORCEMENT_ENABLED`. Gating it would ship a banner nobody sees; showing "approaching limit" while the wall is dark is cry-wolf. So 9-1b renders **calm, factual, present-tense usage** ("18 of 20 students") with **no "limit" / "approaching" / wall language and no upgrade-to-fix CTA**. The "Split into 2 classes" hint is a neutral suggestion, not a rescue. **9.2 (which arms enforcement) escalates the copy** to the amber "approaching limit" framing — because only then does the wall bite.
- **D-9-1b-3 — Dialogs: global seam + ONE reference wiring (enrolment). [RULED John/Ducdo + Amelia/Winston]** Build the 409/402 dialog components, a **global `ApiError` mounting seam** (not billing-page-local — `PLAN_LIMIT_EXCEEDED` originates on mutations app-wide, so 9.2 must reuse the seam without re-plumbing), and **codegen-typed MSW fixtures**. Wire **only the enrolment mutation** (same surface as the AC12 banner — one coherent "your class is filling up" story). Staff-invite / class-create / AI-grade wiring → **FU-9-1B-DIALOG-WIRING (9.2)**, where the errors actually fire.
- **D-9-1b-4 — `ErrorBody.details` stays a runtime type-guard, NOT a widened shared schema. [Amelia/Winston/Murat unanimous]** `ApiError.details` is `unknown`; every consumer narrows at runtime already. Widening the shared `oneOf: [null, FieldError[]]` to enumerate billing variants buys nothing at the use-site and risks `tsc -b` churn across every feature that reads `details`. Keep the shared schema alone; the type-guard is the sole source of truth for the billing object shape. **First verify** whether the FE Zod-validates the error envelope (AC16) — if it does, the current schema is a **latent 9-1a parse bug** (a billing 409/402 writes an object into a `FieldError[]|null` field → envelope throws), masked only by the dark-launch; fix it minimally-permissively (admit an untyped object). Strip PROVISIONAL from **billing schemas only** (`Billing*`/`PlanCatalog*`), never `ErrorBody`.

## Acceptance Criteria

Grouped A–G. Every FE data-fetching surface implements the Loading/Empty/Error trilogy (UX-1) and ships EN+VI keys in lockstep (UX-2). "Owner-only" = admin/teacher/student never see the data in the DOM (TEST-FE-6).

### A. Public pricing page correction — landing (D-PRICE)

1. **Given** the landing pricing section renders (`/vi` and `/en`), **Then** the three tier prices display VAT-inclusive exactly as locked: Free **0**, Pro **399.000₫/tháng · 3.990.000₫/năm**, Studio **999.000₫/tháng · 9.990.000₫/năm**, each with "*Giá đã bao gồm VAT 10%*" (VI) / "*Prices include 10% VAT*" (EN) and the "**~2 tháng miễn phí**" / "~2 months free" annual badge. **These numbers + captions + badge already ship correctly and are CI-locked** — this AC is a *verification + parity-guard* pass (see Dev Notes → "D-PRICE reality").
2. **Given** each tier card's feature description, **Then** the described limits **match the locked catalog** (Free: 1 teacher / 1 class / 5 students-per-class / 500 MB / no AI grading; Pro: up to 10 teachers / unlimited classes / 20 students-per-class / 500 AI credits/mo / 5 GB; Studio: unlimited teachers / unlimited classes / 60 students-per-class / 2.000 AI credits/mo / 50 GB). Any current description that contradicts these (e.g. a Free "20 students" line, a Studio "white-label" claim not in the catalog) is corrected/removed. Edits land in `en.ts` + `vi.ts` **in lockstep** and pass `npm run check-parity`.

### B. Plan picker — s68, `/settings/billing/plans`, Owner-only

3. **Given** an Owner opens the plan picker, **Then** three tier cards (Free → Pro → Studio, catalog order) render each tier's feature limits, monthly/annual VND price, and the VAT-inclusive caption — all read from `GET /api/billing/plans` (`PlanCatalogEntry`), never hardcoded.
4. **Given** a monthly/annual toggle, **When** switched to annual, **Then** annual prices show with a savings callout ("~2 months free"); the toggle is **client-only UI state** (Zustand UI store or local `useState` — never the TanStack Query cache), and the annual selection **persists across navigation** within the session (Zustand — it's the conversion lever).
5. **Given** the caller's current plan (from `GET /api/billing`.plan), **Then** that tier card is highlighted "Current plan" and its CTA is neutralized. **Each non-current tier CTA reads "Talk to us about {tier}" and opens an email contact action (`mailto:`)** (D-9-1b-1). No purchase flow (9.2); no "coming soon"; no "Upgrade" verb.
6. **Given** a non-owner (admin/teacher/student) navigates to `/settings/billing/plans`, **Then** the `PermissionDenied` `'billing'` section renders (route-gated) and no plan/price data is in the DOM.

### C. Billing dashboard — s69, `/settings/billing`, Owner-only

7. **Given** a paid-tier Owner opens the billing dashboard, **Then** it shows a current-plan card (plan name, billing cycle, period end) + live usage meters for **teacherSeats, classes, aiCredits, storage** driven by `GET /api/billing`.usage. **No next-invoice card, no payment-method card** (D-DASH → 9.2).
8. **Given** any usage meter whose server `approaching` is `true`, **Then** that meter renders the amber `.warn` state with a plain-language read-out (e.g. "9 of 10 teacher seats"); the FE **renders the server boolean verbatim** and computes no thresholds (D22). **`max === null` renders "Unlimited" AND suppresses the `.warn` state regardless of the server boolean** (an unlimited meter cannot be "approaching" — defensive guard against a server contract slip).
9. **Given** a **Free-tier** Owner (`isFree === true` / `creditsApplicable === false`), **Then** the AI-credits meter is **replaced** by an "AI grading not included on Free — **See plans**" CTA (D24 — never an alarming `0/0` meter; "See plans" → picker per D-9-1b-1), and the dashboard leads with a "See plans" CTA. Teacher-seats/classes/storage meters still render.
10. **Given** the `aiCredits` credit meter on a paid tier, **Then** it shows `available` (= monthlyAllocation − monthlyUsed + addonRemaining) and the reset date formatted from `resetAt` via the i18n date formatter (TS-6 — never `new Date().toLocaleString()`), VI format `dd/MM/yyyy`; `resetAt` is already VN-local midnight (render as-is, do not shift).
11. **Given** a non-owner navigates to `/settings/billing`, **Then** `PermissionDenied` `'billing'` renders and no billing data is in the DOM.

### D. Usage banner — `PlanLimitBanner` (D4/D22/**D-9-1b-2**, epic s72)

12. **Given** a class's enrolment nears the per-class student count (e.g. 18/20), **When** a teacher or owner views the class/enrolment surface, **Then** a non-blocking `PlanLimitBanner` renders **calm factual usage** — "18 of 20 students" — with **no "limit"/"approaching"/wall language and no upgrade CTA** (D-9-1b-2). A neutral "Split into 2 classes" suggestion is offered. It is dismissible. Count = existing per-class enrolment read vs `limits.studentsPerClass` from `GET /api/billing` (D4 — there is deliberately **no** center-level `students` usage meter).
13. **Given** the banner's actor, **Then** copy is role-appropriate but neither role is told to "upgrade" in 9-1b; the owner-vs-teacher branch reuses the shared "billing is the owner's job" voice (see AC19 shared-key note). The amber "approaching limit" + upgrade-path escalation is a **9.2** concern (arrives with enforcement).

### E. Latent hard-block dialogs — 409 / 402 (D23, **D-9-1b-3**)

14. **Given** a mutating action returns **409 `PLAN_LIMIT_EXCEEDED`** (only when 9.2 arms enforcement; MSW-driven in 9-1b tests), **Then** a hard-block dialog names the limit from `error.details` (`limit` ∈ {TEACHER_SEATS, CLASSES, STUDENTS_PER_CLASS, STORAGE, AI_CREDITS}, `current`, `max`), states existing access is not degraded (only the new action blocked), and branches on `details.canManageBilling`: owner → **"See plans"** (→ picker); non-owner → "Ask your center owner" (no CTA). Copy keyed on `code`, not `error.message`.
15. **Given** an AI action returns **402 `INSUFFICIENT_CREDITS`** (MSW-driven), **Then** a dialog names the gap from `error.details` (`available`, `required` — "You have 3 credits, this needs 10") and offers the owner **"See plans"**; copy keyed on the error `code`.
16. **Given** the FE reads `error.details`, **Then** it does so through a **runtime type-guard** (`isPlanLimitDetails` / `isInsufficientCreditsDetails`) because `ApiError.details` is `unknown` and the generated `ErrorBody.details` schema does not describe the billing object shape (D-9-1b-4). The guard, dialog components, and a **global `ApiError` mounting seam** are built; **only the enrolment mutation is wired** to surface the dialogs in 9-1b (D-9-1b-3); staff/class/AI wiring → FU-9-1B-DIALOG-WIRING (9.2).

### F. Data layer, contract co-finalization, i18n

17. **Given** the billing surfaces, **Then** a new `features/billing/` slice provides `billingKeys` (query-key factory, TS-3, structured so 9.2 mutations can invalidate `summary`/`plans`), `useBillingSummary()` (`GET /api/billing` → `BillingSummary`), and `useBillingPlans()` (`GET /api/billing/plans` → unwraps to `{ plans: PlanCatalogEntry[] }`), each typed `useQuery<T, ApiError>` with an explicit `staleTime` (FW-3; catalog long, summary ~30–60s). No `useEffect` fetching (FW-4); MSW is the only mock seam (TEST-FE-1).
18. **Given** 9-1b consumes every PROVISIONAL field, **Then** the PROVISIONAL markers are stripped from **the `Billing*` / `PlanCatalog*` schemas only** (never the shared `ErrorBody`); `codegen.sh` (openapi) is re-run; `tsc -b` = 0. **If** the `ErrorBody.details` Zod-parse fix (D-9-1b-4) proves necessary, it is a **schema change** → a **mandatory single atomic api+web commit** (WF-1 sequence + WF-4, all three CI pipelines green, verify the Go error-constructor still compiles) — call it out; do not let a definite schema change ride as an FE-only edit. Confirm `api.yaml`'s repo ownership before editing.
19. **Given** all new user-facing strings, **Then** a fresh `billing.*` namespace (plan-tier names, price/VAT captions, meter labels, `resetAt` formatting, `billing.error.planLimitExceeded` / `billing.error.insufficientCredits`, banner copy, "See plans" / "Talk to us" CTAs) is added to **both** `en.json` and `vi.json` in lockstep (UX-2, TEST-FE-4). The "billing is the owner's job" message shared by the teacher banner (AC13), the non-owner 409 dialog (AC14), and `PermissionDenied 'billing'` uses **one shared i18n key / one VI voice**, not three phrasings.

### G. Routing & role-gating

20. **Given** the router, **Then** `/settings/billing` (s69) and `/settings/billing/plans` (s68) are Owner-only via `RouteRoleGate allowedRoles={['owner']} sectionNameKey="billing"` (standalone routes — the settings tab union is closed; the `'billing'` PermissionDenied section + EN/VI header copy already ship). A student/teacher cannot navigate there (UX-3).

### H. Component contract (prevents reinvention)

21. **Given** the reserved-name meter, **Then** `PlanUsageMeter` (`components/domain/`) exposes a single variant-aware contract, e.g. `{ value: number; max: number | null; unit: 'count' | 'bytes' | 'credits'; warn: boolean; resetAt?: string }` — ONE polymorphic component, not three. `max === null` → count-only render, no bar, no `aria-valuemax`; `unit:'bytes'` formats via `lib/formatDataSize`; `unit:'credits'` shows a distinct "N remaining" read-out + `resetAt` (NOT a fill-toward-max bar). Amber `.warn` is driven by the `warn` prop (server `approaching`), mirroring `LoadMeter`'s server-owned flag. Ships a Storybook entry (the name is reserved in `Progress.stories.tsx`). **[AMENDED 2026-09-30 — code-review P9/P8/D2]:** the count/bytes bar is HAND-ROLLED (a `<span role="progressbar">` with `aria-valuenow` clamped into `[0,max]`), NOT a wrap of `ui/progress.tsx` — the unlimited/credits variants + server-driven `.warn` need presentation the primitive doesn't express, so a wrap would be a thin shell around a div; `unit:'bytes'` uses the new `lib/formatDataSize` (decimal GB) rather than `lib/formatBytes` (IEC GiB), which TS-7 forbids importing here anyway; `unit:'credits'` is a remaining-balance read-out, not a bar.

---

## Tasks / Subtasks

- [x] **Task 1 — Data layer + contract co-finalize (AC17, AC18, D-9-1b-4)**
  - [x] `features/billing/api/billingKeys.ts` (factory: `all:['billing']`, `summary()`, `plans()`); mirror `settings/api/settingsKeys.ts`.
  - [x] `useBillingSummary.ts` → `apiFetch<BillingSummary>('/api/billing')`, `useQuery<BillingSummary, ApiError>`, `staleTime` 45s. `useBillingPlans.ts` → `apiFetch<{ plans: PlanCatalogEntry[] }>('/api/billing/plans')`, long `staleTime` (1h).
  - [x] **Verified FE error-envelope Zod handling** (D-9-1b-4): the client does NOT Zod-parse `ErrorBody.details` (`apiFetch.throwEnvelopeError` reads it via plain `JSON.parse`) → schema is doc-only, left untouched. Type-guards own the shape.
  - [x] Stripped PROVISIONAL from `Billing*`/`PlanCatalog*` **only**; regenerated `client.ts` via openapi-typescript (types unchanged — doc-comment only); `tsc -b` = 0. `ErrorBody` untouched.
- [x] **Task 2 — Plan picker s68 (AC3, AC4, AC5, AC6, AC20)**
  - [x] `features/billing/PlanPickerPage.tsx` (3 `PlanCard`s from `useBillingPlans` + current from `useBillingSummary`); monthly/annual toggle via local `useState` (AC4 first clause; cross-nav persistence → FU-9-1B-TOGGLE-PERSIST — see completion notes); annual savings callout; current-plan highlight + neutralized CTA; non-current CTAs → "Talk to us about {tier}" `mailto:` (D-9-1b-1).
  - [x] `lib/formatVnd.ts` (integer VND + `.` thousands + ₫); VAT caption + split. No float money (CQ-3).
  - [x] Register `/settings/billing/plans` owner-gated route.
- [x] **Task 3 — Billing dashboard s69 + `PlanUsageMeter` (AC7–AC11, AC21, AC20)**
  - [x] `components/domain/PlanUsageMeter.tsx` (+ Storybook + tests) — the AC21 variant contract; `max===null`→Unlimited (no bar, warn suppressed); mirrors `LoadMeter`/`StorageTab`. Bytes via new `lib/formatDataSize` (GB — the red asserts `/GB/i`, TS-7 forbids importing knowledge-hub's formatter into a domain component).
  - [x] `features/billing/BillingDashboardPage.tsx` — current-plan card + 4 meters; Free-tier branch (isFree → AI-credits "See plans" CTA + lead "See plans" CTA).
  - [x] Register `/settings/billing` owner-gated route.
- [x] **Task 4 — Usage banner (AC12, AC13, D-9-1b-2)**
  - [x] `components/domain/PlanLimitBanner.tsx` — calm factual "N of M students", neutral "Split" suggestion, dismissible, **no limit/approaching/upgrade language** (+ test). Live mount deferred → FU-9-1B-BANNER-WIRING: the per-class roster surface (`StudentsTab`) is still a `ComingSoonPanel` with no enrolled-count read, so there is no host yet.
- [x] **Task 5 — Latent dialogs + global error seam (AC14, AC15, AC16, D-9-1b-3)**
  - [x] `isPlanLimitDetails` / `isInsufficientCreditsDetails` runtime guards over `error.details`; billing `errorKey(error)` switch (copy on `code`).
  - [x] `PlanLimitExceededDialog` (409, actor-branched via `canManageBilling`, "See plans") + `InsufficientCreditsDialog` (402, available/required, "See plans").
  - [x] **Global `ApiError` mounting seam** (`useBillingErrorDialogStore` + `reportBillingError` + `BillingErrorDialogHost` in `AppLayout`); wired **enrolment mutation only**. FU staff/class/AI → FU-9-1B-DIALOG-WIRING.
  - [x] **Codegen-typed MSW fixtures** for 409/402 (in the reds — typed against generated schemas).
- [x] **Task 6 — Landing pricing verification (AC1, AC2)**
  - [x] Confirmed `en.ts`/`vi.ts` prices == locked catalog + `check-parity` green. Corrected tier-description mismatches (Free "20 students"+"All AI grading", Pro "200 students", Studio "white-label") in both locales; `check-parity` re-run green.
- [x] **Task 7 — i18n + ATDD + tests (AC19 + the DoD matrix)**
  - [x] `billing.*` namespace in `en.json` + `vi.json` (lockstep); shared "billing is the owner's job" key = `billing.error.askOwner` (AC19).
  - [x] **ATDD red-first for FR1 + FR2 slices** landed before `in-progress` (the 5 red files on-branch; verified 8×TS2307 red → green).
  - [x] Implemented the DoD scenario matrix: all P0 + P1 covered (28 red assertions + 12 green-phase tests).

### Review Findings

_Code review 2026-09-30 (Amelia + 3 adversarial layers: Blind Hunter / Edge Case Hunter / Acceptance Auditor). FR1 (price/VAT) and FR2 (Free false-credit) both SATISFIED. All findings below verified against source._

**Decision-needed (RESOLVED 2026-09-30 — Ducdo):**

- [x] [Review][Decision→Patch] AI-credits meter inversion → **RESOLVED: option (a)** — give `unit:'credits'` a **distinct "N remaining" presentation** (no fill-toward-max bar), killing the empty-as-depletes inversion, the ambiguous "100/2000", the dead `warn=false`, and the add-on `available>allocation` ARIA break. See Patch P8. [blind High + edge Medium + auditor Low]
- [x] [Review][Decision→Patch] `PlanUsageMeter` doesn't wrap `ui/progress` → **RESOLVED: option (b)** — keep the hand-rolled bar, **amend AC21 + the Dev-Notes reuse map** to record the deviation, and **fix the inaccurate `.stories`/`.test` docstrings** that claim it wraps. See Patch P9. [auditor Medium]

**Patch:**

- [x] [Review][Patch] 402 InsufficientCreditsDialog shows the owner-only "See plans" CTA to non-owners [classlite-web/src/features/billing/components/InsufficientCreditsDialog.tsx:65] — 402 detail `{available, required}` carries no `canManageBilling`, so (unlike the 409 dialog) it never branches; a teacher who exhausts credits gets a "See plans" link that dead-ends at the owner-only `PermissionDenied`. Derive role from `useRole`/session; non-owner → shared `askOwner` copy, no CTA. [blind+edge Medium]
- [x] [Review][Patch] AC14 — 409 dialog never names WHICH limit was hit [classlite-web/src/features/billing/components/PlanLimitExceededDialog.tsx:55-66] — renders generic title + `current/max` only, never `details.limit`; a students-per-class wall is indistinguishable from a teacher-seats wall. Docstring falsely claims "It names the limit". Add per-limit i18n keys (TEACHER_SEATS/CLASSES/STUDENTS_PER_CLASS/STORAGE/AI_CREDITS) in en+vi. [auditor Medium]
- [x] [Review][Patch] PlanCard AI-credits limit uses `aiCreditsPerMonth ?? 0` → renders "0" for a `null` (unlimited) limit [classlite-web/src/features/billing/components/PlanCard.tsx:85] — inconsistent with sibling limits' `limitLabel()` (null→"Unlimited"). Latent (catalog is 0/500/2000) but the contract permits null. Route through `limitLabel(...)`. [edge Medium]
- [x] [Review][Patch] 409 malformed-detail fallback defaults to the non-owner copy [classlite-web/src/features/billing/components/PlanLimitExceededDialog.tsx:43] — `canManageBilling ?? false` means an owner hitting a malformed/unknown detail (guard rejects → `null`) sees "ask your center owner" and loses the CTA. D-9-1b-4 wants a neutral generic fallthrough, not the wrong-role path. [edge Medium]
- [x] [Review][Patch] PlanUsageMeter ARIA/clamp hardening [classlite-web/src/components/domain/PlanUsageMeter.tsx:88-107] — `aria-valuenow={value}`/`aria-valuemax={max}` emitted raw (invalid when `value>max` or `max===0`), and `percent` has no lower clamp (negative `value` → negative-width bar). Clamp `aria-valuenow` into `[0,max]`, guard `max===0` readout, `Math.max(0, …)` on percent. [blind+edge Low]
- [x] [Review][Patch] formatDataSize boundary bug [classlite-web/src/lib/formatDataSize.ts:19-24] — float `Math.log` flooring mis-buckets exact powers of 1024 ("1,024 MB" instead of "1 GB") and near-boundary values round to "1024.0 MB"; `Math.min(len-1, floor(...))` can also yield exponent `-1` → `UNITS[-1]` = undefined for `0<bytes<1` (latent under integer wire). Clamp exponent ≥0 and fix boundary bucketing. [blind+edge Low]
- [x] [Review][Patch] Dead code — `billingErrorKey` defined but never imported [classlite-web/src/features/billing/lib/errorKey.ts] — dialogs/host discriminate on `error.code` inline; the switch is unused (CQ-1 rejects dead code). Remove it (copy-on-code is already satisfied by the components). [blind+auditor Low]
- [x] [Review][Patch] P8 (from Decision 1) — `PlanUsageMeter` `unit:'credits'` distinct "N remaining" presentation (no fill-toward-max bar; low-balance amber derived or omitted), and rewire `BillingDashboardPage` credits meter accordingly. [classlite-web/src/components/domain/PlanUsageMeter.tsx + BillingDashboardPage.tsx:117-125]
- [x] [Review][Patch] P9 (from Decision 2) — amend AC21 + the Dev-Notes reuse map to record the hand-rolled-bar deviation, and fix the `.stories`/`.test` docstrings that falsely claim the meter wraps `ui/progress`. [this spec + PlanUsageMeter.stories.tsx + __tests__/PlanUsageMeter.test.tsx]

**Deferred:**

- [x] [Review][Defer] AC4 — annual toggle does not persist across navigation [classlite-web/src/features/billing/PlanPickerPage.tsx] — local `useState`, not Zustand. Documented → FU-9-1B-TOGGLE-PERSIST.
- [x] [Review][Defer] AC12/AC13/AC19 — PlanLimitBanner not mounted live, no role-appropriate copy branch, and the "owner's job" message is not a single shared key across banner/409/PermissionDenied [classlite-web/src/components/domain/PlanLimitBanner.tsx] — blocked on `StudentsTab` (still a `ComingSoonPanel`). Documented → FU-9-1B-BANNER-WIRING.
- [x] [Review][Defer] formatVnDate returns the raw wire string on an unparseable ISO ("Resets not-a-date") [classlite-web/src/lib/formatVnDate.ts] — a graceful em-dash placeholder is safer; contract always emits `+07:00` so low-risk.
- [x] [Review][Defer] PlanPickerPage has no empty-state for an empty plan catalog (UX-1 trilogy) [classlite-web/src/features/billing/PlanPickerPage.tsx] — catalog is a server-static 3-tier, near-unreachable.
- [x] [Review][Defer] Free PlanCard shows "0₫/month" instead of a "Free"/"not included" framing [classlite-web/src/features/billing/components/PlanCard.tsx:63,85] — cosmetic; landing copy says "AI grading not included".

**Dismissed (5):** vnDate formatter optional-chain no-op (formatter service always present post-init); "N of Unlimited used" (unreachable — can't exceed an unlimited limit); store `initialState` export (MANDATED by TEST-FE-3); PlanUsageMeter uses `formatDataSize` not `formatBytes` (intentional documented deviation — IEC vs decimal + TS-7); global `BillingErrorDialogHost` mount (that IS the AC16 seam design; real issue captured as the 402-CTA patch).

## Dev Notes

### Frozen 9-1a contract (consume verbatim — do not re-derive)
- **`GET /api/billing` → `BillingSummary`** (`client.ts:2484-2504`): `plan` (`free|pro|studio`), `billingCycle` (`monthly|annual`), `status` (**open string** — do NOT exhaustively switch), `isFree`, `creditsApplicable`, `currentPeriodStart`, `currentPeriodEnd` (null on Free), `limits` (`BillingLimits`, null field = unlimited), `usage` (`teacherSeats`/`classes` = `BillingCountMeter {current,max,approaching}`; `aiCredits` = `BillingCreditMeter {monthlyAllocation,monthlyUsed,addonRemaining,available,resetAt}`; `storage` = `BillingStorageMeter {usedBytes,limitBytes,percentUsed,approaching}`).
- **`GET /api/billing/plans` → `EnvelopePlanCatalog`** → `data.plans: PlanCatalogEntry[]` (`{plan, limits, priceMonthlyVnd, priceAnnualVnd, vat:{monthlySubtotal,monthlyVat,annualSubtotal,annualVat}}`). VND integers only.
- **Locked catalog** (`classlite-api/internal/plan/plan.go`): Free 0/0 · Pro 399000/3990000 · Studio 999000/9990000; teachers 1/10/∞; classes 1/∞/∞; studentsPerClass 5/20/60; AI credits/mo 0/500/2000; storage 500 MiB / 5 GiB / 50 GiB. VAT 10%-inclusive round-half-up (`subtotal = round(price/1.1)`, `vat = price − subtotal`).
- **Server owns the logic** (D22/D24): `approaching`, `isFree`, `creditsApplicable`, `resetAt` (VN-local midnight) are server-computed. **Render them; never recompute.** Same discipline as `LoadMeter`'s `heavy` flag.
- Types: `import type { components } from '@/lib/api/client'` → `type BillingSummary = components['schemas']['BillingSummary']`. Marked PROVISIONAL — strip the billing markers (AC18), NOT `ErrorBody`.

### Error contract (D23) + the details gap
- **409 `PLAN_LIMIT_EXCEEDED`** `details`: `{ limit: "TEACHER_SEATS"|"CLASSES"|"STUDENTS_PER_CLASS"|"STORAGE"|"AI_CREDITS", current, max, canManageBilling }` (`error_mapper.go:40-45`, HTTP **409**). **402 `INSUFFICIENT_CREDITS`** `details`: `{ available, required }` (`error_mapper.go:66-71`, HTTP **402**). Server messages are **English literals** (i18n deferred at 9-1a) → render your own i18n copy keyed on `code`.
- **The gap (D-9-1b-4):** `api.yaml`'s `ErrorBody.details` = `oneOf: [null, FieldError[]]`; `ApiError.details` (`lib/api-fetch.ts:67-98`) is `unknown`. Read via a **runtime type-guard**. Do NOT widen the shared `oneOf`. If the client Zod-validates the envelope, a billing 409/402 currently fails to parse (latent 9-1a bug, masked by dark-launch) → minimal-permissive fix only.
- No central code→i18n map exists — per-feature `errorKey(error)` switch (copy `features/people/components/EnrolmentComposer.tsx:85-105`).

### ⚠️ Dark-launch: the hard blocks are LATENT in prod
`BILLING_ENFORCEMENT_ENABLED` ships **OFF** (D19) — **including the 402 credit gate** (`ai_grade_service.go:194`, `ai_generation_service.go:89`, `enrollment_service.go:133`, `class_crud.go:163`, `auth_admin.go:196`). With the flag off, a real 21st enrolment / seat add / credit-exhausted job **succeeds — no 409/402 fires**. Armed by **9.2**. So the AC14/15 dialogs are exercised **only via MSW-mocked responses** in 9-1b; do NOT try to trigger them by real user action and conclude they're broken. The AC12 banner, by contrast, is a pure client count and **does show live** (that's why D-9-1b-2 strips the threat language).

### D-PRICE reality (prior artifact already shipped most of it)
Landing already displays the locked prices + VAT caption + "~2 months free" badge, byte-locked by CI (`classlite-landing/scripts/check-landing-parity.mjs:45-52` `LOCKED_PRICES`). Data lives in `classlite-landing/src/content/vi.ts:102-136` + `en.ts:83-117` (data-driven; `PricingSection.astro`/`PricingCard.astro` need no structural change). **D-PRICE = verify + fix tier feature descriptions** (AC2), not a rewrite. Any price change would need `vi.ts` + `en.ts` + `check-landing-parity.mjs` together (PM-approved) — you should NOT need one; flag to Ducdo if you find a drift.

### Reuse map (do NOT recreate)
- **`ui/progress.tsx`** (Base-UI `Progress.Root/Track/Indicator/Label`) — ~~`PlanUsageMeter` wraps it~~ **[AMENDED 2026-09-30 — code-review P9/D2]: `PlanUsageMeter` does NOT wrap this primitive; the count/bytes bar is hand-rolled (`<span role="progressbar">`) because the unlimited/credits variants + server-`.warn` need presentation the primitive can't express. The name reservation in `Progress.stories.tsx` still stands.**
- **`components/domain/LoadMeter.tsx:20-64`** — server-owns-amber-flag / client-computes-% pattern to mirror.
- **`features/settings/StorageTab.tsx:49-78`** — closest usage-meter UI (`storagePercent`, `role=progressbar`, `formatFileSize`); `lib/formatBytes.ts`.
- **`components/domain/AppShell.tsx:21-68`** — `banner?: ReactNode` (renders above topbar). **Reserve for 9.3's grace strip** — 9-1b's `PlanLimitBanner` is class-contextual, not global.
- **`components/shared/PermissionDenied.tsx:45-59`** — `SectionNameKey` includes `'billing'`; header ships (`en.json:117`/`vi.json:117`). Gate pattern: `routes.tsx:214-241`.
- **`lib/api-fetch.ts`** — `ApiError {status,code,requestId,details,retryAfterSeconds}` (67-98); `apiFetch` unwraps `{data,meta}`→`data`. Typed-error hook: `features/knowledge-hub/api/useStorageUsage.ts:15-22`. Key factory: `features/settings/api/settingsKeys.ts:9-38`.
- **i18n**: `src/locales/en.json` + `vi.json` (flat dotted keys, lockstep). No `billing.*` yet. `settings.tabs.*` is a **closed** union (`useSettingsTab.ts:10`) → standalone `/settings/billing[/plans]` routes.

### Read files being modified (UPDATE, not NEW) — read before editing
- `routes.tsx` (add 2 owner-gated routes; preserve the `/settings` gate); the enrolment mutation error path (add the global-seam dialog trigger; preserve existing error toasts for other codes); the global app root / query-client boundary (where the `ApiError` seam mounts).
- `classlite-landing/src/content/en.ts` + `vi.ts` (descriptions only) + `check-landing-parity.mjs` (only if a locked value legitimately changes — it should not).
- `classlite-api/api.yaml` (strip PROVISIONAL from billing schemas; the `ErrorBody.details` fix only if Zod-parse proves it needed) → then `codegen.sh`; preserve every other schema.

### Guardrails (project-context)
- TS-1 explicit `null`; TS-2 no form state from generated types; TS-3 key factories; TS-4 unwrap in the query fn; TS-6 dates ISO until the i18n formatter (`resetAt`/period end, `dd/MM/yyyy` VI).
- FW-3 explicit `staleTime`; FW-4 no `useEffect` fetching; FW-7 tiers (`PlanUsageMeter`/`PlanLimitBanner` → `domain/`; pages → `features/billing/`; never touch `ui/`).
- UX-1 trilogy; UX-2 EN+VI lockstep; UX-3 route+`PermissionDenied` gating; CQ-3 integer VND.
- TEST-FE-1 MSW only seam; TEST-FE-2 three states; TEST-FE-4 i18n both locales; TEST-FE-6 non-owner → absent from DOM.

### WF-8 testing note (re-scored at party-mode — Murat)
The FE slice carries **two ≥6 risks** that the v0.1 note mis-inherited as "backend-only": **FR1 wrong price / VAT-derivation displayed (P2×I3 = 6)** and **FR2 Free user shown a false credit/entitlement state — `isFree`/`creditsApplicable` ignored or inverted (P2×I3 = 6)**. Money surfaces carry intrinsic Impact 3. **Ducdo ruled 2026-09-30: ATDD red-first is MANDATORY for the FR1 + FR2 slices** (not the whole story — CTA-copy ATDD would be theater), red before `in-progress`. Also flagged: **contract-drift 9-1b↔9.2 (P2×I3 = 6)** — the 409/402 dialogs have zero e2e reachability until 9.2, so the MSW mock is the only signal; mitigate with **codegen-typed fixtures** (Task 5) + **FU-9-CONTRACT-402** (a provider-verification obligation on 9.2 against 9-1b's assumed shape). Standard TEST-FE-* coverage otherwise mandatory. Post-dev `/bmad-tea TA` + `RV`.

### Project Structure Notes
- New: `classlite-web/src/features/billing/` (`PlanPickerPage.tsx`, `BillingDashboardPage.tsx`, `api/{billingKeys,useBillingSummary,useBillingPlans}.ts`, `lib/{errorKey,typeGuards,formatVnd}.ts`, components + `__tests__`); `components/domain/PlanUsageMeter.tsx` + `PlanLimitBanner.tsx` (+ Storybook + tests); a global `ApiError` dialog seam at the app/query-client boundary. Feature dir kebab; components PascalCase; hooks `useX.ts`.

### References
- [Source: epic-09.md#Story 9.1] — pricing display (:33-35), Free CTA (:37-39), picker s68 (:41-45), soft-usage (:47-52), hard block (:53-57), dashboard s69 (:59-61), `PLAN_LIMIT_EXCEEDED` (:63-66).
- [Source: 9-1a-plan-tiers-and-limit-enforcement-backend.md] — D4/D9/D22/D23/D24 FE contract (:39-64), Out-of-Scope split (:219-228).
- [Source: classlite-api/api.yaml:7062-7280] — billing paths + `Billing*`/`PlanCatalog*` PROVISIONAL; `ErrorBody.details` (:10389-10404).
- [Source: classlite-api/internal/plan/plan.go] — locked catalog. [error_mapper.go:36-71,429-448] — 409/402 details + status.
- [Source: ux-design-specification.md] — s68/s69 (:514-515), s72 banner (:518), `um-bar` `.warn` (:297), tabbed-shell (:397), mock `docs/classlite-entry/07-billing.html`.
- [Source: docs/bmad-story-conventions.md] — money boundary D25. [docs/project-context.md] — TS/FW/UX/TEST-FE/CQ/WF rules.

## Definition of Done

- AC1–AC21 met; plan picker (s68) + billing dashboard (s69) + `PlanUsageMeter` + `PlanLimitBanner` + latent 409/402 dialogs render from the frozen 9-1a contract.
- **No "Upgrade" verb anywhere** (D-9-1b-1): Free CTAs = "See plans" → picker; picker non-current CTAs = "Talk to us about {tier}" `mailto:`; dialog CTAs = "See plans". Banner = calm factual usage, no threat language (D-9-1b-2).
- 409/402 dialogs mounted at a **global `ApiError` seam**, **enrolment wired**, staff/class/AI FU'd (D-9-1b-3). `ErrorBody.details` read via runtime guard; shared `oneOf` NOT widened (D-9-1b-4).
- **ATDD red-first landed for FR1 (price/VAT) + FR2 (isFree/creditsApplicable)** before `in-progress`.
- Contract co-finalized (billing PROVISIONAL stripped, Zod-parse gap resolved if present, codegen, `tsc -b`=0); `billing.*` i18n EN+VI lockstep incl. the one shared "owner's job" key. No float money; no `useEffect` fetching; no mocked TanStack Query; axe clean on new pages. Sibling `9-1b-…-completion-notes.md` written at dev pickup.

### Test scenario matrix (P0 = merge-blocking; P1 = must-exist-or-waiver) — Murat
| ID | Scenario | AC | Pri |
|----|----------|----|-----|
| C1 | Landing price per tier matches CI-locked figure, monthly AND annual | A | P0 |
| C2 | VAT: displayed subtotal == round(price/1.1), VAT-inclusive, round-half-up boundary | A,B | P0 |
| C3 | isFree=true → "See plans" CTA present AND AI-credit meter ABSENT from DOM | C | P0 |
| C4 | isFree=false → credit meter present AND lead-CTA/replacement ABSENT | C | P0 |
| C5 | creditsApplicable true vs false both covered | C | P0 |
| C6 | Teacher → billing card + any manage-billing affordance ABSENT from DOM (s68 & s69) | C,G | P0 |
| C7 | 409 → dialog copy keyed on `code`, details limit/current/max rendered; fixture codegen-typed | E,F | P0 |
| C8 | 402 INSUFFICIENT_CREDITS → available/required rendered; 402 w/ UNKNOWN code → generic fallback (guard discriminates) | E,F | P0 |
| C9 | max=null → "Unlimited", no NaN ratio, `.warn` suppressed; max=N → "N of M" | C,D,H | P0 |
| C13 | Every rendered billing string resolves in EN AND VI (assert node ≠ raw `billing.*` key) | F | P0 |
| C15 | Three-state trilogy on the billing query hooks (loading/success/error) | F | P0 |
| C10 | approaching=true → `.warn`; approaching=false → no `.warn` | C,D | P1 |
| C11 | canManageBilling owner→"See plans"; teacher→"ask owner", CTA ABSENT | D,E | P1 |
| C12 | PlanLimitBanner renders factual count, no threat language, dismissible | D | P1 |
| C14 | axe-core clean on s68 + s69 + both dialogs (P0 if the annual/monthly toggle is a custom control) | E | P1 |
| C16 | Zustand reset between billing tests (no current-plan bleed) | — | P1 |

## Out of Scope (belongs to 9.2 / 9.3)

- **Upgrade/downgrade/proration + AI-credit add-on purchase** (write paths, Polar checkout, upgrade modal s71) → **9.2**. 9-1b CTAs route to the picker or an email contact only.
- **Arming enforcement** (`BILLING_ENFORCEMENT_ENABLED` ON) + **escalating the AC12 banner to amber "approaching limit" + upgrade path** → **9.2**.
- **FU-9-1B-DIALOG-WIRING** — wiring the 409/402 dialogs into staff-invite / class-create / AI-grade mutations → **9.2** (where those errors fire). 9-1b builds the global seam + wires enrolment only.
- **FU-9-CONTRACT-402** — provider-verification of the armed 409/402 `details` shape against 9-1b's assumed contract → obligation on **9.2** (dark-launch means no other net catches drift).
- **Next-invoice + payment-method cards** (D-DASH) → **9.2**. **Invoice history s70, CSV/email export, grace-period red top strip (`BillingGraceBanner` via `AppShell.banner`), auto-downgrade UI** → **9.3**.
- **Owner-dashboard plan/seat capacity card** — FU-8-1-A was dropped as an orphan at 8-1a party-mode; 9-1a's `GetUsageAndLimits` merely provides the data source now; wiring a capacity card is an optional later enhancement, not a 9-1b AC.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-30 | v0.3 | DEV COMPLETE (Amelia /bmad-dev-story 9-1b). All 7 tasks / 21 ACs. Implemented to green over the 5 ATDD reds (28 assertions) + 12 green-phase tests (banner C12, i18n-parity C13, seam+store-reset C16, axe C14) → 40 billing tests pass; full web `tsc -b` = 0. Data layer (`billingKeys`/`useBillingSummary`/`useBillingPlans`) · `PlanUsageMeter` (AC21, new `lib/formatDataSize`) + Storybook · plan picker s68 (`PlanCard`/`PlanPickerPage`, local-`useState` toggle) · billing dashboard s69 (Free-tier "See plans" branch, no 0/0 meter) · latent 409/402 dialogs + runtime type-guards + **global `ApiError` seam** (store→`reportBillingError`→`BillingErrorDialogHost` in AppLayout, **enrolment wired only**) · `PlanLimitBanner` (calm, no threat language) · owner-gated routes · `billing.*` i18n (en+vi lockstep, shared `askOwner` owner's-job key) · TS-6 `vnDate` i18n formatter · PROVISIONAL stripped from billing schemas + `client.ts` regen (types unchanged) · landing tier-description corrections (Free/Pro/Studio → catalog-accurate, `check-parity` green). Deferrals: FU-9-1B-DIALOG-WIRING (staff/class/AI, 9.2), FU-9-1B-TOGGLE-PERSIST (9.2), FU-9-1B-BANNER-WIRING (per-class roster surface not built yet). See sibling completion-notes. Status → review. | Amelia |
| 2026-09-30 | v0.2 | PARTY-MODE PRE-DEV REVIEW (Sally/Amelia/Murat/Winston independent subagents; John ruled 3 product forks; Ducdo 2 rulings). Stays ready-for-dev. **Ducdo rulings:** contact channel = **email** (`mailto:` for "Talk to us"); **ATDD red-first MANDATORY for FR1/FR2 slices**. **Folded:** D-9-1b-1 no dead "Upgrade" verb → "See plans"/"Talk to us" (John); D-9-1b-2 usage banner ships LIVE with threat language stripped, amber escalation → 9.2 (John, resolves Sally's cry-wolf blocker); D-9-1b-3 global `ApiError` seam + enrolment-only wiring, staff/class/AI → FU-9-1B-DIALOG-WIRING (John/Amelia/Winston); D-9-1b-4 keep the type-guard, do NOT widen the shared `ErrorBody.details` oneOf, verify FE Zod-parse for a latent 9-1a bug, strip PROVISIONAL from billing schemas only (Amelia/Winston/Murat). Risk re-scored: FR1 wrong-price + FR2 false-credit each ≥6; contract-drift ≥6 → codegen-typed MSW fixtures + FU-9-CONTRACT-402. DoD test-type checklist replaced with a P0/P1 scenario matrix. New AC21 (PlanUsageMeter variant contract). Nits folded: shared "owner's job" i18n key, AC4 local-state + persisted toggle, `dd/MM/yyyy` VI date, `max===null` suppresses `.warn`. | Amelia |
| 2026-09-30 | v0.1 | Created via `/bmad-create-story 9-1b` (Amelia). Frontend slice over the DONE 9-1a keystone. 3-artifact parallel recon (dashboard FE scaffold · landing pricing · frozen 9-1a contract). Status → ready-for-dev. | Amelia |
