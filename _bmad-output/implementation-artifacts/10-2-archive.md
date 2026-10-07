# Story 10.2: Archive (Past Classes & Exercises, Read-Only + Reuse Verbs)

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: 8812dc0
epic: 10
story: 10.2
fr: FR-60 (archive past classes/sessions/exercises as read-only with Duplicate + Edit-a-copy) — realizes the Story 4.1 carry-forward FU-4-1-A (the Epic-10 archive surface for soft-deleted exercises)
size: M
audience: full-stack (one migration + one net-new role-scoped reversed-filter read + a new FE slice; the exercise Duplicate engine is pure reuse)
depends_on: [3.1 class-crud-lifecycle (done — status enum upcoming|active|paused|ended, `ended` terminal), 4.1 exercise-library-crud (done — `deleted_at` soft-delete + `POST /api/exercises/{id}/duplicate` deep-copy), 5.1 assignment-lifecycle (done — AC17: clone-and-edit is the SANCTIONED path, no unlock endpoint), 10-1c teacher-work-queue (done — the role-scoped reversed/derived-read pattern + WF-8 cross-teacher/cross-tenant ATDD ceremony to clone)]
wf8_hard_gate: true   # Top risk = cross-TEACHER + cross-TENANT read leak on TWO net-new role-scoped reads that intentionally surface rows every existing query hides (soft-deleted exercises; ended classes). Same 7-2a teacher-role-scope class as 10-1c (≥6). RED-FIRST ATDD on (a) cross-teacher scope, (b) cross-tenant RLS, (c) reversed-filter correctness — before in-progress.
ducdo_rulings: "D1 TYPE SCOPE = Exercises + Classes only in v1; SESSIONS DEFERRED (no archive concept — only scheduled|cancelled+dates, past is immutable, 'duplicate a session' is undefined) → FU-10-2-SESSIONS. D2 CLASS ANCHOR = add a new `ended_at timestamptz` column (stamped on the →ended transition + genesis-backfilled) so the 'ended + 30 days' cutoff has an authoritative timestamp (updated_at churns on every edit; end_date is an unvalidated user date). D3 REUSE VERBS = Exercises get BOTH Duplicate and Edit-a-copy; Classes are READ-ONLY in the archive (no class clone endpoint exists — class duplicate → FU-10-2-CLASS-DUPLICATE). D4 ROLE SCOPE = role-scoped per FR-60: Teacher sees own (created_by/teacher_id = caller), Admin/Owner see center-wide, cross-teacher = 404 non-disclosure; fix the stale `/archive` OWNER_ONLY test."
---

## Story

As **a teacher / admin / owner**,
I want **an `/archive` of my past work — classes that ended ≥30 days ago and exercises I've archived (soft-deleted) — shown read-only, with one-click Duplicate and Edit-a-copy on exercises**,
so that **I can review historical items and spin a fresh, editable copy of a past exercise without touching the original.**

This story delivers the **Epic-10 archive surface promised by `FU-4-1-A`** (Story 4.1 shipped the exercise soft-delete data model and explicitly deferred "the UI to view … soft-deleted exercises" to Epic 10). It adds **one additive migration** (`classes.ended_at`), **one net-new role-scoped read** `GET /api/archive` over the reversed filters, and a **new `src/features/archive/` FE slice**. The exercise **Duplicate engine already ships** (`POST /api/exercises/{id}/duplicate`, 4.1/5.1) and is reused verbatim — no net-new duplicate backend.

---

## Keystone constraints (READ FIRST — do not relitigate)

1. **"Archived" is a REVERSED filter, not a new state.** There is no `archived` status anywhere.
   - **Exercises:** archived ≡ `deleted_at IS NOT NULL` (the 4.1 soft-delete). **Every existing exercise read filters `deleted_at IS NULL`** — so **no query returns these today**; this story adds the net-new reversed read.
   - **Classes:** archived ≡ `status = 'ended' AND ended_at <= now() − 30 days`. `ended` carries no timestamp today (D2 adds `ended_at`). An ended-but-recent class stays in the active list (dimmed, UX §6.5) and only "moves to archive after 30 days" (FR-14 + PRD `[ASSUMPTION]` "30 days after class end").
2. **Classes are NEVER hard-deleted and have no `deleted_at`** (3.1) — an "archived class" is a `status='ended'` row, not a soft-deleted one. The two types use **different** archive predicates and **different** role-scope columns (`exercises.created_by` vs `classes.teacher_id`).
3. **Sessions are OUT (Ducdo D1).** `class_sessions` has only `scheduled|cancelled` + dates; "past" is a derived `ends_at < now()` with no status, past sessions are declared immutable (3.4), and no session-clone has ever shipped. "Duplicate a past session" is undefined. → `FU-10-2-SESSIONS`.
4. **Duplicate is exercises-only (Ducdo D3)** and reuses the shipped deep-copy (5.1 AC17: "clone-and-edit is the sole sanctioned path; no unlock endpoint ships"). Classes read-only.

---

## Context & Reuse Map (almost everything exists — clone, don't invent)

### Backend — REUSE

| Capability | Where it lives | Note |
|---|---|---|
| **Exercise soft-delete flag** | `migrations/20260727120000_create_exercises.up.sql:44` (`deleted_at timestamptz`) | Archive read = the inverse of the shipped reads: `deleted_at IS NOT NULL`. Migration comment already says "the archive/restore UI is Epic 10. The row is recoverable, never destroyed." |
| **Exercise list read (clone, flip the filter)** | `internal/store/queries/exercises.sql:59-138` — `ListExercises` / `ListExercisesByTeacher` (+ `Count*`), owner-vs-teacher reviewed pair, `created_by = @created_by` teacher predicate, `LIMIT/OFFSET`, `ORDER BY updated_at DESC, id DESC` | The archive exercise branch is this with `deleted_at IS NOT NULL` instead of `IS NULL`. |
| **Class list read (clone, add the cutoff)** | `internal/store/queries/classes.sql:26-60` — `ListClasses` / `ListClassesByTeacher`, `teacher_id = $1` teacher predicate, status-priority ORDER BY | The archive class branch filters `status='ended' AND ended_at IS NOT NULL AND ended_at <= @cutoff`. |
| **The `ended` state machine (stamp `ended_at` HERE)** | `internal/store/queries/classes.sql:95-104` — `UpdateClassStatus` (CAS, writes `class.status_changed` audit) | D2: on the `→ended` transition, also `SET ended_at = @now`. **Preserve the CAS guard + the audit write.** `ended` is terminal (3.1) so no un-stamp path. |
| **Role-dispatch idiom (owner/admin vs teacher)** | `internal/handler/class_handler.go:87-105` (`switch tc.Role`) + `internal/service/exercise_service.go:488-536` (`teacherScoped := tc.Role == RoleTeacher`, `*ByTeacher` queries, `readInTenantTx`) | Mirror: owner/admin → center-wide (teacher narg NULL); teacher → own (narg = `tc.UserID`). |
| **Cross-teacher 404 non-disclosure** | `exercise_service.go:195-203` (`assertExerciseTeacherScope`), classes teacher-scope 404 (3.1) | Teacher touching another teacher's item → **404, never 403** (no enumeration oracle). |
| **THE Duplicate engine (reuse verbatim — Ducdo D3)** | `POST /api/exercises/{id}/duplicate` → `cmd/api/main.go:877` → `ExerciseService.Duplicate` (`exercise_service.go:862`) → `ExerciseHandler.Duplicate` (`exercise_handler.go:325`, **201** `EnvelopeExercise`) | Deep-copies `content` JSONB, same skill/tags/target_band, title `+" (copy)"` (lowercase const), fresh `code`, `created_by`=duplicator, audit `exercise.duplicated`. Cross-teacher/soft-deleted source → 404. **Do NOT fork or re-wrap it.** |
| **Pagination substrate** | `internal/service/student_service.go:41-86` (`clampPagination`, `pageResult`, `Default/MaxPageSize`); the `ListInbox`/`ListTeacherQueue` mirror (`notification_service.go:551-611`) with `math.MaxInt32` page/offset guards | Copy the clamp + overflow-guard shape. `OFFSET (page-1)*pageSize LIMIT pageSize` (XL-2). |
| **Envelope / pagination helpers** | `writePaginatedEnvelope` (`enrollment_handler.go:329`), `parseSnakePageParams` (`:351`), `PaginationMeta`/`EnvelopeMetaPagination` (api.yaml:12566) | `{data, meta:{serverTime, pagination:{page,pageSize,total,totalPages}}}`. Snake_case query params (`page`, `page_size`, `type`) — reuse `parseSnakePageParams` (inbox/10-1c precedent). |
| **Staff-gated route chain (owner/admin/teacher)** | the chain that wires `/api/exercises` in `cmd/api/main.go` (student → 403); extractor `requireOwnerTenant` is a pure tenant extractor, role gating is middleware | Register archive routes on the SAME staff chain. Student blocked at the chain; teacher-scope is the SERVICE predicate. |
| **Injected clock (30-day cutoff + for tests)** | `clock.Clock` on handlers (e.g. `InboxHandler.clk`), `MockClock` in tests | Handler computes `now := h.clk.Now()`; service derives `cutoff := now.Add(-archiveClassGraceDays)` and binds `ended_at <= @cutoff`. Deterministic under MockClock. |

