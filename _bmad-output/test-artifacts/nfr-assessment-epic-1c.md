---
stepsCompleted:
  - step-01-load-context
  - step-02-define-thresholds
  - step-03-gather-evidence
  - step-04-evaluate-and-score
  - step-05-generate-report
lastStep: 'step-05-generate-report'
lastSaved: '2026-06-30'
inputDocuments:
  - _bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md
  - _bmad-output/test-artifacts/test-design/test-design-architecture.md
  - _bmad-output/test-artifacts/test-design/test-design-qa.md
  - _bmad-output/test-artifacts/test-design/classlite_new-handoff.md
  - _bmad-output/test-artifacts/traceability/traceability-matrix-epic-1c.md
  - _bmad-output/test-artifacts/test-reviews/test-review-epic-1c.md
  - _bmad-output/test-artifacts/msw-handler-catalog-auth.md
  - .github/workflows/ci-web.yml
  - .github/workflows/ci-landing.yml
  - classlite-web/axe.allowlist.json
  - docs/project-context.md
scope: Epic 1C — Frontend Foundation & Landing Page (Stories 1.7a + 1.7b + 1.7c + 1.8 + 1.9a + 1.9b + 1.9c + 1.9d + 1.10)
nfr_categories_audited: [Security, Performance, Reliability, i18n_Foundation, Accessibility, Maintainability]
nfr_verdict: PASS-with-CONCERNS
nfr_confidence: high
threshold_source: epic-01c-frontend-landing.md NFR block (primary); test-design-architecture.md § NFR Testability Requirements (secondary); project-context.md TS-/FW-/UX-/TEST-FE rules (tertiary)
---

# NFR Evidence Audit — Epic 1C

**Scope:** Frontend Foundation & Landing Page — 9 stories spanning React 19 dashboard auth UI (1.7a/b/c, 1.8, 1.9a-d) + Astro static landing (1.10).
**Threshold source:** Epic file's NFR block (NFR-1, NFR-3, NFR-5) — primary. `test-design-architecture.md` § NFR Testability Requirements — secondary. `docs/project-context.md` TS-/FW-/UX-/TEST-FE rules — tertiary.
**Companion artifacts:** RV report (`test-review-epic-1c.md`) + Trace matrix (`traceability/traceability-matrix-epic-1c.md`).

## Verdict at a glance

| Category | Verdict | Confidence |
|---|---|---|
| **NFR-1: i18n Foundation** (R38 mitigation + cross-domain cookie) | **PASS** | high |
| **NFR-3: Performance Baseline** — Bundle splitting | **PASS** | high |
| **NFR-3: Performance Baseline** — Static Astro landing (0-JS budget) | **PASS** | high |
| **NFR-3: Performance Baseline** — Lighthouse CI gate | **CONCERNS** | medium |
| **NFR-5: Accessibility Foundation** — WCAG 2.1 AA | **PASS** | high |
| **NFR-5: Accessibility Foundation** — aria-live announcements | **PASS** | high |
| **NFR-5: Accessibility Foundation** — Touch targets + responsive | **PASS** (1 P2 gap — see RV G1) | high |
| **NFR-5: Accessibility Foundation** — `prefers-reduced-motion` respect | **PASS** | high |
| Security — Cookie attributes (httpOnly + Secure + SameSite + Domain) | **PASS** | high |
| Security — Open-redirect prevention (`sanitizeNextParam`) | **PASS** | high |
| Security — Anti-enumeration (forgot-password timing + body parity) | **PASS** | high |
| Security — OAuth error param plumbing (R-NEW-54-like for client side) | **PASS** | high |
| Security — Landing→Dashboard URL allowlist (**R-NEW-55**) | **PASS** | high |
| Security — Email enumeration via verify polling (terminal-state ref) | **PASS** | high |
| Reliability — Silent token refresh + retry (TEST-FE-1 mock seam respected) | **PASS** | high |
| Reliability — Multi-tab coordination (`navigator.locks` + BroadcastChannel) | **PASS** | high |
| Reliability — Verification polling terminal-state race | **PASS** | high |
| Reliability — ErrorBoundary (Sentry event ID surfaced) | **PASS** | high |
| Reliability — Lockout state persistence + rehydrate | **PASS** | high |
| Maintainability — Code quality (deferred to RV report — 94/100, Grade A) | **PASS** | high |
| Maintainability — Test infrastructure single mock seam (TEST-FE-1) | **PASS** | high |
| Scalability — N/A (frontend-only scope) | **N/A** | n/a |

