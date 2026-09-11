# Story 7-4b: Completion Notes

_Implementation record for [`7-4b-anchored-qa-frontend.md`](./7-4b-anchored-qa-frontend.md). Status: review._

## Dev Agent Record

### Debug Log
- **D5 confirmed at pickup** — Ducdo chose ENRICH (display name + avatar via `LEFT JOIN users`) over a separate people lookup, as AC13 specified.
- **Stale-LSP false positives throughout** — after `codegen.sh` regenerated `client.ts`, the editor LSP kept reading a pre-codegen in-memory copy (errors like "Property 'Question' does not exist … 293 more"). The authoritative gate `tsc -b` was clean at every checkpoint; all such diagnostics were false. (memory: `reference_web_typecheck_gate_is_tsc_b`.)
- **axe `aria-prohibited-attr`** — the anchor-pin `<span aria-label>` failed axe (aria-label needs a role). Fixed with `role="img"` on the pin. Re-ran → clean.
- **`users` has no RLS** — verified the `LEFT JOIN users` in the reader queries is not nulled by RLS (only `center_members`/`invites` carry policies in the auth migration); matches the existing `enrollments`/`staff`/`students` join idiom (`u.full_name`, `u.avatar_url`).
- **`store/generated/` is gitignored** — regenerated in CI; not in the File List. `client.ts` (web) IS tracked and is listed.
- **gofmt** flagged `question_handler.go` struct alignment after the field additions; `gofmt -w` applied.

