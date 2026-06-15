---
title: 'TEA Test Design → BMAD Handoff Document'
version: '1.1'
workflowType: 'testarch-test-design-handoff'
inputDocuments:
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/test-design-progress.md'
  - '_bmad-output/implementation-artifacts/1d-1-storybook-foundation.md'
  - '_bmad-output/implementation-artifacts/1d-2-shadcn-primitive-coverage.md'
  - '_bmad-output/implementation-artifacts/1d-3-app-shell-stack.md'
  - '_bmad-output/implementation-artifacts/1d-4-phase4-visual-bridge.md'
sourceWorkflow: 'testarch-test-design'
generatedBy: 'TEA Master Test Architect (Murat)'
generatedAt: '2026-06-04'
lastRefresh:
  date: '2026-06-15'
  scope: 'Epic 1D (1d-1..1d-4) story-level AC patterns + risk-to-story mapping additions'
projectName: 'ClassLite v2'
---

# TEA → BMAD Integration Handoff — ClassLite v2

## Purpose

Bridges TEA's system-level test design with BMAD's epic/story workflows (`bmad-create-epics-and-stories`, `bmad-create-story`, `bmad-testarch-atdd`). It surfaces the quality requirements that need to appear on every story's acceptance criteria so test development doesn't trail implementation.

## TEA Artifacts Inventory

| Artifact | Path | BMAD Integration Point |
|---|---|---|
| Test Design (Architecture view) | `_bmad-output/test-artifacts/test-design/test-design-architecture.md` | Epic quality requirements, gating decisions |
| Test Design (QA view) | `_bmad-output/test-artifacts/test-design/test-design-qa.md` | Story-level acceptance criteria recipes |
| Working notes (full risk register, all 380 scenarios) | `_bmad-output/test-artifacts/test-design/test-design-progress.md` | Reference; not for direct consumption |
| This handoff | `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md` | Input for `bmad-create-epics-and-stories` |

## Epic-Level Integration Guidance

### Risk References

The following risks (score ≥6) MUST appear as epic-level quality gates. No epic ships without its risks mitigated and tested.

| Epic | High-Priority Risks (score ≥6) Owned |
|---|---|
| **Epic 1A (Foundation)** | R1, R2, R3, R49 |
| **Epic 1B (Auth)** | R4, R5, R6, R7, R8, R13, R15 |
| **Epic 1C (Frontend Foundation + Landing)** | R38, R46 |
| **Epic 1D (Component Library Buildout — Path B)** | R38 (discharge via 1d-1 AC4), R39 (promoted monitor→active for Storybook builder), R51 (axe baseline drift), R52 (three-state variant explosion), R53 (designer token churn). See `test-design-architecture.md` § "Epic 1D Refresh (2026-06-15)". |
| **Epic 2 (Onboarding, Center, Roles)** | R1, R18 |
| **Epic 3 (Class Management & Scheduling)** | R19 |
| **Epic 4 (Exercise Authoring, AI Content, Knowledge Hub)** | R9, R23, R30, R49 |
| **Epic 5 (Assignments, Attempts, Submissions)** | R9, R42, R43 |
| **Epic 6 (Grading & AI-Assisted Grading)** | R16, R23, R30 |
| **Epic 7 (People, Enrollment, Q&A)** | R15, R17, R25, R26 |
| **Epic 8 (Analytics, Dashboards, Search)** | R26, R31 |
| **Epic 9 (Billing, Plans, Account)** | R11, R21, R22, R24 |
| **Epic 10 (Inbox, Notifications, Archive, Polish)** | R47 |
| **Cross-cutting (ops + infra)** | R36, R39, R46, R48, R50 |

### Quality Gates per Epic

