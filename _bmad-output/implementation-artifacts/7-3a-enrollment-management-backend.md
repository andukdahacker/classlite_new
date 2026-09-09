---
epic: 7
story: 7.3a
story_key: 7-3a-enrollment-management-backend
baseline_commit: ac4c20c42d7ba282040880e2af8b86a231b19bf2
created: 2026-09-08
audience: backend
size: M
depends_on: [3.4.5, 7.2]
enables: [7-3b]
risk_score: 7 # R17 (enrollment_history mutability, 2×3=6) + R15 (service trusts JWT role, 2×3=6) — the base pair, bumped to 7 for the append-only privilege-layer driver + the FORCE-RLS genesis backfill. Not 8: no cross-service contract break, the enrollments spine + audit-log immutability idiom both already ship. WF-8 HARD RULE → `//go:build atdd_red_phase` reds on the branch BEFORE in-progress.
scope_decision: "SPLIT of Story 7.3 (Ducdo ruled 2026-09-08). 7-3a = backend keystone (withdraw/transfer transitions + immutable enrollment_history + genesis backfill + class-lifecycle guard + best-effort notify email + read APIs for the s43 console). 7-3b = the s43 /people/enrolment console over this contract (backlog). Mirrors 7-1a/7-1b and 7-2a/7-2b."
---

# Story 7.3a: Enrollment Management — Backend Keystone

Status: done

## ⚠️ Read first — this consumes the 3.4.5 spine, it does not rebuild it

Story **3.4.5 (Enrollment Linkage Foundation, done)** already shipped the `enrollments`
table (full `status IN ('active','withdrawn','transferred')` CHECK, 4-policy FORCE
RLS, `uq_enrollments_active` partial-unique, 3 indexes), the **Add** case
(`CreateEnrollment` → `POST /api/enrollments`), and the roster reads
(`GET /api/classes/{classId}/enrollments`). **7-3a MUST NOT recreate the
`enrollments` table.** [Source: `classlite-api/migrations/20260722120000_create_enrollments.up.sql`; `internal/service/enrollment_service.go`]

3.4.5's carve (its own scope table, `3-4-5-…-backend.md:110-123`) hands 7.3 exactly:
**Transfer + Withdraw transitions**, the immutable **`enrollment_history`** table (NFR-6 /
R17), **notifications**, and the s43 console. Plus three filed inbound-debt items:
- **CR-3-4-5-1** — `enrollments` has no `status`↔`withdrawn_at` coupling CHECK → add one here.
- **CR-3-4-5-2** — `CreateEnrollment` never inspects `classes.status` → add the class-lifecycle guard here.
- **Genesis backfill (P1, from Story 2.7)** — 3.4.5-Add- and 2.7-import-created enrollments have NO history row; the immutable log MUST backfill them or the s43 history shows rows "from nowhere". [Source: `deferred-work.md:62`, `:554-556`]

## Ducdo rulings (2026-09-08) folded into this story

- **D1 — SPLIT.** This is the backend keystone; the s43 console is 7-3b.
- **D2 — Notify = best-effort email now.** Each Add/Transfer/Withdraw enqueues Resend emails to the target/source class **teacher(s)** and the **student** via the interim `EmailRetryQueue` (the invite-email path, `auth_admin.go:309`), post-commit best-effort. **Also** publish `event.EnrollmentChanged` as the forward-compat seam Epic 10's inbox subscribes to. The **in-app inbox** notify stays deferred to Epic 10 Story 10.1 (no `notifications` table / subscriber / UI exists — `epic-10.md`). The 2.7 bulk-import email-silence stays a permanent FR-46 exception (`deferred-work.md:63`) — do not "fix" it.
- **D3 — Enrollable set = `upcoming` + `active`.** Add/Transfer target class must be `upcoming` or `active`; `paused`/`ended` → **422 `CLASS_NOT_ENROLLABLE`** (CR-3-4-5-2). Also add the CR-3-4-5-1 coupling CHECK.
- **D4 — "Needs attention" data ships here.** 7-3b renders three s43 zones (compose → needs-attention → history), so 7-3a exposes the read data: **unassigned students** (a `student` center-member with zero active enrollments) and **over-capacity classes** (active-enrollment count `>` `classes.capacity`, only where `capacity IS NOT NULL`).

## Story

As an Admin or Owner,
I want to add, transfer, and withdraw students between classes with an immutable audit trail and lifecycle-safe targets,
So that student placement is controlled, every change is traceable, and the enrollment console (7-3b) has a complete, consistent backend contract.

## Acceptance Criteria (BDD)

### A. Actions — one endpoint, uniform history