**Overall: PASS-with-CONCERNS.** The single CONCERN is the **absence of a Lighthouse CI gate** in `ci-landing.yml` despite `test-design-architecture.md` listing it as required tooling. Performance behavior (bundle splits + 0-JS landing) is otherwise enforced via dedicated CI checks. Not a launch blocker for epic-1c stories, but a precondition to closing the Performance Baseline NFR for production rollout.

---

## Category-by-category audit

### 1. NFR-1 — i18n Foundation (R38 discharge + cross-domain language continuity)

**Threshold (epic file line 48):** react-i18next with en.json + vi.json, runtime language switch, locale-aware formatting, language cookie shared across domains. Coupled to **R38 (score 6)** — Vietnamese-user-sees-raw-key.

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Layer 1 — Vitest helper | `classlite-web/src/lib/test/i18n-parity.ts` (`assertI18nParity(usedKeys, locales)`) + landing mirror `classlite-landing/src/lib/test/landing-i18n-parity.ts` | PASS |
| Layer 2 — Helper unit tests | `classlite-web/src/lib/test/i18n-parity.test.ts` (helper raises on missing key with readable diff) + `landing-i18n-parity.test.ts` | PASS |
| Layer 3 — Per-story coverage tests | `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` with `describe()` blocks for Story 1-7c / 1-8 / 1-9a / 1-9b / 1-9c / 1-9d / 1d-2 / 1d-3 / 1d-4 (closed enumeration). Landing mirror: `landing-i18n-parity-coverage.test.ts` with Story 1.10 closed enum + orphan key scan + 9 per-component tests (PricingCard, SocialProofCard, Hero, PainCalculator, Footer, PricingSection, StickyHeader, FeatureCard, SessionExpiredBanner) | PASS |
| Layer 4 — CI gate | `ci-web.yml` step "i18n parity (Story 1.7c AC9 — R38 mitigation)" runs `npm run i18n-parity` BEFORE Test step (fail-fast on drift). `ci-landing.yml` step "Story 1.10 AC8 — R38 Layer 4" runs `npm run check-parity` (CI parity script + LOCKED_PRICES check + orphan scan) | PASS |
| Cross-domain lang cookie (UX-DR17) | `classlite-web/src/lib/language-cookie.ts` + `useLanguageInit.ts` write/read `.classlite.app`-scoped `lang` cookie. Tests: `language-cookie.test.ts` + `cookie-domain.test.ts` + `useLanguageInit.test.tsx`. E2E proof: `dashboard-boots-in-vi.spec.ts` (cross-subdomain Playwright project asserts `lang=vi` cookie on `.classlite.localhost` → H1 renders in VI) + `landing.spec.ts` AC6 (toggle on `/vi/` writes `lang=en` cookie). | PASS |
| Cookie shape parity across codebases | `classlite-landing/src/lib/test/__tests__/hint-cookie-shape.test.ts` cross-codebase byte-string assertion + `ci-landing.yml` "Story 1.10 Task 9.7 — cookie-domain parity (sentinel comments)" | PASS |
| Runtime language switch | `LanguageToggle.test.tsx` (web) + `landing.spec.ts` "AC6 — language toggle + lang cookie" (landing) — both assert state preservation (`?billing=annual` survives toggle) and cookie write | PASS |
| Locale-aware formatting | i18next interpolation + plural handling enforced via project-context UX-2 + verified by `bilingual-smoke.spec.ts` per-locale rendering | PASS |
| Bilingual DOM scan (page-level safety net) | `classlite-web/e2e/bilingual-smoke.spec.ts` walks `/login`, `/register`, `/permission-denied`, `/this/does/not/exist`, `/dashboard` in both locales with `RAW_KEY_REGEX` to catch any raw-key leakage | PASS |

