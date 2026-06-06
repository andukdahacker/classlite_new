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
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-03.md'
  - 'docs/project-context.md'
---

# Test Design for Architecture: ClassLite v2 (system-level)

**Purpose:** Architectural concerns, testability gaps, and NFR requirements that Architecture and Dev must resolve before QA can build the test suite. Acts as the contract between TEA/QA and Engineering for ClassLite v2.

**Date:** 2026-06-04
**Author:** Murat (TEA)
**Status:** Architecture Review Pending
**Project:** ClassLite v2
**PRD Reference:** `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md`
**Architecture Reference:** `_bmad-output/planning-artifacts/architecture.md`
**Companion (QA recipe):** `test-design-qa.md`
**Progress / raw working notes:** `test-design-progress.md`

---

## Executive Summary

**Scope:** Multi-tenant Vietnamese-market English-learning-center SaaS (IELTS focus). 10 epics, ~250 stories spanning auth, onboarding, classes, exercises, AI-assisted grading, submissions, people management, analytics, billing (Polar.sh), and notifications. 4 personas (Owner, Admin, Teacher, Student). Bilingual co-primary (en + vi). 3 deployable services (Astro landing, React 19 dashboard, Go API) sharing cookies on `.classlite.app`.

**Architecture (from architecture.md):**
- **Key Decision 1:** PostgreSQL row-level security (RLS) for tenant isolation with `SET LOCAL app.current_tenant_id` per request. Null-tenant guard returns zero rows.
- **Key Decision 2:** Stdlib `net/http` (Go 1.22+) — no third-party HTTP routers. Layered: Handler → Service → Store. Workers are peer entry points to handlers, not subordinate.
- **Key Decision 3:** OpenAPI as single source of truth; sqlc generates DB layer; openapi-typescript + openapi-zod-client generate frontend contracts. Generated code is read-only.
- **Key Decision 4:** AI work (Gemini) and email retries run through a Postgres-backed job queue (`SELECT … FOR UPDATE SKIP LOCKED`) — never inline in HTTP handlers.
- **Key Decision 5:** File uploads use direct browser → R2 via 15-minute presigned URLs; server enforces `{center_id}/{feature}/{uuid}.{ext}` key shape.

**Expected scale (UNKNOWN — see Blockers):** PRD/architecture do not state concurrent-user or tenant-count targets. Test design assumes "few hundred tenants, a few thousand concurrent users at launch" as a working assumption — must be confirmed before scalability NFR work begins.

**Risk Summary:**
- **Total risks:** 50 identified
- **BLOCK (score 9):** 2 — both cross-tenant data leakage variants (request and worker)
- **MITIGATE (score 6-8):** 25 — heavily weighted toward auth/RLS/money-flow
- **MONITOR (score 4-5):** 20
- **DOCUMENT (score 1-3):** 3
- **Test mass (scaffold + initial):** ~330–525 engineer-hours; 4–6 weeks if mass parallelized across feature teams via ATDD, 8–12 weeks if a single test engineer carries it.

---

## Quick Guide

### 🚨 BLOCKERS — Team Must Decide (cannot proceed without)

These items are pre-implementation critical path. QA cannot write the corresponding integration tests until they are resolved.

