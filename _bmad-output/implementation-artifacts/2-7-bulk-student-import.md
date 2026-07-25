---
baseline_commit: ec818550507e4616490d0a85a66388b57d9fe64e
---

# Story 2.7: Bulk Student Import

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **FOUNDATION STORY (data-first, like keystone 3.4.5).** 2.7 ships the bulk-import write path + the first student members. **User-visible value is gated on Story 7.2** (the `s42` center-wide student list) and Story 7.3 (enrollment console) — both deferred. After 2.7, imported students exist in the DB + receive invite emails, but the only in-app surface is the ephemeral import-result screen. This is intentional; see Dev Notes → "Foundation framing & visibility."

## Story

As an Owner or Admin,
I want to import students from a CSV or Excel file,
so that I can onboard existing student rosters from spreadsheets without manual entry.

## Acceptance Criteria (BDD)

Source: `_bmad-output/planning-artifacts/epics.md:1641` (Story 2.7). **Governing FRs: FR-46 (enrollment Add path) + FR-11 (owner/admin gate).** 2.7 *creates the data consumed by* **FR-43** (center-wide student list) but does **not realize** FR-43 — that screen is Story 7.2. **MVP scope ruling (Ducdo, 2026-07-24):** the PRD post-MVP markers for spreadsheet import (`prd.md:270,943,950,999`) are **superseded** — 2.7 ships in MVP (decision trail in `deferred-work.md`).

1. **AC1 — Upload dialog accepts CSV/XLSX with expected columns.** **Given** an Owner or Admin on the import screen, **When** they open "Import Students", **Then** the upload affordance accepts `.csv` and `.xlsx` with expected columns `email`, `full_name`, `class_name` (optional). A row with no `class_name` imports as an **unassigned** student member (no enrollment) — the preview warns this student is not yet in any class.

2. **AC2 — Parse validation.** **Given** a file is uploaded, **When** the system parses it, **Then** intra-file duplicate emails are flagged (case/whitespace-insensitive), invalid email formats are reported, and files exceeding 200 data rows (header excluded) are rejected with a clear message.

3. **AC3 — Preview with per-row status + partial-import contract.** **Given** parsing completes with no file-level errors, **When** the preview renders, **Then** the user sees a table of parsed rows with status (`new_user`, `existing_user`, `validation_error`, `unassigned`) and a summary banner (e.g. "40 will import · 6 will be skipped"). **Confirm is ENABLED even with error rows** — it imports the valid rows and skips the invalid (partial import). Cancel is always available. (This is the deliberate contract — NOT `s65` disable-until-clean; see Dev Notes.)

4. **AC4 — Confirm creates users, members, enrollments, invites.** **Given** the user confirms, **When** the server processes, **Then** for each valid row: a `users` record is created for new emails, a `center_members(role='student')` row is upserted, an enrollment is created linking the student to the resolved class **via the enrollment sqlc queries run on the import's own transaction** (NOT the `EnrollmentService.CreateEnrollment` service method — see Dev Notes blocker), and a best-effort invite email is enqueued for new users.

5. **AC5 — Partial success + downloadable error report.** **Given** the import commits with some row-level errors, **When** the result screen renders, **Then** a downloadable error-report CSV lists failed rows with reasons, and successful rows are already persisted. (Partial success = per-row skips within a **committed** tx; a commit/audit failure is a full rollback → user retries, naturally idempotent.)

6. **AC6 — 200-row limit rejection.** **Given** more than 200 data rows, **When** the file is validated, **Then** the import is rejected with a message indicating the 200-row-per-import limit (exactly 200 passes, 201 rejects).

## Tasks / Subtasks

- [x] **Task 0 — ATDD red-phase tests (AC: 2,3,4,5,6) — MANDATORY BEFORE in-progress (WF-8).** 2.7 touches risk ≥6: **R1** (cross-tenant leakage=9), **R15** (SEC-1 role revalidation=6). (R17 enrollment-history is **Story 7.3**, not a 2.7 driver — do not gate on it.) R22 plan-cap deferred (see Task 12).
  - [x] Run `/bmad-tea AT 2-7`. Red tests for: E2E-J14-001/002/004; INT-BULK-001..004; **R1 adversarial** — import as tenant A creates zero rows visible to tenant B (read AND write) AND a **cross-tenant file-key** attempt (`centerB/imports/…` passed by center A) is rejected 403; **concurrency-idempotency** — two concurrent `ConfirmImport` of the same file → no double rows, constraint holds; **preview→confirm divergence** — class renamed between preview and confirm → confirm re-classifies, no crash.

- [x] **Task 1 — Storage: server-side object download (AC: 2,4).**
  - [x] Add `GetObject(ctx, key string) ([]byte, error)` to `StorageService` (`classlite-api/internal/service/storage.go:16`); implement on `R2StorageService` (`storage_r2.go`, S3 `GetObject`) + `MockStorageService` (`storage_mock.go`, seeded bytes for tests).

