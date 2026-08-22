---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
generationMode: 'ai-generation'
lastSaved: '2026-08-21'
storyId: '6.3a'
storyKey: '6-3a-speaking-grading-manual'
storyFile: '_bmad-output/implementation-artifacts/6-3a-speaking-grading-manual.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-6-3a-speaking-grading-manual.md'
generatedTestFiles:
  - 'classlite-api/internal/service/grading/speaking_grading_atdd_test.go'
  - 'classlite-api/internal/test/speaking_grading_atdd_test.go'
  - 'classlite-api/internal/test/speaking_audio_authz_atdd_test.go'
  - 'classlite-api/internal/handler/speaking_grade_handler_atdd_test.go'
  - 'classlite-web/src/components/domain/__tests__/computePeaks.test.ts'
  - 'classlite-web/src/components/domain/__tests__/AudioWaveformPlayer.test.tsx'
  - 'classlite-web/src/features/grading/__tests__/SpeakingGradingPage.test.tsx'
  - 'classlite-web/src/features/grading/lib/__tests__/speakingOverallBand.test.ts'
  - 'classlite-web/src/features/grading/lib/__tests__/speakingGradingDraft.test.ts'
  - 'classlite-web/src/features/grading/__tests__/story-6-3a-i18n.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/6-3a-speaking-grading-manual.md'
  - 'classlite-api/internal/test/grading_service_test.go'
  - 'classlite-api/internal/test/grades_rls_test.go'
  - 'classlite-api/internal/service/storage_presign_owned_test.go'
  - 'classlite-api/internal/test/story_6_2a_helpers.go'
  - 'classlite-web/src/features/grading/__tests__/WritingGradingPage.test.tsx'
  - 'classlite-web/src/features/grading/lib/__tests__/computeOverallBand.test.ts'
  - 'classlite-web/src/features/grading/__tests__/story-6-2b-i18n.test.ts'
---

# ATDD Checklist — Story 6.3a (Speaking Grading — Manual)

## Step 1 — Preflight & Context

**Stack:** fullstack (Go API `classlite-api` + React 19 `classlite-web`).
**Frameworks:** Go `testing` over real-DB tx harness (`test.SetupDB`, RLS enforced under `classlite_app`); Vitest + MSW + jsdom; Playwright present.
**Gate:** WF-8 HARD ATDD GATE (risk 6) — red-first MANDATORY before in-progress.

### RED-first scope (maps to register risk ≥6)
- **R1=9** GradeSpeaking cross-tenant grade **read + write** isolation (BE)
- **R9-novel** teacher-audio authz on BOTH surfaces (grading-read presign + refresh route): same-tenant **WRONG-teacher → 403 + zero-mint** (BE)
- **SEC-7** client cannot force the skill branch (speaking submission + writing body → 409, never persists) (BE)
- Writing-path regression guard; immutability reuse + revise happy-path; `NormalizeTimestampComments` lenient bound + degenerate duration; band off-grid → 422 (BE)
- FE: MSW three-state (labeled skeleton / player+bands / 404→re-record vs transient→inline-retry); `computePeaks` pure-fn; `vi.stubGlobal('AudioContext')` + `getContext` + `getBoundingClientRect`; pin-time correct at 2×; discriminated draft; queue arrow arbitration; keyboard seek/pin; i18n parity; axe; desktop-only; student-result-shows-no-teacher-controls

### Discharge-by-inheritance (do NOT re-seed)
- R9 prefix-guard **primitive** → `classlite-api/internal/service/storage_presign_owned_test.go` (5-5a)
- R16 immutability **trigger** → `classlite-api/internal/test/submission_immutable_trigger_test.go` + `grades_rls_test.go` (6.1)
- R3=9 async worker → **6-3b** (carried forward, NOT in 6-3a)

### RED conventions (verified)
- BE: build-tag `//go:build atdd_red_phase` — file excluded from `go test ./...`; `go test -tags=atdd_red_phase ./...` fails to compile until seams land.
- FE: `.test.tsx` under `__tests__/`; MSW-only HTTP seam; suites reference not-yet-existing modules so `tsc -b` / vitest go red until implemented.

### Mirror anchors (verified against source)
- BE authz-403: `grading_service_test.go::TestGradeWriting_TeacherOfOtherClass_403_ZeroSideEffects`
- BE cross-tenant: `grades_rls_test.go::TestRLS_Grades_CrossTenant{Read,InsertRejected}`
- BE env: `setupGradingEnv`/`gradingEnv` (ownerTC/otherTeacherTC/studentTC)
- BE helper style: `story_6_2a_helpers.go::SeedWritingSubmissionForTenant` (exported, raw-SQL seeders)
- FE view/MSW: `WritingGradingPage.test.tsx::gradingView()`
- FE band math: `computeOverallBand.test.ts` eight-fraction table
- FE i18n: `story-6-2b-i18n.test.ts` closed-literal + prefix ratchet