**AC1 — Unified enrollment action endpoint (Admin/Owner only).**
**Given** an Admin or Owner, **When** `POST /api/enrollments` is called with an action body
`{ action: 'add'|'transfer'|'withdraw', studentId, toClassId?, fromClassId?, effectiveDate, note? }`,
**Then** the action is applied and **exactly one** `enrollment_history` row is written **in the same transaction** as the enrollment state change (R17). The legacy 3.4.5 Add body `{ studentId, classId }` is still accepted and normalized to `action='add'` (classId → toClassId) so 3.4.5's shipped contract does not break. `note` is optional, teacher-visible, capped (reuse the note-length bound from student notes). Role is **re-validated from `center_members`, never the JWT claim** (SEC-1/R15); a Teacher/Student caller → **403 `INSUFFICIENT_ROLE`**.

**AC2 — Add** *(retrofit of 3.4.5 `CreateEnrollment`)*.
**Given** `action='add'` with `toClassId`, **When** submitted, **Then** an active `enrollments` row is created (existing 3.4.5 validations: class-in-center → 404; `NOT_A_STUDENT_MEMBER` → 422; `ALREADY_ENROLLED` → 409) **AND** the new D3 enrollable guard (`toClassId` status ∈ {upcoming, active} else **422 `CLASS_NOT_ENROLLABLE`**), **AND** a `from_class_id=NULL, to_class_id=toClassId, action='add'` history row is written, **AND** the D2 notify (student + target teacher) fires post-commit.

**AC3 — Transfer.**
**Given** `action='transfer'` with `fromClassId` + `toClassId`, **When** submitted, **Then** in one tx: the student's active enrollment in `fromClassId` is set `status='transferred', withdrawn_at=effectiveDate, updated_at=now()`, a new `status='active'` enrollment is created in `toClassId`, and one `action='transfer'` history row (`from=fromClassId, to=toClassId`) is written. `toClassId` obeys the D3 enrollable guard; the student must hold an active enrollment in `fromClassId` (else **422 `NOT_ENROLLED_IN_SOURCE`**); `ALREADY_ENROLLED` in target → 409. The `uq_enrollments_active` partial-unique permits the transferred + new-active rows to coexist (proven by 3.4.5's `WithdrawnCoexistsWithActive`). Notify: student + **both** teachers.