| Epic | Gate (must pass before release) |
|---|---|
| Every epic | (1) all P0 tests touching the epic pass 100%; (2) all P1 ≥95%; (3) every risk score ≥6 owned by the epic has a linked test evidence path; (4) accessibility — zero axe violations; (5) bilingual parity — `assertI18nParity` green for every new key |
| Epic 1A | RLS adversarial suite green; audit append-only invariants enforced at DB layer; log-secret scanner green |
| Epic 1B | Cross-subdomain cookie auth verified; OAuth tenant-binding negative test green; refresh-token reuse-detection test green |
| Epic 1C | Landing → dashboard cross-domain E2E green; en + vi bilingual smoke green |
| Epic 1D | Storybook CI job green within 8-min soft cap (i18n parity + storybook:build + storybook:test all required per 1d-1 AC6); R38 discharge evidence (`assertI18nParity` red-phase + CI step) committed; `SidebarShell` four role variants AND `MobileTabBar` three role variants match `classlite-ia.md` lines 16–19 + Chapter 8 verbatim; static-shell discipline verified (zero `new Date()` calls in `src/components/domain/` 1d-4 files; every 1d-4 component has JSDoc naming feature-epic owner) |
| Epic 4 | Worker tenant-context harness adversarial tests green per job type; R2 cross-tenant prefix test green; AI credit refund-on-failure test green (depends on A6) |
| Epic 5 | Writing autosave under flaky-network E2E green; real iOS Safari speaking recorder verified |
| Epic 6 | Submission immutability test (DB trigger + service + E2E) green; AI grading mock-deterministic + nightly real-Gemini smoke green |
| Epic 7 | Enrollment_history append-only test green; Q&A role-scope negative test (Owner/Admin must see zero results) green |
| Epic 8 | Search role-scoping per role × per result type green; N+1 query-count assertion green on every dashboard endpoint |
| Epic 9 | Polar webhook signature + idempotency + replay tests green; plan grace state machine MockClock days 0/3/5/6/7 green; plan downgrade asserts feature pause NOT row deletion |

## Story-Level Integration Guidance

### P0/P1 Test Scenarios → Story Acceptance Criteria

Every story creator (using `bmad-create-story`) should encode these as acceptance criteria for the matching domain:

**Auth stories (1.5, 1.6):**
- AC: Login lockout after 5 fails in 10 min triggers 15-min cool-down; verified by integration test
- AC: Refresh token rotation revokes the family on reuse; verified by concurrent-rotation test
- AC: `Set-Cookie` response in non-dev env carries HttpOnly + Secure + SameSite + Domain=.classlite.app
- AC: CORS allowlist; no wildcard with credentials in any environment
- AC: Google OAuth callback rejects tokens bound to a different `center_id` than the requesting subdomain
- AC: Force-logout from Owner of Center A cannot affect users in Center B

**Authoring & Knowledge Hub stories (4.x):**
- AC: Presigned upload URL enforces `{center_id}/{feature}/{uuid}.{ext}` key shape server-side
- AC: Per-feature per-file size cap enforced and returns 413 with clear i18n error code (depends on A9)
- AC: AI generation job uses worker tenant-context harness; adversarial cross-tenant payload rejected
- AC: AI credit deducted only on job completion OR refunded on failure with append-only ledger entry (depends on A6)
- AC: Knowledge Hub file MIME validated against allowlist server-side BEFORE generating presigned URL

**Submission & grading stories (5.x, 6.x):**
- AC: Writing autosave debounce interval ≤500ms (depends on A4 threshold); recovers draft on reload
- AC: After release, `UPDATE submissions` where `released_at IS NOT NULL` rejected at DB trigger; service-layer test green
- AC: AI grading mock returns deterministic shape; teacher edit path verified; release path verified
- AC: Speaking audio upload supports retry up to 3 times; mobile-safari E2E green
- AC: AI credit refund on AI grading failure (depends on A6)

**Enrollment & people stories (7.x):**
- AC: enrollment_history row append-only; UPDATE/DELETE returns 403
- AC: Add/Transfer/Withdraw produces exactly one history row with performer + timestamp + effective_date
- AC: Q&A "Personal" / "Shared" visibility scopes verified; Owner/Admin see zero Q&A rows
- AC: At-risk thresholds (attendance <70%, ≥2 consecutive misses, band drop ≥1.0) verified by unit + integration tests

