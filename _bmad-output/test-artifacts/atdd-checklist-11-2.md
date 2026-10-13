---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-10-13'
workflowType: 'testarch-atdd'
storyId: '11.2'
storyKey: '11-2-real-auth-e2e-harness'
storyFile: '_bmad-output/implementation-artifacts/11-2-real-auth-e2e-harness.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-11-2.md'
generatedTestFiles:
  - 'classlite-web/tests/e2e/lib/auth-harness.test.ts'
  - 'classlite-web/tests/e2e/lib/harness-unreachable.test.ts'
  - 'classlite-web/tests/e2e/lib/no-stub-guard.test.ts'
  - 'classlite-web/tests/e2e/dashboard/role-scope.spec.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/11-2-real-auth-e2e-harness.md'
  - '_bmad-output/planning-artifacts/epics/epic-11.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - 'docs/project-context.md'
  - 'knowledge: confidence-gate, auth-session'
---

# ATDD Checklist — Epic 11, Story 11-2: Real-Auth E2E Harness

**Date:** 2026-10-13
**Author:** Murat (Test Architect)
**Primary Test Level:** Vitest unit (harness logic) + Playwright E2E (role-scope). **NOT Playwright-on-Playwright** for the WF-8 gate — per `test-design-architecture.md:242` the red phase for a harness story is vitest/Go on the harness code.

---

## Story Summary

Retire the Phase-0 stub session cookie in `tests/e2e/auth.setup.ts`; make Playwright authenticate through the real `POST /api/auth/login`, capture the real `refresh_token`, and prove each authenticated project boots a live session. Defend R-11-3 (session-minting unreachable in a non-test build) structurally.

**As a** developer **I want** real-login E2E auth with proven-live sessions **so that** no fake session goes unnoticed again and no mint shortcut can ship in a production build.

---

## Acceptance Criteria (coverage map)

| AC | Covered by | Red mechanism |
|---|---|---|
| AC1 — real login, zero stub, provenance oracle | `no-stub-guard.test.ts` (tripwire + structural addCookies guard) | **Behavioral** — fails against today's stub |
| AC2 — role-scope 404 (7-2a) + positive control | `dashboard/role-scope.spec.ts` | `tsc -b` TS2307 (import-fail) |
| AC3 — R-11-3: structural unreachability (primary) + guard PAIR (belt) | `harness-unreachable.test.ts` (primary) + `auth-harness.test.ts` (prod-throws / dev-proceeds PAIR) | Import-fail red; **dev-proceeds** reds first against the throw-stub |
| AC4 — rotation resilience, exercised | `auth-harness.test.ts` (reauthenticate seam) + green-phase induced-dead-cookie test | Import-fail red |
| AC5 — E2E red-phase convention documented | `role-scope.spec.ts` IS the convention demo; doc lands in `docs/bmad-story-conventions.md` (Task 6) | n/a (doc) |
| AC6 — gates + preconditions enforced | all files; `vitest.config.ts` include extension | Suite red until green |
| AC7 — every authed project proven to boot a live session | `role-scope.spec.ts` positive control + `auth.setup.ts` fail-fast (green phase) | Import-fail red |

---

## Red-Phase Test Scaffolds Created

### Vitest — harness unit tests (3 files)

**`classlite-web/tests/e2e/lib/auth-harness.test.ts`** — AC3 guard PAIR + AC1 manifest contract.
- ✅ **Status:** RED — `tsc -b` TS2307 (`./auth-harness` absent) + vitest collection failure.
- **Verifies:** `guardNotProduction` throws on a prod host AND does NOT throw on dev/cross-subdomain localhost (the PAIR; dev-proceeds is the assertion that must red first against the throw-stub); `loadCredentials` returns the typed manifest with ≥2 teacher identities (teacher + teacher2, D1).

**`classlite-web/tests/e2e/lib/harness-unreachable.test.ts`** — AC3 PRIMARY proof.
- ✅ **Status:** RED — `tsc -b` TS2307 (imports `HARNESS_MODULE_ID`).
- **Verifies:** no `src/**` module imports the harness → structurally excluded from the Vite production bundle. No new dependency (fs import-scan, not dependency-cruiser, which is not installed).

**`classlite-web/tests/e2e/lib/no-stub-guard.test.ts`** — AC1 two-oracle guard.
- ✅ **Status:** RED (BEHAVIORAL) — both assertions fail against today's `auth.setup.ts`: tripwire finds the retired stub string; structural guard finds a session-shaped cookie passed to `context.addCookies`. Verified failure: `expected ['tests/e2e/auth.setup.ts'] to deeply equal []`.
- **Verifies:** no fabricated session under `tests/`; sessions must come from a real login, not `addCookies`. Self-match avoided (needle assembled from fragments; file excludes itself).

### Playwright — E2E spec (1 file)

**`classlite-web/tests/e2e/dashboard/role-scope.spec.ts`** — AC2 + AC7.
- ✅ **Status:** RED — `tsc -b` TS2307 (`../lib/auth-harness` absent). Demonstrates the E2E red-phase convention (AC5).
- **Verifies:** owning teacher → `GET /api/students/{id}` 200; teacher2 positive control → `GET /api/students` 200 (live session); teacher2 out-of-scope → **404 `STUDENT_NOT_FOUND`** asserted on the body code, never 403.