### Completion Notes
- **Thin full-stack, single commit** (additive read-shape fields + one read-query widening; sole consumer is this story — mirrors the 7-2b/7-3b co-finalize, no atomic cross-service PR ceremony).
- **Task 1 (backend, AC5/AC13):** `api.yaml` `Question` enriched with `studentName`/`studentAvatarUrl`, `QuestionReply` with `authorName`/`authorAvatarUrl` (all `nullable`, added to `required`, PROVISIONAL markers stripped). `questions.sql`: `LEFT JOIN users` on the three reader queries; `GetQuestionForReader` student branch widened to `own OR (active-enrollment AND EXISTS shared reply)`. Service structs + converters + handler response structs carry the fields (GO-5 explicit nulls). `codegen.sh` re-run. Adversarial store test `question_ac5_widening_test.go` (classmate reaches shared thread; personal-only/unanswered still 404; asker/teacher/owner unchanged; + enrichment assertion).
- **Task 2 (data idiom, AC15):** `features/questions/` mirrors `features/people/` — `questionsKeys` factory, no-loader `useQuestions`/`useQuestionThread`, non-optimistic `useQuestionActions` (ask/reply/resolve/batch → `invalidateQueries(questionsKeys.all)`), `lib/questionAnchor` (handle↔anchor, own trivial handle parser — no cross-feature import, TS-7), `lib/questionSchemas` (RHF/zod composer forms), MSW `questionHandlers`, feature barrel.
- **Task 3 (AC14):** `AnchoredQuestionCard` gained a controlled teacher composer (submit + send-&-resolve callbacks, personal/shared visibility toggle, `maxLength=5000`) + orange/blue anchor pin (`role="img"`). Stays presentational — driven by the `reply` prop; view-model mapping in `lib/questionCardModel`.
- **Task 4 (student rail s36, AC1–AC4):** `StudentQuestionPanel` mounted in `ExerciseAttemptShell`; `?questions=open` URL-state (replace:true, deleted on close) → modal Sheet (base-ui focus-trap + return-focus, AC16); scope chooser (This item / Whole exercise / Selected passage); passage capture via `captureSelectionOffsets` on `[data-qa-passage][data-section-index]` (added to the shell's reading sections); own-thread read via per-thread `StudentQuestionThread`; UX-1 trilogy. Ask body is `{assignmentId, anchorType, anchorRef?, anchorExcerpt?, content}` only — never classId/studentId (SEC-7, asserted).
- **Task 5 (teacher console s18, AC6–AC11):** new teacher-gated `/questions` route; `QuestionsConsolePage` over `AnchoredQuestionsRailShell` + `BatchActionBar` (domain shells) + `TeacherQuestionCard` (feature wrapper owning per-card RHF + reply/resolve mutations, multi-select checkbox, standalone resolve); Unanswered filter (`?unanswered`); batch all-or-nothing (404 surfaces error, selection retained, no partial). Pagination prev/next.
- **Task 6 (AC12/16/17):** teacher sidebar link repointed `/exercises/active?questions=open` → `/questions`; student sidebar link parked (comment, key kept for Epic 8/s29); `SectionNameKey += 'questions'`; `questions.*` + `anchoredQuestion.*` keys + `app.permissionDenied.section.questions.header` in both locales.
- **Task 7:** red→green FE tests (26 questions tests) — three-state trilogy, reply/send-&-resolve body assertions, batch all-or-nothing, role-absence gate (TEST-FE-6: console absent from DOM for student/owner/admin), ask SEC-7 body, axe, i18n both locales; i18n-parity `STORY_7_4B_KEYS`; `FU-7-4-F` filed, `FU-7-4-E` marked resolved.

**Deviations from spec:** none material. Interpretations: the "? Ask about this" item affordance is realized as the panel's "This item" scope chooser (uses the focused handle) rather than a per-question inline button in the shell; passage selection opens/scopes the rail. The item anchor's `anchorExcerpt` is snapshotted from the `qwrap-<handle>` DOM `textContent` (generic, schema-agnostic). A small isolated `questionFormat.ts` is the TS-6 formatting layer (no repo-wide date formatter existed).

### Implementation Plan (as executed)
1. Confirmed D5 (enrich). Marked in-progress.
2. Parallel recon (people idiom · attempt shell/anchoring · routes/sidebar/i18n) while reading the Q&A backend directly.
3. Task 1 backend WF-1 order: `api.yaml` → `questions.sql` → `codegen.sh` → service/handler structs → adversarial store test → go build/vet/gofmt + Q&A `-race -p 1` green.
4. Tasks 2→6 frontend bottom-up (data layer → card → student panel + shell wiring → teacher console + domain shells + route → sidebar/i18n/section-key).
5. Task 7: tests, `tsc -b` = 0, questions suite + touched-area regression green, docs.

## File List

### Added
- `classlite-api/internal/test/question_ac5_widening_test.go` — AC5 adversarial store test (GetQuestionForReader widening + enrichment).
- `classlite-web/src/components/domain/AnchoredQuestionsRailShell.tsx` — layout-only rail (count + filter + batch slot + stack).
- `classlite-web/src/components/domain/BatchActionBar.tsx` — controlled batch-reply strip (AC10).
- `classlite-web/src/features/questions/index.ts` — feature barrel.
- `classlite-web/src/features/questions/QuestionsConsolePage.tsx` — teacher console (AC6–AC11).
- `classlite-web/src/features/questions/api/questionsKeys.ts` — query-key factory (AC15).
- `classlite-web/src/features/questions/api/useQuestions.ts` — list + thread reads.
- `classlite-web/src/features/questions/api/useQuestionActions.ts` — ask/reply/resolve/batch mutations.
- `classlite-web/src/features/questions/api/__tests__/questionHandlers.ts` — MSW builders.
- `classlite-web/src/features/questions/components/StudentQuestionPanel.tsx` — in-attempt rail (AC1–AC4).
- `classlite-web/src/features/questions/components/StudentQuestionThread.tsx` — per-thread own-question card.
- `classlite-web/src/features/questions/components/TeacherQuestionCard.tsx` — console card wrapper (RHF + reply/resolve + select).
- `classlite-web/src/features/questions/lib/questionAnchor.ts` — handle↔anchor mapping + pin tone.
- `classlite-web/src/features/questions/lib/questionCardModel.ts` — wire→card view-model mappers.
- `classlite-web/src/features/questions/lib/questionFormat.ts` — TS-6 timestamp formatter.
- `classlite-web/src/features/questions/lib/questionSchemas.ts` — RHF/zod composer forms.
- `classlite-web/src/features/questions/__tests__/QuestionsConsolePage.test.tsx`
- `classlite-web/src/features/questions/__tests__/QuestionsRoutesGate.test.tsx`
- `classlite-web/src/features/questions/__tests__/StudentQuestionPanel.test.tsx`
- `_bmad-output/implementation-artifacts/7-4b-anchored-qa-frontend-completion-notes.md` — this file.

### Modified
- `classlite-api/api.yaml` — enriched `Question`/`QuestionReply` read shapes (display name + avatar); stripped PROVISIONAL markers.
- `classlite-api/internal/store/queries/questions.sql` — `LEFT JOIN users` on 3 reader queries; widened `GetQuestionForReader` student branch (AC5).
- `classlite-api/internal/service/question_service.go` — `Question`/`QuestionReply` structs + reader-row converters carry display fields.
- `classlite-api/internal/handler/question_handler.go` — `questionResponse`/`questionReplyResponse` carry display fields (GO-5).
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript). Do not hand-edit (XL-1).
- `classlite-web/src/components/domain/AnchoredQuestionCard.tsx` — controlled teacher composer + visibility toggle + pin + maxLength (AC14).
- `classlite-web/src/features/quiz-attempt/components/ExerciseAttemptShell.tsx` — mounts `StudentQuestionPanel`, header "Questions" toggle, `data-qa-passage` on reading sections.
- `classlite-web/src/routes.tsx` — new teacher-gated `/questions` route.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `SectionNameKey += 'questions'`.
- `classlite-web/src/components/domain/sidebarNavConfig.tsx` — teacher link → `/questions`; student link parked.
- `classlite-web/src/locales/en.json`, `vi.json` — `questions.*` + `anchoredQuestion.*` + permissionDenied section header (parity).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — `STORY_7_4B_KEYS` parity block.
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-7-4-F filed; FU-7-4-E marked resolved.

### Deleted
- none.

### Gitignored (regenerated, not tracked)
- `classlite-api/internal/store/generated/questions.sql.go` — sqlc output (new reader-row display columns).
