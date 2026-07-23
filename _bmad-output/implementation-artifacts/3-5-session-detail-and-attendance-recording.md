---
epic: 3
story: 3.5
story_key: 3-5-session-detail-and-attendance-recording
baseline_commit: d932dc1cab4fcc4c938e058f400a56f4a0029457
created: 2026-07-22
audience: full-stack
size: M
depends_on: [3.4]
scope_decision: "SPLIT — attendance recording deferred to 3.5b (which depends on new keystone Story 3.4.5 Enrollment Linkage Foundation; sequence 3.4.5 -> 2.7 -> 3.5b); inbox reminder deferred to Epic 10. Ruled by Ducdo 2026-07-22, refined at party-mode review same day."
---

# Story 3.5: Session Detail & Content Management

Status: ready-for-dev

## ⚠️ Scope banner — read first

Story 3.5 as originally scoped in `epic-03.md` bundles **attendance recording** with session content. Attendance has a **hard dependency on a per-class student roster that does not exist**: there is no `enrollments`/`students`/`class_members` table — "student" exists only as `center_members.role='student'` (center-wide, not class-scoped). Per the resolved ruling **FU-3-4-A (2026-07-21)**, `enrollments` is confirmed **Epic 7** (architecture §4.11, People Management s39–s44). This is the same gap that forced Story 3.4 to ship `/my-schedule` as a dormant placeholder.

**Ducdo's ruling (2026-07-22):** SPLIT the story.