1. **A2 — Polar.sh webhook signature scheme.** Idempotency is mandated but signing scheme (HMAC algorithm, secret rotation, replay window) is unspecified. (Owner: Backend lead. Resolve before Epic 9 ATDD.)
2. **A6 — AI credit refund-on-failure policy.** If an AI grading job fails after a credit is deducted, is the credit refunded? Recommend refund with append-only `ai_credit_ledger`. (Owner: PM + Backend lead. Resolve before Epic 6 ATDD.)
3. **A8 — VND price points and VAT rate.** FR-61 still `[ASSUMPTION: TBD]`. Billing math is untestable until locked. (Owner: PM. Resolve before Epic 9 ATDD.)
4. **A9 — Per-file size limits per feature.** Plan-total caps are defined (500MB/5GB/50GB) but per-file caps are not. Required for upload error-path tests and to bound R2 cost. (Owner: PM + Backend. Resolve before Epic 4 ATDD.)
5. **A10 — R2 presigned URL one-time-use OR documented expiry-only policy.** Replay-attack surface; affects security E2E. (Owner: Backend lead + Security. Resolve before Epic 4 ATDD.)
6. **A7 — Worker tenant-context test harness.** Workers re-establish `SET LOCAL` per dequeue; without a harness exercising adversarial cross-tenant payloads, R3 (worst-case cross-tenant leak) is invisible to handler tests. (Owner: Backend lead. Resolve before Epic 4 ships.)
7. **Reliability SLO + scalability targets.** PRD/architecture mention uptime/availability without numbers. Test design cannot size load tests without targets. (Owner: PM + Eng leads. Resolve before launch.)

**What we need from team:** Decide on the 7 items above. Each is a single-decision block — none require code, only a written answer that QA can encode as a test.

---

### ⚠️ HIGH PRIORITY — Team Should Validate

These are TEA recommendations that need a yes/no/modify from the team. None block initial work but they shape the test infrastructure.

1. **R1, R3 mitigation: enforce TenantContext at compile time.** Recommend a custom golangci-lint analyzer that flags any `Store` method whose first non-ctx parameter is not `TenantContext` (project-context GO-1). Pairs with the worker harness (A7). (Owner: Backend lead.)
2. **R5 mitigation: refresh token rotation + reuse detection design.** Reuse → revoke all tokens in family. Recommend `family_id` column + concurrent-rotation test asserting only one wins. (Owner: Backend lead, Story 1.5.)
3. **R11 / R21 / R22 / R24 mitigation: time-travel state-machine test suite for plan grace period.** Recommend driving the entire 7-day flow via `MockClock` in a single test file; days 0/3/5/6/7 23:59 events asserted explicitly. (Owner: Backend lead, Epic 9.)
4. **R16 / R17 mitigation: enforce immutability at DB layer, not service layer.** Recommend a Postgres trigger on `submissions` rejecting `UPDATE` where `released_at IS NOT NULL`; same pattern on `enrollment_history` and the existing `audit_logs` (Story 1.3b already). (Owner: Backend lead.)
5. **R26 / R31 mitigation: query-count assertion harness.** Recommend a pgx instrumentation hook used in every service-layer test; asserts `≤ N` queries per call. Catches N+1 before merge. (Owner: Backend lead.)
6. **R38 mitigation: i18n parity CI step.** Recommend `pnpm run i18n-parity` that fails when `en.json` and `vi.json` keysets differ. (Owner: Frontend lead.)
7. **R46 mitigation: atomic-PR CI guard.** Recommend a CI step that fails if `api.yaml` changes are committed without matching `classlite-api/**` AND `classlite-web/**` paths in the same commit (project-context WF-4). (Owner: DevOps.)
8. **R49 mitigation: log-secret scanner in CI.** Recommend a step that scans test-run logs for known secret patterns (Gemini key prefix, Polar key prefix, bcrypt hash format) and fails the build. (Owner: DevOps + Security.)
9. **Cross-domain Playwright config (A3).** Recommend two Playwright projects — `landing` (`classlite.app`) and `dashboard` (`my.classlite.app`) — sharing storageState via a setup project that handles login once and persists `.classlite.app` cookies. (Owner: TEA + Frontend lead.)
10. **Real-iOS Safari speaking-recorder verification (A5).** Recommend BrowserStack or physical-device pre-launch sweep — Playwright WebKit is not enough. Mark Epic 5 release-gate accordingly. (Owner: TEA + Frontend lead.)

**What we need from team:** Review the 10 recommendations and reply with `approved / modify / reject` for each.

---

### 📋 INFO ONLY — Solutions Provided

