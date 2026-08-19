# Story 6-1-writing-grading-with-anchored-comments: Completion Notes

_Implementation record for [`6-1-writing-grading-with-anchored-comments.md`](./6-1-writing-grading-with-anchored-comments.md). Status: review._

## Dev Agent Record

### Debug Log

- **`current_grades` view RLS leak (Task 1).** A Postgres view runs RLS as its **owner** (the migration/superuser role) unless created `WITH (security_invoker = true)`. Added `security_invoker=true` so the base-table `grades_select` policy is evaluated as `classlite_app` under its tenant GUC. Proven by `TestRLS_Grades_CrossTenantRead` (asserts the view returns 0 cross-tenant rows).
- **Trigger poisons the savepoint tx (Task 7).** The `RAISE`/REVOKE'd-UPDATE error poisons the `SetupDB` savepoint tx; multi-statement assertions after them use explicit `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`.
- **`getAnimations` jsdom gap (Task 11).** base-ui's `ScrollArea` (inside `WritingGradingSurface`'s rail) calls `viewport.getAnimations()` on a post-mount timer → uncaught exception in jsdom. Stubbed `Element.prototype.getAnimations = () => []` in `vitest-setup.ts` (same class as the existing ResizeObserver/matchMedia stubs).

### Completion Notes

