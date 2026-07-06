# Story 2.2: Completion Notes

_Implementation record for [`2-2-class-template-and-spawning-api.md`](./2-2-class-template-and-spawning-api.md). Status: review._

## Dev Agent Record

### Debug Log

- **Postgres 25P02 on invite race retry-and-reuse.** First green-phase run
  of `TestClassService_Spawn_AC05_RaceRetryReusesExistingInvite` errored
  with `current transaction is aborted, commands ignored until end of
  transaction block (SQLSTATE 25P02)` when the unique-violation on
  `idx_invites_center_email_active` aborted the tx. Same lesson Story 2.1's
  slug retry closed. Fix: wrap the invite INSERT in a `SAVEPOINT invite_insert`
  so `ROLLBACK TO SAVEPOINT` restores the tx to a usable state before the
  `GetActiveInviteByEmail` reuse SELECT runs (`class.go:264-296`).
- **`ExtractTenant` blind spot for authenticated calls with a CenterID
  claim.** ATDD green-phase surfaced a latent middleware bug: `ExtractTenant`
  ran `GetCenterMemberByUserAndCenter` against the connection pool without
  setting `app.current_tenant_id`, so RLS on `center_members` filtered out
  every row → every authenticated caller with a valid CenterID claim would
  hit `INVALID_TENANT_CLAIM`. Story 2.1 tests missed it because Story 2.1's
  ATDD suite mints tokens with EMPTY CenterID (they hit the "create a center"
  endpoint where CenterID doesn't exist yet). Story 2.2 is the first story
  where the caller arrives WITH a CenterID claim in production. Fix:
  `ExtractTenant` now opens its own tx + `SELECT set_config(...)` for the
  membership lookup, mirroring the pattern already used by
  `AdminInviteStaff` (`internal/middleware/auth.go:73-108`). This was an
  actual production-critical bug the story exposed as a side-effect of
  wiring the first real middleware chain that requires a CenterID claim.
- **Test-file structural bugs surfaced during green.** Two ATDD test file
  issues surfaced that block a strictly-verbatim reading (§9 preservation
  checklist). Both are helper-utility fixes, not assertion changes:
  - `assertErrorCodeTmpl` + `assertFieldErrorCode` in
    `template_handler_atdd_test.go` shared a single `*bytes.Buffer` — the
    first call drained it, the second got EOF. Fixed with a `bufSnapshot`
    helper that reads via `bytes.NewReader(body.Bytes())` so subsequent
    consumers see the same payload.
  - `TestSpawn_AC11_AttackVectors` subtests share pool state without
    per-subtest cleanup. Subtest 1 ("body_center_override") legitimately
    spawns 1 attacker class per SEC-7 (server ignores body's `centerId`),
    which pollutes subtest 2's ("template_id_from_other_tenant") "expected
    zero classes anywhere" assertion. Reordered the subtests (zero-state
    subtest first) so the sequence is deterministic — assertions verbatim.
- **`FieldError` gained a `Code` field.** AC13's error catalog requires
  per-field UPPER_SNAKE_CASE codes (`INVALID_TEACHER_EMAIL`,
  `SELF_INVITE_BLOCKED`). The existing `model.FieldError` only had
  `Field` + `Message`. Added `Code string` with `json:"code"` (no
  `omitempty` per GO-5) and matching schema field in api.yaml — existing
  callers leave `Code` empty; the new spawn validators populate it. This
  is an additive change that stays backward-compatible.
- **Cross-package test parallelism collision on `owner@example.com`.**
  Story 2.2's raw-pool ATDD tests in `internal/service/class_atdd_test.go`
  and `internal/handler/template_handler_atdd_test.go` both `CreateUserOnPool`
  with `owner@example.com`. When Go runs packages in parallel (default),
  their commits collide on `idx_users_email`. Regression MUST use
  `go test -race -count=1 -p 1 ./...` to serialize DB access across
  packages. Documented as a pragmatic deviation — the shared-DB integration
  test pattern is the canonical fix; per-test unique emails would require
  modifying ATDD test assertions.
- **`PurgeUserAndOwnedCenters` cascade extended.** Original helper only
  purged `audit_logs` + `center_members` + `centers` + `onboarding_progress`
  + `users`. Story 2.2 needed pre-cascade cleanup of `invites` + `classes`
  + `template_sessions` + `class_templates` (FK ordering) AND additional
  post-cleanup of `auth_audit_logs` + `email_verifications` +
  `refresh_tokens` + `password_resets` so the shared DB stays clean between
  test runs. Implemented via a `prePurgeHooks` registry populated by Story
  2.2's init() so future stories can chain their own cleanups.

### Completion Notes

- All 13 ACs green with tests.
- **R1 discharge complete**: 23 RLS tests pass (`class_templates_rls_test.go`
  8 + `template_sessions_rls_test.go` 9 + `classes_rls_test.go` 6), covering
  the J15 6-pattern grid × 3 resource families plus the 5 named extensions
  (Sally-S1 seed threshold, Murat-M-B2 seed forgery, Murat-M-B1×3 trigger
  reconciliation).
- **Handler ATDD**: all 12 tests green (list happy + list mixed + create
  happy + create validation matrix + spawn happy + spawn Founder auto-assign
  + spawn 3-vector attack matrix + spawn envelope shape + auth negatives).
- **Service ATDD**: all 11 tests green (Branch A/B/C/D matrix + Founder
  auto-assign + AC4b Sally-B4 belt + AC5 dedup + AC5 race retry-and-reuse
  + AC9 audit atomicity + Murat-M-S3 enqueue buffer-full + Murat-M-B3
  post-accept re-invite Branch B precedence + template-from-other-tenant 404).
- **Middleware ATDD**: 3 tests green for `RequireCenterContext` (pass,
  reject, missing-context 500).
- **Migrations**: 5 pairs applied cleanly + down/up round-trip verified.
  Cascade audit passes — deleting a center cascades to `class_templates` +
  `classes` and (via `class_templates` FK) `template_sessions`.
- **Regression**: `go test -race -count=1 -p 1 ./...` green across all
  packages (`clock` / `config` / `event` / `handler` / `middleware` /
  `service` / `store` / `test` / `test/workers` / `tools/tenantcheck`).
- **Pragmatic deviations flagged** for reviewer:
  1. **`ExtractTenant` tx-wrap** — surgical middleware fix for latent
     production bug; small footprint, mirrors AdminInviteStaff pattern.
  2. **Handler ATDD helper `bufSnapshot`** — structural helper only, no
     assertion semantics changed (per ATDD §9 preservation).
  3. **AC11 subtest reordering** — same rationale; deterministic
     sequencing keeps assertions verbatim.
  4. **`model.FieldError.Code`** — additive field; existing callers unaffected.
  5. **`FUNCTION sync_template_sessions_center_id` uses SECURITY DEFINER**
     — makes the parent-template lookup deterministic (bypasses caller's
     RLS scope). WITH CHECK on the RLS UPDATE policy is the primary defense
     against parent-mismatch attacks (Murat-M-B1); SECURITY DEFINER just
     removes the "parent invisible because RLS filtered it" foot-gun for
     future maintainers.
  6. **`GetActiveInviteByEmail` uses sqlc named args** (`sqlc.arg`) so the
     generated Go struct field is `Email` (not `Lower`). Purely cosmetic
     for the codegen output.
  7. **Cross-package `-p 1` required for regression** — documented in the
     debug log above; integration-test standard practice for shared DB.
- **Filed follow-ups (out of scope)**: FU-2-2-A..F unchanged from spec
  (drift audit, cross-center teacher borrow, partial spawn, complete syllabus,
  claim-the-class, user-keyed rate limit). Two NEW filed:
  - FU-2-2-G: backfill FOR UPDATE + WITH CHECK on `center_members`,
    `invites`, `audit_logs` when those migrations next open (Winston-W-B1
    fold-forward).
  - FU-2-2-H: Story 3.1's `GET /api/classes` read path should compute
    `invite_expired` state when `pending_teacher_email` set +
    `teacher_id NULL` + invite `expires_at < now()`.

### Implementation Plan (executed)

1. Task 0 — Verified ATDD red-phase specimens (6 files, ~1200 lines) present + understood.
2. Task 1 — Added GET /api/templates, POST /api/templates, POST /api/templates/{id}/spawn to api.yaml + 10 schema components + 3 envelope schemas. Codegen deferred to 3.6.
3. Task 2 — Wrote 5 migration pairs (class_templates + template_sessions with trigger + classes + seed + invites unique index). Applied clean, down/up round-trip clean, 23 RLS tests pass.
4. Task 3 — Wrote sqlc queries for class_templates, classes, invites (2 new), users (1 new). Ran codegen.
5. Task 4 — `RequireCenterContext` middleware — 3 ATDD tests green.
6. Task 5 — Model DTOs (`CreateTemplateInput`, `Template`, `TemplateSession`, etc.) + `FieldError.Code` field.
7. Task 6 — `TemplateService` (List + Create) with validation matrix + audit LogWithinTx.
8. Task 7 — `ClassService.Spawn` — 350-line transactional flow (persona lookup, teacher branch resolution, tx + SET LOCAL, template read, Branch B verify inside tx, invite dedup with SAVEPOINT retry, class inserts with audit, post-commit email enqueue).
9. Task 8 — `TemplateHandler` (List / Create / Spawn) — envelope + AC13 error routing.
10. Task 9 — Wired routes in cmd/api/main.go with `templateChain` + `spawnChain` (spawnLimit BEFORE onboardingLimit per Winston-W-B3 + W-S4).
11. Task 10-11 — `story_2_2_helpers.go` with 8 fixture helpers + test server harness. Extended `PurgeUserAndOwnedCenters` with `prePurgeHooks` registry.
12. Task 12 — Full regression + close-out. Fixed latent `ExtractTenant` production bug surfaced by green tests.

## File List

### Added
- `classlite-api/api.yaml` sections for Story 2.2 (paths + schemas) — extended, not new file
- `classlite-api/migrations/20260703120000_create_class_templates.{up,down}.sql`
- `classlite-api/migrations/20260703120100_create_template_sessions.{up,down}.sql`
- `classlite-api/migrations/20260703120200_create_classes.{up,down}.sql`
- `classlite-api/migrations/20260703120300_seed_class_templates.{up,down}.sql`
- `classlite-api/migrations/20260703120400_add_invites_center_email_unique.{up,down}.sql`
- `classlite-api/internal/store/queries/class_templates.sql`
- `classlite-api/internal/store/queries/classes.sql`
- `classlite-api/internal/model/template.go`
- `classlite-api/internal/middleware/require_center_context.go`
- `classlite-api/internal/service/template.go`
- `classlite-api/internal/service/class.go`
- `classlite-api/internal/handler/template_handler.go`
- `classlite-api/internal/test/story_2_2_helpers.go`
- `classlite-api/internal/store/generated/class_templates.sql.go` (codegen)
- `classlite-api/internal/store/generated/classes.sql.go` (codegen)

### Modified
- `classlite-api/api.yaml` — added 3 operations + 10 schema components + 3 envelope schemas + extended FieldError with code
- `classlite-api/internal/store/queries/invites.sql` — added `CreateInviteFull` + `GetActiveInviteByEmail`
- `classlite-api/internal/store/queries/users.sql` — added `GetUserPersonaAndEmail`
- `classlite-api/internal/store/generated/invites.sql.go` — regenerated
- `classlite-api/internal/store/generated/users.sql.go` — regenerated
- `classlite-api/internal/model/errors.go` — added `Code` field to FieldError
- `classlite-api/internal/middleware/auth.go` — `ExtractTenant` now opens tx + SET LOCAL for center_members membership lookup (latent production bug fix)
- `classlite-api/cmd/api/main.go` — wired 3 template routes with per-endpoint rate limit (`spawnLimit` 5/min + `onboardingLimit` 20/min)
- `classlite-api/internal/test/story_2_1_helpers.go` — added `prePurgeHooks` registry + extended `PurgeUserAndOwnedCenters` with auth_audit_logs / email_verifications / refresh_tokens / password_resets
- `classlite-api/internal/handler/template_handler_atdd_test.go` — helper-only fixes: `bufSnapshot` for non-consuming body reads + AC11 subtest reordering (assertions verbatim)
- `classlite-web/src/lib/api/client.ts` — regenerated from api.yaml

### Deleted
- None

## Regression Command

```
# Full test suite. -p 1 required for cross-package DB sharing (Story 2.2
# raw-pool tests commit owner@example.com; parallel package runs collide).
go test -race -count=1 -p 1 ./...

# Fast subset (single package):
go test -race -count=1 ./internal/service/
go test -race -count=1 ./internal/handler/
go test -race -count=1 ./internal/middleware/
go test -race -count=1 ./internal/test/
```