These are TEA decisions that do not require team input.

- **Test level split:** Heavy backend integration (Go + real DB in transactions) for RLS/business rules, MSW-based component tests for FE, Playwright for E2E user journeys only. k6 for performance. vitest-axe for accessibility. Pact deliberately not used (OpenAPI spec-diff suffices given single backend + single frontend consumer).
- **Tooling:** Go `testing` + `testify` + `pgx` + custom `test.SetupDB(t)` harness (existing per Story 1.1); Vitest + Testing Library + MSW; Playwright with playwright-utils (per tea config); k6; vitest-axe; Lighthouse CI.
- **CI tiers:** PR (<15 min, all functional tests + smoke E2E + Lighthouse on changed routes); Nightly (full Playwright suite + k6 load baseline + bilingual sweep); Weekly (k6 stress + real Polar sandbox + real R2 + real iOS device sweep).
- **Coverage:** ~~600+ test scenarios planned. Cross-tenant adversarial grid (J15) = 312 backend integration tests generated from a fixture table. Critical-journey E2Es = ~75 across J1–J20.
- **Quality gates:** P0 = 100% pass; P1 = ≥95%; backend ≥80% line coverage; flaky ratio <2% rolling 30 days; zero OpenAPI drift 7 consecutive days pre-release.

**What we need from team:** Acknowledge.

---

## Risk Assessment

**Total risks identified:** 50 (2 score 9, 25 score 6-8, 20 score 4-5, 3 score 1-3).

### High-Priority Risks (Score ≥6) — IMMEDIATE ATTENTION