**Search & analytics stories (8.x):**
- AC: Cmd+K result scoping per role × per result type verified
- AC: `/api/search` p95 < 500ms under 50 concurrent users (k6 nightly)
- AC: Each dashboard endpoint asserted to have query count ≤ N (no N+1)

**Billing stories (9.x):**
- AC: Polar webhook signature verified; missing/wrong/replay rejected (depends on A2)
- AC: Webhook idempotent — second delivery of same event_id is no-op
- AC: Plan grace state machine driven by MockClock; days 0/3/5/6/7 23:59 events verified
- AC: Plan downgrade pauses features (AI, 2nd seat, classes >5 read-only) and does NOT delete data; restore verified
- AC: Invoice math (subtotal + VAT + prorated upgrade) matches PRD formula (depends on A8)

**Frontend foundation stories (1C):**
- AC: i18n key set in `en.json` ≡ `vi.json` (CI parity step green)
- AC: Cross-subdomain cookie auth: login on `classlite.app` redirect-to-`my.classlite.app` verified
- AC: WCAG 2.1 AA — zero axe violations on the new component
- AC: Loading / Empty / Error trilogy implemented for every data-fetching component

**Component library stories (1D — Storybook foundation through Phase-4 visual bridge):**

_For full P0–P3 decomposition see `test-design-qa.md` § "Epic 1D Refresh (2026-06-15)". Per-story risk + ATDD inheritance summarized below._

**Story 1d-1 — Storybook Foundation, Decorators & Vite Compat Spike:**
- AC: **AC4 inheritance contract — CORRECTED 2026-06-15** after `/bmad-tea AT` pre-flight discovered Story 1-7c (shipped 2026-06-12) already delivered the R38 four-layer mitigation. **No new helper / CI step / failing-fixture infrastructure required from 1d-1.** Existing artifacts on the branch: `classlite-web/src/lib/test/i18n-parity.ts` (`assertI18nParity(usedKeys, locales)` Vitest helper); `classlite-web/src/lib/test/i18n-parity.test.ts` (helper raises on missing key with readable diff); `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` (ATDD red specimen — `describe('Story 1-7c i18n parity (R38)', ...)`); `classlite-web/scripts/i18n-parity.mjs` (whole-file symmetric-diff CLI); `.github/workflows/ci-web.yml:69–77` (required `npm run i18n-parity` check labeled "Story 1.7c AC9 — R38 mitigation"). Per-story coverage specs (1d-2/1d-3/1d-4) extend the `i18n-parity-coverage.test.ts` file with new `describe('Story 1d-N i18n parity (R38)', ...)` blocks — inline dev work, NOT separate ATDD ceremony.
- AC: Three-tier Vite/Rolldown ladder records tier outcome in `classlite-web/docs/storybook-rolldown-spike.md` (Tier A preferred, Tier B dual-builder fallback, Tier C deferral requires PM + user re-scope approval) (1D-P0-004, 1D-P0-005, R39 mitigation)
- AC: Six-layer decorator stack in `preview.tsx` boots in documented composition order (Router outermost → MSW innermost; preview-side deps registered BEFORE decorators run); composition-order regression is a code-review reject (1D-P0-006)
- AC: `@storybook/test-runner` `postRender` hook enforces three-state required exports for `*Table.stories.tsx`/`*List.stories.tsx`/`*Card.stories.tsx`/`*Hero.stories.tsx`/`*Shell.stories.tsx` — ERROR ON MERGE from day 1; `fixtures/missing-empty-export.stories.tsx` negative fixture asserts the rule FAILS (1D-P0-007, R52 mitigation)
- AC: `@storybook/test-runner` `prerender` hook enforces FW-7 component placement; misplaced-fixture asserts rule FAILS (1D-P0-008)
- AC: CI `storybook` job green end-to-end within 8-minute soft cap; shard-by-pattern documented if runtime trends > cap after 100 stories (1D-P0-010, R39 + R51 + R52)
- AC: Smoke story `Button.stories.tsx` passes all six gates (locale en/vi, role owner/admin/teacher/student, axe zero violations, i18n parity, three-state lint negative-fixture proof, FW-7 placement) (1D-P0-009, 1D-P0-010)
- **Risk inheritance (CORRECTED 2026-06-15):** Owns R39 (mitigation via three-tier ladder) + R52 (mitigation via mechanical CI lint). **R38 was already discharged at Story 1-7c** (not 1d-1 AC4 as originally documented) — 1d-1 AC4 carries the inheritance contract pointing at 1-7c's artifacts. No WF-8 ATDD red phase required for any Epic 1D story. The R39 + R52 mitigations are foundation-level (one-time work in 1d-1) and inherited by 1d-2/1d-3/1d-4 via CI gates — no per-story ATDD ceremony downstream.
- **Mock seam:** TEST-FE-1 — MSW handlers wired via `msw-storybook-addon` in `preview.tsx`; `Empty` stories driven by `HttpResponse.json({ data: [] })`, NEVER by mocking `useQuery` (convention shipped in `storybook-conventions.md` § 6).