**Verdict: PASS (high confidence).** R38 has the most thorough defense-in-depth in the project. Four layers + cross-domain E2E + DOM scan + landing mirror. This is the project-wide reference impl for i18n risk mitigation.

---

### 2. NFR-3 — Performance Baseline

**Threshold (epic file line 49):** Lazy-loaded route chunks (student, teacher, auth), static Astro HTML for landing page, no JS required for PainCalculator.

#### 2a. Bundle splitting (web)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Auth chunks isolated from dashboard chunks | `classlite-web/e2e/route-bundle-boundaries.spec.ts` — 5 tests including iterated negative assertions across each `verify|forgot|reset|invite` chunk × each dashboard chunk (4 vacuous-pass guards + 6 cross-chunk leak checks) | PASS |
| Student vs Teacher dashboard split | Same spec — `StudentDashboard-*.js` and `TeacherDashboard-*.js` chunks distinct + no transitive leak | PASS |
| Dev-only routes excluded from `dist/` | Same spec, last test: `MultiTabTestPage`, `ThemeResolutionPage`, `__theme-resolution`, `__multi-tab-test-bait` filtered from build output (file-name AND content scan) | PASS |
| Build artifact emitted | Spec hard-fails on missing `dist/assets/` instead of silently passing | PASS |

**Verdict: PASS.** Architecturally enforced via Rolldown's lazy-import chunking; behaviorally enforced via 5 Playwright bundle-boundary tests. The route-level discipline (FW-7 + tier separation) is verified post-build.

#### 2b. Static Astro landing (0-JS budget)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| 0-JS budget guard | `ci-landing.yml` step "0-JS budget guard" greps `client:(load|idle|visible|media|only)` attribute syntax across `.astro` + `.tsx` + `.jsx`. Fails build if any hydration directive is detected (PM+reviewer sign-off required to override). | PASS |
| PainCalculator zero-JS | `classlite-landing/src/components/landing/PainCalculator.astro` — JSDoc declares "Pure HTML/CSS, ZERO JavaScript" + `landing.spec.ts` AC2 asserts `landing-pain-calculator` testid renders + AC2 asserts `landing-pain-calculator-money-conversion` and `landing-pain-calculator-assumption` testids render WITHOUT JS hydration | PASS |
| Static HTML rendering | `landing.spec.ts` "vi page renders every section" + "en page renders every section" exercise wrangler-served static HTML output | PASS |
| Server-rendered SEO meta + Open Graph | Astro static build emits meta tags at build time (verified by browser smoke test in `landing.spec.ts`) | PASS |
| Accept-Language redirect at edge | CF Pages Function (R-NEW-54) → `locale-redirect.test.ts` (unit) + `locale-redirect.spec.ts` (E2E asserts 5 cases at edge runtime via wrangler) | PASS |

**Verdict: PASS.** The 0-JS budget guard is a hard CI gate (not advisory); every section has a behavioral E2E check.

#### 2c. Lighthouse CI gate (PR-time performance ceiling)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Lighthouse CI configured per route | `test-design-architecture.md` line 106 declares "PR (<15 min, all functional tests + smoke E2E + Lighthouse on changed routes)". **Not wired** into `ci-web.yml` or `ci-landing.yml` at audit time. | **CONCERNS** |
| FCP / LCP / TBT thresholds | Architecture doc line 230: "Performance — Page load <2s FCP on 4G — Not measured — Lighthouse CI per route" (admitted gap from test-design phase) | **CONCERNS** |

**Verdict: CONCERNS (medium confidence).** Architecturally sound (static HTML + lazy chunks + 0-JS landing means Lighthouse scores should land easily ≥90), but **the metric ceiling is not enforced at PR time**. Mitigation plan:

1. **Pre-launch (recommended):** Add Lighthouse CI step to `ci-landing.yml` after the Playwright E2E step. Suggested config: PR-time gate with `min-performance: 80, min-accessibility: 95, min-best-practices: 90, min-seo: 95` on `/vi/`, `/en/`, and a `Cache-Control: no-cache` test (since landing is edge-cached).
2. **Pre-launch (recommended):** Add Lighthouse CI step to `ci-web.yml` for `/login`, `/register`, `/dashboard` at the production build artifact (`dist/`).
3. **Post-launch fallback:** Monitor Cloudflare Pages performance dashboard + CF Web Analytics RUM for actual FCP/LCP/CLS metrics; alert if p75 exceeds 2.5s LCP.

