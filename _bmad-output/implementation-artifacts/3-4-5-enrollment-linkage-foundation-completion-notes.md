# Story 3-4-5: Completion Notes

_Implementation record for [`3-4-5-enrollment-linkage-foundation.md`](./3-4-5-enrollment-linkage-foundation.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-flight (memory rule `check_prior_story_artifacts`)**: grepped the tree for any existing enrollment artifacts. Confirmed a **clean slate** — no `enrollments` table/store/service/handler existed; only the dormant `event.EnrollmentChanged` constant + doc placeholders. Genuine build, not a duplicate.
- **DB was down at pickup** (port 5432 closed, no containers). Started `docker compose up -d postgres`; `classlite_app` role present; migrations at `20260721120000` clean. Applied the new migration via `scripts/migrate.sh up` and verified a down/up round-trip.
- **`uuidFromPg` collision**: my draft re-declared a `uuidFromPg` helper already in `class.go` (single-return). Removed the duplicate and reused the existing one — the post-insert enrollment id is always valid.
- **POST response shape**: the single api.yaml `Enrollment` schema requires `studentName`/`studentEmail`, but `CreateEnrollment` returns only the enrollment row. Rather than split into two schemas, the service now re-reads the student via the existing `GetUserByID` (users is a global no-RLS table — safe inside the tenant tx) and returns an `EnrolledStudent{Enrollment, StudentName, StudentEmail}`; both endpoints render the same wire shape.
- **Full-regression flake (pre-existing, NOT this story)**: `TestAdversarial_TokenEntropy` failed `expected 200 tokens, got 201`. Root cause: one committed `email_verifications` residue row (`bearer-test@example.com`, dated **2026-07-23** — from the prior auth/bearer commit `5acdb35`) that the test counts inside its tx snapshot. This story touches zero auth/email files. Purged the single orphaned `email_verifications` row from the local dev DB; TokenEntropy and the full suite then went green. Flagged for the reviewer — the test has a latent isolation bug (counts committed residue) that is out of scope here.

### Completion Notes

- **All 6 ACs satisfied.** Backend-only enabler, no frontend (no student members exist to enroll yet — 2.6 rejects student invites, 2.7 halted). Tests exercise the full path via `student` center-member fixtures.
- **AC1** — `enrollments` table ships verbatim to the 7.3 spec: `id/center_id/student_id/class_id/enrolled_at/withdrawn_at/status(active|withdrawn|transferred)/created_at/updated_at`, 4-policy `FORCE ROW LEVEL SECURITY` grid copied from `classes`. FKs: `center_id`→centers CASCADE, `class_id`→classes CASCADE, `student_id`→users NO-ACTION (preserve history). `updated_at` has no trigger (matches classes convention).
- **AC2** — `POST /api/enrollments` Admin/Owner-only, role **re-validated from `center_members`** (SEC-1/R15), not the JWT. Validations: class-in-center (else 404 `CLASS_NOT_FOUND`), is-student-member (else 422 `NOT_A_STUDENT_MEMBER`), not-already-active (else 409 `ALREADY_ENROLLED`). Teacher/Student → 403 `INSUFFICIENT_ROLE`.
- **AC3** — `GET /api/classes/{classId}/enrollments` roster joined to `users`, ORDER BY full_name; owner/admin center-wide, teacher-scoped to own classes (cross-teacher → 404, teacher-sees-nothing — reuses `assertClassRole`/`assertTeacherScope` from `class_lifecycle.go`).
- **AC4** — partial-unique `uq_enrollments_active (class_id, student_id) WHERE status='active'` is the suspenders; a service pre-check + a 23505→409 belt map to `ALREADY_ENROLLED`. A historical `withdrawn` row may coexist with a fresh `active` (proven).
- **AC5** — full 6-pattern RLS adversarial grid (read/write/delete/null/unset/reparent) + role-negative (Teacher→403) all green.
- **AC6** — table + `CreateEnrollment` + `ListEnrolledStudentsByClass` exist; `deferred-work.md` SEQ-2-7-1 + FU-3-4-A marked resolved-by-3.4.5.

**New error codes:** `ALREADY_ENROLLED` (409) reuses `model.ConflictError` with an explicit `Code` (no new mapper arm needed); `NOT_A_STUDENT_MEMBER` (422) got a new pointer type `service.NotAStudentMemberError` + a mapper arm (the generic `ValidationError` arm would flatten it to `VALIDATION_ERROR`).

**Deviations from the spec (pragmatic, per project convention):**
1. **"Service tests (mock store seam, TEST-BE-4)"** — the codebase has **no store-interface seam** for these services (they call `generated.New(tx)` directly, like `SessionService`/`ClassService`). The dominant convention is real-DB service/handler tests with a mock *audit* logger. The role-negative + validation business rules (403/422/409) are therefore proven through **handler integration tests** (real middleware + real DB, TEST-BE-3), matching the 3.1/3.4 precedent, plus the store/RLS adversarial layer. No mock-store seam was invented.
2. **FU-3-5-A** does not yet exist in `deferred-work.md` — it is an entry Story 3.5's own dev pass will *create* (3.5 is still `ready-for-dev`), and the 3.5 story already names 3.4.5 as its resolved dependency. The shared enrollments-data root (SEQ-2-7-1, FU-3-4-A) is resolved in `deferred-work.md` instead.

**Not built (stays in Story 7.3):** transfer/withdraw, `withdrawn_at` writes, `enrollment_history` + INSERT-only RLS, notifications, the compose/history console UI. `event.EnrollmentChanged` is NOT emitted — the bus is unwired; a `// 7.3: emit EnrollmentChanged once the bus is wired` marker is left in the service. No `docs/manual-setup.md` change (no new env var/service — WF-9).

### Implementation Plan (summary)

1. Pre-flight recon (clean-slate confirmation) + read every reference file (migration/RLS grid, sqlc, service tx ceremony, error mapper, handler, routing, test helpers).
2. Started Postgres; marked story in-progress (sprint-status + story file).
3. **T1** migration `20260722120000_create_enrollments` {up,down} → `migrate.sh up` → verified table/policies/indexes + down/up round-trip.
4. **T2** `enrollments.sql` (CreateEnrollment / ListEnrolledStudentsByClass / GetActiveEnrollment / IsStudentMemberOfCenter).
5. **T4a** api.yaml additive schemas + 2 paths → `codegen.sh` (sqlc + openapi-typescript) → verified generated Go types.
6. **T3** `enrollment_service.go` + `NotAStudentMemberError` + error-mapper arm; full backend build.
7. **T4b** `enrollment_handler.go` + routes in `main.go`; full build.
8. **T5** RLS/store adversarial tests (11) + handler test-server helper + handler integration tests (12); ran green.
9. **T5 close** `gofmt -w` new files, `go vet ./...`, full regression (green after clearing pre-existing residue).
10. **T4c/T6** final `codegen.sh` (idempotent, last script); `deferred-work.md` close-out; story finalize → review.

## File List

### Added

- `classlite-api/migrations/20260722120000_create_enrollments.up.sql` — `enrollments` table + 4-policy FORCE RLS + partial-unique active guard + 3 indexes.
- `classlite-api/migrations/20260722120000_create_enrollments.down.sql` — reverses (DROP TABLE cascades policies/indexes).
- `classlite-api/internal/store/queries/enrollments.sql` — CreateEnrollment / ListEnrolledStudentsByClass / GetActiveEnrollment / IsStudentMemberOfCenter.
- `classlite-api/internal/service/enrollment_service.go` — `EnrollmentService`: Admin/Owner DB-revalidated Add + teacher-scoped roster read.
- `classlite-api/internal/handler/enrollment_handler.go` — `EnrollmentHandler`: POST create + GET roster, `{data,meta}` envelope.
- `classlite-api/internal/test/enrollments_rls_test.go` — 6-pattern RLS grid + partial-unique/coexist + FK cascade/restrict (11 tests).
- `classlite-api/internal/test/story_3_4_5_helpers.go` — `NewEnrollmentTestServerBareMux`.
- `classlite-api/internal/handler/enrollment_handler_atdd_test.go` — 12 handler integration tests (role matrix, validations, roster teacher-scope).

### Modified

- `classlite-api/api.yaml` — additive (186 insertions, 0 deletions): `Enrollment`/`EnrollmentStatus`/`CreateEnrollmentRequest`/`EnvelopeEnrollment`/`EnvelopeEnrollmentList` schemas + `POST /api/enrollments` + `GET /api/classes/{classId}/enrollments` paths.
- `classlite-api/internal/service/errors.go` — added `NotAStudentMemberError` (422).
- `classlite-api/internal/middleware/error_mapper.go` — added the `NOT_A_STUDENT_MEMBER` arm.
- `classlite-api/cmd/api/main.go` — wired the `enrollmentChain` + 2 routes alongside the sessions block.
- `classlite-web/src/lib/api/client.ts` — regenerated (openapi-typescript, additive).
- `_bmad-output/implementation-artifacts/deferred-work.md` — SEQ-2-7-1 + FU-3-4-A marked resolved-by-3.4.5; 7.3-now-consumes note.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `3-4-5` `ready-for-dev → in-progress → review`.
- `_bmad-output/implementation-artifacts/3-4-5-enrollment-linkage-foundation.md` — task/DoD boxes, Status → review, Change Log.

### Generated (gitignored — not committed; regenerated by `codegen.sh`)

- `classlite-api/internal/store/generated/enrollments.sql.go` + `models.go` (`Enrollment` struct) — sqlc output.

### Deleted

- _(none in the repo.)_ One orphaned local-dev-DB row purged (`email_verifications` for `bearer-test@example.com`, leaked 2026-07-23 residue) to clear a pre-existing `TestAdversarial_TokenEntropy` isolation flake — DB hygiene only, no code/schema change.