**Story 1d-2 — Shadcn Primitive Coverage & Token Theming:**
- AC: All 34 primitives installed at `src/components/ui/<component>.tsx` via `npx shadcn@latest add` and pinned in `components.json` per FW-7; never hand-edited beyond AC7 token-swap pass (XL-1)
- AC: Per-primitive `*.stories.tsx` exports the variant matrix listed per AC1–AC6 (e.g. `Button` exports 11 variants; `Calendar` exports `LocaleEn`+`LocaleVi`+5 others); each variant renders zero axe violations (1D-P1-001..030, R51)
- AC: `Form.stories.tsx` `WithRHFAndZodResolver` is the canonical RHF + `zodResolver` wiring story that 1d-7 and every Epic 2–10 form story inherits verbatim (1D-P0-012, 1D-P1-031..035)
- AC: Overlay primitives (`Dialog`/`AlertDialog`/`Sheet`/`Drawer`) `play` functions assert focus return to trigger on `Escape` (1D-P1-036..040, TEST-UX-2)
- AC: Menu/command primitives `play` functions assert arrow-key + Enter + Escape keyboard nav (1D-P1-041..044, TEST-UX-2)
- AC: `Calendar.stories.tsx` does NOT call `new Date()` in render; uses `parameters.now: '2026-06-15T00:00:00Z'`; `LocaleVi` story renders Vietnamese date format via `vi` from `date-fns/locale` (1D-P0-013, 1D-P0-014, TS-6 + UX-2)
- AC: Token compliance — zero raw hex values, zero default shadcn `slate-*`/`zinc-*`/`neutral-*` Tailwind classes in `src/components/ui/`; Pattern 1 (`:root` CSS-variable override) preferred over Pattern 2 file edits (1D-P0-011, R53 mitigation)
- AC: All 34 primitive stories pass `en` + `vi` locale toolbar switching with `Tooltip`/`Popover`/`Select`/`Calendar` `LongVietnameseContent` variants verifying ~1.5x overflow behavior (1D-P1-045..048, R38 + UX-2)
- AC: `Skeleton` + `Progress` honor `prefers-reduced-motion` via `parameters.reducedMotion: 'reduce'` (1D-P1-049..052, TEST-UX-2 a11y)
- **Risk inheritance:** None owned (R38 discharged at 1d-1 layer, R51/R52 mitigated by 1d-1 CI gates). No score ≥6 ACs — per the story's own AC block, WF-8 ATDD red tests are NOT mandatory; coverage enforced mechanically via Tasks checklist + CI gates.
- **Mock seam:** TEST-FE-1 — `Form.stories.tsx` fake mutation handler is a documented exception (returns resolved promise, NOT an MSW handler); `Sonner.stories.tsx` triggers via story controls. No MSW needed elsewhere in 1d-2.