**AC4 — Withdraw.**
**Given** `action='withdraw'` with `fromClassId`, **When** submitted, **Then** in one tx: the active enrollment is set `status='withdrawn', withdrawn_at=effectiveDate, updated_at=now()`, and one `action='withdraw'` history row (`from=fromClassId, to=NULL`) is written. No active enrollment in `fromClassId` → **422 `NOT_ENROLLED_IN_SOURCE`**. Notify: student + source teacher. (The student's "Unassigned" status is derived by the D4 unassigned read, not a stored flag.)

### B. Immutable history (R17 — the WF-8 driver)

**AC5 — `enrollment_history` is append-only at the privilege layer.**
**Given** the migration runs, **Then** an `enrollment_history` table exists with columns
`id, center_id, student_id, action ('add'|'transfer'|'withdraw'), from_class_id (nullable), to_class_id (nullable), effective_date (date), note (nullable), performed_by (nullable — NULL for system/genesis rows), performed_at (timestamptz), created_at`,
carrying **`ENABLE`+`FORCE ROW LEVEL SECURITY`**, a **SELECT tenant-isolation policy + a `FOR INSERT … WITH CHECK` policy only (no UPDATE/DELETE policy)**, and **`REVOKE UPDATE, DELETE, TRUNCATE … FROM PUBLIC` and `FROM classlite_app`** — the exact idiom of `audit_logs` (Story 1.3b, `20260603000000_create_audit_logs.up.sql:20-38`), **not** a trigger. [Source: backend recon]

**AC6 — Mutation attempts are hard-rejected.**
**Given** any actor (including `classlite_app`), **When** `UPDATE`, `DELETE`, or `TRUNCATE` hits an `enrollment_history` row, **Then** it fails with a **privilege-layer error** (SQLSTATE 42501) — a hard error, not a silent 0-rows. Adversarial store tests assert the mutation returns a non-nil error and the row is unchanged, mirroring `audit_logs_rls_test.go:195-238`.

**AC7 — Exactly one row per operation.**
**Given** any single Add/Transfer/Withdraw, **When** it commits, **Then** precisely **one** `enrollment_history` row exists for it, carrying `performed_by` (the acting user), `performed_at` (clock-injected), `effective_date`, and the correct `from`/`to` class ids (INT-AUDIT-003). If the state change rolls back, no history row persists (atomicity test).

**AC8 — Cross-tenant isolation on history.**
**Given** tenant A, **When** it reads/writes `enrollment_history` for tenant B, **Then** reads return 0 rows and the append-only REVOKE + `WITH CHECK` block any cross-tenant insert — the standard grid, extending `enrollments_rls_test.go`.

### C. Data-integrity guards (inbound debt)

**AC9 — status↔withdrawn_at coupling CHECK (CR-3-4-5-1).**
**Given** a new migration, **Then** `enrollments` gains a CHECK so a terminal status cannot exist without a timestamp and vice-versa: `active ⇒ withdrawn_at IS NULL` and `withdrawn|transferred ⇒ withdrawn_at IS NOT NULL`. Existing rows (all `active`, `withdrawn_at NULL`) satisfy it. New migration pair — never edit `20260722120000` (WF-2).

**AC10 — Genesis backfill (P1).**
**Given** the `enrollment_history` migration, **Then** a backfill inserts one `action='add'` genesis row (`from=NULL, to=class_id, effective_date=enrolled_at::date, performed_by=NULL, performed_at=enrolled_at, note='(system)'`) for every existing `enrollments` row that has no history row, so the s43 history is complete. **Because `enrollment_history` is FORCE-RLS INSERT-only, a plain cross-center INSERT fails the `WITH CHECK`** — the backfill MUST establish tenant context per center (a `DO`-loop over distinct `center_id` with `SET LOCAL app.current_tenant_id`, or run under a BYPASSRLS migration role). Verify the chosen approach against how `scripts/migrate.sh` connects.

### D. Read APIs for the s43 console (7-3b consumes)

**AC11 — Enrollment history list (center-wide, paginated).**
**Given** an Admin or Owner, **When** `GET /api/enrollments/history?page=&page_size=&student_id=&class_id=` is called, **Then** the immutable history is returned newest-first in the `{data, meta}` envelope with `page/pageSize/total/totalPages` (XL-2, clamp `MaxPageSize=100`), each row denormalized with student name, source/target class names, and performer name (NULL performer → rendered by 7-3b as "System"). Explicit nulls (GO-5). Admin/Owner only (Teacher → 403).

**AC12 — Needs-attention read (D4).**
**Given** an Admin or Owner, **When** `GET /api/enrollments/attention` is called, **Then** the response returns `{ unassigned: Student[], overCapacity: ClassCapacity[] }` where `unassigned` = `student` center-members with zero active enrollments and `overCapacity` = classes whose active-enrollment count `>` `classes.capacity` (only `capacity IS NOT NULL`; the count is aggregated in SQL, not N+1 — PERF-2). Admin/Owner only.

### E. Compose support — reuse, don't rebuild

**AC13 — No new student/class search endpoints.**
**Given** the 7-3b compose row needs a searchable student and a class picker, **Then** 7-3a adds **no** new list endpoints for them: the student dropdown reuses **`GET /api/students`** (Story 7.2a, paginated, center-wide) and the class picker reuses **`GET /api/classes`** + the client `isAssignableClass` helper. 7-3a's only new reads are AC11 (history) + AC12 (attention). (Documented so 7-3b does not invent duplicates.)

### F. Notifications (D2)

**AC14 — Best-effort email on every action.**
**Given** a committed Add/Transfer/Withdraw, **When** the tx commits, **Then** post-commit the service enqueues (non-blocking, `EmailRetryQueue.Enqueue`) a Resend email to the **student** and to the affected **teacher(s)** (target teacher for Add; both for Transfer; source teacher for Withdraw), via two new `Render…EnrollmentChange…Email` templates. A full/dropped queue does **not** fail the request (the enrollment + history row are the durable contract, mirroring `auth_admin.go:309`). Recipients are re-resolved from the DB (student email is denormalized on the enrollment; teacher email via `class.teacher_id → users`); a class with a `pending_teacher_email` (no assigned teacher) is skipped for the teacher email.

**AC15 — Forward-compat event seam.**
**Given** any committed action, **Then** the service publishes `event.EnrollmentChanged` (payload: enrollmentId, studentId, action, from/to class ids) — replacing the two `// 7.3: emit EnrollmentChanged` markers in `enrollment_service.go:16,177`. It fans out to zero handlers today (Epic 10 subscribes later); PII is never logged (EDGE-4).

### G. Security & tests (WF-8 HARD GATE — red-first before in-progress)

**AC16 — R17/R15 red-phase ATDD on the branch before `in-progress`.**
**Given** WF-8 (risk 7), **Then** `//go:build atdd_red_phase` reds exist on the branch BEFORE the story moves to `in-progress`, covering: (1) history append-only UPDATE **and** DELETE **and** TRUNCATE hard-reject (AC6), (2) exactly-one-row-per-op + rollback-leaves-no-row (AC7), (3) Teacher/Student action → 403 (AC1/R15), (4) mutating action re-fetches role from DB not JWT — revoke-then-attempt (R15/INT-AUTH-058), (5) cross-tenant `enrollment_history` grid (AC8). Reds compile-fail on the greenfield seams (the not-yet-existing `enrollment_history` table + `generated.*` history/transition queries); each file carries a "GREEN SEAMS" header block; de-tag per-file at green. Checklist → `_bmad-output/test-artifacts/atdd-checklist-7-3a-enrollment-management-backend.md`. [Source: `reference_atdd_red_convention.md`; 7-2a ATDD precedent]

## Tasks / Subtasks

- [x] **T1 — Migrations** (AC5, AC9, AC10) — three new pairs, never edit `20260722120000`:
  - [x] `create_enrollment_history`: table per AC5 columns; `ENABLE`+`FORCE` RLS; SELECT-isolation + `FOR INSERT WITH CHECK` policies; `REVOKE UPDATE,DELETE,TRUNCATE FROM PUBLIC` + `FROM classlite_app`; indexes `(center_id, created_at DESC)` and `(center_id, student_id)`. FKs: `center_id→centers CASCADE`, `student_id→users` NO ACTION, `from/to_class_id→classes` NO ACTION (preserve history if a class is purged — NOTE this differs from `enrollments`' class CASCADE, intentionally), `performed_by→users` NO ACTION nullable. Clone `audit_logs` idiom verbatim.
  - [x] `add_enrollments_status_withdrawn_at_check` (AC9) — the coupling CHECK, separate migration.
  - [x] `backfill_enrollment_history_genesis` (AC10) — per-center tenant-context `DO`-loop insert; verify the migration role's RLS posture first.
  - [x] `scripts/migrate.sh` up+down verified; down drops the table/CHECK (backfill down is a no-op / documented irreversible-data note).
- [x] **T2 — Queries** `internal/store/queries/enrollments.sql` + `enrollment_history.sql` (AC2–4, AC7, AC11, AC12): `WithdrawEnrollment` (SET status/withdrawn_at/updated_at, RETURNING), `TransferEnrollmentSource` + reuse `CreateEnrollment` for target, `InsertEnrollmentHistory`, `ListEnrollmentHistoryPaged` + `CountEnrollmentHistory` (denormalized joins, optional student_id/class_id filters, newest-first + `id DESC` tiebreak), `ListUnassignedStudents`, `ListOverCapacityClasses` (SQL aggregate, no N+1), `GetClassTeacherRecipient` (teacher email for notify). Mirror the `…Paged`+`Count…` pair already in `enrollments.sql:44-63`.
- [x] **T3 — api.yaml + codegen** (AC1, AC11, AC12): extend `POST /api/enrollments` request to the action shape (keep legacy Add body valid); `EnrollmentHistory` + `EnvelopeListEnrollmentHistory`; `NeedsAttention` (`unassigned`, `overCapacity`) + envelope; new error codes `CLASS_NOT_ENROLLABLE` (422), `NOT_ENROLLED_IN_SOURCE` (422). Run `scripts/codegen.sh` (WF-1/WF-3). Additive where possible; the action-body change is the one contract edit — 7-3b co-finalizes any PROVISIONAL read markers.
- [x] **T4 — EnrollmentService** (AC1–4, AC9-guard, AC14, AC15): extend the constructor with the event bus, `EmailRetryQueue`, `EmailSender`+templates, and user/class-recipient lookups (wire in `cmd/api/main.go:609`). Add `WithdrawEnrollment`, `TransferEnrollment`; **retrofit** `CreateEnrollment` to write a history row + enrollable guard + notify + event. All state-change + history + `audit.LogWithinTx` in **one tenant tx** (clone the `CreateEnrollment:83-176` block; `StudentService.beginNoteWrite` is the SEC-1 role-refetch analog that returns the DB role). Enrollable guard reads `classes.status` for the target. Email/event fire **post-commit** best-effort. New audit action consts `enrollment.transferred` / `enrollment.withdrawn`.
- [x] **T5 — Email templates** (AC14): `RenderEnrollmentChangeStudentEmail` + `RenderEnrollmentChangeTeacherEmail` in `email_templates.go` (`(subject, htmlBody)`, SEC-11 sanitized), covering all three actions via a param.
- [x] **T6 — Handler + routes** (AC1, AC11, AC12): extend `enrollment_handler.go` (action-body parse + normalize legacy shape) + `ListHistory` + `Attention`; register `GET /api/enrollments/history` and `GET /api/enrollments/attention` on the enrollment chain (`main.go:618`). Add `RequireRole("owner","admin")` at the edge as defense-in-depth for the two reads + the mutating action, with the authoritative Admin/Owner check still the in-service DB re-fetch (the existing Add route stays reachable — teachers never mutate).
- [x] **T7 — ATDD reds (WF-8, land BEFORE in-progress)** (AC16): `enrollment_history_rls_atdd_test.go` (append-only trio + cross-tenant grid, mirror `audit_logs_rls_test.go`), `enrollment_action_authz_atdd_test.go` (teacher→403 + DB-role-revalidate), `enrollment_history_atomicity_atdd_test.go` (exactly-one + rollback-none). `//go:build atdd_red_phase`, "GREEN SEAMS" headers, checklist artifact.
- [x] **T8 — Green tests + regression + docs**: store RLS/integration (extend `enrollments_rls_test.go`), service unit (mock store seam — Transfer/Withdraw invariants, enrollable 422, role 403), handler integration (full envelope + error shapes). De-tag ATDD files. Full Go `-race` suite green (note the pre-existing 3.1/2.3b spawn date-bomb is untouched). Re-run codegen. Update `deferred-work.md`: mark CR-3-4-5-1, CR-3-4-5-2, and the 2.7 genesis-backfill debt **resolved by 7-3a**; file `FU-7-3-A` (in-app inbox notify → Epic 10) and any 7-3b handoff.

### Review Findings

_Code review 2026-09-09 via `/bmad-code-review 7-3a` (Amelia) — 3 adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor), all source-verified. 2 decision-needed (Ducdo-ruled → patch), 4 patch total, 5 dismissed._

- [x] [Review][Patch] Reject future `effectiveDate` (DN1 — Ducdo ruled "reject future dates only" 2026-09-09) [classlite-api/internal/handler/enrollment_handler.go:421] — `time.Parse` accepts ANY valid `YYYY-MM-DD` with no range check. On withdraw/transfer, `status` flips to `withdrawn`/`transferred` **immediately** but `withdrawn_at` (+ the `enrollment_history.effective_date` row) is stamped with the future date; the coupling CHECK (`add_enrollments_status_withdrawn_at_check.up.sql:14-17`) only tests NOT NULL, so nothing rejects it. Fix: validate `effectiveDate <= server today` → 422 `VALIDATION_ERROR` if in the future. Backdating stays allowed (history records the past date; `enrolled_at` stays `now()` — ruling declined the enrolled_at sync). (blind+edge)
- [x] [Review][Patch] Paginate `GET /api/enrollments/attention` (DN2 — Ducdo ruled "full pagination page/pageSize" 2026-09-09) — `ListUnassignedStudents` (`enrollments.sql:105-117`) and `ListOverCapacityClasses` (`enrollments.sql:119-130`) have no `LIMIT`; `GetNeedsAttention` serializes the full slices. A center with thousands of never-enrolled `student` members (plausible right after a 2.7 bulk import) returns every one in a single admin-console response. Fix: full `page`/`pageSize` pagination like `/history` (XL-2) on both zones — `api.yaml` + `codegen.sh` + `…Paged`+`Count…` query pairs + service + handler `meta` block. 7-3b consumes the paged shape. (blind+edge)
- [x] [Review][Patch] Transfer with `fromClassId == toClassId` corrupts the audit trail (no self-transfer guard) [classlite-api/internal/service/enrollment_service.go:TransferEnrollment] — no equality check. Flow: source flip sets the single active row in X to `transferred` (0-rows guard passes — it *was* active); `insertActiveEnrollment`'s pre-check then finds no active row (just flipped) and inserts a fresh active enrollment in X (no `uq_enrollments_active` collision — the `transferred` row is excluded). Net: a spurious `transferred` row + a new active row in the same class + a `transfer` history row with `from=to=X` + a "transferred from X to X" email/event, all reported as a 200 success. Fix: reject `fromClassID == toClassID` with `ValidationError` before any writes. (blind+edge)
- [x] [Review][Patch] Misleading FK comment on `enrollment_history` class FKs [classlite-api/migrations/20260908120000_create_enrollment_history.up.sql:14-16] — comment claims `from/to_class_id → classes NO ACTION` because "history MUST survive a class purge … enrollments.class_id CASCADEs." `NO ACTION` is RESTRICT: it *blocks* the class delete rather than letting the purge succeed with history intact (that would need `ON DELETE SET NULL`). Moot in practice (classes are soft-deleted, never hard-deleted), but the stated *why* is inaccurate (CQ-2). Fix: correct the comment to describe the actual RESTRICT semantics.

**Dismissed (5):** (1) reads gate on JWT role not DB re-fetch — SEC-1 explicitly permits JWT role for read-only ops + edge `RequireRole` also gates; only mutating ops require DB re-validation, which they do. (2) `ListOverCapacityClasses` lacks explicit `center_id` belt — both `classes` and `enrollments` are RLS tenant-scoped and the query runs inside the `SetTenantContext` tx (GO-1); no leak. (3) `enrollment_history.action` "unvalidated" — FALSE POSITIVE, the column has `CHECK (action IN ('add','transfer','withdraw'))`. (4) Transfer/Withdraw don't re-verify student still a center member — benign and arguably correct (you want to withdraw an ex-member's stale active enrollment); RLS + active-enrollment requirement bound the blast radius. (5) AC2 validation-order change (enrollable-guard before member-check) — both 422, AC mandates no order.