**Not a launch blocker** — the underlying performance work is done; the gap is metric verification at PR time vs. post-deploy monitoring.

---

### 3. NFR-5 — Accessibility Foundation

**Threshold (epic file line 50):** WCAG-compliant contrast ratios via UX-DR2 token fixes, aria-live password strength announcements, 44x44px minimum touch targets, `prefers-reduced-motion` respect.

#### 3a. WCAG 2.1 AA — zero violations

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Component-level axe (vitest-axe) | `classlite-web/src/test/vitest-setup.ts` registers `toHaveNoViolations` matcher; every component test that owns user-facing surface calls `axe(container)` | PASS |
| Page-level axe (Playwright) | `classlite-web/e2e/bilingual-smoke.spec.ts` runs `AxeBuilder` on every public route (`/login`, `/permission-denied`, `/this/does/not/exist`, `/dashboard`) in both locales. `classlite-landing/e2e/landing.spec.ts` AC9 runs `AxeBuilder` with explicit `wcag2a/wcag2aa/wcag21a/wcag21aa` tags on `/vi/` and `/en/` at both desktop + mobile viewports | PASS |
| Axe allowlist | `classlite-web/axe.allowlist.json` → `{"rules": []}` — **zero exceptions**. The strictest possible WCAG 2.1 AA stance. | PASS |
| Contrast ratio darkening (UX-DR2) | Tokens: `--cl-muted: #595c66` (5.1:1 on paper), `--cl-accent-2-text: #7c4309`, `--cl-accent-2-btn: #92500a`, `--cl-line-interactive: #a8a095`. Verified at design-token level by `tokens-presence.test.ts` and at runtime by axe via `bilingual-smoke.spec.ts` + `landing.spec.ts`. | PASS |

**Verdict: PASS.**

#### 3b. aria-live announcements (UX-DR8)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| `PasswordStrengthBar` aria-live="polite" | `classlite-web/src/features/auth/components/PasswordStrengthBar.tsx:89` + test asserts mount-presence even when password is empty (no surprise DOM swap on first paint) | PASS |
| `LockoutState` per-second tick aria-live="off" + threshold-announce aria-live="polite" role="status" | `classlite-web/src/features/auth/components/LockoutState.tsx:118,125` — `useLockoutCountdown.test.tsx` + `LoginPage.test.tsx` AC1 P8 assertion ("threshold-announce fires at 60s and 30s edge-crossings — exactly once each — Sally a11y pin") | PASS |
| `VerifyEmailPage` aria-live="polite" on poll status + verified state | `VerifyEmailPage.tsx:309,324,564` — covered by `VerifyEmailPage.test.tsx` and `useVerificationPoller.test.tsx` | PASS |
| `InviteAcceptancePage` aria-live="polite" on state change | `InviteAcceptancePage.tsx:680,685,686` (`data-testid="invite-aria-live"`) — covered by InviteAcceptancePage.test.tsx + InviteAcceptancePage.stories.tsx play function | PASS |

**Verdict: PASS.**

#### 3c. Touch targets + responsive design (UX-DR15)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| 44×44px minimum touch targets — Storybook AppShell | `classlite-web/e2e/storybook/app-shell-mobile-viewport.spec.ts` (Story 1d-3 AC7 + AC8) — `MobileTabBar tabs meet the 44×44 touch-target minimum` runtime contract via real boundingBox at 375×667 | PASS |
| Landing mobile responsive 390×844 | `landing.spec.ts` "AC5 — mobile responsive (390×844)" — `no horizontal scroll`, `hamburger has aria-label`, sections stack vertically | PASS |
| Auth screens mobile 390px | **PARTIAL** — vitest-axe per component covers a11y at the unit level; responsive Tailwind classes are present in `AuthCard`/`GoogleOAuthButton`/`CollapsibleEmailForm`; **but no dedicated Playwright `mobile-safari`/`mobile-chrome` spec for the 6 auth routes** at 390px asserting AuthCard full-width / 48px buttons + inputs / 44×44 touch targets. See **Trace G1** (out-of-scope-for-merge P2 gap). | **PASS with G1 follow-up** |

