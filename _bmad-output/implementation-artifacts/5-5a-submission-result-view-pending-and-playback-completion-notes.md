# Story 5.5a: Completion Notes

_Implementation record for [`5-5a-submission-result-view-pending-and-playback.md`](./5-5a-submission-result-view-pending-and-playback.md). Status: review._

## Dev Agent Record

### Debug Log

- **Handler reds failed only on empty `requestId`.** The bare-mux test server (`story_5_5a_helpers.go`) mirrored `NewStudentAttemptTestServerBareMux` (extractTenant → requireVerified → requireCenter → ErrorMapper) but omitted the outer `middleware.RequestID`, so the `{error:{code,message,requestId}}` envelope carried an empty `requestId` and the review reds' `revAssertErrEnvelope` failed. Fixed by wrapping the mux in `middleware.RequestID` (outermost, as in production). All status codes + error codes were correct from the first run.
- **FE in_progress red keyed off a status-only override.** `SubmissionReviewPage.test.tsx`'s in_progress case overrides `submission.status='in_progress'` but not the top-level `inProgress` flag; the page now treats a resume-CTA as `result.inProgress || submission.status === 'in_progress'` (belt-and-suspenders — the backend sets both together, but the status is ground truth the terminal read-back must never render). Also added `inProgress: false` to the red's `result()` factory (the generated `StudentSubmissionResult` requires it — a deliberate red adjustment).
- **Stray eslint disable.** `jsx-a11y/media-has-caption` is not a registered rule in this config (the shipped `AttemptAudioPlayer` carries no such disable); removed the `eslint-disable-next-line` comment from `ResultSpeakingPlayback`.
- **Pre-existing date-bomb in onboarding tests (NOT a 5.5a regression) — FIXED at Ducdo's request.** The full `vitest run` initially showed 26 failures in `onboarding/ClassSpawnPage.test.tsx` + `onboarding/lib/__tests__/classSpawnSchema.test.ts`. Root cause: those tests hardcode `startDate '2026-07-15'`, and `classSpawnSchema.ts:56-58` validates `startDate >= startOfUtcDay(Date.now()) - 30 days`. The session spanned a real-clock change (2026-08-14 → 2026-08-17); today − 30 days = 2026-07-18, so `2026-07-15` fell outside the window and the schema rejected it (submit never reached the 201/navigate paths). Story 5.5a touches ZERO onboarding SOURCE files. **Fix:** replaced the hardcoded "valid" `2026-07-15` in both test files with a run-time-computed canonical padded ISO date (today, UTC) — the fixture now stays inside the window as the wall clock advances instead of rotting. The past-bound (`2025-01-01`) and future-bound (`nowYear+6`) negative-assertion dates were left as-is (robustly out of window by construction). Full suite back to **2458/2458 green**. The production schema was already correct — the bug was hardcoded dates in the fixtures.

### Completion Notes

Shipped the Epic-6-independent "review my submission" slice + the two additive backend read endpoints, red-first on the risk-6 security core (AC3/AC4).

- **Backend (additive, no migration):**
  - `StorageService.PresignGetOwned(ctx, key, tc, expiry)` — the SEC-8 owned-GET primitive: a shared `presignGetOwned` free function (one auditable home for the `tc.CenterID+"/"` prefix guard) delegated to by both the R2 and mock impls. `FileService.GetFileDownloadURL`'s inline (preview) path was refactored onto it; the attachment variant keeps an inline guard because the opts-less primitive can't carry a Content-Disposition. Parity red green.
  - `SubmissionService.GetStudentSubmissionReview` — mirrors `GetAttemptBundle`'s gate ladder via the SHARED helpers (`revalidateStudent` → caller-keyed `GetSubmissionByAssignmentStudent` resolve → `GetAssignmentByID` under the same tenant tx → `assertActiveEnrollment`), no fork. Ownership is inherent (resolve is keyed on the principal's own studentID → same 404 for a cross-student assignment, no oracle). `in_progress` short-circuits to a CTA result (D10 — no strip, no presign). NOT lock-gated (D6). The speaking `audioUrl` is minted OUTSIDE the committed read tx (D9/PERF-1). Reused the existing `GetSubmissionByAssignmentStudent :one` (no parallel query — the ATDD REUSE flag).
  - `SubmissionService.GetStudentSubmissionAudioURL` — the same gate ladder → a fresh 5-min `PresignGetOwned`; no audioKey → 404; zero mint on every gated failure.
  - Two handlers on `SubmissionHandler` (`GetSubmissionResult`, `GetSubmissionAudio`) + routes registered in `main.go` + the api.yaml contract (`StudentSubmissionResult`, `EnvelopeStudentSubmissionResult`, `AudioUrl`, `EnvelopeAudioUrl`) → codegen. `exercise`/`audioUrl` are `nullable` (exercise null for the in_progress CTA).