## Dev Notes

**Immutability idiom — clone `audit_logs`, NOT a trigger.** `enrollment_history` is *unconditionally* append-only, so the correct precedent is the privilege-layer REVOKE from `audit_logs` (Story 1.3b), not the conditional `submission_immutable_after_release` trigger (Story 6.1). Two policies only (SELECT `USING` isolation + `FOR INSERT WITH CHECK`), `FORCE` RLS, double REVOKE (PUBLIC + `classlite_app`). Immutability tests assert a **hard error** (`err != nil`, SQLSTATE 42501) — contrast the `enrollments` RLS tests which assert silent `RowsAffected()==0`. [Source: `internal/test/audit_logs_rls_test.go:195-238`]

**Same-tx atomicity — the `CreateEnrollment` block is the template.** `s.db.Begin` → `defer tx.Rollback(context.WithoutCancel(ctx))` → `store.SetTenantContext(ctx, tx, tc)` → `txQ := generated.New(tx)` → all writes on `txQ` + `s.audit.LogWithinTx(ctx, tx, tc, action, "enrollment", id, Changes{…})` → single `tx.Commit`. The enrollments UPDATE + `enrollment_history` INSERT + audit row all ride this one tx; **email + event fire only after Commit succeeds** (a post-commit best-effort tail, never inside the tx). [Source: `internal/service/enrollment_service.go:71-183`; `internal/service/student_service.go:514-560,664-701`]