**Story 1d-3 — App-Shell Stack (Sidebar, Topbar, Navigation, Mobile Tab Bar):**
- AC: 10 components in `src/components/domain/` (`AppShell`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `UserPill`, `PageHead`, `SidebarNavItem`, `SidebarShell`, `MobileTabBar`, `MobileTab`) each with explicit TS `Props` interfaces (per 1d-3 AC1 + AC2)
- AC: `SidebarShell` four role variants — `OwnerView` matches `classlite-ia.md` line 16 (9 items), `AdminView` matches line 17 (Owner MINUS `Settings`), `TeacherView` matches line 18 (10 items) AND asserts ABSENCE of `Settings`+`People`, `StudentView` matches line 19 (7 items) AND asserts ABSENCE of `Settings`/`People`/`Knowledge hub`/`Archive`/`Analytics` (1D-P0-015..018, IA fidelity + TEST-FE-6)
- AC: `MobileTabBar` three role variants — `StudentView`/`TeacherView`/`OwnerView` each render the 5-tab set from `classlite-ia.md` Chapter 8 verbatim; AdminView NOT a separate variant (shares Owner mobile per IA convention) (1D-P0-019, UX-4 + UX-DR32)
- AC: `AppShell` `Mobile` story asserts `SidebarShell` is ABSENT from the DOM (not just CSS-hidden) at sub-`md` breakpoints — verified in `play` function per TEST-FE-6; `MobileTabBar` renders `position: fixed bottom-0` via Tailwind utilities, never magic-pixel media queries or JS viewport listeners (1D-P0-020)
- AC: `SidebarNavItem` badge composes 1d-2's `Badge` primitive with amber accent; `aria-label` includes count + item name (`"Inbox, 3 unread"`); active row carries `aria-current="page"` (1D-P1-060..065, a11y contract)
- AC: `PageHead` is the only data-rendering component in 1d-3 — ships three-state coverage (Default+Loading+Empty+Error) using `EmptyStatePlaceholder`/`ErrorStatePlaceholder` from 1d-1; other 6 shell components are pure layout and ship `Default` only (1D-P1-053..059)
- AC: Vietnamese rendering at 220px sidebar — no layout breakage; truncation with focus-revealed tooltip is the documented fallback for long Vietnamese labels (1D-P1-089..094, R38 + UX-2)
- AC: All nav/role/tab labels resolve via i18n keys (`sidebar.owner.dashboard`, `mobileTab.student.home`, etc.); zero hardcoded English in `src/components/domain/` (1D-P1-082..088, UX-2 + TEST-FE-4)
- AC: Stable `data-testid` selectors (`sidebar-nav-{slug}`, `mobile-tab-{slug}`, `user-pill-role`, `breadcrumb-current`) documented in `storybook-conventions.md` as canonical pattern (1D-P1-109..114)
- **Risk inheritance:** None owned (R38 inherited from 1d-1 CI gate). No score ≥6 ACs — pure layout, no security/tenant/auth surface; consumers pass role as prop, route layer owns gating per UX-3. WF-8 ATDD red tests NOT mandatory.
- **Mock seam:** TEST-FE-1 — shell components don't fetch data. `Inbox` badge count is passed as a prop; Epic 2+ stories owning the inbox state machine wire MSW. No MSW handlers in 1d-3.

