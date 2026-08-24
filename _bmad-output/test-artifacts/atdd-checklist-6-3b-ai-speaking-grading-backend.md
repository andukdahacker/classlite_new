---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-08-24'
storyId: '6.3b'
storyKey: '6-3b-ai-speaking-grading-backend'
storyFile: '_bmad-output/implementation-artifacts/6-3b-ai-speaking-grading-backend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-6-3b-ai-speaking-grading-backend.md'
generatedTestFiles:
  - 'classlite-api/internal/service/storage_get_object_owned_atdd_test.go'
  - 'classlite-api/internal/worker/ai_grade_speaking_atdd_test.go'
  - 'classlite-api/internal/worker/ai_grade_speaking_refund_atdd_test.go'
  - 'classlite-api/internal/test/ai_grade_speaking_enqueue_atdd_test.go'
inputDocuments:
  - '_bmad-output/implementation-artifacts/6-3b-ai-speaking-grading-backend.md'
  - 'docs/project-context.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - 'classlite-api/internal/test/workers/harness.go'
  - 'classlite-api/internal/worker/ai_grade_writing_atdd_test.go'
  - 'classlite-api/internal/worker/ai_grade_writing_refund_atdd_test.go'
  - 'classlite-api/internal/worker/ai_grade_writing.go'
  - 'classlite-api/internal/worker/dispatcher.go'
  - 'classlite-api/internal/test/ai_grade_enqueue_atdd_test.go'
  - 'classlite-api/internal/service/ai_grade_service.go'
  - 'classlite-api/internal/service/storage.go'
  - 'classlite-api/internal/service/storage_mock.go'
  - 'classlite-api/internal/service/storage_presign_owned_test.go'
  - 'classlite-api/internal/service/grading/speaking.go'
  - 'classlite-api/internal/media/transcode.go'
  - 'classlite-api/internal/media/mock.go'
  - 'classlite-api/internal/gemini/mock.go'
  - 'classlite-api/internal/test/story_6_3a_helpers.go'
  - 'classlite-api/internal/test/story_6_2a_helpers.go'
  - '_bmad/tea/config.yaml'
---

# ATDD Red-Phase Checklist — Story 6.3b (AI-Assisted Speaking Grading — Backend)

## Step 1 — Preflight & Context

### Stack & framework
- **detected_stack:** `backend` (story scope). Repo is fullstack; 6.3b is pure Go (`classlite-api`). All scaffolds are `*_test.go`.
- **Framework:** Go `testing` + real-DB transaction harness (`internal/test`), worker harness (`internal/test/workers/harness.go`). ✅ present.
- **TEA config flags:** `tea_use_playwright_utils: true` (N/A — backend), `tea_use_pactjs_utils: false`, `tea_pact_mcp: none`, `test_stack_type: auto`, `risk_threshold: p1`.

### Prerequisites — all met
- ✅ Story approved with clear AC (A–E, AC1–12; DoD explicit; ready-for-dev).
- ✅ Backend test config exists (`*_test.go`, `internal/test`, worker harness).
- ✅ **All three spines SHIPPED** — 4.3a async (dispatcher/refund/ledger), 6-3a speaking domain (`grading.ValidateSpeakingCriterionScores`, `TimestampedComment`, `SpeakingDurationMsFromContent`), **6-3b0 transcoder** (`media.AudioTranscoder` + the THREE-class error contract). The mock transcoder (`media.MockTranscoder`) is present.
- ⚠️ **6.3b implementation NOT present** — the correct pre-dev state. Confirmed: no `ai_grade_speaking.go`, no `JobTypeAIGradeSpeaking`, no speaking enqueue branch, no `GetObjectOwned`, no migration.

### Risk posture (why ATDD is mandatory here — WF-8 HARD GATE)
- **risk_score: 9.** Governing risk **R3** (worker forgets `SET LOCAL` → async cross-tenant leak, L×I=9) — the SAME headline as 6-2a but now over a worker that reads a submission row AND an **R2 AUDIO object** (a third read surface). Also in scope: **R23** (deduct→refund, 6) and the NOVEL **R23b** (partial_success no-refund, 6 — D15). **R3 is the last ≥6 risk for Epic 6.**
- **WF-8 HARD RULE:** red-first ATDD (T-A/T-B audio-download tenant guard + T-C over-charge partial + refund idempotency + the D17 transcode taxonomy) MUST be on the branch before this story goes `in-progress`. This checklist + the four scaffolds ARE that gate.