- [x] **Task 2 — Upload allowlist: CSV/XLSX under an `imports` feature (AC: 1).**
  - [x] Extend `allowedExtensions` (`classlite-api/internal/handler/upload_handler.go:17`) with `.csv→text/csv`, `.xlsx→application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; add `"imports": true` to `allowedFeatures` (`:29`). Key stays `{centerID}/imports/{uuid}.{ext}`.

- [x] **Task 3 — Parser dependency (AC: 2) — FLAG FOR HUMAN REVIEW.**
  - [x] Add `github.com/xuri/excelize/v2` for `.xlsx`; stdlib `encoding/csv` for `.csv`. **Flag the module for human review** in completion notes (Go dep-vetting convention). No other transitive tooling.

- [x] **Task 4 — Import service: parse + classify (preview) (AC: 2,3).** New `classlite-api/internal/service/student_import_service.go`.
  - [x] `PreviewImport(ctx, tc, key) (ImportPreview, error)`: **enforce tenant-key guard first** — `strings.HasPrefix(key, tc.CenterID+"/")` else `model.ForbiddenError` (GetObject bypasses RLS — mirror `upload_handler.go:134`). `Storage.GetObject(key)` → sniff ext from key.
  - [x] Parse: **strip UTF-8 BOM** before header read; CSV via stdlib; XLSX via excelize (**first sheet only**; coerce numeric/date-typed cells to string — Excel often types an email/number cell non-text). Header row required + column-name match; malformed/missing header → file-level `model.ValidationError` (0-persist contract, INT-BULK-002).
  - [x] Reject > `maxImportRows = 200` data rows → `*ImportRowLimitError` → 422 `IMPORT_ROW_LIMIT_EXCEEDED` (AC6; boundary: 200 ok / 201 reject / header excluded).
  - [x] **Normalize every email** (reuse/mirror `Spawn`'s `normalizeSpawnEmail` — lowercase + trim) before dedup and lookup. Per-row classify → `new_user | existing_user | validation_error | unassigned`: `net/mail.ParseAddress`; non-empty `full_name`; 2nd+ normalized-dup email in file → `validation_error`; optional `class_name` resolved in-Go against `ListClasses` (RLS-scoped, case-insensitive) — 0 → `validation_error` CLASS_NAME_NOT_FOUND, >1 → `validation_error` CLASS_NAME_AMBIGUOUS, absent → `unassigned`; `GetUserByEmail` (normalized) hit → `existing_user`, miss → `new_user`; user in **another** center (`CountCenterMembersByUser`>0 elsewhere, one-center invariant `idx_center_members_user_id`) → `validation_error` USER_IN_ANOTHER_CENTER. Return `{rows[], summary{total,willImport,willSkip,unassigned}}`.

- [x] **Task 5 — Import service: transactional create (confirm) (AC: 4,5).**
  - [x] `ConfirmImport(ctx, tc, key, importID) (ImportResult, error)`: tenant-key guard (as Task 4) → re-fetch + **re-parse + re-classify from scratch** (stateless; **preview is advisory, confirm is the authoritative contract**). Copy the **SEC-1 tx choreography from `enrollment_service.go:89`**: `db.Begin` → `store.SetTenantContext(tx,tc)` → `txQ := generated.New(tx)` → `txQ.GetCenterMemberByUserAndCenter` → assert `member.Role ∈ {owner,admin}` else `&ForbiddenError{Reason:"insufficient role"}` (403 INSUFFICIENT_ROLE, R15).
  - [x] **Per-row savepoint fan-out on the import's OWN tx** (mirror `ClassService.Spawn` savepoint mechanics `class.go:~295`): for each non-`validation_error` row — `SAVEPOINT`; new_user → `txQ.CreateUser` (NULL `password_hash`, NULL `google_id` — the invite-claim signal, see Task 6a); `txQ.UpsertCenterMemberWithRole(role='student')` (idempotent); if class resolved → `txQ.CreateEnrollmentIfNotActive` (**new ON CONFLICT DO NOTHING query, Task 7** — 0 rows ⇒ already active ⇒ counted done, NO error, savepoint intact); new_user → `txQ.CreateInviteFull` + best-effort `EmailRetryQueue.Enqueue` (buffer-full ⇒ `invitesSent:false`, never blocks). **Do NOT call the tx-owning `EnrollmentService.CreateEnrollment`** and **do NOT rely on catching 23505 to "continue"** (a unique violation aborts the savepoint — you cannot continue in it). Row error → `ROLLBACK TO SAVEPOINT`, record row failure, continue next row.
  - [x] `audit.LogWithinTx(tx, tc, "student.import", "center", centerID, {importID, created, failed})` (`audit.go:98`) → `Commit`. Only report success **after** commit. A commit/audit failure ⇒ full rollback ⇒ typed 500-ish retryable error (naturally idempotent on retry).
  - [x] Return `{rows[]{rowNumber,email,status,persisted,error?}, created, invitesSent, failed}`. `invitesSent:false` MUST be surfaced in the result + `slog.Warn` (best-effort email is a silent-drop risk — make it observable). `importID` = client correlation UUID (audit+slog only; **no imports dedup table**). Concurrency posture: same-file concurrent submit is guarded by the FE submit-lock (Task 8) + `uq_enrollments_active`; a losing concurrent row rolls back and is reported skipped — DB stays correct.

- [x] **Task 6 — Import handler + routes (AC: 3,4).** New `classlite-api/internal/handler/student_import_handler.go`.
  - [x] `POST /api/students/import/preview` `{key}` → `PreviewImport` → 200 `{data:ImportPreview}`.
  - [x] `POST /api/students/import` `{key, importId}` → `ConfirmImport` → 200 `{data:ImportResult}`.
  - [x] Wire both under the invites owner/admin chain (`classlite-api/cmd/api/main.go:370` `settingsInviteChain`: `extractTenant → requireVerified → requireCenter → RequireRole("owner","admin") → limit → ErrorMapper`). New typed errors in `classlite-api/internal/service/errors.go` + arms in `classlite-api/internal/middleware/error_mapper.go` (follow `NotAStudentMemberError` at `error_mapper.go:117`).

- [x] **Task 6a — Auth accept-flow fix: let pre-provisioned students set a password (AC: 4) — SHARED-SURFACE, handle with care.**
  - [x] `auth_invite.go:88` rejects any existing user with NULL `password_hash` + submitted password as OAuth-only (`PasswordNotAllowedForOAuthUserError`, 409). Imported students are pre-created with NULL `password_hash` **and NULL `google_id`**, so they'd be permanently locked out. **Fix:** gate that rejection on `google_id` presence — reject only when the user is genuinely OAuth (`google_id IS NOT NULL`). A NULL-password + NULL-`google_id` user is a pending-invite account and may set a password on accept.
  - [x] Regression tests (this is auth — do not regress OAuth): (a) pre-provisioned student (NULL pw, NULL google_id) accepts invite w/ password → 201; (b) genuine OAuth user (NULL pw, google_id set) + password → still 409; (c) existing password user unaffected.

- [x] **Task 7 — api.yaml + new sqlc query + codegen (AC: all).**
  - [x] Add sqlc query `CreateEnrollmentIfNotActive` (`enrollments.sql`): `INSERT INTO enrollments (...) VALUES (...) ON CONFLICT (class_id, student_id) WHERE status='active' DO NOTHING RETURNING *`. Do NOT modify the existing `CreateEnrollment` (3.4.5's Add endpoint depends on its 23505→ALREADY_ENROLLED).
  - [x] `api.yaml` additive: paths `/api/students/import/preview` + `/api/students/import`; document the extended `/api/uploads/presign` `imports` feature. Schemas `ImportPreviewRow`/`ImportPreview`/`ImportResultRow`/`ImportResult`/request bodies — per-row shape modeled on `SpawnResult`/`SpawnInviteEntry` (`api.yaml:2554`); `{data,meta}` envelope, no `omitempty` (GO-5). Codes: 401 / 403 INSUFFICIENT_ROLE / 404 IMPORT_FILE_NOT_FOUND / 413 / 422 IMPORT_ROW_LIMIT_EXCEEDED / 422 VALIDATION_ERROR.
  - [x] Run `scripts/codegen.sh` (touched `.sql` **and** `api.yaml` → sqlc + openapi regen; per WF-3 codegen is the last script). Never hand-edit generated output (XL-1).

- [x] **Task 8 — Frontend `features/people/` (AC: 1,3,5).** Mirror `classlite-web/src/features/settings/` (no barrel — route-mounted).
  - [x] `api/peopleKeys.ts` (TS-3 factory, mirror `settings/api/settingsKeys.ts`); `api/useUploadImportFile.ts` (**built fresh — no FE presign precedent**: presign → browser `PUT` → confirm; expose 3 distinct progress phases — upload / parsing / done); `api/useImportPreview.ts` + `api/useConfirmImport.ts` (mutations; `apiFetch` + `components['schemas'][...]` typing per `useRooms.ts`).
  - [x] `lib/schemas.ts` (Zod, i18n-key messages); `lib/downloadCsv.ts` (**new** blob util: serialize failed rows → `Blob` → `createObjectURL` → synthetic `<a download>` → `revokeObjectURL`).
  - [x] `ImportStudentsPage.tsx`: **dropzone + click-to-browse** with explicit states (idle / drag-over / wrong-type-rejected / uploading / parsing) — reject non-`.csv`/`.xlsx` client-side; preserve/allow re-pick on upload failure. Preview `Table` with per-row `Badge` status + **summary banner (`role="status"`/`aria-live`, "40 import · 6 skip")** — Confirm ENABLED with error rows (partial import); `Dialog`/`AlertDialog` confirm. Result screen shows the **persisted rows inline as self-verification** (since `s42` doesn't exist yet) + error-report download. `Progress` for the upload phase; **skeleton for the parse wait**. **Submit-lock**: disable Confirm while `import` in-flight (concurrency guard). Reuse `RoomsTab` `ErrorAlert` + `SaveErrorAlert`/`classifySaveError` (`settings/RoomsTab.tsx:421,465` — no `Alert` primitive). UX-1 trilogy.
  - [x] **A11y:** each status `Badge` has an accessible label tying row identity + reason ("Row 6, jane@example.com — error: duplicate email"); table not just axe-clean but screen-reader-coherent (TEST-UX-2).

- [x] **Task 9 — Route + nav wiring (AC: 1).**
  - [x] Register the import route in `classlite-web/src/routes.tsx` under `AppLayout` children, `lazy` → `element: <RouteRoleGate allowedRoles={['owner','admin']} requiredRolesForCopy={['owner','admin']} sectionNameKey=.../>`, child `{index:true → ImportStudentsPage}` (deep-import for its own chunk). **Path-collision guard:** mount at `/students/import` (a child path), NOT the bare `/students` — Story 7.2 will own `/students` (the `s42` list); do not squat the parent. Note this for 7.2 in `deferred-work.md`.
  - [x] Add an owner/admin nav entry → `/students/import` in `sidebarNavConfig.tsx` (dead stubs at `:42/:63/:82`). Full student list `s42`/FR-43 = **Story 7.2**.

- [x] **Task 10 — i18n (AC: all).** `people.import.*` in **both** `classlite-web/src/locales/en.json` + `vi.json` (998-key parity, UX-2): dialog/dropzone (+ its states), column help, per-row status labels incl. `unassigned`, validation messages, 200-row message, summary banner, unassigned-warning, result summary, error-report download, all banner copy. No hardcoded English (TEST-FE-4).

- [x] **Task 11 — Tests (AC: all).** See Testing Requirements. Turn Task 0 red green + add unit/integration/component coverage incl. the parse-edge matrix.

- [x] **Task 12 — R22 plan-cap deferral guard (AC: n/a) — cheap anchor.** No plan/seat infra exists (Epic 9). Add a greppable extension-point (a `// TODO(2-7): Epic 9 — enforce plan student-cap here` anchor at the confirm write site) + let the 200-row-cap test double as the regression anchor that fails loudly if a cap is later assumed present. Log deferral in `deferred-work.md`.