**Story 1d-4 — Phase 4 Visual Bridge (Static Shells):**
- AC: 8 components + 2 sub-components (`CommentCard` shared between AC2 and AC3) in `src/components/domain/` ship as STATIC VISUAL SHELLS — every callback prop defaults to a no-op; ZERO autosave timers, ZERO anchor persistence, ZERO Web Audio API, ZERO TanStack Query, ZERO `useMutation` (load-bearing 1d-4 discipline)
- AC: Each 1d-4 component carries a JSDoc header naming the feature epic + story that will wire behavior (`WriteDocSurface` → Epic 5 Story 5.3; `WritingGradingSurface` → Epic 6 Story 6.1; `SpeakingGradingSurface` → Epic 6 Story 6.3; `AnchoredQuestionCard` → Epic 7 Story 7.4; `MobileWritingSurface` → Epic 5 Story 5.3 mobile; `InboxListShell` → Epic 10 Story 10.1; `AnalyticsHomeShell` → Epic 8 Story 8.2) (1D-P0-023)
- AC: Three-state coverage on each data-rendering shell using `EmptyStatePlaceholder`/`ErrorStatePlaceholder` from 1d-1 until Epic 10 ships the real `EmptyState`/`ErrorState` (1D-P1-070..081, R51 + R52)
- AC: `WritingGradingSurface` renders the THREE-color comment taxonomy verbatim (red `--cl-status-danger` errors, green `--cl-status-success` praise, amber `--cl-accent-2` suggestions); band-score typography passes UX-DR22 spec (Geist Mono 28px primary, 14px per-criterion) (1D-P1-095..104, R53 designer-iteration surface)
- AC: `SpeakingGradingSurface` ships fixture waveform SVG only (NO audio decode, NO Web Audio API); pin chrome uses same taxonomy colors as `WritingGradingSurface`
- AC: `AnchoredQuestionCard` ships `variant` prop (`teacher-answer` | `student-ask`) — NOT a role-conditional component (the variant is a layout switch like `Tabs`, not a role-rendering decision per UX-3)
- AC: `MobileWritingSurface` ships at locked `iphone-14` (390×844) viewport via `parameters.viewport.defaultViewport`; is a purpose-designed mobile component, NOT a responsive squish of `WriteDocSurface` (per UX-4 + UX-DR32)
- AC: `InboxListShell` ships THREE separate role-variant stories (`TeacherView`/`StudentView`/`AdminOwnerView`) — NOT a single conditional component branching on role internally (1D-P0-021, UX-3 + UX-DR29)
- AC: `AnalyticsHomeShell.ScopeBar` `TeacherView` story renders "Center-wide" scope pill DISABLED (visually + functionally) per UX-DR29; `AdminView`/`OwnerView` render all scope pills enabled (1D-P0-022)
- AC: Zero `new Date()` calls in any 1d-4 component file (greppable — `src/components/domain/` for 1d-4 files); all ISO strings use `parameters.now: '2026-06-15T00:00:00Z'` pattern (1D-P0-024, TS-6)
- AC: `assertI18nParity()` passes — every new key added by 1d-4 is in both `en.json` and `vi.json` (1D-P0-025, R38 inheritance from 1d-1 CI gate)
- AC: Zero axe violations across every 1d-4 story; touch targets ≥ 44×44px on `MobileWritingSurface` per TEST-UX-4 (1D-P1-105..108)
- **Risk inheritance:** None owned (R38 inherited; R51 mitigated by axe CI gate; R52 mitigated by three-state lint). No score ≥6 ACs — static visual shells, no security/tenant/auth surface. WF-8 ATDD red tests NOT mandatory.
- **Mock seam:** TEST-FE-1 — static shells don't fetch data. Storybook stories drive every render via fixture props. No MSW handlers in 1d-4. Feature epics inheriting these shells (Epic 5/6/7/8/10) wire MSW at the HTTP boundary per their own ACs.

### Data-TestId Requirements

ClassLite project-context (TEST-FE-1, TEST-FE-5) prefers `role` queries over `data-testid`. Use `data-testid` only where:
- a stable `role` is impossible (deeply nested div hierarchies)
- the element is purely visual (skeletons, spinners)
- a test needs to disambiguate identical-named buttons (e.g., "Save" in modal vs page)

