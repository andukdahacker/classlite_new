---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-06-15'
workflowType: 'testarch-test-design'
lastRefresh:
  date: '2026-06-15'
  scope: 'Epic 1D — Component Library Buildout (Path B)'
  trigger: 'Pre-dev gate for Story 1d-1: R38 (i18n parity, score 6) discharge evidence mapping + ~52 component decomposition into P0–P3 matrix'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/implementation-artifacts/1d-1-storybook-foundation.md'
  - '_bmad-output/implementation-artifacts/1d-2-shadcn-primitive-coverage.md'
  - '_bmad-output/implementation-artifacts/1d-3-app-shell-stack.md'
  - '_bmad-output/implementation-artifacts/1d-4-phase4-visual-bridge.md'
  - 'docs/project-context.md'
---

# Test Design for QA: ClassLite v2 (system-level)

**Purpose:** Test execution recipe for the QA / TEA team — what to test, at what level, in what order, with what tooling.

**Date:** 2026-06-04
**Author:** Murat (TEA)
**Status:** Draft
**Project:** ClassLite v2
**Related:** See `test-design-architecture.md` for testability concerns and architectural blockers. Full working notes (raw risk register, per-journey scenario lists, coverage tables) live in `test-design-progress.md`.

---

## Executive Summary

**Scope:** System-level test design for all 10 epics. User asked for **very thorough end-to-end coverage** — the plan honors that with 75+ Playwright E2E scenarios across 20 critical journeys (J1–J20) plus a 312-cell cross-tenant adversarial grid implemented at the backend integration layer.

**Risk Summary** (full register in companion architecture doc):
- Total Risks: 50 (2 score 9 BLOCK, 25 score 6-8 MITIGATE, 20 score 4-5 MONITOR, 3 score 1-3 DOCUMENT)
- Critical categories: SEC (12 high-priority), DATA (5), BUS (6), OPS (4)

**Coverage Summary:**
- P0 scenarios: ~120 (cross-tenant grid, auth security, money flow, immutability, critical journeys)
- P1 scenarios: ~150 (component trilogies, MSW fault injection, role-negative tests, secondary journeys)
- P2 scenarios: ~80 (edge cases, recurring-session scopes, archive, visual regression)
- P3 scenarios: ~30 (exploratory, benchmarks, rarely-used flows)
- **Total: ~380 testable scenarios** (~330–525 engineer-hours; ~4–6 weeks if mass parallelized across feature teams via ATDD, ~8–12 weeks for one engineer).

---

## Not in Scope

| Item | Reasoning | Mitigation |
|---|---|---|
| Real Gemini integration in PR pipeline | Non-deterministic; cost; flakiness | Mock Gemini deterministic in PR; one quarantined nightly real-call shape-only smoke per AI flow |
| Real Polar.sh production webhooks | Cost; secrecy | Polar sandbox in weekly tier; mock Polar in PR + nightly |
| Real R2 in PR | Cost; latency | Mock R2 with key-shape validation in PR; real R2 in weekly |
| Physical iOS device sweep in CI | Cost; logistics | Manual checklist for iOS team OR BrowserStack in weekly; release gate item |
| Internationalization beyond en + vi | Out of v1 product scope | n/a |
| Astro landing site visual perfection | Static HTML, low risk | Lighthouse SEO + a11y; one E2E smoke per page |
| Penetration testing & bug-bounty depth | Outside QA scope | Schedule external pentest pre-launch |

All exclusions reviewed and accepted by TEA. Final sign-off from PM + Security Lead pending.

---

## Dependencies & Test Blockers

**CRITICAL:** QA cannot proceed on the corresponding test cluster until each blocker resolves. See `test-design-architecture.md` § Quick Guide.

### Backend / Architecture Dependencies (Pre-Implementation)

1. **Polar webhook signature scheme (A2)** — Backend lead — pre-Epic 9 ATDD.
2. **AI credit refund policy (A6)** — PM + Backend lead — pre-Epic 6 ATDD.
3. **Per-file size limits (A9)** — PM + Backend lead — pre-Epic 4 ATDD.
4. **R2 presigned URL one-time-use policy (A10)** — Backend lead + Security — pre-Epic 4 ATDD.
5. **VND prices + VAT rate (A8)** — PM — pre-Epic 9 ATDD.
6. **Reliability SLO + scalability targets** — Eng leads — pre-launch (k6 stress test sizing).
7. **Worker tenant-context test harness (A7)** — Backend lead — pre-Epic 4 ships.

### QA / TEA Infrastructure Setup (Phase 0 — can start now)

1. **`test.SetupDB(t)` extension for parallel safety** — assert pool size cap, ensure transaction rollback under high concurrency.
2. **`test.WorkerContext(t, db, tenantID, payload)` helper** — for A7.
3. **`MockClock` propagation through BillingService, EnrollmentService, ScheduleService, AtRiskDetector** — for A4 (Story 1.4 already introduced clock in AuthService).
4. **Deterministic-tenant fixture factory** — UUIDs `00000000-...-000000000001..N` keyed by slug.
5. **Playwright cross-subdomain project config** — `landing` + `dashboard` Playwright projects with shared `.classlite.app` `storageState`.
6. **MSW server with `failOnce` helper** + standard handler library covering every API endpoint with `{ data, meta }` envelope.
7. **`assertI18nParity(keys, ['en','vi'])` helper** — assert every used i18n key exists in both locales.
8. **vitest-axe global configuration** — fail on any axe violation; allowlist documented for known false positives.
9. **k6 baseline scripts** — search, dashboard, AI polling.
10. **Lighthouse CI config** — every public route.

**Test data factory pattern** (Go side, mirrors project-context conventions):

```go
// internal/test/factories/center.go
func CreateTestCenter(t *testing.T, db *pgxpool.Pool, opts ...CenterOpt) *domain.Center {
    t.Helper()
    cfg := defaultCenterConfig
    for _, opt := range opts {
        opt(&cfg)
    }
    center := &domain.Center{
        ID:   cfg.id,           // Deterministic if WithSlug() used
        Slug: cfg.slug,
        ...
    }
    require.NoError(t, queries.CreateCenter(ctx, db, center.ToParams()))
    t.Cleanup(func() {
        // Transaction rollback via test.SetupDB makes this a no-op
    })
    return center
}
```

**Playwright fixture pattern** (with playwright-utils per tea config):

```typescript
// tests/e2e/fixtures.ts
import { test as base } from '@seontechnologies/playwright-utils/api-request/fixtures'
import { expect } from '@playwright/test'

type TestFixtures = {
  seedTenant: (slug: string) => Promise<{ tenant: Tenant; ownerToken: string }>
  loginAs: (email: string, password: string, subdomain: string) => Promise<void>
}

export const test = base.extend<TestFixtures>({
  seedTenant: async ({ apiRequest }, use) => {
    const created: string[] = []
    await use(async (slug) => {
      const { body } = await apiRequest({
        method: 'POST',
        path: '/api/test/seed/tenant',
        body: { slug },
      })
      created.push(body.tenantId)
      return body
    })
    // Auto-cleanup via test seed endpoint (gated to non-prod)
    for (const id of created) {
      await apiRequest({ method: 'DELETE', path: `/api/test/seed/tenant/${id}` })
    }
  },
  // ... loginAs etc.
})

export { expect }
```

---

## Risk Assessment

Full risk table lives in companion architecture doc. Below are the risks most relevant to QA planning.

### High-Priority Risks (Score ≥6) — QA coverage map