- **Frontend (`src/features/submission-review/`):** `useSubmissionReview` (apiFetchWithMeta, staleTime 0, retry false — no bootstrap POST), `useSubmissionAudioUrl` (staleTime 4min, on-demand), `reviewKeys`. Read-back leaves: `ResultWritingReadback` (pre-wrap, no chrome), `ResultQuizReceipt` (receipt framing + question stems, reuses the disabled `ChoiceOption`/`GapInput`/`MatchingBoard`/`AttemptAudioPlayer` leaves + `flattenQuestions`, no correctness grid), `ResultSpeakingPlayback` (hybrid inline first-paint + play-intent/error refresh, recoverable retry). `SubmissionReviewShell` (skill dispatch + quiet not-released note + neutral badge, single tree per breakpoint), `SubmissionReviewPage` (L/E/E trilogy incl. skeleton, 404→not-started, in_progress→resume, focus-on-heading + `<title>`). Full-bleed route registered; `reviewCtaForRow` + a "Review submission" row link (new `assignment-review-cta-*` testid, leaves existing CTAs intact); both `SubmittedElsewhereOverlay`s gained an `assignmentId` prop and repointed "view result" → `/assignments/{id}/submission`. `submissionReview.*` + `assignments.cta.reviewSubmission[For]` in en+vi.

**Scope boundary held:** no `grades` table, no `POST /grade`, no band/criteria/comments/penalty-math; `released` always false; no `/result` FE route (reserved 5-5b). The page is the durable shell 5-5b fills.

### Implementation Plan (as executed)

1. Task 0 pre-flight — verified the spine (shared gate helpers, `GetSubmissionByAssignmentStudent` reuse, SEC-8 `PresignGet` pattern, answer-strip stem retention) against HEAD `556ae05`.
2. Task 1 — api.yaml paths + schemas → `codegen.sh` (Go + `client.ts`).
3. Task 2 — `PresignGetOwned` (interface + shared helper + R2/mock impls) + `FileService` refactor; `GetStudentSubmissionReview` + `GetStudentSubmissionAudioURL`; two handlers + routes + `story_5_5a_helpers.go`; activated the 3 backend reds (removed `atdd_red_phase` tags) → green; full `go test ./...` + `go vet` green.
4. Tasks 3–7 — FE hooks, read-back components, shell/page/states/mobile, route + entry-point + overlay repoint, i18n; activated the 4 FE reds (`.red.tsx`→`.test.tsx`) → 46/46 green.
5. Task 8 — amended `epic-05.md` Story 5.5 (split + assignment-keyed `/result` + 200-pending + `/submission` route), cleared the 5.4 D11 handoff in `deferred-work.md`, logged FU-5-5-A/B/C.
6. Task 9 — gates: `tsc --noEmit` 0, `eslint` 0 (changed files), `i18n-parity` OK (1640 keys), backend `go test ./...` + `go vet` green, feature vitest 46/46; full-suite regressions traced to the pre-existing onboarding date-bomb (above).

## File List

### Added

**Backend**
- `classlite-api/internal/test/story_5_5a_helpers.go` — bare-mux review test server (returns the mock storage spy).

