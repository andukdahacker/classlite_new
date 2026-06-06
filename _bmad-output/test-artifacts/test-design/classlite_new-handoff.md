---
title: 'TEA Test Design → BMAD Handoff Document'
version: '1.0'
workflowType: 'testarch-test-design-handoff'
inputDocuments:
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - '_bmad-output/test-artifacts/test-design/test-design-progress.md'
sourceWorkflow: 'testarch-test-design'
generatedBy: 'TEA Master Test Architect (Murat)'
generatedAt: '2026-06-04'
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
| R38 | TECH | 3×2 | 6 | Epic 1C (i18n setup story) + every component story | Vitest helper + CI step |
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