## Dev Notes

### Foundation framing & visibility (read first)
2.7 is a **data-first foundation story**, framed like keystone 3.4.5 — it ships the write path, not the read surface. **After 2.7, imported students are visible in-app only on the ephemeral import-result screen** (Task 8 renders the persisted roster inline as self-verification). The durable surfaces are deferred: `s42` center-wide list (FR-43) = **Story 7.2**; Class Detail → Students tab is a dormant `ComingSoonPanel` (`classlite-web/src/features/classes/tabs/StudentsTab.tsx`) = **Story 7.3 consumer**; there is currently **zero consumer of `ListEnrolledStudentsByClass`**. This is a conscious, recorded sequencing choice (Ducdo, 2026-07-24) — not an oversight. Owners get value via (a) invite emails to students, (b) the result screen. **Classless (`unassigned`) imports** are invisible even in the future per-class views until FR-43's Unassigned tab — so the preview MUST warn on `unassigned` rows (AC1/AC3).

### MVP scope ruling (Ducdo, 2026-07-24)
PRD marks spreadsheet import post-MVP in four places (`prd.md:270,943,950,999`); `epics.md` carries 2.7 in-MVP. **Ruling: 2.7 ships in MVP — the PRD post-MVP markers are superseded.** Decision trail logged to `deferred-work.md`. FR traceability corrected: 2.7 realizes **FR-46 Add path + FR-11**; it *creates the data consumed by* FR-43 but does not realize FR-43 (Story 7.2).