**Frontend**
- `classlite-web/src/features/submission-review/index.ts` — feature barrel.
- `classlite-web/src/features/submission-review/SubmissionReviewPage.tsx` — route entry + L/E/E + CTAs + focus/title.
- `classlite-web/src/features/submission-review/api/reviewKeys.ts`
- `classlite-web/src/features/submission-review/api/useSubmissionReview.ts`
- `classlite-web/src/features/submission-review/api/useSubmissionAudioUrl.ts`
- `classlite-web/src/features/submission-review/lib/submissionContent.ts` — per-skill content readers.
- `classlite-web/src/features/submission-review/components/SubmissionReviewShell.tsx`
- `classlite-web/src/features/submission-review/components/ResultWritingReadback.tsx`
- `classlite-web/src/features/submission-review/components/ResultQuizReceipt.tsx`
- `classlite-web/src/features/submission-review/components/ResultSpeakingPlayback.tsx`
- `classlite-web/src/features/submission-review/components/SubmissionStatusBadge.tsx`
- `classlite-web/src/features/submission-review/components/NotReleasedNote.tsx`
- `classlite-web/src/features/submission-review/__tests__/{SubmissionReviewPage,readback,audioPlayback,entryPoints}.test.tsx` — activated from the ATDD `.red.tsx` scaffolds.

### Modified

**Backend**
- `classlite-api/api.yaml` — two GET paths + `StudentSubmissionResult`/`EnvelopeStudentSubmissionResult`/`AudioUrl`/`EnvelopeAudioUrl` schemas.
- `classlite-api/internal/service/storage.go` — `PresignGetOwned` on the interface + shared `presignGetOwned` helper.
- `classlite-api/internal/service/storage_r2.go` / `storage_mock.go` — `PresignGetOwned` impls.
- `classlite-api/internal/service/file_service.go` — `GetFileDownloadURL` inline path refactored onto `PresignGetOwned`.
- `classlite-api/internal/service/attempt_service.go` — `GetStudentSubmissionReview`, `GetStudentSubmissionAudioURL`, `StudentSubmissionReviewResult`, `submissionAudioURLExpiry`.
- `classlite-api/internal/handler/attempt_handler.go` — `GetSubmissionResult`/`GetSubmissionAudio` + response shapes.
- `classlite-api/cmd/api/main.go` — registered the two review routes.
- `classlite-api/internal/store/generated/*` — codegen output (openapi types unchanged for Go; sqlc unchanged — no new query).
- Backend ATDD tests (tag removed): `internal/service/submission_review_service_test.go`, `internal/service/storage_presign_owned_test.go`, `internal/handler/submission_review_handler_atdd_test.go`.

**Frontend**
- `classlite-web/src/lib/api/client.ts` — regenerated.
- `classlite-web/src/routes.tsx` — `/assignments/:assignmentId/submission` full-bleed sibling route.
- `classlite-web/src/features/assignments/lib/assignmentRow.ts` — `reviewCtaForRow` + `ReviewCta`.
- `classlite-web/src/features/assignments/AssignmentRow.tsx` — "Review submission" terminal-row link.
- `classlite-web/src/features/writing-attempt/components/SubmittedElsewhereOverlay.tsx` + `WritingAttemptShell.tsx` — `assignmentId` prop + repoint.
- `classlite-web/src/features/speaking-attempt/components/SubmittedElsewhereOverlay.tsx` + `SpeakingAttemptShell.tsx` — `assignmentId` prop + repoint.
- `classlite-web/src/locales/en.json` + `vi.json` — `submissionReview.*` + `assignments.cta.reviewSubmission[For]`.

**Tests (pre-existing date-bomb fix — Ducdo-requested)**
- `classlite-web/src/features/onboarding/lib/__tests__/classSpawnSchema.test.ts` — hardcoded valid `startDate` → run-time-computed `VALID_START`.
- `classlite-web/src/features/onboarding/__tests__/ClassSpawnPage.test.tsx` — typed valid `startDate` → run-time-computed `VALID_START_DATE`.

**Docs**
- `_bmad-output/planning-artifacts/epics/epic-05.md` — Story 5.5 split + API/route amendments.
- `_bmad-output/implementation-artifacts/deferred-work.md` — 5.4 D11 handoff marked resolved; FU-5-5-A/B/C added.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 5-5a → in-progress → review.

### Deleted

- (none)