### Reuse anchors located (scaffolds mirror these verbatim)
| Concern | Template / seam | Path |
|---|---|---|
| 3-pattern worker harness (+ `CallCount()==0` tripwire) | `SetupWorkerHarness`, `ProcessSpecific`, `ProcessWithoutTenantContext`, `JobStatus` | `internal/test/workers/harness.go` |
| Worker RLS grid + submission-read spy + zero-writes + secret-logging | `TestGradeWriting_*` | `internal/worker/ai_grade_writing_atdd_test.go` |
| Refund matrix + intra-retry ledger poll (`ledgerSum`, `countRefunds`) | `TestGradeWriting_Refund_*`, `newGradeDispatcher` | `internal/worker/ai_grade_writing_refund_atdd_test.go` |
| Worker generate() template + `TerminalReasonError` + failure taxonomy | `GradeWritingHandler.generate` | `internal/worker/ai_grade_writing.go` |
| Dispatcher retry/backoff/terminalFail+refund | `handleFailure`, `terminalFail` (`MaxJobRetries=3`) | `internal/worker/dispatcher.go` |
| Enqueue idempotency (`23505` reconcile) + authz negatives + grading-read | `TestEnqueueAIGrade_*`, `setupGradingEnv` | `internal/test/ai_grade_enqueue_atdd_test.go` |
| Skill-branch enqueue (the file to hoist the skill in — D16) | `EnqueueAIGrade`, `isInflightIndexViolation`, `findInflightJob` | `internal/service/ai_grade_service.go` |
| SEC-8 owned-key shared free fn (T-A twin) | `presignGetOwned`, `PresignGetOwned` + `KeyPrefixMismatchError` | `internal/service/storage.go`, `file_errors.go` |
| Storage mock (spy pattern to extend: `GetObjectKeys`, `GetObjectOwnedTenants`) | `MockStorageService`, `SeedObject`, `PresignGetKeys` | `internal/service/storage_mock.go` |
| Storage-unit foreign-prefix red template | `TestPresignGetOwned_ForeignPrefix_*` | `internal/service/storage_presign_owned_test.go` |
| Speaking domain (validate/normalize/duration/keys) | `ValidateSpeakingCriterionScores`, `TimestampedComment`, `SpeakingDurationMsFromContent` | `internal/service/grading/speaking.go` |
| Transcoder (THREE-class errors + `OutputMIME`) + mock | `AudioTranscoder`, `ErrUnsupportedAudio`/`ErrTranscodeFailed`/`ErrTranscodeUnavailable`, `MockTranscoder` | `internal/media/transcode.go`, `mock.go` |
| Deterministic Gemini mock (to extend with speaking modes) | `NewMockClient`, `MockConfig`, `CallCount()` | `internal/gemini/mock.go` |
| Speaking seed helper to promote (returns audioKey) | `SeedSpeakingSubmissionOnPool` | `internal/test/story_6_3a_helpers.go` |