### Scope boundary (2.7 vs 7.2 vs 7.3)
- **2.7 builds:** parse/preview + **student-member creation** (`users` + `center_members(role='student')`) + enrollment link via the **enrollment sqlc queries** + the auth accept-flow fix (Task 6a).
- **2.7 does NOT build (Story 7.3):** transfer/withdraw, `withdrawn_at`, `enrollment_history` + INSERT-only RLS (R17), notifications, compose/history console. Do NOT emit `event.EnrollmentChanged` (bus unwired; 3.4.5 `// 7.3` marker).
- **2.7 does NOT build (Story 7.2):** `s42` center-wide student list / teacher roster / student detail (FR-43/44/45).
- **Inbound-debt filed for 7.3 (`deferred-work.md`):** 2.7 creates enrollments with **no `enrollment_history` genesis row** — when 7.3 ships immutable history, it must **backfill** import-created enrollments or its history shows rows from nowhere. Also: **FR-46's "students/teachers are notified" is a deliberate, permanent exception for bulk import** (invite email only) — recorded so 7.3/QA don't file it as a bug.

### Blockers surfaced at pre-dev review (2026-07-24) — resolved in this spec
1. **`EnrollmentService.CreateEnrollment` is transaction-owning** (`enrollment_service.go:83` `db.Begin`). Calling it inside the import's savepoint grabs a **separate pooled connection** → the just-created student member is **uncommitted + RLS-invisible** to it → `NOT_A_STUDENT_MEMBER` on every new_user row (100% failure). **Resolution:** reuse the enrollment **sqlc queries** (`generated.New(tx)`), not the service method (Task 5). AC4 reworded accordingly.
2. **Idempotency mechanism:** "catch 23505 and continue in the savepoint" is Postgres-illegal (a unique violation aborts the savepoint). **Resolution:** `GetActiveEnrollment` pre-check + new `CreateEnrollmentIfNotActive` `ON CONFLICT DO NOTHING` query (non-aborting; 0 rows ⇒ already-active ⇒ counted done). Sequential re-run is naturally idempotent; concurrent same-file submit is guarded by the FE submit-lock + `uq_enrollments_active` (Task 5/8). **Idempotent on outcome, not side effects** — a re-run re-fires best-effort invite emails for re-touched new_user rows.
3. **NULL-password accept-flow lockout** (`auth_invite.go:88`) — Task 6a fixes by keying the OAuth guard on `google_id`, not password-hash absence.
4. **`GetObject` bypasses RLS** — tenant-key `HasPrefix` guard added to both service methods (Task 4/5) + cross-tenant-key negative in Task 0/handler tests. The R1 write-isolation test alone would NOT catch a file-read leak.
5. **Partial-success contract contradiction:** the `s65` "disable-until-clean" pattern conflicts with the savepoint "import-the-good" design. **Resolution:** partial import is the contract — Confirm stays ENABLED with error rows; the summary banner is display-only (AC3/Task 8).
6. **Tx budget:** Spawn's 30s deadline was sized for ~20 classes; 2.7 fans out ≤200 rows × ~4 statements. Size the import deadline deliberately (`importTxDeadline`, ~60s) and treat 200 as partly a **tx-budget** cap, not only UX.

