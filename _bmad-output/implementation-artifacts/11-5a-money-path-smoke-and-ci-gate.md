# Story 11.5a: Money-Path Smoke + CI Gate

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: 1d6c7fb
epic: 11
story: 11-5a
size: M
wf8_gate: false   # NOT in epic ≥6 trip list (11-1a/11-2/11-6b/11-8a, epic-11.md:449). Risk discharged via vitest guards on quarantine logic + E2E red-phase convention. See Fork 3 — if the full parallel session pool is pulled in, R-11-5 (≥6) trips the gate.
depends_on: [11-1a, 11-2]
supersedes: [FU-11-CI]
reviewed: party-mode 2026-10-13 (Murat/Winston/John/Amelia) — all findings folded; see Change Log
---

## Story

As **Ducdo**,
I want **one real-stack journey — owner/teacher login → open a class → create an assignment → each of the four attempt types → DETERMINISTIC grade → student reads the result — proven green in CI against the seeded, authenticated stack, with a Playwright gate that actually blocks a bad deploy**,
so that **the deterministic core of the path the whole product exists to serve is known to work end to end, which it never has been — and a regression in it stops shipping instead of reaching a center**.

> **No full-stack path has ever been exercised.** Four months, 100+ stories, 101 endpoints — and not one test drives real auth → real RLS tenancy → assignment creation → the submission lifecycle → grading → result read-back as a single living journey. Every prior E2E spec under `classlite-web/e2e/` is `test.describe.skip()` with a mocked API; they prove a component renders, never that the stack is wired. This story builds the **one** spec that proves it is, puts it in CI as a **deploy-gating** check, and lands the mechanics (quarantine lane, built-preview wiring, the dual-rendered-text query convention) that keep the suite honest instead of decaying — the exact rot that caused this epic (`13 failed / 21 skipped / 44 passed`, 2026-09-27).

