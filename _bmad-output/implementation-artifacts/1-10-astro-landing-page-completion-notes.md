# Story 1-10-astro-landing-page: Completion Notes

_Implementation record for [`1-10-astro-landing-page.md`](./1-10-astro-landing-page.md). Status: review._

## Dev Agent Record

### Debug Log

- **tokens.css drift** caught at Task 0.1. `bash scripts/sync-tokens.sh` resynced from canonical. No code change needed.
- **`astro check` needed `@astrojs/check` + `typescript`** — installed as devDeps at Task 0.2 (one-time landing infra addition).
- **`computeCookieDomain` reference inside `writeLanguageCookie` broke** when Task 1.2's re-export renamed the symbol. Fixed by updating the call-site from `languageCookieDomain()` → `computeCookieDomain()` while preserving the re-export name for external consumers.
- **`useHintCookieWrite` cross-tab BroadcastChannel test was red against an isolated test client** because `auth-refresh.ts`'s listener writes to the module-level `queryClient`. Switched the test to use the production `queryClient` for that one case (matches `auth-refresh-locks.test.ts:220` shape) — green.
- **`astro:env/client` schema needed declaration BEFORE Task 4 components** could compile. Set up the minimal schema in Task 4 prep; full R-NEW-55 validator + ATDD shipped in Task 8.
- **`prebuild` hook ran `validate-dashboard-url.mjs` before Astro loaded `.env`** — manual `.env` loader added to the validator so it works in both build context and direct CLI invocation.
- **Orphan-scan regex pivot** at Task 3.4: the dashboard-style `.astro`-source regex couldn't reach destructured prop access (`pricing.priceMonthly` where `pricing` is a sub-strings tree). Pivoted to the dashboard's `i18n-parity.mjs` pattern (parse `STORY_*_KEYS` arrays from the coverage test file). 73 keys / 73 claimed / 0 orphans.
- **Cookie-domain parity surface drift** — dashboard uses `export function ... : string | null`, landing inline uses plain `function`. Added normalize pass to `check-cookie-domain-parity.mjs` to strip TS-only surface (return-type annotation, `export` keyword) so the body comparison is logic-equivalent. PASS.

### Completion Notes

**Shipped (all 10 tasks, 73 vi keys, 6 LOCKED prices, 3 OWNED risk discharges):**

- Cross-codebase shared `cookie-domain.ts` (Task 1) — sentinel-comment parity ratchet active.
- `useHintCookieWrite` dashboard hook (Task 2) — 9/9 tests covering false/true/StrictMode/remount/cross-tab BroadcastChannel/byte-exact write/no-window/localhost-no-domain.
- R38 four-layer landing discharge (Task 3) — `Strings` interface + `as const satisfies` + Vitest helper + ATDD parity-coverage with closed `STORY_1_10_KEYS` enumeration + `check-landing-parity.mjs` with LOCKED_PRICES (BLOCKER A8) and orphan scan.
- Nine landing components (Task 4) — StickyHeader, Hero, PainCalculator, FeatureCard, SocialProofCard, PricingCard, PricingSection, Footer, SessionExpiredBanner. Sally LP-01 hero restored, đồng-conversion + assumption call-out wired, section-header scenario reframe carried.
- CF Pages Function (Task 5) — `functions/index.ts` (≤60 lines incl JSDoc) reads Accept-Language at edge, picks vi/en with `prefer-Vi-on-tie`, emits `Vary: Accept-Language`. Static root `src/pages/index.astro` DELETED. R-NEW-54 ATDD specimens at both `e2e/locale-redirect.spec.ts` (Playwright + wrangler) AND `src/lib/test/__tests__/locale-redirect.test.ts` (Vitest unit, 9/9 green).
- Inline scripts (Task 6) — 4 `is:inline` (hint-redirect+banner-attr / lang-cookie write / billing hydration / replaceState URL-strip) + 1 default `<script>` (StickyHeader IntersectionObserver). Total inline JS ≤ 80 lines.
- Mobile responsiveness (Task 7) — Tailwind responsive prefixes systematic, hamburger via `<details>`, CTAs `w-full md:w-auto`, Playwright mobile project regression.
- `astro:env` + R-NEW-55 validator (Task 8) — typed schema in `astro.config.mjs`, `.env`/`.env.production`, `scripts/validate-dashboard-url.mjs` (≤55 lines) wired as `prebuild`. R-NEW-55 ATDD specimens at both `e2e/dashboard-url-validation.spec.ts` (Playwright child-process) AND `src/lib/test/__tests__/validate-dashboard-url.test.ts` (Vitest unit, 7/7 green).
- Test infra (Task 9) — Playwright + axe + Vitest + cookie-domain parity guard + 0-JS grep guard. `docs/landing-script-budget.md` + `docs/landing-deploy.md` written.