### Backend reuse map (exact anchors)
- **SEC-1 tx pattern (copy):** `classlite-api/internal/service/enrollment_service.go:89`.
- **Savepoint fan-out + email best-effort (copy shape):** `classlite-api/internal/service/class.go:181` (savepoint mechanics ~`:295`), `normalizeSpawnEmail` (reuse for email normalization), `EmailRetryQueue.Enqueue` (`email_retry.go:82`).
- **Queries (reuse; only `CreateEnrollmentIfNotActive` is new):** `users.sql` `GetUserByEmail`/`CreateUser`/`GetUserByID`; `center_members.sql` `UpsertCenterMemberWithRole`/`GetCenterMemberByUserAndCenter`/`CountCenterMembersByUser`; `invites.sql` `CreateInviteFull`; `enrollments.sql` `GetActiveEnrollment` (+ new `CreateEnrollmentIfNotActive`); `classes.sql` `ListClasses` (in-Go name resolution — no by-name query, names non-unique).
- **DB legality:** `role` CHECK on both `center_members` + `invites` allows `'student'` (`migrations/20260717120000_...:33,47`). 2.7 creates student members directly — does **not** widen `AdminInviteStaff`.
- **Errors/envelope/audit:** typed errors `service/errors.go` (pointer) + `model/errors.go` (value); `middleware/error_mapper.go:117` mapping precedent; `handler/response.go` `WriteEnvelope`/`WriteError`; `audit.go:98` `LogWithinTx`.

### Parse & idempotency
- **Server-side parse via R2** (SEQ-2-7-2): FE `presign(imports)` → browser `PUT` → `preview {key}` → `import {key, importId}`. Both stateless; **preview advisory, confirm authoritative** (confirm re-classifies; a preview/confirm divergence — class renamed/email registered between calls — is expected, not a bug; result screen reflects the actual outcome).
- Deterministic parse order (csv + excelize both preserve row order) so error-report row numbers match what the user saw.

### Project Structure Notes
- Backend new: `classlite-api/internal/service/student_import_service.go`, `classlite-api/internal/handler/student_import_handler.go` (+ new errors/mapper arms, `GetObject` on storage, allowlist edits, one new `.sql` query, route in `cmd/api/main.go`, auth guard edit `auth_invite.go`). File names reflect primary export (CQ-4). No new migration.
- Frontend new: `classlite-web/src/features/people/{ImportStudentsPage.tsx, api/*, lib/*, __tests__/*}` + route + nav + `people.import.*` (en+vi).
- **Cross-service atomicity (WF-4/WF-6):** api.yaml additive; keep backend + regenerated types + FE consumer in one PR; verify all three CI pipelines.

### References
- [Source: epics.md:1641 — Story 2.7 ACs] · [deferred-work.md:3-32 — SEQ-2-7-1/2, reuse map]
- [3-4-5-enrollment-linkage-foundation(.md/-completion-notes.md) — enrollment infra]
- [classlite-api/internal/service/enrollment_service.go:83,89 — tx-owning method + SEC-1 pattern]
- [classlite-api/internal/service/class.go:181,~295 — Spawn savepoint + normalizeSpawnEmail]
- [classlite-api/internal/service/auth_invite.go:88 — OAuth guard to fix (Task 6a)]
- [classlite-api/internal/handler/upload_handler.go:17,29,134 — allowlists + tenant-key guard]
- [classlite-api/internal/service/storage.go:16 · middleware/error_mapper.go:117 · audit.go:98]
- [classlite-web/src/features/settings/ — scaffold (settingsKeys.ts, useRooms.ts, lib/schemas.ts, RoomsTab.tsx:421/465)]
- [classlite-web/src/features/classes/tabs/StudentsTab.tsx — dormant ComingSoonPanel (visibility gap)]
- [classlite-web/src/lib/api-fetch.ts · routes.tsx:221 · sidebarNavConfig.tsx:42/63/82]
- [test-design-progress.md:413 (E2E-J14), :530 (INT-BULK), :200 (R18); handoff.md:41/49/64 — R1/R15 gates]
- [prd.md:270/943/950/999 — post-MVP markers (superseded by 2026-07-24 ruling)]
- [docs/project-context.md — GO-1/4/5, SEC-1/6, TS-3/8, FW-*, UX-1/2, TEST-*, CQ-3/4, WF-1/3/4/6/8]

## Testing Requirements

Mock seams unchanged: **FE** = MSW at HTTP boundary (never mock `apiFetch`/Query); **BE** = real DB in transactions (no mock-store seam — 3.4.5 established services call `generated.New(tx)` directly; business rules via real-DB handler integration tests).

- **BE store/integration (real DB):** valid+invalid rows → per-row status (INT-BULK-001); malformed header → 0 persisted (INT-BULK-002); cross-tenant email resolved by existing-account link (INT-BULK-003); sequential re-run → no double-insert (INT-BULK-004); **concurrent** `ConfirmImport` of same file → constraint holds, no doubles, losing row reported skipped. **Parse-edge matrix:** UTF-8 BOM header; corrupt/multi-sheet XLSX; email cell typed numeric/date in XLSX; email case/whitespace collision (`Foo@X.com`/`foo@x.com`) deduped intra-file AND at lookup; 200/201 row boundary; commit/audit-failure → 0 persisted (AC5 boundary). **R1 adversarial (mandatory):** import in tenant A creates nothing visible to tenant B (read+write) + cross-tenant file-key → 403 (TEST-BE-1).
- **BE handler (real middleware):** owner/admin 200; teacher/student 403 INSUFFICIENT_ROLE (R15, role from DB); >200 → 422 IMPORT_ROW_LIMIT_EXCEEDED; missing key → 404; assert full `{data,meta}` + `{error:{code,message,requestId}}` (TEST-BE-3). Every positive gets its negative.
- **BE auth (Task 6a):** pre-provisioned student sets password on accept → 201; genuine OAuth user + password → still 409; existing-password user unaffected.
- **FE component (MSW, real Query/Zustand):** three-state trilogy (TEST-FE-2); dropzone state matrix incl. wrong-type reject; preview per-row badges + summary banner; Confirm ENABLED with error rows (partial-import contract); submit-lock disables Confirm while in-flight; result self-verify roster + error-CSV download; role-negative (student cannot reach `/students/import`, absent from DOM, TEST-FE-6); i18n en+vi (TEST-FE-4); a11y — status badges screen-reader-coherent + `aria-live` summary, axe clean (TEST-FE-5, TEST-UX-2).
- **E2E (P0/P1):** J14-001 (valid 50-row), J14-002 (dupes+malformed → partial → error CSV), J14-004 (retry idempotency).