| Risk ID | Category | Description | Score | QA Test Coverage |
|---|---|---|---|---|
| **R1** | DATA/SEC | Missing TenantContext on Store method → cross-tenant leak | **9** | J15 cross-tenant grid (Go integration, ~312 cells) |
| **R3** | DATA/SEC | Worker missing SET LOCAL on dequeue | **9** | INT-WRK-001..010 worker adversarial tests per job type |
| R2 | DATA/SEC | RLS null-tenant guard regression | 6 | Per-table null-context adversarial test |
| R4–R8, R11, R13–R15 | SEC | Auth, OAuth, cookies, CORS, R2, Polar, rate-limit, role re-validation | 6 | INT-AUTH-001..060 + E2E-J3, J4, J5, J10, J11 |
| R16, R17 | DATA | Submission + enrollment immutability | 6 | INT-SUB-001..002, INT-AUDIT-001..003, E2E-J5-006/007, E2E-J13-003 |
| R19 | DATA | Recurring session scope leakage | 6 | E2E-J19 + scope × field × past/future integration matrix |
| R21–R24 | BUS | Grace period state machine, plan limits, credit refund, downgrade | 6 | E2E-J10, E2E-J11 + MockClock time-travel integration |
| R26 | BUS | Search role-scoping leak | 6 | E2E-J8 + role-negative search tests |
| R31 | PERF | N+1 on dashboards | 6 | INT-PERF-001..006 query-count assertion |
| R38 | TECH | i18n key missing in vi.json | 6 | `assertI18nParity` per component test + bilingual E2E sweep |
| R42 | TECH | Writing editor autosave loses data | 6 | E2E-J6-001, E2E-J18 + MSW network-failure component test |
| R46 | OPS | Cross-service deploy order | 6 | CI atomic-PR guard (not a test — but QA reviews CI artifact) |
| R48, R49, R50 | OPS | DB outage, secret leak, migration rollback | 6 | Health endpoint test, log-scan CI, data-preservation migration test |

### Medium/Low-Priority Risks → QA Coverage

| Cluster | Coverage |
|---|---|
| R10, R12, R14 (SEC monitor) | Soft-delete cross-tenant test; email injection negative test; constant-time floor lower-bound assertion |
| R18, R20, R25, R27–R29 (DATA/BUS monitor) | Bulk-import integration + edge-case suite; JSONB migration round-trip; Q&A role-negative; calculator unit tests |
| R30, R32–R35 (PERF monitor) | k6 baseline + Lighthouse per route |
| R36, R39, R40, R43, R44 (TECH monitor) | OpenAPI spec-diff CI; plugin compatibility manual smoke; audio upload mid-fail E2E |
| R47 (OPS monitor) | Sentry-quota alert tested via monitoring dashboard |

---

## NFR Test Coverage Plan

| NFR Category | Requirement / Threshold | Planned Validation | Tool / Level | Evidence Artifact | Priority |
|---|---|---|---|---|---|
| Security — Auth/RLS | bcrypt 12; 15min/7d/30d tokens; rate limit; RLS null-guard | Go handler+store integration + Playwright E2E | Go test + Playwright | `evidence/auth-security.json`, `evidence/rls-cross-tenant.json` | P0 |
| Security — File upload | R2 key shape, presigned 5–15min, MIME allowlist | Go handler integration + E2E | Go test + Playwright | `evidence/r2-upload.json` | P0 |
| Security — Audit | Append-only at DB layer | Go store integration | Go test | `evidence/audit-invariants.json` | P0 |
| Security — OWASP | SQL injection / XSS / CSRF / SSRF | E2E + integration | Playwright + Go | `evidence/owasp.json` | P0 |
| Security — Secret handling | No keys in logs/responses | CI log-scan + integration | CI + Go | `evidence/secret-scan.json` | P0 |
| Performance — Page load <2s on 4G | Per-route Lighthouse CI | Lighthouse CI | `evidence/lighthouse.json` | P1 |
| Performance — Search <500ms | k6 50 VUs sustained | k6 | `evidence/k6-search.json` | P0 |
| Performance — Grading view <3s | Playwright `waitForResponse` timing | Playwright | `evidence/grading-load.json` | P1 |
| Performance — N+1 ≤ N | Query count assertion per endpoint | Go test (instrumented pool) | `evidence/query-count.json` | P0 |
| Performance — AI polling backoff | Worker timing test | Go test | `evidence/ai-polling.json` | P1 |
| Performance — Constant-time 200ms | Go integration (lower-bound only) | Go test | `evidence/constant-time.json` | P1 |
| Performance — Autosave threshold | **UNKNOWN** | Defer | — | — |
| Reliability — Retries | Email + AI retry suites | Go worker integration | `evidence/retries.json` | P0 |
| Reliability — Health | `/api/health` 200 + DB status | Go integration (shipped Story 1.2b) | `evidence/health.json` | P0 |
| Reliability — Uptime SLO | **UNKNOWN** | Defer | — | — |
| Scalability — concurrent users, AI throughput | **UNKNOWN** | Defer k6 stress test | — | — |
| Accessibility — WCAG 2.1 AA | Every route + component | vitest-axe + axe-cli E2E | `evidence/axe.json` | P0 |
| Mobile — 48px / 44×44 touch, 390×844 | Playwright mobile project | Playwright | `evidence/mobile.json` | P1 |
| i18n — en + vi parity, runtime switch | CI parity step + bilingual E2E | CI + Playwright | `evidence/i18n.json` | P0 |
| Observability — request_id propagation | Handler integration | Go test (with RecordingErrorReporter) | `evidence/observability.json` | P1 |
| Data retention / PDPD | **UNKNOWN** | Defer | — | — |
| Malware scanning | **UNKNOWN** | Defer | — | — |

**Missing thresholds or evidence sources:** autosave ms target, uptime SLO, scalability targets (tenant count, concurrent users, AI jobs/min), data-retention period, malware-scan provider. All require PM + Eng decisions; see Architecture doc § BLOCKERS.

---

## Entry Criteria

- [ ] All BLOCKERS resolved (A2, A6, A7, A8, A9, A10, SLO) — see Architecture doc
- [ ] Test environments provisioned: local Docker, CI (GitHub Actions), staging (Railway test instance with mock Polar + mock Gemini)
- [ ] Test data factories ready (Go + Playwright fixtures)
- [ ] Story 1.5 + 1.6 shipped (auth flows needed for any E2E that touches login)
- [ ] Epic 1C frontend shell shipped (first time a real browser can hit the app)
- [ ] Mock Resend, mock Polar, mock Gemini available in test env
- [ ] R2 mock bucket configured for upload E2E
- [ ] BrowserStack subscription OR physical-device sweep checklist (Epic 5 release-gate)

## Exit Criteria

- [ ] All P0 tests passing (100%)
- [ ] All P1 tests passing ≥95%
- [ ] All 2 BLOCK risks mitigated with linked test evidence
- [ ] All 25 MITIGATE risks have a documented mitigation + at least 1 test
- [ ] Cross-tenant grid (J15) 100% green for 3 consecutive nightly runs
- [ ] No open P0/P1 bugs
- [ ] Flaky test ratio <2% on rolling 30-day window
- [ ] NFR evidence artifacts populated for `bmad-testarch-nfr` workflow
- [ ] Trace matrix passes `bmad-testarch-trace` (≥80% AC coverage on P0/P1)

---

## Test Coverage Plan

> **IMPORTANT:** P0/P1/P2/P3 = **priority / risk level** (what to focus on first), not execution timing. The Execution Strategy section below maps tests to PR / Nightly / Weekly buckets.

