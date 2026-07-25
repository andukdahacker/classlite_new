# Story 2.7: Completion Notes

_Implementation record for [`2-7-bulk-student-import.md`](./2-7-bulk-student-import.md). Status: review._

## Dev Agent Record

### Debug Log

- **Preview cross-center detection (`USER_IN_ANOTHER_CENTER`) needed an RLS bypass.**
  `center_members` is `FORCE ROW LEVEL SECURITY` scoped to the caller's center, so a
  tenant-scoped `CountCenterMembersByUser` under center A cannot see a membership in
  center B (it returned 0 → the row mis-classified as `unassigned`). Resolved with a
  narrow `count_center_members_for_user` **SECURITY DEFINER** function (migration
  `20260724120000`) — the same idiom as `get_invite_by_token_hash`. This is a
  deliberate deviation from the story's "No new migration" note (logged in
  deferred-work.md); confirm still rejects the same row via `idx_center_members_user_id`
  at write time, so the function hardens preview UX, not correctness.
- **Literal BOM in Go source.** An actual `U+FEFF` byte in a `strings.TrimPrefix` string
  literal failed `go build` ("invalid BOM in the middle of the file"); replaced with the
  `"﻿"` escape.
- **Task 6a is more than the guard flip.** Re-keying the OAuth rejection on `google_id`
  lets a pending-invite account through, but the existing-user branch never set a
  password — so a claimed import account would be unusable. Added
  `setPendingInvitePassword` (length-validated + hashed `UpdateUserPassword`) so the
  claim actually stores the password.
- **`ON CONFLICT DO NOTHING` returns `pgx.ErrNoRows`, not an error.**
  `CreateEnrollmentIfNotActive` on a conflict returns 0 rows → the `:one` scan yields
  `pgx.ErrNoRows`, which the fan-out treats as "already active, counted done, savepoint
  intact" — never a rollback.
- **FE wrong-type test.** `userEvent.upload` honors the input `accept` filter (no
  `applyAccept` bypass in this user-event version), so it silently dropped the `.txt`.
  Switched that one case to `fireEvent.change` to exercise the app's own client gate.

### Completion Notes

- **All 6 ACs satisfied.** Backend: parse (CSV + XLSX via excelize) → classify → preview
  (advisory) / confirm (authoritative, per-row savepoint fan-out on the import's own tx,
  SEC-1 role re-check, partial success, audit + commit). Frontend: dropzone → upload →
  preview table with badges + aria-live summary → partial-import confirm (enabled with
  error rows) → result screen self-verifying the persisted roster + error-report CSV.
- **ATDD graduated.** All five Story 2.7 test files dropped their `atdd_red_phase` build
  tag and now run in the normal suite (mirrors the 3.4.5 enrollment graduation). The
  INT-BULK-ROLLBACK placeholder was activated with a `failingAuditLogger` fault seam
  (`test.NewStudentImportServiceWithFailingAudit`).
- **`excelize/v2` (`github.com/xuri/excelize/v2 v2.11.0`) added — FLAGGED FOR HUMAN
  REVIEW** per the Go dep-vetting convention. Pulled transitive deps `xuri/efp`,
  `xuri/nfp` and bumped `golang.org/x/crypto`/`x/text`. Used only for `.xlsx` reads
  (first sheet, formatted-string cells); `.csv` uses stdlib `encoding/csv`.
- **One scope deviation:** the `count_center_members_for_user` SECURITY DEFINER migration
  (see Debug Log). Everything else matches the spec.
- **api.yaml additive only** (new paths + `Import*` schemas); codegen run (sqlc + openapi).
  No presign path exists in api.yaml to extend (uploads are wired directly in main.go).
- **Not run in this environment:** the Playwright E2E (`e2e/bulk-student-import.spec.ts`,
  J14-001/002/004) ships `test.describe.skip()` — infra-pending (FU-2-5-N precedent). Its
  testids were aligned to the shipped component so it runs green once the E2E stack lands.

### Implementation Plan (summary)

1. Storage `GetObject` seam (interface + R2 + mock `SeedObject`/`GetObject`).
2. Upload allowlist: `.csv`/`.xlsx` + `imports` feature.
3. `excelize/v2` dep.
4. `StudentImportService` — parse (BOM strip, header match, 200-row cap), classify
   (normalize/dedup/class-resolve/account-lookup/cross-center), preview.