## Out of Scope

- Transfer/withdraw/`withdrawn_at`, `enrollment_history` + INSERT-only RLS, notifications, compose/history console, `event.EnrollmentChanged` → **Story 7.3** (+ inbound-debt: backfill genesis history for import-created enrollments; FR-46 notify exception recorded).
- Center-wide student list `s42` / teacher roster / student detail (FR-43/44/45) → **Story 7.2** (+ do not squat `/students` — 2.7 mounts `/students/import`).
- Plan/seat cap enforcement at write time (R22) → **Epic 9** (no plan infra; 200-row/import cap is 2.7's only write-time limit; guard-anchor per Task 12).
- Durable job/`imports` table + async retry → **Epic 4.3** (import is synchronous with best-effort email enqueue; result screen ephemeral).
- Inline preview-row editing → fast-follow (2.7 ships the error-report CSV as the v1 remedy; deliberate tradeoff).
- Widening `AdminInviteStaff` to accept `role='student'`.

## Definition of Done

- All tasks/subtasks `[x]`; all 6 ACs satisfied.
- **Task 0 ATDD red tests existed on the branch before in-progress** (WF-8), then green.
- BE: real-DB store/handler integration + parse-edge matrix + concurrency + R1 cross-tenant (read+write+file-key) + Task 6a auth regression green; `go vet ./...` clean; full backend regression green.
- FE: MSW three-state + dropzone-state + partial-import + submit-lock + role-negative + i18n(en/vi) + a11y/axe green; `tsc --noEmit` + ESLint clean.
- `CreateEnrollmentIfNotActive` added; `api.yaml` additive; `scripts/codegen.sh` run (sqlc + openapi); no hand-edited generated files (XL-1); all three CI pipelines pass (WF-6).
- `excelize` flagged for human review in completion notes.
- `deferred-work.md` updated: MVP scope ruling trail; SEQ-2-7-2 built; R22→Epic 9; 7.3 history-genesis backfill debt + FR-46 notify exception; `/students` path reservation for 7.2.
- Story ≤600 lines; Dev Agent Record + File List in sibling `2-7-bulk-student-import-completion-notes.md` (per `docs/bmad-story-conventions.md`), created at first dev pickup.

## Review Findings

_Round 2 `/bmad-code-review` (backend chunk), 2026-07-24. Three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). 16 findings after dedup; 2 dismissed as praise. All 6 ACs + 4 Dev-Notes blockers verified implemented as specified — findings are correctness/contract/quality, not AC failures._

### Decision-Needed → RULED (Ducdo, 2026-07-24) — all became Patch

