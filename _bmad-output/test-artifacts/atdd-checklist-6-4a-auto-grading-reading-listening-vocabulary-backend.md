---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-08-26'
storyId: '6.4a'
storyKey: '6-4a-auto-grading-reading-listening-vocabulary-backend'
storyFile: _bmad-output/implementation-artifacts/6-4a-auto-grading-reading-listening-vocabulary-backend.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-6-4a-auto-grading-reading-listening-vocabulary-backend.md
detectedStack: backend
generationMode: ai-generation
generatedTestFiles:
  - classlite-api/internal/service/grading/autograde_engine_atdd_test.go
  - classlite-api/internal/test/auto_grade_results_rls_atdd_test.go
  - classlite-api/internal/test/auto_grade_submit_hook_atdd_test.go
  - classlite-api/internal/test/auto_grade_override_release_atdd_test.go
inputDocuments:
  - _bmad-output/implementation-artifacts/6-4a-auto-grading-reading-listening-vocabulary-backend.md
  - _bmad-output/project-context.md
  - docs/project-context.md
  - classlite-api/internal/test/speaking_grading_atdd_test.go (red-convention precedent)
  - classlite-api/internal/test/submission_immutable_trigger_test.go (P0001 twin precedent)
  - classlite-api/internal/test/grades_rls_test.go (RLS grid precedent)
  - classlite-api/internal/test/grading_concurrency_test.go (raw-pool race precedent)
  - classlite-api/internal/store/exercise_content.go (answer-key structs)
knowledgeFragments:
  - risk-governance
  - test-levels-framework
  - test-priorities-matrix
  - test-quality
  - confidence-gate
  - data-factories
---

# ATDD Red-Phase Checklist — Story 6.4a (Auto-Grading, objective sections — Backend)

> **WF-8 HARD GATE (R16 = 6).** These `//go:build atdd_red_phase` reds MUST be on the
> branch BEFORE the story transitions to `in-progress`. Convention:
> tagged-compile-fail (`reference_atdd_red_convention`), not `t.Skip`. E2E rides 6-4b.

## 1. Preflight & Context

- **Stack:** backend (Go 1.25, `classlite-api/go.mod`). Auto-detected.
- **Framework:** stdlib `testing` + real DB via `test.SetupDB(t)` (tx-wrapped, RLS
  enforced under `classlite_app`). Concurrency via `test.SetupRawPool` + `SuperuserPool`.
- **Red convention verified against 4 shipped precedents** (`speaking_grading_atdd_test.go`,
  `submission_immutable_trigger_test.go`, `grades_rls_test.go`, `grading_concurrency_test.go`).
- **Mock seams honored:** pure engine = unit seam (TEST-BE-5 N/A — auto-grade is not a
  worker); store/service = real DB in tx (TEST-BE-1/2); RLS adversarial at the store level.

## 2. Generation Mode

**AI generation** (backend → no browser recording). Generated directly rather than via
the generic `test.skip()` JS subagents: the project's Go build-tag convention
(`reference_atdd_red_convention`) OVERRIDES the skill's default red form, and the reds
must mirror byte-for-byte Go idioms a generic worker would mangle.

## 3. Test Strategy — AC → level / priority / red

