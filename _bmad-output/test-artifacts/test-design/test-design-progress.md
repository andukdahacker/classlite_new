---
workflowStatus: 'completed'
totalSteps: 5
stepsCompleted: ['step-01-detect-mode', 'step-02-load-context', 'step-03-risk-and-testability', 'step-04-coverage-plan', 'step-05-generate-output']
lastStep: 'step-05-generate-output'
nextStep: ''
outputs:
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
lastSaved: '2026-06-04'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/epics.md'
  - '_bmad-output/planning-artifacts/epics/epic-01a-foundation.md'
  - '_bmad-output/planning-artifacts/epics/epic-01b-auth.md'
  - '_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md'
  - '_bmad-output/planning-artifacts/epics/epic-02.md'
  - '_bmad-output/planning-artifacts/epics/epic-03.md'
  - '_bmad-output/planning-artifacts/epics/epic-04.md'
  - '_bmad-output/planning-artifacts/epics/epic-05.md'
  - '_bmad-output/planning-artifacts/epics/epic-06.md'
  - '_bmad-output/planning-artifacts/epics/epic-07.md'
  - '_bmad-output/planning-artifacts/epics/epic-08.md'
  - '_bmad-output/planning-artifacts/epics/epic-09.md'
  - '_bmad-output/planning-artifacts/epics/epic-10.md'
  - '_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-03.md'
  - 'docs/project-context.md'
knowledgeFragments:
  - 'risk-governance.md'
  - 'probability-impact.md'
  - 'test-levels-framework.md'
  - 'test-priorities-matrix.md'
  - 'test-quality.md'
  - 'nfr-criteria.md'
stackDetection: 'fullstack (Go API + React 19 + Astro)'
teaConfig:
  tea_use_playwright_utils: true
  tea_use_pactjs_utils: false
  tea_pact_mcp: 'none'
  tea_browser_automation: 'auto'
---

# Test Design — System-Level — ClassLite v2

## Step 1: Mode Detection (complete)

**Mode:** System-Level
**Rationale:** Explicit user intent (`scope=system`); PRD + architecture + epics all present.
**Emphasis:** Thorough end-to-end test coverage per user request.

**Inputs identified:**
- PRD: `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md`
- Architecture: `_bmad-output/planning-artifacts/architecture.md`
- Epics index: `_bmad-output/planning-artifacts/epics.md` (+ per-epic files `epics/epic-*.md`)
- UX spec: `_bmad-output/planning-artifacts/ux-design-specification.md`
- Sprint change proposal: `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-03.md`
- Implementation artifacts (Stories 1.1–1.4 complete): `_bmad-output/implementation-artifacts/`
- Project context: `docs/project-context.md` (82 rules)

## Step 2: Context Loaded (complete)

- Tea config resolved (playwright utils on, pact off, browser-automation auto).
- Stack: **fullstack** — Go API (`classlite-api/`) + React 19 dashboard (`classlite-web/`) + Astro landing (`classlite-landing/`).
- Core knowledge fragments loaded: risk-governance, probability-impact, test-levels-framework, test-priorities-matrix, test-quality, nfr-criteria.
- Comprehensive intake brief produced (12 sections: product, epics, journeys, NFRs, integrations, authz matrix, async flows, file uploads, multi-tenancy hot spots, sprint change, gaps, shipped stories).

## Step 3: Testability Review & Risk Assessment (complete)

### 🚨 Testability Concerns (Actionable)

| # | Area | Concern | Impact on tests | Fix needed |
|---|---|---|---|---|
| T1 | **Worker tenant context** | Workers are peer entry points; each `ProcessTask` must `SET LOCAL app.current_tenant_id` from the job row. No worker harness exists yet that exercises this with adversarial fixtures. | Async cross-tenant leak is invisible to handler-level tests. | Build `test.WorkerContext(t, db, tenantID, payload)` fixture that mirrors `test.TenantContext` semantics. Add adversarial cross-tenant worker test template. |
| T2 | **Polar.sh webhook signature** | Architecture mandates idempotency but the signing/verification scheme is not specified. | Can't write replay / tamper / wrong-signature negative tests. | **Lock the signature scheme (HMAC-SHA256? Polar's standard? secret rotation?) before Epic 9 starts.** |
| T3 | **Cross-subdomain cookie auth in E2E** | Cookies on `.classlite.app` must be shared between Astro landing and React dashboard. Playwright defaults won't accept subdomain cookies across `playwright.config` projects unless deliberately wired. | Login-then-redirect flows (landing → dashboard) untestable without per-test cookie setup. | Configure Playwright with explicit `baseURLs` per project and a shared `storageState` strategy across `landing` and `dashboard` projects. |
| T4 | **Clock seam coverage** | Story 1.4 introduced a `clock` interface for verification expiry / rate-limit windows. Token expiry, refresh rotation, grace period (Epic 9), at-risk thresholds (Epic 7), recurring sessions (Epic 3) all depend on time. | Without a unified clock seam, time-dependent assertions become flaky (`time.Now()` drift). | Propagate `Clock` interface through `AuthService`, `BillingService`, `EnrollmentService`, `ScheduleService`, `AtRiskDetector`. Use `MockClock` in all time-sensitive tests. |
| T5 | **Constant-time 200ms floor** | `/resend-verification` must respond ≥200ms regardless of email existence. Tests asserting timing under CPU contention will be flaky. | False-positive flakiness in CI. | Run timing assertions with `t.Parallel()` disabled for these tests + assert lower-bound only (`>= 200ms`), never an upper bound. |
| T6 | **Gemini non-determinism** | Real Gemini calls return non-deterministic output. | Can't assert exact band scores or anchored-comment positions in real-integration E2E. | Two-layer strategy: (a) handler/service tests use `MockGeminiClient` with fixed outputs, deterministic; (b) one quarantined real-integration smoke per AI flow runs nightly with shape-only assertions. |
| T7 | **Mobile Safari audio capture** | Speaking pipeline depends on MediaRecorder API which has historical iOS Safari quirks. Playwright's WebKit isn't full mobile Safari. | E2E recorder tests pass in WebKit but fail on real iOS. | Add a manual checklist for real-device verification (iPhone Safari + Android Chrome) pre-launch. Don't claim "100% E2E coverage" for the recorder. |
| T8 | **AI credit refund-on-failure policy** | If `ai_grade_writing` job fails after the credit is deducted, is the credit refunded? Not specified anywhere. | Can't write the "credit refund" test until the policy is decided. | Decide before Epic 6 ships. Recommend refund-on-failure with append-only `ai_credit_ledger` entries. |
| T9 | **Per-file size limits** | Plan storage caps defined (500MB / 5GB / 50GB) but per-file caps not. | Can't assert MAX_FILE_SIZE error path. | Define per-feature per-file caps (e.g., speaking audio 25MB, PDF 50MB). |
| T10 | **VND price points + VAT rate** | FR-61 marked `[ASSUMPTION: TBD]`; VAT rate "e.g., 10%". | Billing E2E can't assert exact invoice math (currency formatting, VAT calc, prorated upgrades). | Lock prices and VAT rate before Epic 9 ATDD. |
| T11 | **Event bus test seam** | In-process synchronous EventBus (Story 1.2f). Handler failures in chain. | Hard to test isolation; one slow handler blocks the chain. | `EventBus` already an interface (per arch). Ensure tests can inject `RecordingEventBus` to assert publications without running handlers; `BlockingEventBus` to test ordering invariants. |
| T12 | **R2 presigned URL replay** | URL has 15-min expiry but no one-time-use guarantee. | Replay/cross-tenant attacks not testable without explicit policy. | Decide: server-side `single_use_tokens` table OR rely on expiry + content-type lock + key validation. Document and test. |
| T13 | **Sentry breadcrumb seam** | Architecture mandates `request_id` propagation. No abstraction noted. | Can't assert "this error was reported to Sentry with correlation id". | Wrap Sentry in `ErrorReporter` interface; use `RecordingErrorReporter` in tests. |
| T14 | **Optimistic update rollback path (FW-2)** | Triple-callback pattern is intricate; E2E can't easily simulate mid-mutation failure. | The rollback path is rarely tested in practice. | Standardize MSW fault-injection helper (`server.failOnce('PATCH', '/api/courses/:id')`) so every mutation has a "rollback works" component test. |
| T15 | **i18n key existence guardrail** | TEST-FE-4 requires `i18n.exists(key)` for both `en` and `vi`. No fixture wires this yet. | Vietnamese users will see raw keys when devs forget `vi.json`. | Build `assertI18nParity(keys, ['en','vi'])` helper used across every component test. |
| T16 | **Test fixture: deterministic tenant IDs** | TEST-BE-1 requires UUIDs like `…-000000000001`. No central fixture. | Cross-test bleed; non-readable failures. | Central `test.NewDeterministicTenant(t, db, slug)` helper that returns the same UUID for the same slug. |

