# Story 11-5a: Completion Notes

_Implementation record for [`11-5a-money-path-smoke-and-ci-gate.md`](./11-5a-money-path-smoke-and-ci-gate.md). Status: review._

## Dev Agent Record

### Debug Log

- **Two spec-vs-reality collisions surfaced during recon (both ruled by Ducdo 2026-10-13):**
  1. **Speaking real-R2 leg vs creds-free CI.** AC2 mandates the speaking attempt exercise the real
     presign→PUT→confirm R2 leg (no no-audio fallback), but the CI/dev env (AC6) is credential-free →
     in-process `MockStorageService`, whose presign URL (`mock-r2.example.com`) is a dead host the
     browser can't PUT to; `R2StorageService` has no endpoint override; no local MinIO. **Ruling:
     Option A — dev-only mock-R2 PUT sink.** Implemented: `MockStorageService.SetSinkBase` +
     `PUT /api/__mock_r2/{key...}` (handler `mock_r2_sink.go`), mounted on the root mux (bypasses
     auth/OriginCheck like the Polar webhook) ONLY when `APP_ENV=development && R2 unset`. The mock
     presign then returns `/api/__mock_r2/{key}` (relative → same-origin via the preview proxy, no
     CORS), the PUT stores the bytes via `SeedObject`, and confirm/playback see the real object.
  2. **No teacher assignment-create UI exists.** AC1 said "owner/teacher creates the 4 assignments
     browser-driven," but `POST /api/assignments` has ZERO call sites in app source — the only
     assignment UI is the read-only student list. **Ruling: Option (a) — API-drive it + file the
     follow-up.** The smoke creates assignments via the authed teacher API (same carve-out AC1 makes
     for exercise content); the product gap is filed as **FU-11-5A-ASSIGN-UI (P1)** in
     `deferred-work.md`. Browser coverage stays on the legs with real UI: teacher opens the seeded
     class + the full student journey.

- **Manual grade releases in ONE call.** Recon flagged ambiguity; `grading_service.go`
  `GradeWriting`/`GradeSpeaking` set `ReleasedAt = now` (:848/:894) — so writing/speaking need only
  `POST /grade` (201, released), and only objective reading/listening need the separate
  `POST /release` (200). The spec reflects this.

- **Student-assignments list is not invalidated on submit** (`useSubmitAttempt` has no
  `invalidateQueries`; `useStudentAssignments` `staleTime: 30s`). So a returning student sees stale
  statuses for up to 30s → the row review CTA is absent. SEAM handled: the AC4 hard oracles
  (200-pending, released, band, `graded_by` absent, objective correctness) are asserted at the API
  level via the student's OWN captured access token (staleTime-immune); the in-app *render* read is
  a final pass after the list has aged past staleTime (a focus nudge forces the stale refetch). Minor
  product wart (submit → list not refreshed); noted, not separately filed (a background refetch does
  eventually fire).

- **Red phase proven.** Quarantine guards (`quarantine.test.ts`) went RED by missing-module (TS2307
  + vitest collection fail) before `quarantine.ts` existed, then green (14/14). The money-path spec's
  red was the TS2307 on the not-yet-existing `tests/e2e/money-path/` module (the dir did not exist
  pre-story); now green. The money-path spec is a smoke over already-shipped features, so there is
  only a compile red — no behavioral red to hunt (AC9).

### Completion Notes

- **Validated here:** `tsc -b` clean (exit 0, covers `src` + `tests/e2e`); `npx vitest run tests/e2e/`
  green (21/21 — quarantine 14 + the three R-11-3 proofs un-regressed); `npm run lint` 0 errors
  (5 pre-existing warnings in `features/questions`, untouched); Go `go build ./...` + `go vet` clean;
  `playwright test --list --project=money-path` collects both specs.