### DI-seam red convention (confirmed from 6-3a)
Red phase = **`//go:build atdd_red_phase` tagged-compile-fail** (6-3a's convention; excluded from `go test ./...`, run with `-tags=atdd_red_phase`; FAILS TO COMPILE until the DI seams land). Dev strips the tag per-file as each contract lands. **Verified:** with the tag, each package fails to compile on an intended green seam ONLY (`service.MockStorageService.GetObjectOwned`, `worker.NewGradeSpeakingHandler`, `service.TeacherGradingView.AiSpeakingSuggestion`); without the tag `go build ./...` + `go vet` are clean (the red files are excluded).

## Step 2 — Generation Mode

- **Mode: AI Generation** (mandatory for `backend`). Scaffolds generated from AC + the Go source templates loaded in Step 1.
- **Recording:** N/A (no browser surface in 6.3b; all frontend is 6.3c). The generic two-worker API+E2E split collapses to a single Go API/integration scaffold set — no E2E worker.
- **Seam strategy:** tagged-compile-fail DI-seam red — reference not-yet-existing constructors/types/mock-modes so the package fails to compile under `-tags=atdd_red_phase` until dev lands them; assertions encode AC intent so green requires the *correct* behavior, not a stub.

## Step 3 — Test Strategy (AC → scenario → level → priority)

### Level choice (backend; no E2E)
- **Unit (pure fn / direct-inject):** the `GetObjectOwned` prefix guard (T-A); the D17 three-class `errors.Is` mapping (T-D1/T-D2/T-D3 drive the worker directly).
- **Worker integration** (worker harness + mock Gemini + mock transcoder + mock storage + real-DB tx): the R3 grid, R3-submission + T-B spies, moment handling, zero-writes, secret/audio/transcript logging.
- **Dispatcher integration** (real-DB tx): refund matrix, intra-retry ledger poll, the transcode-taxonomy terminal-vs-reschedule dispositions, double-refund race.
- **Service integration** (real-DB tx): skill-branched enqueue idempotency (two-index reconcile), authz negatives, empty-audioKey + over-duration guards, grading-read `aiSpeakingSuggestion`, student-leak.

> **Anti-duplication (meta-rule):** RLS tenant isolation is proved at worker/store (R3 grid, T-B) + the guard unit (T-A); enqueue authz *logic* once at the service level. The transcode taxonomy is `errors.Is`-typed — asserted by injecting the real 6-3b0 sentinels, NEVER by string-matching.

### Scenario map (★ = red-first mandatory, risk ≥6 → WF-8 gate)

| ID | AC | Scenario | Level | Pri | Red mechanism |
|---|---|---|---|---|---|
| **R3 async cross-tenant leak (score 9) — the headline gate, now over the AUDIO read** |
| SS1 ★ | 11 | `TestGradeSpeaking_HappyPath` — dispatcher `ProcessOnce` → validated bands, `transcriptionStatus=available`, demoted out-of-bound moment KEPT, `gem.CallCount()==1` AND `transcoder.CallCount()==1` | Worker-int | P0 | refs `worker.NewGradeSpeakingHandler` (absent → compile-fail) |
| SS2 ★ | 11 | `TestGradeSpeaking_PayloadCenterIdIgnored` — job row=A, payload subId=B → `NotFoundError`; **gem AND transcoder AND download all untouched** | Worker-int | P0 | `assertGeminiAndTranscoderUntouched` (three spies) |
| SS3 ★ | 11 | `TestGradeSpeaking_NullTenantContextRejected` — `ProcessWithoutTenantContext` → error; all three spies untouched | Worker-int | P0 | `ProcessWithoutTenantContext` template |
| SS4 ★ | 12 | `TestGradeSpeaking_SubmissionCrossTenant_GeminiAndTranscoderNeverInvoked` — sub S under B, job row=A → submission read 0 rows → `NotFound`, **`GetObjectOwned` never reached**, gem+transcoder `==0`, `job.result` NULL | Worker-int | P0 | new `SeedSpeakingSubmissionForTenant`; three spies + NULL result |
| **T-A / T-B — the audio-download tenant guard (R3=9, NEW/D13 — proxy coverage is a false-green)** |
| T-A ★ | 12 | `TestGetObjectOwned_ForeignPrefix_KeyPrefixMismatch_ZeroFetch` — `GetObjectOwned("<B>/x.webm", tc{A})` → `KeyPrefixMismatchError` + **zero fetch** (`GetObjectKeys` empty); + valid-prefix control | Storage-unit | P0 | pins the guard in the SHARED free fn `getObjectOwned` |
| T-B ★ | 12 | `TestGradeSpeaking_PoisonedAudioKey_GuardIsOnlyDefense` — sub legit under A but `content.audioKey` carries B's prefix → guard fires → **terminal `audio_unavailable` + distinct discrepancy log (D14)**, gem+transcoder `==0`, B's bytes never fetched | Worker-int | P0 | `SeedSpeakingSubmissionWithAudioKey`; slog buffer proves D14 without leaking bytes |
| **R23 / R23b refund + the partial_success credit model (score 6)** |
| SS-partial ★ | 7/12 | `TestGradeSpeaking_PartialSuccess_NoRefund` — valid bands, NULL transcript → **complete**, `transcriptionStatus=unavailable`, ledger = −1 deduct only (**NO refund** — D15) | Disp-int | P0 | `MockPartialSpeakingGrade`; `countRefunds==0`, `ledgerSum==-1` |
| SS-full-ctl | 7 | `TestGradeSpeaking_FullSuccess_NoRefund` — transcript present → complete, no refund (control) | Disp-int | P1 | `MockValidSpeakingGrade` |
| T-C ★ | 12 | `TestGradeSpeaking_OverChargePartialOrdering_TerminalRefund` — null/invalid bands AND null transcript → **terminal + refund**, explicitly NOT complete/`unavailable` (bands-check runs BEFORE the partial-return; the "launder a total failure into a no-refund partial" false-green) | Disp-int | P0 | `MockIncompleteBandsNoTranscript` |
| SS-intra ★ | 8/12 | `TestGradeSpeaking_RetryRefundExactlyOnce_IntraRetryPoll` — transient Gemini ×N; **intra-retry poll: after attempt 1 → 0 refunds, `ledgerSum==-1`**; at exhaustion → exactly 1 refund, `ledgerSum==0` | Disp-int | P0 | `ledgerSum`/`countRefunds` mid-run |
| SS-dbl | 8 | `TestGradeSpeaking_DoubleRefundIsNoOp` — worker+`SweepStuckJobs` race → exactly 1 refund | Disp-int | P1 | mirror writing S7 |
| SS-audio-miss ★ | 7/12 | `TestGradeSpeaking_AudioMissing_TerminalRefund_GeminiNeverCalled` — R2 object missing → terminal `audio_unavailable` + refund, gem+transcoder `==0` | Disp-int | P0 | unseeded storage → not-found |
| SS-band | 5/7 | `TestGradeSpeaking_InvalidBandScores_TerminalRefund` — band 9.5 → terminal `invalid_band_scores` + refund; NOT retried (`gem.CallCount()==1`) | Disp-int | P1 | `MockInvalidSpeakingBandScores` |
| **D17 — the THREE-class transcode taxonomy (NET-NEW over the 6-2a mirror; `errors.Is`, never strings.Contains)** |
| T-D1 ★ | 12 | `TestGradeSpeaking_TranscodeUnsupported_TerminalRefund_GeminiNeverCalled` — `media.ErrUnsupportedAudio` → terminal `audio_unavailable` + refund-once + gem `==0` (**dead-defense**, labeled) | Disp-int | P0 | `NewFailingMockTranscoder(ErrUnsupportedAudio)` |
| T-D2 ★ | 12 | `TestGradeSpeaking_TranscodeFailed_TerminalRefund_GeminiNeverCalled` — `media.ErrTranscodeFailed` → terminal `audio_unavailable` + refund-once + gem `==0` | Disp-int | P0 | `NewFailingMockTranscoder(ErrTranscodeFailed)` |
| T-D3 ★ | 12 | `TestGradeSpeaking_TranscodeUnavailable_Reschedules_RefundOnceAtExhaustion` — `media.ErrTranscodeUnavailable` → RESCHEDULE, NO refund attempts 1..N, refund EXACTLY ONCE at exhaustion, gem `==0` across ALL attempts; **R3=9 re-scope: `GetObjectOwned` re-driven under tenant A on EVERY attempt** (`GetObjectOwnedTenants` all A), re-transcode each attempt (`transcoder==downloads`) | Disp-int | P0 | `NewFailingMockTranscoder(ErrTranscodeUnavailable)` + MockClock ladder + per-attempt tenant spy |
| T-D3-rec | 12 | `TestGradeSpeaking_TranscodeUnavailable_ThenSuccess_NoRefund` — transient attempts 1–2 then success → `(result,nil)`, no refund, one grade | Disp-int | P1 | `NewScriptedMockTranscoder(out, [unavail,unavail,nil])` |
| T-D-fs ★ | 12 | `TestGradeSpeaking_TranscodeUnclassifiedError_Reschedules` — a bare `errors.New` (not `errors.Is` any sentinel) → transient reschedule, NOT terminal (fail-safe default; a future un-Is-able 6-3b0 error can't silently burn credit) | Disp-int | P0 | `NewFailingMockTranscoder(errors.New(...))` |
| **Worker correctness — moments / completeness / zero-writes / logging (D1/D5/D11/R49)** |
| SS-nullmc ★ | 5/12 | `TestGradeSpeaking_NullMomentConfidence_Terminal` — a moment with null confidence → terminal `invalid_ai_response` (guards the positional-zip nil-deref; DISTINCT from null-criterion-confidence) | Worker-int | P1 | `MockSpeakingNullMomentConfidence` |
| SS-drop ★ | 5/12 | `TestGradeSpeaking_MalformedMoment_Dropped_NotTerminal` — valid bands + transcript + one structurally-bad moment → **complete + charged**, result carries the good moment minus the bad one (D11 — the single sharpest divergence from the writing mirror) | Worker-int | P1 | `MockSpeakingMalformedMoment` |
| SS-zero ★ | 6/12 | `TestGradeSpeaking_Success_WritesNoGradeNorSubmission` — after a **partial_success** run, submission row + `grades` byte-identical/absent (D1 zero-writes, incl. the degraded path) | Worker-int | P1 | pre/post snapshot |
| SS-nolog ★ | 12 | `TestGradeSpeaking_SecretsPromptAudioAndTranscript_NeverLogged` — secret / prompt / **audio bytes** / **transcript** never logged (R49, extended with two speaking PII surfaces) | Worker-int | P1 | slog buffer + positive control |
| **Enqueue skill-branch + reads (D8/D9/D10/D12/D16)** |
| SE8 ★ | 1/12 | `TestEnqueueAISpeakingGrade_SecondInflight_ReturnsExisting_NoSecondDeduct` — 2nd in-flight SPEAKING enqueue → existing job, 1 job + 1 deduct (drives the SPEAKING index + twin query via the HOISTED skill — D16; a miss = double-charge) | Service-int | P0 | refs `EnqueueAIGrade` (speaking branch) |
| SE9 | 1 | `TestEnqueueAISpeakingGrade_ForbiddenTeacher_NoPartialWrite` — other-class teacher → `ForbiddenError`, zero jobs + zero deducts | Service-int | P1 | `otherTeacherTC` |
| SE10 | 1 | `TestEnqueueAISpeakingGrade_Student_Forbidden` — student → `ForbiddenError` (INSUFFICIENT_ROLE) | Service-int | P1 | `studentTC` |
| SE11 | 1 | `TestEnqueueAISpeakingGrade_EmptyAudioKey_Conflict_NoWrite` — empty audioKey → 409, zero side effects (before InsertJob) | Service-int | P1 | `newAISpeakingEnqEnv(t,"empty",…)` |
| SE12 ★ | 1/12 | `TestEnqueueAISpeakingGrade_OverDuration_Conflict_BeforeDeduct` — duration > ceiling → 409, zero jobs + zero deducts (**before the deduct** — D12) | Service-int | P1 | huge `durationSec`; asserts atomic no-write |
| SE-branch | 1 | `TestEnqueueAIGrade_WritingSubmission_RoutesToWritingBranch_NotSpeaking` — a writing submission mints `ai_grade_writing`, ZERO `ai_grade_speaking` (SEC-7 DB-skill branch; writing path unchanged regression) | Service-int | P1 | `FILTER` count by type |
| SE18 | 10 | `TestGetSubmissionForGrading_ReturnsLatestAISpeakingSuggestion` — latest complete `ai_grade_speaking` (`completed_at DESC, id DESC`) → `aiSpeakingSuggestion` | Service-int | P1 | refs `TeacherGradingView.AiSpeakingSuggestion` (absent → compile-fail) |
| SE19 | 10 | `TestStudentResult_NeverExposesAISpeakingSuggestion` — student `/result` path never exposes transcript/rationale (D10/UX-DR22) | Service-int | P1 | negative assertion on `GetStudentSubmissionReview` |

### Dead-defense / not-reachable-as-red (documented, not authored)
- **`SUBMISSION_NOT_SPEAKING` (AC1) via the auto-branched enqueue:** the enqueue skill is resolved from the DB (SEC-7) and BRANCHES — a writing submission goes to the writing branch, never an error. `assertSpeakingExercise` inside the speaking branch is always-true dead-defense (like `media.ErrUnsupportedAudio` post-enqueue-guards). Proven structurally by SE-branch (writing routes to writing), not by a reachable red.

## Step 4 — Generated Red-Phase Scaffolds

**Execution:** sequential, single-author (deviation from the generic subagent API+E2E fan-out — justified: interdependent Go scaffolds must mirror exact loaded templates + the 6-3a `atdd_red_phase` convention; fidelity > parallelism for a risk-9 gate). No E2E worker (no browser surface).

**Red mechanism (two-phase):** `//go:build atdd_red_phase` at the top of each file → the package FAILS TO COMPILE under `-tags=atdd_red_phase` now (undefined seams); once dev lands the seams it compiles and the assertions fail against not-yet-implemented behavior (assertion-red); dev strips the tag per-AC as each goes green. Under a plain `go test ./...` the files are excluded, so the tree stays green throughout dev.

### Files written (4)
| File | Package | Scenarios |
|---|---|---|
| `internal/service/storage_get_object_owned_atdd_test.go` | `service_test` | **T-A** foreign-prefix zero-fetch + valid-prefix control |
| `internal/worker/ai_grade_speaking_atdd_test.go` | `worker_test` | SS1 HappyPath, SS2 PayloadCenterId, SS3 NullTenantContext, **SS4 SubmissionCrossTenant**, **T-B PoisonedAudioKey+D14**, SS-nullmc, SS-drop, SS-zero (post-partial), SS-nolog (audio+transcript) |
| `internal/worker/ai_grade_speaking_refund_atdd_test.go` | `worker_test` | SS-partial, SS-full-ctl, **T-C**, SS-audio-miss, SS-band, SS-intra, SS-dbl, **T-D1/T-D2/T-D3(+R3 re-scope)/T-D3-rec/T-D-fs** |
| `internal/test/ai_grade_speaking_enqueue_atdd_test.go` | `test` | **SE8 two-index reconcile**, SE9, SE10, SE11, **SE12 over-duration-before-deduct**, SE-branch, SE18, SE19 |

### Compile-verification (red-for-the-right-reason) ✅
`go vet -tags=atdd_red_phase` confirms every compile error resolves to an **intended 6.3b seam**, none to a mistyped existing symbol:
- `service.MockStorageService.GetObjectOwned` / `GetObjectKeys` (undefined) — intended (Task 6)
- `worker.NewGradeSpeakingHandler` (undefined) — intended (Task 7)
- `service.TeacherGradingView.AiSpeakingSuggestion` (no field) — intended (Task 8/D10)
- (halted behind these: `model.JobTypeAIGradeSpeaking`, `model.AIGradeSpeakingParams`, `model.AISpeakingGradeResult`/`AISpeakingGradeCriterion`, `model.TranscriptionStatus{Available,Unavailable}`, `model.JobErrorAudioUnavailable`, `gemini.MockValidSpeakingGrade`/`MockPartialSpeakingGrade`/`MockInvalidSpeakingBandScores`/`MockSpeakingNullMomentConfidence`/`MockSpeakingMalformedMoment`/`MockIncompleteBandsNoTranscript`, `media.NewScriptedMockTranscoder`, `service.MockStorageService.GetObjectOwnedTenants`, `testpkg.SeedSpeakingSubmissionForTenant`/`SeedSpeakingSubmissionWithAudioKey`)

Existing-symbol references validated against source: harness API, `ledgerSum`/`countRefunds`/`jobResultRaw`/`jobErrorDetails`/`submissionRowFingerprint`/`gradesCountForSubmission` (reused from the shipped worker_test files), `NewDispatcher`/`ProcessOnce`/`SweepStuckJobs`, `TerminalReasonError`/`ErrInvalidAIResponse`, `media.NewMockTranscoder`/`NewFailingMockTranscoder`/`ErrUnsupportedAudio`/`ErrTranscodeFailed`/`ErrTranscodeUnavailable`, `MockStorageService.SeedObject`, `service.ForbiddenError`/`model.ConflictError`/`NotFoundError`, `setupGradingEnv`/`enqueueAIGrade`/`containsRationale`, `rlsInsertUserAS`/`rlsInsertAssignment`/`pgUUIDFromGo`/`CreateCenterMember`. **Without the tag, `go build ./...` + `go vet` are clean** — the red gate is isolated to the tagged build.

### Green-phase fixture/DI dependencies (dev reconciles in one place — the file headers)
- **NEW** `testpkg.SeedSpeakingSubmissionForTenant(t, db, centerID) (subID uuid.UUID, audioKey string)` — the worker-suite seed; **returns the audioKey** (unlike writing's) so the storage double can be seeded and the demotion offsets align. `content.durationSec` must equal the fixture duration `MockValidSpeakingGrade` pins its moments against.
- **NEW** `testpkg.SeedSpeakingSubmissionWithAudioKey(t, db, centerID, audioKey) uuid.UUID` — same chain, caller-supplied audioKey (the T-B poisoned key).
- `worker.NewGradeSpeakingHandler(db, gem, clk, storage, transcoder)` — storage + transcoder are **constructor fields** (the dispatcher/4.3a spine stays storage/media-agnostic; **must NOT `import internal/media`** — D6/D17).
- `service.MockStorageService`: add `GetObjectOwned` (delegating to a shared `getObjectOwned` free fn, prefix-guard + `maxSpeakingAudioBytes` LimitReader), a `GetObjectKeys []string` spy (append at fetch entry), and a `GetObjectOwnedTenants []string` spy (the tc.CenterID per owned call — T-D3's per-attempt tenant proof).
- `media.MockTranscoder`: **extend TEST-ONLY** (charged to 6-3b, NO 6-3b0 re-open — D17/9.a) with `NewScriptedMockTranscoder(out []byte, script []error)` (attempt-aware fail-then-succeed). `NewFailingMockTranscoder(err)` (single-error) + `CallCount()` already ship.
- `gemini` speaking mock modes (canned JSON; `Generate` ignores its request arg): `MockValidSpeakingGrade` (four valid bands, transcript PRESENT, one in-bound `PINNED` moment + one out-of-bound `OUTOFBOUND` moment relative to the fixture duration → the demote-not-drop assertion is non-vacuous), `MockPartialSpeakingGrade` (valid bands, transcript NULL), `MockInvalidSpeakingBandScores` (a band 9.5), `MockSpeakingNullMomentConfidence` (a moment with null confidence), `MockSpeakingMalformedMoment` (valid bands + transcript + one `BADMOMENT` with bad type/criterion/blank text), `MockIncompleteBandsNoTranscript` (null/invalid bands AND null transcript — the T-C over-charge probe). Reuse `MockTransientError` for the intra-retry/double-refund reds.
- `model.JobTypeAIGradeSpeaking` / `AIGradeSpeakingParams{SubmissionID}` / `AISpeakingGradeResult`+`AISpeakingGradeCriterion` / `TranscriptionStatus{Available,Unavailable}` / `JobErrorAudioUnavailable = "audio_unavailable"`.
- `service.EnqueueAIGrade` speaking branch (skill hoisted for the two-index reconcile — D16; empty-audioKey + duration guards before the deduct — D12) + `TeacherGradingView.AiSpeakingSuggestion`.

### Red-phase guarantee
Every scenario fails **before** implementation — by **compile-fail** under `-tags=atdd_red_phase` (undefined seams) and then by **assertion-fail** against behavior that does not yet exist. No scaffold can pass against an empty/stub implementation.

### Scope of THIS run vs. later stages
- **This ATDD run generates:** all ★ (the WF-8 risk≥6 red-first set: R3 grid + T-A/T-B + T-C + partial_success + refund idempotency + the FULL D17 transcode taxonomy) plus the P1 correctness/enqueue set. That is the WF-8 gate.
- **Post-dev TA (`/bmad-tea TA 6-3b`):** the `Job.result` oneOf golden through the poll parser (needs generated types — a **cross-repo classlite-web** `tsc -b` red for the D10 consumer arm), the speaking-moment parity fixture, unknown-ext MIME, the `aiSpeakingSuggestion` ordering (not the leak-guard), and any P3 tail. These need post-codegen generated types; pinning them against guessed shapes now would pin the wrong contract.

### Deliberately NOT auto-generated now (post-codegen, still red-first vs. implementation)
- **`Job.result` oneOf consumer-contract** — a TS/vitest test through 4.3b's `client.ts` poll parser + the D10 classlite-web `job.type ===` narrow arm. The union type does not exist until `api.yaml` widens `Job.result` + `codegen.sh` runs (Tasks 1–3). **Recommendation (pragmatic, per the spec-absolute guidance):** author it immediately after Task 3 codegen, before Task 7 (worker) — still red-first relative to the worker behavior, but against real generated types. Ducdo to ratify or override.

## Step 4C — Aggregation & Red-Phase Compliance

- **Total red tests:** 30 across 4 files (2 storage-unit, 9 worker, 11 refund/transcode, 8 enqueue/read), 100% under the `atdd_red_phase` tag.
- **Red compliance:** ✅ all assert real behavior (no `assert(true)` placeholders); expected-to-fail confirmed two ways — compile-fail now (undefined seams), assertion-fail after seams land. `go build`/`go vet` WITHOUT the tag are clean.
- **Coverage vs risk register:** R3 (9) — SS1–SS4 + **T-A** + **T-B** + the T-D3 per-attempt tenant re-scope ✅; R23 (6) — SS-intra + SS-dbl + all terminal-refund paths ✅; **R23b (6, NEW)** — SS-partial + SS-full-ctl + **T-C** ✅; D17 three-class — **T-D1/T-D2/T-D3/T-D3-rec/T-D-fs** ✅; D11 moment DROP + D5 null-moment-confidence ✅; D1 zero-writes (incl. post-partial) ✅; D6/D13/D14 audio-download guard + discrepancy log ✅; D8/D9/D12/D16 enqueue branch/guards/idempotency ✅; D10 read separation ✅; R49 (+audio+transcript) ✅.
- **AC coverage:** AC1, AC3, AC4, AC4a, AC5, AC6, AC7, AC8, AC10, AC11, AC12. AC2 (no-balance-gate) implicit in SE8/SE9 ledger asserts. AC9 (poll unchanged/creator-private) + the oneOf web arm land post-codegen (deferred, above).
- **Story linked:** `### ATDD Artifacts (red-phase gate)` in the story updated with the four generated paths.
- **Execution:** SEQUENTIAL single-author — deliberate for fidelity to the 6-3a convention + the exact templates.

## Step 5 — Validation & Completion

**Validation checklist:** ✅ prerequisites satisfied (all three spines shipped) · ✅ 4 test files created + compile-verified red-for-right-reason under the tag · ✅ normal build/vet clean (red gate isolated) · ✅ checklist maps all in-scope ACs · ✅ 30 tests tagged `atdd_red_phase`, real assertions · ✅ story metadata + handoff captured, `### ATDD Artifacts` linked · N/A CLI/browser sessions (backend) · ✅ artifacts in `test_artifacts/`.

### Handoff
- **Story:** `6.3b` · key `6-3b-ai-speaking-grading-backend` · file `_bmad-output/implementation-artifacts/6-3b-ai-speaking-grading-backend.md`
- **Checklist:** this file.
- **Gate status:** WF-8 ATDD red gate **SATISFIED for the risk≥6 set** (R3=9 incl. the audio surface, R23, R23b, the full D17 transcode taxonomy) — the story may transition `ready-for-dev → in-progress`. Contingency: author the oneOf consumer-contract red right after Task 3 codegen.

### Key risks / assumptions
1. Green phase must land the DI seams **exactly** as headed in each file — especially the two NEW `testpkg.SeedSpeaking*` helpers (the worker seed **returns the audioKey**) and the storage-mock spies (`GetObjectKeys`, `GetObjectOwnedTenants`) that make T-A + T-D3's per-attempt-tenant proof observable.
2. `MockValidSpeakingGrade` MUST emit one in-bound `PINNED` moment + one out-of-bound `OUTOFBOUND` moment relative to the fixture `durationSec`, or SS1's demote-not-drop assertion goes vacuously green. `MockSpeakingMalformedMoment` MUST carry a `BADMOMENT` alongside a good moment (SS-drop).
3. **The transcode step is NET-NEW over the 6-2a mirror.** The dispatcher's terminal classifier only routes `errors.Is(ErrInvalidAIResponse)` OR `NotFoundError` terminal; everything else RETRIES. So the worker must map `audio_unavailable` onto a terminal error the dispatcher recognizes (the 6-2a `terminalReason` pattern wraps `ErrInvalidAIResponse`) while `ErrTranscodeUnavailable`/unclassified wrap `ErrTransientGeneration` for reschedule. The taxonomy tests assert the persisted disposition (status + error_details + refund count), not the internal wrapping — robust to the exact green wiring.
4. **T-D3 count:** the dispatcher runs `generate()` on the terminal pick too (`MaxJobRetries=3` → 3 reschedules + 1 terminal run = 4 transcode attempts), so T-D3 asserts the ROBUST invariants — `gem==0` across all, `transcoder==downloads`, every `GetObjectOwnedTenants` entry == A, count `>= 3` — not a brittle exact number. The R3=9 hold-the-line assertion is the per-attempt tenant, not the count.
5. `assertSpeakingExercise` via the auto-branched enqueue is dead-defense (the branch is DB-chosen) — proven structurally by SE-branch, not a reachable `SUBMISSION_NOT_SPEAKING` red.

### Next recommended workflow
- **`/bmad-dev-story 6-3b`** (Amelia) — turn the red gate green (Tasks 0–10), stripping each file's `atdd_red_phase` tag as its AC lands.
- **Then `/bmad-tea TA 6-3b`** — the post-codegen tail: the `Job.result` oneOf golden + the classlite-web consumer arm (`tsc -b`), moment-parity fixture, `aiSpeakingSuggestion` ordering.
- **Then `/bmad-tea RV`** — flake/quality review of the green suite (determinism traps: MockClock backoff, injectable `maxInlineAudioBytes`, no goroutines in the double-refund proof).
- **Epic boundary:** `/bmad-tea TR` (trace) + `NR` (NFR) + `GATE` — R3 is the last ≥6 risk for Epic 6.
