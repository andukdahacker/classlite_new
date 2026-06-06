---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
lastStep: 'step-05-generate-output'
nextStep: ''
lastSaved: '2026-06-04'
workflowType: 'testarch-test-design'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
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