## Step 2 — Generation Mode
**AI Generation** (both layers). BE is always AI-gen; FE recording is moot — the deliverable is red-first scaffolds against not-yet-existing modules (`AudioWaveformPlayer`, `SpeakingGradingPage`, twinned band math), so there is no live UI to snapshot.

## Step 3 — Test Strategy (AC → level → priority)

Levels chosen lowest-first (unit > integration > component); no E2E in the red-first gate (Playwright journey deferred to `/bmad-tea TA 6-3a`).

| AC | Scenario | Level | Priority | Risk | File |
|----|----------|-------|----------|------|------|
| 5 | `ValidateSpeakingCriterionScores` off-grid/out-of-range → error; valid 0.5-grid → ok | BE unit | P1 | — | `grading/speaking_grading_atdd_test.go` |
| 4/5 | `overallBandFromFour` eight-fraction parity w/ writing scorer | BE unit | P1 | — | `grading/speaking_grading_atdd_test.go` |
| 7 | `NormalizeTimestampComments` — **persisted<maxPin KEEPS pin**; negative→null; >bound+1s→null; null stays general; demote-not-drop | BE unit | **P0** | R (D4 divergence) | `grading/speaking_grading_atdd_test.go` |
| 7 | `speakingDurationMsFromContent` — absent/0/neg→fallback; fractional rounds not truncates | BE unit | P1 | — | `grading/speaking_grading_atdd_test.go` |
| 8/5 | `GradeSpeaking` happy path: server-authoritative band, flip submitted→graded, outbox, comments persisted | BE integ | P1 | — | `test/speaking_grading_atdd_test.go` |
| 10/8 | **R1 cross-tenant grade READ + WRITE isolation** (grades + current_grades leak-free; spoofed center_id rejected) | BE integ | **P0** | **R1=9** | `test/speaking_grading_atdd_test.go` |
| 8/10 | Same-tenant **WRONG-teacher → 403 + ZERO side effects** (no outbox, submission untouched) | BE integ | **P0** | R1 | `test/speaking_grading_atdd_test.go` |
| 5/11 | **SEC-7** client cannot force branch: speaking submission + writing-shaped body → 409 `SUBMISSION_SKILL_MISMATCH`, nothing persists | BE integ | **P0** | SEC-7 | `test/speaking_grading_atdd_test.go` |
| 11 | Writing-path **regression**: writing submission + speaking body → 409; writing grade unbroken | BE integ | **P0** | regression | `test/speaking_grading_atdd_test.go` |
| 8 | Immutability reuse: re-grade released speaking → P0001 → 409 (inherited trigger) | BE integ | P1 | R16 (inherited) | `test/speaking_grading_atdd_test.go` |
| 8 | Revise happy-path: `ReviseSpeakingGrade` → version=2 row, prior retained | BE integ | P1 | — | `test/speaking_grading_atdd_test.go` |
| 5 | Band off-grid via service → 422 (twin validator) | BE integ | P1 | — | `test/speaking_grading_atdd_test.go` |
| 10 | Grading read: `audioUrl` presigned (5-min, **outside tx**) + `audioStatus` hasAudio\|none; owner teacher gets URL | BE integ | P1 | R9 | `test/speaking_audio_authz_atdd_test.go` |
| 10 | **R9-novel:** grading-read presign — same-tenant WRONG-teacher → 403 + **zero mint** (`PresignGetKeys`==0) | BE integ | **P0** | **R9** | `test/speaking_audio_authz_atdd_test.go` |
| 2/10 | **R9-novel:** teacher audio-refresh route — same-tenant WRONG-teacher → 403 + **zero mint**; owner → `{url}` | BE integ | **P0** | **R9** | `test/speaking_audio_authz_atdd_test.go` |
| 1 | `computePeaks` pure downsample: bucket count, bounds, silence→~0, empty input | FE unit | P1 | — | `domain/__tests__/computePeaks.test.ts` |
| 1/6/14 | Player: render (canvas getContext stubbed), play/pause, **seek-only** on waveform, speed 0.5/1/1.5/2×, **Pin-here (btn+`P`) at currentTime — speed-INDEPENDENT (pin at 2×)**, drag/delete/edit, card→seek, keyboard ±5s/±30s/Space/`P`, `aria-live` readout | FE component | **P0** | pin-time | `domain/__tests__/AudioWaveformPlayer.test.tsx` |
| 3 | Missing/corrupt: 404 (after 1 re-sign) → "Ask student to re-record"; `decodeAudioData` throw → same; **transient 5xx/network → inline retry, NOT re-record** | FE component | **P0** | D6 false-positive | `domain/__tests__/AudioWaveformPlayer.test.tsx` |
| 14 | axe clean on player + composer | FE component | P1 | — | `domain/__tests__/AudioWaveformPlayer.test.tsx` |
| 12/4/9/11 | MSW three-state (labeled "Preparing audio…" skeleton / player+bands / error), 2×2 bands + client overall, **timeline-shaped rail** (sort by timestampMs, source:'teacher', null-zoned), queue prev/next + **arrow arbitration**, release/revise, `buildSpeakingGradeInput` strips client-only, **GradingRoute dispatch** speaking↔writing, desktop-only, **student result shows NO teacher controls** | FE component | **P0** | dispatch/negative | `grading/__tests__/SpeakingGradingPage.test.tsx` |
| 4 | Twinned `computeSpeakingOverallBand` over `SPEAKING_CRITERION_KEYS` — same eight-fraction table | FE unit | P1 | — | `grading/lib/__tests__/speakingOverallBand.test.ts` |
| 6/7 | Discriminated speaking draft (localStorage): speaking `criterion` union + `timestampMs`, null=general | FE unit | P1 | — | `grading/lib/__tests__/speakingGradingDraft.test.ts` |
| 13 | i18n parity: `STORY_6_3A` closed-literal + prefix ratchet (`speakingGrading.*`) in en AND vi; pin-tip copy fixed | FE unit | P1 | — | `grading/__tests__/story-6-3a-i18n.test.ts` |