- **LIVE GREEN — run locally against the real seeded stack (2026-10-14).** The money-path journey
  PASSES end to end: `✓ 11-5a — deterministic money path … (32.4s)`, mutation correctly skipped
  (`1 passed, 1 skipped`). Stack: Postgres (docker) + `classlite_dev` migrated to HEAD + `scripts/seed.sh`
  + the Go API on :8080 (`APP_ENV=development`, `COOKIE_DOMAIN=.classlite.localhost`,
  `CORS_ORIGINS=http://my.classlite.localhost:5173,…`, **no `GEMINI_API_KEY`**) + the built Vite
  preview via `MONEY_PATH_PREVIEW=1 npx playwright test --project=money-path --workers=1`. The dev
  mock-R2 sink mounted (API log: "DEV-ONLY mock R2 sink mounted…") and the speaking presign→PUT→confirm
  →playback round-tripped through it. This run shook out THREE real latent bugs (below) that no prior
  test ever reached — exactly the point of the story.
- **Durable mutation proof (AC6) — DEMONSTRATED.** `money-path.mutation.spec.ts` ships committed
  `test.skip`-tagged. Un-skipped against the live stack it went **RED for the right reason**: the
  injected wrong answers released band **2.0**, so `expect(overallBand).toBe(9)` failed `Expected: 9,
  Received: 2`. This proves the AC4 band-correctness oracle genuinely detects garbage (not a
  tautology). Re-check: flip `test.skip`→`test`, `MONEY_PATH_PREVIEW=1 npx playwright test
  --project=money-path --grep @mutation` against a seeded stack. (The CI-job run URL will be pinned
  on the first CI run of the branch.)
- **THREE latent bugs the live smoke caught:**
  1. **FIXED — student speaking upload 403.** `POST /api/uploads/presign` role-gated students via an
     advisory `StorageUsage` check for ALL features → student speaking uploads broken in prod. Fixed
     (Ducdo ruling): advisory check scoped to `feature==knowledge` (`upload_handler.go`). Regression
     test `TestPresign_SpeakingSkipsStaffStorageGate` (speaking 200 / knowledge-control 403) — passes.
  2. **FILED — FU-11-5A-ASSIGN-UI (P1):** no teacher assign-exercise-to-class UI exists.
  3. **FILED — FU-11-5A-SPEAKING-GRADEVIEW (P1):** the student result view drops speaking
     `fluencyCoherence`/`pronunciation` + shows a "grade coming soon" band placeholder for non-writing
     (D6). The smoke's speaking student-view oracle is narrowed to overallBand + audioUrl +
     graded_by-absent (writing still asserts criterionScores verbatim). Plus FU-11-5A-ASSIGN-LIST-STALE
     (P3, list not invalidated on submit → the render pass waits out the 30s staleTime).
- **Token/center gotcha pinned:** `/api/auth/login` mints a CENTER-LESS token; the center claim is
  auto-bound only on `/api/auth/refresh` (`buildAccessToken`, single-membership), so the staff API
  helpers do login→refresh. That auto-bind reads `center_members` UNSCOPED, so it needs a BYPASSRLS DB
  role — local dev + the money-path API run as the superuser `classlite` (matching `.env`); worth
  verifying prod's app-role login center-resolution (possible latent prod concern, out of scope here).
