# Story 4.1: Completion Notes

_Implementation record for [`4-1-exercise-library-and-crud-api.md`](./4-1-exercise-library-and-crud-api.md). Status: review._

## Dev Agent Record

### Debug Log

- **sqlc list-row type split** — `ListExercisesByTeacher` emits a distinct `ListExercisesByTeacherRow` type (identical fields to `ListExercisesRow`); added `teacherRowsToListRows` to converge them so the service returns one row shape.
- **`uniqueViolationPgErrorCode` redeclare** — the const already lives in `auth.go` (same package); dropped the duplicate from `exercise_service.go`.
- **backend handler name collision** — `exerciseToResponse`/`exerciseResponse` collided with the session-detail handler in the same `handler` package; renamed the library variant to `libraryExerciseToResponse` (the type `exerciseResponse` was unique).
- **RLS test NOT-NULL tags** — raw inserts must pass `'{}'` not `nil` for `tags` (explicit column, so the DEFAULT doesn't apply); coalesced nil→empty in `insertExerciseRaw`.
- **FE `meta` drop** — `apiFetch` unwraps to `.data` and discards `meta`; added `apiFetchWithMeta` (shared 401-refresh flow, new `throwEnvelopeError` helper) so the list keeps `meta.pagination` + `meta.skillCounts`.
- **raw-hex lint** — the skill tile palette can't be raw hex in `.ts`; added `--cl-skill-*` tokens to `tokens.css` and `exerciseCode` returns `var(--cl-skill-*)`. Dark-mode-tokens.css is a frozen reserved-epic file → not touched (dark mode unwired).
- **test testid collision** — page container + pagination indicator both used `exercises-page`; renamed the indicator to `exercises-page-indicator`.
- **Radix dropdown onSelect under jsdom** — a dropdown menu-item click does not fire `onSelect` under jsdom userEvent, so the delete-rollback test drives `ExerciseDeleteDialog` + the hook directly (seeded list cache → confirm → 500 → asserts the optimistic removal is rolled back), matching the `TemplateDeleteDialog` test precedent.

### Completion Notes

**What shipped (all in-scope ACs AC1–AC9):**

- **Backend:** migration `20260727120000_create_exercises` (`exercises` + `exercise_code_counters`, both ENABLE+FORCE RLS with the 4-policy grid, composite `(center_id, created_by)` index + GIN `tags`, `UNIQUE(center_id, code)`); `exercises.sql` sqlc (code-counter upsert, soft-delete, optimistic-concurrency update, SQL-computed list counts that never transfer the blob, filtered count + per-skill count queries); the typed v1 `ExerciseContent` contract + `UnmarshalExerciseContent(raw, version)` version dispatch (`schema_version` column-canonical, struct field `json:"-"`); `ExerciseService` (CRUD soft-delete + Duplicate deep-copy + EX-code generation with savepoint retry + teacher-scope 404 + role 403); `api.yaml` additive (Exercise/ExerciseListItem/Create/Update schemas, `meta.pagination` inside the envelope, all error statuses incl. 409/428); `exercise_handler.go` + the 6-route `exerciseChain`; new `PreconditionRequiredError` (428) in the error mapper.
- **Frontend:** `src/features/exercises/` feature module (page + 7 hooks + 3 lib helpers + 2 dialogs + barrel); `/exercises` route gated owner/admin/teacher via `RouteRoleGate`; `'exercises'` added to the `SectionNameKey` union (un-deads the teacher sidebar link); `apiFetchWithMeta` in the shared fetch layer; `exercises.*` i18n keys in both locales (ICU-style compound meta-line, skill-appropriate unit nouns, verbatim two-state empty copy); `--cl-skill-*` tokens.
- **Server-authoritative invariants proven:** `schema_version` + `code` immutable via update (strict-decode rejects a body carrying either → 422); create materializes the FR-22-default settings shell (all defaults = Go zero); the EX-code counter yields N distinct codes under N concurrent creates.

**Deferrals (documented, not silently dropped):** see FU-4-1-A in `deferred-work.md` — "Classes assigned" column + class/assignment-status filters + header roll-up + Assign/Unassign + user Sort control + multi-tag → Epic 5; structured editor + `/exercises/{id}/edit` redirect → 4.2; archive/restore UI → Epic 10; JSONB lazy-upgrade + SQL-count version fallback → 4.5. **FR-20 is 4.1-partial + Epic 5.**

**No new env var / third-party service → `docs/manual-setup.md` not touched (WF-9).**

### Implementation Plan (as executed)

1. Migration (exercises + counters + RLS + indexes) → `scripts/migrate.sh up`.
2. `exercises.sql` sqlc queries (code counter, CRUD soft-delete, optimistic update, SQL list counts, per-skill counts).
3. `api.yaml` additive (paths + schemas + `meta.pagination`) → `scripts/codegen.sh`.
4. Backend Go: `store/exercise_content.go` (v1 contract) → `service/exercise_service.go` → `handler/exercise_handler.go` + `response.go` pagination + `errors.go`/`error_mapper.go` (428) → `main.go` chain.
5. Backend tests: content-contract units, RLS grid (+ reparent + tag-filter-leak + counter), handler ATDD (role scope, pagination boundary, smuggle-reject, duplicate deep-copy, soft-delete, optimistic 428/409/200, golden meta, concurrent codes). `go test ./... && go vet && gofmt` clean.
6. Frontend: `apiFetchWithMeta` → feature module (keys/hooks/lib/components/page/barrel) → route + `SectionNameKey` + i18n + `--cl-skill-*` tokens.
7. Frontend tests: trilogy, both empty states, skill-unit labels, filter/pagination, create-closes-dialog, delete optimistic rollback, i18n parity, axe. `tsc -b && eslint && vitest` green; `i18n-parity` OK.
8. Close-out: FU-4-1-A → `deferred-work.md`; this completion-notes file.

## File List

### Added

**Backend (classlite-api):**
- `migrations/20260727120000_create_exercises.up.sql` / `.down.sql`
- `internal/store/queries/exercises.sql`
- `internal/store/exercise_content.go` — v1 `ExerciseContent` contract + version dispatch
- `internal/store/exercise_content_test.go`
- `internal/service/exercise_service.go`
- `internal/handler/exercise_handler.go`
- `internal/handler/exercise_handler_atdd_test.go`
- `internal/test/exercises_rls_test.go`
- `internal/test/story_4_1_helpers.go`

**Frontend (classlite-web):**
- `src/features/exercises/` — `ExerciseLibraryPage.tsx`, `index.ts`, `api/{exercisesKeys,useExercises,useExercise,useCreateExercise,useUpdateExercise,useDeleteExercise,useDuplicateExercise}.ts`, `lib/{exerciseSchema,exerciseUnits,exerciseCode}.ts`, `components/{ExerciseFormDialog,ExerciseDeleteDialog}.tsx`, `__tests__/ExerciseLibraryPage.test.tsx`

### Modified

- `classlite-api/api.yaml` — exercise paths + schemas + `EnvelopeMetaPaginated`/`PaginationMeta`/`SkillCount` (additive).
- `classlite-api/internal/store/generated/*`, `classlite-web/src/lib/api/client.ts` — codegen output (regenerated).
- `classlite-api/internal/handler/response.go` — `PaginationMeta` + `WriteEnvelopeWithMeta`.
- `classlite-api/internal/service/errors.go` — `PreconditionRequiredError` (428).
- `classlite-api/internal/middleware/error_mapper.go` — 428 mapping arm.
- `classlite-api/cmd/api/main.go` — `exerciseChain` + 6 routes.
- `classlite-web/src/lib/api-fetch.ts` — `apiFetchWithMeta` + `throwEnvelopeError` extraction + `EnvelopeWithMeta`.
- `classlite-web/src/routes.tsx` — `/exercises` lazy chunk + `RouteRoleGate`.
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `'exercises'` in `SectionNameKey`.
- `classlite-web/src/tokens.css` — `--cl-skill-*` palette.
- `classlite-web/src/locales/en.json` + `vi.json` — `exercises.*` keys + `app.permissionDenied.section.exercises.header`.
- `_bmad-output/implementation-artifacts/deferred-work.md` — FU-4-1-A.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 4-1 → in-progress → review.

### Deleted

None.