### Red-phase guarantee
- **BE:** all three files carry `//go:build atdd_red_phase` → excluded from `go test ./...`; `go test -tags=atdd_red_phase ./...` **fails to compile** (references `GradeSpeaking`, `ReviseSpeakingGrade`, `.WithStorage`, `ValidateSpeakingCriterionScores`, `overallBandFromFour`, `NormalizeTimestampComments`, `speakingDurationMsFromContent`, teacher-audio service/route — none exist yet).
- **FE:** all suites import not-yet-existing modules → `tsc -b` + `vitest` go **red** until implemented.
- **Discharge-by-inheritance (NOT re-seeded):** R9 prefix-guard primitive = `storage_presign_owned_test.go`; R16 trigger = `submission_immutable_trigger_test.go`/`grades_rls_test.go`. R3=9 worker = 6-3b.

### Verified seams (dev reconciles HERE — one place)
- `service.NewGradingService(db, audit, clk).WithStorage(mock)` ← **new** `.WithStorage` builder (D5)
- `(*GradingService).GradeSpeaking(ctx, tc, submissionID, service.SpeakingGradeWriteInput) (*GradeView, error)` and `ReviseSpeakingGrade(...)`
- `service.SpeakingGradeWriteInput{ Scores grading.SpeakingCriterionScores; Comments []grading.TimestampedComment; Feedback *string; Reason string }`
- `grading.SpeakingCriterionScores{ FluencyCoherence, LexicalResource, GrammaticalRange, Pronunciation float64 }`
- `grading.ValidateSpeakingCriterionScores(SpeakingCriterionScores) error`; `grading.OverallBandFromFour([4]float64) grading.Band` (exported core, D1)
- `grading.NormalizeTimestampComments(cs []grading.TimestampedComment, durationMs int) []grading.TimestampedComment`; `grading.SpeakingDurationMsFromContent([]byte) int`
- `grading.TimestampedComment{ Type, Criterion string; TimestampMs *int; Text string }`
- Teacher audio: `(*GradingService).GetSubmissionForGrading` populates `TeacherGradingView.AudioUrl *string` + `AudioStatus string` (`"hasAudio"|"none"`); refresh service `(*GradingService).GetTeacherSubmissionAudioURL(ctx, tc, classID, assignmentID, submissionID) (string, error)` (teacher-of-class authz) + route `GET /api/classes/{classId}/grading/{assignmentId}/{submissionId}/audio`
- Errors reused: `service.ForbiddenError` (403), validation → 422, `SUBMISSION_SKILL_MISMATCH` 409 (new `service.ConflictError`-style), `GRADE_REVISE_CONFLICT`; mock via `service.NewMockStorageService()` (`.PresignGetKeys`, `.LastPresignGetExpiry`, `KeyPrefixMismatchError`)
- FE: `@/components/domain/AudioWaveformPlayer`, `@/components/domain/computePeaks`, `@/features/grading/SpeakingGradingPage`, `@/features/grading/GradingRoute`, `@/features/grading/lib/speakingOverallBand` (`SPEAKING_CRITERION_KEYS`, `computeSpeakingOverallBand`), `@/features/grading/lib/speakingGradingDraft`