**Verdict: PASS with one P2 follow-up.** Storybook a11y + landing mobile + per-component vitest-axe cover most of the surface; the single bare patch is the auth-route mobile E2E, which is scheduled per the trace report.

#### 3d. `prefers-reduced-motion` respect (UX-DR4)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| StickyHeader scroll transition respects reduced-motion | `classlite-landing/src/components/landing/StickyHeader.astro:15` + comment "animate when `prefers-reduced-motion: no-preference` (P24)" | PASS |
| PricingSection annual toggle respects reduced-motion | `classlite-landing/src/components/landing/PricingSection.astro:117` + comment "prefers-reduced-motion guard is required" | PASS |
| Skeleton primitive `motion-safe:` prefix | `classlite-web/src/components/ui/skeleton.tsx:13` + dedicated `ReducedMotion` story (`Skeleton.stories.tsx:73`) + `Progress.stories.tsx:79` `IndeterminateReducedMotion` story (Story 1d-2 AC4) | PASS |

**Verdict: PASS.** The reduced-motion discipline is consistent across web + landing, and tested at the Storybook + axe levels.

---

### 4. Security — Frontend surfaces

#### 4a. Cookie attributes (refresh + session + hint + lang)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| All four cookie attributes (httpOnly + Secure + SameSite + Domain) per project-context SEC-4 | `classlite-web/src/lib/__tests__/cookie-domain.test.ts` + `classlite-web/tests/e2e/cross-subdomain/cookie-sharing.spec.ts` (asserts `session.httpOnly == true`, `session.sameSite == 'Lax'`, `session.domain == '.classlite.localhost'`) | PASS |
| `lang` cookie scoped to `.classlite.app` (UX-DR17) | `cookie-sharing.spec.ts` "language cookie is scoped to .classlite.localhost" + `language-cookie.test.ts` | PASS |
| `logged_in` hint cookie cleared on session expiry (UX-DR18) | `LoginPage.test.tsx` Story 1-9d AC4 "Murat M5 cookie-clear StrictMode spy — exactly ONE invocation" + cookie shape parity test cross-codebase | PASS |
| Cross-subdomain cookie sharing | `cookie-sharing.spec.ts` — both `landingCookies` and `dashboardCookies` see the same `classlite_session` value | PASS |

**Verdict: PASS.**

#### 4b. Open-redirect prevention (`next=` consumer)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| `sanitizeNextParam` allowlist | `classlite-web/src/features/auth/lib/sanitizeNextParam.ts` + `sanitizeNextParam.test.ts` (multiple cases — relative paths kept, external URLs rejected, javascript: rejected, protocol-relative `//evil.com` rejected) | PASS |
| Login navigates to whitelisted `next=` | `LoginPage.test.tsx` Story 1-9d AC4 "successful login navigates to whitelisted next= via password submit" + "rejected next= falls back to /dashboard (open-redirect ratchet)" + "already-auth navigate respects next=" + "sibling-tab broadcast → next= consumer (Winston W2 / Murat M3 regression guard)" | PASS |
| URL-clear effect preserves `next=` (strips `session_expired`) | LoginPage.test.tsx Story 1-9d AC4 "URL-clear effect drops session_expired but PRESERVES next= (Amelia A6 pin)" | PASS |

**Verdict: PASS.** Open-redirect surface is rigorously locked down with regression guards from prior code reviews.

#### 4c. Anti-enumeration (forgot-password timing + body parity)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Forgot-password fires identical UI regardless of email existence | `ForgotPasswordPage.test.tsx` "anti-enum coupling regression guard — success swap fires identically regardless of response timing" (asserts DOM identity across fast/slow paths) | PASS |
| Resend deep-equal `{email: submittedEmail}` body | `ForgotPasswordPage.test.tsx` "resend re-fires with deep-equal { email: submittedEmail } body and starts countdown" — catches "fires with wrong shape" regression | PASS |
| Backend constant-time floor | Epic 1b NFR audit already verified `ResendConstantTimeFloor = 200ms` at the API layer | PASS (inherited) |