**Role re-validation (SEC-1/R15).** Re-fetch the member via `GetCenterMemberByUserAndCenter` inside the tx and gate on `member.Role ∈ {owner, admin}` — never `tc.Role` (the JWT claim, stale for up to 15 min, EDGE-2). `beginNoteWrite` returning the DB role is the pattern to copy. [Source: `enrollment_service.go:94-108`]

**Routing.** Enrollment uses the open chain (`extractTenant→requireVerified→requireCenter→ErrorMapper`) with role enforced in-service. Add `RequireRole("owner","admin")` at the edge for the two new reads + the mutating action as defense-in-depth, but keep the DB re-fetch authoritative. [Source: `cmd/api/main.go:609-623`; `internal/middleware/require_role.go`]

**Genesis backfill RLS trap.** `FORCE ROW LEVEL SECURITY` applies to the table owner too, and the `WITH CHECK` needs `app.current_tenant_id` set — a bare cross-center `INSERT … SELECT` in the migration will fail. Loop per `center_id` with `SET LOCAL app.current_tenant_id` (transaction-scoped, PERF-1) or run the backfill under a BYPASSRLS role. `performed_by` is nullable specifically so genesis rows carry no performer.

**Over-capacity + unassigned reads (PERF-2).** Aggregate in SQL — `LEFT JOIN enrollments … GROUP BY class.id HAVING count(*) FILTER (WHERE status='active') > c.capacity`; unassigned = `center_members role='student'` `NOT EXISTS (active enrollment)`. Never loop counts in Go.