### Config
- `classlite-web/vitest.config.ts` — `include` extended with the recursive `tests/e2e` `*.test.ts` glob (NOT `*.spec.ts`; Playwright owns those). This makes the harness unit tests collected (red, not inert).

---

## SEAMS — the ONE place the dev reconciles (green phase)

1. **Create `classlite-web/tests/e2e/lib/auth-harness.ts`** exporting:
   - `CredentialsEntry` type + `loadCredentials(): CredentialsEntry[]` (reads `tests/e2e/.auth/credentials.json`).
   - `guardNotProduction(cfg: { baseURL: string }): void` — throw UNLESS host ∈ `{localhost, *.classlite.localhost, *.classlite.app-staging}`. **Land the throw-stub first so `dev-proceeds` is red**, then implement the allowlist (green).
   - `loginAndCaptureSession(request, cred)` — real `POST /api/auth/login`; assert `response.ok()` AND the jar gained `refresh_token`, else throw.
   - `reauthenticate(request, cred)` — re-login → fresh storageState (AC4; caller re-creates its context).
   - `sessionFileFor(cred)` — the per-role `.playwright/<tenant>-<role>.json` path (one-file-per-consuming-context; no shared rotating default — D2).
   - `HARNESS_MODULE_ID = 'tests/e2e/lib/auth-harness'`.
2. **Rewrite `auth.setup.ts`** — real login per consumed identity; fail-fast assert captured cookie name `refresh_token` + domain `.classlite.localhost`; keep the non-auth `lang` cookie; NO fabricated `addCookies` session.
3. **Seed `teacher2`** (Task 1b) — `dataset.go` roleSpec + explicit creds-gate flag; regenerate `GoldenDigest` with a delta-check.
4. **Resolve the `<SEED_STUDENT_IN_TEACHER_CLASS>` placeholder** in `role-scope.spec.ts` from the seed's deterministic UUIDs / credentials.json.
5. **AC4 green-phase test** — add an induced-dead-cookie recovery test (persist state, kill its `refresh_token`, assert `reauthenticate` recovers). Keeps `reauthenticate` exercised, not dead infra.
6. **Docs** — E2E red-phase convention → `docs/bmad-story-conventions.md`; README TODO retirement; `manual-setup.md` E2E env.

---

## Green-phase run command
```
# unit (WF-8 gate):
cd classlite-web && npx tsc -b && npx vitest run tests/e2e/lib
# E2E (needs seeded API on :8080 + COOKIE_DOMAIN=.classlite.localhost + APP_ENV=development):
cd classlite-web && npx playwright test --project=setup --project=dashboard --workers=1
```

---

## Confidence Gate (per knowledge/confidence-gate.md)
- Harness API + R-11-3 PAIR: **9** — shapes fully specified in the spec; `credentials.go`/`auth_handler.go:329` verified.
- Structural unreachability (fs scan, no depcruise): **8** — depcruise not installed; fs scan is deterministic, no new dep.
- Role-scope spec: **8** — `/students/:id` + `STUDENT_NOT_FOUND` verified (`student_service.go:367`); the two student-ID placeholders are explicit SEAMs, not guesses.
- **Unknowns surfaced (not blocking):** the exact seeded student UUID in the teacher's class (marked `<SEED_STUDENT_IN_TEACHER_CLASS>` for the dev to resolve from the seed); `teacher2`'s email substring (`teacher2`) assumes Task 1b uses the `teacher2` local-part per the spec.

---

## ⚠️ Gate notes for the dev / epic gate
- **The branch is intentionally RED** until 11-2 is implemented: `tsc -b` and `npm test` both fail on the four scaffolds. This is the WF-8 red-phase state, not a regression.
- **INVESTIGATED 2026-10-13 — NOT real failures.** The LSP flagged `RealTeacherDashboard`/`StudentDashboard`/`OwnerDashboard` (implicit-any), `ClassFormDialog.test.tsx` (`BillingSummary`), `attemptReadOnly.test.ts` (unused import). A clean `npx tsc -b --force` (full re-check of `src`) reports **ZERO** of these — they were **stale LSP snapshots**. Disproven against disk: `BillingSummary` exists (`src/lib/api/client.ts:2925`); `readOnlyBannerCopy` is imported+used (`attemptReadOnly.test.ts:7,114`). So `main`'s `tsc -b` is green; 11-2's green transition is a fully clean `tsc -b`.
- **Real CI finding (separate from 11-2):** `ci-web.yml:68` runs `npx tsc --noEmit`, a permanent FALSE-GREEN — proven: 0 errors reported on a tree with 7 real `tsc -b` errors (empty program on the solution-style root `tsconfig.json`). The gate is NOT open because `npm run build` (line 81) = `tsc -b && vite build` runs the real check — but the dedicated "Typecheck" step is theater and brittle. Fix: `tsc --noEmit` → `tsc -b` at line 68. Filed as FU-11-2-CI-TSC-NOEMIT.
```