**Verdict: PASS.** Both client-side and server-side anti-enum surfaces are tested.

#### 4d. OAuth error param plumbing

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| `?error=invite_email_mismatch` → OAuth Email Mismatch screen (no email/query-param echo in DOM) | `LoginPage.test.tsx` Story 1-9d AC2 "Murat M6 DOM-wide privacy ratchet — no email / query-param echo" + 4 other AC2 tests | PASS |
| `?error=google_userinfo_failed` vs `?error=google_email_unverified` (distinct copy) | LoginPage.test.tsx Story 1-9d AC3 — 5 tests including M6 privacy ratchet | PASS |
| Retry CTA threads `prompt=select_account` | AC2 + AC3 retry-CTA tests | PASS |

**Verdict: PASS.**

#### 4e. PUBLIC_DASHBOARD_URL allowlist (**R-NEW-55** — landing→dashboard cross-domain phishing defense)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Production build refuses phishing URLs | `classlite-landing/src/lib/test/__tests__/validate-dashboard-url.test.ts` (multiple cases including "NODE_ENV=production + phishing URL → fail with R-NEW-55") + `dashboard-url-validation.spec.ts` (E2E child-process — `npm run validate-url` fails the build) | PASS |
| CI runs validator on production build | `ci-landing.yml` step "Story 1.10 AC7 — R-NEW-55 PUBLIC_DASHBOARD_URL allowlist" runs `npm run validate-url` with `NODE_ENV=production PUBLIC_DASHBOARD_URL=https://my.classlite.app` | PASS |
| Missing env var detection | Test "both env var AND .env.production absent → fail with R-NEW-55" | PASS |

**Verdict: PASS.** R-NEW-55 has both unit-test + E2E + CI coverage. The phishing surface is hard-closed.

#### 4f. Email-verification enumeration via polling (terminal-state ref)

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Late 200 verified:true response dropped after `commitTerminal('timeout')` | `useVerificationPoller.test.tsx` "terminal-state-ref drops a late 200 verified:true response after commitTerminal(timeout)" — uses MSW `delay(6_000)` to inject a real race window | PASS |
| Late 404 response dropped after `commitTerminal('verified')` | useVerificationPoller.test.tsx "terminal-state-ref drops a late 404 response after commitTerminal(verified)" | PASS |
| `enabled=false` stops polling immediately | useVerificationPoller.test.tsx "enabled=false stops polling immediately (no further fetches fire)" | PASS |

**Verdict: PASS.** Race conditions in async polling cannot leak post-terminal state to the UI.

---

### 5. Reliability

| Sub-NFR | Evidence | Verdict |
|---|---|---|
| Silent token refresh on 401 + retry + redirect | `classlite-web/src/lib/__tests__/query-client-refresh.test.ts` (6 tests describing "AC3 query-client 401 silent-refresh contract") | PASS |
| Multi-tab `navigator.locks` + `BroadcastChannel` coalesces to ONE refresh | `auth-refresh-locks.test.ts` (8 tests — in-process coalesce + lock fallback + broadcast debounce + login-succeeded sibling-tab hydration) + `multi-tab-refresh.spec.ts` (Playwright real-tab AC4 contract — `refreshCount === 1`) | PASS |
| BroadcastChannel debounce skips redundant refresh after sibling success | auth-refresh-locks.test.ts "lock callback skips network call when lastRefreshedAt is fresh" | PASS |
| Lockout state persistence + rehydrate on mount | `lockoutStorage.test.ts` + `useLockoutCountdown.test.tsx` + `LoginPage.test.tsx` AC1 "lockout state rehydrates from localStorage on mount (zero MSW calls)" | PASS |
| ErrorBoundary surfaces Sentry event ID | `ErrorBoundary.test.tsx` (Story 1-7c AC3) | PASS |
| MSW `onUnhandledRequest: 'error'` — unmocked HTTP calls fail loudly | `classlite-web/src/test/vitest-setup.ts:beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))` | PASS |
| Per-test `createTestQueryClient()` + global cache-clear safety net | `vitest-setup.ts:afterEach` + `login.test.tsx` "with createTestQueryClient(), the global queryClient is NOT mutated by the test (isolation regression guard)" | PASS |
| Verification polling terminal-state ref drops late responses | useVerificationPoller.test.tsx (see Security 4f) | PASS |

