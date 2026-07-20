# Story 3-1-class-crud-lifecycle-and-creation-ui: Completion Notes

_Implementation record for [`3-1-class-crud-lifecycle-and-creation-ui.md`](./3-1-class-crud-lifecycle-and-creation-ui.md). Status: review._

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Amelia / bmad-dev-story)

### Debug Log

- **Task 1 — migration.** Local docker-compose Postgres was stopped at pickup; brought it up (`docker compose up -d`) — required config, not a code change. DB user is `classlite` (not `postgres`); `.env` `DATABASE_URL` is the auth source for psql inspection. Migration `20260719120000_add_class_crud_columns` applies clean; up→down→up verified idempotent (6 columns + `classes_capacity_positive` CHECK drop/re-add), RLS policies + 3 indexes from 2.2 unaffected.

### Completion Notes List

- All 9 tasks complete; story `in-progress → review`. All 9 ACs green.
- Backend (Tasks 1–5): migration up→down→up verified; sqlc split codegen; api.yaml + regen; ClassService (lifecycle CAS + CRUD + audit); ClassHandler + classChain. Full backend suite green (service/handler/store ATDD, Spawn regression).
- Frontend (Tasks 6–8): `src/features/classes/` (hooks/schema/page/pill/dialog), `/classes` lazy route + bundle boundary, 66 i18n keys en+vi. vitest 1582 passed (1 pre-existing unrelated FU-2-5b-A flake), tsc/eslint/i18n-parity/build all clean.
- Test deviations + follow-ups (FU-3-1/-A/-B) documented in the story Change Log + Task 9 note.
- Task 1 (AC1/AC3/AC6): schema migration landed + verified.

### Implementation Plan (summary)

Executing story task order 1→9: migration → sqlc (split codegen) → api.yaml → service (+ lifecycle map) → handler + wiring → frontend feature → routing/nav → i18n → tests + regression.

## File List

### Added

- `classlite-api/migrations/20260719120000_add_class_crud_columns.up.sql` — Story 3.1 class CRUD columns (description, capacity, due_dates_enabled, updated_at, end_date, color) + capacity>0 CHECK.
- `classlite-api/migrations/20260719120000_add_class_crud_columns.down.sql` — reverses the up (drop CHECK + 6 columns in reverse order).
- `classlite-api/internal/service/class_lifecycle.go` — `classTransitions` map (AC4 exact arrow set) + `TransitionStatus` (compare-and-swap via `UpdateClassStatus`, re-fetch-on-lost-race, audit-in-tx) + `assertTeacherScope` (AC6 teacher-sees-nothing → 404).
- `classlite-api/internal/service/class_crud.go` — `Create`/`List`/`ListForTeacher`/`Get`/`Update` + validation (name rune-count, capacity>0, primarySkill enum, email, teacher-assignment mutex) + opt* pgtype converters + `classAuditSnapshot`.
- `classlite-api/internal/handler/class_handler.go` — `ClassHandler` (List role-branch, Create/Get/Update/TransitionStatus), strict decode (DisallowUnknownFields), `classResponse` wire DTO (explicit nulls), garbage-status→INVALID_STATUS 422.
- `classlite-api/internal/test/story_3_1_helpers.go` — `NewClassTestServerBareMux` (classChain, no auth injection) + `SeedClass` fixture.
- `classlite-api/internal/handler/class_handler_atdd_test.go` — handler integration suite (AC1/AC4/AC5/AC6 + 401).
- `classlite-web/src/features/classes/api/{classesKeys,useClasses,useCreateClass,useUpdateClass,useTransitionClassStatus}.ts` — query-key factory (scoped list keys) + list query + mutations (FW-2 optimistic triple across all list scopes).
- `classlite-web/src/features/classes/lib/{classSchema,classTransitions}.ts` — RHF Zod builder (copied validators) + client transition mirror.
- `classlite-web/src/features/classes/ClassesPage.tsx` — s07 index (tabs + list-table + trilogy + role scope).
- `classlite-web/src/features/classes/components/{ClassStatusPill,ClassFormDialog}.tsx` — transition pill + create/edit dialog (template picker + per-field toggles + due-dates switch).
- `classlite-web/src/features/classes/index.ts` — barrel.

### Follow-ups filed

- **FU-3-1** — extract shared class-field validators (classSchema duplicates onboarding classSpawnSchema).
- **FU-3-1-A** — template-detail endpoint (`GET /api/templates/{id}` with sessions) → full per-session titled read-only preview in ClassFormDialog (currently a `sessionCount` summary).
- **FU-3-1-B** — full `AssignChip`/`AssignTeacherComposer` reuse in ClassFormDialog (currently a pending-email input).

### Modified

- `classlite-api/internal/store/queries/classes.sql` — extended `CreateClass`/`GetClassByID` to the full 18-col row; added `ListClasses`, `ListClassesByTeacher`, `UpdateClass` (COALESCE partial + teacher/pending mutex CASE), `UpdateClassStatus` (compare-and-swap).
- `classlite-api/internal/service/class.go` — Spawn `CreateClass` callsite passes the 5 new columns (`color: tmpl.Color`, due dates OFF).
- `classlite-api/cmd/api/main.go` — wired `classChain` (not owner-gated) + 5 class routes, reusing the existing `classSvc`.
- `classlite-api/internal/store/generated/*` — regenerated (classes.sql.go, models.go `Class`) via `codegen.sh` (2 split runs).
- `classlite-web/src/lib/api/client.ts` — regenerated with Class/CreateClassRequest/UpdateClassRequest/ClassStatusTransitionRequest/EnvelopeClass(+List) + 5 class paths.
- `classlite-api/api.yaml` — Story 3.1 schemas (Class, ClassStatus, Create/Update/StatusTransition requests, EnvelopeClass/List) + 5 paths (GET/POST /api/classes, GET/PATCH /api/classes/{id}, POST /api/classes/{id}/status).
- `classlite-api/internal/service/class_lifecycle_atdd_test.go` — test-side fixes: `seedClassRaw` inserts via superuser pool (FORCE RLS); `List` test full teardown (classes + all memberships + center + 3 users).

### Deleted

_(none)_

## Party-Mode Review Appendix

_(n/a — none yet)_
