# Story 5-5b: Completion Notes

_Implementation record for [`5-5b-submission-result-view-graded.md`](./5-5b-submission-result-view-graded.md). Status: review._

## Dev Agent Record

### Debug Log

- **essayAnchors lift (W1/D-LIFT).** Moved `essayAnchors.ts` + its test from `@/features/grading/lib/` to `@/lib/` via `git mv` (rename preserved history). Only two importers: `WritingGradingPage.tsx` (re-pointed to `@/lib/essayAnchors`) and the moved test (`../essayAnchors` still resolves — both siblings in `src/lib`). `grading/*` suite green after the move (47 tests incl. essayAnchors).
- **Combining-mark fixture bug.** The shared `WRITING_ANCHOR_FIXTURE` combining grapheme was ambiguous as a literal (precomposed U+00E9 vs decomposed `e`+U+0301). Pinned it as decomposed (2 UTF-16 units) and made the gradeComments test compare against the fixture's own `WRITING_ANCHOR_EXPECTED_SLICES` (single source of truth) rather than a precomposed literal.
- **jsdom localStorage override.** `window.localStorage.getItem = …` does NOT take effect in jsdom (getItem lives on `Storage.prototype`, non-writable on the instance) — the real getItem returned null and the throw-path never executed. Switched both throwing-storage tests to `vi.spyOn(Storage.prototype, 'getItem')`.
- **resultSeen broken-store default.** `safeGet` returning `null` on a throw conflated "absent" (unread) with "storage threw". Refactored to `hasSeen()` returning `true` on any failure → a broken store defaults to **seen** (no stuck "new result" dot that can never clear), matching the best-effort/per-device framing.

### Completion Notes

**FRONTEND-ONLY, as scoped.** No api.yaml / codegen / Go / SQL / migration touched (WF-3 — no `.sql`/`api.yaml` change, so no `codegen.sh`). 6.1 had already shipped `released` + `grade` on `GET /api/assignments/{id}/result`; 5-5b consumes them.