Required `data-testid` attributes (mandate via lint or design-review):

| Attribute | Where | Why |
|---|---|---|
| `skeleton-*` | Every loading skeleton (e.g., `skeleton-class-list`, `skeleton-grading-view`) | Asserting loading state per TEST-FE-2 |
| `empty-state-*` | Every empty UI per UX-1 | Asserting empty state |
| `error-alert-*` | Every error UI per UX-1 | Asserting error state |
| `saving-indicator` | Writing editor save indicator | TEST-UX-3 autosave assertions |
| `billing-section` | Owner-only billing area | Role-negative test (Admin/Teacher/Student must NOT see) |
| `q-a-panel` | Q&A thread sidebar | Owner/Admin role-negative test |

## Risk-to-Story Mapping

| Risk ID | Category | P×I | Score | Recommended Story / Epic | Test Level |
|---|---|---|---|---|---|
| R1 | DATA/SEC | 3×3 | 9 | Epic 1A — golangci-lint analyzer story; every epic adding tables tests cross-tenant grid | Go integration (J15 grid) |
| R3 | DATA/SEC | 3×3 | 9 | Epic 4 (first worker), then every worker epic | Go worker integration (J15-NULL workers) |
| R2 | DATA/SEC | 2×3 | 6 | Epic 1A + per epic adding tables | Go store integration |
| R4 | SEC | 2×3 | 6 | Story 1.5 | Go handler integration + Playwright |
| R5 | SEC | 2×3 | 6 | Story 1.5 | Go service integration |
| R6 | SEC | 2×3 | 6 | Story 1.6 | Playwright E2E |
| R7 | SEC | 2×3 | 6 | Story 1.5 + 1.6 | Go handler integration |
| R8 | SEC | 2×3 | 6 | Story 1.2a CORS extension story | Go handler integration |
| R9 | SEC | 2×3 | 6 | Story 4.x file upload + dedicated R2 security story | Go handler + Playwright |
| R11 | SEC | 2×3 | 6 | Story 9.3 webhook story | Go handler integration |
| R13 | SEC | 2×3 | 6 | Story 1.5 | Go handler integration + k6 burst |
| R15 | SEC | 2×3 | 6 | Epic 7 (re-validates roles) | Go service integration |
| R16 | DATA | 2×3 | 6 | Epic 6 (immutability story) | DB trigger + Go integration + Playwright |
| R17 | DATA | 2×3 | 6 | Epic 7 (enrollment history story) | Go store integration |
| R19 | DATA | 3×2 | 6 | Epic 3 recurring session story | Go service integration |
| R21 | BUS | 2×3 | 6 | Epic 9 grace period story | Go service integration with MockClock |
| R22 | BUS | 2×3 | 6 | Epic 9 plan limit story | Go service integration |
| R23 | BUS | 3×2 | 6 | Epic 6 AI grading story (depends on A6) | Go worker integration |
| R24 | BUS | 2×3 | 6 | Epic 9 downgrade story | Go service integration + Playwright |
| R26 | BUS | 2×3 | 6 | Epic 8 search story | Go handler integration + Playwright |
| R31 | PERF | 2×3 | 6 | Every dashboard endpoint story across Epics 7/8 | Go service integration (query-count) |
| R38 | TECH | 3×2 | 6 | Epic 1C (i18n setup story) + every component story; **discharge evidence at Story 1-7c (shipped 2026-06-12) — CORRECTED 2026-06-15 after `/bmad-tea AT` pre-flight discovery.** Four-layer mitigation: `assertI18nParity(usedKeys, locales)` Vitest helper (`src/lib/test/i18n-parity.ts`) + helper tests + ATDD red specimen (`i18n-parity-coverage.test.ts`) + `npm run i18n-parity` CI step (ci-web.yml:69-77). Epic 1D inherits via per-story `describe('Story 1d-N i18n parity (R38)', ...)` blocks in `i18n-parity-coverage.test.ts` (inline dev work, no separate ATDD ceremony). | Vitest helper + CI step (both pre-existing) |
| **R39** | TECH | 2×3 | **6** | **Epic 1D Story 1d-1 AC1** — three-tier Vite/Rolldown compatibility ladder (Tier A Rolldown preferred / Tier B dual-builder fallback / Tier C deferral with PM + user re-scope approval); promoted from MONITOR to MITIGATE for Epic 1D scope | Spike + storybook:build CI gate |
| **R51** | TECH | 2×2 | 4 | Epic 1D — every Storybook story across 1d-2/1d-3/1d-4 | `@storybook/addon-a11y` + `vitest-axe` `toHaveNoViolations` in `storybook:test` CI |
| **R52** | TECH | 3×2 | **6** | Epic 1D Story 1d-1 AC3 — three-state required-exports `@storybook/test-runner` `postRender` hook with negative-fixture proof; error on merge from day 1 | CI lint with `missing-empty-export.stories.tsx` negative fixture |
| **R53** | TECH | 2×2 | 4 | Epic 1D 1d-2 AC7 token discipline — Pattern 1 (`:root` CSS-variable override) preferred over Pattern 2 file edits; designer reviews Storybook artifact from CI | Manual review + grep for raw hex / shadcn neutral classes in `ui/` |
| R42 | TECH | 2×3 | 6 | Epic 4 writing editor story | Vitest + Playwright |
| R46 | OPS | 2×3 | 6 | DevOps CI guard story (cross-cutting) | CI step |
| R48 | OPS | 2×3 | 6 | DevOps story to define SLO + plan replica | Architecture decision |
| R49 | OPS | 2×3 | 6 | Epic 4 (first AI integration) + DevOps log scanner | CI step + Go test |
| R50 | OPS | 2×3 | 6 | Per-migration story | CI migration round-trip test |