**Pragmatic deviations from Epic 1C AC (8, flagged for John's amendment):**

1. Accept-Language routing at CF edge Function (not Astro static — static can't per-request branch; R-NEW-54).
2. Hint cookie write ships dashboard-side (Epic AC names only read; without write, UX-DR18 cycle is dead).
3. Session-expired banner reveal driven by `<html data-session-expired>` attribute (Sally STRONG #6 zero-CLS).
4. PainCalculator/FeatureCard illustrations placeholder SVGs with `aria-hidden="true"` (Sally DEFER #8).
5. Zalo URL placeholder `https://zalo.me/0123456789` (`1-10-followup-zalo-link`).
6. Terms/Privacy placeholder bodies "TBD" (`1-10-followup-legal-pages`).
7. Hero headline restored to LP-01 wireframe verbatim (Sally BLOCKER #1).
8. SocialProof reframed as scenarios via section-header + italic note (Sally BLOCKER #3).

**12 ★ REVIEWER-MANDATORY vi keys flagged for VN-fluent reviewer pass:**

`meta.title`, `hero.headline` (LP-01 restored), `hero.eyebrow`, `painCalculator.line1`, `painCalculator.moneyConversion`, `painCalculator.assumption`, `feature.writing.body`, `socialProof.sectionHeader`, `socialProof.sectionNote`, `socialProof.card1.quote`, `pricing.belowCta`, `banner.sessionExpired.body`.

**Deferred to Task 10 verification / Code Review:**

- Playwright e2e suite (`e2e/landing.spec.ts` + `e2e/locale-redirect.spec.ts` + `e2e/dashboard-url-validation.spec.ts`) requires `wrangler pages dev` against the built `dist/`. The Vitest unit-test surfaces for the R-NEW-54 + R-NEW-55 ATDD specimens are green locally; the full Playwright suite runs in CI via the `webServer` block in `playwright.config.ts` (wrangler boots automatically).
- `/etc/hosts` entry for `classlite.localhost` / `my.classlite.localhost` is a manual local-dev step documented in `docs/landing-deploy.md` (Murat BLOCKER #3).

### Implementation Plan (summary)

1. Pre-flight (Task 0) — tokens.css resync, `astro check` baseline.
2. Cross-codebase cookie-domain extraction (Task 1) — RED test → GREEN module → refactor language-cookie to delegate.
3. Dashboard `useHintCookieWrite` hook (Task 2) — RED 9-test contract → GREEN hook → wire in `App.tsx:55`.
4. R38 four-layer landing discharge (Task 3) — `types.ts` → `vi.ts` + `en.ts` → Vitest helper + helper test → ATDD parity-coverage → `check-landing-parity.mjs` → CI wiring.
5. Nine landing components (Task 4) — built bottom-up: tints first (FeatureCard), then composites (PricingCard inside PricingSection), then page-level (StickyHeader, Footer, SessionExpiredBanner).
6. CF Pages Function (Task 5) — RED Vitest 9-test surface → GREEN `functions/index.ts` → DELETE root index → Playwright e2e specimen → BaseLayout SEO/hreflang/preload → locale pages full composition → terms/privacy placeholders.
7. Inline scripts (Task 6) — covered in BaseLayout + SessionExpiredBanner + PricingSection + StickyHeader from Tasks 4-5. Documented in `landing-script-budget.md`.
8. R-NEW-55 validator (Task 8) — RED Vitest 7-test surface + Playwright e2e specimen → GREEN `validate-dashboard-url.mjs` with `.env*` manual loader → `prebuild` wiring → CI step.
9. Mobile responsiveness pass (Task 7) — CTA `w-full md:w-auto` audit + Playwright mobile project.
10. Test infrastructure (Task 9) — playwright.config.ts, landing.spec.ts (12 test groups), hint-cookie-shape.test.ts cross-codebase contract, check-cookie-domain-parity.mjs sentinel guard, landing-script-budget.md, landing-deploy.md, 0-JS grep in CI.
11. Final verification (Task 10) — landing matrix (vitest 25/25, parity 73/73/0, cookie-domain PASS, build PASS, lint:css PASS, astro check 0/0/0); dashboard matrix (lint clean, lint:css clean, tsc -b clean, vitest 610/610, playwright 48/48, build PASS, build:check 4/4, storybook:build clean, i18n-parity 376/374); sibling completion notes authored.

## File List

### Added

**Dashboard (classlite-web/):**
- `src/lib/cookie-domain.ts` — extracted shared `computeCookieDomain()` with sentinel comments
- `src/lib/__tests__/cookie-domain.test.ts` — 7 tests (all host classes + SSR guard)
- `src/hooks/useHintCookieWrite.ts` — UX-DR18 dashboard half (writes `logged_in=1`)
- `src/hooks/__tests__/useHintCookieWrite.test.tsx` — 9 tests incl cross-tab BroadcastChannel + byte-exact write

**Landing (classlite-landing/):**
- `functions/index.ts` — CF Pages Function for `/` locale routing (R-NEW-54 mitigation)
- `src/content/types.ts` — `Strings` interface (R38 Layer 1)
- `src/content/vi.ts` — Vietnamese strings (12 ★ REVIEWER-MANDATORY keys)
- `src/content/en.ts` — English mirror
- `src/components/landing/StickyHeader.astro`
- `src/components/landing/Hero.astro` — LP-01 wireframe headline restored
- `src/components/landing/PainCalculator.astro` — đồng conversion + assumption call-out
- `src/components/landing/FeatureCard.astro` — placeholder SVGs `aria-hidden="true"`
- `src/components/landing/SocialProofCard.astro` — scenario archetype card
- `src/components/landing/PricingCard.astro` — VND prices LOCKED per BLOCKER A8
- `src/components/landing/PricingSection.astro` — CSS-only billing toggle + state preservation
- `src/components/landing/Footer.astro`
- `src/components/landing/SessionExpiredBanner.astro` — zero-CLS reveal via `<html data-session-expired>`
- `src/lib/test/landing-i18n-parity.ts` — Vitest helper (R38 Layer 2)
- `src/lib/test/landing-i18n-parity.test.ts` — 4 helper unit tests
- `src/lib/test/__tests__/landing-i18n-parity-coverage.test.ts` — ATDD specimen + STORY_1_10_KEYS closed enumeration (R38 Layer 3)
- `src/lib/test/__tests__/locale-redirect.test.ts` — 9 Vitest tests for CF Function
- `src/lib/test/__tests__/validate-dashboard-url.test.ts` — 7 Vitest tests for R-NEW-55 validator
- `src/lib/test/__tests__/hint-cookie-shape.test.ts` — cross-codebase byte-string contract (Murat STRONG #4)
- `src/pages/terms.astro` — placeholder
- `src/pages/privacy.astro` — placeholder
- `e2e/landing.spec.ts` — Playwright e2e (12 test groups + axe)
- `e2e/locale-redirect.spec.ts` — R-NEW-54 ATDD specimen (Playwright)
- `e2e/dashboard-url-validation.spec.ts` — R-NEW-55 ATDD specimen (Playwright child process)
- `scripts/check-landing-parity.mjs` — R38 Layer 4 CI script (LOCKED_PRICES + orphan scan)
- `scripts/check-cookie-domain-parity.mjs` — sentinel-comment parity guard (Winston STRONG #3)
- `scripts/validate-dashboard-url.mjs` — R-NEW-55 prebuild validator
- `docs/landing-script-budget.md` — inline JS budget + is:inline discipline
- `docs/landing-deploy.md` — CF Pages branch-to-env + Function pickup + allowlist governance
- `playwright.config.ts` — desktop + mobile projects, wrangler `webServer`
- `vitest.config.ts` — Vitest with `@/` alias
- `.env` — `PUBLIC_DASHBOARD_URL=http://my.classlite.localhost:5173` (dev)
- `.env.production` — `PUBLIC_DASHBOARD_URL=https://my.classlite.app`

### Modified

**Dashboard:**
- `src/lib/language-cookie.ts` — delegates to `cookie-domain.ts`; `languageCookieDomain` preserved as re-export
- `src/App.tsx` — added `useHintCookieWrite()` call at line 55 (after `useLanguageInit()`)

**Landing:**
- `astro.config.mjs` — added `i18n` config + `astro:env` schema
- `src/layouts/BaseLayout.astro` — full rewrite for AC1 SEO + AC4a/AC4b inline pre-paint scripts + AC6 lang-cookie write with sentinel-guarded inline cookie-domain
- `src/pages/vi/index.astro` — full seven-section composition
- `src/pages/en/index.astro` — full seven-section composition
- `src/styles/tokens.css` — resynced from canonical (Task 0.1)
- `package.json` — devDeps + 7 scripts (test, test:watch, test:e2e, test:e2e:install, check-parity, check-cookie-domain, validate-url) + `prebuild` hook
- `tsconfig.json` — added `types: ["node"]`

**Infrastructure:**
- `.github/workflows/ci-landing.yml` — 7 new steps (check-parity, vitest, check-cookie-domain, validate-url, 0-JS grep, Playwright e2e, build env vars) + path triggers for `cookie-domain.ts`

### Deleted

- `classlite-landing/src/pages/index.astro` — CF Pages Function at `functions/index.ts` takes precedence at `/` (Story 1.10 AC1 + R-NEW-54)