| Risk ID | Category | Description | P | I | Score | Mitigation | Owner | Timeline |
|---|---|---|---|---|---|---|---|---|
| **R1** | DATA/SEC | Cross-tenant data leakage via missing `TenantContext` on a Store method. RLS silently uses last-set tenant in pool. | 3 | 3 | **9** | golangci-lint custom analyzer + mandatory adversarial cross-tenant test per resource family (J15 grid). | Backend lead | Pre-Epic 2 |
| **R3** | DATA/SEC | Worker forgets `SET LOCAL` on dequeue — async cross-tenant leak. | 3 | 3 | **9** | Worker base class enforces tenant-context establishment (A7); adversarial test per job type. | Backend lead | Pre-Epic 4 |
| **R2** | DATA/SEC | RLS null-tenant guard regression (policies return all rows instead of zero). | 2 | 3 | 6 | Single-source RLS policy template; null-context adversarial test per table in CI. | Backend lead | Per-table |
| **R4** | SEC | JWT `center_id` spoofing across tenants. | 2 | 3 | 6 | Middleware re-validates claim against `center_members` row; negative test with forged JWT. | Backend lead | Story 1.5 |
| **R5** | SEC | Refresh token rotation race / reuse detection bypass. | 2 | 3 | 6 | Family-based revocation; concurrent-rotation test asserts only one wins. | Backend lead | Story 1.5 |
| **R6** | SEC | Google OAuth callback skips tenant binding. | 2 | 3 | 6 | Explicit tenant-binding assertion; cross-subdomain negative test. | Backend lead | Story 1.6 |
| **R7** | SEC | httpOnly cookie attributes weakened in dev and leak to prod. | 2 | 3 | 6 | Config-driven attributes; CI test asserts response headers in non-dev. | Backend lead | Story 1.5 |
| **R8** | SEC | CORS wildcard with credentials regression. | 2 | 3 | 6 | Allowlist enforced; CI test asserts no wildcard with credentials. | Backend lead | Story 1.2a (extension) |
| **R9** | SEC | R2 presigned URL replay / cross-tenant prefix guess. | 2 | 3 | 6 | Server enforces `{center_id}` prefix match; content-type lock; 5-min expiry (depends on A10). | Backend lead | Story 1.2e (extension) |
| **R11** | SEC | Polar webhook signature unverified (depends on A2). | 2 | 3 | 6 | Verification middleware; negative tests for missing/wrong/replay/tamper. | Backend lead | Epic 9 |
| **R13** | SEC | Rate-limit bypass on auth endpoints — credential stuffing. | 2 | 3 | 6 | Token bucket per `(IP, email)` for login; per-IP elsewhere. CI load test asserts 429. | Backend lead | Story 1.5 |
| **R15** | SEC | Service-layer trusts JWT role claim alone (SEC-1). | 2 | 3 | 6 | Mutating methods re-fetch role from DB; revoke-then-attempt test. | Backend lead | Epic 7 |
| **R16** | DATA | Submission immutability after release violated (NFR-6). | 2 | 3 | 6 | DB trigger rejects UPDATE where `released_at IS NOT NULL`; adversarial test. | Backend lead | Epic 6 |
| **R17** | DATA | Enrollment history mutability — audit trail broken. | 2 | 3 | 6 | Append-only RLS (mirrors Story 1.3b pattern). | Backend lead | Epic 7 |
| **R19** | DATA | Recurring session "Apply to..." scope leaks across scopes. | 3 | 2 | 6 | Scope-driven WHERE clause; per-scope integration tests; past/future boundary tests. | Backend lead | Epic 3 |
| **R21** | BUS | Plan grace state machine: wrong-day transitions or emails. | 2 | 3 | 6 | Full time-travel suite with MockClock (days 0/3/5/6/7). | Backend lead | Epic 9 |
| **R22** | BUS | Plan limit enforcement bypass via race condition. | 2 | 3 | 6 | Write-time service-layer pre-check; concurrent-test. | Backend lead | Epic 9 |
| **R23** | BUS | AI credit deducted but job failed → user loses credit (depends on A6). | 3 | 2 | 6 | Once A6 decided: ledger-based refund or in-tx deduction; ledger assertion. | Backend lead | Epic 6 |
| **R24** | BUS | Plan downgrade deletes data (NFR-6 says it must NOT). | 2 | 3 | 6 | Downgrade test asserts feature pause, NOT row deletion; restore test. | Backend lead | Epic 9 |
| **R26** | BUS | Search results leak across role boundaries. | 2 | 3 | 6 | Role-scoping enforced via RLS + service-layer filter; per-role tests. | Backend lead | Epic 8 |
| **R31** | PERF | N+1 query on teacher dashboard (multi-tenant amplifies). | 2 | 3 | 6 | EXPLAIN ANALYZE pre-merge; SQL aggregate-then-loop; query-count assertion. | Backend lead | Per-dashboard endpoint |
| **R38** | TECH | i18n key missing in `vi.json` — Vietnamese user sees raw key. | 3 | 2 | 6 | `i18n-parity` CI step + `assertI18nParity` helper used in every component test. | Frontend lead | Pre-Epic 1C ships |
| **R42** | TECH | Writing editor autosave loses data under flaky network. | 2 | 3 | 6 | Localstorage draft fallback + MSW network-failure E2E + conflict resolution. | Frontend lead | Epic 4 |
| **R46** | OPS | Deploy order: web ships before API for breaking change. | 2 | 3 | 6 | Atomic-PR CI guard. | DevOps | Pre-launch |
| **R48** | OPS | Railway DB outage → no failover (depends on uptime SLO). | 2 | 3 | 6 | Decide SLO; document RPO/RTO; plan replica if needed. | DevOps + Eng lead | Pre-launch |
| **R49** | OPS | `GEMINI_API_KEY` leaked in logs. | 2 | 3 | 6 | Log-secret filter + CI scanner. | DevOps + Backend lead | Pre-Epic 4 |
| **R50** | OPS | Migration rollback drops data unintentionally. | 2 | 3 | 6 | Data-preservation test: up → seed → down → up → assert data present. | Backend lead | Per-migration |

### Medium-Priority Risks (Score 4-5)

