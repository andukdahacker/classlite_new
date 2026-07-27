---
epic: 4
story: 4.1
story_key: 4-1-exercise-library-and-crud-api
baseline_commit: 752bbd59f10f6f731649cdf8baeb0581bb4507de
created: 2026-07-27
audience: full-stack
size: M
depends_on: [2.6]
scope_decision: "SPLIT (confirmed pragmatic). 4.1 ships skill+tag+band filtering + full CRUD (soft-delete) + Duplicate. DEFERRED: the 'Classes assigned' column + class/assignment-status filters → Epic 5 (no assignment link exists; column OMITTED not faked); two-panel editor → 4.2; archive-restore UI → Epic 10 (4.1 lands the soft-delete data model); JSONB lazy-upgrade → 4.5. FR-20 spans 4.1 (partial) + Epic 5. Amended by party-mode review 2026-07-27 (Winston/Murat/Sally/John)."
---

# Story 4.1: Exercise Library & CRUD API

Status: done

## ⚠️ Scope banner — read first

Story 4.1 as scoped in `epic-04.md` lists filters/columns by **skill, tag, class, and assignment status**. Two dimensions have **no backing data until Epic 5**: **class** + **assignment status** (and the **"Classes assigned"** column) all require the *Assignment* entity (exercise↔class+deadline) — **no `assignments` table exists** (net-new Epic 5, Story 5.1).

**Resolution (confirmed pragmatic; hardened at party-mode review 2026-07-27):**