## Recommended BMAD → TEA Workflow Sequence

1. **TEA Test Design (this workflow)** — produces this handoff document. ✅ COMPLETE.
2. **Architecture team resolves BLOCKERS** (A2, A6, A7, A8, A9, A10, SLO) — see Architecture doc.
3. **BMAD `bmad-create-epics-and-stories`** consumes this handoff; embeds quality gates and risk ownership into epics.
4. **BMAD `bmad-create-story`** per story embeds the matching ACs from "P0/P1 Test Scenarios → Story Acceptance Criteria" above.
5. **TEA `bmad-testarch-atdd`** per story generates failing acceptance tests before dev starts.
6. **BMAD `bmad-dev-story`** developers implement to make the failing tests pass.
7. **TEA `bmad-testarch-automate`** generates the broader test suite for each story.
8. **TEA `bmad-testarch-trace`** validates AC-to-test coverage and produces gate decision.
9. **TEA `bmad-testarch-nfr`** consumes the NFR evidence artifacts from this plan once implementation exists.
10. **Release gate** — pass all the above.

## Phase Transition Quality Gates

| From Phase | To Phase | Gate Criteria |
|---|---|---|
| Test Design | Epic / Story Creation | All P0 risks have mitigation strategy; 7 BLOCKERS decided |
| Epic / Story Creation | ATDD | Stories have acceptance criteria from this handoff embedded |
| ATDD | Implementation | Failing acceptance tests exist for all P0 + P1 scenarios on the story |
| Implementation | Test Automation | All acceptance tests pass; per-story trace coverage ≥ 90% AC mapping |
| Test Automation | Release | `bmad-testarch-trace` shows ≥80% AC coverage on P0/P1 across the system; `bmad-testarch-nfr` shows PASS or CONCERNS with waivers on every in-scope NFR; flaky ratio <2% rolling 30 days |

---

**End of handoff.**

**To consume this:** open `bmad-create-epics-and-stories` and paste/point it at this file; it should produce epics with embedded quality gates and stories with embedded ACs derived from the mapping above.