R10 (soft-deleted records leak), R12 (email injection), R14 (timing attack regression on resend), R18 (bulk CSV partial-success orphans), R20 (JSONB schema migration drops fields), R25 (Q&A "Shared" leaks to Admin), R27 (late-penalty math), R28 (anchored Q&A after edit), R29 (at-risk thresholds), R30 (Gemini timeout > handler deadline), R32 (search >500ms under load), R33 (polling thundering herd), R34 (page load >2s on 4G), R35 (constant-time 200ms regression), R36 (OpenAPI spec drift), R39 (Vite/Rolldown plugin), R40 (RR v7 + Suspense race), R43 (speaking upload mid-fail), R44 (email retry drops at max), R47 (Sentry quota).

### Low-Priority Risks (Score 1-3)

R37 (migration applied out of order), R41 (shadcn hand-edits), R45 (CF cache wrong origin). Action: monitor.

### Risk Category Legend

TECH = architecture/integration; SEC = security; PERF = performance/scalability; DATA = data integrity; BUS = business logic/revenue; OPS = deployment/operations.

---

## NFR Testability Requirements

| NFR Category | Threshold / Requirement | Current Design Support | Gap / Decision Needed | Planned Evidence |
|---|---|---|---|---|
| Security — Auth & RLS | bcrypt cost 12; access 15min / refresh 7d-30d; RLS null-guard zero rows; token bucket rate limits | Strong (Story 1.3 RLS suite + Story 1.4 sprint change) | None for shipped stories; R4–R8, R11, R13–R15 for upcoming | Go integration suite + Playwright auth E2E |
| Security — File upload | R2 key shape `{center_id}/{feature}/{uuid}.{ext}`; presigned 5–15min; MIME allowlist | Partial (Story 1.2e infra exists) | **A9 (per-file size), A10 (replay policy)** | Go handler integration + Playwright file E2E |
| Performance — Page load | <2s FCP on 4G | Not measured | None — measurable now | Lighthouse CI per route |
| Performance — Search | <500ms | Not measured | None — measurable now | k6 (50 VUs sustained, p95 <500ms) |
| Performance — Autosave | "no perceptible lag" | Implementation-defined | **Threshold UNKNOWN** | Decide ms target; defer until then |
| Performance — Constant-time 200ms | `/resend-verification` 200 floor | Implemented (Story 1.4) | None | Go integration timing test (lower-bound only) |
| Performance — AI polling backoff | 2s→4s→8s; 30s/60s warnings; 5min stuck | Architected, not built | None — measurable when built | Worker integration timing |
| Reliability — Retries | Email retry queue: 5 cases; Gemini 30/60/120s × 3 | Strong (Stories 1.2d, 4.3) | None | Worker integration + integration |
| Reliability — Uptime SLO | UNKNOWN | n/a | **Decide target (R48 blocked on this)** | Defer |
| Scalability — Tenant count / concurrent users / AI throughput | UNKNOWN | n/a | **Decide targets** | Defer k6 stress until then |
| Accessibility — WCAG 2.1 AA | Every interactive element; keyboard grading; Cmd+K combobox | Architecture-aware | None | vitest-axe + axe-cli E2E |
| Mobile — 48px / 44×44 touch targets, 390×844 reference | Spec'd | None | Playwright mobile project |
| i18n — en + vi co-primary, cookie shared `.classlite.app` | Spec'd | None | i18n parity CI + bilingual E2E sweep |
| Observability — `request_id` propagation, slog, Sentry breadcrumbs | Architected | Need `ErrorReporter` interface (T13) for test seam | RecordingErrorReporter assertion in handler tests |
| Data retention / PDPD compliance | UNKNOWN | n/a | **PRD Open Q #8 unresolved** | Defer |
| Malware scanning | "Required" (NFR-4) but provider unspecified | None | **Decide provider + integration point** | Defer until decided |

**Unknown thresholds:** autosave ms target, uptime SLO, scalability targets, data-retention period, malware-scan provider. All are **clarification items**, not guesses.