### ✅ Testability Strengths (Already Sound)

- **One mock seam per side** (TEST-FE-1, TEST-BE-2 to TEST-BE-4) — clear, documented, enforced in project-context.
- **Real DB in transactions with auto-rollback** (TEST-BE-2) — `test.SetupDB(t)` pattern minimizes test pollution.
- **EmailSender abstraction with MockEmailSender** (Story 1.2d) — email tests are deterministic.
- **Storage abstraction with mock** (Story 1.2e) — presigned URL flow is testable end-to-end without R2.
- **EventBus interface** (Story 1.2f) — domain events have a designed test seam.
- **`Hasher` + `MockHasher`** (Story 1.4 sprint change H2) — bcrypt cost-12 stays out of unit tests.
- **`Clock` interface introduced** (Story 1.4) — needs propagation but the pattern exists.
- **Auth + general audit logs append-only at DB layer** (Story 1.3b RLS INSERT-only policy) — testable invariant.
- **RLS adversarial test suite** (Story 1.3) — establishes the cross-tenant test pattern that all later epics inherit.
- **OpenAPI as single source of truth** (XL-1) — Zod schemas + TS types + Go types all derived. Contract correctness assertable via spec-diff in CI.
- **Three-tier component placement** (FW-7) — clean test surface (component tests vs feature E2E).

### Architecturally Significant Requirements (ASRs)

**ACTIONABLE (block downstream work):**

| ASR | Description | Blocks |
|---|---|---|
| **A1** | RLS null-tenant guard adversarial suite runs in CI on every PR (not just Story 1.3 acceptance). | Every epic that adds new tables. |
| **A2** | Polar.sh webhook signature verification scheme (T2). | Epic 9 ATDD. |
| **A3** | Cross-subdomain cookie auth Playwright config (T3). | Epic 1C E2E. |
| **A4** | Clock seam propagated through every time-dependent service (T4). | Epics 1B (refresh), 6 (AI timeouts), 7 (at-risk), 9 (grace). |
| **A5** | Real iOS Safari verification of speaking recorder (T7). | Epic 5 release sign-off. |
| **A6** | AI credit refund-on-failure policy (T8). | Epic 6 ATDD. |
| **A7** | Worker tenant-context test harness (T1). | Epics 4 (AI generation), 6 (AI grading), any worker-based flow. |
| **A8** | VND prices + VAT rate locked (T10). | Epic 9 ATDD. |
| **A9** | Per-file size limits per feature (T9). | Epics 4, 5, 9. |
| **A10** | R2 presigned URL one-time-use OR documented expiry-only policy (T12). | Epic 4, 5 security review. |