### Project Structure Notes

- Migrations → `classlite-api/migrations/{ts}_{desc}.up/.down.sql` (next ts after `20260906120000`). Queries → `internal/store/queries/*.sql` → `sqlc generate`. Service/handler → `internal/service/enrollment_service.go`, `internal/handler/enrollment_handler.go` (extend, don't fork). Wire deps in `cmd/api/main.go:609`.
- No frontend in this story — s43 console is 7-3b. No `classlite-web` changes except the codegen'd client types (part of the atomic backend commit if the action-body edit lands).

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-07.md#Story-7.3`] — the 7.3 ACs (Add/Transfer/Withdraw, immutable history, RLS INSERT-only, R17/R15 mitigations).
- [Source: `_bmad-output/implementation-artifacts/3-4-5-enrollment-linkage-foundation.md:110-123,167-205`] — the 3.4.5→7.3 scope carve + the CR-3-4-5-1/2 deferrals.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:33-36,62-63,554-558`] — genesis-backfill P1 debt, FR-46 bulk-import exception, CR-3-4-5-1/2.
- [Source: `classlite-api/migrations/20260603000000_create_audit_logs.up.sql:20-38`; `internal/test/audit_logs_rls_test.go:195-238`] — the append-only privilege-layer idiom + immutability test shape.
- [Source: `classlite-api/internal/service/enrollment_service.go:71-183`; `internal/service/student_service.go:664-701`] — the atomic-tx + SEC-1 role-refetch template.
- [Source: `classlite-api/internal/service/email_retry.go`, `auth_admin.go:309`, `email_templates.go`] — best-effort notify path.
- [Source: `classlite-api/internal/event/types.go`, `bus.go`; `assignment_service.go:229`] — the `event.EnrollmentChanged` publish seam.
- [Source: `_bmad-output/test-artifacts/test-design/test-design-progress.md:403-411,489,505-506`] — J13 P0 scenarios + INT-AUDIT/INT-AUTH.
- [Source: `docs/project-context.md`] — GO-1..7, GFW-1..7, SEC-1, PERF-1/2, WF-1/2/3, XL-2, TEST-BE-1..5.

## Definition of Done

- [x] `enrollment_history` live: FORCE RLS, SELECT+INSERT policies only, REVOKE UPDATE/DELETE/TRUNCATE (PUBLIC + classlite_app); append-only proven by UPDATE/DELETE/TRUNCATE-hard-reject store tests.
- [x] Add (retrofit) / Transfer / Withdraw each write exactly one history row in the same tx as the state change; rollback leaves no row; performer + timestamp + effective_date + from/to correct.
- [x] Enrollable guard: `paused`/`ended` target → 422 `CLASS_NOT_ENROLLABLE`; `NOT_ENROLLED_IN_SOURCE` on transfer/withdraw without an active source enrollment.
- [x] CR-3-4-5-1 coupling CHECK migration in place; genesis backfill populates history for all pre-existing enrollments (per-center tenant context).
- [x] `GET /api/enrollments/history` (paginated, denormalized, Admin/Owner) + `GET /api/enrollments/attention` (unassigned + over-capacity, SQL-aggregated) return correct `{data,meta}` envelopes.
- [x] Notify: best-effort Resend email to student + affected teacher(s) on each action (queue-drop never fails the request); `event.EnrollmentChanged` published; the two `// 7.3:` markers removed.
- [x] Service re-validates Admin/Owner from `center_members` (not JWT); Teacher/Student → 403.
- [x] WF-8: `//go:build atdd_red_phase` reds landed before `in-progress`, then de-tagged green; checklist artifact present.
- [x] `scripts/codegen.sh` re-run; `go build`/`vet` clean; full Go `-race` suite green (pre-existing 3.1/2.3b spawn date-bomb excepted); TEST-BE-1..5 honored (RLS adversarial read+write, real DB in tx, store seam in service tests).
- [x] `deferred-work.md` updated (CR-3-4-5-1/2 + genesis debt resolved; FU-7-3-A inbox notify → Epic 10; 7-3b handoff).
- [x] Dev Agent Record + File List → sibling `7-3a-enrollment-management-backend-completion-notes.md` (story-conventions split).

## Out of Scope

- **The s43 `/people/enrolment` console UI** (compose row + needs-attention list + history table), the new Owner/Admin sidebar entry, `people.enrolment.*` i18n → **Story 7-3b** (backlog). Reuse map captured below.
- **In-app inbox notification** (a `notifications` row a teacher/student sees in an inbox) → **Epic 10 Story 10.1** (FU-7-3-A). 7-3a ships email + the event seam only.
- **Capacity *enforcement* on Add/Transfer** — over-capacity is *surfaced* (AC12) but not *blocked*; enrolling past capacity is allowed (the console warns). A hard cap, if wanted, is a separate decision.
- Student *creation* (2.7 bulk import / invite), attendance, per-skill analytics — other stories.

## 7-3b handoff (frontend recon — for its create-story)

- **Route/nav:** clone the `/people/staff` route block (`routes.tsx:291-327`), owner/admin `RouteRoleGate`, new `sectionNameKey="enrolment"`. **No dead link exists** — 7-3b **adds** a new Owner+Admin sidebar item to `OWNER_GROUPS`+`ADMIN_GROUPS` (`sidebarNavConfig.tsx:38-77`); IA authorizes it (`classlite-ia.md:148,302`).
- **Three s43 zones (D4):** compose row (student combobox + Add/Transfer/Withdraw `ToggleGroup` + target-class picker + effective-date + teacher-note) → **needs-attention** list (amber *unassigned* / red *over-capacity*, from `GET /api/enrollments/attention`) → immutable history table (raw `<table>`, action pills via `Badge`, from `GET /api/enrollments/history`).
- **Reuse:** `peopleKeys` (+ `enrollmentHistory()`/`attention()`/`createEnrollmentMutation()` slots), `useStaffRoster`-style `useQuery`, `useAssignClass`-style invalidate-on-success mutation, `useClasses`+`isAssignableClass` for the target picker, `GET /api/students` (7.2a) for the student dropdown. **Combobox gap:** `ui/command` (cmdk) ships but is Storybook-only — the searchable student field is net-new integration (fallback: the non-searchable `AssignClassPanel` listbox pattern). `EnrolmentComposer` is net-new (`component-inventory.md:192,300`).
- **i18n:** `people.enrolment.*` + `app.permissionDenied.section.enrolment.header` + `sidebar.{owner,admin}.enrolment` in **both** en/vi (zero exist today).

## Change Log

| Date | Change |
|---|---|
| 2026-09-09 | **Code review → done** via `/bmad-code-review 7-3a` (Amelia). 3 adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor, all source-verified). 2 decision-needed (Ducdo-ruled) + 4 patches APPLIED+verified, 5 dismissed. Auditor: all 16 ACs SATISFIED, R17/R15/atomicity PASS. **DN1** (Ducdo: reject future dates only) → `effectiveDate > server-today` now 422 `VALIDATION_ERROR`; backdating stays allowed. **DN2** (Ducdo: full pagination) → `/api/enrollments/attention` each zone independently paginated (`unassigned_page`/`unassigned_page_size`, `over_capacity_page`/`over_capacity_page_size`); `NeedsAttention.{unassigned,overCapacity}` restructured to `{items, pagination}`; added `CountUnassignedStudents`/`CountOverCapacityClasses` + LIMIT/OFFSET on both list queries; api.yaml + `codegen.sh` re-run. **P1** same-class transfer (`fromClassId==toClassId`) — was silently corrupting the audit trail (spurious `transferred` row + new active row in same class + from=to history) → now rejected 422 before any writes. **P2** corrected the misleading `enrollment_history` FK comment (NO ACTION = RESTRICT, not "survive a purge"). Dismissed: JWT-role reads (SEC-1-sanctioned), over-capacity RLS-only scoping (within-tx, no leak), action-column "unvalidated" (FALSE POSITIVE — DB CHECK exists), member re-verify on transfer/withdraw (benign), validation-order change (both 422). Added 3 green guard tests (same-class 422+no-write, future-date 422+no-flip, backdated 200). Gates: `go build`/`vet` clean; enrollment handler+service+integration `-race` green; full `go test ./... -race -p 1` green EXCEPT the pre-existing 3.1/2.3b spawn wall-clock date-bomb (excepted — every failure is a `Spawn` test). Findings + resolutions → Review Findings section. Changes STILL UNCOMMITTED on `api/feat/student-lists-detail-backend`. Next: commit; then `/bmad-create-story 7-3b`. |
| 2026-09-09 | **Implemented → review** via `/bmad-dev-story 7-3a` (Amelia). WF-8 gate met (4 `atdd_red_phase` reds on-branch before `in-progress`: history immutability grid + coupling CHECK + action authz + atomicity), all driven green + de-tagged. Shipped: 3 migrations (`enrollment_history` FORCE-RLS append-only via the `audit_logs` REVOKE idiom, `enrollments` status↔withdrawn_at coupling CHECK, per-center genesis backfill); `enrollment_history.sql` + extended `enrollments.sql` (transitions + attention reads + `GetEnrollmentClass`); `api.yaml` action body + `/history` + `/attention` + `CLASS_NOT_ENROLLABLE`/`NOT_ENROLLED_IN_SOURCE`; `EnrollmentService` Add-retrofit/Transfer/Withdraw (one-tx state-change + history + audit, post-commit best-effort email + `event.EnrollmentChanged`, SEC-1 DB role re-fetch), 2 email templates, handler dispatch + 2 read handlers, admin edge chain. All 16 ACs / 8 tasks done. Deferrals resolved: CR-3-4-5-1, CR-3-4-5-2, 2.7 genesis-backfill; filed FU-7-3-A (inbox → Epic 10). Full `go test ./... -race -p 1` green EXCEPT the pre-existing 3.1/2.3b spawn wall-clock date-bomb (excepted by DoD). Dev Agent Record + File List → sibling `7-3a-enrollment-management-backend-completion-notes.md`. Next: `/bmad-code-review 7-3a` (different LLM recommended). |
| 2026-09-08 | Story created (ready-for-dev). SPLIT of 7.3 → **7-3a backend keystone** (this) + 7-3b frontend (backlog), re-keys 7-3. 4-agent parallel recon: enrollment spine already shipped by 3.4.5 (table + Add + roster + AuditLogger wired); 7-3a owns Transfer/Withdraw + immutable `enrollment_history` (append-only via `audit_logs` REVOKE idiom, NOT a trigger) + genesis backfill (P1) + CR-3-4-5-1/2 guards + read APIs for the s43 console. **4 Ducdo rulings (2026-09-08):** D1 split; D2 notify = best-effort email now + publish `event.EnrollmentChanged` (in-app inbox → Epic 10); D3 enrollable = upcoming+active (422 `CLASS_NOT_ENROLLABLE`); D4 needs-attention data (unassigned + over-capacity) ships here for 7-3b. **risk 7 — WF-8 HARD ATDD gate** (R17 history immutability + R15 role re-validation, red-first before in-progress). 16 ACs / 8 tasks. Next: (optional `/bmad-tea AT 7-3a`) then `/bmad-dev-story 7-3a`. |