- **4.1 ships fully:** the `/exercises` library (s15), the `exercises` table with JSONB `content` + `schema_version`, full CRUD (**soft-delete**) + **Duplicate**, and **skill + tag + band filtering + pagination + sort-by-last-modified**.
- **FR-20 is only PARTIALLY satisfied by 4.1.** It spans **4.1** (skill/tag/band filters + CRUD) **+ Epic 5** (class filter, assignment-status filter, "Classes assigned" column). Do **not** mark FR-20 "done" at 4.1 close — the traceability entry must pin the remaining dimensions to Epic 5 or they fall through the crack when Epic 5 lands (John, party-mode).
- **The "Classes assigned" column is OMITTED in 4.1, not faked.** Rendering a literal **"Unassigned"** on every row is a *false data-integrity claim* to a teacher whose exercises ARE in live classes (Sally: "support ticket before coffee"; John: "a tombstone"; Winston: "a 100%-static column reads as a lie"). The header roll-up is **count-only** ("N exercises") — the "N unassigned" breakdown is Epic 5. The class + assignment-status filters are **omitted** (no dead/disabled chips). Epic 5 restores the column + filters + header roll-up together.
- **4.1 declares the v1 `content` schema (the contract 4.2 + 4.3 both write into)** — the typed struct IS the v1 contract (T2). The two-panel structured editor (s16) that *populates* sections/questions is **Story 4.2**; 4.1's "Create Exercise" is a **minimal-metadata create** (title/skill/tags/band/description) persisting the empty shell `{"sections":[]}` + `schema_version=1`. **4.1's create/edit stays in an in-page dialog and returns to the library** — it does NOT navigate to the (non-existent) `/exercises/{id}/edit` editor route; that redirect is wired in 4.2 (Winston: don't ship a dead-end).
- **Delete is SOFT (`deleted_at`), not destroy.** Teacher-authored exercises are multi-hour assets; hard delete with no undo is a data-loss trap and contradicts FR-20's own word ("Archive"). 4.1 lands the soft-delete data model (row disappears from view, recoverable); the **archive/restore UI** is Epic 10.

**Amendment (Story 4.2 party-mode co-development, 2026-07-27 — ratified Ducdo):** the v1 `ExerciseContent` contract is **co-developed with 4.2 and 4.1 declares the COMPLETE v1 shape now** — including the top-level **`Settings`** object (`{TimeLimitEnabled, TimeLimitMinutes, CaseSensitive}`) and **`QuestionGroup.Type`/`Instructions`** — so there is **exactly one physical shape stamped `schema_version=1`** and **no settings-less rows ever exist** (Winston: two shapes under one version turns the discriminator into a lie for Story 4.5). 4.1's minimal-metadata **create materializes FR-22-default settings into the shell** (default-on-write, once — not defaults-on-read). All three settings' FR-22 defaults coincide with the Go zero value (`false`/`0`/`false` = time-limit-off, case-insensitive), so the false-zero-value trap is **designed out**; hyphen/whitespace normalization is **fixed grading behavior (always-on, Epic 5 engine)**, not per-row config. 4.1 also adds the **`updated_at` optimistic-concurrency precondition** to `PATCH /api/exercises/{id}` (AC4/T5) that 4.2's autosave relies on. 4.1 still ships its metadata-only UI; 4.2 populates sections/questions/settings.

Add deferred-work entry **FU-4-1-A** capturing the Epic 5 / Epic 10 / 4.5 carve-outs before finalizing.

## Story

As a Teacher (or Admin/Owner),
I want to browse, create, edit, duplicate, and delete exercises in a filterable library,
So that I can build a library of reusable content for my classes (class-assignment filtering arrives with Assignments in Epic 5).

## Acceptance Criteria

Adapted from `epic-04.md` Story 4.1 + PRD FR-20; deferrals explicit per the scope banner.

**AC1 — Library table renders (FR-20)** *(epic AC1)*
**Given** a Teacher/Admin/Owner navigates to `/exercises` (s15),
**When** the page loads,
**Then** a table lists the exercises the viewer may see (AC8) with: an **Entity cell** (skill-letter tile + title + a mono meta sub-line `code · N sections · N {skill-appropriate unit}` — code/sections/count folded into the title cell per the s15 mockup, **not** separate columns), a **Skill** pill, a **Tags** pill-set, and **Last modified**. The count unit is **skill-appropriate** (Reading/Listening/Grammar/Vocabulary → "questions", Writing → "prompts", Speaking → "cue cards") — never a flat "questions" for every skill. A **skill count-tab strip with per-skill totals** (`All N · Reading n · Listening n · Writing n · Speaking n · Grammar n`) sits above the table; a **"SHOWING n OF total"** footer reflects pagination. Row actions: **Edit · Duplicate · Delete**. The **"Classes assigned" column is omitted** this story (scope banner); the header is **count-only** ("N exercises", no "unassigned" roll-up).

**AC2 — Skill + tag + band filtering, sort & pagination (FR-20 partial)** *(epic AC2, split)*
**Given** the library is displayed,
**When** the teacher selects a skill tab, a tag filter, or a band filter, or pages,
**Then** the API returns only matching rows (`skill` equality + single-`tag` membership `tag = ANY(tags)` + `target_band` equality) **paginated with `page` + `pageSize`** (XL-2), sorted **last-modified-descending** (default), each filter+page combo occupying its own Query cache slot. **`page` validates ≥ 1; `pageSize` has a named default (20) and a server-enforced hard max (100) — `page`/`pageSize` out of range or non-integer → 422** (never 500, never an unbounded fetch). The **class filter + assignment-status filter are OMITTED** (deferred to Epic 5 — no dead/disabled chips). A **user-facing multi-option Sort control is deferred** (documented; default last-modified-desc ships). Multi-tag AND-filtering is deferred (single-tag this story).

**AC3 — Create (minimal-metadata) (FR-20)** *(epic AC3)*
**Given** a teacher clicks **"+ New exercise"**,
**When** they submit the in-page create form with valid data (**title** required; **skill** required from the fixed enum; **tags** optional; **description** + **target band** optional),
**Then** a new `exercises` row is created with a **server-generated `code`** (`EX-<SkillLetter><NNN>`, unique per center, from a per-(center,skill) counter — T4), a JSONB **`content` shell with FR-22-default settings materialized** (`{"sections":[], "settings":{"timeLimitEnabled":false,"timeLimitMinutes":0,"caseSensitive":false}}` — default-on-write, so no settings-less rows ever reach the 4.2 editor), and **`schema_version = 1` (server-set — the request body cannot set or override it)**, owned by the creating teacher (`created_by`). The dialog **closes and the library refreshes** (the new row appears); it does **not** navigate to the 4.2 editor route.

**AC4 — Update preserves schema_version (FR-20)** *(epic AC4)*
**Given** an exercise exists,
**When** a teacher updates it (4.1 UI edits metadata only; the API also accepts a full `content` replacement for 4.2/Duplicate),
**Then** the row is updated (`updated_at` bumped) and **`schema_version` is server-authoritative** — a request body carrying `schema_version` (e.g. `99`) is **ignored/rejected**, and the persisted column keeps its original value (asserted at the DB, T6). `code` is likewise immutable. `content` update semantics are **full-replace** (documented, per CR-3-5-4). **Optimistic-concurrency precondition (co-developed for 4.2 autosave):** the PATCH accepts an `If-Match`/`updatedAt` precondition; the write is `UPDATE … WHERE id = $ AND deleted_at IS NULL AND updated_at = $precondition` — **0 rows affected when the precondition is stale → 409 `CONFLICT`** (never a silent last-writer-wins clobber). A PATCH omitting the precondition is rejected 428 `PRECONDITION_REQUIRED` for the editor path (4.1's own metadata dialog sends the freshly-read `updatedAt`).

**AC5 — Soft-delete + Duplicate (FR-20; PRD FR-20 row actions Edit/Duplicate/Archive)** *(epic AC5)*
**Given** an exercise exists,
**When** a teacher deletes it,
**Then** it is **soft-deleted** (`UPDATE … SET deleted_at = now() WHERE id = $ AND deleted_at IS NULL RETURNING id` → **404** if missing/already-deleted); all reads filter `deleted_at IS NULL`; the row disappears from the library (frontend optimistic-triple removal with rollback). The row is recoverable (Epic 10 restore UI). **When** a teacher duplicates it, **Then** a new row clones `title` (suffixed "(copy)"), `skill`, `tags`, `target_band`, and a **deep copy** of the `content` JSONB, with a **fresh unique `code`** and `created_by` = the duplicator (mutating the copy must never touch the original — T6).

**AC6 — JSONB v1 content contract + typed deserialization (FR-20)** *(epic AC6)*
**Given** the JSONB `content`,
**When** Go (de)serializes it,
**Then** 4.1 **declares the COMPLETE v1 `ExerciseContent` contract** (co-developed with 4.2) — the typed struct `{Sections[]{Type,Title,Content,QuestionGroups[]{Type,Instructions,Questions[]{Text,Type,Options,CorrectAnswer,AcceptedVariants}}}, Settings{TimeLimitEnabled,TimeLimitMinutes,CaseSensitive}}` (GO-7, never `map[string]interface{}`) — that 4.2 (editor) and 4.3 (AI gen) both write into. **`Settings` is part of v1** (materialized at create, default-on-write); 4.2 adds no schema version — there is one shape under `schema_version=1`. The **`schema_version` COLUMN is the single source of truth** and drives a version-dispatch unmarshal (`UnmarshalExerciseContent(raw, version)`); the struct's version field is **`json:"-"` (hydrated from the column, never serialized into the blob — no dual source)**. An unparseable blob / NULL / 0 / unknown version → **typed error, not panic**. `sectionCount`/`questionCount` for the table are **computed in SQL on the list path** (`jsonb_array_length(content->'sections')` + a lateral aggregate for questions — no per-row blob transfer/unmarshal); the **full typed dispatch runs only on the detail GET**. (SQL counts assume v1 shape — add the version fallback when 4.5 lands.)

**AC7 — Persistence + RLS (GO-1, TEST-BE-1)** *(new — mandatory for a new tenant table)*
**Given** exercises are persisted,
**When** the DB is inspected,
**Then** `exercises` (and the `exercise_code_counters` table) carry their **own `center_id`** + the **exact 4-policy FORCE-RLS grid** (SELECT/INSERT/UPDATE-with-both-USING+WITH-CHECK/DELETE, anchor `center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`), a **composite `(center_id, created_by)` index** (RLS predicate + teacher-scope list filter), and a **GIN index on `tags`**. Cross-tenant **read AND write** isolation, **null/unset-tenant** guard, and **cannot-reparent-own-row** (WITH CHECK on UPDATE) are proven, **plus** the party-mode additions: **cross-tenant tag-filter leak** (tenant B row whose tags match tenant A's filter → 0 rows), and **cross-tenant/cross-teacher Duplicate-by-id → 404** (the read-then-INSERT clone path must not cross the boundary).

**AC8 — Teacher scope, routing & role gating (UX-3, SEC-1)** *(new)*
**Given** the library and endpoints,
**When** access is evaluated,
**Then** `/exercises` is gated to **owner/admin/teacher** via `RouteRoleGate` (students never reach it); a **teacher sees only their own** exercises (`created_by = tc.UserID`), **owner/admin see all** in the center (role-scoped list, mirroring `ListClasses` vs `ListClassesByTeacher`); cross-teacher Get/Update/Delete/Duplicate → **404** (`assertTeacherScope`, same 404 as not-found — no enumeration oracle), student → **403**; role is re-validated from `center_members` (JWT claim not trusted for the tier gate).

**AC9 — Trilogy + i18n (UX-1, UX-2)** *(new)*
**Given** the page and its states,
**When** data loads / is empty / errors,
**Then** all three are implemented: **loading** = skeleton rows mirroring the table (never a centered spinner); **empty** = **two distinct states with verbatim copy** — *true-empty* (zero exercises: warm ownership-framed hero + "+ New exercise" CTA) vs *filtered-empty* (has exercises, no filter match: quiet "no matches" + "Clear filters", **no** big CTA); **error** = human message + one retry, inline. Every string exists in **both** `en.json` and `vi.json` under `exercises.*` (registered in the coverage test, parity green). The compound meta line is a **parameterized ICU message** (never string concatenation — the unit noun is skill-dependent and Vietnamese must reorder freely); `vi` plurals resolve to ICU `other` (no `_one` split). **[Amended 2026-07-27, code-review chunk 2 — Ducdo pragmatic ruling]** The CI `scripts/i18n-parity.mjs` enforces IDENTICAL en/vi key-sets (`exercises.` is not an exempt namespace), so a vi locale MUST physically carry any `_one` key English needs — even though vi never resolves it. `vi.json` therefore keeps `exercises.countLabel_one` as a harmless dead duplicate of `_other`; this is the sanctioned consequence of the parity tooling, not an AC9 violation. The intent of "no `_one` split" (vi has one plural category) still holds at runtime (count=1 → `_other` in vi). **`EX-` codes and class-codes are locale-invariant** (never translate the skill letter).

## Tasks / Subtasks

> **Ordering guard (WF-1/WF-3):** backend FIRST — migration → `migrate.sh` → `.sql` queries → `api.yaml` → `codegen.sh` (LAST). Additive-only API change → API-first OK, but one atomic commit since `client.ts` regenerates (WF-4).

### Backend (classlite-api)

- [x] **T1 — Migration: `exercises` + `exercise_code_counters` + RLS + indexes (AC3, AC5–AC7)**
  - [x] Pair `20260727120000_create_exercises.up.sql` / `.down.sql` (timestamp > `20260725120000`; verify `ls migrations | tail`; never edit existing — WF-2; run via `scripts/migrate.sh`).
  - [x] `exercises`: `id uuid PK default gen_random_uuid()`, `center_id uuid NOT NULL REFERENCES centers ON DELETE CASCADE`, `created_by uuid NOT NULL REFERENCES users`, `code text NOT NULL`, `title text NOT NULL`, `description text`, `skill text NOT NULL CHECK (skill IN ('reading','listening','writing','speaking','grammar','vocabulary','general'))` — **full words per CQ-4, no `vocab`**, `tags text[] NOT NULL DEFAULT '{}'`, `target_band numeric(2,1)`, `content jsonb NOT NULL DEFAULT '{"sections":[]}'`, `schema_version integer NOT NULL DEFAULT 1`, `deleted_at timestamptz` (nullable — soft-delete), `created_at`, `updated_at`. `UNIQUE (center_id, code)`.
  - [x] `exercise_code_counters`: `center_id uuid NOT NULL REFERENCES centers ON DELETE CASCADE`, `skill text NOT NULL`, `next_seq integer NOT NULL DEFAULT 0`, `PRIMARY KEY (center_id, skill)` — the monotonic per-(center,skill) code source (Winston's #1: derive-from-rows collides by construction under hard/soft delete + retry storms; a counter is gap-tolerant and never reuses a retired code).
  - [x] Both tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` + the exact 4-policy grid copied from `migrations/20260722120000_create_enrollments.up.sql:48-63` (UPDATE gets both `USING` + `WITH CHECK`). **Verify the owned-row WITH-CHECK pattern against `classes` too** (Winston — classes is the apter owned-entity exemplar than the enrollments linkage table).
  - [x] Indexes: composite `idx_exercises_center_created_by ON exercises (center_id, created_by)`; `idx_exercises_tags ON exercises USING gin (tags)`. `.down.sql` reverses (DROP POLICY → DROP INDEX → DROP TABLE, both tables).
- [x] **T2 — v1 content contract + version dispatch (AC6)** *(net-new — no `schema_version` prior art)*
  - [x] `internal/store/exercise_content.go` (architecture line 699): the typed `ExerciseContent`/`ExerciseSection`/`QuestionGroup`/`Question`/**`ExerciseSettings`** structs (camelCase json tags). v1 is the COMPLETE shape (co-developed with 4.2): `QuestionGroup` carries `Type`+`Instructions`; top-level `Settings ExerciseSettings{TimeLimitEnabled bool; TimeLimitMinutes int; CaseSensitive bool}` (GO-5 no `omitempty`). **`SchemaVersion int \`json:"-"\`** — hydrated from the column, never serialized (no dual source). Shell builder emits `{"sections":[], "settings":{...FR-22 defaults...}}` (all defaults = Go zero, so the false-zero-value trap is designed out). 4.2 adds the per-type **semantic** validation (`ValidateExerciseContent`); 4.1 declares the struct + section/question-type constants (full words, CQ-4) + a `MaxContentBytes` guard on the create/update decode.
  - [x] `UnmarshalExerciseContent(raw []byte, version int) (ExerciseContent, error)` — switch on `version` (from column); v1 → direct unmarshal; NULL/0/unknown version or bad JSON → typed error (never panic). Shell builder emits `{"sections":[]}`; marshal to `[]byte` for the insert param (sqlc maps `jsonb → []byte`); borrow the never-null-object mechanics from `audit.go:149-181`. `SectionCount()`/`QuestionCount()` on the struct (used by the detail path only — list counts are SQL, T3).
- [x] **T3 — sqlc queries (AC1–AC5, AC8)**
  - [x] `internal/store/queries/exercises.sql` (mirror `session_content.sql`/`enrollments.sql`; RLS handles `center_id`; pass `center_id`/`created_by`/`code`/`content`/`schema_version` on INSERT). All reads filter `deleted_at IS NULL`.
  - [x] `CreateExercise :one`; `GetExerciseByID :one` (RLS-invisible/soft-deleted → `pgx.ErrNoRows` → 404); `NextExerciseCode :one` (`INSERT INTO exercise_code_counters … ON CONFLICT (center_id, skill) DO UPDATE SET next_seq = exercise_code_counters.next_seq + 1 RETURNING next_seq` — atomic, row-locked per pair).
  - [x] **List + count as a reviewed PAIR** (Winston/Murat — shared WHERE, same tx, or they drift): `ListExercises` (owner/admin) + `ListExercisesByTeacher` (`created_by = $`), each with optional `skill`/`tag`/`target_band` filters (`sqlc.narg` + `($n IS NULL OR skill = $n)` etc.), `ORDER BY updated_at DESC`, `LIMIT $ OFFSET $`, **selecting the SQL-computed `sectionCount`/`questionCount`** (`jsonb_array_length(content->'sections')` + lateral `SUM` over question groups) — **not** the raw `content` blob. Companion `CountExercises`/`CountExercisesByTeacher` with the **identical filter predicates** for the pagination `total`.
  - [x] `UpdateExercise :one` (`SET title, description, skill, tags, target_band, content, updated_at = now()` — **never `schema_version`/`code`**; `WHERE id AND deleted_at IS NULL`). `SoftDeleteExercise :one` (`SET deleted_at = now() … RETURNING id`). Duplicate = service read-then-create.
- [x] **T4 — Service layer (AC3–AC8)**
  - [x] `internal/service/exercise_service.go` — struct + constructor (`AuthDB` + `AuditLogger` + `clock`); reuse tenant-tx ceremony (`session_content.go:110-144`).
  - [x] Authz (SEC-1, service-layer): `assertClassRole(tc)` (owner/admin/teacher else 403 `INSUFFICIENT_ROLE`); list picks `ListExercises` vs `ListExercisesByTeacher` by role; Get/Update/SoftDelete/Duplicate run `assertTeacherScope` (cross-teacher → **404**).
  - [x] **Code gen:** letter map `reading→R listening→L writing→W speaking→S grammar→G vocabulary→V general→X`; `code = "EX-" + letter + zero-pad(NextExerciseCode(center,skill))`. `UNIQUE(center_id, code)` is belt-and-suspenders — cap retries ~5, clean error on exhaustion.
  - [x] Create sets shell + `schema_version=1` **server-side (ignore any body-supplied version/code)**. Update full-replaces `content`, never touches `schema_version`/`code`. Duplicate = read (typed) → **deep-copy** content → create clone with fresh code + `created_by`.
  - [x] Audit each mutation via `AuditService.LogWithinTx` (entityType `"exercise"`) in-tx. Typed errors: `model.NotFoundError{Resource:"exercise", Code:"EXERCISE_NOT_FOUND"}`, `service.ForbiddenError`, `model.ValidationError` (for `page`/`pageSize`/field validation).
- [x] **T5 — api.yaml + handler + routes (AC1–AC8)**
  - [x] `api.yaml`: `Exercise` schema (GO-5 explicit nulls, camelCase, all required: `code`, `skill`, `tags`, `targetBand`, `schemaVersion`, computed `sectionCount`/`questionCount`, `content`), `CreateExerciseRequest` (**no `schemaVersion`/`code` fields** — server-set), `UpdateExerciseRequest`, envelopes. **`PaginationMeta` lives INSIDE the existing `meta` envelope** (`meta.pagination: {page, pageSize, total, totalPages}` — Winston: slot in, don't fork a parallel envelope; this becomes the house pattern). List op declares `in: query` params `page`, `pageSize`, `skill`, `tag`, `band`. Enumerate every error status ($ref `ErrorEnvelope`): 401/403/404/409/413/422/429.
  - [x] `internal/handler/exercise_handler.go` — typed methods returning `error`; `WriteEnvelope`; GO-5 DTO + `xToResponse`; strict `MaxBytesReader` decode; `parseSettingsPathID`. List handler **validates `page`≥1 + clamps `pageSize` to `[1, maxExercisePageSize]`** (named constants, CQ-3), returns `meta.pagination`.
  - [x] Register on a new `exerciseChain` (model class/enrollment chains `main.go:412-478`; extractTenant → requireVerified → requireCenter → ErrorMapper; role in service): `GET/POST /api/exercises`, `GET/PATCH/DELETE /api/exercises/{id}`, `POST /api/exercises/{id}/duplicate`. Run `scripts/codegen.sh` LAST.
  - [x] **PATCH optimistic-concurrency (co-developed for 4.2 autosave):** the update handler reads the `If-Match`/`updatedAt` precondition, `UpdateExercise` query gains `AND updated_at = $precondition`, 0-rows → **409 `CONFLICT`**; missing precondition on the editor path → **428 `PRECONDITION_REQUIRED`**. `api.yaml` `Exercise` schema exposes `updatedAt` (already present) and the PATCH op enumerates 409/428; the `content` sub-schema stays an opaque object at 4.1 (4.2 fleshes out `ExerciseSection`/`QuestionGroup`/`Question`/`ExerciseSettings`).
- [x] **T6 — Backend tests (AC4–AC8; TEST-BE-1..4)** *(Murat's bar)*
  - [x] **RLS 6-pattern grid** (clone `enrollments_rls_test.go` / `_TEMPLATE_rls_test.go`): CrossTenantRead(0), CrossTenantInsert(WITH CHECK), CrossTenantUpdate(silent-0, re-fetch-as-owner), CrossTenantDelete, NullTenant, UnsetTenant + `TenantCannotReparentOwnRow`. **Plus the grid-doesn't-cover cases:** `CrossTeacherTagFilterLeak` (tenant B row tags match tenant A filter → 0), `CrossTenant/CrossTeacherDuplicateById → 404`. (`SetupDB` = `SET LOCAL ROLE classlite_app` so RLS is enforced.)
  - [x] **Content unmarshal units:** v1 blob → correct counts; empty shell → 0/0; malformed → typed error; **NULL / 0 / unknown version → typed error (no panic)**.
  - [x] **Pagination boundary (Murat 20/25):** page beyond last → empty `data` + correct `total`/`totalPages` (not last page, not error); `page=0`/negative/non-integer → 422; `pageSize=0`/negative/garbage → 422; `pageSize`>max → clamped; **`total` reflects the FILTERED count** (filter to a known subset, assert `total`==subset AND `totalPages` off the filtered size; no-filter twin → all rows).
  - [x] **schema_version smuggle (adversarial, AC4):** create with body `schema_version:99` → persisted column is server-current; update with `{...content, schema_version:99}` → persisted column unchanged (assert at DB).
  - [x] **Tag filter semantics:** single-tag `= ANY(tags)`; unknown/empty tag → empty set (not all rows). **Duplicate deep-copy:** duplicate → mutate copy's nested content → original unchanged in DB; assert fresh `id`/`code`/`created_by`/`created_at`, `content` deep-equal.
  - [x] **Handler ATDD** via `NewExerciseTestServerBareMux` (copy `story_3_4_5_helpers.go:19-39`) + `SignAccessTokenForRole`: teacher create→list-own→update→duplicate→soft-delete; owner/admin see all (**owner of A does NOT see B, through the handler with an owner token**); cross-teacher → 404; **cross-tenant/cross-teacher delete → same 404 as not-found**; student → 403; forged-owner-JWT-for-DB-teacher still scoped (`enrollment_handler_atdd_test.go:160-171`); full `{data,meta}`+`{error}` envelope; **golden envelope test pinning the exact `meta.pagination` field names + casing** (Murat — the MSW-drift gate, since Pact is unused).
  - [x] **EX-code concurrency:** N goroutines create same-(center,skill) → N distinct codes, zero collisions (guards the counter + UNIQUE). `go test ./... && go vet ./... && gofmt -l`.

### Frontend (classlite-web)

- [x] **T7 — New feature module + route + role gate (AC1, AC8, AC9)**
  - [x] `src/features/exercises/` (NOT under `session-detail` — that owns the unrelated *session* exercises; naming boundary below). Barrel `index.ts`. Register `/exercises` in `src/routes.tsx` (lazy deep-import chunk under `AppLayout`, `RouteRoleGate allowedRoles={['owner','admin','teacher']} sectionNameKey="exercises"`; model `/classes` `routes.tsx:253-283`; own the query in the page — no router loader).
  - [x] **Add `'exercises'` to the `SectionNameKey` union** `PermissionDenied.tsx:45-51` + copy (both locales). Un-deads the existing sidebar link (`sidebarNavConfig.tsx:82`).
  - [x] `ExerciseLibraryPage.tsx` — copy `ClassesPage.tsx`: `PageHead` (count-only header) + skill count-tabs (with totals) + tag/band filter controls + hand-rolled `<table>` (shared `DataListTable` is deferred) + trilogy ternary + in-page create/edit `<Dialog>`. **No "Classes assigned" column; no class/assignment-status filter controls.**
- [x] **T8 — API hooks + optimistic mutations (AC2–AC5)**
  - [x] `api/exercisesKeys.ts` (TS-3, filters+page folded into `list(centerId,{page,pageSize,skill,tag,band})`). `api/useExercises.ts` (list; unwrap envelope via `apiFetch`; return the list-inside-object shape so `meta.pagination` survives — `apiFetch` drops the top-level envelope; **set `placeholderData: keepPreviousData`** so the table doesn't flicker to empty on page change — Winston). `useExercise.ts`; `useCreateExercise`/`useUpdateExercise`/`useDeleteExercise` (optimistic triple — copy `useDeleteTemplate.ts:21-68`); `useDuplicateExercise`.
  - [x] **Naming-collision guard:** `session-detail/api/sessionContentApi.ts` already exports `useCreateExercise`/`useUpdateExercise`/`useDeleteExercise`. Reach these via `@/features/exercises`; if shared test setup collides, name them `useCreateLibraryExercise` etc. Never import the session-detail hooks here. Wire types from regenerated `client.ts`; `sonner` toasts from the component layer (FW-2).
- [x] **T9 — Components (AC1, AC3, AC5, AC9)**
  - [x] `ExerciseFormDialog.tsx` (copy `ClassFormDialog.tsx`; RHF + `zodResolver(useExerciseSchema())` — hand-written locale-reactive Zod per `classSchema.ts`; `openapi-zod-client` disabled). Fields: title, skill (enum select), tags, optional description + target band. **On success: close + refresh library (no navigation to editor).**
  - [x] `ExerciseDeleteDialog.tsx` (shadcn `AlertDialog`; copy semantics from `TemplateDeleteDialog.tsx`). Row action menu: Edit / Duplicate / Delete.
  - [x] `lib/exerciseSchema.ts`, `lib/exerciseUnits.ts` (skill → count-unit label: questions/prompts/cue-cards), `lib/exerciseCode.ts` (skill → letter/tile-color per UX §5.6 R/L/W/S/G palette). Filter toolbar: skill count-tabs + tag + band controls (state lifted into the page, folded into the query key — model `SchedulePage`). **No class/assignment-status controls.**
- [x] **T10 — i18n + FE tests (AC9)**
  - [x] `exercises.*` keys in `en.json` + `vi.json` incl. **verbatim empty-state copy** (true-empty hero + filtered-empty "no matches"), the **parameterized ICU meta-line message** (`code · {sections} · {count} {unit}` with `unit` a param, `vi` → ICU `other`), table columns, filters, errors, `createCta`, `form.*`, `delete.*`, `actions.*`. Enumerate in `i18n-parity-coverage.test.ts`; `npm run i18n-parity`.
  - [x] Component tests (Vitest + MSW, never mock Query): three-state (skeleton/rows/error); create/edit/**soft-delete** optimistic rollback on error; **both empty states** (true-empty vs filtered-empty render distinct copy); role-negative — student cannot route + no admin-only affordance in DOM (TEST-FE-6); skill+tag+band filter narrowing + pagination (`keepPreviousData` no-flicker); skill-appropriate unit labels (Writing→"prompts", Speaking→"cue cards"); `assertI18nParity`; `axe`.
  - [x] `tsc -b && eslint && vitest && npm run build` (exercises chunk isolated — students never download it).

### Close-out

- [x] **T11 — Deferred-work + docs**
  - [x] **FU-4-1-A** → `deferred-work.md`: class filter + assignment-status filter + "Classes assigned" column + header "unassigned" roll-up + Assign/Unassign + user-facing Sort control + multi-tag AND → **Epic 5 (Assignments, Story 5.1)**; archive/**restore** UI → **Epic 10** (4.1 shipped the soft-delete data model); full version-dispatch/lazy-upgrade + SQL-count version fallback → **Story 4.5**. **FR-20 is 4.1-partial + Epic 5** — record so the trace doesn't read "done".
  - [x] No new env var/service → skip `docs/manual-setup.md` (WF-9). Dev Agent Record + File List → sibling `4-1-...-completion-notes.md` (bmad-story-conventions.md), NOT this file.

## Dev Notes

### Scope decisions (why this shape)

1. **Class/assignment-status → Epic 5; FR-20 is partial.** No *Assignment* table exists. 4.1 ships skill+tag+band (all backed by `exercises` columns); the "Classes assigned" column is **omitted, not faked** (a per-row "Unassigned" is a false claim to a teacher with live classes — party-mode unanimous). Header is count-only. FR-20 spans 4.1 + Epic 5 — pin it in traceability (FU-4-1-A).
2. **Soft-delete, not destroy.** Teacher-authored exercises are multi-hour assets; hard delete contradicts FR-20's "Archive" and is a data-loss trap (John, party-mode). 4.1 lands `deleted_at` + read-filtering; the restore UI is Epic 10. Cheap now, cleaner Epic-10 foundation.
3. **4.1 declares the v1 content contract.** The typed `ExerciseContent` (T2) IS v1 — 4.2 (editor) and 4.3 (AI gen) both write into it, so the shape is decided here, not negotiated downstream (John). 4.1 create persists the empty shell; the s16 editor is 4.2.
4. **Create/edit is an in-page dialog that returns to the library** — it does NOT navigate to the non-existent `/exercises/{id}/edit`; the redirect-into-editor is 4.2 (Winston: no dead-end). 4.1 is independently demoable.
5. **`schema_version` = column-canonical, `json:"-"` in the struct** (no dual source — Winston). Server-authoritative on create + update; the body cannot set it (Murat's smuggle test guards this).
6. **EX-code from a per-(center,skill) counter table**, not derive-from-rows (Winston #1 / Murat 14/25) — derive-from-rows collides by construction under delete + retry storms under concurrency (esp. future bulk import, 2.7). Counter is monotonic + gap-tolerant; UNIQUE is the guard.
7. **List counts in SQL, full dispatch on detail** (Winston #2) — compute-not-store is right, but unmarshaling every row's blob on the hottest endpoint is a latent cliff; `jsonb_array_length` + lateral aggregate keeps the blob in the DB.
8. **`skill` is a classification facet, not a content-type constraint** (Winston) — a "Reading" exercise may contain Listening sections; nothing couples `skill` to section types. Enum uses **full words** (`vocabulary`, not `vocab` — CQ-4).
9. **Band filter + default last-modified sort ship; user-facing Sort control deferred** (Sally: don't silently drop) — both decisions explicit, not omitted-by-silence. Multi-tag AND deferred (single-tag this story).

### Reuse map — build on, do not reinvent

**Backend** — templates: session-content (3.5) for handler→service→store; enrollments (3.4.5) for migration/RLS/api.yaml/tests; **classes** for the owned-row WITH-CHECK + role-split list.
- Migration/RLS grid: `migrations/20260722120000_create_enrollments.up.sql:19-63` (copy policy block; anchor = row's own `center_id`); verify owned-row WITH-CHECK against `classes` migration.
- sqlc + role-split + count: `session_content.sql`, `enrollments.sql`, `classes.sql:30,52` (`ListClasses`/`ListClassesByTeacher`), `sessions.sql:79-83` (`COUNT(*)`); config `sqlc.yaml` (pgx/v5, `emit_json_tags`, `emit_empty_slices`); `jsonb → []byte` (`generated/models.go`).
- Tenant-tx + gates: `session_content.go:110-144`, `class_lifecycle.go:85` (`assertClassRole`→403), `class_lifecycle.go:99-108`/`session.go:134-143` (`assertTeacherScope`→404); audit `audit.go` (`LogWithinTx`, `:149-181` marshal/coalesce).
- Errors + envelope + routes: `model/errors.go` (`.Code` for custom codes), `service/errors.go`, `middleware/error_mapper.go:308-350`, `handler/response.go:21-88`, `cmd/api/main.go:412-478`.
- Tests: `test/helpers.go` (`SetupDB`=RLS-enforcing tx, `SetupRawPool`, `TenantContext`, `UUIDString`), `fixtures.go` (`CreateUser`/`CreateCenter`/`CreateCenterMember` — **no `CreateStudent`**), `story_3_4_5_helpers.go:19-39` (`NewEnrollmentTestServerBareMux` → copy), `story_2_6_helpers.go:27` (`SignAccessTokenForRole`), `_TEMPLATE_rls_test.go` / `enrollments_rls_test.go` / `enrollment_handler_atdd_test.go` (incl. forged-JWT `:160-171`, `classReq` `:87-105`).

**Frontend** — template: the `classes` feature (list + CRUD + optimistic delete).
- Page/table/trilogy: `ClassesPage.tsx` (states `:202-249`, skeletons `:366-378`, error `:380-400`, empty hero `:402-423`, two-tier empty `:213-219`), `TemplatesIndexPage.tsx` (scope-gated actions).
- Keys/unwrap/optimistic: `templateKeys.ts:10-21` (+ `listDisabled()`), `useTemplates.ts:17-33` + `api-fetch.ts:270` (`parseEnvelope`), `useDeleteTemplate.ts:21-68` (multi-slot rollback), `useTransitionClassStatus.ts:37-73` (single-row patch), `useCreateClass.ts:14-27`/`useUpdateClass.ts:22-25`.
- Routing/forms/filters: `routes.tsx:253-283`, `RouteRoleGate.tsx:56-82`, `PermissionDenied.tsx:45-51` (add `'exercises'`), `classSchema.ts:1-13` (`useXSchema()`+`zodResolver`), `ClassFormDialog.tsx`, `TemplateDeleteDialog.tsx`→`AlertDialog`, `SchedulePage.tsx:56-64`+`useSessions.ts:24-33` (filter-in-key).
- i18n: flat dot-keys `src/locales/{en,vi}.json`; `scripts/i18n-parity.mjs` (`npm run i18n-parity`) + `i18n-parity-coverage.test.ts`; `assertI18nParity` (`i18n-parity.ts:59`); `sidebar.teacher.exercises` exists (`en.json:199`).

### Naming boundary — session exercises vs the exercise library

`session_exercises` (3.5) / `session-detail/ExercisesSection` are lightweight in-session ungraded entries (title/instructions/link, child of a session, no `content`/`schema_version`) — **NOT** this story's library entity and do not collide: new table `exercises`, routes `/api/exercises/*` (vs `/api/sessions/{id}/exercises`), feature `src/features/exercises/`, keys root `['exercises']`, i18n `exercises.*`. Never FK session_exercises to the library. Watch the FE hook-name overlap (T8).

### Testing standards summary

- Backend: RLS real-DB-in-tx (TEST-BE-1/2 — 6-pattern grid + reparent + the 3 party-mode additions; deterministic tenant IDs; never disable RLS); handler integration through real middleware + committed pool (TEST-BE-3, full envelope + golden `meta.pagination` shape + SEC-1 forged-JWT); content-unmarshal + pagination-boundary + schema_version-smuggle + duplicate-deep-copy + EX-code-concurrency units. New tenant table → RLS grid mandatory (policy-clone green-on-arrival, but the created_by-scope, in-RLS tag-filter, and read-then-clone paths are net-new and get red-first thinking — Murat).
- Frontend: MSW at HTTP boundary, never mock Query (TEST-FE-1); three-state + both-empty-states (TEST-FE-2); role-negative (TEST-FE-6); i18n both locales incl. skill-unit labels (TEST-FE-4); axe (TEST-FE-5).

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-04.md#Story-4.1] — 6 epic ACs + content schema (7–49); 4.2 boundary (53–78).
- [Source: prds/prd-classlite_new-2026-05-26/prd.md#FR-20] — library columns/filters; **row actions Edit/Duplicate/Archive** (Duplicate is requirement-backed); teacher-scope visibility (line 308).
- [Source: architecture.md] — JSONB + companion `schema_version` column (206, 967); file structure `exercise_content.go`/`exercise_handler`/`exercise_service`/`exercises.sql` (620–787); s15 chunk isolation (253).
- [Source: ux-design-specification.md + component-inventory.md] — s15 columns fold code/sections/count into the title meta-line; **skill-appropriate units (questions/prompts/cue cards)**; skill count-tabs with totals; `EX-<L><NNN>` code; `SHOWING n OF total`; `DataListTable` deferred (hand-roll); `AlertDialog` for delete.
- [Source: 3-5-session-detail-and-attendance-recording.md] — structural model; `session_exercises` not-the-library boundary; RLS-clone posture; full-replace PATCH precedent (CR-3-5-4).
- [Source: 3-4-5-enrollment-linkage-foundation.md + deferred-work.md] — enrollments migration/RLS/ATDD templates; deferral convention.
- [Source: docs/project-context.md] — GO-1/2/5/7, GFW-1/5, XL-1/2, SEC-1, TS-3/4, FW-1/2, UX-1/2/3, TEST-BE-1..4, TEST-FE-1..6, CQ-3/4, WF-1..6/9.

## Definition of Done

- [x] In-scope ACs met (AC1–AC9); deferrals (class/assignment-status column+filters, editor, archive-restore UI, user Sort control, multi-tag) documented not silently dropped; FR-20 recorded as 4.1-partial + Epic 5.
- [x] `exercises` + `exercise_code_counters` live with 4-policy FORCE RLS + composite `(center_id, created_by)` + GIN `tags`; 6-pattern grid + reparent + tag-filter-leak + cross-tenant/teacher-duplicate-404 green.
- [x] Typed v1 `ExerciseContent` + `UnmarshalExerciseContent(raw, version)` (version `json:"-"`, column-canonical); NULL/0/unknown → typed error; list counts computed in SQL, detail uses full dispatch; `schema_version`/`code` immutable via update (smuggle test green).
- [x] CRUD (soft-delete) + Duplicate (deep-copy) on `exerciseChain`; teacher-scope (404) + role (403) service-side, role re-validated from `center_members`; `meta.pagination` inside the envelope; `page`/`pageSize` validated+clamped; filtered `total`; skill/tag/band filters.
- [x] `/exercises` renders table + trilogy + both empty states + skill-appropriate units; create/edit dialog returns to library; students blocked; `'exercises'` in `SectionNameKey`; `keepPreviousData` no-flicker.
- [x] `en.json` + `vi.json` parity green (`exercises.*`, ICU meta-line, verbatim empty copy); axe clean.
- [x] `go test ./... && go vet && gofmt -l` clean; `tsc -b && eslint && vitest && npm run build` clean; exercises chunk isolated; `codegen.sh` last.
- [x] FU-4-1-A added to `deferred-work.md`. Dev Agent Record + File List in sibling completion-notes.

## Out of Scope

- **"Classes assigned" column + class filter + assignment-status filter + header "unassigned" roll-up + Assign/Unassign + user-facing Sort control + multi-tag AND** → **Epic 5 (Assignments, Story 5.1)** (FU-4-1-A).
- **Two-panel structured editor (s16)** — section/question authoring, section/question-type enums, settings (time limit, answer-matching), drag-drop, autosave, locked/clone/unfinalize → **Story 4.2**.
- **AI content generation** + `jobs` table + worker → **Story 4.3**.
- **JSONB lazy-upgrade / batch-migration + SQL-count version fallback** → **Story 4.5** (4.1 = v1 only).
- **Archive / restore UI** → **Epic 10** (4.1 ships the soft-delete data model only).
- **Anchored Q&A on exercises** → Epic 7 (FR-58). **Knowledge-Hub "From Hub" picker** → Story 4.4.

## Change Log

| Date | Change |
|---|---|
| 2026-07-27 | **Green-phase complete (`/bmad-dev-story 4-1`, Amelia). `ready-for-dev → in-progress → review`.** Backend-first per WF-1/WF-3: migration `20260727120000_create_exercises` (exercises + exercise_code_counters, 4-policy FORCE RLS, composite+GIN indexes) → `exercises.sql` (code-counter upsert, soft-delete, optimistic-concurrency update, SQL list counts, per-skill counts) → `api.yaml` additive (Exercise/ExerciseListItem/Create/Update + `meta.pagination` inside envelope; 401/403/404/409/413/422/428/429) → `codegen.sh` → v1 `ExerciseContent` contract (`store/exercise_content.go`, version-dispatch, `schema_version` column-canonical `json:"-"`) → `ExerciseService` (CRUD soft-delete + Duplicate deep-copy + EX-code + teacher-scope 404 / role 403) → `exercise_handler.go` + `exerciseChain` (6 routes) + `PreconditionRequiredError` (428). Backend tests: content units, RLS 6-pattern grid + reparent + tag-filter-leak + counter, handler ATDD (role scope, pagination boundary, smuggle-reject, duplicate deep-copy, soft-delete, optimistic 428/409/200, golden meta.pagination, concurrent codes). Frontend: `apiFetchWithMeta` (envelope-preserving) + `src/features/exercises/` module (page + 7 hooks + 3 lib + 2 dialogs) + `/exercises` RouteRoleGate + `SectionNameKey += 'exercises'` + `exercises.*` i18n (en/vi, ICU meta-line, verbatim two-state empty) + `--cl-skill-*` tokens; tests: trilogy, both empty states, skill-unit labels, filter/pagination, create-closes-dialog, delete optimistic rollback, i18n parity, axe. `go test/vet/gofmt` clean; `tsc -b`/eslint/vitest (1966 pass)/`i18n-parity`/build clean; ExerciseLibraryPage isolated chunk (17.89 kB). FU-4-1-A → deferred-work.md (FR-20 = 4.1-partial + Epic 5). Dev Agent Record + File List → sibling `-completion-notes.md`. |
| 2026-07-27 | Story created (ready-for-dev). Scope split: skill+tag+band filtering + CRUD ship; class/assignment-status column+filters → Epic 5; editor → 4.2; archive → Epic 10; JSONB lazy-upgrade → 4.5. 3 net-new backend contracts flagged (schema_version dispatch, pagination, list filters). |
| 2026-07-27 | **Co-development amendment (Story 4.2 party-mode, ratified Ducdo).** v1 `ExerciseContent` un-frozen and **completed now**: 4.1 declares the full shape incl. top-level **`Settings{TimeLimitEnabled,TimeLimitMinutes,CaseSensitive}`** + `QuestionGroup.Type`/`Instructions` → **one physical shape under `schema_version=1`** (Winston: kills the two-shapes-one-version landmine for 4.5). Create **materializes FR-22-default settings** (default-on-write; all defaults = Go zero ⇒ false-zero-value trap designed out; hyphen/whitespace normalization is fixed Epic-5 grading behavior, not per-row config). Added **`updated_at` optimistic-concurrency precondition** on PATCH (409 CONFLICT / 428 PRECONDITION_REQUIRED) for 4.2 autosave; `MaxContentBytes` decode guard. 4.2 owns the per-type semantic `ValidateExerciseContent`. |
| 2026-07-27 | **Code review — Chunk 2 (frontend) COMPLETE → `review → done`, `/bmad-code-review 4-1` (Amelia, 3 adversarial layers).** 1 decision (vi `countLabel_one` kept — parity tooling; AC9 amended), 11 patch, 2 defer, 5 dismissed. **All 11 patches APPLIED + green:** fresh-`updatedAt` edit precondition via `useExercise` + 409 conflict copy; form label association + dialog axe; page clamp (stranded-page fix); `apiFetchWithMeta` JSON.parse guard; TS-6 date formatting; TEST-FE-6 role-negative test; Duplicate in-flight guard; band-filter-active fix; optimistic-delete total/skillCounts decrement; description trim; skill-tab `aria-pressed`. `tsc`/eslint/`i18n-parity`(1171)/`vitest`(128 files, 1977 tests)/`build` all clean. Both chunks reviewed → **story DONE.** Defers → deferred-work.md (CR-4-1-11/12/24/25). |
| 2026-07-27 | **Code review — Chunk 1 (backend), `/bmad-code-review 4-1` (Amelia, 3 adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor).** 2 decision-needed → resolved, 8 patch, 2 defer, 2 dismissed. **All 10 patches APPLIED + green** (`go build/vet/gofmt` clean; full backend `go test ./...` = 11 pkgs ok / 0 fail; sqlc regen for the SQL fixes). All in-scope backend ACs satisfied. Deferred: settings-reset-on-omit → 4.2, `requireOwnerTenant` rename → P3 tech-debt (both in deferred-work.md). Story stays `review` — **frontend chunk 2 pending**. See Review Findings section below. |
| 2026-07-27 | Party-mode review amendments (Winston/Murat/Sally/John). **Delete → soft-delete** (`deleted_at`; archive-restore UI stays Epic 10) — **ratified by Ducdo 2026-07-27**. **EX-code → per-(center,skill) counter table** (was derive-from-rows — collision/retry-storm risk). **List counts computed in SQL**, full typed dispatch only on detail (was unmarshal-every-row). **PaginationMeta inside the existing `meta` envelope** + server `page`/`pageSize` validate+clamp + filtered-count + `keepPreviousData`. **`schema_version` column-canonical `json:"-"`** (no dual source) + server-set + smuggle-test. **"Classes assigned" column OMITTED** (was per-row "Unassigned" — false claim); header count-only. **AC1 skill-appropriate units** (questions/prompts/cue-cards, was flat "questions"); skill count-tabs with totals; **band filter live + Sort control explicitly deferred** (no silent drops). **4.1 declares the v1 content contract** (load-bearing for 4.2/4.3). **Create dialog returns to library** (no dead-end nav to unbuilt editor). **FR-20 = 4.1-partial + Epic 5** in traceability. Enum `vocab`→`vocabulary` (CQ-4). Added RLS tests: tag-filter-leak + cross-tenant/teacher-duplicate-404; verbatim two-state empty copy; ICU meta-line message. |

## Review Findings — Chunk 1: Backend (2026-07-27)

_`/bmad-code-review 4-1` — Blind Hunter · Edge Case Hunter · Acceptance Auditor. Verified against source, not diff-only. All 8 in-scope backend ACs satisfied at code level; zero GO-*/GFW-*/SEC-*/PERF-*/XL-* hard-constraint violations. Findings below are hardening + test-integrity. Frontend (chunk 2) still pending._

**Resolution (2026-07-27): all 10 patches APPLIED + green.** 2 decisions ruled by Ducdo (null clears the field; targetBand validated to 0.5 steps). Code patches: tag filter `= ANY` → `@> ARRAY[]` (GIN-usable) + sqlc regen; `page` upper-bounded (int32 OFFSET overflow → 422); `band` filter range/finite-guarded (→ 422); `ORDER BY updated_at DESC, e.id DESC` (stable pagination) + regen; Duplicate title clamped to 200 runes; tri-state PATCH decode so `null` clears description/targetBand; 0.5-step band validation. Test patches: Duplicate deep-copy now proves content deep-equal + mutation-independence + fresh created_by; new content-replace-200 + oversized-413 tests; If-Match asserts effect + persisted + stale-header-409; + null-clear + band-step regression tests. `go build/vet/gofmt` clean; full backend `go test ./...` = 11 pkgs ok, 0 fail. 2 findings deferred (settings-reset → 4.2, `requireOwnerTenant` rename), 2 dismissed._

### Decision-needed (resolved 2026-07-27 → promoted to patch)

- [x] [Review][Decision→Patch] `description` / `targetBand` null-clear — **Ducdo ruled: `null` clears the field.** Adopt tri-state decode (absent=unchanged, null=clear, value=set) + test [service/exercise_service.go:1919-1934]. See patch below.
- [x] [Review][Decision→Patch] `target_band` precision — **Ducdo ruled: validate to 0.5 steps** (IELTS bands); reject non-0.5 multiples 422 [service validateExerciseMetadata]. See patch below.

### Patch

- [x] [Review][Patch] `description`/`targetBand` cannot be cleared to NULL — adopt tri-state decode so JSON `null` writes SQL NULL (`Valid:false`), absent = unchanged; add test [service/exercise_service.go:1919-1934 + handler decode]
- [x] [Review][Patch] `target_band` accepts any [0,9] float but column is `numeric(2,1)` → silent round + filter miss — validate to 0.5-step multiples (422 otherwise) + test [service/exercise_service.go:validateExerciseMetadata]

- [x] [Review][Patch] GIN index cannot serve the tag filter as written — `tag = ANY(e.tags)` is not GIN-indexable; the `idx_exercises_tags` GIN index is dead and every list/count/count-per-skill seq-scans. Rewrite predicate as `e.tags @> ARRAY[tag]` (needs sqlc codegen) [queries/exercises.sql:61,82,94,103]
- [x] [Review][Patch] Unbounded `page` overflows int32 OFFSET → negative OFFSET → Postgres 22023 → HTTP 500 (client-triggerable). Add an upper bound (or clamp) on page / compute offset in int64 with guard [handler/exercise_handler.go:parseExerciseListQuery + service/exercise_service.go:1769]
- [x] [Review][Patch] List `band` filter unvalidated → `band=-3`/`NaN`/`Inf` → `floatToNumeric` error → HTTP 500 instead of 422. Add range check [0,9] (reject 422) or ignore out-of-range [handler/exercise_handler.go:parseExerciseListQuery band branch]
- [x] [Review][Patch] `ORDER BY updated_at DESC` has no unique tiebreaker → OFFSET pagination can drop/duplicate rows when timestamps tie. Add `, e.id DESC` (needs sqlc codegen) [queries/exercises.sql:63,84]
- [x] [Review][Patch] `Duplicate` bypasses metadata validation — `src.Title + " (copy)"` can exceed the api.yaml `maxLength: 200` (207 chars from a valid 200-char source) and grows unbounded on repeat; a later PATCH of the clone would 422 on a title the server itself created. Clamp the duplicated title to 200 [service/exercise_service.go:2071]
- [x] [Review][Patch] `TestExercise_Duplicate_DeepCopyFreshCode` does not verify the deep copy — asserts only title/code/id differ; never populates source content, mutates the clone, or re-reads the source. The AC/T6 headline guarantee (mutation-independence) is untested and the completion notes overclaim it. Strengthen: populate content → mutate clone → assert source unchanged + content deep-equal + fresh created_by/created_at [handler/exercise_handler_atdd_test.go:2954-2973]
- [x] [Review][Patch] No PATCH content-replacement test and no >256 KiB → 413 test — the content-bearing PATCH path (4.2 autosave / MaxContentBytes guard) exists but is exercised by zero tests; all optimistic-concurrency tests send metadata-only bodies. Add a content PATCH test + a 413 overflow test [handler/exercise_handler_atdd_test.go]
- [x] [Review][Patch] `TestExercise_Update_IfMatchHeader_200` asserts status only, not effect — never checks the title actually changed or that the `If-Match` header (not a body field) drove the precondition; a dropped-header regression would still pass. Add the effect assertion [handler/exercise_handler_atdd_test.go:3074-3090]

### Deferred

- [x] [Review][Defer] Content full-replace silently resets `settings` when the client omits them — an autosave sending `{sections:[...]}` without echoing `settings` wipes time-limit/case-sensitivity back to defaults. This is the documented full-replace autosave contract co-developed for 4.2; the 4.2 editor MUST always echo the full content object incl. settings. Deferred to Story 4.2 (owns the editor + `ValidateExerciseContent`). [handler/exercise_handler.go:content branch + store/exercise_content.go]
- [x] [Review][Defer] `requireOwnerTenant` is misnamed on teacher-reachable exercise routes (CQ-4) — verified a pure tenant extractor (no owner gate; `exerciseChain` has no RequireRole, role enforced in-service). Functionally correct, but the name invites a wrong reading of the security model. Pre-existing shared helper (term_handler.go) reused across settings/terms/exercises — rename is cross-cutting. Deferred: local clarifying comment now, broad rename later. [handler/term_handler.go:229]

### Dismissed (2)

- `skillCounts` omits zero-count skills — FE consumer already zero-fills defensively (`skillCountMap.get(skill) ?? 0`, ExerciseLibraryPage.tsx:183) and total sums correctly; non-issue.
- schema_version smuggle asserted at HTTP (422 via `DisallowUnknownFields`) rather than DB-level as T6 wrote — the rejection is strictly stronger than the spec's "ignored" and is disclosed in the completion notes; accept-as-hardening.

## Review Findings — Chunk 2: Frontend (2026-07-27)

_`/bmad-code-review 4-1` — Blind Hunter · Edge Case Hunter · Acceptance Auditor. Verified against source. Frontend is scope-compliant (no "Classes assigned" column, no class/assignment chips, dialog returns to library — no dead-end editor nav) and the trilogy + FW-2 delete triple + TS-1/TS-3 are satisfied. Findings are UX/a11y/contract hardening + test-integrity. AC1/AC2 satisfied; AC9 partial (below)._

**Resolution (2026-07-27): 1 decision ruled + all 11 patches APPLIED + green.** Decision: vi `countLabel_one` kept (parity tooling requires identical keysets) + AC9 amended. Patches: edit dialog now fetches a fresh `updatedAt` via `useExercise` (+ conflict-specific 409 copy `exercises.form.conflict` en/vi, refetch-on-conflict); form fields label↔input associated + open-dialog axe test; page clamped to `totalPages` (adjust-during-render, no effect); `apiFetchWithMeta` guarded `JSON.parse` → typed `INVALID_RESPONSE` + Sentry; "Last modified" now locale-formatted (`formatExerciseDate`, TS-6); TEST-FE-6 role-negative test (student denied, content absent from DOM); Duplicate guarded on `isPending`; `anyFilterActive` uses the finite band check; optimistic delete decrements `total` + skill count; description trimmed on submit; skill tabs use `aria-pressed` + `role="group"` (not `aria-current="page"`); TS-4 comment corrected. `tsc -b` clean; eslint clean; `i18n-parity` OK (1171 keys); full `vitest run` = 128 files / 1977 tests pass; `npm run build` OK (ExerciseLibraryPage isolated 19 kB chunk). 2 findings deferred (no-center skeleton; T10 parity-enumeration), 5 dismissed._

### Decision-needed (resolved 2026-07-27)

- [x] [Review][Decision] vi.json `countLabel_one` vs AC9 "no `_one` split" — **Ducdo ruled: PRAGMATIC (keep-as-is + amend AC9).** The CI `scripts/i18n-parity.mjs` enforces identical en/vi key-sets, so the vi dead-plural is the sanctioned consequence of the tooling, not a defect. **No code change**; AC9 amended below to record the parity-tooling constraint. The en `meta.line` "1 sections" blemish (CR-4-1-23) is accepted under the same pragmatic call (a mono technical meta line; pluralizing it would reintroduce the same keyset-parity friction). Follows the ratified pragmatic-interpretation pattern. [`vi.json:1106`, `scripts/i18n-parity.mjs`]

### Patch

- [x] [Review][Patch] Edit dialog sends a possibly-stale list-row `updatedAt` as the concurrency precondition — `useExercise` (the fresh-read hook that exists FOR this, docstring says so) is never called; the list is `staleTime:30s`+`keepPreviousData`, so a benign edit can spurious-409, and the 409/428 path shows only raw server text (no i18n, no reload guidance). Wire `useExercise` for a fresh precondition + add conflict-specific handling. [components/ExerciseFormDialog.tsx:79, api/useExercise.ts]
- [x] [Review][Patch] Form fields (Title/Tags/Description/TargetBand) render `<Label>` with no `htmlFor`/`id` association (only Skill is correct); the axe test never opens the dialog so it passes blind. Associate label↔input in the `Field` helper + add an axe scan of the open dialog. [components/ExerciseFormDialog.tsx:191-211, __tests__/ExerciseLibraryPage.test.tsx]
- [x] [Review][Patch] Deleting the last row on page > 1 strands the user on a blank page — `page` is never clamped to server `totalPages` (only reset on filter change); when `totalPages` drops to 1 the Prev/Next controls vanish. Reconcile `page` down to `totalPages` when data shrinks. [ExerciseLibraryPage.tsx:94,283]
- [x] [Review][Patch] `apiFetchWithMeta` does an unguarded `JSON.parse` — a non-JSON/empty 2xx body throws a raw `SyntaxError` instead of the typed `ApiError` + Sentry capture the sibling `parseEnvelope` produces. Mirror `parseEnvelope`'s try/catch → `INVALID_RESPONSE`; fix the invented TS-4 comment. [lib/api-fetch.ts:243-244]
- [x] [Review][Patch] "Last modified" renders `row.updatedAt.slice(0, 10)` — raw ISO, no locale formatting (TS-6 violation; locale-invariant for vi co-primary) + magic `10`. Route through a feature-local date formatter (mirror `formatClassDate`; TS-7 forbids importing the classes one). [ExerciseLibraryPage.tsx:423]
- [x] [Review][Patch] TEST-FE-6 role-negative coverage missing though T10 is checked `[x]` — every test renders `ExerciseLibraryPage` directly, bypassing `RouteRoleGate`; no test proves a student/unauthorized is denied. Add a role-gate test asserting the content is absent for a disallowed role. [__tests__/ExerciseLibraryPage.test.tsx, routes.tsx]
- [x] [Review][Patch] Duplicate action has no in-flight guard → double-activation creates two clones (delete/submit are guarded; duplicate is not). Guard `handleDuplicate` on `duplicate.isPending`. [ExerciseLibraryPage.tsx:145]
- [x] [Review][Patch] `anyFilterActive` uses `band.trim() !== ''` while the query only sends band when finite — a stray `.`/`-`/`e` shows "Clear filters" + the filtered-empty state though the query ran unfiltered. Use the same finite check. [ExerciseLibraryPage.tsx:133 vs 108]
- [x] [Review][Patch] Optimistic delete filters `items` but leaves `pagination.total` + `skillCounts` stale → footer "Showing 4 of 5" desync + an empty-table flash when the deleted row was the only one on the page. Decrement total + the row's skill count in `onMutate`. [api/useDeleteExercise.ts:48-51]
- [x] [Review][Patch] Description is persisted untrimmed (`values.description?.trim() ? values.description : null` tests trimmed but stores the raw value) — inconsistent with the Zod-trimmed title. Trim on submit. [components/ExerciseFormDialog.tsx:77,88]
- [x] [Review][Patch] Skill filter tabs use navigation semantics (`<nav>` + `aria-current="page"`) for an in-place filter control — SR announces "current page" for a filter toggle. Use toggle-button semantics (`aria-pressed`) / a group role. [ExerciseLibraryPage.tsx:168,352]

### Deferred

- [x] [Review][Defer] `/exercises` shows an infinite skeleton if the session resolves with no center (`useExercises` `enabled: Boolean(centerId)` → `isPending` never terminates → loading branch forever). Theoretical in practice — `RouteRoleGate` + the API `requireCenter` middleware guarantee a center on this route, and a null center here means the session is still hydrating (skeleton is the correct state). Deferred; revisit if a genuine no-center account state appears. [api/useExercises.ts:59, ExerciseLibraryPage.tsx:87,227]
- [x] [Review][Defer] T10's `i18n-parity-coverage.test.ts` enumeration of `exercises.*` was done as a ~17-key subset inside the component test instead — full-file en/vi parity is still enforced by the CI script, so no real parity hole; the per-key registration is a spec-literal gap. Deferred as low-value bookkeeping. [__tests__/ExerciseLibraryPage.test.tsx:371]

### Dismissed (5)

- `skillCounts` ignore the band filter — FALSE for production: the backend `CountPerSkill`/`CountPerSkillByTeacher` ARE passed `TargetBand` (service exercise_service.go:533,544). Only the MSW test mock ignores band; a test-fidelity nit, not a defect.
- Create/update/duplicate are invalidate-only (not optimistic) — appropriate; the spec only requires the optimistic path for delete, and the "optimistic" framing was loose. No rollback bug (nothing optimistic to roll back).
- Header count uses the filtered `total` — coherent: the header tracks the current view's count and the "All" tab shows the cross-skill total; they are labeled distinctly, not two conflicting "totals".
- Prev/Next `disabled` (local `page`) vs indicator (`pagination.page`) transient mismatch under `keepPreviousData` — sub-frame, self-corrects on settle.
- Optimistic-delete rollback misses list slots fetched mid-flight (after a filter/page change during the DELETE) — extreme edge; `onSettled` invalidation self-corrects.
