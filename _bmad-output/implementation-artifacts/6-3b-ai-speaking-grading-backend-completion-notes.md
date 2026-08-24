# Story 6-3b: Completion Notes

_Implementation record for [`6-3b-ai-speaking-grading-backend.md`](./6-3b-ai-speaking-grading-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Terminal-classification mechanism for `audio_unavailable`.** The dispatcher's terminal branches are `errors.Is(genErr, ErrInvalidAIResponse)` and `errors.As(&NotFoundError)`. A transcode-terminal / poisoned-key / missing-object failure must land terminal WITHOUT retry, so the worker wraps `ErrInvalidAIResponse` via the existing `terminalReason("audio_unavailable", ErrInvalidAIResponse)` (the exact `invalid_band_scores` precedent) — distinct `error_details` label, zero dispatcher change on the terminal side. The Task-7 spec snippet's `&TerminalReasonError{Reason:"audio_unavailable", Err: mediaErr}` would have fallen through to the RETRY branch (Unwrap → media err, not `ErrInvalidAIResponse`); the ATDD tests (T-D1/T-D2 expect terminal) confirmed the wrap-`ErrInvalidAIResponse` form is required.
- **T-D3 exhaustion label — the one required dispatcher change.** T-D3 asserts `error_details == audio_unavailable` at retry exhaustion, but the generic transient-exhaustion produces `max_retries_exhausted`. Added a GENERIC (no `internal/media` import) seam: `TransientReasonError{Reason, err}` wraps `ErrTransientGeneration` (so it still reschedules on attempts 1..N) and the dispatcher's `exhaustionReason(genErr)` reads its `.Reason` ONLY at exhaustion. `ErrTranscodeUnavailable` → `TransientReasonError{Reason: audio_unavailable, ...}`; the unclassified fail-safe arm stays a plain `ErrTransientGeneration` wrap (→ `max_retries_exhausted`, matching the Task-7 snippet, no test pins its exhaustion label). This is the anti-hostage guarantee (D17/John): 3 attempts → guaranteed terminal `audio_unavailable` + refund.
- **Confidence re-zip vs D11 drop.** Writing re-zips confidence positionally (its normalize is length-preserving). Speaking DROPS structurally-bad moments (D11), so a positional re-zip after the drop would misalign. Resolved by looping the response moments in the worker and attaching `*m.Confidence` per KEPT moment (no re-zip) — the completeness pre-check (step 3) guarantees every `Confidence` is non-nil before the loop derefs it.
- **R2 GetObject 5 MB cap would truncate audio.** `R2StorageService.GetObject` capped reads at `maxImportFileBytes+1` (5 MB) — a real 20-min recording (>5 MB) would silently truncate and every transcode would then fail. Raised the R2 read ceiling to `maxStorageReadBytes` (= 25 MB, the larger of the two callers' caps); the bulk-import path is unaffected (it enforces its own `len > maxImportFileBytes` → 413 below the ceiling). The shared `getObjectOwned` then bounds the owned download at `maxSpeakingAudioBytes` (25 MB).
- **Student-review nil-storage panic (test infra).** `newAISpeakingEnqEnv`'s `submissionSvc` was built without `.WithStorage(...)`; the seeded speaking submission carries an audioKey, so `GetStudentSubmissionReview`'s own-recording presign derefed a nil storage. Green-phase DI fix: wired `.WithStorage(service.NewMockStorageService())` into the env (matches story_5_5a/6_3a envs). Production always wires storage; no product-code change.
- **Web `Job.result` narrow (D10).** The widened `oneOf` gave writing AND speaking results a `criteria` key, so `asWritingGradeResult`'s `'criteria' in result` guard would no longer type-narrow (both members match). Switched the writing discriminant to `'comments'` (writing-unique; speaking has `moments`). `asGenerationResult` (`'sections'`) was unaffected. `tsc -b` green.

### Completion Notes

Shipped the full backend AI speaking-grade pipeline as a mirror of 6-2a over the 6-3a speaking domain + the 6-3b0 transcoder, with the D17 three-class transcode error contract mapped at the worker boundary.

- **Worker** `internal/worker/ai_grade_speaking.go` (`GradeSpeakingHandler`): RLS submission read → `GetObjectOwned` (SEC-8) → `media.Transcode` (3-class `errors.Is` switch, D17) → Gemini inline audio → validate/completeness/drop-moment-normalize/partial_success. Writes only `job.result` (D1 — zero-writes verified).
- **Dispatcher seam** (generic, no `internal/media` import): `TransientReasonError` + `exhaustionReason`.
- **Gemini client**: additive `GenerateRequest.AudioData/AudioMimeType`, `geminiPart.inlineData` + `Text,omitempty`, a separate 120s `audioClient` (text 60s untouched).
- **Storage**: `GetObjectOwned` on the interface + R2 + mock, delegating to the shared `getObjectOwned` free fn (prefix guard + 25 MB cap); mock `GetObjectKeys` + `GetObjectOwnedTenants` spies.
- **Enqueue**: `EnqueueAIGrade` skill-branched (skill resolved from DB, hoisted so the 23505 reconcile picks the speaking twin query + covers both index names); speaking guards (empty-audioKey, `maxAIGradeAudioDurationMs` duration ceiling before deduct).
- **Grading-read**: `TeacherGradingView.AiSpeakingSuggestion` + `populateAISpeakingSuggestion` (latest-complete, degrade-don't-fail); student `/result` path untouched (leak-guard test green).
- **Migration**: `uq_jobs_ai_grade_speaking_inflight` (additive partial unique index; up/down round-trips clean).
- **api.yaml**: `AISpeakingGradeResult`/`AISpeakingGradeCriteria`/`AISpeakingGradeCriterion`/`AISpeakingMoment`; `Job.result` `oneOf` widened; `aiSpeakingSuggestion` on `TeacherGradingView`.
- **Startup (D16)**: enforced ops-checklist log line — the configured `GEMINI_MODEL` MUST be multimodal for speaking grading (see manual-setup.md); not a network probe.
- **Test-only (9.a)**: `media.NewScriptedMockTranscoder` (attempt-aware, no 6-3b0 production re-open).

**Deviations from spec:** (1) `audio_unavailable` terminal wraps `ErrInvalidAIResponse` (not the media error) — see Debug Log; (2) `TransientReasonError` was ADDED to satisfy T-D3's exhaustion label (the D4 table said `max_retries_exhausted`, but the executable ATDD contract and the DoD "GUARANTEED terminal audio_unavailable" won); (3) R2 read ceiling raised for audio (see Debug Log). All are documented and test-backed.

**Not built (deferred to 6-3c / later):** all frontend; the injectable `maxInlineAudioBytes` determinism test (the field exists on the handler for injection; no red test required it); the post-dev `/bmad-tea TA` P2/P3 expansion (oneOf golden through the poll parser, moment-parity fixture, unknown-ext MIME).

### Implementation Plan (as executed)

1. Migration (`uq_jobs_ai_grade_speaking_inflight`) → `migrate.sh` up/down verified.
2. `jobs.sql` twin queries → `api.yaml` schemas + `oneOf` widen + `aiSpeakingSuggestion` + web `asWritingGradeResult` discriminant fix.
3. `codegen.sh` (sqlc → Go, openapi-typescript → client.ts) + web fixture ripple (`aiSpeakingSuggestion: null`).
4. Go: model (`JobTypeAIGradeSpeaking`/params/`AISpeakingGradeResponse`+`Result`/`TranscriptionStatus`/`JobErrorAudioUnavailable`) + grading (`SpeakingAudioKeyFromContent`, `ValidSpeakingMoment`, `BoundSpeakingTimestampMs`); gemini client + mock speaking modes; media scripted mock; storage `GetObjectOwned`; worker + dispatcher seam; enqueue branch + grading-read + handler mapping; main.go wiring (hoist storage, construct transcoder, register handler, model-multimodal ops log).
5. Flipped the 4 ATDD files green (removed `//go:build atdd_red_phase`), added `SeedSpeakingSubmissionForTenant`/`SeedSpeakingSubmissionWithAudioKey`.
6. Gates: `go build`/`vet` clean; `go test ./internal/... -race` all green; `tsc -b` clean; affected web vitest green.

## File List

### Added
- `classlite-api/migrations/20260824120000_add_ai_grade_speaking_inflight_unique_index.up.sql` / `.down.sql` — the speaking in-flight partial unique index (D9).
- `classlite-api/internal/worker/ai_grade_speaking.go` — the `GradeSpeakingHandler` worker + `TransientReasonError` + transcode-class switch + result builder.
- `classlite-api/internal/test/story_6_3b_helpers.go` — `SeedSpeakingSubmissionForTenant` / `SeedSpeakingSubmissionWithAudioKey`.
- `_bmad-output/implementation-artifacts/6-3b-ai-speaking-grading-backend-completion-notes.md` — this file.

### Modified
- `classlite-api/api.yaml` — speaking result schemas + `Job.result` oneOf + `aiSpeakingSuggestion` (+ regenerated `classlite-web/src/lib/api/client.ts`).
- `classlite-api/internal/store/queries/jobs.sql` — `GetInflightAISpeakingGradeJobForSubmission` + `GetLatestCompleteAISpeakingGradeJobForSubmission` (+ regenerated `internal/store/generated/jobs.sql.go`).
- `classlite-api/internal/model/job_types.go` — `JobTypeAIGradeSpeaking`, `AIGradeSpeakingParams`, `JobErrorAudioUnavailable`, `TranscriptionStatus*`.
- `classlite-api/internal/model/ai_response.go` — `AISpeakingGradeResponse` + `AISpeakingGradeResult` (+ criteria/criterion/comment/moment) structs.
- `classlite-api/internal/service/grading/speaking.go` — `SpeakingAudioKeyFromContent`, `ValidSpeakingMoment`, `BoundSpeakingTimestampMs` (D7/D11).
- `classlite-api/internal/service/submission_service.go` — `speakingAudioKeyFromContent` delegates down to grading (D7).
- `classlite-api/internal/gemini/client.go` — inline-audio fields + `geminiPart.inlineData` + `Text,omitempty` + audio-path timeout.
- `classlite-api/internal/gemini/mock.go` — speaking mock modes + `SpeakingGradeFixtureDurationSec`.
- `classlite-api/internal/media/mock.go` — `NewScriptedMockTranscoder` (test-only, 9.a).
- `classlite-api/internal/service/storage.go` — `GetObjectOwned` interface method + shared `getObjectOwned` free fn + caps.
- `classlite-api/internal/service/storage_r2.go` — R2 `GetObjectOwned` + widened read ceiling.
- `classlite-api/internal/service/storage_mock.go` — mock `GetObjectOwned` + `GetObjectKeys`/`GetObjectOwnedTenants` spies.
- `classlite-api/internal/service/ai_grade_service.go` — skill-branched `EnqueueAIGrade` + hoisted skill + two-index reconcile + duration ceiling.
- `classlite-api/internal/service/grading_service.go` — `AiSpeakingSuggestion` field + `populateAISpeakingSuggestion` + call site.
- `classlite-api/internal/handler/grading_handler.go` — `aiSpeakingSuggestion` in the response mapping.
- `classlite-api/internal/worker/dispatcher.go` — `exhaustionReason` (generic `TransientReasonError` seam, D17).
- `classlite-api/cmd/api/main.go` — hoist `uploadStorage`, construct `audioTranscoder`, register the speaking handler, model-multimodal ops log.
- `classlite-web/src/features/grading/hooks/useAiGradeJob.ts` — `asWritingGradeResult` discriminant `criteria` → `comments` (D10).
- `classlite-web/src/features/grading/__tests__/{WritingGradingPage,SpeakingGradingPage}.test.tsx` — `aiSpeakingSuggestion: null` fixture ripple.
- The 4 ATDD files (`internal/service/storage_get_object_owned_atdd_test.go`, `internal/worker/ai_grade_speaking_atdd_test.go`, `internal/worker/ai_grade_speaking_refund_atdd_test.go`, `internal/test/ai_grade_speaking_enqueue_atdd_test.go`) — removed the `//go:build atdd_red_phase` tag (green phase) + wired storage into the enqueue env.
- docs: `epics/epic-06.md`, `deferred-work.md`, `manual-setup.md`, `test-design-architecture.md` (Task 10).

### Deleted
- None.