### Frontend — REUSE (and the slice conventions to follow)

| Capability | Where it lives | Note |
|---|---|---|
| **`/archive` sidebar slot + i18n labels ALREADY SHIP** | `src/components/domain/sidebarNavConfig.tsx:54/79/97` (owner/admin/teacher → `/archive`); `sidebar.{owner,admin,teacher}.archive` in `en.json`/`vi.json` | Only the ROUTE + the slice are net-new. |
| **Role-dispatch route pattern** | `src/features/inbox/InboxRoute.tsx` (`useRole()`/`useRoleLoading()`, `<Navigate to="/login">` on null, lazy per-role `<Suspense>` branch) | `ArchiveRoute` mirrors this. Students gated out. |
| **Staff-gated lazy route** | `src/routes.tsx:592-640` — `/exercises` wraps `RouteRoleGate allowedRoles={['owner','admin','teacher']}` + lazy child pages; the exercise editor is `path: ':id/edit' → ExerciseEditorPage` | Register `/archive` the SAME way; **Edit-a-copy navigates to `/exercises/{newId}/edit`.** |
| **The Duplicate hook pattern** | `src/features/exercises/api/useDuplicateExercise.ts` (`useMutation`, `POST /api/exercises/${id}/duplicate`, `onSettled` invalidate `exerciseKeys.lists()`, **not optimistic**) + `ExerciseLibraryPage.tsx:161-169` (`isPending` double-click guard → `mutate(id,{onSuccess:toast, onError:toast})`) | Reuse the hook/endpoint; Edit-a-copy adds a `navigate` in `onSuccess`. |
| **L/E/E trilogy** | `src/features/inbox/components/InboxStates.tsx` (skeleton/`role="alert"`+retry/role-toned empty with Fraunces italic-accent word) | Clone for `ArchiveStates.tsx`. Empty copy = s60 "Completed classes and archived exercises will appear here." |
| **Paginated list hook + keys (scope discriminator)** | `src/features/inbox/api/useInbox.ts` (`apiFetchWithMeta<T[],Meta>`, `keepPreviousData`); `src/features/exercises/api/exercisesKeys.ts:19-34` (scope discriminator `'all'` vs `teacher:${userId}` so role audiences don't share a cache slot) | `archiveKeys` NEEDS the scope discriminator (teacher-own vs center-wide must not collide). |
| **Generated client + fetch + role hook** | `src/lib/api/client.ts` (`components['schemas'][...]`), `src/lib/api-fetch.ts` (`apiFetch`/`apiFetchWithMeta`/`ApiError`), `src/hooks/useRole.ts` (`useRole`/`useRoleLoading`/`useSessionUser`), `@/components/shared/RouteRoleGate` | Standard wiring. |
| **i18n parity ratchet** | `src/features/inbox/__tests__/inboxI18nKeys.ts` + `inboxI18nParity.test.ts` → folded into `src/lib/test/__tests__/i18n-parity-coverage.test.ts` (imports `STORY_10_1B_KEYS`:39, `STORY_10_1C_KEYS`:40) | Add `STORY_10_2_KEYS` next. |
| **staleTime default** | `src/lib/query-client.ts:25` (`30_000`) | Restate `STALE_TIME_MS` locally like inbox/exercises. |

### Net-new — THIS story builds

- **BE:** migration `classes.ended_at` (+ backfill + stamp in `UpdateClassStatus`); `ListArchive`/`CountArchive` sqlc (UNION-ALL of the two reversed-filter branches, role-scoped, `type` filter, `LIMIT/OFFSET`) → `sqlc generate`; `ArchiveService.List` (role-branch, clamp, build exercise `link`); `ArchiveItem` DTO; `ArchiveHandler.List` + route `GET /api/archive` on the staff chain; api.yaml `ArchiveItem` + `EnvelopeArchiveList` + path → `codegen.sh`. **No new table, no new RLS policy** (reads ride the existing `classes`/`exercises` RLS).
- **FE:** `src/features/archive/` — `ArchiveRoute.tsx`, `api/archiveKeys.ts`, `api/useArchive.ts`, `api/useDuplicateArchiveExercise.ts` (wraps the shipped exercise duplicate; Duplicate vs Edit-a-copy), `components/ArchiveView.tsx` + `ArchiveStates.tsx`, `lib/archiveMapping.ts`, `__tests__/archiveI18nKeys.ts`+parity; route registration in `routes.tsx`; **fix** `AppLayout.role-filtering.test.tsx` `OWNER_ONLY_HREFS` (remove `/archive`).

---

## The Frozen Contracts (consume verbatim)

- **Exercise Duplicate:** `POST /api/exercises/{id}/duplicate` → **201** `EnvelopeExercise` (the full new exercise, incl. its `id`). Deep-copy, title `" (copy)"`, fresh `code`. **DO NOT change.** Edit-a-copy reads the returned `id` and routes to `/exercises/{id}/edit`.
- **Pagination envelope:** `{data:[…], meta:{serverTime, pagination:{page,pageSize,total,totalPages}}}` via `writePaginatedEnvelope` + `EnvelopeMetaPagination`/`PaginationMeta`.
- **Exercise editor route:** `/exercises/:id/edit` → `ExerciseEditorPage` (gated owner/admin/teacher).

---

## Design Decisions (engineering calls — override at dev pickup only with written reason)

- **DD1 — ONE endpoint, UNION-ALL at the DB (NOT a FE merge).** `GET /api/archive` returns a single discriminated `ArchiveItem` stream. `ListArchive` is a **`UNION ALL`** of two branches, each projecting the common shape `(type, id, title, subtitle, archived_at, class_status, skill, target_band)` — archived exercises (`deleted_at IS NOT NULL`, `archived_at := deleted_at`) and archived classes (`status='ended' AND ended_at <= @cutoff`, `archived_at := ended_at`) — with an **outer** `ORDER BY archived_at DESC, id DESC`, `LIMIT/OFFSET`. `CountArchive` mirrors the union's WHERE. This paginates **honestly at the DB** and sidesteps the 10-1c two-source-pager incoherence entirely (one result set, one coherent `total`). Optional `type=class|exercise` gates a whole branch (`AND (@type_filter = '' OR @type_filter = 'exercise')` etc.); an invalid `type` → **422** (validate against the enum, the 10-1c `late_only` 422 class). Per-type fields that don't apply are NULL — **explicit nullable, NO `omitempty` (GO-5)**; the FE renders by the `type` discriminator.
- **DD2 — `ended_at` migration (Ducdo D2): additive, stamped, genesis-backfilled.** New migration pair `{next}_add_classes_ended_at`: `ALTER TABLE classes ADD COLUMN ended_at timestamptz;` (nullable, additive — WF-2). **Backfill** existing `status='ended'` rows: `ended_at :=` the latest `audit_logs` `class.status_changed`-to-`ended` timestamp for that class, falling back to `updated_at` (the 7-3a genesis-backfill idiom). **Stamp** `ended_at = @now` inside `UpdateClassStatus` ONLY on the `→ended` branch, keeping the CAS guard + `class.status_changed` audit intact. `down` drops the column. The archive read filters `ended_at IS NOT NULL AND ended_at <= @cutoff` — backfill guarantees ended rows carry a date, so a NULL `ended_at` ended row (shouldn't occur) is naturally excluded. **30-day window = a named const** `archiveClassGraceDays = 30 * 24h` (CQ-3); configurable period → `FU-10-2-ARCHIVE-PERIOD-CONFIG`.
- **DD3 — Duplicate reuses the shipped exercise endpoint; NO `/api/archive/{type}/{id}/duplicate` dispatcher in v1.** The epic AC names a unified duplicate path, but with duplicate scoped to exercises only (Ducdo D3) that dispatcher would forward to exactly one type — redundant indirection over the shipped, tested, 5.1-sanctioned `POST /api/exercises/{id}/duplicate`. **Pragmatic reading** (per the project's spec-absolute convention): the archive FE calls the existing endpoint directly; a unified `/api/archive/.../duplicate` is revisited only when class/session duplicate lands (`FU-10-2-CLASS-DUPLICATE`). Keep the shipped `" (copy)"` lowercase suffix verbatim — do NOT fork the endpoint to match the epic's `"(Copy)"` casing (cosmetic; one source of truth for exercise clone).
- **DD4 — "Duplicate" vs "Edit a copy" differ ONLY in `onSuccess` (Ducdo D3).** Both call the same mutation. **Duplicate** → toast `archive.toast.duplicated` + invalidate `archiveKeys.lists()` and `exerciseKeys.lists()`, stay on `/archive` (the shipped exercise behavior). **Edit a copy** → on 201, `navigate('/exercises/${created.id}/edit')` (ExerciseEditorPage). `isPending`-guard both against double-clone (the 4.1 CR-4-1-20 lesson). Classes expose **no** duplicate/edit affordance (read-only, D3).
- **DD5 — Role scope per FR-60 (Ducdo D4), enforced in the service.** Teacher → each UNION branch binds its own `created_by = @teacher_id` / `teacher_id = @teacher_id` to `tc.UserID`; owner/admin → the teacher narg is NULL (center-wide; RLS tenant-scopes). Cross-teacher items are **absent** by construction; a teacher deep-linking another teacher's archived id via Duplicate gets the shipped **404** (non-disclosure). No new RLS policy — the reversed reads ride the existing `classes`/`exercises` FORCE-RLS grids. The route sits on the **staff chain** (owner/admin/teacher); student → 403 at the chain (+ FE route gate). **Fix the stale `OWNER_ONLY_HREFS=['/knowledge-hub','/archive']`** in `AppLayout.role-filtering.test.tsx` — `/archive` is staff-scoped content, not owner-only (it contradicts the shipped teacher sidebar entry + FR-60).
- **DD6 — Read-only surface (AC).** Archive rows/detail render NO edit/delete/status affordances — the ONLY actions are Duplicate / Edit-a-copy, which create NEW items and never mutate the archived original (4.1 T6 isolation). Enforced in the FE (the surface simply doesn't mount edit controls).
- **DD7 — Live derived read, not a snapshot.** Titles/meta are read live from the current `classes`/`exercises` row (the archive is a live reversed filter, not a frozen historical copy) — correct, no staleness concern.
- **DD8 — `archived_at` is the unified sort key.** For exercises `archived_at = deleted_at`; for classes `archived_at = ended_at`. Newest-archived-first (`DESC`) with the `id` tiebreak for deterministic pagination (the 7-2a/10-1c `released_at` lesson).

---

## Acceptance Criteria (BDD)

**AC1 — `GET /api/archive` returns the role-scoped, UNION-paginated archive (classes + exercises)**
**Given** a caller with archived exercises (`deleted_at IS NOT NULL`) and ended-≥30-days classes in scope,
**When** `GET /api/archive?page=1&page_size=20` is called,
**Then** it returns `{data:[ArchiveItem], meta:{serverTime, pagination:{page,pageSize,total,totalPages}}}`, each item carrying `type('class'|'exercise'), id, title, subtitle, archivedAt, classStatus|null, skill|null, targetBand|null, link`,
**And** items are ordered newest-`archivedAt`-first with the `id` tiebreak across BOTH types (one coherent `total` = the union count), paginated `OFFSET (page-1)*pageSize LIMIT pageSize`, and a crafted huge `page`/`page_size` is clamped (no 500 — the `math.MaxInt32` guard),
**And** an exercise item's `link` is `/exercises/{id}/edit` (the Edit-a-copy target is derived from the 201, not this read).

**AC2 — exercise archive correctness (reversed soft-delete filter)**
**Given** both soft-deleted (`deleted_at IS NOT NULL`) and active (`deleted_at IS NULL`) exercises,
**When** the archive is read,
**Then** only soft-deleted exercises appear; active exercises are ABSENT (the exact inverse of every shipped exercise read).

**AC3 — class archive correctness (ended + 30-day cutoff, clock-injected)**
**Given** classes in states `upcoming|active|paused|ended`, where some `ended` rows have `ended_at <= now()−30d` and some `ended` more recently,
**When** the archive is read against an injected clock,
**Then** only `status='ended' AND ended_at <= now()−30d` classes appear; recently-ended (`ended_at > now()−30d`), `upcoming`, `active`, `paused` classes are ABSENT,
**And** `UpdateClassStatus(→ended)` stamps `ended_at=now()` (CAS + `class.status_changed` audit preserved); a non-`ended` transition leaves `ended_at` untouched.

**AC4 — `type` filter + validation**
**Given** `GET /api/archive?type=exercise` (then `?type=class`),
**When** called,
**Then** only that branch's items return with an honest filtered `total`/`totalPages`; absent `type` returns the merged union; an invalid `type` (e.g. `session`/`foo`) → **422** (not a silent empty).

**AC5 — teacher role-scope: own only (cross-TEACHER isolation, WF-8)**
**Given** two teachers A and B in the SAME center, each with their own archived exercises (`created_by`) and ended classes (`teacher_id`),
**When** teacher A calls `/api/archive`,
**Then** only A's items return — B's are absent (the SERVICE `created_by=@teacher_id` / `teacher_id=@teacher_id` predicates, NOT RLS, since both share a `center_id`),
**And** owner/admin callers see center-wide items (both A's and B's),
**And** teacher A POSTing duplicate on B's archived exercise id → **404** (non-disclosure, the shipped guard).

**AC6 — cross-TENANT isolation (WF-8, RLS)**
**Given** tenant A's caller and tenant B's archived exercises + ended classes,
**When** tenant A reads `/api/archive` (and a store-level adversarial test reads a tenant-A context against crafted tenant-B ids),
**Then** zero tenant-B rows return (RLS `SET LOCAL app.current_tenant_id` on `classes`/`exercises`; the reversed `deleted_at IS NOT NULL` filter does NOT widen past the tenant boundary — the SEC-9 trap, asserted).

**AC7 — the `ended_at` migration is additive & reversible**
**Given** the migration,
**When** `up` runs,
**Then** `classes.ended_at timestamptz` is added nullable, existing `status='ended'` rows are backfilled (latest `class.status_changed→ended` audit ts, else `updated_at`), and every PRE-EXISTING class read/write is unaffected (no behavior change to non-archive callers); `down` drops the column cleanly (up→down→up idempotent).

**AC8 — the `/archive` FE page (role-dispatched, read-only, L/E/E)**
**Given** a teacher/admin/owner navigating to `/archive`,
**When** it renders,
**Then** `ArchiveRoute` dispatches on role, a list-table shows archived items filterable by type (chips: All / Classes / Exercises), each row is **read-only** (no edit/delete/status controls), and the Loading (skeleton)/Empty (role-toned s60 "Completed classes and archived exercises will appear here")/Error (inline retry) trilogy is present,
**And** a **student** is blocked (route gate → redirect; negative: no archive data in the student DOM),
**And** mobile (390px) reflows the table (no invisible overflow).

**AC9 — Duplicate + Edit-a-copy (exercises only; classes read-only)**
**Given** an archived exercise row,
**When** the teacher clicks **Duplicate**,
**Then** `POST /api/exercises/{id}/duplicate` fires once (`isPending` double-click guard), a toast confirms, and `archiveKeys.lists()`+`exerciseKeys.lists()` invalidate (stays on `/archive`); the original archived exercise is unchanged,
**And when** the teacher clicks **Edit a copy**, the same duplicate fires and on **201** the app `navigate`s to `/exercises/{created.id}/edit` (ExerciseEditorPage) with the new copy,
**And** an archived **class** row exposes NO Duplicate/Edit affordance (Ducdo D3; `FU-10-2-CLASS-DUPLICATE`).

**AC10 — i18n parity + a11y + the role-filtering fix**
**Given** all net-new strings (page title/filters/row meta/actions/toasts/empty) in a new `STORY_10_2_KEYS`,
**When** the parity ratchet runs,
**Then** every key exists in BOTH `en.json` and `vi.json` (wired into `i18n-parity-coverage.test.ts`, RED-FIRST), the archive page passes `axe` (Duplicate/Edit-a-copy reachable by their i18n-resolved labels), and `AppLayout.role-filtering.test.tsx` is updated so `/archive` is asserted for owner/admin/teacher and ABSENT for student (the `OWNER_ONLY_HREFS` entry removed).

---

## Tasks / Subtasks

**Task 1 — `classes.ended_at` migration + stamp + backfill (BE; AC3/AC7; WF-2/WF-3 — do FIRST)**
- [x] 1.1 `ls classlite-api/migrations/ | tail -5` to confirm the next slug (expected `20261007120000_add_classes_ended_at`). Create the `.up.sql`/`.down.sql` pair: `up` = `ALTER TABLE classes ADD COLUMN ended_at timestamptz;` + a backfill `UPDATE classes SET ended_at = COALESCE((SELECT max(a.created_at) FROM audit_logs a WHERE a.… = class.id AND event = 'class.status_changed' AND … 'ended'), updated_at) WHERE status='ended' AND ended_at IS NULL;` (confirm the audit_logs shape/columns at dev time; fall back to `updated_at` if the audit lookup is impractical — document the choice). `down` = `ALTER TABLE classes DROP COLUMN ended_at;`. Run `scripts/migrate.sh` (up→down→up clean).
- [x] 1.2 In `internal/store/queries/classes.sql`, amend `UpdateClassStatus` to `SET ended_at = CASE WHEN @new_status='ended' THEN @now ELSE ended_at END` (or a dedicated `→ended` branch) — **keep the CAS `WHERE status=@expected` guard and the `class.status_changed` audit**. Confirm no other status writer needs the stamp.
- [x] 1.3 `scripts/codegen.sh` (sqlc) → regenerate; confirm `UpdateClassStatus` params gain `ended_at`/`now`. No generated hand-edit (XL-1).

**Task 2 — `ListArchive` / `CountArchive` sqlc (BE; AC1-AC6; WF-3)**
- [x] 2.1 New `internal/store/queries/archive.sql` — `ListArchive :many` = `UNION ALL` of (a) archived exercises `SELECT 'exercise' AS type, e.id, e.title, …, e.deleted_at AS archived_at, NULL AS class_status, e.skill, e.target_band FROM exercises e WHERE e.deleted_at IS NOT NULL AND (@teacher_id::uuid IS NULL OR e.created_by=@teacher_id) AND (@type_filter='' OR @type_filter='exercise')` and (b) archived classes `SELECT 'class', c.id, c.name AS title, …, c.ended_at AS archived_at, c.status AS class_status, NULL, NULL FROM classes c WHERE c.status='ended' AND c.ended_at IS NOT NULL AND c.ended_at <= @cutoff AND (@teacher_id::uuid IS NULL OR c.teacher_id=@teacher_id) AND (@type_filter='' OR @type_filter='class')`; outer `ORDER BY archived_at DESC, id DESC LIMIT @lim OFFSET @off`. Project a COMMON column list/types across both branches (cast to matching types). `CountArchive :one` mirrors the two WHEREs (`SELECT count(*) FROM (…union…)`).  Header comment → this story + "reversed filters of exercises.sql:59 / classes.sql:26; teacher_id narg per Ducdo D5".
- [x] 2.2 `scripts/codegen.sh` → `ListArchiveParams{TeacherID, Cutoff, TypeFilter, Lim, Off}` + `ListArchiveRow` land. No migration here.

**Task 3 — `ArchiveService.List` + `ArchiveItem` DTO (BE; AC1-AC6; mirror exercise List)**
- [x] 3.1 New `internal/service/archive_service.go` — `List(ctx, tc model.TenantContext, f ArchiveListFilter{Type string; Page, PageSize int}) (ArchiveListResult, error)`: `clampPagination` + `math.MaxInt32` guards; role-branch `teacherID := nil; if tc.Role==RoleTeacher { teacherID = &tc.UserID }`; `cutoff := clk.Now().Add(-archiveClassGraceDays)`; validate `Type ∈ {"", "class", "exercise"}` else `ValidationError` (→422); ONE `readInTenantTx` running `ListArchive`+`CountArchive`; build each exercise item's `link := "/exercises/"+id+"/edit"`; return items + `pageResult`. Const `archiveClassGraceDays = 30 * 24 * time.Hour`.
- [x] 3.2 `ArchiveItem` DTO (`{Type, ID, Title, Subtitle string; ArchivedAt time.Time; ClassStatus, Skill *string; TargetBand *int; Link string}`) — explicit `json` tags, **NO `omitempty` (GO-5)**; per-type nullables are pointers.

**Task 4 — `ArchiveHandler.List` + route (BE; AC1/AC4; mirror exercise List handler)**
- [x] 4.1 New `internal/handler/archive_handler.go` — `List(w,r) error` → tenant extractor → `parseSnakePageParams(r)` → read `type` query param → `now := h.clk.Now()` → `h.svc.List(ctx, tc, filter)` → `writePaginatedEnvelope(w, h.clk, items, pageMeta)`; error → `middleware.ErrorMapper`.
- [x] 4.2 Register `mux.Handle("GET /api/archive", <staffChain>(archiveHandler.List))` in `cmd/api/main.go` on the SAME owner/admin/teacher chain that gates `/api/exercises` (confirm the chain name). Wire the handler (svc + clock) in the composition root.

**Task 5 — api.yaml + codegen (BE; AC1; WF-1/WF-4)**
- [x] 5.1 Add schemas `ArchiveItem` (fields above; `type` an enum `class|exercise`; per-type fields nullable/non-omitted) and `EnvelopeArchiveList` (`{data:[ArchiveItem], meta: EnvelopeMetaPagination}`), reusing `EnvelopeMetaPagination`/`PaginationMeta`.
- [x] 5.2 Add `GET /api/archive` (params `page`, `page_size`, `type`; `bearerAuth`; → `EnvelopeArchiveList`; **422** ErrorEnvelope for bad `type`). `scripts/codegen.sh` (openapi-typescript) → `client.ts` gains the schemas + path. **api.yaml + client.ts ship in ONE commit with the FE (WF-4).**

**Task 6 — FE archive slice: route, keys, list hook, view, states (AC8)**
- [x] 6.1 `src/features/archive/api/archiveKeys.ts` — factory with the **scope discriminator** (`all` vs `teacher:${userId}`) + params (TS-3); `ARCHIVE_PAGE_SIZE=20` const.
- [x] 6.2 `api/useArchive.ts` — `useQuery` via `apiFetchWithMeta<ArchiveItem[], PaginationMeta>('/api/archive?page=…&page_size=…&type=…')` (snake_case), explicit `staleTime` (FW-3), `placeholderData: keepPreviousData`. Returns `{items, pagination}`.
- [x] 6.3 `components/ArchiveView.tsx` (list-table, type-filter chips All/Classes/Exercises, read-only rows, per-exercise action menu) + `components/ArchiveStates.tsx` (L/E/E trilogy; role-toned empty). `lib/archiveMapping.ts` — map `ArchiveItem`→row display by the `type` discriminator (null-safe).
- [x] 6.4 `ArchiveRoute.tsx` — role-dispatch (`useRole`/`useRoleLoading`, `<Navigate to="/login">` on null); students excluded. Register `/archive` in `routes.tsx` under the AppLayout group, lazy, wrapped in `RouteRoleGate allowedRoles={['owner','admin','teacher']}` (mirror `/exercises:592`).

**Task 7 — FE Duplicate + Edit-a-copy (AC9; reuse the shipped engine)**
- [x] 7.1 `api/useDuplicateArchiveExercise.ts` — reuse `POST /api/exercises/{id}/duplicate` (or import `useDuplicateExercise` via the exercises barrel — TS-7, no deep import); return the 201 `Exercise`. Invalidate `archiveKeys.lists()` + `exerciseKeys.lists()` on settle.
- [x] 7.2 Row actions: **Duplicate** → `mutate(id,{onSuccess: toast 'archive.toast.duplicated', onError: toast 'archive.toast.error'})`, `isPending`-guarded. **Edit a copy** → same mutation, `onSuccess: (created) => navigate('/exercises/${created.id}/edit')`. Class rows: no action menu (D3/DD6).

**Task 8 — i18n + tests + WF-8 red-first + verify (AC5/AC6/AC10 + all)**
- [x] 8.1 Net-new keys in `en.json`+`vi.json` (page title, filter chips, row meta per type, `archive.actions.duplicate`/`.editCopy`, toasts, empty s60, a11y labels). `src/features/archive/__tests__/archiveI18nKeys.ts` (`STORY_10_2_KEYS`, net-new only) + `archiveI18nParity.test.ts` **RED-FIRST**; fold `STORY_10_2_KEYS` into `i18n-parity-coverage.test.ts`.
- [x] 8.2 **WF-8 RED-FIRST ATDD (BE)** — `//go:build atdd_red_phase` specimens, de-tagged at green: (AC5) cross-TEACHER scope — two teachers one center, A sees only A's (exercises+classes), owner sees both, A-duplicate-on-B → 404; (AC6) cross-TENANT store RLS — tenant-A ctx returns 0 tenant-B archived rows (store-level, `test.SetupDB`, two deterministic tenant ids, never DISABLE RLS; TEST-BE-1/2) incl. the SEC-9 reversed-filter assertion; (AC2/AC3) reversed-filter correctness — soft-deleted-present/active-absent, ended+30d-present/recently-ended-absent (MockClock), `ended_at` stamp on `→ended`; (AC4) `type` filter + 422. Handler integration (TEST-BE-3) asserts the `{data,meta.pagination}` envelope.
- [x] 8.3 FE tests: (AC8) role-dispatch + read-only rows + L/E/E + **student-blocked negative** (TEST-FE-6 absence); (AC9) Duplicate fires once + toast + invalidate (stays) / Edit-a-copy navigates to `/exercises/{newId}/edit` (MSW 201) / class row has no action menu; (AC10) axe + parity + the `AppLayout.role-filtering.test.tsx` `OWNER_ONLY_HREFS` fix (+ sidebar owner/admin/teacher assertion). MSW at the HTTP boundary (TEST-FE-1); `tsc -b` gate; keep `execArgv:['--no-experimental-webstorage']`.
- [x] 8.4 **Verify (DoD):** BE `gofmt`/`go vet`/`go test -p 1 ./...` green (incl. de-tagged reds + migration up/down/up); `scripts/codegen.sh` clean (sqlc = +2 archive queries + `UpdateClassStatus` delta, openapi = +1 path/2 schemas, no unexpected drift); FE `tsc -b` green; full web vitest green (0 regressions); ESLint clean (no raw fetch, no cross-feature deep import, no `useEffect` fetch); api.yaml + client.ts + FE in ONE commit (WF-4).

---

## Dev Notes

- **"Archived" = a reversed filter over rows every other query HIDES.** Exercises: `deleted_at IS NOT NULL` (inverse of the 4.1 reads). Classes: `status='ended' AND ended_at <= now()−30d`. This is exactly why WF-8 is a HARD GATE — a reversed filter is the classic place a tenant/teacher boundary silently widens (SEC-9). Prove both boundaries adversarially (AC5 cross-teacher, AC6 cross-tenant) before in-progress.
- **The migration is the only schema change and it is additive (AC7).** New nullable `ended_at`; stamp on `→ended` (preserve CAS + audit); genesis-backfill ended rows. Every non-archive class caller is behavior-unchanged. WF-2: new pair, never edit an existing migration; `migrate.sh` then `codegen.sh` (WF-3 ordering).
- **Duplicate is PURE REUSE (Ducdo D3/DD3/DD4).** Do NOT build a `/api/archive/.../duplicate` dispatcher — call the shipped `POST /api/exercises/{id}/duplicate` (5.1-sanctioned, deep-copy, 201). Duplicate vs Edit-a-copy differ only in `onSuccess` (toast-and-stay vs navigate-to-editor). Keep the `" (copy)"` suffix verbatim.
- **Role-scope is a SERVICE invariant, not RLS (DD5/AC5).** Two teachers share a `center_id`; RLS does NOT isolate them — the `created_by`/`teacher_id = caller` predicates do, per UNION branch. That is why AC5 (cross-teacher) is first-class WF-8 alongside AC6 (cross-tenant), mirroring 10-1c/7-2a.
- **GO-1/GO-3/GO-4:** `TenantContext` on the store call; authz (teacher scope + type validation) in the service, never the handler/store; propagate the request `ctx`. **GO-5:** no `omitempty` on `ArchiveItem`. **GFW-5:** envelope via `writePaginatedEnvelope`.
- **TS-3/TS-4/TS-6/TS-7:** structured keys w/ scope discriminator; `apiFetchWithMeta` unwraps `{data,meta}`; `archivedAt` stays ISO until the formatter; reuse the exercise duplicate via the barrel (no deep import). **FW-4:** `useArchive` is a Query, no `useEffect`.
- **The `/archive` OWNER_ONLY test is a KNOWN stale conflict** — `AppLayout.role-filtering.test.tsx` currently lists `/archive` as owner-only, contradicting the shipped teacher/admin/owner sidebar entry and FR-60. Fix it as part of AC10; do not "respect" the stale test.

### Project Structure Notes

- BE touches: NEW `internal/store/queries/archive.sql`, `internal/service/archive_service.go`, `internal/handler/archive_handler.go`; AMEND `internal/store/queries/classes.sql` (`UpdateClassStatus`), `cmd/api/main.go` (+1 route + wiring), `api.yaml` (+1 path/2 schemas), one new migration pair. `store/generated/` regenerated. No new table, no new RLS policy.
- FE touches: NEW `src/features/archive/` slice (`ArchiveRoute.tsx`, `api/{archiveKeys,useArchive,useDuplicateArchiveExercise}.ts`, `components/{ArchiveView,ArchiveStates}.tsx`, `lib/archiveMapping.ts`, `__tests__/{archiveI18nKeys.ts,archiveI18nParity.test.ts, …}`, `index.ts`); AMEND `src/routes.tsx` (+/archive), `src/locales/{en,vi}.json`, `src/lib/test/__tests__/i18n-parity-coverage.test.ts`, `src/components/shared/__tests__/AppLayout.role-filtering.test.tsx`. Sidebar config + labels already ship (untouched). Exercises feature untouched except being imported for its duplicate hook via the barrel.

### References

- Backend reuse: [Source: classlite-api/internal/store/queries/exercises.sql:59-138 (`List/CountExercises[ByTeacher]`)] · [classes.sql:26-60 (`ListClasses[ByTeacher]`), :95-104 (`UpdateClassStatus`)] · [internal/service/exercise_service.go:488-536 (role-branch List), :862 (`Duplicate`), :195-203 (teacher-scope 404)] · [internal/handler/class_handler.go:87-105 (role dispatch)] · [internal/service/student_service.go:41-86 (clamp/pageResult) + notification_service.go:551-611 (overflow-guard mirror)] · [cmd/api/main.go:877 (exercise duplicate route)] · [migrations/20260727120000_create_exercises.up.sql:44 (`deleted_at`)] · [20260703120200_create_classes.up.sql:22-24 (`status`,`teacher_id`)] · [20260719120000_add_class_crud_columns.up.sql (`end_date`,`updated_at`)].
- Frontend reuse: [Source: classlite-web/src/features/exercises/api/useDuplicateExercise.ts + ExerciseLibraryPage.tsx:161-169] · [src/features/inbox/InboxRoute.tsx, components/InboxStates.tsx, api/useInbox.ts] · [src/features/exercises/api/exercisesKeys.ts:19-34 (scope discriminator)] · [src/routes.tsx:592-640 (/exercises gate + `:id/edit`→ExerciseEditorPage)] · [src/components/domain/sidebarNavConfig.tsx:54/79/97] · [src/components/shared/RouteRoleGate, hooks/useRole.ts] · [src/lib/query-client.ts:25 (staleTime)] · [src/lib/test/__tests__/i18n-parity-coverage.test.ts:39-40].
- Contract / prior: [Source: _bmad-output/implementation-artifacts/4-1-exercise-library-and-crud-api.md (soft-delete + Duplicate; archive/restore→Epic 10)] · [5-1-assignment-creation-and-submission-lifecycle-api.md:51-53 (AC15-17 lock + clone-as-sanctioned-path, no unlock)] · [3-1-class-crud-lifecycle-and-creation-ui.md (status machine, `ended` terminal, no `ended_at`)] · [deferred-work.md:737-742 (FU-4-1-A → Epic 10 archive/restore)].
- Epic / UX / FR: [Source: epics/epic-10.md#Story 10.2 (AC) + epics.md:3134-3172] · [epics.md:185 FR-60 + prds/…/prd.md:771-781 (FR-60), :349-354/:1005 (FR-14 archive-after-period + the 30-day `[ASSUMPTION]`)] · [ux-design-specification.md:405 §6.6 (the two reuse verbs), :486 §8.3 (s28 list-table, rows open read-only), :382 §6.4 (empty), :396 §6.5 (list-table pattern)].
- Rules: GO-1/3/4/5, GFW-5, SEC-9, TS-3/4/6/7, FW-3/4, UX-1/2/3, TEST-BE-1/2/3, TEST-FE-1/4/6, XL-1/2, WF-1/2/3/4/8. [Source: docs/project-context.md]

### Risk / WF-8

| Risk | Score | Covered by |
|---|---|---|
| **Cross-TEACHER read leak** (teacher A sees B's archived exercises/classes — same tenant, RLS does NOT isolate; relies on the service `created_by`/`teacher_id=caller` predicates on a NEW reversed read) | **≥6** (the 7-2a/10-1c teacher role-scope class) | AC5 RED-FIRST (two-teacher-one-center, both types) + DD5 service invariant + the shipped 404 non-disclosure |
| **Cross-TENANT read leak via a reversed filter** (`deleted_at IS NOT NULL` / `status='ended'` surfacing rows every other query hides — the SEC-9 soft-delete+RLS trap) | **≥6** (R1 class) | AC6 RED-FIRST store RLS (two tenants, `test.SetupDB`, never DISABLE RLS) + explicit SEC-9 assertion |
| **Migration regresses existing class flows** (stamping `ended_at` inside `UpdateClassStatus` touches the CAS/audit path) | 4 | AC3/AC7 (CAS + audit preserved; additive nullable column; up→down→up) |
| Union-pagination coherence (the 10-1c two-source bug) | low (resolved-by-design) | DD1 — ONE SQL `UNION ALL`, one `total`, honest `LIMIT/OFFSET` |

**WF-8 — HARD GATE (true).** Two net-new role-scoped reads that intentionally surface normally-hidden rows own both a cross-TEACHER and a cross-TENANT isolation surface (the ≥6 risk is genuinely here, as in 10-1c). Full red-first ATDD ceremony: AC5 (cross-teacher), AC6 (cross-tenant store RLS + SEC-9), AC2/AC3 (reversed-filter correctness + `ended_at` stamp), AC4 (type/422) ship as `//go:build atdd_red_phase` specimens, verified red (tagged compile/assert fails only on documented green seams; untagged `go build`/`go vet` clean), then de-tagged green. Confirm at `/bmad-tea AT 10-2`.

---

## Definition of Done

- All 10 ACs met.
- `GET /api/archive` returns a role-scoped, UNION-paginated, reversed-filter archive of soft-deleted exercises + ended-≥30-days classes; `type` filter (422 on bad enum); cross-teacher AND cross-tenant isolation proven by adversarial tests; `ended_at` migration additive + backfilled + reversible, stamped on `→ended` with CAS/audit intact.
- The `/archive` page renders role-dispatched, read-only rows filterable by type with the L/E/E trilogy; students blocked; Duplicate reuses the shipped exercise endpoint (toast + invalidate), Edit-a-copy navigates to `/exercises/{newId}/edit`; classes carry no reuse affordance (Ducdo D3).
- NO new table, NO new RLS policy; `go test -p 1 ./...` green (incl. WF-8 reds + migration up/down/up); `codegen.sh` clean (sqlc +2 queries + `UpdateClassStatus` delta, openapi +1 path/2 schemas); `tsc -b` green; full web vitest green (0 regressions) incl. role-dispatch, student-blocked negative, duplicate/edit-a-copy, parity, axe, and the fixed `OWNER_ONLY_HREFS`; ESLint clean.
- All new strings in `en.json`+`vi.json` + `STORY_10_2_KEYS` ratchet (no hardcoded English); api.yaml + client.ts + FE in ONE commit (WF-4); no generated-file hand-edit.
- File ≤600 lines; completion-notes sibling (`10-2-archive-completion-notes.md`) created at dev pickup per `docs/bmad-story-conventions.md`.

---

## Out of Scope (→ follow-ups)

- **Sessions in the archive** (Ducdo D1) — no archive/past state (only `scheduled|cancelled`+dates), past sessions immutable, "duplicate a session" undefined → `FU-10-2-SESSIONS` (needs a product definition of what a past-session archive + reuse even means).
- **Class Duplicate / Edit-a-copy** (Ducdo D3) — no class clone endpoint exists (classes spawn from templates, not duplicated) → `FU-10-2-CLASS-DUPLICATE` (+ a unified `/api/archive/{type}/{id}/duplicate` dispatcher once >1 type clones).
- **Restore / un-archive verb** — `FU-4-1-A` named "view/**restore** soft-deleted exercises"; 10.2 delivers VIEW + Duplicate, NOT restore (the 10.2 AC has no restore verb) → `FU-10-2-RESTORE` (un-soft-delete an exercise / re-activate an ended class).
- **Configurable archive period** — the 30-day window is a named const; FR-14 says "configurable period" → `FU-10-2-ARCHIVE-PERIOD-CONFIG` (per-center setting).
- **Copy-suffix casing** — epic says `"(Copy)"`, the shipped engine uses `" (copy)"`; kept verbatim (DD3). A global casing pass → cosmetic FU if ever wanted.
- **Index tuning** for the reversed reads at volume (archived exercises ride `exercises` RLS indexes; ended classes `classes(status, ended_at)`) → add a targeted index migration only if `EXPLAIN` shows a problem at scale.

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-07 | **Code-review → done** (`/bmad-code-review 10-2`, Amelia; 3 adversarial Opus-4.8 layers Blind/Edge/Auditor, all findings cross-verified against source). 1 decision-needed + 6 patch + 1 defer + 3 dismissed. **Headline (Edge Case Hunter, CONFIRMED; Blind + Auditor both MISSED it):** AC9 Duplicate/Edit-a-copy 404'd on EVERY archived exercise — the reused `POST /api/exercises/{id}/duplicate` read its source via `GetExerciseByID` (`deleted_at IS NULL`), so a soft-deleted (archived) source resolved to `pgx.ErrNoRows → 404`; the FE test false-greened on an MSW-mocked 201. **Ducdo ruled Option 1 →** new `GetExerciseByIDForDuplicate` (soft-delete-inclusive) sqlc query, `ExerciseService.Duplicate` reads through it, cross-teacher `assertExerciseTeacherScope` 404 intact, public endpoint's active-source behavior unchanged, no fork (DD3 honored). **6 patches applied:** (1) the AC9 fix + new `TestArchive_DuplicateArchivedExercise_OwnAndCrossTeacher_ATDD` proving own→201 & cross-teacher→404 · (2) `editLink` docs de-misleaded (it's the AC1 contract link to the archived original, NOT the Edit-a-copy target — that's the 201's new id) · (3) new store-level crafted-tenant-B-id RLS test (`TestArchive_CrossTenantRLS_StoreLevel_ATDD`, TEST-BE-2) · (4) ATDD parse-struct `targetBand *int`→`*float64` (half-band unmarshal) · (5) out-of-range `page` render-time clamp to `totalPages` (no FW-4 useEffect) · (6) teacher `teacher:self` transient scope gated on `user.id` hydration. **1 defer:** AC8 mobile-reflow (390px) test → `FU-10-2-MOBILE-REFLOW-TEST`. **3 dismissed:** `requiredRolesForCopy={['owner','admin']}` is the consistent project-wide staff-route convention · the backfill `updated_at` fallback is spec-sanctioned (Task 1.1) + documented · `navigate('/exercises/${created.id}/edit')` undefined-id is moot (type guarantees id). **GATES GREEN:** `go build`/`vet`/`gofmt` (my files) · `go test -p 1 ./...` 16 pkgs 0-fail (cleared a PRE-EXISTING `@example.com` committed-pool test leak from an interrupted prior run — 543 users/6 centers; unrelated to 10.2) · `codegen.sh` (sqlc +1 query, generated/ gitignored) · `tsc -b` 0 · archive+parity+role-filtering vitest 5 files/1066 tests 0-fail · ESLint 0. Next: commit (atomic). |
| 2026-10-07 | **Implemented → review** (`/bmad-dev-story 10-2`, Amelia). Substrate-first per the ATDD handoff. **BE:** migration `20261007120000_add_classes_ended_at` (additive nullable + audit-genesis backfill + down; up→down→up verified); `UpdateClassStatus` stamps `ended_at` on →ended only (CAS + audit intact; `ended_at` appended to all classes full-column lists to preserve the `generated.Class` shape); `archive.sql` UNION-ALL `ListArchive`/`CountArchive` (teacher narg + type_filter + cutoff; class-branch skill projected `''` so the UNION column stays non-null `string` → '' maps to null on the wire); `ArchiveService.List` (clamp+`math.MaxInt32` guards · role-branch teacherID · `assertClassRole` student→403 · type enum→422 · `archiveClassGraceDays=30*24h`) + `ArchiveItem` DTO; `ArchiveHandler.List` on the exercise staff chain; api.yaml `ArchiveItem`+`EnvelopeArchiveList`+`GET /api/archive` → codegen. All 4 BE reds de-tagged GREEN + AC7 `ended_at`-stamp store test added. **WF-8 no-guard controls all fired red then reverted:** (a) drop teacher predicate → AC5 cross-teacher leak · (b) flip cutoff sign → AC3 recent-ended appears · (c) drop `SET LOCAL` → AC6 cross-tenant leak. **FE:** `src/features/archive/` slice (archiveKeys scope-discriminator · useArchive · useDuplicateArchiveExercise reusing the shipped exercise endpoint via the barrel · archiveMapping seam · ArchiveStates L/E/E · ArchiveView read-only table + type chips + Duplicate/Edit-a-copy · ArchiveRoute role-gate) + `/archive` route (RouteRoleGate staff) + 17 `STORY_10_2_KEYS` both locales folded into the master ratchet + ArchiveView.test.tsx (trilogy/read-only/student-blocked/duplicate-once/edit-copy-navigate/axe) + fixed stale `OWNER_ONLY_HREFS`. **GATES GREEN:** BE `go test -p 1 ./...` all pkgs (1 pre-existing inbox committed-pool leak cleaned, unrelated) · gofmt/vet · codegen no-drift · `tsc -b` 0 · full web vitest 299 files/3899 tests 0-regression · ESLint 0. File List + Dev Agent Record → `10-2-archive-completion-notes.md`. Next: `/bmad-code-review 10-2` (different LLM). |
| 2026-10-07 | **ATDD red-phase generated + verified** (`/bmad-tea AT 10-2`, Murat). Stack=fullstack, AI-generation mode. 7 files: BE `//go:build atdd_red_phase` (`story_10_2_helpers_test.go` seam + `archive_scope_atdd_test.go` AC5 cross-TEACHER + owner-center-wide + student-403 · `archive_cross_tenant_rls_atdd_test.go` AC6 cross-TENANT both directions + SEC-9 reversed-filter · `archive_contract_atdd_test.go` AC1 envelope/link + AC2 exercise reversed + AC3 class ended+30d cutoff via MockClock incl. NULL-ended_at absent + AC4 type/422 + huge-page clamp); FE `archiveMapping.golden.test.ts` (compile-seam `../archiveMapping`) + `archiveI18nKeys.ts` (`STORY_10_2_KEYS`, 17 keys) + `archiveI18nParity.test.ts` (parity-red). **RED VERIFIED:** BE untagged `go build`/`go vet ./...` exit 0 (reds excluded); tagged `go test -c` compile-fails on EXACTLY 2 documented seam symbols (`service.NewArchiveService`/`handler.NewArchiveHandler`), zero incidental; gofmt clean. FE `tsc -b` = 1 error total (`../archiveMapping` seam; LSP billing/profile/notification flood confirmed stale-cache — CLI tree clean); parity-red fails on 17 missing keys both locales. Seam contract + green guidance: `_bmad-output/test-artifacts/atdd-checklist-10-2-archive.md`. **WF-8 HARD GATE SATISFIED for backlog→in-progress.** Stays ready-for-dev. Next: `/bmad-dev-story 10-2` (migration+substrate-first, de-tag each BE red at green, run the 3 documented no-guard controls on the created_by/teacher_id predicates · ended_at cutoff · RLS SET LOCAL). |
| 2026-10-07 | Created via `/bmad-create-story 10-2` (Amelia). 3-agent parallel recon (backend data-model/duplicate · frontend/UX · prior-art/deferred-work) + reads of epic-10 s10.2, FR-60/FR-14, Stories 3.1/4.1/5.1, UX §6.6/§8.3, deferred-work FU-4-1-A. **Key findings:** "archived" is a REVERSED filter (exercises `deleted_at IS NOT NULL`; classes `status='ended'`) with NO query returning these today; classes have no `ended_at` anchor for "+30 days"; sessions have no archive concept; the exercise Duplicate deep-copy already ships (4.1/5.1-sanctioned). **4 Ducdo rulings:** D1 TYPES = exercises+classes only (sessions→FU-10-2-SESSIONS) · D2 ANCHOR = new `ended_at` migration (stamp+backfill) · D3 VERBS = exercises get both Duplicate+Edit-a-copy, classes read-only (class clone→FU-10-2-CLASS-DUPLICATE) · D4 SCOPE = role-scoped per FR-60 (teacher own / admin-owner center-wide; cross-teacher 404; fix stale `/archive` OWNER_ONLY test). **WF-8 HARD GATE** — two net-new role-scoped reversed reads own cross-TEACHER + cross-TENANT (SEC-9) ≥6 risks → red-first ATDD. One additive migration; duplicate = pure reuse. 10 ACs / 8 tasks. New FUs: FU-10-2-{SESSIONS, CLASS-DUPLICATE, RESTORE, ARCHIVE-PERIOD-CONFIG}. backlog → ready-for-dev. baseline 8812dc0. Next: (optional `/bmad-tea AT 10-2`) → `/bmad-dev-story 10-2`. |

---

### Review Findings

_`/bmad-code-review 10-2` (Amelia; 3 adversarial Opus-4.8 layers — Blind Hunter / Edge Case Hunter / Acceptance Auditor; all findings cross-verified against source). 1 decision-needed, 6 patch, 1 defer, 3 dismissed. 2026-10-07._

**Decision-needed**

- [x] [Review][Patch] **AC9 Duplicate / Edit-a-copy 404s on EVERY archived exercise** (was decision-needed; **Ducdo ruled OPTION 1** 2026-10-07) — The archive only lists soft-deleted exercises (`deleted_at IS NOT NULL`), but the reused `POST /api/exercises/{id}/duplicate` → `ExerciseService.Duplicate` reads its source via `GetExerciseByID` (`exercises.sql:57` = `WHERE id=$1 AND deleted_at IS NULL`), so the source resolves to `pgx.ErrNoRows → exerciseNotFound → 404`. AC9's sole reuse verb is non-functional against the exact rows it is offered on. The FE `ArchiveView.test` passed only because MSW mocks the 201 (MSW false-green). CONFIRMED [`exercise_service.go:879`, `exercises.sql:57`, `useDuplicateArchiveExercise.ts:33`]. **FIX (D1):** add a soft-delete-inclusive source read (e.g. `GetExerciseByIDForDuplicate`, no `deleted_at` filter) and route `ExerciseService.Duplicate`'s source read through it; **keep `assertExerciseTeacherScope`'s cross-teacher 404 intact**; the public endpoint's behavior for active sources is unchanged. Does NOT fork the endpoint (DD3 honored — same route, one extra store query). Related: the server `link`/FE `editLink` field resolves with this.

**Patch**

- [x] [Review][Patch] Add the AC5 cross-TEACHER duplicate→404 assertion (WF-8 clause; currently untested — the behavior is reused but the gate has no specimen; sequence AFTER the decision above so it asserts cross-teacher, not soft-delete, 404) [`archive_scope_atdd_test.go`]
- [x] [Review][Patch] ATDD parse-struct declares `targetBand *int` but the wire/DTO is `*float64` (half-bands) — latent unmarshal failure the moment a non-null-band exercise is in the archive [`archive_contract_atdd_test.go` parse struct]
- [x] [Review][Patch] Out-of-range `page` renders the empty-archive state (and a `5 / 2` pager) instead of clamping `page` down to `totalPages` when the total shrinks under the current page [`ArchiveView.tsx:118,153`]
- [x] [Review][Patch] Teacher query fires under the transient `teacher:self` scope slot if `center` hydrates before `useSessionUser()` (the `useArchive` `enabled` gates on `centerId`, not `user.id`) → orphaned cache slot + redundant fetch [`ArchiveView.tsx:115-116`, `useArchive.ts:58`]
- [x] [Review][Patch] `link`/`editLink` is dead + misleading — named the "Edit-a-copy target" but unused by `runDuplicate` (which navigates to the 201's `created.id`) and points at the archived original's `/edit` route; clarify or drop (contingent on the decision above) [`archive_service.go:178`, `archiveMapping.ts:54`]
- [x] [Review][Patch] Add the literal store-level crafted-tenant-B-id RLS adversarial test AC6/WF-8 named (currently proven only through the HTTP chain; TEST-BE-1 prefers the store seam for RLS) [`archive_cross_tenant_rls_atdd_test.go`]

**Defer**

- [x] [Review][Defer] AC8 mobile-reflow (390px) is implemented (responsive classes) but not test-asserted — add an overflow/structural test [`ArchiveView.test.tsx`] — deferred, coverage enhancement

**Dismissed (3)** — `requiredRolesForCopy={['owner','admin']}` on the staff `/archive` route is the consistent project-wide convention (every sibling staff route incl. the mirrored `/exercises`), not a story defect · the backfill `updated_at` fallback for pre-audit ended rows is spec-sanctioned (Task 1.1) + documented in the migration comment · `navigate('/exercises/${created.id}/edit')` with an `undefined` id is moot (the `Exercise` type guarantees `id` on a well-formed 201) and unreachable until the decision above is resolved.