**Verdict: PASS.** Every reliability surface in epic 1c has explicit evidence including race-condition tests.

---

### 6. Maintainability

**Deferred to RV report** — `_bmad-output/test-artifacts/test-reviews/test-review-epic-1c.md` scored 94/100 (Grade A — Excellent).

Highlights re-noted here:

- Single mock seam discipline (TEST-FE-1) — MSW only at HTTP boundary; 3 narrow `vi.mock` exceptions across the entire suite
- Per-test `createTestQueryClient()` + global-singleton isolation regression guard
- Fake-timer + `advanceTimersByTimeAsync` discipline for polling tests
- MSW handler catalog typed via `satisfies` against openapi-generated schemas (`_bmad-output/test-artifacts/msw-handler-catalog-auth.md`)
- 3 P1 flake-risk hotspots flagged (E2E `networkidle` × 2 + `waitForTimeout` × 3) — fix before release, not before merge
- 5 auth `*.test.tsx` files exceed 300-line file-size advisory (P2 — split per AC group)

**Verdict: PASS.**

---

### 7. Scalability

**N/A.** Epic 1c is frontend-only. No backend traffic shaping, no database scaling, no worker concurrency. The Vite dev server proxy + lazy chunk loading model handles scale at the static-asset CDN tier (Cloudflare Pages), which is not in epic-1c's scope.

For backend scalability NFRs, see `nfr-assessment-epic-1b.md` § "Scalability — concurrent-user targets" (DEFERRED — operator decision pending).

**Verdict: N/A.**

---

## Risk-to-NFR cross-walk (handoff §47)

| Risk | Score | Category | Verdict | Evidence Anchor |
|---|---|---|---|---|
| R38 — i18n key missing in one locale | 6 (3×2) | TECH | ✅ DISCHARGED | NFR-1 entire section |
| R46 — Web ships before API for breaking change | 6 (2×3) | OPS | ⚠️ OUT-OF-SCOPE | DevOps atomic-PR CI guard (release-gate concern) |
| R-NEW-54 — Vietnamese-tied locale default | n/a | UX | ✅ PASS | Performance 2b — CF Pages Function spec |
| R-NEW-55 — PUBLIC_DASHBOARD_URL phishing | n/a | SEC | ✅ PASS | Security 4e |

---

## Concerns and remediation

### Concern 1 (NEW): Lighthouse CI not wired into PR pipeline

**What's missing:** `test-design-architecture.md` line 106 lists "Lighthouse on changed routes" as a PR-time tier-1 check. Neither `ci-web.yml` nor `ci-landing.yml` runs Lighthouse at audit time.

**Why it matters:** Bundle splits + 0-JS landing make the underlying performance work correct, but the metric ceiling (FCP < 2s on 4G per architecture line 230) is unverified at PR time. A regression that triples the landing bundle wouldn't fail the gate.

**Risk score:** 2 (probability) × 2 (impact) = **4 (LOW-MEDIUM).** Probability is low because the 0-JS guard + bundle-boundary tests catch most regressions; impact is medium because mobile-VN users on 4G are the design persona.

**Mitigation plan:**

1. **Pre-launch (P1):** Add Lighthouse CI step to `ci-landing.yml`:
   ```yaml
   - name: Lighthouse CI (NFR-3 — Performance Baseline)
     run: |
       cd classlite-landing
       npx @lhci/cli@latest autorun \
         --collect.url=http://classlite.localhost:8788/vi/ \
         --collect.url=http://classlite.localhost:8788/en/ \
         --assert.preset=lighthouse:no-pwa \
         --assert.assertions.categories:performance=80 \
         --assert.assertions.categories:accessibility=95 \
         --assert.assertions.categories:best-practices=90 \
         --assert.assertions.categories:seo=95
   ```
   Owner: Frontend / DevOps. Estimated effort: 1-2 hours including baseline tuning.