### P0 (Critical)

**Criteria:** Blocks core functionality + High risk (≥6) + No workaround + Affects majority of users or money flow.

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| **P0-001..312** | Cross-tenant adversarial grid: 13 resource families × 6 attack vectors × 4 roles | Go integration (store + handler) | R1, R2, R3, R4, R26 | Generated from fixture table; Playwright runs 10-cell representative smoke nightly |
| **P0-313..320** | Worker tenant-context per job type (J15-NULL workers) | Go worker integration | R3 | One adversarial test per job type; J15 grid pattern |
| **P0-321..325** | RLS null-tenant guard per table | Go store integration | R2 | Per table; uses `test.SetupDB` without `SET LOCAL` |
| **P0-326..345** | Auth security: lockout, refresh rotation, cookie attrs, CORS, Origin check, rate limit, role re-val, JWT spoofing | Go handler integration | R4–R8, R13, R15 | INT-AUTH-051..060 |
| **P0-346..355** | Submission immutability after release + enrollment_history append-only | Go service + store + Playwright E2E | R16, R17 | E2E-J5-006/007, E2E-J13-003 |
| **P0-356..380** | Plan grace state machine days 0/3/5/6/7 with MockClock | Go service integration + Playwright E2E | R21, R24 | E2E-J11-001..004 + integration time-travel |
| **P0-381..390** | Polar webhook signature + idempotency + replay rejection | Go handler integration | R11 | INT-POLAR-001..005 |
| **P0-391..395** | AI credit refund-on-failure (depends on A6) | Go worker integration | R23 | Ledger assertion |
| **P0-396..420** | Critical journey E2Es: J1-001, J2-001, J3-001..005, J5-001..007, J6-001, J7-001, J10-001/002, J11-001..004, J13-001/003, J15-NULL, J16-002, J17-001/003, J18-001 | Playwright E2E | R1, R4, R6, R11, R16, R21–R26, R38, R42 | Bilingual sweep on J5-004 and J17-003 |
| **P0-421..425** | i18n parity (CI step) + bilingual smoke (Playwright) | CI + Playwright | R38 | en.json ≡ vi.json key set; no raw-key strings appear |
| **P0-426..430** | Search role-scoping per role (Cmd+K results) | Go handler integration + Playwright | R26 | Per role × per result type |
| **P0-431..435** | Bulk CSV import partial-success with duplicates + malformed rows | Go service integration | R18 | Edge cases enumerated in J14 |
| **P0-436..440** | R2 presigned URL cross-tenant prefix guess + content-type lock | Go handler integration + Playwright | R9 | Depends on A10 policy |
| **P0-441..445** | Secret-in-logs CI scanner + service-level Gemini key check | CI + Go test | R49 | Known-secret regex |
| **P0-446..448** | Migration data-preservation (up → seed → down → up → assert data present) | CI test harness | R50 | Per-migration |
| **P0-449..454** | Accessibility — zero axe violations on all public routes | vitest-axe + axe-cli E2E | (cross-cutting) | Per route |

**Total P0:** ~**120 unique scenarios** (the J15 grid expands to 312 cells generated from one fixture; reading the grid as one logical test for sizing).

---

### P1 (High)

**Criteria:** Important features + Medium-to-high risk (R-Medium, MONITOR ≥4) + Common workflows + Workaround exists but degraded.

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| **P1-001..050** | Component test trilogy (Loading / Success / Error) per component fetching data | Vitest + MSW | R44, R47 | Generated per component |
| **P1-051..080** | Role-based rendering negative coverage (component absent from DOM for unauthorized roles, not hidden) | Vitest + MSW | R25, R26, R15 | Sidebar, dashboards, Q&A, billing, permissions matrix, Cmd+K results |
| **P1-081..120** | RHF form trilogy per form (validation + submit-success + submit-failure with optimistic rollback) | Vitest + MSW with `failOnce` | R42 | Every RHF form |
| **P1-121..140** | Writing editor autosave + draft recovery + multi-tab BroadcastChannel | Vitest + Playwright | R42 | Dedicated suite per TEST-UX-3 |
| **P1-141..165** | Secondary critical journeys: J2-002, J3-004, J4-001..003, J5-002/003/005, J6-002/003, J7-002..005, J8-001..003, J9-001..003, J13-002/004, J14-001..004, J16-001, J17-002, J19-001..004, J20-001/002 | Playwright E2E | R5, R15, R17–R19, R23, R29, R30 | Includes E2E-J18-002 (mobile touch targets) |
| **P1-166..180** | Email retry queue extended cases (panic recovery, full-buffer non-blocking, max-retry drop) | Go worker integration | R44 | Extends Story 1.2d's 5 cases |
| **P1-181..200** | Performance — k6 baseline (search, dashboard, AI polling) | k6 | R32, R34 | Nightly tier |
| **P1-201..220** | Performance — Lighthouse CI per public route | Lighthouse CI | R34 | Per-route P95 / FCP / LCP targets |
| **P1-221..230** | Constant-time 200ms floor + AI polling backoff timing | Go integration | R14, R30, R35 | Lower-bound assertions |
| **P1-231..235** | OpenAPI spec-diff CI | CI | R36 | Fails on drift |
| **P1-236..240** | EXPLAIN ANALYZE harness on dashboard endpoints | CI | R31 | No seq-scan on tenant-filtered indexes |

**Total P1:** ~**150 scenarios**.

---

### P2 (Medium)

**Criteria:** Secondary features + Low-to-medium risk + Edge cases + Regression prevention.

| Test ID | Requirement | Test Level | Risk Link | Notes |
|---|---|---|---|---|
| **P2-001..020** | Calculator unit tests (band score, late penalty, plan-limit math, at-risk thresholds, audit timestamp) | Go unit | R27, R29 | Pure functions |
| **P2-021..040** | Archive flows (Owner/Admin/Teacher) | Playwright E2E | (cross-cutting) | One per role per archive section |
| **P2-041..060** | Visual regression on critical en/vi screens (dashboard, grading view, billing, mobile auth) | Playwright `toHaveScreenshot` | R38 | Manual baseline approval |
| **P2-061..075** | Mobile breakpoint tests (390×844 + tablet) on critical pages | Playwright mobile | F1 | Layout overflow detection |
| **P2-076..080** | JSONB schema migration round-trip (write old → read with new schema → write new → read back) | Go store integration | R20 | Per JSONB field type |

**Total P2:** ~**80 scenarios**.

---

### P3 (Low)

**Criteria:** Nice-to-have + Exploratory + Performance benchmarks + Rare paths.

| Test ID | Requirement | Test Level | Notes |
|---|---|---|---|
| **P3-001..010** | Exploratory testing sessions per epic | Manual | Time-boxed; document findings in deferred-work.md |
| **P3-011..020** | k6 stress + spike tests (once SLOs defined) | k6 | Weekly tier |
| **P3-021..030** | Real Gemini smoke (1 per AI flow, shape-only assertion, quarantine-allowed) | Playwright + Gemini | Nightly tier |

**Total P3:** ~**30 scenarios**.

---

## Execution Strategy

**Philosophy:** Run everything in PR unless it has significant infrastructure overhead (k6, real-Gemini, real-Polar, real-R2, real-iOS device). Playwright parallelized across 4–8 shards completes critical-path E2E in <12 min.

### Every PR (~12–15 min target)