- **Seed-reset observation (not this story's fix):** `scripts/seed.sh` clean-reset cascade does not
  clear `refresh_tokens` / `audit_logs` / `auth_audit_logs`, so on a persistent dev DB that has had
  E2E logins it fails FK-blocked mid-reset (and partially wipes a tenant). Locally worked around by
  truncating those three tables before re-seed. A real seed-reset gap; mention to whoever owns seed.
- **Login budget (AC5):** 3 logins — teacher (one login shared by browser-open-class + authed API via
  `staffApiOverContext`), owner (API, billing), student (browser). 3 × (1 + CI retry ×1) = 6 < burst-8.
- **Speaking fixture + flags (AC2):** `tests/e2e/money-path/fixtures/speaking-fixture.wav` (16 kHz
  mono PCM, ~1.5 s 220 Hz tone, 48 KB). Chromium launched with
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream
  --use-file-for-fake-audio-capture=<fixture>` via the `money-path` project's `launchOptions.args`.
- **No-Gemini oracles (AC3):** `installNoAiGradeGuard` records any `/ai-grade` request and asserts
  none at the end; the CI job runs with NO `GEMINI_API_KEY`; owner `GET /api/billing`
  `usage.aiCredits.available` delta asserted == 0 across the run.
- **Staging-host (AC5 debt 3):** `guardNotProduction({ baseURL })` tripwire runs at the top of the
  spec against the harness `ALLOWED_HOST_BASES` (localhost / *.classlite.localhost /
  *.classlite.app-staging). The real staging/deploy hostname is owned by 11-8a/11-8b — if it differs
  from `classlite.app-staging`, add it to `ALLOWED_HOST_BASES` when 11-8a lands (dated note).
- **SEAM to verify on first live run:** Vite 8/Rolldown `preview.proxy` + `preview.allowedHosts`
  support (added to `vite.config.ts`); listening attempt authored without an audio stimulus (the
  MCQ/gap are answerable without audio — if the shell hard-requires audio for listening, attach a
  stimulus key); the exact `writing-word-count-value` selector not being `'0'` as the autosave-flush
  signal.
- **Quarantine (AC7):** format + assertion-granularity + shrink-only (vs `git show HEAD:` baseline) +
  still-runs shipped with red-first guards; cycle-counter + 2-cycle-expiry explicitly DEFERRED to
  11-6a (`enteredCycle` field ships as metadata). `quarantine.json` ships empty `[]`.
- **Closed/filed:** FU-11-TSC CLOSED (tsc -b in ci-web); FU-11-CI SUPERSEDED (money-path job);
  FU-11-5A-ASSIGN-UI filed (P1).

### Implementation Plan (as executed)

1. Recon (4 parallel reads + 2 agents): harness, seed, CI, backend contracts, attempt/review UIs.
2. Quarantine red guards → `quarantine.ts` + empty `quarantine.json` (green 14/14).
3. Dev mock-R2 sink (Go): `storage_mock.go` SetSinkBase + `mock_r2_sink.go` + `main.go` dev-gated mount.
4. Money-path page objects (`moneyPath.ts`) + spec (`money-path.spec.ts`) + mutation fixture + WAV.
5. Playwright `money-path` project + `vite.config` preview proxy/allowedHosts (AC5).
6. `ci-web.yml` money-path job + trigger paths + `tsc -b` (AC6).
7. Dual-rendered-text convention doc + `onboarding-persona-center.spec.ts` fix (AC8).
8. Gates + deferred-work updates + these notes (AC9).

## File List

### Added
- `classlite-web/tests/e2e/lib/quarantine.ts` — quarantine mechanism (load/validate/shrink-only/still-runs).
- `classlite-web/tests/e2e/lib/quarantine.test.ts` — red-first vitest guards (AC7).
- `classlite-web/tests/e2e/quarantine.json` — empty assertion-level allowlist.
- `classlite-web/tests/e2e/money-path/moneyPath.ts` — page objects + authed-API + exercise/grade/result helpers.
- `classlite-web/tests/e2e/money-path/money-path.spec.ts` — THE deterministic money-path journey (AC1–4).
- `classlite-web/tests/e2e/money-path/money-path.mutation.spec.ts` — committed `test.skip` mutation fixture (AC6).
- `classlite-web/tests/e2e/money-path/fixtures/speaking-fixture.wav` — committed speaking audio fixture (AC2).
- `classlite-api/internal/handler/mock_r2_sink.go` — dev-only presigned-PUT sink (AC2 ruling).

### Modified
- `classlite-api/internal/service/storage_mock.go` — `SetSinkBase` + sink-aware `Presign` (dev-only).
- `classlite-api/cmd/api/main.go` — concrete mock handle + dev-gated mount of `PUT /api/__mock_r2/{key...}`.
- `classlite-api/internal/handler/upload_handler.go` — **bug fix**: advisory storage pre-check scoped to `feature==knowledge` (students can presign speaking audio).
- `classlite-api/internal/handler/upload_handler_test.go` — regression test `TestPresign_SpeakingSkipsStaffStorageGate`.
- `classlite-web/playwright.config.ts` — `money-path` project (project-scoped retries, no setup dep, fake-media flags) + preview webServer gate.
- `classlite-web/vite.config.ts` — `preview.proxy` + `preview.allowedHosts` for the built-preview lane (AC5).
- `classlite-web/e2e/onboarding-persona-center.spec.ts` — scope the Auto-save assertion to the visible node (AC8 proof).
- `.github/workflows/ci-web.yml` — new `money-path` job; trigger paths +`classlite-api/**`/`migrations/**`/`seed.sh`; `tsc --noEmit`→`tsc -b`.
- `docs/bmad-story-conventions.md` — dual-rendered-text query convention (AC8).
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-11-TSC closed, FU-11-CI superseded, FU-11-5A-ASSIGN-UI filed.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 11-5a → in-progress → review.

### Deleted
- none.

---

## Code review (2026-10-14, bmad-code-review — Amelia)

3 adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor, Opus 4.8) over the working tree vs baseline 1d6c7fb. Triage: 4 decision-needed, 14 patch (incl. the 3 decision-derived), 1 defer, 7 dismissed. Ducdo rulings: ①AC4=B (fix full feature now) · ②AC6=2a (accept local-green; pin CI-run URL on first push) · ③storage=3b (decouple) · ④mock-sink=4b (harden). **All 14 patches APPLIED.**

### Decision-derived patches
- **AC4 speaking grade feature (B) — closes FU-11-5A-SPEAKING-GRADEVIEW.** Backend student result now passes `grade.criterionScores`/`comments` through as stored JSONB VERBATIM (skill-agnostic, mirrors the 6.3a teacher read): `attempt_handler.go` `studentGradeViewResponse` fields → `json.RawMessage` (from `res.Grade.ScoresRaw`/`CommentsRaw`, `{}`/`[]` fallbacks); dead writing-only `criterionScoresResponse`/`criterionScoresToResponse` deleted from `grading_handler.go`. `api.yaml` `StudentGradeView.criterionScores`→`oneOf[CriterionScores,SpeakingCriterionScores]`, `comments`→`oneOf[AnchoredComment,TimestampedComment]`; codegen regenerated (`client.ts`). FE: net-new `SpeakingGradeBlock.tsx` (band ring + 4 speaking criteria + feedback + late-penalty + ack) wired into `SubmissionReviewShell` for `skill==='speaking'`; `GradeComingSoon` now only covers still-deferred objective/quiz grades; union narrowed via `isWritingScores`/`isSpeakingScores` type-guards in `gradeComments.ts`; `prepareComments` filters anchored. i18n `submissionReview.grade.ackSpeaking` (en+vi). D6 test split (speaking → asserts the block; reading → stays coming-soon). money-path smoke asserts speaking `criterionScores` VERBATIM + the speaking band-block render.
- **Storage pre-check decouple (3b).** New `service.FeatureCountsTowardStorage(feature)` predicate (true only for `knowledge` today); `upload_handler.go` gates the advisory pre-check on it instead of `== FeatureKnowledge` — a future storage-counted feature keeps the check automatically. `TestPresign_SpeakingSkipsStaffStorageGate` still green.
- **Mock-R2 sink defense-in-depth (4b).** New `ENABLE_DEV_MOCK_R2_SINK` config flag — a THIRD independent gate (APP_ENV=development AND no-R2 AND this opt-in) so an accidental prod-as-development boot cannot expose the unauthenticated PUT sink. `ci-web.yml` money-path job sets it `true`. **DEV NOTE: a LOCAL seeded money-path run now also needs `ENABLE_DEV_MOCK_R2_SINK=true`.**

### Test/infra patches
- **quarantine.ts (P1–P5, fork):** shrink-only guard distinguishes genuine first-landing from any other git failure (fails loud) + test skips-with-reason; `entryKey` → `JSON.stringify([spec,assertion])` (collision-safe); committed-baseline parse wrapped (friendly error); empty/0-byte json → `[]`; granularity trims (whitespace assertion rejected).
- **mock_r2_sink.go (P9):** sink threads the request `Content-Type` through new `SeedObjectWithContentType` (mirrors R2; `SeedObject` kept, delegates — no test-caller breakage).
- **moneyPath.ts (P6):** `resolveActiveClassId` fails fast when the `SEED_FAKE_` marker is absent (dropped the `?? active[0]` arbitrary-class fallback).
- **money-path.spec.ts (P7/P8/P10/P11):** credit oracle asserts `r.ok()` on both reads + `available` is a number (no vacuous pass); speaking record waits on the `speaking-elapsed` timer advancing + asserts a non-empty preview src (no magic 1200ms); nav clicks scoped to `sidebar-nav-primary` (no `.first()`); no-`/ai-grade` guard installed on the teacher page too.

### Deferred (1)
- Preview `allowedHosts`/`port` hardcoded vs overridable `BASE_URL_DASHBOARD` → `deferred-work.md` (latent staging-host config coupling).

### Gates (this review)
tsc -b clean · vitest: SubmissionReviewGraded (incl. new speaking-grade test) + quarantine guards (49 pass/1 skip) + full submission-review (87 pass) + R-11-3 proofs un-regressed · eslint 0 errors · go build + go vet ./... clean · DB-backed handler/service tests (submission-review, upload, presign, speaking, storage) green incl. `TestPresign_SpeakingSkipsStaffStorageGate`.

### VERIFIED LIVE (post-review, 2026-10-14)
The changed deploy-gating money-path spec was run GREEN end-to-end against the real seeded stack (Postgres `classlite_test` + seed + Go API on :8080, `ENABLE_DEV_MOCK_R2_SINK=true`, no `GEMINI_API_KEY`, built Vite preview): **`✓ money-path.spec.ts … (32.7s) — 1 passed, 1 skipped`**. The AC4 additions all held live: speaking `criterionScores` round-trips VERBATIM to the student result, the `SpeakingGradeBlock` renders (band + 4 speaking criteria), and the "coming soon" placeholder is gone for speaking. **Gate still BITES:** un-skipping the mutation fixture → RED for the right reason (`expect(overallBand).toBe(9)` → received `2` — a wrong answer cannot release the all-correct band; oracle, not tautology). Fixture reverted to `test.skip`.

**LOCAL-RUN GOTCHA (new, important):** the API's login center-resolution heuristic (`auth_login.go:381` `buildAccessToken`) runs an UNSCOPED `SELECT COUNT(*) FROM center_members` and only emits a center when count==1. `center_members` is RLS-guarded, so this read requires a DB role that **bypasses RLS**. `.env`'s `DATABASE_URL` uses the superuser `classlite` (BYPASSRLS=t) — correct. Running the money-path API as the non-bypass `classlite_app` role returns count 0 → the token carries no center → every authed staff call 403s `CENTER_REQUIRED` (fails at `resolveActiveClassId`). So a local money-path run MUST use the superuser `DATABASE_URL` (as `.env` does), not the app role. (First run of this review hit exactly that and was fixed by repointing to the superuser role — not a code defect; untouched by the review patches.)

### OUTSTANDING (AC6 2a — the one push-time item)
Local LIVE-green satisfies the 2a acceptance ("accept local-green for now"). The remaining action is push-time: trigger the ci-web money-path job on the branch and pin its CI-run URL here alongside the mutation diff (the mutation RED is reproducible on demand per above).