- [x] [Review][Patch] **[HIGH] Existing same-center owner/admin/teacher (or operator's own email) silently demoted to `student`** — `classifyOneRow` classifies any email already a member of the caller's center as `existing_user` with no role check (`student_import_service.go:796`); `persistImportRow:441` then upserts `Role: model.RoleStudent` through `UpsertCenterMemberWithRole`'s `ON CONFLICT (user_id, center_id) DO UPDATE SET role = EXCLUDED.role` (`center_members.sql:59-63`). Convergent: blind+edge. **RULED: flag as `VALIDATION_ERROR` + skip** — new error code (e.g. `USER_ALREADY_STAFF`) when the resolved user is an existing non-student member; row skipped, no upsert.
- [x] [Review][Patch] **[MED] Import name-match ignores class status → dead-class enrollments + false `CLASS_NAME_AMBIGUOUS`** — `classesByName` buckets `ListClasses` output (all statuses) by name (`student_import_service.go:~2446`). **RULED: filter name-match to enrollable statuses (`upcoming`+`active`) now** — fixes dead-class enrollment and false-ambiguity together; supersedes the CR-3-4-5-2 defer for the 2.7 import path.
- [x] [Review][Patch] **[MED] Case-sensitive `users.email` unique index vs lowercased import normalization → missed existing accounts + duplicate user rows** — `idx_users_email` is `UNIQUE(email)` on the raw string; import lowercases and `GetUserByEmail` does exact `WHERE email=$1`. **RULED: fix at schema now** — migration to a functional `lower(email)` unique index (or citext), drop the old index, and audit all email lookups (login, invite, spawn, import) for casing consistency. Broad blast radius — auth-critical, handle with WF-2 discipline.
- [x] [Review][Patch] **[MED] Pre-provisioned but un-accepted student cannot be re-invited via re-import** — `createImportInvite` runs only when `!row.userIDValid` (`student_import_service.go:~2221`). **RULED: re-enqueue an invite for an existing user who has never accepted** (no password + no google_id), so re-import is the recovery path for a dropped first invite.

### Patch

- [x] [Review][Patch] [MED-HIGH] No size cap before full R2 download + parse → memory DoS; `PreviewImport` also has no timeout [`storage_r2.go` GetObject / `student_import_service.go:~2291,~1936`]
- [x] [Review][Patch] [MED] `PreviewImport` skips the DB role re-validation `ConfirmImport` performs — stale-elevated JWT can read the full classified roster [`student_import_service.go:~1936`]
- [x] [Review][Patch] [MED] Blank / `,,` / whitespace rows consume the 200-row budget and inflate `willSkip` as spurious `INVALID_EMAIL` [`student_import_service.go:~2388,~2482`]
- [x] [Review][Patch] [MED] Earlier invalid row poisons the dedup slot for a later valid row — `seen[email]=true` set before name/class checks [`student_import_service.go:~2486`]
- [x] [Review][Patch] [LOW] Canceled context handed to the post-commit invite loop (`cancel()` then `deliverInvites(ctx,…)`) — latent invite-drop [`student_import_service.go:~2094`]
- [x] [Review][Patch] [LOW] `importId` is `required`+`uuid` in `api.yaml` but never validated in the Confirm handler — blank/garbage reaches the audit payload [`student_import_handler.go` Confirm]
- [x] [Review][Patch] [LOW-MED] `invitesSent:false` returned unwarned when there are zero new-user invites — misleads the FE result screen ("some invites failed") for all-existing/all-unassigned imports; should be vacuously true [`student_import_service.go:359-361`]

### Deferred

- [x] [Review][Defer] [MED] ~400 subtransactions per commit (per-row + per-invite `SAVEPOINT`) risks Postgres 64-subxid cache overflow / cluster-wide `suboverflowed` at the 200-row cap [`student_import_service.go:~2165,~2248`] — deferred, savepoint rearchitecture non-trivial and bounded by the 200-row cap
- [x] [Review][Defer] [LOW-MED] `setPendingInvitePassword` writes via the pool (`generated.New(s.db)`), not the accept-invite write path — password commit is non-atomic with membership creation [`auth_invite.go:1585`] — deferred, naturally idempotent (no lockout), shared auth surface, handle with care
- [x] [Review][Defer] [LOW] XLSX reads only the first sheet; merged cells / formula-without-cached-value yield empty cells → spurious `INVALID_EMAIL`/`MISSING_NAME` [`student_import_service.go:~2349`] — deferred, first-sheet is an acceptable documented convention

_Dismissed as noise (not defects): (1) the `count_center_members_for_user` SECURITY DEFINER substitution for the latently-broken `CountCenterMembersByUser` reuse — correct fix, disclosed in Change Log; (2) `unassigned` status precedence over `new_user`/`existing_user` for classless rows — correct by design, confirm keys on `userIDValid` not status._

**Applied (2026-07-25).** All 11 patches implemented; `go vet` + full backend suite green. New regression file `internal/handler/student_import_review_test.go` (9 tests) locks D1/D2/D4/P2/P3/P4/P6/P7. D3 shipped migration `20260724130000_users_email_lower_unique_index` + case-insensitive `GetUserByEmail` (codegen re-run). New typed error `ImportFileTooLargeError` → 413 `IMPORT_FILE_TOO_LARGE` (mapper arm added). New row-error code `USER_ALREADY_STAFF`.

**Chunk-B follow-ups (frontend review not yet run):**
- FE i18n: add `USER_ALREADY_STAFF` + `IMPORT_FILE_TOO_LARGE` copy to the import error-code map in `en.json`/`vi.json` (UX-2) so the new codes don't fall through to a generic message.
- Chunk B (frontend: `people/` feature, `client.ts`, routes, i18n, e2e) still owes its own `/bmad-code-review` pass — this run covered the backend chunk only.

### Review Findings — Chunk B (Frontend)

_Round 2 `/bmad-code-review` (frontend chunk), 2026-07-25. Three adversarial layers. 11 patches, 3 deferred, 2 dismissed. No decision-needed (all fixes unambiguous). AC1/AC3/AC5 UX + partial-import contract + route-role gating verified correct; findings are error-surfacing, i18n coverage, and CSV-export hardening._

#### Patch

- [x] [Review][Patch] [HIGH] Both `catch {}` blocks discard the typed `ApiError.code` → every upload/preview/confirm failure shows one generic message; AC6 200-row rejection, `IMPORT_FILE_TOO_LARGE` (413), `IMPORT_FILE_NOT_FOUND`, and malformed-header `VALIDATION_ERROR` are never surfaced [`ImportStudentsPage.tsx:109,132`]
- [x] [Review][Patch] [MED-HIGH] Missing i18n copy (en+vi) for the new codes → raw `USER_ALREADY_STAFF` renders in the preview/result/CSV; no key for the file-level error messages [`locales/en.json`,`vi.json` `people.import.rowError.*`/`errors.*`]
- [x] [Review][Patch] [MED] No client-side file-size guard before presign/PUT — a multi-GB file is streamed in full before the server rejects it [`lib/schemas.ts` `importFileSchema`]
- [x] [Review][Patch] [MED] CSV formula-injection: error-report cells starting with `= + - @` are written unescaped; `r.email` is attacker-controlled failed-row text [`lib/downloadCsv.ts:12` `escapeCsvCell`]
- [x] [Review][Patch] [MED] Empty/0-row preview renders an empty table with no empty-state (UX-1 trilogy incomplete on the preview surface) [`ImportStudentsPage.tsx:300` `PreviewSection`]
- [x] [Review][Patch] [LOW-MED] Error-report CSV `reason` column emits the raw UPPER_SNAKE code, not the localized reason shown on-screen [`ImportStudentsPage.tsx:414`]
- [x] [Review][Patch] [LOW] CSV blob has no UTF-8 BOM → Excel mojibakes Vietnamese names/emails in the exported report [`lib/downloadCsv.ts:30`]
- [x] [Review][Patch] [LOW] `URL.revokeObjectURL` fires synchronously after `click()` — can cancel an in-flight download in some browsers [`lib/downloadCsv.ts:38`]
- [x] [Review][Patch] [LOW] XHR upload has no `timeout`/`ontimeout` — a stalled PUT hangs the uploading phase forever with no error/exit [`api/useUploadImportFile.ts:36`]
- [x] [Review][Patch] [LOW] `crypto.randomUUID()` throws in a non-secure context (plain-HTTP LAN host) → generic confirmFailed with no path forward [`ImportStudentsPage.tsx:128`]
- [x] [Review][Patch] [LOW] Confirm dialog action button not covered by the `isPending` submit-lock (double-submit window); align `hasFailures` gate + `downloadErrorReport` filter to one predicate [`ImportStudentsPage.tsx:213,408,418`]

#### Deferred

- [x] [Review][Defer] [LOW-MED] A preview failure after a successful upload resets to `idle`, discarding the uploaded `objectKey` and forcing a full re-upload instead of a cheap preview retry [`ImportStudentsPage.tsx:109`] — deferred, needs a retry-without-reupload affordance (UX enhancement)
- [x] [Review][Defer] [LOW-MED] No `AbortController` on the upload XHR + result lives in component state only (not route-addressable) → navigating away mid-flow leaks the request and loses the result roster/report [`api/useUploadImportFile.ts`,`ImportStudentsPage.tsx`] — deferred, larger nav/lifecycle rework
- [x] [Review][Defer] [LOW] Counts use hardcoded `student(s)`/`row(s)` copy rather than i18next plural rules [`locales` `people.import.*`] — deferred, cosmetic; MVP-acceptable

_Dismissed as noise: (1) "existing_user row shows destructive Skipped badge" — false; existing_user rows persist (member upserted) so `persisted:true` → the secondary "Imported" badge; (2) "re-import reports created=0" — false; `created` counts every persisted row including idempotent re-imports._

**Applied (Chunk B, 2026-07-25).** All 11 patches implemented; `tsc --noEmit` + ESLint clean; en/vi i18n parity verified; people-feature vitest 19/19 green (8 new regression tests across `ImportStudentsPage.test.tsx`, `downloadCsv.test.ts`, new `schemas.test.ts`). No new backend changes.

## Change Log

| Date | Change |
|---|---|
| 2026-07-24 | Story created (ready-for-dev). Ultimate context-engine pass: 3 parallel research agents (backend/frontend/UX+test+prior). SEQ-2-7-1 discharged by 3.4.5; scope = parse/preview + student-member creation. |
| 2026-07-24 | Party-mode pre-dev review (Winston/Murat/Mary/Sally). Revised to close 6 findings: (1) reuse enrollment sqlc queries on import tx, NOT tx-owning `CreateEnrollment`; (2) idempotency via pre-check + new `CreateEnrollmentIfNotActive` ON CONFLICT, concurrency posture stated; (3) auth accept-flow fix Task 6a (google_id-keyed OAuth guard); (4) `GetObject` tenant-key RLS guard; (5) partial-import contract (Confirm enabled) replaces s65 disable-until-clean; (6) 200-row tx-budget sized. Product rulings (Ducdo): 2.7 **in MVP** (supersedes PRD post-MVP note); **re-labeled foundation story** (value gated on 7.2) + classless-import preview warning. FR traceability corrected (FR-46/FR-11 realized; FR-43 data-only). 7.3 inbound-debt filed. |
| 2026-07-25 | Round-2 `/bmad-code-review` — **backend chunk** (3 adversarial layers). 16 findings after dedup (2 dismissed). 4 decision-needed ruled by Ducdo → all became patches; 11 patches applied, 3 deferred (`CR-2-7-1/2/3` in `deferred-work.md`). Fixes: D1 existing-staff-not-demoted (`USER_ALREADY_STAFF`), D2 enrollable-status class match, D3 case-insensitive email uniqueness (new migration + `GetUserByEmail` + codegen), D4 re-invite never-accepted users, P1 file-size cap (`IMPORT_FILE_TOO_LARGE` 413) + preview timeout, P2 preview role re-validation, P3 blank-row skip, P4 dedup-slot ordering, P5 detached invite ctx, P6 `importId` 422, P7 vacuous `invitesSent`. +9 regression tests. `go vet` + full backend suite green. **Frontend chunk B review still owed.** |
| 2026-07-24 | Green phase shipped (`in-progress → review`). All tasks complete; ATDD turned green + graduated off the `atdd_red_phase` tag; INT-BULK-ROLLBACK activated via a failing-audit seam. Backend (service/handler/auth-6a/sqlc/api.yaml/codegen) + frontend (`features/people/` + route + nav + en/vi i18n) + tests all green; `go vet` clean, `tsc`/ESLint clean. **One deviation:** added a `count_center_members_for_user` SECURITY DEFINER migration (`20260724120000`) — preview's `USER_IN_ANOTHER_CENTER` needs an RLS-bypass the tenant-scoped count can't provide. `excelize/v2` flagged for human review. Dev Agent Record + File List in [`2-7-bulk-student-import-completion-notes.md`](./2-7-bulk-student-import-completion-notes.md). |