| AC | Scenario | Level | Pri | Red test | File |
|----|----------|-------|-----|----------|------|
| 6/D6 | Frozen golden classifier table (14 rows incl. len-boundaries, diacritics-only, blank) | Unit (pure) | P0 | `TestClassify_FrozenGoldenTable_ATDD` | engine |
| 5 | Choice types never `needs_review` | Unit | P0 | `TestClassify_ChoiceTypes_NeverNeedsReview_ATDD` | engine |
| 5 | Union match `{correctAnswer} ∪ variants` | Unit | P1 | `TestClassify_UnionMatchAcceptedVariants_ATDD` | engine |
| 4/D5 | Normalize: hyphen+ws always-on, case gated | Unit | P0 | `TestNormalize_*_ATDD` (×2) | engine |
| 7/D6 | Scorer EXCLUDES unresolved `needs_review` from denom | Unit | P0 | `TestGrade_ScorerExcludesUnresolvedNeedsReviewFromDenominator_ATDD` | engine |
| 7/D7 | Denominator=0 guard → 0% | Unit | P0 | `TestGrade_AllNeedsReview_ZeroDenominatorGuard_ATDD` | engine |
| 2/4/5 | Colon-handle parse + per-answer marks + self-flag surfaced | Unit | P0 | `TestGrade_ColonHandleParse_PerAnswerMarks_ATDD` | engine |
| 2/D6 | Unanswered handle → wrong (never needs_review) | Unit | P1 | `TestGrade_UnansweredHandle_Wrong_ATDD` | engine |
| 3/D13 | Engine returns nil for zero-question content | Unit | P0 | `TestGrade_ZeroQuestionContent_ReturnsNil_ATDD` | engine |
| D3 | `HasGradableGroups` by presence not skill | Unit | P1 | `TestHasGradableGroups_ByPresenceNotSkill_ATDD` | engine |
| 7/D7 | Band computed-only: deterministic + monotonic | Unit | P1 | `TestPercentageToBand_DeterministicAndMonotonic_ATDD` | engine |
| **3/D13** | **Submit STILL COMMITS when engine PANICS** (non-negotiable) | Integration | **P0** | `TestAutoGradeSubmit_EnginePanics_SubmitStillCommits_ATDD` | submit-hook |
| 3/D13 | Submit still commits when engine ERRORS | Integration | P0 | `TestAutoGradeSubmit_EngineErrors_SubmitStillCommits_ATDD` | submit-hook |
| 1/2 | Objective submit → exactly 1 working row + cached score | Integration | P0 | `TestAutoGradeSubmit_ObjectiveSubmission_WritesOneRow_ATDD` | submit-hook |
| 1/D3 | Writing submit → 0 working rows (unaffected) | Integration | P0 | `TestAutoGradeSubmit_WritingSubmission_NoRow_ATDD` | submit-hook |
| 9 | Cross-tenant READ isolation | Store/RLS | P0 | `TestRLS_AutoGradeResults_CrossTenantRead_ATDD` | rls |
| 9 | Cross-tenant INSERT rejected (WITH CHECK) | Store/RLS | P0 | `TestRLS_AutoGradeResults_CrossTenantInsertRejected_ATDD` | rls |
| 9 | Cross-tenant UPDATE no-mutation (re-read control) | Store/RLS | P0 | `TestRLS_AutoGradeResults_CrossTenantUpdate_NoMutation_ATDD` | rls |
| 9 | Null-tenant fail-closed | Store/RLS | P0 | `TestRLS_AutoGradeResults_NullTenant_FailClosed_ATDD` | rls |
| 10(a) | UPDATE after release → P0001, data unchanged | Store/trigger | P0 | `TestTrigger_AutoGradeResults_UpdateAfterRelease_Raises_DataUnchanged_ATDD` | rls |
| 10(b) | UPDATE before release SUCCEEDS (positive twin) | Store/trigger | P0 | `TestTrigger_AutoGradeResults_UpdateBeforeRelease_Succeeds_ATDD` | rls |
| 8 | submission_id FK ON DELETE RESTRICT | Store | P1 | `TestFK_AutoGradeResults_SubmissionDeleteRestricted_ATDD` | rls |
| 13 | Override recompute (needs_review→correct) | Service | P0 | `TestAutoGradeOverride_RecomputeAndAudit_ATDD` | override-release |
| 14 | `autograde.override` audit row | Service | P0 | (same test) | override-release |
| 15 | Override on writing → 409 NOT_OBJECTIVE | Service | P1 | `TestAutoGradeOverride_OnWritingSubmission_409_ATDD` | override-release |
| 15 | Override unknown ref → 422 INVALID_QUESTION_REF | Service | P1 | `TestAutoGradeOverride_UnknownQuestionRef_422_ATDD` | override-release |
| 15 | Override after release → 409 ALREADY_RELEASED | Service | P0 | `TestAutoGradeOverride_AfterRelease_409_ATDD` | override-release |
| 16/17/D8 | Release: grade (kind discriminator) + flip + outbox | Service | P0 | `TestAutoGradeRelease_WritesGradeFlipsOutbox_ATDD` | override-release |
| 16/D10 | Unresolved needs_review counts WRONG at release | Service | P0 | `TestAutoGradeRelease_UnresolvedNeedsReviewCountsWrong_ATDD` | override-release |
| 18 | Reader contract (pending→released) + **field-absence leak-guard** | Service | P0 | `TestAutoGradeRelease_StudentReaderContractAndLeakGuard_ATDD` | override-release |
| 19 | Re-release / non-objective / no-working-row guards | Service | P0 | `TestAutoGradeRelease_Guards_ATDD` + `_NoWorkingRow_409_ATDD` | override-release |
| 10(c) | Concurrent release → 1 win / 1 conflict, never 500 | Race | P0 | `TestAutoGradeRelease_ConcurrentRelease_OneWins_ATDD` | override-release |