## Step 4/4C — Generation & Aggregation (RED-phase verified)

**Convention deviation (intentional, ratified pattern):** this repo's established ATDD
RED convention — verified in 5-5a (`storage_presign_owned_test.go`) and 6-2a — is
**compile-fail / import-fail red**, not `test.skip()`. A skipped test is inert, not
red; for a WF-8 hard gate the compile-time red the repo already uses is stronger.
Applied that convention instead of the skill's generic `test.skip()` template.

### Files generated (10)
**BE (`//go:build atdd_red_phase`):**
1. `classlite-api/internal/service/grading/speaking_grading_atdd_test.go` — unit: validator twin, `OverallBandFromFour` parity, `NormalizeTimestampComments` lenient bound (persisted<pin KEEPS), degenerate duration, `SpeakingDurationMsFromContent`.
2. `classlite-api/internal/test/speaking_grading_atdd_test.go` — integ: happy/server-band, **R1 cross-tenant R+W**, **wrong-teacher 403 zero-effects**, SEC-7 both-direction branch guards, off-grid 422, plausible-pin-kept, immutability, revise.
3. `classlite-api/internal/test/speaking_audio_authz_atdd_test.go` — integ: **R9 grading-read + refresh-route same-tenant-wrong-teacher 403 + ZERO mint**, hasAudio/none, owner mints 5-min.
4. `classlite-api/internal/handler/speaking_grade_handler_atdd_test.go` — HTTP: **SEC-7 decode-order 409 `SUBMISSION_SKILL_MISMATCH`** (D2 rework), regression, nothing-persisted.

**FE (import/typecheck red):**
5. `.../components/domain/__tests__/computePeaks.test.ts` — pure downsample.
6. `.../components/domain/__tests__/AudioWaveformPlayer.test.tsx` — `vi.stubGlobal('AudioContext')` + getContext + getBoundingClientRect; **pin-at-2× speed-independent**; keyboard ±5/±30/Space/P; 404→re-record vs transient→retry; axe.
7. `.../features/grading/__tests__/SpeakingGradingPage.test.tsx` — MSW L/E/E, GradingRoute dispatch, 2×2 bands, timeline rail (D9), queue nav.
8. `.../features/grading/lib/__tests__/speakingOverallBand.test.ts` — twinned band math, 8-fraction table.
9. `.../features/grading/lib/__tests__/speakingGradingDraft.test.ts` — discriminated draft, no cross-skill clobber.
10. `.../features/grading/__tests__/story-6-3a-i18n.test.ts` — `STORY_6_3A` parity + prefix ratchet + pin-tip copy fix.

### RED proof (run at generation time)
- `cd classlite-api && go build ./...` → **GREEN** (tagged files excluded from normal build).
- `go vet -tags=atdd_red_phase ./internal/service/grading/ ./internal/test/ ./internal/handler/` → **RED**, every error a documented missing seam (`SpeakingCriterionScores`, `AudioUrl`/`AudioStatus`, `GetTeacherSubmissionAudioURL`, `GradeSpeaking`, `.WithStorage`, `SeedSpeakingSubmissionOnPool`, …). No error against an existing helper.
- `cd classlite-web && npx tsc -b` → **RED**, errors only TS2307/TS2305 for the intended-missing modules (`AudioWaveformPlayer`, `computePeaks`, `speakingOverallBand`, `speakingGradingDraft`, `GradingRoute`, `SpeakingGradingPage`).
- `npx vitest run .../story-6-3a-i18n.test.ts` → **RED** by assertion (missing `speakingGrading.*` keys in en/vi).

## Step 5 — Validate & Complete → handoff to `/bmad-dev-story 6-3a`

**Dev turns each RED green by landing the documented seams (one reconcile point — see the "Verified seams" list above), then:**
- BE: remove `//go:build atdd_red_phase` per file as its contract lands; final gate `go test -race ./internal/{service,grading,test,handler,storage}/...` (untagged — the ex-tagged files now compile) must be GREEN.
- FE: `tsc -b` + `vitest` green; add `speakingGrading.*` keys to en.json AND vi.json; `codegen.sh` last.

**WF-8 gate satisfied when:** files 2 (R1 + SEC-7 service) + 3 (R9 both surfaces) + 4 (SEC-7 handler 409) are GREEN on the branch, having first been demonstrably RED. Inheritance (not re-tested): R9-primitive (5-5a), R16-trigger (6.1). R3=9 carried to 6-3b.
