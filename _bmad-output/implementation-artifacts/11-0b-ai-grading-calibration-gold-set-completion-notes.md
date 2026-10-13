# Story 11-0b: Completion Notes

_Implementation record for [`11-0b-ai-grading-calibration-gold-set.md`](./11-0b-ai-grading-calibration-gold-set.md). Status: **review** (Phase 1 mechanism delivered; held in `review` per DD7 until the authoritative real-data run passes — Phase 2 blocks on Ducdo's dataset assembly, not dev capacity)._

## Dev Agent Record

### Debug Log

- **DD3 seam shape confirmed from code, not assumed.** `GenerationHandler.generate` is UNEXPORTED (only the same-package dispatcher drives the result-capturing path); `ProcessTask` discards the fragment and the shared `internal/test/workers` harness only persists status, never `job.result`. The calibration package lives in a different package, so a thin EXPORTED read-only `GenerateResult` accessor was added to `GradeWritingHandler` (+ the speaking twin) returning exactly what `generate` computes. No `MarkJobComplete` replay inside the shared harness (drift/blast-radius avoided). The serialize→persist→deserialize round-trip is covered by ONE cheap untagged dispatcher test (`calibration_seam_test.go`) comparing the accessor fragment to the persisted `job.result` SEMANTICALLY (jsonb may reorder keys / normalise whitespace, so both are decoded to the typed result before `reflect.DeepEqual`).
- **Task-4b finding (AC2):** `gemini.GenerateRequest` has NO temperature field, and `geminiGenerationConfig` sends only `responseMimeType` + `maxOutputTokens`. The shipped worker therefore sends **no temperature** → Gemini's model default (≈1.0 for `gemini-2.0-flash`) governs run-to-run variance. Recorded as `temperatureNote` in the run harness + in `manual-setup.md`; if AC2 fails at the real run, pinning temperature in the worker is the candidate fix — a grading-behaviour change, a SEPARATE story (out of 11-0b scope per the "grading is frozen" preserve-rule).
- **Spec contradiction escalated + ruled (accuracy gate boundary).** AC1/DD5 say "within `PerCriterionTol (1.0)`, generous (examiners disagree ~0.5)"; AC5's teeth example says "off by exactly 1.0 must FAIL". On the 0.5 grid these cannot both hold. Asked Ducdo → **≤1.0 INCLUSIVE** (AC1/DD5 authoritative; AC5's "1.0 must FAIL" treated as illustrative). Gate = `AbsDelta <= PerCriterionTol`; teeth straddle **1.0-passes / 1.5-fails**. Documented in `assertions_test.go` header so a future reader does not "fix" the operator back to strict-less. Applied the same inclusive reading to the AC2 stability range (AC2 itself states "≤ 1.0").
- **Language check (AC3/AC5 "wrong-language FAILs") with no heavy dependency.** The result structs carry no language field and the product is English-only (DD6). Implemented `matchesLanguage` as a pragmatic, low-false-positive Vietnamese-marker detector (Latin Extended Additional U+1EA0–U+1EF9, đ/ă/ơ/ư, combining tone marks) — flags Vietnamese output against an expected `"en"`. Documented as an English-only-product heuristic, not a general language identifier.
- **AC5 "null-band result FAILs"** works because `model.AIWritingGradeResult.Criteria.*.Band` is value-typed `float64`: a missing/null band deserialises to `0.0`, which fails `grading.ValidateCriterionScores` (0 < MinBand 1.0). The coverage teeth test sets a band to 0.0 to exercise it.
- **Only pre-existing failure:** `TestInbox_MarkAllRead_CallerScoped_ArchivedStaysUnread_ATDD` fails with a duplicate-key on `idx_users_email` (a hardcoded email colliding with DB residue). It fails in isolation, is in an inbox test NOT touched by 11-0b, and is the documented flake (memory + the 11-0a completion both note it as the sole pre-existing fail). The 11-0b seeder uses uuid-randomised emails.

### Completion Notes