**FYI (don't block but inform tests):**

| ASR | Description |
|---|---|
| F1 | Vietnamese strings ~25% longer than English; visual layout regression needs awareness. |
| F2 | Cloudflare `Vary: Origin` header mandatory (already in arch SEC-5). |
| F3 | 15-min role-change JWT window documented as accepted UX trade-off (EDGE-2). |
| F4 | Email retry queue test cases enumerated in Story 1.2d. |
| F5 | Knowledge Hub MIME allowlist already defined (PDF/PNG/JPG/SVG/MP3/WAV/WebM). |
| F6 | At-risk thresholds locked: <70% attendance, ≥2 consecutive misses, band drop ≥1.0 over last 4. |

---

### Risk Register

**Scoring:** Probability (1=Unlikely, 2=Possible, 3=Likely) × Impact (1=Minor, 2=Degraded, 3=Critical). Score 9 → BLOCK; 6-8 → MITIGATE; 4-5 → MONITOR; 1-3 → DOCUMENT.

**Categories:** TECH (technical), SEC (security), PERF (performance), DATA (data integrity), BUS (business logic), OPS (operational).

#### 🔴 BLOCK (Score 9 — must mitigate before release)

| ID | Cat | Risk | P | I | Score | Mitigation | Owner |
|----|----|------|---|---|-------|------------|-------|
| **R1** | DATA / SEC | Cross-tenant data leakage via missing `TenantContext` on a Store method (GO-1). Compiles clean, RLS silently uses last-set tenant in pool. **Highest-severity trap in the stack.** | 3 | 3 | **9** | Service layer interface assertion (every Store method's first non-ctx param MUST be `TenantContext`); golangci-lint custom analyzer to flag missing `TenantContext`; mandatory adversarial cross-tenant test per resource family. | Backend lead |
| **R3** | DATA / SEC | Worker forgets `SET LOCAL app.current_tenant_id` on dequeue → async cross-tenant leak (SEC-6). | 3 | 3 | **9** | Worker base class enforces tenant context establishment (ASR A7); cross-tenant adversarial test runs in worker test suite for every job type. | Backend lead |

#### 🟠 MITIGATE (Score 6-8 — high risk, must have mitigation plan before merge)

| ID | Cat | Risk | P | I | Score | Mitigation |
|----|----|------|---|---|-------|------------|
| **R2** | DATA/SEC | RLS null-tenant guard regression: policies return all rows instead of zero rows when `app.current_tenant_id` is unset. | 2 | 3 | 6 | Single-source RLS policy template enforces `current_setting(...,true) IS NOT NULL`. Adversarial null-context test per table runs in CI. |
| **R4** | SEC | JWT `center_id` spoofing: forged JWT with another center's id passes RLS. | 2 | 3 | 6 | Middleware re-validates `center_id` claim against signed JWT + checks `center_members` row exists with matching `(user_id, center_id, status='active')`. Negative test: craft JWT with valid signature but wrong center_id. |
| **R5** | SEC | Refresh token rotation race / reuse-detection bypass — token theft undetectable. | 2 | 3 | 6 | Reuse-detection: if old refresh token not found on `/auth/refresh`, revoke ALL tokens for `user_id`. Concurrent-rotation test (two parallel refresh calls) asserts only one wins. |
| **R6** | SEC | Google OAuth callback skips tenant binding — user from tenant-A logs in at tenant-B subdomain. | 2 | 3 | 6 | Explicit tenant-binding assertion in callback handler. E2E negative test: complete OAuth on `centerA.classlite.app`, then attempt callback on `centerB.classlite.app` → must reject. |
| **R7** | SEC | httpOnly cookie attributes weakened during local dev and forgotten in prod (SameSite, Secure, Domain). | 2 | 3 | 6 | Cookie attributes set from config; CI test asserts response `Set-Cookie` header contains all 4 attributes in non-dev env. |
| **R8** | SEC | CORS wildcard with credentials regression (SEC-5). | 2 | 3 | 6 | Allowlist enforced in CORS middleware; CI test asserts no `Access-Control-Allow-Origin: *` with credentials in any environment. |
| **R9** | SEC | R2 presigned URL replay / cross-tenant prefix guess (depends on A10). | 2 | 3 | 6 | Server enforces `{center_id}` prefix matches JWT `center_id`; presigned request locks `Content-Type`; 5-min expiry. Adversarial test: forge presigned URL for wrong tenant. |
| **R11** | SEC | Polar webhook signature unverified → payment state machine spoofable (depends on A2). | 2 | 3 | 6 | Signature verification middleware; negative tests for missing sig, wrong sig, replay, body tamper. |
| **R13** | SEC | Rate-limit bypass on auth endpoints — credential stuffing. | 2 | 3 | 6 | Token bucket per `(IP, email)` for login; per-IP for register/resend. CI load test asserts 429 at threshold. |
| **R15** | SEC | Service-layer trusts JWT role claim alone (SEC-1) — revoked teacher whose JWT hasn't expired can still mutate. | 2 | 3 | 6 | Mutating service methods re-fetch user role from DB; only read paths trust JWT. Negative test: revoke teacher in DB, attempt mutation with old JWT. |
| **R16** | DATA | Submission immutability after release violated (NFR-6). | 2 | 3 | 6 | Trigger or service-layer check rejects `UPDATE` on `submissions` where `released_at IS NOT NULL`. Adversarial test from teacher and student. |
| **R17** | DATA | Enrollment history mutability — audit trail broken (Story 7.3). | 2 | 3 | 6 | `enrollment_history` table append-only RLS (mirroring audit_logs pattern from Story 1.3b). |
| **R19** | DATA | Recurring session "Apply to..." scope (`this only` / `this and future` / `all`) leaks across scopes. | 3 | 2 | 6 | Service method's scope param drives WHERE-clause shape; integration tests for all 3 scopes × all editable fields × past/future boundaries. |
| **R21** | BUS | Plan grace-period state machine: late retries / wrong-day transitions / wrong-day emails. | 2 | 3 | 6 | Time-travel test suite with `MockClock`: day 0 (failure), day 3 (retry+email), day 5 (retry+email), day 6 (warning), day 7 23:59 (auto-downgrade). |
| **R22** | BUS | Plan limit enforcement bypass — 11th student added during downgrade race condition. | 2 | 3 | 6 | Enforcement at write time via service-layer pre-check, NOT post-hoc cleanup. Race-condition concurrent test. |
| **R23** | BUS | AI credit deducted but job failed → user loses credit (depends on A6). | 3 | 2 | 6 | Once policy decided: credit-deduction in same tx as job completion OR refund-on-failure with append-only ledger. Test asserts credit ledger reflects refund. |
| **R24** | BUS | Plan downgrade deletes data (NFR-6 says it must NOT). | 2 | 3 | 6 | Downgrade test asserts: AI grading paused, 2nd teacher locked, classes >5 students read-only, **no row deletions**. Re-upgrade test asserts full restore. |
| **R26** | BUS | Search results leak across role boundaries (teacher sees other teacher's classes). | 2 | 3 | 6 | `/api/search` enforces role-scoping via RLS + service-layer scope filter; tests for each role + cross-role attack. |
| **R31** | PERF | N+1 query on teacher dashboard (PERF-2) — multi-tenant amplifies. | 2 | 3 | 6 | Every dashboard endpoint profiled with `EXPLAIN ANALYZE` pre-merge; SQL aggregate-then-loop. Integration test asserts query count ≤ N. |
| **R38** | TECH | i18n key missing in `vi.json` — Vietnamese user sees raw key. | 3 | 2 | 6 | `assertI18nParity` helper (T15) used in every component test; CI step runs `i18n-keys-diff` between en.json and vi.json. |
| **R42** | TECH | Writing editor autosave loses data under flaky network. | 2 | 3 | 6 | Localstorage draft fallback; "saving / saved / error" indicator tested under MSW network failure injection. Conflict resolution on reconnect. |
| **R46** | OPS | Deploy order: web ships before API for a breaking change. | 2 | 3 | 6 | Atomic PR mandate (WF-4) enforced via CI guard: any change to `api.yaml` requires `classlite-api/**` AND `classlite-web/**` paths in the same commit. |
| **R48** | OPS | Railway DB outage → no failover (depends on uptime SLO definition). | 2 | 3 | 6 | Decide SLO; document RPO/RTO; if SLO requires HA, plan Railway replica or migrate. Health-check endpoint covers DB. |
| **R49** | OPS | `GEMINI_API_KEY` leaked in logs (EDGE-4). | 2 | 3 | 6 | Structured-log secret filter; lint rule on slog calls; CI test scans logs for known secret pattern. |
| **R50** | OPS | Migration rollback (`down.sql`) drops data unintentionally. | 2 | 3 | 6 | Down migrations reviewed; data-preservation test: run up → seed → down → up → assert data still present. |

#### 🟡 MONITOR (Score 4-5 — watch closely)

| ID | Cat | Risk | P | I | Score |
|----|----|------|---|---|-------|
| R10 | SEC | Soft-deleted records leak across tenants (SEC-9). | 2 | 2 | 4 |
| R12 | SEC | Email injection in Resend templates. | 2 | 2 | 4 |
| R14 | SEC | Timing attack on `/resend-verification` (200ms floor regresses under CPU contention). | 2 | 2 | 4 |
| R18 | DATA | Bulk CSV import partial-success leaves orphaned users. | 2 | 2 | 4 |
| R20 | DATA | JSONB schema migration silently drops fields. | 2 | 2 | 4 |
| R25 | BUS | Q&A "Shared" leaks to Admin/Owner. | 2 | 2 | 4 |
| R27 | BUS | Late-submission penalty math wrong. | 2 | 2 | 4 |
| R28 | BUS | Anchored Q&A targets wrong section after exercise edit. | 2 | 2 | 4 |
| R29 | BUS | At-risk detection thresholds miscomputed. | 2 | 2 | 4 |
| R30 | PERF | Gemini API timeout exceeds HTTP handler deadline. | 2 | 2 | 4 |
| R32 | PERF | Search > 500ms under concurrent load. | 2 | 2 | 4 |
| R33 | PERF | Polling cadence drift (inbox 30-60s) causes thundering herd. | 2 | 2 | 4 |
| R34 | PERF | Page load > 2s on 4G. | 2 | 2 | 4 |
| R35 | PERF | Constant-time 200ms floor regression. | 2 | 2 | 4 |
| R36 | TECH | OpenAPI spec drift between Go server and TS client. | 2 | 2 | 4 |
| R39 | TECH | Vite/Rolldown plugin incompatibility. | 2 | 2 | 4 |
| R40 | TECH | React Router v7 + Suspense + TanStack Query race. | 2 | 2 | 4 |
| R43 | TECH | Speaking audio upload fails mid-recording. | 2 | 2 | 4 |
| R44 | TECH | Email retry queue drops at max retries. | 2 | 2 | 4 |
| R47 | OPS | Sentry quota exhausted. | 2 | 2 | 4 |

#### 🟢 DOCUMENT (Score 1-3 — awareness only)

R37 (migration applied out of order, P=1), R41 (shadcn hand-edits, P=1), R45 (Cloudflare cache wrong origin, P=1).

### Risk Summary

- **2 BLOCK** risks (R1, R3) — both cross-tenant data leakage via RLS bypass. These define the highest-priority test mass: cross-tenant adversarial coverage everywhere.
- **25 MITIGATE** risks — 12 SEC, 5 DATA, 6 BUS, 1 PERF, 1 TECH, 4 OPS. Each needs a documented mitigation + named owner + at least one test.
- **20 MONITOR** risks — track via CI metrics; convert to MITIGATE if production telemetry shows escalation.
- **3 DOCUMENT** risks — awareness-only.

Critical pattern: **17 of the 27 highest risks (R1–R26) center on multi-tenant correctness, authorization, and money-flow integrity.** Test mass should be allocated accordingly.

### NFR Planning

| NFR Category | Threshold (from PRD/arch) | Evidence Source | Risk Refs |
|---|---|---|---|
| **Security — Auth** | bcrypt cost 12; access TTL 15min; refresh 7d/30d; lockout 5 fails / 10min → 15min; rate limit token bucket; OAuth nonce 10min; invite 7d; reset 1h | Go integration tests + Playwright E2E + k6 burst tests | R4–R15 |
| **Security — RLS** | Null-tenant guard returns 0 rows; cross-tenant write/read isolation | Go adversarial integration suite (per Story 1.3 pattern) | R1, R2, R3, R26 |
| **Security — Cookies** | `Domain=.classlite.app`, SameSite=Lax (PRD) / Strict (project-context — clarify), Secure, HttpOnly | Integration test asserting response headers | R7 |
| **Security — CORS** | Explicit allowlist, `Vary: Origin` mandatory | Integration test | R8, R45 |
| **Security — File upload** | R2 key `{center_id}/{feature}/{uuid}.{ext}`; presigned 5–15min; Content-Type lock; MIME allowlist | Go integration + Playwright fileupload test | R9 |
| **Security — Audit** | Append-only enforced at DB layer | RLS adversarial test (Story 1.3b pattern) | R16, R17 |
| **Security — Secrets** | Never in logs/responses/health | slog filter test + log-scan CI step | R49 |
| **Performance — Page load** | <2s FCP on 4G | Playwright + Lighthouse CI; k6 not needed here | R34 |
| **Performance — Grading view** | <3s | Playwright + APM | R34 |
| **Performance — Search** | <500ms | k6 load + Playwright timing | R32 |
| **Performance — Autosave** | "No perceptible lag" — **UNKNOWN threshold (T4 / gap #4)** | Defer until threshold defined | T4 |
| **Performance — AI polling** | 2s→4s→8s; 30s warning; 60s slow; 5min timeout (gen) | Playwright + integration | R30 |
| **Performance — Constant-time 200ms** | `/resend-verification` 200 floor | Go integration timing test (lower-bound only) | R14, R35 |
| **Reliability — Health** | `/api/health` returns 200 with DB status | Integration test (already in Story 1.2b) | — |
| **Reliability — Retries** | Email retry queue: 5 explicit test cases (Story 1.2d) | Integration test | R44 |
| **Reliability — Gemini retries** | 30s/60s/120s exp backoff, max 3 | Worker integration test with MockGeminiClient | R30 |
| **Reliability — Uptime SLO** | **UNKNOWN — gap #1** | Defer; add as risk R48 (already in register) | R48 |
| **Reliability — Recovery** | Submission state machine: pending → processing → complete/failed | Integration test | R30 |
| **Scalability — Tenant count** | **UNKNOWN — gap #2** | Defer until target defined | — (capture as gap) |
| **Scalability — Concurrent users** | **UNKNOWN — gap #2** | Defer | — |
| **Scalability — AI throughput** | **UNKNOWN — gap #2** | Defer | — |
| **Accessibility — WCAG 2.1 AA** | All interactive elements; keyboard nav for grading; Cmd+K combobox semantics | vitest-axe component tests + Playwright keyboard E2E | R38 (i18n only — accessibility tests are separate) |
| **Mobile — Touch targets** | 48px on auth, 44×44px elsewhere | Playwright mobile viewport + accessibility test | — |
| **i18n — Bilingual** | en + vi co-primary; runtime switch; locale-aware dates | Component test runs both locales; CI step diffs key sets | R38 |
| **Browser support** | Latest 2 versions Chrome/Firefox/Safari/Edge | Playwright projects per browser | — |
| **Observability** | `request_id` propagated; structured slog; Sentry breadcrumbs | RecordingErrorReporter (T13) | R47 |
| **PDPD / Data retention** | **UNKNOWN — gap #10** | Defer | — |
| **Per-file size limits** | **UNKNOWN — gap #5 / T9** | Defer | T9 |
| **Malware scanning** | Required, no provider | **UNKNOWN — gap #6** | Defer | — |

**NFR planning conclusion:** Security NFRs are well-defined and testable now. Performance NFRs are mostly quantified except autosave. Scalability NFRs are entirely UNKNOWN and must be defined before launch. Reliability is split: per-flow retries defined, system-wide SLO undefined.

## Step 4: Coverage Plan & Execution Strategy (complete)

### Test Level Strategy

ClassLite v2 is a multi-tenant SaaS with high authorization complexity, money flow, and AI integrations. The user explicitly requested **very thorough E2E coverage**. The plan honors that but follows test-level discipline (project-context "Test Architecture — Mock Boundaries" + `test-levels-framework.md`):

| Level | Tool | Purpose | Mock seam |
|---|---|---|---|
| **Unit (Go)** | `go test` | Pure business logic, calculators, validators, JSONB schema migration, AT-risk thresholds, late penalty math, band-score parsers. | None — pure functions. |
| **Integration — Store (Go)** | `go test` + real Postgres (transaction-wrapped, auto-rollback) | All sqlc-generated queries; RLS cross-tenant adversarial tests; audit append-only invariants. | **Never mock pgx**; `test.SetupDB(t)`. |
| **Integration — Service (Go)** | `go test` | Business rules, multi-step orchestration, error type production, authorization checks, time-dependent transitions. | Mock the Store interface (the one backend seam). |
| **Integration — Worker (Go)** | `go test` | Job handlers tested via `ProcessTask` directly. Worker tenant-context re-establishment (ASR A7). | Mock GeminiClient + Store; real DB. |
| **Integration — Handler (Go)** | `go test` + `httptest.NewRecorder` | HTTP binding, middleware chain, request_id propagation, envelope shape, error→status mapping, cookie attributes. | Real middleware + service + store + DB. |
| **Component (FE)** | Vitest + Testing Library + MSW | Loading / success / error trilogy; i18n parity; Zustand reset; optimistic-update rollback; role-gated rendering; accessibility (axe). | MSW at HTTP boundary (the one FE seam). |
| **E2E (Browser)** | Playwright (chromium, webkit, firefox, mobile-chrome, mobile-safari) | Critical user journeys; cross-domain auth; bilingual flows; mobile flows; long-running multi-role scenarios. | Real backend in a dedicated test env; only Gemini + Polar + Resend mocked. |
| **E2E API (Headless)** | Playwright `apiRequest` fixture | Pure-API journeys (worker fanout, cross-tenant attacks, webhook idempotency); fast and parallel. | Same as E2E browser env. |
| **Contract** | Pact NOT used (per tea config). OpenAPI diff CI replaces contract testing for now. | Catch FE↔BE drift. | spec-diff CI step. |
| **Performance** | k6 | SLO/SLA enforcement; rate-limit verification; dashboard N+1 detection under load. | Runs against test env. |
| **Accessibility** | vitest-axe (component) + Playwright + axe-core CLI (E2E) | WCAG 2.1 AA on every public route. | n/a |
| **Visual regression** | Playwright `toHaveScreenshot` (selective, English + Vietnamese on critical screens) | Bilingual layout overflow guardrails. | n/a |

**Duplicate coverage guard:**
- Business rules → service-layer integration test (not E2E).
- RLS isolation → store-layer adversarial test (not handler).
- Form validation → component test (not E2E).
- E2E exclusively tests user journeys, navigation, integration-between-services, real cookies, real subdomains.

---

### Coverage Matrix — E2E Critical User Journeys

**Format:** Each row is one E2E test file. ID format `EPIC.STORY-LEVEL-SEQ`. E2E tests live in `tests/e2e/journeys/`.

> **Notation:** ★ = test in BOTH locales (en + vi). 📱 = run on mobile-chrome AND mobile-safari projects in addition to desktop. 🔁 = idempotency or replay variant required.

#### J1 — Founder onboarding to first invite accepted

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J1-001 ★ | Owner signup → email verify → owner-persona onboarding → center created → first class spawned → dashboard rendered | Owner | desktop, 📱 | **P0** | R1, R4, R7 |
| E2E-J1-002 | Resend verification email — happy path with 60s rate-limit window proven via 2nd resend rejected | Owner | desktop | P0 | R13, R14 |
| E2E-J1-003 | Verify with expired token → user shown "Resend" UX → resend → verify succeeds | Owner | desktop | P0 | R14 |
| E2E-J1-004 ★ | Owner invites Teacher (email-only flow) → email arrives in mock inbox → Teacher clicks invite, creates account, lands on Teacher dashboard scoped to that center | Owner→Teacher | desktop | P0 | R1, R4, R6 |
| E2E-J1-005 | Invite token replay: Teacher uses invite, then second click → 410 Gone | Teacher | desktop | P0 | R5 (token reuse) |
| E2E-J1-006 | Invite to Teacher who already has an account at a DIFFERENT center → link account → Teacher now sees BOTH centers in center-switcher with correct role per center | Teacher | desktop | P0 | R1, R4 |
| E2E-J1-007 | Cross-tenant: Teacher invited to Center B clicks invite while logged in as Owner of Center A — must NOT auto-link without explicit confirm; verify zero data leak across the two centers | Owner+Teacher | desktop | P0 | R1, R6 |

#### J2 — Solo Teacher single-class path

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J2-001 ★ | Teacher signup → teacher-persona onboarding (1 class auto-created) → adds student via email → student receives invite → student logs in → sees enrolled class | Teacher, Student | desktop, 📱 | **P0** | R1, R6 |
| E2E-J2-002 | Teacher adds student whose email already exists at another center → existing user linked → student sees both centers | Teacher, Student | desktop | P1 | R1 |

#### J3 — Google OAuth flows

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J3-001 | New user signs up via Google OAuth → onboarding → dashboard | Owner | desktop | P0 | R6, R7 |
| E2E-J3-002 | Existing email/password account links Google OAuth → account merged → future Google login lands on dashboard | Any | desktop | P0 | R6 |
| E2E-J3-003 ★ | OAuth state nonce expired (>10 min) → 403 + redirect with `?error=csrf_invalid` → user can retry from login | Any | desktop | P0 | R6 |
| E2E-J3-004 | `access_denied` returned from Google → `?error=google_access_denied` → friendly retry CTA | Any | desktop | P1 | R6 |
| E2E-J3-005 | OAuth callback at `centerB.classlite.app` with token bound to `centerA` → reject with audit log entry (R6 mitigation) | Attacker | desktop | **P0** | R6 |

#### J4 — Staff invite acceptance & role enforcement

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J4-001 ★ | Owner invites Admin → Admin accepts → sidebar reflects Admin scope (no Billing, no Center Settings) | Owner→Admin | desktop, 📱 | P0 | R15, R26 |
| E2E-J4-002 | Admin attempts deep-link to `/billing` → 403 page (NOT silent redirect, NOT exposing data) | Admin | desktop | **P0** | R15 |
| E2E-J4-003 | Owner toggles "Admins can see teacher analytics" permission OFF → Admin's analytics view loses teacher-perf widget | Owner, Admin | desktop | P1 | R15 |

#### J5 — Authoring → assigning → grading (CRITICAL — PRD UJ-2)

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J5-001 ★ 📱 | Teacher authors Writing exercise → AI section generation (mock Gemini, deterministic) → preview reflects generated content → publishes | Teacher | desktop, 📱 | **P0** | R23 |
| E2E-J5-002 | Teacher assigns exercise to class with due date → student inbox shows assignment notification | Teacher, Student | desktop | P0 | R26 |
| E2E-J5-003 ★ | Student submits Writing late → late penalty applied per FR-X math → submission marked late | Student | desktop, 📱 | P0 | R27 |
| E2E-J5-004 ★ | AI grading job runs (mock Gemini deterministic) → grading view shows AI bands + anchored comments → teacher edits one band → releases → student inbox shows released grade | Teacher, Student | desktop | **P0** | R16, R23, R30 |
| E2E-J5-005 | AI grading job FAILS (Gemini returns invalid output) → submission shows "AI grading unavailable, please grade manually" → teacher grades manually → releases | Teacher, Student | desktop | P0 | R23, R30 |
| E2E-J5-006 | After release: student attempts to edit submission via API → 403 (R16: immutability) | Student | desktop | **P0** | R16 |
| E2E-J5-007 | After release: teacher attempts to update score → 422 with "Use revise & re-release" message; revise → release v2 → audit log records both | Teacher | desktop | P0 | R16, R17 |

#### J6 — Reading quiz with timer + autosave (CRITICAL)

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J6-001 ★ 📱 | Student opens timed reading quiz → answers question 1 → autosave fires → MSW simulates network failure → answer 2 → reconnect → all answers preserved on reload | Student | desktop, 📱 | **P0** | R42 |
| E2E-J6-002 | Timer reaches 0 → auto-submit → auto-grade returns score with spelling variants flagged for teacher review (not auto-rejected) | Student | desktop | P0 | R27, R44 |
| E2E-J6-003 | Teacher reviews flagged spelling variant → accepts/rejects → final grade updated | Teacher | desktop | P1 | R27 |
| E2E-J6-004 ★ | Student opens quiz in two browser tabs → submits in tab 1 → tab 2 detects via `BroadcastChannel` and shows "Submitted in another session" | Student | desktop | P1 | R42 |

#### J7 — Speaking pipeline (HIGH RISK — mobile critical)

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J7-001 ★ 📱 | Student records speaking response → re-records (older take discarded) → upload to mock R2 → submission marked submitted | Student | 📱 mobile-safari + mobile-chrome PRIMARY, desktop secondary | **P0** | R9, R42, R43 |
| E2E-J7-002 | Student records → upload fails mid-stream → retry up to 3 times → permanent failure → local fallback message + saved-locally indicator | Student | 📱 | P0 | R43 |
| E2E-J7-003 | AI transcription fails but band proposals attempted → grading view shows partial (transcript "unavailable", bands present) → teacher grades anyway | Teacher | desktop | P0 | R30 |
| E2E-J7-004 | Teacher pins timestamp comment on audio → student sees comment at exact timestamp after release | Teacher, Student | desktop | P1 | R28 |
| E2E-J7-005 | Speaking submission file > per-feature cap → 413 with clear UX (depends on T9/A9) | Student | desktop | P1 | T9 |

#### J8 — Q&A visibility scope

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J8-001 | Student highlights passage → asks question → only assigned teacher and student see thread → Owner/Admin see NOTHING in their Q&A panel (R25 negative test) | Student, Teacher, Owner, Admin | desktop | **P0** | R25, R26 |
| E2E-J8-002 ★ | Teacher answers "Shared" visibility → ALL students enrolled in that class see thread; students in OTHER classes don't | Teacher, Students | desktop | P0 | R25, R26 |
| E2E-J8-003 | Question resolved → reply lands in student inbox | Student | desktop | P1 | R26 |

#### J9 — At-risk student detection & sharing (PRD UJ-4)

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J9-001 ★ | Seed student with attendance 65% → at-risk indicator appears on dashboard, on student detail, on class roster | Owner | desktop, 📱 | P0 | R29 |
| E2E-J9-002 | Student crosses threshold mid-session (attendance dips during E2E run) → at-risk badge appears within polling cadence | Owner | desktop | P1 | R29 |
| E2E-J9-003 ★ | Owner generates "Share summary" → Zalo-ready text + PDF download → both contain only authorized fields (no other students' data) | Owner | desktop | P0 | R26, R29 |

#### J10 — Plan upgrade Free → Pro

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J10-001 ★ | Owner on Free hits 5-student class limit → upgrade CTA → Polar checkout mock returns success → webhook delivered → plan upgraded → can add 11th student → AI credits available | Owner | desktop, 📱 | **P0** | R11, R22, R24 |
| E2E-J10-002 🔁 | Polar webhook delivered twice for same upgrade → only one subscription state change applied (idempotency) | n/a (webhook) | api-only | **P0** | R11 |
| E2E-J10-003 | Owner upgrades mid-month → invoice shows prorated amount, correct VND + VAT (depends on T10/A8) | Owner | desktop | P0 | T10 |

#### J11 — Payment failure & grace period

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J11-001 ★ | Polar `payment_failed` webhook delivered → grace state machine starts → top strip "Payment failed, 7 days to fix" shown on every page across roles | Owner (Admin/Teacher/Student see read-only variant?) | desktop | **P0** | R11, R21 |
| E2E-J11-002 | Retry on day 3 (time-traveled with MockClock) → email sent, retry succeeds → grace cleared, top strip gone | Owner | desktop | **P0** | R21 |
| E2E-J11-003 | Day 5 retry fails → email sent. Day 6 warning email sent. Day 7 23:59 auto-downgrade to Free → AI grading paused, 2nd teacher seat locked, classes >5 read-only → re-pay → restored | Owner+all | desktop | **P0** | R21, R24 |
| E2E-J11-004 | During grace period, owner attempts to bypass paid feature → blocked at UI AND at API (defense in depth) | Owner | desktop | P0 | R21, R22 |

#### J13 — Enrollment Add/Transfer/Withdraw + audit

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J13-001 ★ | Admin performs Transfer (Class A → Class B) → audit log records performer+timestamp+effective date; enrollment_history table has immutable row | Admin | desktop | **P0** | R17 |
| E2E-J13-002 | Both classes' teachers receive notification (inbox + count badge) | Admin, Teachers | desktop | P0 | R17 |
| E2E-J13-003 | Admin attempts to EDIT existing enrollment_history row via API → 403 (R17) | Admin | api | **P0** | R17 |
| E2E-J13-004 | Withdrawal: student withdrawn from Class A → student loses class access immediately; can still see archived performance | Admin, Student | desktop | P0 | R17, R24 |
| E2E-J13-005 | Teacher (not Admin) attempts Add/Transfer/Withdraw → 403 (FR-46) | Teacher | api | **P0** | R15 |

#### J14 — Bulk CSV student import

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J14-001 ★ | Admin uploads valid 50-row CSV → preview screen → confirm → invites sent → all 50 rows succeed | Admin | desktop | P0 | R18 |
| E2E-J14-002 | CSV with 4 duplicate emails (existing + within-file dupes) + 6 malformed rows → preview shows per-row errors → user confirms partial → 40 succeed → error CSV downloadable with reasons | Admin | desktop | **P0** | R18 |
| E2E-J14-003 | CSV > 200 rows → 422 reject with clear UX | Admin | desktop | P1 | R18 |
| E2E-J14-004 | Mid-upload server error after 25 rows inserted → response indicates partial success with row IDs; idempotency on retry doesn't double-insert | Admin | api | P0 | R18 |

#### J15 — Cross-tenant adversarial GRID (most important security cluster)

This is a **table-driven mass test**, not a single scenario. Each resource family × each attack vector × each role = one test.

| ID | Resource family | Attack vector | Expected | Priority |
|---|---|---|---|---|
| E2E-J15-001..N | classes, exercises, submissions, students, knowledge files, audio files, attempts, enrollments, audit_logs, invites, refresh_tokens, search results, notifications | (a) direct GET by ID from other tenant, (b) PATCH/DELETE by ID from other tenant, (c) LIST endpoint must NOT include other-tenant rows, (d) JWT-forged center_id from other tenant, (e) presigned URL with other-tenant `{center_id}` prefix, (f) Cmd+K search query that would match other-tenant data | 403 OR empty result; audit log records attempt | **P0** for every cell |
| E2E-J15-NULL | Same as above but with middleware bug simulated (no tenant context set) | All requests return zero rows / 403 — NEVER all-rows leak | **P0** |

Sizing: 13 resource families × 6 attack vectors × 4 roles ≈ **312 scenarios**. Implement as Go integration tests (store + handler layer) generated from a fixture table — NOT as 312 Playwright E2Es. Playwright covers a representative 10-scenario smoke nightly.

#### J16 — Force-logout

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J16-001 ★ | Owner force-logs out Teacher → Teacher's refresh token revoked → next API call within 15-min access TTL still succeeds (documented limitation) → after 15min, access denied | Owner, Teacher | desktop | P0 | R5, F3 |
| E2E-J16-002 | Owner from Center A attempts to force-logout user from Center B → 404 (user not visible to Center A) — cross-tenant force-logout guard | Owner | api | **P0** | R1, R5 |

#### J17 — Language toggle across subdomains

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J17-001 | User on `classlite.app` (Astro landing) sets language to Vietnamese → cookie `lang=vi` on `.classlite.app` → navigates to `my.classlite.app` (React) → dashboard renders Vietnamese | Any | desktop (cross-domain project) | **P0** | R38, T3 |
| E2E-J17-002 | Toggle language mid-session in dashboard → all visible strings switch within 1 second → dates re-localized | Any | desktop | P0 | R38 |
| E2E-J17-003 | Run E2E-J5-004 (full grading flow) in Vietnamese — assert exact key resolution; assert no raw `i18n.key` strings appear | Teacher, Student | desktop | **P0** | R38 |

#### J18 — Mobile Writing assignment

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J18-001 ★ | Mobile (390×844) student takes Writing assignment → autosave fires on each pause → sticky word counter visible → submits → result page shows hero band | Student | 📱 mobile-chrome AND mobile-safari | **P0** | R42 |
| E2E-J18-002 | Touch targets on mobile auth screens measured ≥48px | Any | 📱 | P0 | F3 |

#### J19 — Recurring session edit scopes

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J19-001 | Teacher edits ONE occurrence (scope: this only) → only that occurrence changes; past + other future unchanged | Teacher | desktop | P0 | R19 |
| E2E-J19-002 | Edit "this and future" → that one + all future change, past unchanged | Teacher | desktop | P0 | R19 |
| E2E-J19-003 | Edit "all" → does NOT modify past completed sessions (verify per A11 — clarification needed) | Teacher | desktop | P0 | R19 |
| E2E-J19-004 | Concurrent edit: two teachers edit two scopes of same series → no data corruption | Teachers | api | P1 | R19 |

#### J20 — Google Meet integration

| ID | Scenario | Roles | Project | Priority | Risk refs |
|---|---|---|---|---|---|
| E2E-J20-001 | Owner connects Google Meet → next session auto-generates Meet link → teacher + students see link in session detail | Owner, Teacher, Student | desktop | P1 | (n/a) |
| E2E-J20-002 | Owner revokes Google Meet → existing future sessions retain link but new sessions don't get one → UX shows "Meet not connected" | Owner | desktop | P1 | (n/a) |

---

### Coverage Matrix — Backend Integration (non-E2E) by Risk

These are NOT duplicated as E2E. Test at the lowest level that gives confidence.

#### Auth + Security (Epic 1B, Story 1.5/1.6)

| ID | Level | Scenario | Risk |
|---|---|---|---|
| INT-AUTH-001..050 | Store integration | RLS adversarial cross-tenant read AND write for **every table** (users, centers, classes, exercises, submissions, enrollments, audit_logs, refresh_tokens, password_resets, invites, notifications, knowledge_files, attempts, q_a_threads, sessions, billing_events, ai_jobs). Use deterministic UUIDs. | R1, R2, R3 |
| INT-AUTH-051 | Service integration | Login lockout: 5 fails / 10min → 15-min lockout; lockout cleared after time-travel | R13 |
| INT-AUTH-052 | Service integration | Refresh token rotation: concurrent rotation, reuse detection revokes family | R5 |
| INT-AUTH-053 | Handler integration | `Set-Cookie` includes HttpOnly+Secure+SameSite+Domain in non-dev | R7 |
| INT-AUTH-054 | Handler integration | CORS allowlist: matched origin reflects credentials header; unmatched origin doesn't | R8 |
| INT-AUTH-055 | Handler integration | Origin header check on POST/PUT/DELETE/PATCH | R7, R8 |
| INT-AUTH-056 | Handler integration | Rate limit on `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/resend-verification` enforces token bucket | R13 |
| INT-AUTH-057 | Handler integration timing | `/resend-verification` 200 response ≥200ms regardless of email existence (R14 — lower-bound assertion only) | R14 |
| INT-AUTH-058 | Service integration | Role re-validated from DB for every mutating service call (SEC-1) | R15 |
| INT-AUTH-059 | Service integration | Service errors are typed (NotFoundError/ForbiddenError/ValidationError) — handler type-switch → correct status | R2, GO-2 |
| INT-AUTH-060 | Handler integration | Forged JWT with wrong `center_id` is rejected by `extractTenant` middleware | R4 |

#### Submission immutability (Epic 6, R16)

| ID | Level | Scenario |
|---|---|---|
| INT-SUB-001 | DB trigger / store integration | UPDATE on submissions where released_at IS NOT NULL fails |
| INT-SUB-002 | Service integration | Released submission revision creates a new version, leaves original intact, audit log records |

#### Audit append-only (Stories 1.3b, 7, R17)

| ID | Level | Scenario |
|---|---|---|
| INT-AUDIT-001 | Store | UPDATE/DELETE on `audit_logs` / `auth_audit_logs` rejected by RLS policy |
| INT-AUDIT-002 | Store | enrollment_history same invariant |
| INT-AUDIT-003 | Service | Every Add/Transfer/Withdraw produces one and only one row with performer + timestamp + effective_date |

#### Worker tenant context (R3, A7)

| ID | Level | Scenario |
|---|---|---|
| INT-WRK-001 | Worker integration | `AIGradeWorker.ProcessTask` sets `SET LOCAL app.current_tenant_id` from job row; mutating call to OTHER tenant's resource is rejected by RLS |
| INT-WRK-002 | Worker integration | Forged job row with wrong `center_id` claim in payload: worker reads `center_id` from DB row, NOT payload (defense in depth) |
| INT-WRK-003..010 | Worker integration | Same pattern for every job type: ai_grade_speaking, ai_generate_section, ai_generate_questions, ai_generate_distractors, email_retry, billing_grace_state, ... |

#### Email retry queue (Story 1.2d)

Already 5 cases enumerated in story. Add: panic in handler → recovered, queue continues; full buffer → non-blocking publish; max retries → dropped, alert logged.

#### Polar webhook (Epic 9, R11)

| ID | Level | Scenario |
|---|---|---|
| INT-POLAR-001 | Handler integration | Valid signature + valid event → state updated |
| INT-POLAR-002 | Handler integration | Missing/wrong signature → 401 |
| INT-POLAR-003 | Handler integration 🔁 | Same event_id delivered twice → second is no-op (idempotency) |
| INT-POLAR-004 | Handler integration | Replay of old event (timestamp > 5 min) → 401 (depends on A2) |
| INT-POLAR-005 | Handler integration | Tampered body (signature valid but JSON modified) → reject |

#### Bulk CSV import (Epic 2.7, R18)

| ID | Level | Scenario |
|---|---|---|
| INT-BULK-001 | Service integration | Valid rows + invalid rows → per-row results; valid rows persisted; failures listed |
| INT-BULK-002 | Service integration | All-or-nothing mode triggered by malformed header → 0 rows persisted |
| INT-BULK-003 | Service integration | Email collisions across tenants resolved by existing-account link |
| INT-BULK-004 | Service integration 🔁 | Same CSV uploaded twice (same import_id) → second is no-op |

#### N+1 dashboard guard (PERF-2, R31)

| ID | Level | Scenario |
|---|---|---|
| INT-PERF-001..005 | Service integration | Each dashboard endpoint asserts query count ≤ N using pgx instrumentation hook |
| INT-PERF-006 | EXPLAIN ANALYZE harness | Each list endpoint produces a plan with no Seq Scan on tenant-filtered indexes |

---

### Coverage Matrix — Frontend Component Tests

#### Per-component trilogy (Loading / Empty / Error)

Every component that fetches data → 3 named tests (TEST-FE-2). This is **mass coverage** — generated, not per-component prose.

#### Role-based rendering negative coverage (TEST-FE-6)

Every role-gated component → 3 tests (Owner sees, Admin sees, Teacher sees, Student sees) — asserts components are **absent from DOM** for unauthorized roles, not just hidden.

Targets:
- Sidebar (4 roles × items)
- Dashboard widgets (each widget × each role)
- Cmd+K search result types (each result type × each role)
- Q&A panel (Owner/Admin must NOT see — R25)
- Class detail teacher controls
- Billing controls (Owner only)
- Permissions matrix toggles (Owner only)

#### Forms

Every RHF form: required-field validation, max-length validation, Zod parse errors, submit success → form resets, submit failure → form retains values. Optimistic mutation triple verified by MSW fault injection (T14).

#### Accessibility

vitest-axe on every component test. Failing axe assertion is a hard failure.

#### Writing editor (TEST-UX-3) — dedicated suite

- Autosave debounce assertion (T4 — depends on threshold)
- "Saving / Saved / Error" indicator state machine
- Draft recovery from localStorage on reload
- Multi-tab BroadcastChannel coordination
- Keyboard shortcuts (bold/italic/undo/redo)
- Standard editing operations don't break offline

---

### NFR Coverage Plan

| NFR | Validation tool | Test count target | Evidence artifact |
|---|---|---|---|
| Security — Auth | Go handler integration + Playwright E2E | ~60 | `_bmad-output/test-artifacts/evidence/auth-security.json` |
| Security — RLS cross-tenant | Go store integration | ~50 (J15 grid + tables) | `evidence/rls-cross-tenant.json` |
| Security — File upload (R2) | Go handler integration + Playwright | ~15 | `evidence/r2-upload.json` |
| Security — Audit append-only | Go store + service | ~10 | `evidence/audit-invariants.json` |
| Security — OWASP injection | Playwright E2E + Go integration | ~10 | `evidence/owasp.json` |
| Performance — Page load 2s | Lighthouse CI per critical route | per-route | `evidence/lighthouse.json` |
| Performance — Search 500ms | k6 (50 VUs sustained, p95 < 500ms) | 1 scenario | `evidence/k6-search.json` |
| Performance — N+1 | Integration query-count assertion | per-endpoint | `evidence/query-count.json` |
| Performance — AI polling backoff | Worker integration timing | 1 per job type | `evidence/ai-polling.json` |
| Performance — Constant-time 200ms | Go integration timing | 1 | `evidence/constant-time.json` |
| Reliability — Retry logic | Worker integration (email + AI) | ~10 | `evidence/retries.json` |
| Reliability — Health | Integration test (Story 1.2b) | 1 | `evidence/health.json` |
| Reliability — Circuit-breaker on Gemini | Worker integration | 1 | `evidence/gemini-circuit.json` |
| Scalability — UNKNOWN | k6 stress test once SLO defined | — | DEFER |
| Accessibility — WCAG 2.1 AA | vitest-axe + axe-cli E2E | every page | `evidence/axe.json` |
| Mobile — Touch targets, breakpoints | Playwright mobile project | ~30 | `evidence/mobile.json` |
| i18n — Bilingual parity | CI step `i18n-parity-check` + every component test | every key | `evidence/i18n.json` |
| Observability — request_id propagation | Handler integration | 1 per middleware test | `evidence/observability.json` |

---

### Execution Strategy

**PR pipeline (must complete <15 min):**
- All Go unit + service + store + handler integration (parallelized by package)
- All FE component tests (Vitest, sharded)
- 10 Playwright "smoke" E2Es covering J1-001, J5-004, J6-001, J7-001 (mobile-safari only), J10-001, J11-002, J13-001, J15 (1 representative), J17-003, J18-001
- i18n parity CI step
- OpenAPI spec-diff CI step
- vitest-axe accessibility checks
- Lighthouse CI on changed routes only
- Lint + typecheck (frontend) + golangci-lint (backend)
- Coverage report (≥80% line coverage on backend, ≥75% on frontend)

**Nightly (full E2E suite, ~45 min):**
- All Playwright E2E journeys (J1–J20) on chromium, webkit, mobile-chrome, mobile-safari
- Full bilingual run (en + vi) of P0 E2Es
- Full J15 cross-tenant adversarial grid (Go integration nightly, Playwright sample only)
- k6 baseline run (load-only, not stress)
- Real Gemini smoke test (1 per AI flow type, shape-only assertions, allowed to be quarantined-flaky)
- Visual regression baseline diff

**Weekly:**
- k6 stress + spike tests
- Load test with 50 concurrent tenants
- Real Polar.sh sandbox integration (sandbox env, with real webhooks)
- Real R2 upload + retrieval cross-tenant
- Real iOS Safari device sweep for speaking recorder (manual or BrowserStack)
- Full visual regression baseline

**Release gate (manual + automated):**
- PR + Nightly green for 3 consecutive runs
- All BLOCK risks mitigated; all MITIGATE risks have mitigation evidence linked
- NFR evidence collected (see plan above) — feeds into `bmad-testarch-nfr` workflow
- Trace coverage report → `bmad-testarch-trace` workflow

---

### Resource Estimates (Ranges)

Assumes 1 senior test engineer + 1 dev-test pairing partner; numbers reflect SCAFFOLDING + initial test mass for a runnable system. Maintenance not included.

| Phase | Hours |
|---|---|
| **P0** (all BLOCK + MITIGATE risk mitigations + critical user journeys E2E + J15 grid + auth security mass) | **~140–200 hours** |
| **P1** (high-confidence E2Es for non-blocking journeys + integration tests for MONITOR risks + component test mass) | **~80–130 hours** |
| **P2** (secondary flows, visual regression baselines, Lighthouse routes, accessibility deep dives) | **~30–55 hours** |
| **P3** (rarely-touched paths, archive flows, edge utilities) | **~5–15 hours** |
| **NFR — performance (k6 framework)** | **~15–25 hours** |
| **NFR — accessibility framework (axe wiring + per-route audits)** | **~10–15 hours** |
| **i18n parity tooling + component-test helper** | **~6–10 hours** |
| **Cross-domain Playwright config (A3)** | **~4–8 hours** |
| **Worker tenant-context harness (A7)** | **~4–8 hours** |
| **MockClock + propagation (A4)** | **~6–10 hours** |
| **Test fixtures + factories (Go + TS)** | **~15–25 hours** |
| **CI pipeline wiring (5 pipelines + matrix shards)** | **~15–25 hours** |
| **TOTAL (scaffold + initial mass)** | **~330–525 hours** |

Calendar: with a dedicated test engineer, expect **8–12 weeks** to reach release-gate-passing state. With test mass parallelized across the dev team via ATDD on every story, this collapses to **4–6 weeks** but only if every story includes its own test layer per the standard.

---

### Quality Gates

| Gate | Threshold |
|---|---|
| P0 test pass rate | **100%** (any failure → release blocked) |
| P1 test pass rate | **≥95%** |
| P2 test pass rate | **≥85%** |
| Backend code coverage (line) | **≥80%** (project-context CQ-1 + `go test -cover`) |
| Frontend code coverage (line) | **≥75%** on `features/`, ≥80% on `services/` and `lib/api/` |
| All BLOCK risks | **mitigated and tested** (R1, R3) |
| All MITIGATE risks | **mitigation plan + at least 1 test evidence link** |
| RLS cross-tenant grid (J15) | **100% pass on Go integration** + nightly Playwright sample green |
| NFR evidence | All in-scope NFR categories have evidence artifacts populated → `nfr-assess` workflow inputs |
| i18n parity | `en.json` keys ≡ `vi.json` keys; zero raw-key strings in Playwright bilingual run |
| Accessibility | Zero axe violations on every public route (component + E2E) |
| Flaky test ratio | **<2%** on the 30-day rolling window (project-context: flakiness is critical tech debt) |
| OpenAPI drift | Zero CI failures from spec-diff in 7 consecutive days pre-release |