**Assessment boundary:** Final PASS/CONCERNS/FAIL belongs in `bmad-testarch-nfr` after implementation evidence exists.

---

## Testability Concerns and Architectural Gaps

### 🚨 ACTIONABLE CONCERNS

#### 1. Blockers to Fast Feedback

| Concern | Impact | What architecture must provide | Owner | Timeline |
|---|---|---|---|---|
| **Worker tenant-context harness missing (A7)** | R3 cross-tenant async leak invisible to handler tests; every worker-based test would otherwise need to re-implement the harness | `test.WorkerContext(t, db, tenantID, payload)` helper + adversarial template that runs per job type | Backend lead | Pre-Epic 4 ships |
| **Polar webhook signature scheme undecided (A2)** | Can't write negative tests (replay, tamper, wrong signature) — R11 unverifiable | A documented HMAC scheme + signing-secret rotation policy | Backend lead | Pre-Epic 9 ATDD |
| **Cross-subdomain Playwright config (A3)** | Login-then-redirect flows from `classlite.app` to `my.classlite.app` untestable per-test | Two Playwright projects with shared `storageState` and `.classlite.app` cookie persistence | TEA + Frontend lead | Pre-Epic 1C E2E |
| **Clock seam coverage (A4)** | Time-dependent tests (refresh, grace period, at-risk, recurring sessions) become flaky | `Clock` interface (already exists in `AuthService` per Story 1.4) propagated to BillingService, EnrollmentService, ScheduleService, AtRiskDetector | Backend lead | Pre-Epic 6 + 7 + 9 |
| **AI credit refund policy undecided (A6)** | Can't write the "credit refund on failure" test | Documented policy + ledger schema | PM + Backend lead | Pre-Epic 6 ATDD |
| **Per-file size limits undecided (A9)** | 413 error-path tests unwritable; cost surface unbounded | Per-feature caps (speaking audio, PDF, image) | PM + Backend lead | Pre-Epic 4 |
| **R2 presigned URL replay policy (A10)** | Replay tests unwritable | One-time-use table OR "expiry + content-type lock is sufficient" decision | Backend lead + Security | Pre-Epic 4 |
| **Real iOS Safari device verification (A5)** | Playwright WebKit ≠ mobile Safari; speaking recorder may pass CI but fail on real devices | Decision: BrowserStack subscription OR physical device sweep checklist | TEA + Frontend lead | Pre-launch |
| **VND price points + VAT rate (A8)** | Billing E2E can't assert invoice math | Locked prices + VAT % | PM | Pre-Epic 9 |
| **Reliability SLO + scalability targets** | k6 stress test unsized; R48 stays in MITIGATE indefinitely | Numeric targets (uptime, concurrent users, tenant count, AI jobs/min) | PM + Eng leads | Pre-launch |

#### 2. Architectural Improvements Needed

1. **Sentry abstraction for test seam (T13).** Wrap Sentry in an `ErrorReporter` interface; use `RecordingErrorReporter` in handler tests to assert "this error was reported with this `request_id`."
2. **EventBus inspection seam (T11).** `EventBus` is already an interface (Story 1.2f). Add `RecordingEventBus` + `BlockingEventBus` implementations for tests — assert publication and ordering invariants.
3. **MSW fault-injection helper standard (T14).** Provide `server.failOnce(method, path)` so every mutation has a "rollback works" component test pattern with one-line setup.
4. **Deterministic-tenant fixture (T16).** Central `test.NewDeterministicTenant(t, db, slug)` returning the same UUID for the same slug — fixes silent cross-test bleed.

### Testability Strengths (FYI)

- One mock seam per side (frontend MSW boundary + backend store-interface seam) already documented in project-context.
- Real DB in transactions with auto-rollback (`test.SetupDB(t)`) shipped in Story 1.1.
- `EmailSender`, `Storage`, `EventBus`, `Hasher`, `Clock` interfaces already exist or are being introduced.
- RLS adversarial test pattern established in Story 1.3 and 1.3b — extensible.
- OpenAPI as single source of truth → contract drift catchable via CI spec-diff.