**Delivered (Phase 1 — the mechanism, takes the story to `review`):**

- New leaf package `classlite-api/internal/calibration/` — pure files (`goldset.go`, `assertions.go`, `report.go`) depend on `internal/model` + `internal/service/grading` + stdlib ONLY (import discipline, Winston); the test-flavoured imports (`internal/worker`, `internal/test{,/workers}`, real `gemini.NewClient`) live ONLY in the `//go:build calibration` run file + `_test.go` files.
- The four R5 machine assertions as pure exported functions: `BandAccuracy` (per-criterion ≤1.0 hard gate + overall ±0.5 secondary + signed delta / worst-miss / over-score direction), `Stability` (per-criterion range ≤1.0 AND overall population stddev ≤0.25 over 5 regrades), `CriterionCoverage` (reuses `grading.Validate{,Speaking}CriterionScores` + rationale/confidence/language), `FeedbackSafety` (PII value-scan + URL gated; fabricated-citation surfaced as a human-review sample, NEVER a gate — Murat R5).
- `report.go` — structured `Report` + `Markdown()` renderer (per-criterion + overall deltas, MAE per band bucket, worst miss, over-score rate, stability) + `WriteReport(dir,date,md)`; `date` always passed in (never `time.Now()` in the pure package — determinism). `Pass()` is the DONE quality gate (all accuracy pass + coverage clean + safe + set-MAE under the absolute floor + stability pass; empty never passes; transport failures don't affect it — DD10).
- AC5 perturbation boundary-matrix self-test (`assertions_test.go`, UNTAGGED/CI-green): each assertion PASSES on a correct grade + behaves at the threshold on a boundary mutant, and the coverage failures (empty rationale / wrong language / null band / bad confidence) fail INDEPENDENTLY. Plus AC6 loader hash-verify tests (synthetic load + hash-mismatch hard error + real-dir match). `report_test.go` covers the renderer + done-gate.
- DD3 read-only `GenerateResult` accessor on `GradeWritingHandler` + `GradeSpeakingHandler` (no grading-behaviour change) + the cheap untagged dispatcher round-trip test.
- `run_calibration_test.go` (`//go:build calibration`): hash-verify at start → `SetupWorkerHarness` → per writing sample seed (gold essay via the new parametrized seeder) → drive the REAL `gemini.NewClient` through the DD3 accessor → per-criterion + `grading.OverallBandFromFour` → 5-regrade stability → 429/network classified as transport-failure (retry/backoff, distinct exit, never quality-red) → write report. LOUD-SKIP without `GEMINI_API_KEY`/`CALIBRATION_DATASET_DIR`; excluded from the default suite by the tag. Speaking is schema-ready + accessor-ready but its dataset is deferred (DD4).
- Committed synthetic anchors (`testdata/goldset-anchors.json` + 2 content files, no PII/copyright) with correct sha256 hashes; `.gitignore` for the external dataset dir + the report glob.
- Parent-veto template (AC7/DD6 — binary veto + reason, "English-feedback usefulness to a bilingual teacher", names the no-VN-output limitation) + inter-rater overlap template (AC9/DD9) under `_bmad-output/test-artifacts/calibration/`.
- `docs/manual-setup.md` → `## Calibration gold set (Story 11-0b)` (dataset assembly per OQ-11-5, placement, the `-tags=calibration` run command, the pinned tolerances table, temperature note, parent-veto + closing-to-done procedure). FU-11-0B-VN-FEEDBACK + FU-11-0B-SPEAKING-SET filed in `deferred-work.md`.

**NOT delivered (Phase 2 — required for `done`, DD7; blocks on Ducdo, not dev):** the interim published-anchor run, the authoritative bands-4-6 center-banded run within tolerance, the AC9 inter-rater overlap human run, and the AC7 parent-veto on real feedback. These need a real `GEMINI_API_KEY` + the assembled gold set (manual toil tracked in `manual-setup.md`). The story stays in `review` until they pass.

**Deviations / decisions:** (1) accuracy gate ruled ≤1.0 inclusive (Ducdo); (2) a parametrized `SeedWritingSubmissionWithContent` was added to `internal/test/story_6_2a_helpers.go` and the existing `SeedWritingSubmissionForTenant` now delegates to it (behaviour identical — same fixture essay) so the harness could grade real gold essays through the identical seed shape.

### Implementation Plan (summary)

1. Code recon of the shipped grade path (gemini client/mock/config, writing+speaking workers, scorer/validation, dispatcher, worker harness, 6-2a seeder) to pin DD1/DD3 exactly.
2. Task 1: `goldset.go` + synthetic anchors + `.gitignore`.
3. Task 2: `assertions.go` + `report.go` (pure).
4. Task 3: AC5 teeth matrix + AC6 loader tests (UNTAGGED) — green first.
5. Task 4/4b: DD3 accessor on both handlers + cheap dispatcher round-trip test; temperature finding.
6. Task 5: build-tagged real-data run harness (+ parametrized seeder).
7. Task 6/6b: parent-veto + inter-rater templates.
8. Task 7/8: manual-setup section + follow-ups; build/vet/gofmt/test gates.

## File List

### Added
- `classlite-api/internal/calibration/goldset.go` — gold-set schema + hash-verifying loader + synthetic fallback.
- `classlite-api/internal/calibration/assertions.go` — the four R5 assertions + result→map/overall/text extractors + pure helpers.
- `classlite-api/internal/calibration/report.go` — structured `Report` + `Markdown()` + `WriteReport`.
- `classlite-api/internal/calibration/assertions_test.go` — AC5 perturbation teeth matrix + AC6 loader hash-verify (UNTAGGED).
- `classlite-api/internal/calibration/report_test.go` — report renderer + done-gate coverage (UNTAGGED).
- `classlite-api/internal/calibration/run_calibration_test.go` — real-data run harness (`//go:build calibration`, LOUD-SKIP).
- `classlite-api/internal/calibration/testdata/goldset-anchors.json` — synthetic anchor manifest (bands + hashes, no PII/copyright).
- `classlite-api/internal/calibration/testdata/content/anchor-writing-01.txt`, `anchor-writing-02.txt` — synthetic anchor essays.
- `classlite-api/internal/worker/calibration_seam_test.go` — DD3 dispatcher round-trip test (UNTAGGED).
- `_bmad-output/test-artifacts/calibration/parent-veto-template.md` — AC7/DD6 parent-veto artifact.
- `_bmad-output/test-artifacts/calibration/inter-rater-overlap-template.md` — AC9/DD9 overlap artifact.
- `_bmad-output/implementation-artifacts/11-0b-ai-grading-calibration-gold-set-completion-notes.md` — this file.

### Modified
- `classlite-api/internal/worker/ai_grade_writing.go` — added the exported read-only `GenerateResult` accessor (DD3); no grading-behaviour change.
- `classlite-api/internal/worker/ai_grade_speaking.go` — added the exported read-only `GenerateResult` accessor (DD3 speaking twin); no grading-behaviour change.
- `classlite-api/internal/test/story_6_2a_helpers.go` — added `SeedWritingSubmissionWithContent` (parametrized essay); `SeedWritingSubmissionForTenant` now delegates to it (behaviour unchanged).
- `.gitignore` — ignore the external `calibration-dataset/` + `calibration-report-*.md` under the evidence dir (R-11-6; synthetic `testdata/` stays tracked).
- `docs/manual-setup.md` — `## Calibration gold set (Story 11-0b)` section (assembly, run command, tolerances, temperature note, procedures).
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-11-0B-VN-FEEDBACK, FU-11-0B-SPEAKING-SET, FU-11-0B-DONE-GATE.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 11-0b → in-progress → review; `last_updated`.
- `_bmad-output/implementation-artifacts/11-0b-ai-grading-calibration-gold-set.md` — Status, task/DoD-Phase-1 checkboxes, Change Log.

### Deleted
- None.