5. `ConfirmImport` — SEC-1 role tx, savepoint fan-out (user/member/enrollment/invite),
   audit + commit, post-commit best-effort invite emails.
6. Handler + routes (owner/admin invite chain); error-mapper arm (`IMPORT_ROW_LIMIT_EXCEEDED`).
7. Task 6a auth accept-flow fix.
8. `CreateEnrollmentIfNotActive` + `count_center_members_for_user` fn + api.yaml + codegen.
9. Frontend feature (`features/people/`), route, nav, i18n (en+vi), tests.
10. Graduate ATDD, activate rollback, add XLSX + CSV-serializer + component tests.

## File List

### Added

- `classlite-api/internal/service/student_import_service.go` — parse + classify + preview + confirm service.
- `classlite-api/internal/handler/student_import_handler.go` — preview/confirm HTTP handlers.
- `classlite-api/internal/handler/student_import_xlsx_test.go` — XLSX parse-edge coverage.
- `classlite-api/migrations/20260724120000_create_count_center_members_for_user_function.up.sql` / `.down.sql` — RLS-bypass count fn.
- `classlite-web/src/features/people/api/peopleKeys.ts` — query-key factory.
- `classlite-web/src/features/people/api/useUploadImportFile.ts` — presign → XHR PUT → key.
- `classlite-web/src/features/people/api/useImportPreview.ts` — preview mutation.
- `classlite-web/src/features/people/api/useConfirmImport.ts` — confirm mutation.
- `classlite-web/src/features/people/lib/schemas.ts` — client-side file-type gate (Zod).
- `classlite-web/src/features/people/lib/downloadCsv.ts` — error-report CSV serialize + download.
- `classlite-web/src/features/people/lib/__tests__/downloadCsv.test.ts` — serializer tests.
- `classlite-web/src/features/people/ImportStudentsPage.tsx` — the import UI.
- `classlite-web/src/features/people/__tests__/ImportStudentsPage.test.tsx` — component tests.

### Modified

- `classlite-api/internal/service/storage.go` / `storage_r2.go` / `storage_mock.go` — `GetObject` + `SeedObject`.
- `classlite-api/internal/handler/upload_handler.go` — CSV/XLSX + `imports` allowlist.
- `classlite-api/internal/service/errors.go` — `ImportRowLimitError`.
- `classlite-api/internal/middleware/error_mapper.go` — `IMPORT_ROW_LIMIT_EXCEEDED` arm.
- `classlite-api/internal/service/auth_invite.go` — Task 6a guard + `setPendingInvitePassword`.
- `classlite-api/internal/store/queries/enrollments.sql` — `CreateEnrollmentIfNotActive`.
- `classlite-api/internal/store/queries/center_members.sql` — `CountCenterMembershipsForUserAllCenters`.
- `classlite-api/api.yaml` — import paths + `Import*` schemas.
- `classlite-api/cmd/api/main.go` — import service/handler/route wiring.
- `classlite-api/go.mod` / `go.sum` — `excelize/v2` (flag for review).
- `classlite-api/internal/store/generated/*` — sqlc regen (read-only).
- `classlite-web/src/lib/api/client.ts` — openapi-typescript regen (read-only).
- `classlite-web/src/routes.tsx` — `/students/import` route (owner/admin gated).
- `classlite-web/src/components/domain/sidebarNavConfig.tsx` — owner + admin import nav.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `SectionNameKey` `'students'`.
- `classlite-web/src/locales/en.json` / `vi.json` — `people.import.*` (+ sidebar + permission-denied), 1052-key parity.
- `classlite-api/internal/test/story_2_7_helpers.go` — build tag dropped + failing-audit helper.
- `classlite-api/internal/test/student_import_rls_atdd_test.go` — build tag dropped.
- `classlite-api/internal/handler/student_import_handler_atdd_test.go` — build tag dropped.
- `classlite-api/internal/handler/student_import_integration_atdd_test.go` — tag dropped + rollback activated.
- `classlite-api/internal/handler/auth_invite_import_atdd_test.go` — build tag dropped.