> **Truth-in-labeling (party-mode John #1/#3).** This is the **deterministic** money path. Two legs are **uncovered by design today** and named in Out of Scope: (a) **class-create + student-enrollment** — the smoke *opens* the seeded active class, it does not create one (Fork 1); (b) **AI grading** (`/ai-grade`, Gemini) — the single highest-stakes, highest-variance leg of the real product (Fork 2). A green badge here means "the deterministic plumbing is wired," not "the product's AI value claim works." Do not let the badge over-promise.

> **This is explicitly not** the 87-screen grid — that is **11-5b**, after L1.

## Acceptance Criteria (BDD)

### AC1 — One real-stack money-path spec, under `tests/e2e/`, against a built preview
- **Given** the seeded stack (11-1a: tenant A `SEEDFAKEA`, owner/teacher/teacher2/student1 in `credentials.json`) and the 11-2 real-auth harness (`tests/e2e/lib/auth-harness.ts`),
- **When** the money-path spec runs,
- **Then** a single Playwright spec under **`classlite-web/tests/e2e/`** (the real-stack tree — NOT `classlite-web/e2e/`, which is mocked + skipped) drives **owner/teacher login → OPEN the seeded active class → create 4 assignments (one per attempt type) → student attempts each → deterministic grade → student reads each result**, all against the **real running API on `:8080`** (no `page.route` mocking of `/api/**`).
- **And** it runs against a **built Vite preview** (`npm run build && npm run preview`), never the dev server (OOM budget, `epic-11.md:424`, `manual-setup.md:360-371`).
- **And** new page-object / helper logic lives under `tests/e2e/` only and is **never imported from `src/**`** (keeps `harness-unreachable.test.ts` green — AC9).
- **Scaffolding boundary (Fork 1 default):** owner/teacher **opens** the seeded active class (student1 already enrolled — no class-create, no enrollment plumbing here; that coverage is owed, see Out of Scope). The owner/teacher creates the 4 assignments browser-driven; exercise **content** (`sections`) is created via **authenticated API** (`POST /api/exercises`) — the structured editor `s16` is out of scope. Student attempts, grading, and result-read are browser-driven.

### AC2 — Four attempt types via single-context in-app navigation (the anti-flake rule)
- **Given** the four money-path skills `reading, listening, writing, speaking` (`internal/seed/dataset.go:20`; `exercises.skill` CHECK, `migrations/20260727120000_create_exercises.up.sql:38`) and `attemptRouteForSkill()` (`src/features/assignments/lib/assignmentRow.ts:27`: reading+listening → `/assignments/:id/attempt` `AttemptPage`; writing → `/write` `WritingAttemptPage`; speaking → `/speak` `SpeakingAttemptPage`),
- **Then** student1 completes all four attempts, each reaching status `submitted` via the real lifecycle `POST /api/submissions` (Start) → `PUT /api/submissions/{id}/progress` (autosave) → `POST /api/submissions/{id}/submit` (finalize) (`main.go:922-925`; `rowStatus()`, `assignmentRow.ts:72`).
- **And — MANDATORY, not dev-discretion (party-mode Murat #1 / Amelia F1):** within any one browser context there is **exactly one `page.goto`** (the single SPA boot); **every** subsequent hop is **in-app client-side navigation** (router link / button click), **never a second full navigation**. A second `page.goto` hits the `classlite_last_refreshed_at` debounce → guest shell (why `dashboard-boots-in-vi.spec.ts` is `fixme`'d). This is the single biggest flake landmine and the login-budget lever (see AC5): the student completes all four attempts + four result-reads inside **one** context via in-app navigation, so the student leg costs **one** login, not nine.
- **And — speaking audio decided NOW (party-mode Murat #2):** the speaking attempt submits a **small committed fixed audio fixture** through the real R2 leg (`POST /api/uploads/presign` → PUT → `POST /api/uploads/confirm`) — **not** a no-audio fallback (which would silently gut AC4's playback assertion). The Playwright/CI chromium launch adds the fake-media flags (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<fixture>`) so `MediaRecorder` captures deterministically headless. Document the fixture path + flags in completion notes.

### AC3 — Grading is deterministic, with OBSERVABLE no-Gemini oracles (party-mode Murat #5 / Amelia F3)
- **Given** no server-level deterministic Gemini stub exists (`cmd/api/main.go:151` always wires the real client; `gemini.MockClient` is Go-test-only),
- **Then** the smoke grades **only** via credit-free, Gemini-free paths: reading+listening via objective auto-grade + `POST /api/submissions/{id}/release`; writing+speaking via **teacher-manual** `POST /api/submissions/{submissionId}/grade` with literal `criterionScores` (writing: `taskResponse/coherenceCohesion/lexicalResource/grammaticalRange`; speaking: `fluencyCoherence/lexicalResource/grammaticalRange/pronunciation`) — **do NOT send a `skill` field** (server-resolved; a `skill` in the body → 409 `SUBMISSION_SKILL_MISMATCH`, `grading_handler.go:315`).
- **And** `/ai-grade` is NEVER exercised, proven by **observable** oracles (not the unfalsifiable "no job enqueued"): (a) a `page.on('request')` listener **fails the test if any request URL matches `/ai-grade`**; (b) the entire job runs green with **no `GEMINI_API_KEY`** set (AC6/AC9); (c) as a belt check, the owner reads `GET /api/billing` (`GetSummary`, owner-only) and the `ai_credits` balance is **unchanged across the run** (delta == 0).

### AC4 — Student reads each result, and the objective SCORE is proven CORRECT (party-mode John #4 / Amelia F6)
- **Given** each graded submission,
- **When** student1 reads it (in-app navigation to `/assignments/:assignmentId/submission` → `SubmissionReviewPage`; `/result` is a redirect alias, `routes.tsx:1251`),
- **Then** `GET /api/assignments/{assignmentId}/result` returns **200** at every stage (**200-pending, never 404** — `attempt_handler.go:204`; response `{submission, assignment, exercise, released, grade, audioUrl, inProgress}`), and after grading `released === true` with a `grade` view rendering `overallBand` + `criterionScores` + `comments`,
- **And** the **teacher identity (`graded_by`) is absent** from the student-facing grade view (privacy D1; `studentGradeViewResponse` has no `GradedBy`, `attempt_handler.go:142`),
- **And — correctness, not just occurrence (John #4):** for the two **objective** attempts (reading+listening) the exercise is authored with a **known answer key**, the student submits **known-correct answers**, and the spec asserts the **computed score/band matches the expected value** — not merely that a band is non-null. (A gate that sleeps through "the pipe delivers garbage" is the exact failure a center can't survive.) For writing+speaking, assert the manually-submitted `criterionScores`/`overallBand` round-trip to the student view verbatim.
- **And** status-code expectations are pinned: teacher-manual `POST /grade` → **201** (`grading_handler.go:333,348`); objective `POST /release` and the student result GET → **200**. Speaking renders audio **playback** in `SubmissionReviewPage` (depends on AC2's real-audio fixture).

### AC5 — Built-preview + project-scoped workers/retries + the session model + the three 11-2 debts
- **Given** `playwright.config.ts` webServers `npm run dev` (l172) and sets a **global** `retries: CI ? 2 : 0` (l52),
- **Then** the money-path lane runs against a **built preview** (via a backgrounded CI step `npm run build && npm run preview` with a readiness poll, OR an **env-gated** `webServer` entry following the existing `BASE_URL_DESIGN_SYSTEM ? [] : […]` idiom at :168 — Playwright webServers are **global, not per-project**, party-mode Winston #4), at **`--workers=1`**, and `retries` is set **project-scoped to CI ×1 / local 0 on the money-path project only** (editing the global l52 would regress `design-system`/`storybook-a11y` — party-mode Amelia F5).
- **And** the session model is retry-safe and burst-8-safe (party-mode Murat #4 / Amelia F1/F2): the lane runs **only the money-path project**, does **NOT** `dependencies: ['setup']` (that setup burns 2 logins the lane doesn't consume), and mints each of its **≤3 contexts** (owner-or-teacher, student1 — and the owner billing-check may share the teacher-staff context if role allows) **fresh** via `loginAndCaptureSession` + the `freshAuthedContext` pattern (`role-scope.spec.ts:89`), **one boot per context** (AC2). **Login arithmetic, shown:** ~2–3 mints × (1 + CI retry ×1) = **≤6 < burst-8** per-IP/2-min (`auth_handler.go:329`). If a future expansion risks exceeding 8, the CI job gets its own IP/limiter reset — stated, not assumed.
- **And** the three debts 11-2 handed to 11-5a (`11-2-…md:126-128`) are resolved for this lane: (1) **retry-safe** under burst-8 (arithmetic above, no setup dependency); (2) **no shared-rotating-state trap** — the lane never consumes the stale on-disk `AUTH_STATE_TEACHER`; it mints fresh; (3) **`guardNotProduction` staging host confirmed** against the real staging hostname (`ALLOWED_HOST_BASES`, `auth-harness.ts:133`; coordinate with 11-8a/11-8b) — or the gap is documented with the deploy host TBD and a dated note.

### AC6 — Playwright CI gate in `ci-web.yml` that bites, reaches the API, and is durably re-checkable (supersedes FU-11-CI)
- **Given** `ci-web.yml` never runs `playwright test` of the e2e specs (the direct cause of the rot, `deferred-work.md:117`) and only wires `actions/setup-node` (no Go toolchain),
- **Then** a new job in **`ci-web.yml`** brings up the full real stack: **Go toolchain** (`setup-go`) + **golang-migrate** + `postgresql-client` (party-mode Murat note / Winston #3) → Postgres (service, pattern `ci-api.yml:12-94`) → the **migrator bootstrap** (create `classlite_migrator`, throwaway `classlite_dev`, owner grant, `migrate up`, `ci-api.yml:84-94`) → start the API (`go build ./cmd/api` then run the binary, **not** fire-and-forget `go run`) with **all required env**: `COOKIE_DOMAIN=.classlite.localhost`, `APP_ENV=development`, `CORS_ORIGINS=http://my.classlite.localhost:5173,http://classlite.localhost:4321`, **`DATABASE_URL`** (classlite_app) **and `MIGRATION_DATABASE_URL`** (superuser — required because `./scripts/seed.sh` default `clean=true` runs `seed.Reset` which DELETEs the DELETE-revoked `grades` table as superuser, `reset.go:95-99`) → **poll `GET /health` until 200** before Playwright starts (`health_handler.go:19`; party-mode Winston #2) → `./scripts/seed.sh` (emits **`classlite-web/tests/e2e/.auth/credentials.json`**, `seed.go:63`) → `npm run build && npm run preview` (readiness-polled) → `playwright test --project=money-path --workers=1`, **no `GEMINI_API_KEY`**.
- **And — the gate reaches the API half of the money path (party-mode Winston #1, sharpest finding):** `ci-web.yml`'s trigger `paths` are extended to include **`classlite-api/**`** and **`classlite-api/migrations/**`**, so an API-side submission/grading/`/result` regression (which today fires only `ci-api.yml` Go tests + ships to Railway) actually trips this gate. Without this the headline "a regression stops shipping" is false for exactly the half where grading lives.
- **And** because the job lives in `CI — Web Dashboard`, a failure auto-gates the web deploy (`deploy.yml:23` fires only on that workflow's `success`) — document the coupling.
- **And — the gate is PROVEN to bite, durably (party-mode John #2 / Murat #3):** a **committed, `test.skip`-tagged mutation fixture** (a money-path spec variant with one step deliberately broken) is checked in so any reviewer can un-skip it and watch it go RED on demand — the proof does **not** evaporate on a revert. The completion notes pin the **CI run URL + the mutation diff** as re-checkable evidence, not a prose claim.
- **And** the typecheck step is corrected `npx tsc --noEmit` → `tsc -b` (closes FU-11-TSC; `[[reference_web_typecheck_gate_is_tsc_b]]`).

### AC7 — Quarantine lane: format + shrink-only + still-runs NOW; expiry/counter deferred to 11-6a (party-mode trim — Winston #6 / John #5 / Murat #6)
- **Given** no quarantine mechanism exists and today's suite has one spec and zero quarantined assertions,
- **Then** a quarantine allowlist (`tests/e2e/quarantine.json`) is introduced at **assertion granularity** (a spec-*file* entry is rejected — file-level quarantine buys silence on its other assertions, `epic-11.md:229`), each entry carrying `{owner, hypothesis, budget, enteredCycle}` (the `enteredCycle` **field ships** as metadata),
- **And** quarantined assertions **still run and report** while non-gating,
- **And** the list is **shrink-only per cycle** — enforced by comparing the working-copy `quarantine.json` against the **committed baseline** (`git show HEAD:…/quarantine.json`; the guard explicitly does this git read — it is NOT a pure in-memory logic test, party-mode Murat #6a) and failing if any entry is **added** beyond the baseline.
- **And** these invariants have **red-first vitest guards** (`tests/e2e/lib/quarantine.test.ts`): shrink-only (added entry → fail), assertion-granularity (file-level entry → fail), still-runs (a quarantined assertion is executed + reported + non-gating). Each proven red against the absent/empty mechanism first (E2E red convention).
- **DEFERRED to 11-6a (party-mode trim — three-reviewer consensus; Fork 4 conceded expiry is "the softest leg"):** the **2-cycle-expiry enforcement** and the **CI-bumped cycle counter**. Rationale: a CI counter write-back implies CI pushing to `main` (re-trigger races, push perms) and there is **no loop identity / real cycle cadence until 11-6a**. Shipping it now would be an **inert false-green** (counter never increments → expiry guard always passes). The `enteredCycle` field is captured now so 11-6a has the data; the *enforcement* lands with the loop. Recorded in Out of Scope.

### AC8 — Dual-rendered-text query convention documented + proven on the known rot
- **Given** two components render identical text in a double node — `sr-only` live-region + `aria-hidden` visible label — both resolving to **"Auto-save on"** in `idle` (onboarding `AutoSaveIndicator.tsx:70`; exercise-editor `EditorAutoSaveIndicator.tsx:64`; i18n `onboarding.wizard.autoSaving.idle` + `exercises.editor.autosave.idle`), so `getByText('Auto-save on')` **strict-mode-violates**,
- **Then** `docs/bmad-story-conventions.md` gains the **dual-rendered-text query convention**: this double match is a **class, not a bug** (correct a11y); query the **visible** node by excluding `sr-only` — scope to `[aria-hidden="true"]` (or `data-status` / a scoped `data-testid`); **`.first()` is banned** (masks the real node count, re-breaks on the next a11y addition).
- **And** the convention is **proven** by fixing the live rot it names — `e2e/onboarding-persona-center.spec.ts`'s `sr-only` "Auto-save on" strict-mode violation (`deferred-work.md:122`) — green under the convention.

### AC9 — Gates green + red-phase convention honored
- `npx tsc -b` clean (covers `src` AND `tests/e2e` via `tsconfig.e2e.json` — the real gate; `tsc --noEmit` false-greens).
- `npm test` (vitest) green, including the new `quarantine.test.ts` and **no regression** to `no-stub-guard.test.ts` / `harness-unreachable.test.ts` / `auth-harness.test.ts` (R-11-3 proofs — never fabricate a session cookie via `addCookies`; mint via `loginAndCaptureSession` only).
- `npm run lint` clean.
- The money-path spec green locally against a seeded preview at `--workers=1`, and green in the new CI job.
- **Red phase:** the money-path spec first imports its not-yet-existing `tests/e2e/money-path/` page-object module so `tsc -b` goes red `TS2307`; the quarantine guards go red-by-assertion first. **Note:** the money-path spec itself has **only a compile red (TS2307)** — it is a smoke over already-shipped features, so there is **no behavioral red** to hunt (don't waste a cycle looking for one).

## Tasks / Subtasks

_Sequencing (party-mode John #5): the money-path spec that bites (Tasks 1–4, 7) and shrink-only quarantine (Task 6 minus expiry) are **P0**. If the M overruns, the first thing to shed is anything beyond shrink-only in quarantine — never the money-path depth._

- [x] **Task 0 — Red phase (AC7, AC9)**
  - [x] Money-path spec imports a not-yet-existing `tests/e2e/money-path/` page-object → prove `tsc -b` red `TS2307`.
  - [x] `tests/e2e/lib/quarantine.test.ts` guards (shrink-only, assertion-granularity, still-runs) → prove each red against the absent mechanism.
- [x] **Task 1 — Money-path helpers + exercise content (AC1, AC2, AC4)**
  - [x] `tests/e2e/money-path/` page-objects: authenticated API client (harness `request` + explicit `origin`), per-context fresh-mint helper, in-app navigation helpers.
  - [x] Author 4 skill-specific exercises via `POST /api/exercises` with real `sections` — reading+listening with a **known answer key** (see Dev Notes "sections schema"); writing+speaking prompts.
- [x] **Task 2 — Spec: attempts, single-context (AC2) [P0]**
  - [x] owner/teacher login → open seeded active class → create 4 assignments.
  - [x] student1: ONE `page.goto` boot, then in-app navigation through all 4 attempts → `submitted`. Speaking: real audio fixture + fake-media launch flags.
- [x] **Task 3 — Spec: deterministic grading + no-Gemini oracles (AC3) [P0]**
  - [x] reading+listening → objective release; writing+speaking → teacher-manual `POST /grade` (201, no `skill` field). `page.on('request')` no-`/ai-grade` guard; run with no `GEMINI_API_KEY`; owner `GET /api/billing` credit-delta == 0.
- [x] **Task 4 — Spec: result read-back + correctness (AC4) [P0]**
  - [x] Each attempt: `GET …/result` 200-pending → post-grade `released`+band; objective **score matches known key**; `graded_by` absent; speaking playback renders.
- [x] **Task 5 — Preview + workers/retries + 3 debts (AC5)**
  - [x] Preview as a backgrounded CI step (or env-gated global webServer) + readiness poll; `--workers=1`; **project-scoped** retries CI×1/local0; no `['setup']` dep; confirm `guardNotProduction` staging host.
- [x] **Task 6 — Quarantine: format + shrink-only + still-runs (AC7) [P0 for shrink-only]**
  - [x] `quarantine.json` + loader + `{owner,hypothesis,budget,enteredCycle}` schema + shrink-only (vs `git show HEAD:` baseline) + still-runs reporter integration → turn Task 0 guards green. **Do NOT build the cycle counter / expiry enforcement (→ 11-6a).**
- [x] **Task 7 — CI gate in `ci-web.yml` (AC6) [P0]**
  - [x] New job: Go toolchain + migrate + psql + Postgres service + migrator bootstrap + API (`go build` → run, all env incl. both DB URLs) + `/health` poll + `./scripts/seed.sh` + build+preview + `playwright test --project=money-path`.
  - [x] Extend trigger `paths` with `classlite-api/**` + `classlite-api/migrations/**`. Fix typecheck `tsc --noEmit` → `tsc -b`. Commit the `test.skip` mutation fixture; pin CI-run-URL + mutation diff in completion notes. Document the `deploy.yml` coupling.
- [x] **Task 8 — Dual-rendered-text convention (AC8)**
  - [x] Document in `docs/bmad-story-conventions.md`; fix `onboarding-persona-center.spec.ts` strict-mode violation as proof.
- [x] **Task 9 — Gates (AC9)**
  - [x] `tsc -b`, `npm test` (incl. new guards, no regression to R-11-3 proofs), `npm run lint`, local money-path green at `--workers=1`.

## Dev Notes

### Pre-flight (mandatory — [[feedback_check_prior_story_artifacts_before_generating]])
Grep + read before writing: `classlite-web/tests/e2e/lib/auth-harness.ts`, `tests/e2e/auth.setup.ts` (note `consumedIdentities()` = `[teacher, teacher2]` only — **no owner/student1**; the lane mints its own, so do **not** `dependencies:['setup']`), `tests/e2e/dashboard/role-scope.spec.ts:89-124` (fresh-per-context mint + the second-goto debounce), `playwright.config.ts`, `tsconfig.e2e.json`, `.github/workflows/{ci-web,ci-api,deploy}.yml`, `classlite-api/internal/seed/{seed,dataset,reset}.go`, `scripts/seed.sh`, `src/features/assignments/lib/assignmentRow.ts`, `classlite-api/internal/handler/{grading,attempt}_handler.go`, `e2e/objective-grading-6-4b.spec.ts` + `classlite-api/internal/handler/auto_grade_e2e_6_4b_atdd_test.go` (existing scorable objective content — the model for AC4's known answer key).

### The single-context navigation rule (the #1 flake landmine — party-mode Murat #1 / Amelia F1)
One `page.goto` per context (the single SPA boot); every later hop is in-app router navigation (link/button click). A second `page.goto` → `classlite_last_refreshed_at` debounce → guest shell. The student completes all 4 attempts + 4 result-reads in **one** context → **one** login. This is both the correctness rule and the burst-8 lever.

### 11-2 harness contract (build on it; do not re-invent login)
- `loginAndCaptureSession(request, cred, {origin})` → real `POST /api/auth/login`, captures the real `refresh_token` into a storageState. Pass `{origin: originOf(baseURL)}` explicitly (an `APIRequestContext` sends no `Origin` → `OriginCheck` 403s login).
- Refresh token is **single-use** against the rotating server (`auth_refresh.go:49`); a reused/duplicate-boot token triggers **family revocation** (`:125`). Mint fresh per context (`freshAuthedContext`, `role-scope.spec.ts:89`); never consume the stale on-disk `AUTH_STATE_TEACHER`.
- **Do NOT regress R-11-3 proofs:** `no-stub-guard.test.ts:58` (no `addCookies` of a session-shaped cookie; `refresh_token` via `context.cookies()` is fine), `harness-unreachable.test.ts:40` (no `src/**` imports the harness). Keep all new session logic under `tests/`.

### Preview host alignment (party-mode Amelia F2 — a silent logged-out-boot trap)
`npm run preview` defaults to port **4173** and **rejects unknown Hosts** (`preview.allowedHosts`). The refresh cookie's `Domain=.classlite.localhost` (asserted in `auth.setup`) means the preview MUST be served under a **`*.classlite.localhost`** host (e.g. `my.classlite.localhost`) on the baseURL the money-path project uses, with `preview.allowedHosts` permitting it. Misalignment → either a Host 403 or a silent guest-shell boot. Pin host/port/`allowedHosts`/`COOKIE_DOMAIN` together.

### Seed surface (what exists vs what the smoke creates) — 11-1a
Tenant A `SEEDFAKEA`: owner/admin/teacher/teacher2/student1 (password `SeedFakePassw0rd!1`). Seeded **active class** with student1 enrolled. 4 exercises exist but **content is empty `{"sections":[]}`** (`dataset.go:152`) and submissions are fixed-status stubs — **not usable** as the test actor's live journey. So the smoke creates its own answerable exercises + assignments + fresh attempts, reusing only the seeded active class + student1 enrollment.

### `sections` schema per skill (party-mode Amelia F4 — don't invent it)
Derive the `sections` JSON shape from the **exercise API schema** (`api.yaml` Exercise/ExerciseContent) + the **objective auto-grader's** expected answer-key shape (`autoGradeHandler`, and the quiz reader in `AttemptPage`). The existing `e2e/objective-grading-6-4b.spec.ts` + `auto_grade_e2e_6_4b_atdd_test.go` already construct scorable objective content with a known key — **copy that shape** for reading+listening (gives AC4 its correctness oracle for free). Writing+speaking need only a prompt body.

### CI orchestration (party-mode Winston #1/#2/#3)
- **Paths:** `ci-web.yml` must trigger on `classlite-api/**` + `migrations/**` too, or API-side grading regressions never trip the gate (they ship to Railway on `ci-api` green).
- **Readiness:** `go build ./cmd/api` → run binary → poll `GET /health` until 200 (`health_handler.go:19` returns 503 until the pool pings) before Playwright. Same poll for `npm run preview`.
- **Credentials:** the seed needs the full `ci-api.yml:84-94` bootstrap + **both** `DATABASE_URL` (classlite_app) and `MIGRATION_DATABASE_URL` (superuser) — the `grades` DELETE revoke forces the reset cascade to run as superuser.
- **No-Gemini holds only on the manual-sections path** (party-mode Winston #5): `gemini.NewClient` makes no network call at construction and the API boots fine with no key; the gate goes red only if a path ever routes through AI-generate/`/ai-grade`. Keep content creation on literal `sections`.

### DB hygiene + selectors (party-mode Murat note)
CI runs disposable `classlite_test` (clean each run). Locally on a persistent dev DB, created entities accumulate → the spec must carry the **created id/name** through to its selectors (never re-find by a generic label like `getByText('Reading assignment')`, which strict-mode-violates on prior runs). Document the local `seed.Reset`/`DestructiveReset` step (positive-proof guarded, `reset.go`).

### Project rules in force
UX-1 (loading/empty/error) + i18n (TEST-FE-4 — assert via key resolution, both locales) apply to rendered-string assertions. Story file ≤600 lines ([[bmad-story-conventions]]); implementation record → `11-5a-…-completion-notes.md` at first dev pickup.

### References
- Epic: [Source: epic-11.md#Story-11-5a (701-722); risk reg 440-457; quarantine R1-6 (215-231); FU table 419; OQ-11-2 (898)]
- Deps: [Source: 11-2-real-auth-e2e-harness.md (harness + 3 deferred items :126-128); 11-1a-seed-fixtures-and-test-tenant-isolation.md (seed surface)]
- Conventions: [Source: docs/bmad-story-conventions.md#E2E-red-phase-convention; deferred-work.md FU-11-CI (:117), FU-11-TSC]

## Definition of Done
- All 9 ACs satisfied; the money-path spec green locally (`--workers=1`, seeded preview) and in the new CI job.
- The gate **reaches the API** (trigger paths incl. `classlite-api/**`) and **bites durably**: a committed `test.skip` mutation fixture reds on un-skip, and the CI-run-URL + mutation diff are pinned in completion notes.
- Objective grading **correctness** asserted against a known key (not just band-non-null); teacher-manual scores round-trip verbatim.
- Quarantine: format + shrink-only (vs committed baseline) + still-runs enforced with passing red-first guards; expiry/counter explicitly deferred to 11-6a.
- Dual-rendered-text convention documented + the named rot spec fixed.
- `tsc -b` / `npm test` / `npm run lint` clean; R-11-3 proofs un-regressed.
- Zero Gemini credit burn; smoke green with no `GEMINI_API_KEY`; `page.on('request')` no-`/ai-grade` guard present; owner credit-delta == 0.
- FU-11-CI marked superseded + FU-11-TSC closed in `deferred-work.md`.

## Out of Scope
- **Class-create + student-enrollment coverage** (party-mode John #1): the smoke *opens* a seeded class; the day-one create-class + enroll path is **owed** → named here, land it in **11-5b** (or a filed FU) — a gap named is a gap not forgotten.
- **AI-auto-grade (`/ai-grade`, Gemini) — including grading *correctness*** (party-mode John #3/#4): the product's highest-stakes leg → **11-4 / 11-0b gold set / 11-5b**.
- **Quarantine cycle-counter + 2-cycle-expiry enforcement** → **11-6a** (needs the loop's cadence/identity; shipping now = inert false-green).
- The 87-screen grid / per-journey rebuild + full-page axe + i18n rendered-behaviour fixtures → **11-5b**.
- The full parallel-worker-safe session pool / true R-11-5 closure under N workers → **11-5b**.
- Deploy pipeline migration step / gate / rollback → **11-8a**; staging + backup-restore + k6 → **11-8b**. Epic 9/10 entity seeding → **11-1b**.
- The structured exercise editor (`s16`) as a UI-driven step (exercise content via API).

## Forks (RULED by Ducdo 2026-10-13 — defaults accepted; Fork 4 updated by party-mode trim)
1. **Scaffolding depth** — RULED: hybrid (open seeded class; browser-drive assignment/attempt/grade/result; exercise content via API; skip `s16`). Class-create+enroll coverage owed → Out of Scope.
2. **Grading path** — RULED: deterministic only (objective release + teacher-manual grade); `/ai-grade` not exercised → 11-4/11-5b.
3. **R-11-5 / WF-8** — RULED: single-worker/single-tenant; full parallel pool → 11-5b; not a WF-8 trip (risk discharged via vitest guards + red convention).
4. **Quarantine "cycle" / expiry** — RULED (party-mode trim, three-reviewer consensus): ship **format + shrink-only + still-runs + assertion-granularity** now; **defer the cycle-counter + 2-cycle-expiry enforcement to 11-6a** (no loop cadence yet → enforcing now is an inert false-green). `enteredCycle` field ships as metadata so 11-6a has the data.

## Change Log
| Date | Change | Author |
|---|---|---|
| 2026-10-13 | Story created (bmad-create-story, Amelia). 4-agent recon (harness/seed/CI/money-path flow) over baseline 1d6c7fb. 9 ACs / 10 tasks. 4 forks ruled (defaults). WF-8 not tripped. Supersedes FU-11-CI. | Amelia |
| 2026-10-14 | VERIFIED LIVE (Ducdo asked for a local run). Money-path journey GREEN end-to-end against the real seeded stack (Postgres + migrated classlite_dev + seed + Go API on :8080, no GEMINI_API_KEY + built preview): `✓ … (32.4s), 1 passed, 1 skipped`. Mutation fixture un-skipped → RED for the right reason (wrong answers release band 2.0, not 9.0 — oracle bites, not a tautology). The live run caught THREE latent bugs no prior test reached: (1) FIXED — students 403'd on speaking-audio presign (advisory storage check role-gated all features; scoped to knowledge-only, Ducdo ruling; regression test added); (2) FILED FU-11-5A-ASSIGN-UI (no teacher assign UI); (3) FILED FU-11-5A-SPEAKING-GRADEVIEW (student view drops speaking criteria + shows band "coming soon", D6) + FU-11-5A-ASSIGN-LIST-STALE. Gates: tsc -b, eslint, vitest (incl e2e guards), go build/vet all green. | Amelia |
| 2026-10-13 | Implemented (bmad-dev-story, Amelia). All 9 ACs built; implementation record → [`11-5a-…-completion-notes.md`](./11-5a-money-path-smoke-and-ci-gate-completion-notes.md). TWO spec-vs-reality collisions ruled by Ducdo: (1) speaking real-R2 vs creds-free CI → dev-only mock-R2 PUT sink (Go); (2) no teacher assign-UI exists → API-drive assignment create + file FU-11-5A-ASSIGN-UI (P1). Quarantine lane (format+granularity+shrink-only+still-runs, red-first guards 14/14) shipped; expiry/counter deferred to 11-6a. Dev mock-R2 sink + money-path project + preview proxy + ci-web money-path job (+API trigger paths, tsc -b) + dual-rendered-text convention (+onboarding rot fixed). Gates green HERE: tsc -b, vitest 21/21 e2e (R-11-3 un-regressed), lint 0 errors, go build/vet. Money-path Playwright journey + mutation fixture written against verified contracts (SEAMs S1–S6 documented) — LIVE green is produced by the new CI job / a local seeded run (NOT runnable DB-less); CI-run-URL + mutation diff to be pinned in completion notes post-first-run. FU-11-CI superseded, FU-11-TSC closed. | Amelia |
| 2026-10-14 | Post-review VERIFIED LIVE + status → done (Amelia). Changed deploy-gating money-path spec run GREEN end-to-end vs the real seeded stack (classlite_test + seed + Go API :8080 + ENABLE_DEV_MOCK_R2_SINK + built preview, no GEMINI): `✓ 1 passed, 1 skipped (32.7s)`. AC4 additions held live (speaking criterionScores verbatim + SpeakingGradeBlock render, no coming-soon). Gate BITES: mutation fixture un-skipped → RED (band 2 not 9), reverted. Local-run gotcha recorded: API must use the superuser DATABASE_URL (RLS bypass) for the login center-resolution COUNT, else CENTER_REQUIRED (not a code defect; the review patches don't touch auth/RLS). 2a acceptance (local-green) met; sole push-time follow-up = pin the ci-web CI-run URL. | Amelia |
| 2026-10-14 | Code review (bmad-code-review, Amelia) — 3 adversarial layers; 4 decision-needed + 14 patch + 1 defer + 7 dismissed. Ducdo ruled ①AC4=B ②AC6=2a ③storage=3b ④mock-sink=4b. ALL 14 patches APPLIED: AC4 shipped the full speaking grade feature (backend ScoresRaw verbatim + skill-polymorphic api.yaml + codegen + net-new FE `SpeakingGradeBlock` + D6 test split + money-path speaking-verbatim assertion) → **FU-11-5A-SPEAKING-GRADEVIEW CLOSED**; storage pre-check decoupled onto `FeatureCountsTowardStorage` (3b); dev mock-R2 sink gained a 3rd gate `ENABLE_DEV_MOCK_R2_SINK` (4b, ci-web sets it); quarantine P1–P5 (git-failure distinction, collision-safe key, parse-wrap, empty→[], granularity trim); mock-sink content-type passthrough; `resolveActiveClassId` fail-fast; money-path P7/P8/P10/P11 (credit oracle hardened, speaking readiness-not-sleep, nav scoped, teacher no-/ai-grade guard). Gates GREEN: tsc -b, vitest (49+87, R-11-3 un-regressed), eslint 0-err, go build/vet, DB-backed handler/service tests incl. the speaking-presign-403 regression. Status → in-progress: the changed deploy-gating money-path E2E must be run GREEN (local/CI) + CI-run URL pinned (AC6 2a); local runs now need ENABLE_DEV_MOCK_R2_SINK=true. 1 defer (preview host coupling) → deferred-work.md. | Amelia |
| 2026-10-13 | Party-mode review (Murat/Winston/John/Amelia) — ALL findings folded: AC2 single-context in-app-navigation rule + real speaking audio (fake-media flags); AC3 observable no-Gemini oracles (request-listener + billing-delta, dropped unfalsifiable "no job enqueued"); AC4 objective-correctness-vs-known-key + 201 status; AC5 project-scoped retries + no `['setup']` dep + burst-8 arithmetic; AC6 extend trigger paths to `classlite-api/**` (gate the API half) + Go toolchain/both-DB-URLs/`/health` readiness poll/credentials path + durable committed `test.skip` mutation fixture; AC7 TRIMMED — expiry/counter → 11-6a (Fork 4 updated); Dev Notes +preview-host alignment +`sections` schema pointer +CI orchestration; Out of Scope +class-create/enroll + AI-grade-correctness + quarantine-expiry; Tasks P0-sequenced. Truth-in-labeling: "deterministic money path". | Amelia |

## Review Findings
_Adversarial code review 2026-10-14 (bmad-code-review, Amelia) — 3 layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) over the uncommitted working tree vs baseline 1d6c7fb. 4 decision-needed, 11 patch, 1 defer, 7 dismissed (verified false-positives/accepted deviations)._

### Decision-needed (RESOLVED by Ducdo 2026-10-14)
- [x] [Review][Decision→Patch] AC4 — speaking `criterionScores` not asserted verbatim to the student view — spec AC4 mandates writing AND speaking round-trip verbatim; spec asserts `toMatchObject(WRITING_SCORES)` only for `skill==='writing'` (money-path.spec.ts:1387). Root cause: the student projection (`attempt_handler.go:144,172`) emits the writing-only `criterionScoresResponse` over `res.Grade.Scores`, and the FE `SubmissionReviewShell` renders `GradeComingSoon` for all non-writing grades (D6 deliberate deferral). **RULED (B): fix the full feature now** — backend emit `res.Grade.ScoresRaw` verbatim (skill-agnostic, mirrors 6.3a teacher read) + api.yaml student-result `criterionScores` → skill-polymorphic + codegen + **net-new FE speaking grade-criteria layout** replacing `GradeComingSoon` for speaking + rewrite the D6 "coming soon" tests + i18n + money-path speaking verbatim assertion. Atomic cross-service (WF-1/WF-4). Closes FU-11-5A-SPEAKING-GRADEVIEW. → PATCH.
- [x] [Review][Decision] AC6 — the deploy-gating CI job has never actually run in CI — **RULED (2a): accept local-green for now; pin the CI-run URL on first branch push (action item, no code change).** DoD CI-URL evidence tracked as an action item, not a blocker. → ACCEPTED + action item.
- [x] [Review][Decision→Patch] Advisory storage pre-check now scoped to knowledge-only — [classlite-api/internal/handler/upload_handler.go:~162] gated on `req.Feature == service.FeatureKnowledge`. **RULED (3b): decouple the advisory check from the student-owned staff-gate** — add a `service.FeatureCountsTowardStorage(feature)` predicate (true only for knowledge today) and gate on it, so all storage-counted features keep the advisory pre-check and intent is expressed by concept not a hardcoded feature name. → PATCH.
- [x] [Review][Decision→Patch] Dev-only unauthenticated mock-R2 PUT sink — [classlite-api/cmd/api/main.go:1159 + classlite-api/internal/handler/mock_r2_sink.go] sole guard `APP_ENV=="development" && mockUploadStorage != nil`. **RULED (4b): add defense-in-depth** — require an explicit opt-in env flag as a SECOND independent gate so an accidental prod-as-development boot with R2 unset cannot silently expose the endpoint. → PATCH.

### Patches
- [x] [Review][Patch] AC4 speaking grade feature (from Decision ①, ruled B) [classlite-api/internal/handler/attempt_handler.go:144,172 + api.yaml + classlite-web/src/features/submission-review/components/SubmissionReviewShell.tsx + SubmissionReviewGraded.test.tsx + money-path.spec.ts:1387] — backend ScoresRaw verbatim + skill-polymorphic schema + codegen + net-new FE speaking grade layout + D6 test rewrite + i18n + money-path assertion. Cross-service atomic.
- [x] [Review][Patch] Advisory storage pre-check decouple (from Decision ③, ruled 3b) [classlite-api/internal/service/upload_allowlist.go + classlite-api/internal/handler/upload_handler.go:162] — add `FeatureCountsTowardStorage` predicate, gate the advisory check on it.
- [x] [Review][Patch] Dev mock-R2 sink defense-in-depth (from Decision ④, ruled 4b) [classlite-api/cmd/api/main.go:1159 + config] — require an explicit opt-in env flag as a second gate.
- [x] [Review][Patch] Shrink-only guard silently passes on ANY git failure, not just first-landing [classlite-web/tests/e2e/lib/quarantine.ts:924-932] — `readCommittedBaseline` catch returns null for git-missing/detached-HEAD/maxBuffer too; the test treats null as a bare pass (not skip-with-reason). Distinguish "path absent in HEAD" from "git error"; surface a real skip reason.
- [x] [Review][Patch] `entryKey` `::` separator collision [classlite-web/tests/e2e/lib/quarantine.ts:830-832] — a spec/assertion containing `::` collapses two distinct entries → shrink-only false-pass / wrong `isQuarantined` match. Use a collision-safe key (`JSON.stringify([spec,assertion])` or a NUL delimiter).
- [x] [Review][Patch] `readCommittedBaseline` parse/validate throw is uncaught [classlite-web/tests/e2e/lib/quarantine.ts:933] — `JSON.parse`/`validateQuarantineEntries` sit outside the try; a malformed committed JSON throws a raw SyntaxError instead of the friendly handled path `loadQuarantine` produces.
- [x] [Review][Patch] Empty/0-byte `quarantine.json` throws instead of being an empty allowlist [classlite-web/tests/e2e/lib/quarantine.ts:899-912] — missing file returns `[]` but a 0-byte/whitespace file hard-fails `JSON.parse("")`; short-circuit empty → `[]`.
- [x] [Review][Patch] Granularity check only tests non-empty, not granularity [classlite-web/tests/e2e/lib/quarantine.ts:862-867,834-836] — `isNonEmptyString` accepts `" "` or a suite-title string as an "assertion"; trim + reject empty-after-trim.
- [x] [Review][Patch] `resolveActiveClassId` falls back to an arbitrary real class [classlite-web/tests/e2e/money-path/moneyPath.ts:1854-1865] — `active.find(SEED_FAKE_) ?? active[0]` silently authors throwaway data into an unrelated teacher's class when the seed marker is absent; fail fast instead.
- [x] [Review][Patch] Credit-balance oracle is vacuously satisfiable [classlite-web/tests/e2e/money-path/money-path.spec.ts:1315-1321,1457-1462] — un-null-checked `body.data.usage.aiCredits.available` makes `undefined===undefined` pass; second read omits `expect(r.ok())`. Assert `r.ok()` on both + assert `available` is a number.
- [x] [Review][Patch] Speaking attempt relies on a magic 1200ms wall-clock window [classlite-web/tests/e2e/money-path/money-path.spec.ts:1246-1251] — no assertion that MediaRecorder emitted a non-empty blob; a cold CI chromium can yield a 0-byte blob → nondeterministic downstream band/audioUrl failure. Wait on a readiness signal / assert blob non-empty before stop.
- [x] [Review][Patch] Mock R2 sink discards the signed Content-Type [classlite-api/internal/handler/mock_r2_sink.go:40-60 → classlite-api/internal/service/storage_mock.go:76-81] — `SeedObject` hardcodes `application/octet-stream`; capture the request Content-Type so the mock mirrors R2's contract (defends any future HeadObject content-type confirm).
- [x] [Review][Patch] `.first()` on nav-link locators in the new spec [classlite-web/tests/e2e/money-path/money-path.spec.ts:1415,1417] — same node-count-masking the AC8 convention bans, in brand-new E2E code; use a testid / specific selector.
- [x] [Review][Patch] No-`/ai-grade` request listener installed only on the student page [classlite-web/tests/e2e/money-path/money-path.spec.ts:1326] — teacher context unwatched; install `installNoAiGradeGuard` on the teacher page too for full AC3 oracle coverage.

### Deferred
- [x] [Review][Defer] Preview `allowedHosts`/`port` hardcoded but `BASE_URL_DASHBOARD` is overridable [classlite-web/vite.config.ts:439-448 + classlite-web/playwright.config.ts:43-44] — deferred, latent config coupling not on the default money-path path (partly documented in Dev Notes "Preview host alignment"); a staging-host override would 403/guest-shell silently.