- **All Go tests:** unit + service + store + handler + worker integration, parallelized per package with shared DB pool
- **All Vitest tests:** component, hook, store, sharded 4-way
- **Playwright smoke (~10 scenarios):** J1-001, J5-004, J6-001, J7-001 (mobile-safari), J10-001, J11-002, J13-001, J15-NULL representative, J17-003 (bilingual), J18-001
- **CI guards:** i18n parity, OpenAPI spec-diff, atomic-PR for breaking changes, secret-in-logs scanner
- **vitest-axe accessibility:** every component test
- **Lighthouse CI:** changed routes only
- **Coverage:** ≥80% backend, ≥75% frontend

### Nightly (~45 min)

- **Full Playwright E2E suite:** J1–J20 on chromium + webkit + firefox + mobile-chrome + mobile-safari projects
- **Full bilingual run** of P0 E2Es (en + vi)
- **Full J15 grid:** 312 Go integration cells (already in PR but re-run as canary)
- **k6 baseline:** search, dashboard, AI polling (load-only, not stress)
- **Real-Gemini smoke:** 1 per AI flow type, shape-only assertion, quarantine-allowed
- **Visual regression baseline diff:** critical en + vi screens
- **EXPLAIN ANALYZE harness** on dashboard endpoints

### Weekly (~3–4 hours)

- **k6 stress + spike** (once SLO defined — currently blocked)
- **50-concurrent-tenant load** test
- **Real Polar.sh sandbox** integration with real webhooks
- **Real R2** upload + download + cross-tenant adversarial
- **Real iOS Safari device sweep** for speaking recorder (BrowserStack or physical)
- **Full visual regression baseline approval**

### Release Gate (manual + automated)

- PR + Nightly green 3 consecutive runs
- All BLOCK risks mitigated; all MITIGATE risks have linked evidence
- NFR evidence artifacts populated → input for `bmad-testarch-nfr`
- Trace coverage report from `bmad-testarch-trace`
- External pentest report attached (pre-launch only)

---

## QA Effort Estimate

QA test development effort only (excludes Backend implementation, DevOps CI changes beyond scaffolding, PM clarifications):

| Priority | Count | Effort Range | Notes |
|---|---|---|---|
| P0 | ~120 | **~140–200 hours** | Heavy: cross-tenant grid generator, MockClock propagation, time-travel suites |
| P1 | ~150 | **~80–130 hours** | Component trilogies, MSW fault-injection, role-negative coverage, secondary journey E2E |
| P2 | ~80 | **~30–55 hours** | Edge cases, visual regression baselines, Lighthouse setup |
| P3 | ~30 | **~5–15 hours** | Exploratory time-boxed, k6 stress (deferred), real-Gemini smoke |
| **NFR scaffolding** | — | ~15–25 hours k6 + ~10–15 hours axe + ~6–10 hours i18n CI | One-off |
| **Test infrastructure (Phase 0)** | — | ~30–50 hours cross-domain config, worker harness, factories, MockClock propagation, MSW helpers | One-off |
| **CI pipeline wiring (5 pipelines + matrix shards)** | — | ~15–25 hours | One-off |
| **TOTAL (scaffold + initial mass)** | ~380 | **~330–525 hours** | 1 senior test engineer + 1 dev-test pairing partner |

**Calendar:** **~8–12 weeks** for one engineer carrying the full load, **~4–6 weeks** if the per-story test mass is folded into ATDD on every dev story.

**Dependencies from other teams:** see Dependencies & Test Blockers and Architecture doc.

---

## Epic 1D Refresh (2026-06-15) — Component Library Buildout (Path B)

