---
epic: 3
story: 3.4.5
story_key: 3-4-5-enrollment-linkage-foundation
baseline_commit: d932dc1cab4fcc4c938e058f400a56f4a0029457
created: 2026-07-23
audience: backend
size: S-M
depends_on: [2.6, 3.1]
enables: [2.7, 3.5b, 7.2, 7.3, 8.1]
scope_decision: "KEYSTONE extracted from Epic 7 Story 7.3 at Story 3.5 party-mode review (Mary's evidence, Ducdo ruled 2026-07-22). Ships ONLY the enrollments linkage table + Add-case + list. The People-Management console (transfer/withdraw/enrollment_history/notifications/UI) stays in 7.3. Backend-only enabler."
---

# Story 3.4.5: Enrollment Linkage Foundation

Status: ready-for-dev

## ⚠️ Origin banner — read first

This story did not exist in the original epic plan. It was **extracted as a keystone** during the Story 3.5 party-mode review (2026-07-22).

**The problem it fixes (Mary's evidence):** the student↔class linkage — the `enrollments` table — is a hard prerequisite for **10 consumer stories across Epics 3, 7, and 8**, but the original plan only *produces* it in **Epic 7 Story 7.3** (the second-to-last story of Epic 7). That is a **producer-after-consumer inversion**: the first consumer is in Epic 3 (already in flight), the producer sits four epics later. It has already forced three `ComingSoonPanel` placeholders over the same missing table — 3.2 Students tab, 3.4 `/my-schedule`, and 3.5b attendance.

**Root cause:** Story 7.3 bundles two separable things — (1) the `enrollments` **linkage table** (foundational data-layer spine; architecture places `enrollments.sql` beside `classes.sql`/`sessions.sql` in the core query layer, `architecture.md:677`), and (2) the enrollment **management console** (add/transfer/withdraw compose UI, immutable `enrollment_history`, notifications — FR-46, a genuine People-Management feature).

**Ducdo's ruling (2026-07-22):** extract the spine. **This story (3.4.5)** ships the linkage table + the minimal **Add** action + a list query. **Story 7.3 keeps** transfer/withdraw, the immutable `enrollment_history`, notifications, and the compose console — and now *consumes* the `enrollments` table instead of birthing it.

**Sequence unlocked:** `3.4.5 → 2.7 (un-halted) → 3.5b`. This story is what un-halts Story 2.7 (bulk student import was blocked ONLY because the `enrollments` table didn't exist — `deferred-work.md` SEQ-2-7-1). Student *creation* is NOT in this story — it arrives via 2.7's bulk-import path; 3.4.5 links *existing* student members to classes.

## Story

As an Admin or Owner,
I want students linked to classes through a first-class enrollment record, with the ability to add an existing student member to a class,
So that every class-scoped feature (rosters, attendance, student schedules, analytics) has a real student↔class source of truth instead of a `ComingSoonPanel`.

## Acceptance Criteria

**AC1 — `enrollments` table exists (verbatim to Story 7.3 spec, so 7.3 consumes it)** *(FR-46 foundation)*
**Given** migrations run,
**When** the schema is inspected,
**Then** an `enrollments` table exists with exactly the columns Story 7.3 (`epic-07.md:152`) specifies: `id`, `center_id` NOT NULL REFERENCES centers(id) ON DELETE CASCADE, `student_id` NOT NULL REFERENCES users(id), `class_id` NOT NULL REFERENCES classes(id) ON DELETE CASCADE, `enrolled_at timestamptz NOT NULL DEFAULT now()`, `withdrawn_at timestamptz` (nullable), `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn','transferred'))`, `created_at`, `updated_at`. The table carries the standard 4-policy RLS grid (SELECT/INSERT/UPDATE/DELETE) on its own `center_id`, `ENABLE`+`FORCE ROW LEVEL SECURITY`. Story 7.3's "the `enrollments` table exists" AC is now satisfied here; 7.3 must NOT recreate it.

**AC2 — Add an existing student to a class (Admin/Owner only)** *(FR-46; the "Add" action only)*
**Given** an Admin or Owner,
**When** POST `/api/enrollments` is called with `{ studentId, classId }`,
**Then** a new `enrollments` row is created with `status='active'`, `enrolled_at=now()`, provided the validations pass:
- the `classId` resolves to a class in the caller's center (RLS + lookup),
- the `studentId` is a user who **is a `student` center-member of this center** (service queries `center_members` for `role='student'` — a non-student or non-member → 422 `NOT_A_STUDENT_MEMBER`),
- the student is **not already actively enrolled** in that class (→ 409 `ALREADY_ENROLLED`).
Role is **re-validated from `center_members`, not trusted from the JWT claim** (SEC-1 / R15). A Teacher/Student caller → **403 `INSUFFICIENT_ROLE`**. Transfer and Withdraw are **NOT** implemented (Story 7.3).

**AC3 — List enrolled students for a class** *(roster read for downstream consumers)*
**Given** an Owner, Admin, or Teacher,
**When** GET `/api/classes/{classId}/enrollments` is called,
**Then** the active enrollments for that class are returned, joined to `users` for `studentId` + `fullName` (+ `email`, `enrolledAt`, `status`), in the `{data, meta}` envelope with explicit nulls (GO-5). A **Teacher** may only list classes they teach (cross-teacher → **404**, reusing the `assertClassRole`/teacher-scope pattern); Admin/Owner see any class in-center. This is the query 3.5b's attendance roster and 7.2's teacher roster will consume.

**AC4 — Double-enrollment guard** *(data integrity)*
**Given** a student already actively enrolled in a class,
**When** a second active enrollment is attempted,
**Then** it is rejected (409 `ALREADY_ENROLLED`), enforced by a **partial unique index** `(class_id, student_id) WHERE status='active'` — which still permits a historical `withdrawn`/`transferred` row to coexist (so a re-enrollment after a future 7.3 withdrawal is possible). No cross-field validation beyond this.

**AC5 — RLS + role isolation proven adversarially** *(GO-1, TEST-BE-1, SEC-1)*
**Given** the new table and endpoints,
**When** tested,
**Then** cross-tenant **read** and **write** isolation holds (tenant A cannot read/UPDATE/DELETE tenant B's enrollments — verified by re-fetch), null/empty-tenant guard holds, and the Admin/Owner-only write gate is proven with a role-negative test (Teacher create → 403). Deterministic tenant IDs; never disable RLS.

**AC6 — Unblocks 2.7 and 3.5b at the data layer** *(sequencing)*
**Given** this story is done,
**When** Story 2.7 (bulk import) and Story 3.5b (attendance) are picked up,
**Then** both have the `enrollments` table + `CreateEnrollment` + `ListEnrolledStudentsByClass` they were blocked on. `deferred-work.md` SEQ-2-7-1 (2.7 halt) and FU-3-5-A (3.5b) are updated to point at this story as the resolved dependency. (No behavior in *this* story depends on 2.7 — enrollments are testable via `student` center-member fixtures today.)

## Tasks / Subtasks

> **Ordering guard (WF-1/WF-3):** migration → `migrate.sh` → `.sql` queries → `api.yaml` → `codegen.sh` (LAST). Backend-only story — no frontend consumer this story.

- [ ] **T1 — Migration (AC1, AC4)**
  - [ ] `{ts}_create_enrollments.up.sql` / `.down.sql` (next timestamp after `20260721120000`; `ls migrations/ | tail -5`).
  - [ ] `enrollments` columns exactly per AC1 (verbatim to `epic-07.md:152` + `created_at`/`updated_at`/`enrolled_at`/CHECK). FKs: `center_id`→centers CASCADE, `class_id`→classes CASCADE, `student_id`→users (no cascade — preserve enrollment history if a user row is ever removed; match `classes.teacher_id` NO-ACTION precedent).
  - [ ] `ENABLE`+`FORCE ROW LEVEL SECURITY` + the **exact 4-policy grid** copied from `20260703120200_create_classes.up.sql` (`center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`).
  - [ ] Indexes: composite `idx_enrollments_center_class ON (center_id, class_id)` (roster read path) + **partial unique** `uq_enrollments_active ON (class_id, student_id) WHERE status='active'` (AC4). Consider `idx_enrollments_center_student ON (center_id, student_id)` for the future center-wide student list (7.2) — additive, optional.
  - [ ] `updated_at DEFAULT now()` fires on INSERT only; any future UPDATE query must `SET updated_at = now()` explicitly (no trigger — match the classes convention, `20260719120000` header).
  - [ ] `.down.sql` reverses (DROP POLICY → DROP INDEX → DROP TABLE). Run `scripts/migrate.sh` (WF-2).
- [ ] **T2 — sqlc queries (AC2, AC3, AC4)**
  - [ ] `internal/store/queries/enrollments.sql` (mirror `sessions.sql`/`classes.sql` conventions: `-- name: X :one/:many/:exec`, `sqlc.arg`, RLS handles `center_id`, filter on `class_id`/`student_id`). Queries:
    - `CreateEnrollment :one` — insert `center_id` **directly from `tc.CenterID`** (not a subquery/trigger — GO-1), `status='active'`.
    - `ListEnrolledStudentsByClass :many` — JOIN `users` for name/email; `WHERE class_id = $1 AND status='active'`; ORDER BY user full_name.
    - `GetActiveEnrollment :one` (or `CountActiveEnrollment`) — for the ALREADY_ENROLLED pre-check (belt; the partial-unique index is the suspenders).
    - `IsStudentMemberOfCenter :one` — `SELECT 1 FROM center_members WHERE center_id=$1 AND user_id=$2 AND role='student'` (the NOT_A_STUDENT_MEMBER validation).
- [ ] **T3 — Service (AC2, AC3, SEC-1)**
  - [ ] `internal/service/enrollment_service.go` — `EnrollmentService` sharing `AuthDB`+`AuditLogger`(+`clock` if needed). Mirror `SessionService` tenant-tx ceremony (`readInTenantTx`/`mutateInTenantTx`; reads need a tx for RLS — PERF-1).
  - [ ] `CreateEnrollment(ctx, tc, studentID, classID)` — role gate **Admin/Owner only**, re-fetched from `center_members` (SEC-1/R15; `service.ForbiddenError{"insufficient role"}` → 403 `INSUFFICIENT_ROLE`); validate class-in-center, `IsStudentMemberOfCenter` (else `model.ValidationError`/typed 422 `NOT_A_STUDENT_MEMBER`), not-already-active (else 409 `ALREADY_ENROLLED` — new `model.ConflictError` code); audit via `AuditService.LogWithinTx` (entityType `"enrollment"`).
  - [ ] `ListEnrolledStudentsByClass(ctx, tc, classID)` — allow owner/admin/teacher; teacher-scope (only own classes → 404), reusing the class-load + `assertClassRole`/teacher-scope pattern from `class_lifecycle.go` / `session.go`.
  - [ ] Do **NOT** implement transfer/withdraw, `enrollment_history`, or notifications (Story 7.3). Do **NOT** emit `event.EnrollmentChanged` — the event bus is unwired (recon); leave a `// 7.3: emit EnrollmentChanged once the bus is wired` marker only.
- [ ] **T4 — api.yaml + handler + routes (AC2, AC3)**
  - [ ] `api.yaml`: `Enrollment` schema (explicit nulls, camelCase: `id, centerId, studentId, classId, studentName, studentEmail, enrolledAt, withdrawnAt, status`), `CreateEnrollmentRequest` (`studentId`, `classId`), `EnvelopeEnrollment` / `EnvelopeListEnrollment`.
  - [ ] Endpoints (new `enrollmentChain` = sessionChain shape: extractTenant → requireVerified → requireCenter → ErrorMapper; role enforced in service): `POST /api/enrollments`, `GET /api/classes/{classId}/enrollments`.
  - [ ] `internal/handler/enrollment_handler.go` — methods returning `error`; `{data,meta}` envelope via `WriteEnvelope`; path ID via `parseSettingsPathID`; strict body decode. Register `ALREADY_ENROLLED` (409) + `NOT_A_STUDENT_MEMBER` (422) in the error mapper if new arms are needed. Wire routes in `cmd/api/main.go` alongside the sessions block (~438-443).
  - [ ] Run `scripts/codegen.sh` (LAST).
- [ ] **T5 — Tests (AC5, AC6, TEST-BE-1..4)**
  - [ ] Store/RLS adversarial (`enrollments_rls_test.go`, clone `classes_rls_test.go` + `sessions_rls_test.go:175-216` + `adversarial_test.go` Patterns 1–6): cross-tenant read/write isolation, null/empty-tenant guard, partial-unique double-active rejection.
  - [ ] Service tests (mock store seam, TEST-BE-4): Admin/Owner can enroll; Teacher/Student → 403 (role re-fetched from `center_members`, not JWT); non-student user → 422 `NOT_A_STUDENT_MEMBER`; already-active → 409 `ALREADY_ENROLLED`.
  - [ ] Handler integration (`NewEnrollmentTestServerBareMux` mirroring `NewSessionTestServerBareMux` + `SignAccessTokenForRole`): POST as owner → 201 + envelope; POST as teacher → 403; GET roster as teacher of own class → 200; as teacher of another class → 404; full `{data,meta}` + `{error:{code,message,requestId}}`. Seed students via `fixtures.CreateCenterMember(..., "student")` + `SeedClass`.
  - [ ] `go test ./... && go vet ./... && gofmt -l`.
- [ ] **T6 — Close-out**
  - [ ] Update `deferred-work.md`: mark SEQ-2-7-1 (2.7 halt) and FU-3-5-A (3.5b) dependency **resolved by 3.4.5**; add a note that Story 7.3 now *consumes* the `enrollments` table (its "table exists" AC is pre-satisfied) and retains history/transfer/withdraw/console.
  - [ ] No new env var/service → no `docs/manual-setup.md` change (WF-9).

## Dev Notes

### Scope carve — what is IN vs. what stays in Story 7.3

| Concern | 3.4.5 (this story) | Story 7.3 (unchanged) |
|---|---|---|
| `enrollments` table + RLS | ✅ ships (verbatim to 7.3 spec) | consumes it (must not recreate) |
| Add existing student to class | ✅ `POST /api/enrollments` (Add only) | extends with Transfer / Withdraw |
| List class roster | ✅ `GET /api/classes/{id}/enrollments` | reuses for compose/history views |
| `enrollment_history` + INSERT-only RLS | ❌ | ✅ 7.3 (NFR-6, R17) |
| Transfer / Withdraw actions + `withdrawn_at` writes | ❌ | ✅ 7.3 |
| Teacher/student notifications | ❌ | ✅ 7.3 |
| Compose UI / history table UI (s43) | ❌ | ✅ 7.3 |
| Student *creation* (member) | ❌ (arrives via 2.7 bulk import) | — |

The `status` column ships with the full `('active','withdrawn','transferred')` CHECK so 7.3's transitions need no migration — but 3.4.5 only ever **writes `'active'`**.

### This is a backend-only enabler — no frontend

No UI ships. Rationale: there are **no student members to enroll yet** — Story 2.6 left `AdminInviteStaff` rejecting `role='student'` (`deferred-work.md`), and 2.7 (which creates student members) is halted pending *this* table. The consuming UIs land with their own stories: the class-detail **Students tab** (currently a dormant `ComingSoonPanel`) lights up in 7.2 / with 2.7; the attendance roster in 3.5b; the enrollment console in 7.3. 3.4.5's job is purely to un-block the data layer. Tests exercise the full path via `student` center-member fixtures.

### Reuse map — build on, do not reinvent

- **Migration + RLS grid:** `migrations/20260703120200_create_classes.up.sql` (4-policy grid + FORCE RLS; copy verbatim). Column/CHECK/`updated_at`-no-trigger conventions: `20260719120000_add_class_crud_columns.up.sql`.
- **Tables to FK against:** `classes` (`id, center_id, teacher_id, status`), `users` (`id, full_name, email`), `center_members` (`center_id, user_id, role` with the `center_members_role_check` CHECK from `20260717120000`).
- **sqlc conventions:** `internal/store/queries/classes.sql`, `sessions.sql`; `sqlc.yaml`.
- **Service tx ceremony + role/teacher gates:** `internal/service/session.go` (`readInTenantTx`/`mutateInTenantTx`, `LockSession`, `assertSessionTeacherScope`), `internal/service/class_lifecycle.go:85` (`assertClassRole` → 403). **Role re-validation from DB (not JWT):** SEC-1 pattern, as used by Story 1.5 / 2.6 mutating paths.
- **Errors + envelope:** `internal/model/errors.go` (`NotFoundError`, `ValidationError`, `ConflictError`), `internal/service/errors.go`, `internal/middleware/error_mapper.go`, `internal/handler/response.go` (`WriteEnvelope`/`WriteError`). Existing codes to reuse: `INSUFFICIENT_ROLE` (403), `CLASS_NOT_FOUND` (404), `VALIDATION_ERROR`/typed 422. New codes: `ALREADY_ENROLLED` (409), `NOT_A_STUDENT_MEMBER` (422).
- **Routing:** `cmd/api/main.go:430-443` (sessionChain pattern → `enrollmentChain`).
- **Tests:** `internal/test/helpers.go` (`SetupDB`, `TenantContext`, `TenantAID/BID`), `fixtures.go` (`CreateUser`, `CreateCenter`, `CreateCenterMember` — role param takes `'student'`), `adversarial_test.go` (`resetTenantContext`/`resetTenantContextToDefault` — the null-guard helpers already exist), `story_3_1_helpers.go` (`SeedClass`), `story_2_6_helpers.go` (`SignAccessTokenForRole`), `sessions_rls_test.go`/`classes_rls_test.go` (adversarial grid reference).

### Project Structure Notes

- New: `migrations/{ts}_create_enrollments.{up,down}.sql`, `internal/store/queries/enrollments.sql`, `internal/service/enrollment_service.go`, `internal/handler/enrollment_handler.go`, `internal/test/enrollments_rls_test.go` (+ handler/service tests). Generated output is codegen-only.
- Additive-only API (new endpoints/schemas, no modified response shapes) → may ship API-first, single atomic commit (WF-4) since `client.ts` regenerates. Confirm no existing `api.yaml` schema is reshaped (contract-diff, WF-6).

### Testing standards summary

- RLS adversarial read+write + null-guard on the new table, deterministic tenant IDs, never disable RLS (TEST-BE-1). Store tests real-DB-in-tx (TEST-BE-2). Service tests mock the store seam for the role/validation business rules (TEST-BE-4). Handler integration through real middleware, full envelope (TEST-BE-3).
- **WF-8 risk note:** adding a new center-scoped table maps to **R2 (RLS null-tenant guard, score 6)** and the Admin/Owner write gate is **SEC-1/R15** territory — so the RLS grid + the role-negative (Teacher→403) test are **mandatory**. The null-guard helpers pre-exist (`adversarial_test.go`), so this is a green-on-arrival clone, not a red-first ATDD ceremony.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-07.md#Story-7.3] — the `enrollments` table spec (AC1 verbatim) + the carve (history/transfer/withdraw/notifications stay in 7.3).
- [Source: _bmad-output/planning-artifacts/architecture.md] — §4.11 People Management (enrollment handler/service home); `enrollments.sql` in the core query layer (`:677`); optimistic-update note for enrollment changes (`:461`).
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — SEQ-2-7-1 (2.7 halt on missing enrollments); FU-3-4-A / FU-3-5-A (roster placeholders).
- [Source: _bmad-output/implementation-artifacts/3-5-session-detail-and-attendance-recording.md] — the 3.5b dependency this keystone unblocks; party-mode sequencing decision.
- [Source: docs/project-context.md] — GO-1 (TenantContext), GO-2 (typed errors), SEC-1 (DB role re-validation), GFW-5 (envelope), TEST-BE-1, PERF-1 (tx for reads), WF-1/2/3.

## Definition of Done

- [ ] `enrollments` table live, columns verbatim to 7.3 spec, 4-policy RLS + FORCE, partial-unique active guard.
- [ ] `POST /api/enrollments` (Add) — Admin/Owner only (DB-revalidated), validations (class-in-center, is-student-member, not-already-active) return correct typed errors (403/404/409/422).
- [ ] `GET /api/classes/{classId}/enrollments` — roster with user join; teacher-scoped (404 off own classes).
- [ ] RLS adversarial read+write+null-guard green; role-negative (Teacher create → 403) green.
- [ ] `go test ./... && go vet && gofmt -l` clean; `codegen.sh` run last; generated files not hand-edited; no `api.yaml` schema reshaped.
- [ ] `deferred-work.md` updated: SEQ-2-7-1 + FU-3-5-A dependency resolved; 7.3 now consumes the table.
- [ ] Dev Agent Record + File List in sibling `3-4-5-...-completion-notes.md` (per bmad-story-conventions.md), not this file.

## Out of Scope

- Transfer / Withdraw enrollment actions, `withdrawn_at` writes, `enrollment_history` table + INSERT-only RLS, teacher/student notifications, the enrollment compose/history **console UI** (s43) → **Story 7.3**.
- Student *member* creation / invitation (`role='student'`) → **Story 2.7** (bulk import) / a future single-student invite path.
- Any **frontend** — Students-tab roster, attendance roster, center-wide student list → their own stories (7.2 / 3.5b / 2.7).
- Center-wide student list + at-risk detection → **Epic 7.2 / Epic 8**.
- Emitting `event.EnrollmentChanged` → deferred until the event bus is wired.

## Change Log

| Date | Change |
|---|---|
| 2026-07-23 | Story created (ready-for-dev). Keystone extracted from Epic 7 Story 7.3 at the Story 3.5 party-mode review (Ducdo ruling 2026-07-22). Ships the `enrollments` linkage table + Add-case + list only; console/history/transfer/withdraw stay in 7.3. Backend-only enabler; sequence 3.4.5 → 2.7 → 3.5b. |