- **Structure deviation (documented).** The pure scorer + validation live in `internal/service/grading/` (per spec), but **`GradingService` lives in package `service`** (`grading_service.go`) so it reuses the attempt tenant-tx helpers, the answer-strip exercise mapper (`toAttemptExercise`), and the pg/uuid helpers — no import cycle, no duplication. The handler references `service.GradingService`.
- **Concurrency contract (resolves a spec-internal contradiction).** The **grade** path takes the submission `FOR UPDATE` lock → the loser sees `graded` → 409 `SUBMISSION_ALREADY_GRADED` with zero side effects. The **revise** path does NOT serialize on a lock — it relies on `UNIQUE(submission_id, version)` → 23505 → 409 `GRADE_REVISE_CONFLICT` (a serializing lock would make 23505 impossible, contradicting AC6/Task7). Both proven under `-race`.
- **Outbox (D2).** No outbox table exists; reused the 4.3a **jobs** infra — a `grade_release_email` job inserted inside the grade tx; a new `worker.GradeReleaseEmailHandler` on the existing pool dispatcher publishes `event.GradeReleased` + sends the Resend email post-commit, behind `GRADE_RELEASE_EMAIL_ENABLED`. Render func injected so `worker` need not import `service`.
- **Draft (D4).** Reused the attempts-spine **localStorage** mirror pattern (not IndexedDB — D4 permits either; spec says "follow the attempts-spine pattern"). `useGradingDraft` seeds from localStorage, writes through in the setter (no useEffect — FW-4).
- **AC11 authz.** Route `RequireRole(owner,admin,teacher)` → `INSUFFICIENT_ROLE` for students; in-service teacher-of-class → 403 `FORBIDDEN` for a same-tenant wrong-class teacher; cross-tenant/absent → 404 via RLS (no oracle). Write paths revalidate the DB role (SEC-1).
- **Highlight painting.** Inline `<mark>` in `essayHtml` (the shell's contract — wraps across lines natively) rather than a `getClientRects` overlay; escaped-then-marked (XSS).
- **Thinner-coverage areas** (see deferred-work FU-6-1 notes): handler-layer HTTP integration tests, and several FE interaction-level tests (selection-snapshot-survives-composer, reciprocal focus, overlap DOM focus, component-level draft round-trip, already-graded→revise, role-negative). The service layer + pure libs are thoroughly tested.

### Implementation Plan (summary)

1. Migrations (grades append-only + `current_grades` view + immutability trigger) → migrate + verify.
2. sqlc queries (grades + submission grading + reuse `InsertJob` outbox) → generate.
3. api.yaml (4 endpoints + schemas + `/result` grade block) → codegen.
4. Scorer (integer eighth-space) + validation + `GradingService` (grade/revise/read/queue).
5. Handler + `/result` extension + email template + worker outbox handler + config flag + main.go wiring.
6. Backend tests: RLS/trigger/scorer/translate/service/concurrency(`-race`)/outbox — all green.
7. FE libs (computeOverallBand, essayAnchors, gradingDraft) + hooks (gradingKeys + 4 hooks).
8. `WritingGradingPage` (surface + band inputs + composer + queue + dialogs + seam).
9. Route (full-bleed, staff-gated) + i18n (en+vi parity) + a11y (title/focus).
10. FE tests (lib parity/XSS/offsets/draft + component trilogy/overall/POST-omits-overallBand/seam) — 42 green.
11. Docs (epic amendment, deferred-work FUs, manual-setup flag, trigger convention note).

## File List

### Added — Backend
- `classlite-api/migrations/20260818120000_create_grades.up.sql` / `.down.sql`
- `classlite-api/migrations/20260818130000_add_submission_release_trigger.up.sql` / `.down.sql`
- `classlite-api/internal/store/queries/grades.sql`
- `classlite-api/internal/service/grading/scorer.go` + `scorer_test.go`
- `classlite-api/internal/service/grading/validation.go`
- `classlite-api/internal/service/grading_service.go`
- `classlite-api/internal/service/grading_translate_test.go`
- `classlite-api/internal/handler/grading_handler.go`
- `classlite-api/internal/worker/grade_release.go` + `grade_release_test.go`
- `classlite-api/internal/test/grades_rls_test.go`
- `classlite-api/internal/test/submission_immutable_trigger_test.go`
- `classlite-api/internal/test/grading_service_test.go`
- `classlite-api/internal/test/grading_concurrency_test.go`

### Added — Frontend
- `classlite-web/src/features/grading/index.ts`
- `classlite-web/src/features/grading/WritingGradingPage.tsx`
- `classlite-web/src/features/grading/api/{gradingKeys,useGradingSubmission,useGradingQueue,useGradeSubmission,useReviseGrade}.ts`
- `classlite-web/src/features/grading/lib/{computeOverallBand,essayAnchors,gradingDraft}.ts`
- `classlite-web/src/features/grading/lib/__tests__/{computeOverallBand,essayAnchors,gradingDraft}.test.ts`
- `classlite-web/src/features/grading/__tests__/WritingGradingPage.test.tsx`

### Modified
- `classlite-api/internal/store/queries/submissions.sql` — LockSubmissionForGrading / GradeSubmission / ListGradingQueue.
- `classlite-api/internal/model/job_types.go` — `JobTypeGradeReleaseEmail` + `GradeReleaseEmailParams`.
- `classlite-api/internal/config/config.go` + `.env.example` — `GRADE_RELEASE_EMAIL_ENABLED` + `APP_RESULT_URL_BASE` + `getEnvBool`.
- `classlite-api/internal/service/email_templates.go` — `RenderGradeReleasedEmail`.
- `classlite-api/internal/service/attempt_service.go` — `/result` grade block + `released` flip off `released_at` (AC10/D1).
- `classlite-api/internal/handler/attempt_handler.go` — `studentGradeViewResponse` (excludes `graded_by`).
- `classlite-api/cmd/api/main.go` — construct `GradingService` + 4 staff-gated routes; grade-release handler on the dispatcher; `eventBus` hoisted.
- `classlite-api/api.yaml` — 4 grading endpoints + `Grade`/`GradeInput`/`ReviseGradeInput`/`AnchoredComment`/`CriterionScores`/`TeacherGradingView`/`GradingQueueRow`/`StudentGradeView`/`GradingStudent` + envelopes + `grade` on `StudentSubmissionResult`.
- `classlite-web/src/lib/api/client.ts` — regenerated (codegen).
- `classlite-web/src/routes.tsx` — full-bleed `/classes/:id/grading/:aid/:sid` route.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `'grading'` SectionNameKey.
- `classlite-web/src/locales/{en,vi}.json` — `criterion.taskResponse`/`grammaticalRange` + `writingGrading.criterion.none` + `grading.*` + permission-denied header (en+vi parity).
- `classlite-web/src/test/vitest-setup.ts` — `Element.prototype.getAnimations` stub.
- `docs/project-context.md` — trigger-convention precedent note (WF-2).
- `docs/manual-setup.md` — grade-release env vars.
- `_bmad-output/planning-artifacts/epics/epic-06.md` — 6.1 implementation amendments.
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-6-1-A..D + implementation-note follow-ups.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 6-1 → in-progress → review.

### Deleted
- (none)

## Party-Mode Review Appendix

_(none — pre-dev party-mode review is folded into the story spec's Decisions D1–D4.)_