> **Why this section exists.** The baseline matrix above predates Epic 1D. Path B (per `sprint-change-proposal-2026-06-03.md`, sprint update 2026-06-07) added 4 stories — 1d-1 (Storybook foundation), 1d-2 (34 shadcn primitives), 1d-3 (10 app-shell components), 1d-4 (8 visual-bridge components) — that need their own P0–P3 decomposition. This section is the matrix delta. Companion risk inheritance lives in `test-design-architecture.md` § "Epic 1D Refresh (2026-06-15)" — read that first if you haven't.
>
> **What this section does NOT do.** It does not re-run TD for Epics 1A/1B/1C (shipped). It does not generate test scaffolds (that's per-story `/bmad-tea AT` work post-gate). It does not pre-commit Epic 3 Story 3.4 to a calendar library — that spike's outcome is the source of truth.
>
> **Mock seam constraint (TEST-FE-1) — non-negotiable.** Every Storybook `Empty` story for a data-rendering component is driven by MSW returning empty arrays/objects (e.g. `HttpResponse.json({ data: [] })`). NEVER by mocking `useQuery`/`useMutation`. A story file mocking a TanStack Query hook is a code-review reject. The 1d-2/1d-3/1d-4 dev-pickup checklist references this convention via `classlite-web/docs/storybook-conventions.md` (shipped by 1d-1 AC8 § 6).

### Component Inventory (in-scope for Epic 1D matrix)

**Total: ~52 component files / ~24 matrix rows.** Grouping 1d-2 primitives by AC category for matrix sanity; 1d-3 and 1d-4 decomposed individually.

| Source Story | Component / Group | Count | FW-7 Tier | Role-Variant? | Data-Rendering? |
|---|---|---|---|---|---|
| 1d-1 | Foundation (Storybook + decorators + CI gates + parity helper + smoke + negative fixtures) | n/a | n/a | n/a | n/a |
| 1d-2 (AC1) | Form/selection primitives (`Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Slider`, `Label`, `Form`, `Toggle`, `ToggleGroup`) | 12 | `ui/` | No | No (primitives) |
| 1d-2 (AC2) | Overlay primitives (`Dialog`, `AlertDialog`, `Sheet`, `Drawer`, `Popover`, `Tooltip`, `HoverCard`) | 7 | `ui/` | No | No |
| 1d-2 (AC3) | Menu/command primitives (`DropdownMenu`, `ContextMenu`, `Command`, `NavigationMenu`) | 4 | `ui/` | No | No |
| 1d-2 (AC4) | Feedback/indicator primitives (`Badge`, `Avatar`, `Skeleton`, `Progress`, `Sonner`) | 5 | `ui/` | No | No |
| 1d-2 (AC5) | Layout primitives (`Card`, `Separator`, `ScrollArea`, `Accordion`, `Collapsible`, `Tabs`, `Calendar`) | 7 | `ui/` | No | No |
| 1d-2 (AC6) | Data primitives (`Table`, `Breadcrumb`, `Pagination`) | 3 | `ui/` | No | No |
| 1d-3 (AC1) | Shell skeleton (`AppShell`, `TopbarShell`, `BreadcrumbBar`, `SearchPill`, `UserPill`, `PageHead`, `SidebarNavItem`) | 7 | `domain/` | No (consumer passes role as prop) | `PageHead` only |
| 1d-3 (AC2–AC5) | `SidebarShell` | 1 | `domain/` | **Yes — Owner/Admin/Teacher/Student** | No |
| 1d-3 (AC7) | `MobileTabBar` + `MobileTab` | 2 | `domain/` | **Yes — Student/Teacher/Owner** (Admin shares Owner per IA Chapter 8) | No |
| 1d-4 (AC1) | `WriteDocSurface` | 1 | `domain/` | No | **Yes** |
| 1d-4 (AC2) | `WritingGradingSurface` + `CommentCard` | 2 | `domain/` | No | **Yes** |
| 1d-4 (AC3) | `SpeakingGradingSurface` | 1 | `domain/` | No | **Yes** |
| 1d-4 (AC4) | `AnchoredQuestionCard` | 1 | `domain/` | No (uses `variant` prop, not role) | **Yes** |
| 1d-4 (AC5) | `MobileWritingSurface` | 1 | `domain/` | No | **Yes** |
| 1d-4 (AC6) | `InboxListShell` + `InboxRow` | 2 | `domain/` | **Yes — Teacher/Student/AdminOwner** | **Yes** |
| 1d-4 (AC7) | `AnalyticsHomeShell` + `ScopeBar` | 2 | `domain/` | **Yes — Teacher/Admin/Owner** | **Yes** |

### P0 — Critical (Epic 1D)

**Criteria for Epic 1D P0:** anything that, if broken, blocks 1d-2/1d-3/1d-4 from merging OR silently violates a documented project rule (TEST-FE-1, FW-7, UX-2, UX-3, UX-DR28, UX-DR29, TS-6).

| Test ID | Requirement | Test Level | Risk Link | Story | Notes |
|---|---|---|---|---|---|
| **1D-P0-001** | `assertI18nParity(usedKeys)` Vitest helper (at `classlite-web/src/lib/test/i18n-parity.ts`) raises with readable diff when a `usedKey` is missing from `vi.json` | Vitest | R38 | Inherited from 1-7c (`i18n-parity.test.ts` line 9-13) | **CORRECTED 2026-06-15:** Already shipped at Story 1-7c (2026-06-12). Verify on every PR via existing test file. No new red phase needed — discharge already on the branch. |
| **1D-P0-002** | `assertI18nParity` raises with readable diff naming the missing key (covers both `en`-only and `vi`-only orphans) | Vitest | R38 | Inherited from 1-7c (`i18n-parity.test.ts` line 15-26) | **CORRECTED 2026-06-15:** Already shipped at Story 1-7c. Same helper handles both directions. |
| **1D-P0-003** | `npm run i18n-parity` (CLI script `scripts/i18n-parity.mjs`) exits non-zero when locale keysets diverge OR when values are empty | CI integration | R38 | Inherited from 1-7c (`.github/workflows/ci-web.yml:69–77`) | **CORRECTED 2026-06-15:** Already wired as required PR check labeled "Story 1.7c AC9 — R38 mitigation". Note: script name is hyphenated (`i18n-parity`), not colon-separated as the original 1d-1 AC4 sketch suggested. |
| **1D-P0-003b** | Per-story `describe('Story 1d-N i18n parity (R38)', ...)` block extends `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` for each of 1d-2, 1d-3, 1d-4 — enumerates that story's new i18n keys and calls `assertI18nParity(STORY_KEYS)` | Vitest | R38 inheritance | 1d-2 / 1d-3 / 1d-4 dev work | Inline dev work, NOT a separate ATDD ceremony — the 1-7c pattern at `i18n-parity-coverage.test.ts` is the template. New `describe` block added per story alongside its component tests. |
| **1D-P0-004** | Three-tier Vite/Rolldown ladder records outcome in `storybook-rolldown-spike.md` (Tier A, B, or C documented with failure modes) | Spike doc artifact | R39 | 1d-1 AC1 | Spike doc is the gate artifact; tier outcome non-negotiable for review. |
| **1D-P0-005** | Storybook `main.ts` resolves at the chosen tier (Tier A Rolldown OR Tier B dual-builder); `npm run storybook` boots without builder errors | Manual + CI | R39 | 1d-1 AC1 | If Tier C invoked, this scenario is N/A and the cascading deferral in 1d-2/1d-3/1d-4 applies. |
| **1D-P0-006** | Storybook `main.ts` + `preview.tsx` boot with all six decorator layers + preview-side deps in the documented composition order (Router outermost → MSW innermost, preview-side deps registered before decorators) | Smoke render via `storybook:test` | R39, R52 | 1d-1 AC2 | Decorator-chain-order regression is a test-design violation. |
| **1D-P0-007** | `@storybook/test-runner` `postRender` hook FAILS when `fixtures/missing-empty-export.stories.tsx` is present (negative fixture asserts the rule has teeth) | `storybook:test` | R52 | 1d-1 AC3 | Without this scenario passing, UX-DR28 has no enforcement. |
| **1D-P0-008** | `@storybook/test-runner` `prerender` hook FAILS when a misplaced `*.stories.tsx` is present (outside `ui/`/`domain/`/`features/*/components/`) | `storybook:test` | (FW-7) | 1d-1 AC7 | Same negative-fixture pattern; FW-7 enforced at merge. |
| **1D-P0-009** | `vitest-axe` + `@storybook/addon-a11y` audit on smoke story (`Button.stories.tsx`) returns zero violations | `storybook:test` | R51 | 1d-1 AC5, AC9 | The smoke story is the canonical reference for downstream story authors. |
| **1D-P0-010** | CI `storybook` job is green end-to-end (i18n parity + storybook:build + storybook:test all required) within the 8-minute soft cap | GitHub Actions | R39, R51, R52 | 1d-1 AC6, AC9 | If runtime trends > 8 min after 100 stories, document the shard-by-pattern plan in `storybook-conventions.md`. |
| **1D-P0-011** | All 34 shadcn primitives in `src/components/ui/` carry zero raw hex values, zero default shadcn `slate-*`/`zinc-*`/`neutral-*` Tailwind classes | grep + CI | (token discipline) | 1d-2 AC7 | Pattern 1 (`:root` CSS-variable override) is preferred; Pattern 2 file edits documented with `// CL-THEME-SWAP:` comment. |
| **1D-P0-012** | `Form.stories.tsx` `WithRHFAndZodResolver` renders the canonical RHF + `zodResolver` wiring with success + validation-error paths — the verbatim contract 1d-7 + Epic 2–10 forms inherit | `storybook:test` smoke | (FW-8 contract) | 1d-2 AC1 | Writing editor exemption (Epic 5) called out in story file comment. |
| **1D-P0-013** | `Calendar.stories.tsx` does NOT call `new Date()` in render; uses `parameters.now: '2026-06-15T00:00:00Z'` ISO string | grep `src/components/ui/`+ inspection | (TS-6) | 1d-2 AC5 | Without this, axe snapshots non-deterministic and locale tests flake. |
| **1D-P0-014** | `Calendar.stories.tsx` `LocaleVi` story renders Vietnamese date format (passes `vi` from `date-fns/locale`) | `storybook:test` | R38, (UX-2) | 1d-2 AC5 | Inherited by 1d-4's `AnalyticsHomeShell.ScopeBar` (date-range picker) and 1d-8's calendar spike. |
| **1D-P0-015** | `SidebarShell` `OwnerView` story renders the exact nav set from `classlite-ia.md` line 16 (9 items, ordered) | `storybook:test` + `play` function | (IA fidelity) | 1d-3 AC2 | IA citation embedded in `SidebarShell.tsx` header comment so nav changes are atomic with IA updates. |
| **1D-P0-016** | `SidebarShell` `AdminView` story matches `classlite-ia.md` line 17 (Owner nav MINUS `Settings`) | `storybook:test` + `play` function | (IA fidelity) | 1d-3 AC3 | Settings-absence asserted explicitly per TEST-FE-6 (test what's absent). |
| **1D-P0-017** | `SidebarShell` `TeacherView` story matches `classlite-ia.md` line 18 (10 items, Teacher-specific copy) AND asserts ABSENCE of `Settings` + `People` labels | `storybook:test` + `play` function | (IA fidelity, TEST-FE-6) | 1d-3 AC4 | Role-negative coverage — Teacher must not see admin items. |
| **1D-P0-018** | `SidebarShell` `StudentView` story matches `classlite-ia.md` line 19 (7 items, student-tone copy) AND asserts ABSENCE of `Settings`, `People`, `Knowledge hub`, `Archive`, `Analytics` labels | `storybook:test` + `play` function | (IA fidelity, TEST-FE-6) | 1d-3 AC5 | Most restrictive role; most absence assertions. |
| **1D-P0-019** | `MobileTabBar` `StudentView`, `TeacherView`, `OwnerView` stories each render the 5-tab set from `classlite-ia.md` Chapter 8 verbatim; AdminView NOT a separate variant (shares Owner per IA convention) | `storybook:test` + `play` function | (IA fidelity, UX-4) | 1d-3 AC7 | Story comment documents Admin-shares-Owner-mobile rationale. |
| **1D-P0-020** | `AppShell` `Mobile` story confirms `SidebarShell` is ABSENT from the DOM (not just CSS-hidden) below `md` breakpoint | `storybook:test` + `play` function | (TEST-FE-6, UX-4) | 1d-3 AC8 | Screen-reader pollution from invisible nav is a real failure mode; visual review misses it. |
| **1D-P0-021** | `InboxListShell` ships THREE separate role-variant stories (`TeacherView`/`StudentView`/`AdminOwnerView`) — NOT one component branching on role internally | Code review + `storybook:test` | (UX-3, UX-DR29) | 1d-4 AC6 | Per UX-3, role-rendering uses separate components/variants. |
| **1D-P0-022** | `AnalyticsHomeShell` `ScopeBar` `TeacherView` story renders "Center-wide" scope pill DISABLED (visually + functionally); `AdminView`/`OwnerView` render all scope pills enabled | `storybook:test` + `play` function | (UX-DR29, role discipline) | 1d-4 AC7 | Per UX-DR29 scope-pill role discipline. |
| **1D-P0-023** | All 1d-4 components have JSDoc header comments naming the feature epic + story that wires behavior (no orphan behavior implementation) | grep + code review | (static-shell discipline) | 1d-4 AC8 | The load-bearing constraint of 1d-4 — without these comments, the next dev wires behavior in the wrong place. |
| **1D-P0-024** | All 1d-4 components have ZERO `new Date()` calls in render (grep `src/components/domain/` 1d-4 files) | grep + CI | (TS-6) | 1d-4 AC8 | ISO strings via `parameters.now` everywhere. |
| **1D-P0-025** | `assertI18nParity()` passes after 1d-2 + 1d-3 + 1d-4 land — every new key added by Epic 1D is in BOTH `en.json` and `vi.json` | CI | R38 | 1d-1 AC4 inheritance | The discharge evidence for R38 across the whole epic. |

**Total Epic 1D P0:** **25 unique scenarios.**

### P1 — High (Epic 1D)

**Criteria for Epic 1D P1:** scenarios that catch real regressions per-component three-state coverage, locale switching, axe baseline maintenance, and Vietnamese-length overflow checks.

| Test ID | Requirement | Test Level | Risk Link | Story | Notes |
|---|---|---|---|---|---|
| **1D-P1-001..030** | Per-primitive `*.stories.tsx` Default + variant exports (1d-2 AC1–AC6) render via `storybook:test` smoke (one scenario per primitive, asserting zero crashes + zero axe violations) | `storybook:test` | R51 | 1d-2 (all ACs) | 30 primitives × 1 smoke assertion each. The 4 remaining primitives (Skeleton's 5 shape variants, Form's canonical-wiring story) are P0 above. |
| **1D-P1-031..035** | `Form.stories.tsx` `WithRHFAndZodResolver` renders both happy path (Zod schema valid) AND validation-error path | `storybook:test` + `play` | R51 | 1d-2 AC1 | RHF + Zod canonical wiring — every Epic 2–10 form story will inherit. |
| **1D-P1-036..040** | Overlay primitives (`Dialog`, `AlertDialog`, `Sheet`, `Drawer`) `play` function asserts focus return to trigger on `Escape` | `storybook:test` + `play` (`@storybook/test`) | (TEST-UX-2) | 1d-2 AC2 | Canonical reference 1d-7 will reuse. |
| **1D-P1-041..044** | Menu/command primitives (`DropdownMenu`, `ContextMenu`, `Command`, `NavigationMenu`) `play` function asserts arrow-key + Enter + Escape keyboard nav | `storybook:test` + `play` | (TEST-UX-2) | 1d-2 AC3 | Pre-commits the keyboard contract for the eventual ⌘K palette. |
| **1D-P1-045..048** | `Tooltip` + `Popover` + `Select` + `Calendar` stories include `LongVietnameseContent` / `LongVietnameseOption` variants — overflow + word-wrap behavior at ~1.5x English length | `storybook:test` | R38, (UX-2) | 1d-2 AC1, AC2, AC5 | Real failure mode at the 220px sidebar layout; same risk on dropdown/calendar/tooltip. |
| **1D-P1-049..052** | `Skeleton` + `Progress` honor `prefers-reduced-motion` (pulse + indeterminate animations disabled when `parameters.reducedMotion: 'reduce'`) | `storybook:test` | (TEST-UX-2, a11y) | 1d-2 AC4 | Real failure mode for vestibular-disorder users. |
| **1D-P1-053..059** | `PageHead.stories.tsx` three-state exports (Default, Loading, Empty, Error) render via the `EmptyStatePlaceholder`/`ErrorStatePlaceholder` from 1d-1 — covering the only data-rendering shell component in 1d-3 | `storybook:test` | R51 | 1d-3 AC1 | The other 6 1d-3 shell components are pure layout and ship `Default` only. |
| **1D-P1-060..065** | `SidebarNavItem` stories (Default, Active, WithBadge, WithBadgeAndActive, Disabled, LongVietnameseLabel) each render with correct `aria-label` + `aria-current="page"` semantics | `storybook:test` + `play` | (TEST-UX-2, a11y) | 1d-3 AC6 | Active-state aria contract + badge aria contract (`"Inbox, 3 unread"`). |
| **1D-P1-066..069** | `AppShell.stories.tsx` exports `Desktop`, `Mobile`, `MobileWithBillingGrace`, `Tablet` — each renders correctly at its viewport | `storybook:test` (viewport addon) | (UX-4) | 1d-3 AC8 | Mobile-vs-desktop swap driven by Tailwind responsive prefixes, no JS viewport listeners. |
| **1D-P1-070..081** | 1d-4 data-rendering shells (`WriteDocSurface`, `WritingGradingSurface`, `SpeakingGradingSurface`, `AnchoredQuestionCard`, `MobileWritingSurface`, `InboxListShell`, `AnalyticsHomeShell`) each ship three-state coverage (Default + Loading where applicable + Empty + Error) using placeholders from 1d-1 | `storybook:test` | R51, R52 | 1d-4 AC1–AC7 | 7 shells × avg 1.7 three-state assertions = 12 scenarios. Speaking + Mobile use `Empty` only (no Loading skeleton — they're static shells). |
| **1D-P1-082..088** | All 1d-3 + 1d-4 components render with `aria-label` strings RESOLVED VIA i18n (not hardcoded English) when locale toolbar switches to `vi` | `storybook:test` + i18n.t resolution | R38, (TEST-FE-4, TEST-UX-1) | 1d-3 AC9, 1d-4 AC8 | Per TEST-UX-1: a screen reader speaking English to a Vietnamese user is a failure that looks like a pass. |
| **1D-P1-089..094** | Vietnamese rendering at 220px sidebar layout — no truncation crashes, focus-revealed tooltip pattern works for truncated nav labels (e.g., "Trung tâm kiến thức") | `storybook:test` (viewport) + `play` | R38 | 1d-3 AC9 | Documented truncation fallback. |
| **1D-P1-095..100** | `WritingGradingSurface` + `SpeakingGradingSurface` band-score typography passes UX-DR22 spec (Geist Mono 28px primary, Geist Mono 14px per-criterion); fonts loaded via preview-side dep registration from 1d-1 AC2 | Visual inspection + `storybook:test` smoke | R53 | 1d-4 AC2, AC3 | Designer iteration surface — token tweaks land in `tokens.css`, never per-component edits. |
| **1D-P1-101..104** | `WritingGradingSurface` comment taxonomy renders THREE colors verbatim (red `--cl-status-danger` errors, green `--cl-status-success` praise, amber `--cl-accent-2` suggestions) per AC2 fixture HTML | Visual + `storybook:test` | R53 | 1d-4 AC2 | Taxonomy fidelity matters for the designer's iteration loop. |
| **1D-P1-105..108** | `MobileTabBar` touch targets ≥ 44×44px per TEST-UX-4 (verified at `iphone-14` viewport) | `storybook:test` + `play` getBoundingClientRect | (TEST-UX-4) | 1d-3 AC7 | Mobile a11y baseline. |
| **1D-P1-109..114** | All Epic 1D components expose stable `data-testid` selectors per AC9 conventions (`sidebar-nav-{slug}`, `mobile-tab-{slug}`, `user-pill-role`, `breadcrumb-current`, etc.); selectors documented in `storybook-conventions.md` | grep + doc review | (downstream regression contract) | 1d-3 AC9, 1d-4 AC8 | Selector contract for Epic 2–10 integration tests. |

**Total Epic 1D P1:** **~114 scenarios.**

### P2 — Medium (Epic 1D)

**Criteria for Epic 1D P2:** secondary visual fidelity, designer-iteration smoke, and downstream consumer contract verification.

| Test ID | Requirement | Test Level | Risk Link | Story | Notes |
|---|---|---|---|---|---|
| **1D-P2-001..010** | Story-author UX — running `npm run storybook:test` locally reproduces every CI failure mode (i18n parity, three-state lint, FW-7 placement, axe violation) within 8 minutes on a developer laptop | Manual + DX smoke | R39, R51, R52 | 1d-1 (all gates) | Inner-loop trust — if a dev can't reproduce a CI failure locally, the gate erodes. |
| **1D-P2-011..018** | `WritingGradingSurface` `LongRail` (12+ comments) renders scroll behavior correctly; `RedHeavy` (6 errors / 1 praise / 1 suggest) shows visual density correctly | `storybook:test` (viewport) | (visual fidelity) | 1d-4 AC2 | Designer reviews these for visual density tuning. |
| **1D-P2-019..022** | `Avatar` `ColoredA1..A6` story exports render the 6-color avatar rotation correctly (data-driven, no hardcoded color branches) | `storybook:test` | (token discipline) | 1d-2 AC4 | Used by `BrandColorPicker` from 1d-7 eventually. |
| **1D-P2-023..028** | `Sonner` `WithTriggers` story exercises `toast.success`/`toast.error`/`toast.info` paths; toast bodies resolve via `t('storybook.toast.*')` keys (not production keys, not hardcoded English) | `storybook:test` + `play` | (i18n discipline) | 1d-2 AC4 | Keeps production translation files clean of storybook fixture copy. |
| **1D-P2-029..032** | Storybook artifact uploads to GitHub Actions as a downloadable for designer review (per 1d-1 AC6); preview deploy to Cloudflare Pages remains a follow-up improvement | CI artifact inspection | R53 | 1d-1 AC6 | Designer's iteration touchpoint until CF Pages preview deploy ships. |

**Total Epic 1D P2:** **~32 scenarios.**

### P3 — Low (Epic 1D)

| Test ID | Requirement | Test Level | Notes |
|---|---|---|---|
| **1D-P3-001..005** | Exploratory testing — designer reviews the full primitive Storybook (1d-2 ship), the shell Storybook (1d-3 ship), and the Phase-4 visual bridge Storybook (1d-4 ship) and files token-tweak / variant-tweak requests | Manual / designer review | Token tweaks land in `src/styles/tokens.css`, not per-component edits. |
| **1D-P3-006..008** | Visual regression baseline capture (Chromatic / Percy) — explicit non-goal in 1d-1; revisit post-Epic 1D | Deferred | Not in MVP scope per 1d-1 Out of Scope. |
| **1D-P3-009..010** | Per-primitive performance benchmarks (render time, bundle size delta per shadcn primitive) | Deferred | Not in MVP scope per 1d-2 Out of Scope. |

**Total Epic 1D P3:** **~10 scenarios.**

### Epic 1D Coverage Summary

| Priority | Count | Effort Range | Notes |
|---|---|---|---|
| **1D-P0** | 25 | ~30–50 hours | Foundation gates + IA-fidelity sidebar/mobile nav + static-shell discipline checks |
| **1D-P1** | ~114 | ~50–80 hours | Per-primitive + per-shell smoke + three-state + i18n + a11y + viewport |
| **1D-P2** | ~32 | ~10–20 hours | DX smoke + visual density + designer-artifact handoff |
| **1D-P3** | ~10 | ~3–5 hours | Exploratory designer review (mostly manual time-boxed) |
| **TOTAL Epic 1D** | **~181** | **~93–155 hours** | One frontend test pair × 2–3 sprints if folded into per-story ATDD per WF-8 |

### Epic 1D CI Gate Scenarios (1d-1 AC6 — All Required to Pass Before Merge)

Per `.github/workflows/ci-web.yml`'s new `storybook` job:

| Gate | Scenarios it Enforces | Soft Cap |
|---|---|---|
| `npm ci` | Dependency install green | — |
| `npm run i18n:parity` | 1D-P0-003, 1D-P0-025 | <30s |
| `npm run storybook:build` | 1D-P0-005 (boot at chosen tier) | <3min |
| `npm run storybook:test` — axe layer | 1D-P0-009, 1D-P1-001..030, 1D-P1-070..081 | <2min combined |
| `npm run storybook:test` — three-state lint layer | 1D-P0-007 + every data-rendering component's required exports | <30s |
| `npm run storybook:test` — FW-7 placement layer | 1D-P0-008 + every story file's path check | <30s |
| `npm run storybook:test` — smoke render layer | 1D-P0-010 (all stories render without crash) | <90s |
| Storybook artifact upload | 1D-P2-029..032 (designer downloadable) | <15s |
| **Total job soft cap** | All above | **8 minutes** (per 1d-1 AC6); shard-by-pattern when runtime trends > cap |

### Mock Seam Inheritance for 1d-2 / 1d-3 / 1d-4

Per TEST-FE-1 (project-context) + 1d-1 AC2:

- **Primitives (1d-2):** Primitives don't fetch data. The two exceptions are documented in 1d-2 Dev Notes (`Form.stories.tsx` uses a fake mutation handler; `Sonner.stories.tsx` triggers toasts via story controls). No MSW handlers needed in 1d-2 stories.
- **Shells (1d-3):** Shell components don't fetch data. The `Inbox` badge count is passed as a prop, not fetched in the shell — Epic 2+ stories owning the inbox state machine pass the count down via the layout slot. No MSW handlers in 1d-3 stories.
- **Visual-bridge shells (1d-4):** Static shells with all behavior deferred. Storybook stories drive every render via fixture props. No MSW handlers in 1d-4 stories. When feature epics inherit these shells (Epic 5/6/7/8/10), they wire MSW at the HTTP boundary per their own ACs.

A story file in any of these three stories that uses `vi.mock('@tanstack/react-query', ...)` or any cousin pattern is a test-design violation and a code-review reject. The convention lands in 1d-1's `storybook-conventions.md` § 6 and is the cited reference in 1d-2/1d-3/1d-4 dev-pickup checklists.

---

## Implementation Planning Handoff

| Work Item | Owner | Target Milestone | Dependencies / Notes |
|---|---|---|---|
| Phase 0 test infrastructure scaffolding | TEA + Frontend lead + Backend lead | Sprint immediately following BLOCKER resolution | Can start in parallel with BLOCKERs A2/A6/A8/A9/A10 |
| Worker tenant-context harness (A7) | Backend lead | Pre-Epic 4 ships | Architecture decision required first |
| MockClock propagation (A4) | Backend lead | Pre-Epic 6, 7, 9 | Inherit pattern from Story 1.4 |
| Cross-domain Playwright config (A3) | TEA + Frontend lead | Pre-Epic 1C E2E | Two projects with shared storageState |
| ATDD per story | Dev pairs | Per-story | Use `bmad-testarch-atdd` workflow |
| Cross-tenant grid (J15) generator | TEA | Sprint 1 post-BLOCKERs | Output: 312 generated Go integration tests |
| Plan grace-period time-travel suite | Backend lead + TEA | Epic 9 | Requires A8 (prices) and MockClock |

---

## Tooling & Access

| Tool / Service | Purpose | Access Required | Status |
|---|---|---|---|
| Playwright + playwright-utils | E2E + API testing | Already configured per tea config | Ready |
| Vitest + Testing Library + MSW | FE component testing | Already in stack | Ready |
| Go `testing` + `testify` + pgx test pool | BE unit / integration | Already shipped Story 1.1 | Ready |
| k6 | Load + perf | k6 CLI or k6 Cloud (decide) | Pending: k6 Cloud subscription? |
| Lighthouse CI | Page load NFR | npm package | Ready (needs CI wiring) |
| vitest-axe + axe-cli | Accessibility | npm packages | Ready |
| BrowserStack (or physical-device budget) | iOS Safari speaking recorder | Subscription OR device | **Pending decision** |
| Polar.sh sandbox | Webhook integration | Polar test account | Pending after Polar account created |
| Resend mock + sandbox | Email | Mock shipped Story 1.2d; real sandbox for weekly | Mock ready; sandbox pending |
| Mock Gemini deterministic stub | AI grading + generation | In-process Go interface | Pending: wire into AIGradeWorker (Epic 6) |
| Mock R2 (local MinIO or in-process stub) | File upload | Shipped Story 1.2e | Ready |

**Access requests needed:**
- [ ] Polar.sh sandbox account (PM)
- [ ] Resend sandbox API key (Backend lead)
- [ ] k6 Cloud subscription decision (Eng lead)
- [ ] BrowserStack subscription decision (Eng lead)

---

## Interworking & Regression

| Service / Component | Impact | Regression Scope | Validation Steps |
|---|---|---|---|
| `classlite-api` Go service | All backend changes | All Go test suites; J15 grid; auth integration | Per-PR CI + nightly |
| `classlite-web` React dashboard | All FE changes | All Vitest suites; Playwright E2E (J1–J20 nightly) | Per-PR CI + nightly |
| `classlite-landing` Astro site | Landing changes | Lighthouse SEO + a11y; 1 E2E smoke per page | Per-PR CI on landing changes |
| Database schema | Migrations | Migration data-preservation test (P0-446); RLS adversarial per affected table | CI runs migration round-trip |
| OpenAPI spec | Contract changes | spec-diff CI (P1-231); atomic-PR guard | Per-PR CI |

**Regression test strategy:**
- The J15 cross-tenant grid acts as the master regression for any backend change touching `Store` methods.
- Component test trilogies + MSW fault injection act as the master regression for FE changes.
- Lighthouse CI per route acts as the master regression for perceived performance.
- Visual regression baselines (selective) catch unintentional layout drift.
- Cross-team coordination: every breaking API change requires atomic PR (project-context WF-4).

---

## Appendix A: Code Examples & Tagging

**Playwright tags:**

```typescript
import { test, expect } from '../fixtures'

// P0 — cross-tenant adversarial smoke (representative of J15 grid)
test('@P0 @Security @CrossTenant teacher in centerA cannot read centerB students', async ({ apiRequest, seedTenant }) => {
  const { tenant: tenantA, ownerToken: tokenA } = await seedTenant('center-a')
  const { tenant: tenantB } = await seedTenant('center-b')
  const studentB = await apiRequest({
    method: 'POST',
    path: `/api/test/seed/students`,
    headers: { 'X-Test-Tenant': tenantB.id },
    body: { name: 'Bob in Center B' },
  })

  const { status, body } = await apiRequest({
    method: 'GET',
    path: `/api/students/${studentB.body.id}`,
    headers: { Authorization: `Bearer ${tokenA}` }, // wrong center
  })

  expect(status).toBe(404)
  expect(body.error?.code).toBe('STUDENT_NOT_FOUND')
})

// P0 — bilingual critical journey
test('@P0 @Journey @i18n grading flow in Vietnamese end-to-end', async ({ page, seedTenant, loginAs }) => {
  // ... seed fixtures
  await page.goto('https://my.classlite.app/?lang=vi')
  // Assert key resolution, not literal text
  const submitLabel = await page.evaluate(() => window.i18n.t('grading.release.submit'))
  await expect(page.getByRole('button', { name: submitLabel })).toBeVisible()
  // No raw key strings on page
  const html = await page.content()
  expect(html).not.toMatch(/grading\.[a-z.]+/)
})

// P1 — component test with MSW fault injection (rollback)
test('@P1 @Component @Rollback updateCourse mutation rolls back on 500', async ({ mount }) => {
  server.failOnce('PATCH', '/api/courses/:id', 500)
  const { findByText } = await mount(<CourseEditor course={mockCourse} />)
  // ... simulate edit + submit
  // Assert UI reverted to previous state
  expect(await findByText(mockCourse.title)).toBeVisible()
})
```

**Run by tag:**

```bash
# PR smoke (10 critical E2Es)
npx playwright test --grep "@P0 @Smoke" --shard=1/4

# Nightly full
npx playwright test

# Just cross-tenant adversarial
npx playwright test --grep "@CrossTenant"

# Just bilingual
npx playwright test --grep "@i18n"

# Mobile only
npx playwright test --project=mobile-safari --project=mobile-chrome
```

---

## Appendix B: Knowledge Base References

- **Risk governance:** `risk-governance.md`
- **Probability × impact scoring:** `probability-impact.md`
- **Test levels:** `test-levels-framework.md`
- **Priorities matrix:** `test-priorities-matrix.md`
- **Test quality DoD:** `test-quality.md` (no hard waits, <300 lines, <1.5 min, self-cleaning, explicit assertions)
- **NFR criteria:** `nfr-criteria.md`
- **Project rules:** `docs/project-context.md` — 82 named testing/security/performance rules
- **Architecture:** `_bmad-output/planning-artifacts/architecture.md`
- **PRD:** `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md`

---

**Generated by:** TEA (Murat)
**Workflow:** `bmad-testarch-test-design`
**Version:** BMad v6