Shipped (net epic ACs #1-5,7,8):
- **Released branch on the durable shell** — `SubmissionReviewShell` gained `released` + `grade` props (threaded from `SubmissionReviewPage`, derived off the existing `/result` cache — no new query/hook). `released && grade !== null && skill === 'writing'` renders `StudentGradeBlock` above the read-back, suppresses `NotReleasedNote`, and swaps the plain readback for `GradedEssay`. `released` is the SOLE gate (D2); `released && grade === null` is treated as pending (AC12 invalid-state); a released non-writing grade routes to a "coming soon" state where `buildEssayHtml` is never called (D6/W7).
- **Band-ring hero** — server-authoritative `grade.overallBand` to one decimal in a static, neutral-stroke ring (no motion, not band-tinted). Never recomputed client-side.
- **Per-criterion breakdown** — four bars with pinned-comment counts (grouped by criterion), error-pin → the only sanctioned red border (`data-has-error`), strength-first coaching (a REQUIRED focus area, degrading to a neutral "keep it up" on a uniform essay — no manufactured weakness).
- **Read-only anchored comments** — `GradedEssay` reuses the SHARED `buildEssayHtml` + `anchorToneClass` for ALL anchor visuals (no local re-derivation); `gradeComments.ts` maps the wire enum (exhaustive `suggestion→suggest`), splits anchored vs whole-essay (via the shared `normalizeAnchor` — same demotion the builder applies), and counts pins. Whole-essay + demoted comments collapse into a "General notes" group so every teacher comment is reachable (count parity). `CommentCard` gained an additive `readOnly` prop that suppresses ALL interactive affordances (the footer), default `false` keeps teacher behavior byte-for-byte.
- **Feedback quote + D-ACK** — `FeedbackQuoteBox` renders `grade.feedback` as an escaped React text node (never `dangerouslySetInnerHTML`), generic attribution ("Your teacher"), plus one honest read-only acknowledgment line and NO reply-shaped affordance.
- **Late-penalty math** — `LatePenaltyBreakdown` arranges `grade.overallBand − submission.appliedPenalty = final` in the exact FR-31 string, neutral/never-red, ABSENT when on-time (no phantom "0.0" line). Verified no double-subtraction: `overallBand` is the pure IELTS mean, `appliedPenalty` a separate submission snapshot.
- **`/result` redirect alias (D-ROUTE)** — registered as a `loader → redirect('…/submission')` (not a duplicate page).
- **Mobile s79** — `GradedEssay` uses `useIsDesktop()`: desktop = essay + side rail; mobile = comments stacked full-width below the essay (not a cramped rail). Grade-block skeleton added to the loading path (band-ring + criteria placeholders, hero before essay).
- **Release discovery (D-DISCOVERY)** — `@/lib/resultSeen.ts` per-device localStorage ledger; `SubmissionReviewPage` marks a released result seen on mount; `AssignmentRow` shows a "new result" unread indicator on `graded` rows (accessible label, not colour-only). Keyed by `assignmentId` only (the list row has no `gradedAt`) — re-grade re-arm limitation tracked in FU-5-5b-DISCOVERY.

**Deviations / pragmatic calls:**
- **Mobile "inline-under-line" (AC10)** — implemented as a full-width comment stack BELOW the essay rather than literal per-line card injection into the `dangerouslySetInnerHTML` essay blob (which is brittle and would risk offset drift). This satisfies the intent (mobile isn't a cramped side rail; comments are full-width and reachable) and sidesteps the AC7a accordion-tearing concern entirely (there is no per-line accordion). Flagged for reviewer awareness.
- The band-ring `aria-label` is the interpolated overall-band label ("Overall band 6.0") — asserted to equal exactly that (AC11 "nothing appended").

**WF-8 RED-first coverage** on the four risk ACs: XSS capability-absence on a malicious comment/feedback; cross-side slice-equality via the shared `WRITING_ANCHOR_FIXTURE`; released = RENDER gate (not visibility); non-writing skill-gate (`buildEssayHtml` never called, asserted via a call-through spy). Plus teacher-path regression pins on `CommentCard readOnly` before the change.

### Implementation Plan (as executed)

1. Task 0 recon + contract verification (grade nullable, shell seam, essayAnchors, CommentCard footer).
2. W1 — `git mv` essayAnchors to `@/lib`; re-point importers; grading suite green.
3. Task 2 — `CommentCard readOnly` (RED CommentCard test first) + teacher regression pin in `WritingGradingPage.test.tsx`.
4. Task 3 — `gradeComments.ts` + unit test (shared fixture); `FeedbackQuoteBox`, `LatePenaltyBreakdown`, `StudentGradeBlock`, `GradedEssay`.
5. Task 4 — thread `released`/`grade` through shell + released/non-writing/invalid-state branches.
6. Task 5 — mobile split, grade-block skeleton, `/result` redirect route, barrel.
7. Task 5b — `resultSeen.ts` + page mount-seen + `AssignmentRow` unread indicator (+ unit + list tests).
8. Task 6 — `submissionReview.grade.*` + `assignments.unread.newResult` in both locales.
9. Task 7 — the graded integration suite (`SubmissionReviewGraded.test.tsx`) + assignments unread tests.
10. Task 8 — gates + docs.

### Gates (all green)

- `tsc --noEmit` — 0 errors.
- `eslint` — 0 on all changed/new files.
- `i18n-parity` — 728 passed (both locales).
- `vitest` full suite — **2556 passed / 190 files / 0 regressions** (incl. `grading/*` after the `readOnly` + essayAnchors-lift changes, and the 5-5a `submission-review/*` specs).
- No backend gates (no Go/api.yaml/migration touched).

## File List

### Added
- `classlite-web/src/features/submission-review/components/StudentGradeBlock.tsx` — band-ring hero + criteria + strength/focus + penalty + feedback + ack.
- `classlite-web/src/features/submission-review/components/GradedEssay.tsx` — highlighted essay (shared `buildEssayHtml`) + read-only comment rail/mobile stack + General notes + pin↔card scroll.
- `classlite-web/src/features/submission-review/components/FeedbackQuoteBox.tsx` — escaped feedback quote.
- `classlite-web/src/features/submission-review/components/LatePenaltyBreakdown.tsx` — neutral FR-31 penalty math.
- `classlite-web/src/features/submission-review/lib/gradeComments.ts` — wire→card map, anchored/whole-essay split, pinned tally, criterion insight.
- `classlite-web/src/features/submission-review/lib/__tests__/gradeComments.test.ts` — reader unit tests.
- `classlite-web/src/features/submission-review/__tests__/SubmissionReviewGraded.test.tsx` — the graded integration suite (WF-8 risk ACs).
- `classlite-web/src/lib/resultSeen.ts` — per-device unread ledger (D-DISCOVERY).
- `classlite-web/src/lib/__tests__/resultSeen.test.ts` — resultSeen unit tests.
- `classlite-web/src/lib/test/writingAnchorFixture.ts` — SHARED cross-side anchor fixture (multibyte hazards).
- `classlite-web/src/components/domain/__tests__/CommentCard.test.tsx` — `readOnly` regression pins.

### Moved (W1/D-LIFT)
- `classlite-web/src/features/grading/lib/essayAnchors.ts` → `classlite-web/src/lib/essayAnchors.ts` (shared tier; both teacher + student depend downward).
- `classlite-web/src/features/grading/lib/__tests__/essayAnchors.test.ts` → `classlite-web/src/lib/__tests__/essayAnchors.test.ts`.

### Modified
- `classlite-web/src/components/domain/CommentCard.tsx` — additive `readOnly` prop (suppresses the footer).
- `classlite-web/src/features/submission-review/components/SubmissionReviewShell.tsx` — `released`/`grade` props + released/non-writing/invalid-state branches + skill-gate.
- `classlite-web/src/features/submission-review/SubmissionReviewPage.tsx` — thread `released`/`grade`; mark-seen on mount; grade-block skeleton.
- `classlite-web/src/features/submission-review/index.ts` — barrel exports for the new components.
- `classlite-web/src/features/grading/WritingGradingPage.tsx` — re-point essayAnchors import to `@/lib`.
- `classlite-web/src/features/assignments/AssignmentRow.tsx` — "new result" unread indicator.
- `classlite-web/src/routes.tsx` — `/assignments/:assignmentId/result` redirect alias.
- `classlite-web/src/locales/en.json` + `vi.json` — `submissionReview.grade.*` + `assignments.unread.newResult`.
- `classlite-web/src/features/submission-review/__tests__/SubmissionReviewPage.test.tsx` — `grade: null` on the shared factory.
- `classlite-web/src/features/grading/__tests__/WritingGradingPage.test.tsx` — teacher `readOnly` regression pin.
- `classlite-web/src/features/assignments/__tests__/AssignmentsListPage.test.tsx` — unread-indicator tests.
- `_bmad-output/planning-artifacts/epics/epic-05.md` — Story 5.5 5-5b shipped note.
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-5-5-A cleared; FU-5-5b-SPEAKING/QUIZ/DISCOVERY logged.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 5-5b → in-progress → review.

### Deleted
- None.