2. **Pre-launch (P1):** Add Lighthouse CI step to `ci-web.yml` after the Vite build, asserting `/login`, `/register`, `/dashboard` on the production bundle.

3. **Post-launch (always-on):** Cloudflare Web Analytics RUM dashboard for actual FCP/LCP/CLS p75; alert if landing LCP p75 > 2.5s for 1 hour sustained.

**Not a launch blocker for epic-1c stories** — the performance work is done; the verification surface is missing.

### Concern 2 (carried from RV — informational):

**G1 — Mobile auth breakpoint Playwright spec absent (Story 1.8 AC6 PARTIAL).** See trace matrix § Gap Analysis. P2 — fold into next maintenance PR or epic-2 onboarding mobile work.

### Concern 3 (carried from RV — informational):

**3 P1 E2E flake-risk hotspots** — `networkidle` × 2 in `route-bundle-boundaries.spec.ts` + `multi-tab-refresh.spec.ts`; `waitForTimeout` × 3 in `landing.spec.ts`. Fix before release per RV recommendations 1-3.

---

## Final verdict

**Overall: ✅ PASS-with-CONCERNS** (high confidence)

| Decision Factor | Status |
|---|---|
| All P0 NFR thresholds met? | ✅ YES (R38 fully discharged; cookies + open-redirect + R-NEW-55 all locked; reliability tested across silent refresh + multi-tab + polling) |
| Any critical NFR failures? | ❌ NO |
| All in-scope NFRs have evidence? | ✅ YES (except Lighthouse CI — single CONCERN) |
| Concerns block launch? | ❌ NO (Lighthouse is post-launch observable; G1 is P2; flake hotspots are pre-release) |
| Confidence in audit? | ✅ HIGH — every NFR claim is anchored in a specific test file + CI step |

### Sign-off checklist

- [x] NFR-1 (i18n Foundation) — 4-layer R38 mitigation + cross-domain cookie + bilingual smoke
- [x] NFR-3 (Performance Baseline — bundle splits + static landing) — bundle-boundary E2E + 0-JS guard
- [ ] NFR-3 (Performance Baseline — Lighthouse CI gate) — **needs wiring** (Concern 1)
- [x] NFR-5 (Accessibility Foundation) — zero axe violations + aria-live + 44×44 touch + reduced-motion
- [x] Security — Cookie attrs / open-redirect / anti-enum / OAuth params / R-NEW-55 / polling race
- [x] Reliability — Silent refresh / multi-tab / lockout / polling / ErrorBoundary
- [x] Maintainability — RV 94/100 Grade A
- [n/a] Scalability — frontend-only scope

---

## Recommended Next Steps

1. **Run `/bmad-tea GATE`** (final release gate decision) — consumes this NFR audit + RV report + Trace matrix
2. **Pre-release fixes** (do all three before promoting epic-1c to production):
   - Fix 3 RV P1 flake-risk hotspots (1-3 hours)
   - Add Lighthouse CI step to both `ci-web.yml` and `ci-landing.yml` (Concern 1, 1-2 hours)
3. **Schedule maintenance PR** for:
   - G1 — Mobile auth breakpoint Playwright spec (2-3 hours)
   - RV P2 — Split largest auth `*.test.tsx` files
   - RV P2 — `region.querySelector` → `within(...).getByTestId` cleanup
4. **Operator decisions outstanding** (carry-overs from epic-1b NFR audit, not epic-1c-introduced):
   - Concurrent-user targets for k6 stress test sizing
   - Uptime SLO
   - Data retention / PDPD compliance (PRD Open Q #8)

---

**Generated:** 2026-06-30
**Workflow:** testarch-nfr v4.0
**Companion reports:**
- `_bmad-output/test-artifacts/test-reviews/test-review-epic-1c.md` (RV — 94/100)
- `_bmad-output/test-artifacts/traceability/traceability-matrix-epic-1c.md` (TR — PASS / 96.2% coverage)