### Accepted Trade-offs (No Action Required)

- **EDGE-2 (15-min role-change JWT window):** Documented product decision; tests will assert "old JWT still works for ≤15 min after role change" rather than "instant revocation."
- **Gemini real-call non-determinism:** Real integration smoke runs nightly with shape-only assertions; cannot be P0-deterministic.

---

## Risk Mitigation Plans (high-priority risks ≥6)

Detailed plans are kept in the working notes (`test-design-progress.md` § Risk Register). Each high-priority risk above has a mitigation, owner, timeline, and at least one planned test evidence link.

**Status of the 2 BLOCK risks (R1, R3):** both depend on (a) golangci-lint analyzer + (b) worker harness (A7) before they can be downgraded.

---

## Assumptions and Dependencies

### Assumptions

1. ClassLite v2 launches with a single Postgres on Railway (no read replica, no multi-region) — re-evaluate when R48 SLO is decided.
2. Polar.sh provides webhook signatures using a HMAC scheme similar to Stripe/Paddle conventions (pending A2).
3. The dev team has bandwidth to fold per-story tests into ATDD on every story; otherwise the 4–6 week timeline becomes 8–12 weeks.
4. Test environment uses real Postgres + mock Gemini + mock Polar + mock R2 + mock Resend (per project-context test architecture).
5. CI runners are large enough that parallel Go integration tests don't exhaust DB connections (need a pool-size cap on `test.SetupDB`).

### Dependencies

| Dependency | Required by |
|---|---|
| Resolution of all 10 BLOCKERs (A2, A3, A4, A5, A6, A7, A8, A9, A10, SLO) | Per-epic timelines listed above |
| Story 1.5 (login/refresh/reset/Google OAuth) ships | Auth E2Es (J3, J4, J5 prerequisites) |
| Story 1.6 (force-logout, invite acceptance) ships | J4, J16 |
| Epic 1C (frontend shell + landing) ships | Every Playwright E2E |
| Real Polar.sh sandbox credentials | Weekly Polar integration test |
| BrowserStack subscription OR physical-device sweep budget | Epic 5 release gate |

### Risks to the Plan Itself

- **If the team can't lock Polar webhook signature (A2) by Epic 9 start, billing tests slip 2–4 weeks.** Contingency: ship a `WebhookSignatureVerifier` interface with a placeholder allow-all impl gated by `ENV != prod` so test scaffolding can land; replace impl when scheme is decided.
- **If real iOS Safari verification (A5) is descoped, R7 stays MITIGATE and the speaking recorder ships with a "tested on Playwright WebKit, not real iOS" caveat.** Contingency: add a manual smoke checklist for the iOS team to run on real devices, gated to release.
- **If reliability SLO stays UNKNOWN, k6 stress testing is sized to a guess and the production capacity claim is unsupported.** Contingency: assume "100 concurrent users per tenant × 50 tenants" as a working baseline; document as an assumption and update post-launch.

---

**End of Architecture Document.**

**Next steps for Architecture Team:**
1. Decide the 7 BLOCKERS (A2, A6, A8, A9, A10, A7-design, SLO).
2. Review the 10 HIGH PRIORITY recommendations and reply `approved/modify/reject`.
3. Acknowledge INFO ONLY decisions.
4. Hand back to TEA so QA can begin test infrastructure scaffolding without rework.

**Next steps for QA Team:**
1. Review companion `test-design-qa.md` for full coverage matrix and execution recipe.
2. Begin Phase-0 infrastructure work (clock seam propagation, worker harness, cross-subdomain Playwright config, i18n parity CI step) in parallel with BLOCKER resolution.
3. Generate ATDD tests per Story 1.5 / 1.6 once those stories are picked up.