**AC20 minimum red set — coverage: COMPLETE.** D13 fault-injection ✅ · D9 3-twin
(a/b here, c service-level) ✅ · cross-tenant read+write ✅ · frozen D6 golden table ✅ ·
auto-grade correctness (colon-handle + per-type + normalization) ✅ · override recompute+audit ✅ ·
release grade-write+flip+notify+reader-contract ✅ · AC18 field-absence leak-guard ✅ · objective-only guards ✅.

## 4. Green-phase SEAMS (the reconcile map — one place per file)

**Engine** (`internal/service/grading/autograde.go`, greenfield, D15 pure/storeless):
`Grade()`, `Normalize()`, unexported `classify()`, `PercentageToBand()`, `HasGradableGroups()`;
types `AttemptContent` / `AutoGradeResult` / `AutoGradeAnswer` / `AutoMark` (+ `MarkCorrect/Wrong/NeedsReview`).

**Submit hook** (`internal/service/submission_service.go`): `service.AutoGrader` interface
`GradeOnSubmit(ctx, tx pgx.Tx, tc, submissionID) error`, invoked inside a post-flip SAVEPOINT
(recover panic → rollback-to-savepoint → outer commit); `(*SubmissionService).WithAutoGrade(g)`
builder (mirrors `.WithStorage`); default constructor wires the real auto-grader.

**Override/Release** (`internal/service/auto_grade_service.go`, greenfield):
`NewAutoGradeService(db, audit, clk)`; `.Override(...)`, `.Release(...)`;
`AutoGradeOverrideInput{QuestionRef, Mark}`; `AutoGradeView`; guards via
`model.ConflictError{Code}` / `model.ValidationError`.

**Migrations** (Task 2): `auto_grade_results` (AC8 columns + 4-policy FORCE RLS on
`center_id`); `auto_grade_results_immutable_after_release` trigger (P0001, named message);
partial index `idx_grades_submission_released`.

## 5. Validation

- `go build ./...` and `go vet ./...` (UNtagged) **green** — reds excluded from the main
  suite until green (WF-8 on-branch-but-quarantined).
- `go vet -tags=atdd_red_phase ./internal/service/grading/ ./internal/test/` fails to
  compile **ONLY** on the intended greenfield seams (verified — no accidental errors):
  `AutoMark`, `service.AutoGradeService`, `service.NewAutoGradeService`,
  `service.AutoGradeOverrideInput`, `(*SubmissionService).WithAutoGrade`.
- Confidence-gate respected: the D7 band **table values are NOT fabricated** — the band
  red asserts only structural properties (deterministic, monotonic). Dev finalizes the table.

## Run command (the red gate)

```bash
cd classlite-api
go test -tags=atdd_red_phase ./internal/service/grading/... ./internal/test/... \
  -run 'AutoGrade|Classify|Normalize|Grade_|HasGradableGroups|PercentageToBand|Trigger_AutoGradeResults|RLS_AutoGradeResults|FK_AutoGradeResults'
# Expected NOW: COMPILE FAILURE on the seams above (RED).
# Expected after green: all pass under -race -count=1.
```

## Handoff → BMM dev-story

Dev turns these red. Order (Amelia BLOCK-6): migration → sqlc gen → api.yaml → codegen →
implement engine → submit hook (SAVEPOINT) → override/release service → grading-read
extension → run the reds green. No `t.Parallel()` on the DB-tx tests. Then `/bmad-tea TA`
(P2/P3 expansion) + `/bmad-tea RV` (flake/quality review) per WF-8.