- **This story (3.5)** ships everything that is unblocked: the **session detail page (screen s12)**, the three session-scoped content tables (`session_notes`, `session_materials`, `session_exercises`), their endpoints, the route + navigation wiring, and the attendance section rendered as a **dormant placeholder** (ComingSoonPanel, mirroring 3.4's `/my-schedule`).
- **Deferred to Story 3.5b**: the `attendance` table, the per-student roster, Present/Late/Absent recording, and bulk actions. **3.5b depends on Story 3.4.5 "Enrollment Linkage Foundation"** (the keystone that produces the `enrollments` table + `CreateEnrollment` + `ListEnrolledStudentsByClass`), which also un-halts Story 2.7. End-to-end sequence: **3.4.5 → 2.7 (un-halted) → 3.5b**. (Party-mode review, Mary's evidence, 2026-07-22: `enrollments` is a mis-sequenced foundational linkage table wrongly bundled into Epic 7 Story 7.3; 10 consumer stories across Epics 3/7/8 depend on it. The People-Management *console* — transfer/withdraw/`enrollment_history` — stays in 7.3.)
- **Deferred to Epic 10** (Inbox surface + FR-56/59 notification delivery): the "generate an Inbox prompt when a session ends unmarked" reminder.

Add a deferred-work entry (**FU-3-5-A**) capturing the 3.5b + Epic 10 carve-outs before finalizing.

## Story

As a Teacher, Admin, or Owner,
I want to open a full session detail page and manage that session's notes, materials, and exercises,
So that I can document and organize the content of each session (with attendance recording arriving once enrollments exist).

## Acceptance Criteria

Adapted from `epic-03.md` Story 3.5 for the split. Original AC IDs preserved for traceability; deferral is explicit.

**AC1 — Session detail page renders all sections** *(FR-18)*
**Given** a Teacher/Admin/Owner navigates to the session detail view `/sessions/{id}` (screen s12),
**When** the page renders,
**Then** these sections are displayed in the s12 layout (detail-head + main column + 300–320px right rail). **Section order (Sally, party-mode 2026-07-22):** the main column opens with the sections that *work* — **session info** (date, time, class, topic, recurrence banner if part of a series), **materials**, **exercises**, **notes** — and the **attendance** placeholder sits **last in the main column** (or in the right rail near the Actions card), never in the above-the-fold #2 slot. The **Actions card** (edit / cancel) is the dashed right-rail card.

**AC2 — Attendance section is a dormant placeholder (DEFERRED to 3.5b)**
**Given** the attendance section is visible (demoted to last-in-main / right-rail per AC1),
**When** the teacher views it,
**Then** a `ComingSoonPanel`-style placeholder is shown, styled as a **future affordance** (amber/dashed "coming" treatment + icon/illustration, **not** the red/neutral error treatment — it must not read as a failure state), with **teacher-language** copy that names the *what* and *why* without jargon — e.g. **"Roll call is coming. Once students are enrolled in this class, you'll mark Present, Late, and Absent right here."** **No** roster, status selectors, or bulk actions are built this story. Do **not** hide the section entirely (hiding it hides the roadmap). Original epic ACs for the roster, Present/Late/Absent selector, bulk "Mark all" actions, and the ended-session Inbox reminder move to **3.5b / Epic 10** unchanged.

**AC3 — Session notes CRUD** *(part of FR-18; `session_notes` table)*
**Given** a session detail page,
**When** the teacher adds, edits, or deletes a note,
**Then** the note is persisted to `session_notes` (linked to the session via `session_id` + `center_id`) and the notes section reflects the change. Content is addable on **past** sessions (no `starts_at >= now` floor — teachers document after the fact) **and on `cancelled` sessions** (Ducdo, 2026-07-22 — a teacher may note *why* it was cancelled; status is not a write-gate for content). This addability rule applies to notes, materials, and exercises alike. Notes are standard content, **not** the writing-editor exemption (FW-8): use a simple textarea + explicit save, RHF+zodResolver where a form is warranted.

**AC4 — Session materials CRUD (link-based)** *(part of FR-18; `session_materials` table)*
**Given** a session detail page,
**When** the teacher adds a material (title + external URL) or removes one,
**Then** the material is persisted to `session_materials` (linked via `session_id` + `center_id`) and listed with title + link. **File upload is out of scope** — R2 presign is "finalized in a later story" (`api.yaml:2771`); materials are **link-only** this story. `kind` column defaults to `'link'` to leave room for a future `'file'` kind.

**AC5 — Session exercises CRUD (session-scoped)** *(part of FR-18; `session_exercises` table)*
**Given** a session detail page,
**When** the teacher adds an exercise (title + optional instructions + optional link) or removes one,
**Then** the exercise is persisted to `session_exercises` (linked via `session_id` + `center_id`) and listed. These are **lightweight session-scoped entries**, NOT the global assignments / Knowledge-Hub entity (that is Epic 5/6) — do not FK to or assume any `exercises`/`assignments` table.

**AC6 — Persistence + RLS** *(part of FR-18)*
**Given** session content is persisted,
**When** the database is inspected,
**Then** records exist in `session_notes`, `session_materials`, and `session_exercises`, each carrying its own `center_id` and the 4-policy RLS grid (SELECT/INSERT/UPDATE/DELETE tenant-scoped), with cross-tenant read AND write isolation proven by RLS tests (TEST-BE-1). The `attendance` table is **not** created this story.

**AC7 — Routing, navigation, and role gating**
**Given** the session detail route,
**When** access is evaluated,
**Then** `/sessions/{id}` is gated to `owner/admin/teacher` via `RouteRoleGate` (students never reach it; record-level authz is the GET-404-in-layout two-layer model). Session rows in the class-detail **Sessions tab** (`src/features/classes/tabs/SessionsTab.tsx`) and calendar `onSelectSession` navigate to this page. Teacher-scope isolation is enforced service-side (cross-teacher → 404, student → 403), reusing 3.4's `assertClassRole` + `assertSessionTeacherScope`.

**AC8 — Loading / Empty / Error trilogy + i18n** *(UX-1, UX-2)*
**Given** the detail page and each content section,
**When** data loads, is empty, or errors,
**Then** all three states are implemented (skeleton mirroring content shape / purpose-designed empty / human error + one retry), and every new string exists in **both** `en.json` and `vi.json` under a `STORY_3_5_KEYS` guard with parity asserted.

## Tasks / Subtasks

> **Ordering guard (WF-1/WF-3):** backend gate ships FIRST — migrations → `migrate.sh` → `.sql` queries → `api.yaml` → `codegen.sh` — before any frontend consumer. `codegen.sh` is the LAST script run.

### Backend (classlite-api)

- [ ] **T1 — Migrations for the 3 content tables (AC3–AC6)**
  - [ ] Create migration pair `{ts}_create_session_content.up.sql` / `.down.sql` (single migration for all three, or three pairs — engineer's call; check `ls migrations/ | tail -5` for next timestamp after `20260721120000`).
  - [ ] `session_notes`: `id`, `center_id` NOT NULL REFERENCES centers(id) ON DELETE CASCADE, `session_id` NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, `body text NOT NULL`, `author_id uuid REFERENCES users(id)`, `created_at`, `updated_at`.
  - [ ] `session_materials`: same tenant/session FKs + `title text NOT NULL`, `url text NOT NULL`, `kind text NOT NULL DEFAULT 'link' CHECK (kind IN ('link'))` (room for `'file'` later), `created_at`, `updated_at`.
  - [ ] `session_exercises`: same tenant/session FKs + `title text NOT NULL`, `instructions text`, `link text`, `created_at`, `updated_at`.
  - [ ] Each table: `ENABLE`+`FORCE ROW LEVEL SECURITY` + the **exact 4-policy grid** from `20260721120000_create_sessions.up.sql` (SELECT/INSERT/UPDATE/DELETE, `center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`). **Single composite index `idx_{table}_center_session ON (center_id, session_id)`** (serves the RLS predicate + the `session_id` filter in one index — Winston, party-mode; not two single-column indexes). Each table carries its **own** `center_id` column (denormalized from the parent session) — the RLS grid and the null-guard tests assume a local `center_id`, not a join to `sessions`.
  - [ ] `.down.sql` exactly reverses (DROP POLICY → DROP TABLE), reverse order.
  - [ ] Run `scripts/migrate.sh` (never raw psql — WF-2).
- [ ] **T2 — sqlc queries (AC3–AC6)**
  - [ ] Add `internal/store/queries/session_content.sql` (mirror `sessions.sql` conventions: `-- name: X :one/:many/:exec`, `sqlc.arg`/`sqlc.narg`, RLS handles `center_id` — filter on `session_id`). Queries: List{Notes,Materials,Exercises}BySession, Create*, Update{Note,Material,Exercise}, Delete* (each `:exec` or `:one`).
  - [ ] Insert sets `center_id` directly from `tc.CenterID` (not a trigger).
- [ ] **T3 — Service layer (AC3–AC7)**
  - [ ] `internal/service/session_content.go` — methods on `*SessionService` (or a new `SessionContentService` sharing `AuthDB`+`AuditLogger`+`clock`). Reuse the tenant-tx ceremony (`readInTenantTx`/`mutateInTenantTx`), `assertClassRole(tc)` (owner/admin/teacher else 403 `INSUFFICIENT_ROLE`), and `assertSessionTeacherScope` (cross-teacher → 404). Load parent session via `LockSession`/`GetSessionByID` to derive `class_id`/`center_id` for the scope gate.
  - [ ] **No `starts_at >= now` floor** on content mutations (unlike 3.4 scheduling) — content is addable post-session.
  - [ ] Audit each mutation via `AuditService.LogWithinTx` (entityType `"session_note"`/`"session_material"`/`"session_exercise"`).
- [ ] **T4 — api.yaml + handler + routes (AC3–AC7)**
  - [ ] Add to `api.yaml`: `SessionNote`, `SessionMaterial`, `SessionExercise` schemas (explicit nulls, camelCase), their create/update request bodies, and `Envelope*`/`EnvelopeList*` wrappers. **Do NOT modify** the existing `SessionDetail` schema (`api.yaml:4116`, session+series — consumed by 3.4's `useSession`); the content collections load from **their own endpoints** (independent caching, per epic-3.2 convention).
  - [ ] Endpoints on the existing `sessionChain` (`cmd/api/main.go:438-443`): `GET/POST /api/sessions/{id}/notes`, `PATCH/DELETE /api/sessions/{id}/notes/{noteId}`; same grid for `/materials` and `/exercises`.
  - [ ] `internal/handler/session_content_handler.go` — methods returning `error`, `{data,meta}` envelope via `WriteEnvelope`, path IDs via `parseSettingsPathID`, strict body decode (`maxSessionBodyBytes`). Reuse typed errors (`model.ValidationError`→422, `NotFoundError`→404 code `SESSION_NOT_FOUND`/`SESSION_NOTE_NOT_FOUND` etc., `service.ForbiddenError`→403). Register new error codes in the mapper if new HTTP semantics are needed.
  - [ ] Run `scripts/codegen.sh` (LAST — regenerates sqlc + `client.ts`).
- [ ] **T5 — Backend tests (AC6, TEST-BE-1..4)** — *Murat's minimum bar, party-mode 2026-07-22. Prereq: add ~3 raw content-row inserters (`insertSessionNoteRaw`/`…MaterialRaw`/`…ExerciseRaw`, ~10 lines each mirroring `insertSessionRaw`) — the 3 new tables have no fixture inserter yet.*
  - [ ] **RLS grid ×3 tables (mandatory green regression clones)** — clone the Pattern-1..6 grid from `sessions_rls_test.go:175-216` + INSERT-rejection from `audit_logs_rls_test.go:125`, using the existing `resetTenantContext` / `resetTenantContextToDefault` helpers (`adversarial_test.go:20`/`:29` — they already exist; the null-guard path is NOT new). Per table: cross-tenant **read** = 0 rows; cross-tenant **write** (UPDATE *and* DELETE) affects 0 rows *verified by re-fetch as owning tenant* (the "UPDATE-0-rows-is-not-an-error" Postgres trap); **null/empty-tenant** guard = SELECT yields 0 + INSERT rejected by WITH CHECK.
  - [ ] **Explicit cross-tenant FK case (Winston):** tenant A inserts a note whose `session_id` points at tenant B's session → expect **404** (via `assertSessionTeacherScope`), not a leaked/orphan row. The FK alone does not close this — the service-layer parent-load under tenant context does.
  - [ ] **Same-tenant cross-session isolation:** seed two sessions under one tenant (`insertSessionRaw`), write content on session X, list session Y → assert empty. This is WHERE-clause correctness, **not** RLS — RLS won't catch it.
  - [ ] **FK cascade:** delete parent session → assert its notes/materials/exercises rows are gone (guards `ON DELETE CASCADE`; nothing else has a consumer to catch a broken cascade).
  - [ ] **Status/temporal non-gate:** add content to a session whose `starts_at` is 48h in the **past** → 200; add content to a **`cancelled`** session → 200. Regression guard for the "no now_floor / status-agnostic on content" decision (T3 reuses 3.4's scheduling ceremony — do not inherit its floor).
  - [ ] Handler integration via `NewSessionTestServerBareMux` + `SignAccessTokenForRole` (budget a `seedSecondTeacherClass` for the 404 case — needs a 2nd class + teacher identity, same center): teacher CRUD own session; cross-teacher → 404; student → 403; full `{data,meta}` + `{error:{code,message,requestId}}` envelope. Mind the fixture-ordering trap — `CreateCenterMember` after `TenantContext`; reference `sessions_rls_test.go:179-185`.
  - [ ] **Contract gate (Murat — Pact is deliberately unused; spec-diff is the only net):** scoped `git diff` proving the `SessionDetail` schema block in `api.yaml` is **byte-identical** post-change, AND 3.4's existing `useSession` FE tests stay green after `codegen.sh` (guards a shared-`$ref` collision reshaping what 3.4 depends on).
  - [ ] `go test ./... && go vet ./... && gofmt -l`.

### Frontend (classlite-web)

- [ ] **T6 — Route + page shell (AC1, AC7, AC8)**
  - [ ] Add `/sessions/:id` to `src/routes.tsx` under `AppLayout`, deep-imported for its own Rolldown chunk, wrapped in `RouteRoleGate allowedRoles={['owner','admin','teacher']} sectionNameKey="schedule"` (mirror the `/schedule` route ~453-480). Do NOT re-export the page from the `schedule` barrel (chunk isolation).
  - [ ] `SessionDetailPage` with the full trilogy (model on `ClassDetailLayout.tsx`: `DetailSkeleton` / `NotFoundCard` 404 / `role="alert"` error). Session info reads from the existing `useSession(id)` (`src/features/schedule/api/useSessions.ts`) — no new session endpoint.
  - [ ] Layout: `DetailHead` + main column + 300–320px right rail with a dashed **Actions card**; recurrence banner when `recurrenceGroupId != null`.
- [ ] **T7 — Content hooks + optimistic mutations (AC3–AC5, AC8)**
  - [ ] New `src/features/schedule/api/` (or a new `session-detail` feature) hooks: `useSessionNotes(id)`, `useSessionMaterials(id)`, `useSessionExercises(id)` + create/update/delete mutations. Extend `sessionsKeys` with `notes(id)`/`materials(id)`/`exercises(id)` sub-keys.
  - [ ] Mutations use the **optimistic triple** (`onMutate` cancel+snapshot+patch / `onError` restore / `onSettled` invalidate) modeled on `src/features/classes/api/useTransitionClassStatus.ts` (FW-2). All calls via `apiFetch` (envelope-unwrapping); types from generated `client.ts`.
  - [ ] Hand-written Zod schemas per form (no `openapi-zod-client` — it's disabled); `src/features/.../lib/*Schema.ts`.
- [ ] **T8 — Section components + attendance placeholder (AC1–AC5, AC8)**
  - [ ] `NoteBox`-based notes section (add/edit/delete), materials list (title+URL add/remove), exercises list (add/remove). Empty/loading/error per section.
  - [ ] **Attendance section = `ComingSoonPanel`** (reuse `src/features/classes/components/ComingSoonPanel.tsx`) with copy "Attendance recording arrives with student enrollment" — no roster/toggle/bulk-actions.
  - [ ] Action buttons (edit / cancel) open the existing `SessionModal` (`src/features/schedule/components/SessionModal.tsx`) → 3.4's recurrence-scope flow. Do NOT rebuild the modal.
- [ ] **T9 — Navigation wiring (AC7)**
  - [ ] `SessionsTab.tsx` rows link/navigate to `/sessions/{id}`; calendar `onSelectSession` (in `SchedulePage`) navigates to the detail page (decide: detail page vs. keep quick-edit modal — default to detail page per s12 "detail via full-screen push, not modal").
- [ ] **T10 — i18n + FE tests (AC8)**
  - [ ] Add `STORY_3_5_KEYS as const` (namespace `session.detail.*` / `session.notes.*` / `session.materials.*` / `session.exercises.*`); register in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`; add keys to `en.json` + `vi.json`; run `npm run i18n-parity`.
  - [ ] Component tests (Vitest + MSW, never mock Query — TEST-FE-1): three-state coverage per section; role-negative (student cannot reach `/sessions/:id`, TEST-FE-6); `assertI18nParity`; axe clean.
  - [ ] `tsc -b && eslint && vitest && npm run build` (verify the session-detail chunk is isolated, no leak into schedule/dashboard chunks).

### Close-out

- [ ] **T11 — Deferred-work + docs**
  - [ ] Add **FU-3-5-A** to `deferred-work.md`: attendance table + roster + Present/Late/Absent recording + bulk actions → **3.5b**, which **depends on the new Story 3.4.5 "Enrollment Linkage Foundation"** (sequence 3.4.5 → 2.7 un-halted → 3.5b); ended-session Inbox reminder → **Epic 10** (FR-56/59). Reference the original epic-03.md ACs verbatim so 3.5b can restore them. (Story 3.4.5 itself to be created via `/bmad-create-story` — see the party-mode sequencing decision; it is the keystone that also un-halts 2.7 per SEQ-2-7-1.)
  - [ ] If any external/manual setup is introduced (none expected — no new env var/service), skip `docs/manual-setup.md` (WF-9).

## Dev Notes

### Scope decisions (why this shape)

1. **Attendance split (Ducdo, 2026-07-22).** No per-class roster exists; `enrollments` is confirmed Epic 7 (FU-3-4-A). Building attendance now would require pulling Epic 7's People-Management schema forward (scope creep + rework risk) or a semantically-wrong center-wide roster. Both rejected in favor of the split, consistent with the 3.4 `/my-schedule` deferral precedent. Do **not** create the `attendance` table.
2. **Inbox reminder → Epic 10.** No notifications/jobs table exists (jobs lands Epic 4.3; `internal/event/bus.go` is defined but unused/unwired; the worker harness is test-only, in-memory). The Inbox surface is Epic 10 / Story 10.1 (FR-56/59). Nothing to write to and nothing to render → defer the whole reminder AC.
3. **Materials = link-only.** R2 presign is "finalized in a later story" (`api.yaml:2771`). File upload is out of scope; `kind` defaults to `'link'` with a CHECK that a future migration widens to include `'file'`.
4. **Exercises = session-scoped, not the assignments entity.** No `exercises`/`assignments` table exists (Epic 5/6). `session_exercises` is a lightweight standalone table; do not FK to a global exercise entity.
5. **Content addable on past AND cancelled sessions.** The `starts_at >= now_floor` immutability floor (added in 3.4 "to protect 3.5 attendance from retroactive rewrite") applies to **scheduling** mutations only. Notes/materials/exercises are teacher documentation and must be addable after a session ends **and on `cancelled` sessions** (Ducdo, 2026-07-22). Neither time nor status gates content writes. T3 reuses 3.4's tenant-tx ceremony — do NOT copy its scheduling floor by reflex (T5 has the regression guard).
6. **`session_exercises` naming — FLAGGED, not applied (Winston, party-mode).** The epic AC names the table `session_exercises`; kept as-is for traceability. Winston's concern: the name invites a future dev to assume it FKs the Epic 5/6 assignments entity. If the implementer agrees, rename to `session_activities` / `session_agenda_items` at build time and note the epic-AC divergence in the completion notes — the distinguishing property is durable (these are *ephemeral, in-session, ungraded* items; assignments are *graded, submittable, roster-linked*). Engineer's call; either way, do **not** FK to any global exercise/assignment table.

### Reuse map — build on, do not reinvent

**Backend (`classlite-api`)**
- Migration + RLS 4-policy grid: `migrations/20260721120000_create_sessions.up.sql` (copy the exact policy block; tenant anchor = row's own `center_id`).
- sqlc conventions + config: `internal/store/queries/sessions.sql`, `sqlc.yaml` (`emit_json_tags`, `emit_empty_slices`, pgx/v5). RLS scopes `center_id`; queries filter `session_id`.
- Service tx ceremony + gates: `internal/service/session.go` (`readInTenantTx`, `mutateInTenantTx`, `LockSession`, `assertSessionTeacherScope`), `internal/service/class_lifecycle.go:85` (`assertClassRole` → 403 `INSUFFICIENT_ROLE`). Audit: `internal/service/audit.go` (`AuditService.LogWithinTx`).
- Typed errors + mapping: `internal/model/errors.go` (value-typed `NotFoundError`/`ValidationError`/`ConflictError`), `internal/service/errors.go` (pointer-typed), `internal/middleware/error_mapper.go`, `internal/handler/response.go` (`WriteEnvelope`/`WriteError`). Epic-3 codes: `SESSION_NOT_FOUND` (404), `INSUFFICIENT_ROLE` (403), `VALIDATION_ERROR` (422).
- Handler + routing shape: `internal/handler/session_handler.go` (`sessionResponse` GO-5 explicit-null DTO, `parseSettingsPathID`, `decodeClassJSONBody`, `maxSessionBodyBytes`), `cmd/api/main.go:430-443` (`sessionChain` = extractTenant → requireVerified → requireCenter → ErrorMapper; NOT owner-gated — teachers reach it, role enforced in service).
- Tests: `internal/test/helpers.go` (`SetupDB`, `TenantContext`, `TenantAID/BID`, `UUIDString`), `internal/test/fixtures.go` (`CreateUser`, `CreateCenter`, `CreateCenterMember` — **no `CreateStudent`/`CreateTenant`**), `story_3_4_helpers.go` (`NewSessionTestServerBareMux`, `insertSessionRaw`, `seedClassForSession`), `story_3_1_helpers.go` (`SeedClass`), `story_2_6_helpers.go` (`SignAccessTokenForRole`). RLS template: `internal/test/_TEMPLATE_rls_test.go`, reference `sessions_rls_test.go`.

**Frontend (`classlite-web`)**
- Session read + keys + formatters: `src/features/schedule/api/useSessions.ts` (`useSession(id)`), `src/features/schedule/api/sessionsKeys.ts` (`detail(id)` exists — extend with content sub-keys), `src/features/schedule/lib/formatSessionTime.ts`, `src/features/schedule/index.ts` (barrel — cross-feature imports only).
- Optimistic triple reference: `src/features/classes/api/useTransitionClassStatus.ts` (+ `useUpdateTemplate.ts`, `useDeleteTemplate.ts`).
- Detail trilogy shell: `src/features/classes/ClassDetailLayout.tsx` (`DetailSkeleton`/`NotFoundCard`/error). List trilogy + testids: `src/features/classes/tabs/SessionsTab.tsx`.
- Reuse components: `NoteBox` (domain), `DetailHead`, `ClassDetailShell`, `StatusPill` (composable tone/variant — see component-inventory.md:388), `ComingSoonPanel` (`src/features/classes/components/ComingSoonPanel.tsx`), `SessionModal` (`src/features/schedule/components/SessionModal.tsx`), segmented-control primitive `src/components/ui/toggle-group.tsx` (needed in 3.5b, not now).
- Routing + gating: `src/routes.tsx` (`/schedule` ~453-480 as the model), `src/components/shared/RouteRoleGate.tsx`, `src/hooks/useRole.ts`.
- API types + codegen: `src/lib/api/client.ts` (openapi-typescript output — never hand-edit), `scripts/codegen.sh` (`sqlc generate` → `openapi-typescript`). `openapi-zod-client` is DISABLED → hand-write Zod schemas. Source of truth: `classlite-api/api.yaml` (Session/SessionSeries/SessionDetail already present; **no** Attendance schema — and none is added this story).
- i18n: `src/locales/{en,vi}.json` (flat dot-keys, ~998 keys), `src/lib/test/i18n-parity.ts` (`assertI18nParity`), `scripts/i18n-parity.mjs`, `src/lib/test/__tests__/i18n-parity-coverage.test.ts` (register `STORY_3_5_KEYS`).

### Project Structure Notes

- New backend files: `migrations/{ts}_create_session_content.{up,down}.sql`, `internal/store/queries/session_content.sql`, `internal/service/session_content.go`, `internal/handler/session_content_handler.go`, tests under `internal/test/`. Generated output (`internal/store/generated/`, `src/lib/api/client.ts`) is codegen-only.
- New frontend files: a `/sessions/:id` page (deep-imported chunk) + content hooks/components under `src/features/schedule/` (or a new `session-detail` feature dir — keep it out of the `schedule` barrel for chunk isolation).
- No cross-service source imports (WF-7). Additive-only API change (new endpoints, no modified response shapes) → may ship API-first, but keep it one atomic commit (WF-4) since `client.ts` regenerates.

### Testing standards summary

- Backend: store/RLS tests real-DB-in-tx (TEST-BE-1/2, cross-tenant read+write, deterministic tenant IDs, never disable RLS); handler integration through real middleware (TEST-BE-3, full envelope assertions). One mock seam = store interface in service tests (TEST-BE-4).
- Frontend: MSW at HTTP boundary, never mock Query (TEST-FE-1); three-state coverage per section (TEST-FE-2); role-negative (student absent from DOM / cannot route, TEST-FE-6); i18n key-resolution both locales (TEST-FE-4); axe clean (TEST-FE-5). Reset Zustand stores between tests if any are touched (TEST-FE-3).
- Per-story protocol (WF-8) — **corrected at party-mode review (Murat + Amelia, 2026-07-22):** the story is not risk-free just because it's P2. AC6 adds **three** center-scoped tables, which maps to **R2 (RLS null-tenant guard regression, score 6, timeline "per epic adding tables")** and is adjacent to **R1 (cross-tenant leakage, score 9)**. So the **RLS null-guard grid ×3 (T5 item 1) is mandatory, not optional.** BUT — Amelia verified against the harness that the null/empty-tenant helpers already exist (`resetTenantContext`/`resetTenantContextToDefault`, `adversarial_test.go:20`/`:29`) and the path has been red-teamed across 7 resource families since Epic 2 — so R2 is **not** untested infrastructure. The RLS grid here is a **verbatim policy clone**; the mandatory ×3 null-guard tests are therefore **green-on-arrival regression clones**, not a red-first ATDD ceremony. Net: no full `/bmad-tea AT` run required; the RLS grid tests are non-negotiable, everything else is inline green-phase at engineer discretion.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-03.md#Story-3.5] — original ACs (verbatim in scope banner).
- [Source: _bmad-output/planning-artifacts/epics.md] — FR-18 (session shows info/attendance/materials/exercises/notes/actions), FR-19 (attendance → deferred to 3.5b).
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#8.3] — s12 layout (detail + right-rail, dashed Actions card), recurrence banner, "detail via full-screen push, not modal".
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#FU-3-4-A] — enrollments confirmed Epic 7; the roster-gap precedent.
- [Source: _bmad-output/implementation-artifacts/3-4-schedule-workspace-and-session-management.md] — session model, recurrence, now-floor rationale, sessionChain.
- [Source: docs/project-context.md] — GO-1 (TenantContext), GO-5 (no omitempty), GFW-5 (envelope), TEST-BE-1, TEST-FE-1, UX-1/2, WF-1/2/3/8, FW-2/8, XL-3.
- [Source: _bmad-output/planning-artifacts/component-inventory.md] — s12 components (AttendanceToggle/RosterTable are phase-3, **deferred to 3.5b**; NoteBox/DetailHead/StatusPill reused now).

## Definition of Done

- [ ] All in-scope ACs (AC1, AC3–AC8) met; AC2 shipped as the documented placeholder.
- [ ] 3 tables live with full 4-policy RLS + cross-tenant read/write isolation tests green.
- [ ] `GET/POST/PATCH/DELETE` endpoints for notes/materials/exercises on `sessionChain`; teacher-scope (404) + role (403) enforced service-side.
- [ ] `/sessions/:id` page renders all sections + trilogy; navigation wired from Sessions tab + calendar; students blocked.
- [ ] Notes/materials/exercises CRUD works end-to-end with optimistic mutations + rollback.
- [ ] `en.json` + `vi.json` parity green (`STORY_3_5_KEYS` registered); axe clean.
- [ ] `go test ./... && go vet && gofmt -l` clean; `tsc -b && eslint && vitest && npm run build` clean; session-detail chunk isolated.
- [ ] `codegen.sh` run last; generated files not hand-edited.
- [ ] FU-3-5-A added to `deferred-work.md`.
- [ ] Dev Agent Record + File List captured in the sibling `3-5-...-completion-notes.md` (per bmad-story-conventions.md), not this file.

## Out of Scope

- `attendance` table, per-class roster, Present/Late/Absent recording, bulk "Mark all" actions → **Story 3.5b** (depends on new **Story 3.4.5 Enrollment Linkage Foundation**; sequence 3.4.5 → 2.7 → 3.5b).
- Ended-session **Inbox reminder** / notification delivery → **Epic 10** (FR-56/59) — no notifications/jobs table exists to write to.
- Material **file upload** (R2 presign flow) → deferred with R2 finalization; materials are link-only.
- Global **assignments / Knowledge-Hub exercises** entity → Epic 5/6; `session_exercises` is session-scoped only.
- Student `/my-schedule` real calendar (still FU-3-4-A / Epic 7).
- Full **Analytics** on the session → Epic 8.

## Change Log

| Date | Change |
|---|---|
| 2026-07-22 | Story created (ready-for-dev). Split ruling applied: attendance → 3.5b, Inbox reminder → Epic 10; 3.5 scoped to session detail page + notes/materials/exercises. Renamed "Session Detail & Attendance Recording" → "Session Detail & Content Management" to reflect scope. |
| 2026-07-22 | Party-mode review amendments (John/Winston/Sally/Murat/Mary/Amelia). AC1 reorder (attendance demoted out of #2 slot); AC2 humanized future-affordance copy; content addable on cancelled sessions (AC3); T1 composite `(center_id, session_id)` index; T5 expanded to Murat's bar (null-guard ×3, cross-tenant FK 404, same-tenant cross-session, FK cascade, past/cancelled non-gate, contract spec-diff gate); WF-8 note corrected (RLS grid mandatory but green-clone, not red-first — helpers pre-exist per Amelia). `session_exercises` rename flagged (not applied). 3.5b now depends on new keystone **Story 3.4.5 Enrollment Linkage Foundation** (3.4.5 → 2.7 → 3.5b). |
