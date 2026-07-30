---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-30'
generatedTestFiles:
  - 'classlite-api/internal/handler/upload_presign_size_atdd_test.go'          # ACTIVE (red now)
  - 'classlite-api/internal/handler/_upload_confirm_hardening_atdd_test.go'     # build-excluded
  - 'classlite-api/internal/handler/_upload_slog_redaction_atdd_test.go'        # build-excluded
  - 'classlite-api/internal/handler/_knowledge_hub_handler_atdd_test.go'        # build-excluded
  - 'classlite-api/internal/test/_files_rls_test.go'                            # build-excluded
  - 'classlite-api/internal/test/_folders_rls_test.go'                          # build-excluded
  - 'classlite-api/internal/test/_storage_quota_race_test.go'                   # build-excluded
  - 'classlite-api/internal/test/_presign_content_length_range_atdd_test.go'    # build-excluded (spike-gated)
storyId: '4.4a'
storyKey: '4-4a-knowledge-hub-apis-and-upload-hardening'
storyFile: '_bmad-output/implementation-artifacts/4-4a-knowledge-hub-apis-and-upload-hardening.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-4-4a-knowledge-hub-apis-and-upload-hardening.md'
inputDocuments:
  - '_bmad-output/implementation-artifacts/4-4a-knowledge-hub-apis-and-upload-hardening.md'
  - 'docs/project-context.md'
  - 'classlite-api/internal/handler/upload_handler.go'
  - 'classlite-api/internal/service/storage.go'
  - 'classlite-api/internal/service/storage_mock.go'
  - 'classlite-api/internal/test/_TEMPLATE_rls_test.go'
  - 'classlite-api/internal/test/story_4_1_helpers.go'
  - 'classlite-api/internal/worker/secret_logging_atdd_test.go'
  - '.claude/skills/bmad-testarch-atdd/resources/knowledge/{data-factories,test-quality,test-healing-patterns,test-levels-framework,test-priorities-matrix,confidence-gate}.md'
detectedStack: 'backend'
---

# ATDD Red-Phase Checklist — Story 4.4a (Knowledge Hub APIs & Upload Hardening)

## Step 1 — Preflight & Context

### Stack detection
- `test_stack_type: auto` → **backend** (Go 1.22, `net/http`, sqlc, pgx v5, PostgreSQL RLS). No browser/UI surface in 4.4a (frontend is 4.4b).

### Prerequisites — PASS
- Story approved, `Status: ready-for-dev`, AC1–AC13 clearly enumerated with locked contracts.
- Go test harness present: `internal/test/helpers.go` (`SetupDB`, `TenantContext`), `fixtures.go` (`TenantAID/BID`, `CreateCenterWithID`), `_TEMPLATE_rls_test.go` (6-pattern RLS grid).
- Dev environment: `docker-compose` Postgres + `scripts/migrate.sh` (transaction-wrapped `SetupDB`).

### Key precedents to mirror (house style)
| Concern | Reference file |
|---|---|
| 6-pattern cross-tenant RLS grid | `internal/test/_TEMPLATE_rls_test.go` |
| slog secret-capture ATDD (AC10 mirror) | `internal/worker/secret_logging_atdd_test.go` |
| Bare-mux HTTP harness (role-flexible) | `internal/test/story_4_1_helpers.go` (`NewExerciseTestServerBareMux`) |
| Storage mock test surface | `internal/service/storage_mock.go` (`SeedObject`, `HeadObjectError`, `Objects` map, `PresignError`) |
| Confirm/presign code under hardening | `internal/handler/upload_handler.go` |
| Concurrency race precedent | `internal/test/centers_slug_collision_race_test.go` |

### TEA config flags
- `tea_use_playwright_utils: true` (N/A — backend, no browser tests), `tea_use_pactjs_utils: false`, `tea_pact_mcp: none`, `test_stack_type: auto`, `risk_threshold: p1`.

### Knowledge fragments loaded
- Core: `data-factories`, `test-quality`, `test-healing-patterns`, `confidence-gate`.
- Backend: `test-levels-framework`, `test-priorities-matrix`.

## Step 2 — Generation Mode

**Mode: AI generation** (backend rule — no browser recording). Scaffolds derived from: story AC1–AC13 locked contracts, `upload_handler.go` source, `storage_mock.go` test surface, and the mirrored precedents above. Recording mode N/A (`tea_browser_automation` irrelevant with zero UI surface).

## Step 3 — Test Strategy

### Test levels (backend)
Unit (service, mocked store — TEST-BE-4) · Integration (store+DB+RLS — TEST-BE-2; handler+middleware — TEST-BE-3) · **No E2E**. Concurrency = integration (real DB, goroutines).

### Red-phase realization strategy (Go compile-break constraint)
`go test ./...` must stay green during dev (DoD). A test referencing a not-yet-existing sqlc/handler symbol breaks the **whole package** build, not just itself. Therefore:
- **Group A — ACTIVE** (`*_atdd_test.go`, compiles today, real red on assertion): only tests that touch **existing** symbols (`UploadHandler.Presign/Confirm`, `MockStorageService`, real middleware, `slog`). These fail NOW → immediate red signal.
- **Group B — BUILD-EXCLUDED SCAFFOLD** (`_*_test.go`, `_`-prefixed like `_TEMPLATE_rls_test.go`): tests referencing net-new symbols (`generated.File/Folder`, new queries, reshaped handler, `sizeBytes`, knowledge-hub routes). Full concrete bodies against the **target** API shape + a `// RED:` header naming the unblocking task. Dev **drops the `_` prefix** as each task lands → genuine red → makes green.

### AC → scenario → level → priority → file
| AC | Scenario (oracle) | Level | Pri | Group | File |
|---|---|---|---|---|---|
| AC1/AC3 | `files` 4-policy FORCE RLS: 6-pattern cross-tenant grid (read/insert/update/delete/null/unset); soft-deleted excluded from lists | Store integ | **P0** | B | `_files_rls_test.go` |
| AC1/AC2 | `folders` 4-policy FORCE RLS: same 6-pattern grid | Store integ | **P0** | B | `_folders_rls_test.go` |
| AC2 | Move folder into own descendant → typed **422**; exceed `maxFolderDepth` → 422; recursive-CTE terminates | Handler integ | **P0** | B | `_folders_cycle_guard_atdd_test.go` |
| AC12 | Two goroutines confirm uploads that individually fit but jointly exceed ceiling → **exactly one 200, one 409 `STORAGE_FULL`**; exactly one row; soft-delete frees space → next confirm succeeds | Store integ (concurrency) | **P0** | B | `_storage_quota_race_atdd_test.go` |
| AC4 | Double-confirm same `(center_id, object_key)` → **one row, storage counted once, no 500**; retry returns same file | Handler integ | **P0** | B | `_confirm_idempotency_atdd_test.go` |
| AC9 | Delete-on-mismatch matrix: size>cap→object deleted + no row + 413; wrong content-type→deleted + 422; `HeadObjectError` (transport)→**fail-closed: no row, no phantom delete**; delete-fails→no row + `orphaned_object` telemetry counter | Handler integ | **P0** | B | `_confirm_delete_on_mismatch_atdd_test.go` |
| AC9a | Confirm key-prefix ≠ JWT tenant → **403 + audit `R2_KEY_PREFIX_MISMATCH`** (403 exists at `:138-140`; audit is net-new) | Handler integ | **P0** | B | `_confirm_prefix_mismatch_audit_atdd_test.go` |
| AC10 | slog masks `X-Amz-Signature` + `*.r2.cloudflarestorage.com`/`s3.amazonaws.com` URLs; capture asserts signature ABSENT **and** `request_id` PRESENT (non-vacuous) — mirrors `secret_logging_atdd_test.go` | Handler integ (log capture) | **P0** | **A** | `upload_slog_redaction_atdd_test.go` |
| AC6/AC7-L2 | Presign with oversized `sizeBytes` → **413 `FILE_TOO_LARGE`** with cap-in-MB message, BEFORE URL generated; per-feature+ext caps (PDF 50 / image 15 / audio 100 MB) as named constants | Handler integ | **P0** | **A** (behavior) + B (const values) | `upload_presign_size_atdd_test.go` + `_size_caps_constants_test.go` |
| AC7-L4/AC9c | Confirm HeadObject re-validates stored size ≤ cap → 413 on overflow (backstop; authoritative if L3 dropped) | Handler integ | **P0** | **A** | `upload_confirm_size_atdd_test.go` |
| AC5/AC8 | MIME allowlist pre-presign (disallowed ext → 422); ext↔Content-Type match; Content-Type locked into signed payload; expiry **5 min**; prefix from JWT not client | Handler integ | P1 | **A** (regression guards, mostly green today) | folded into `upload_presign_size_atdd_test.go` |
| AC7-L3 | Presigned URL signs `Content-Length-Range` matching cap — **SPIKE-GATED on T3a** | Store integ | P1 | B (spike-gated) | `_presign_content_length_range_atdd_test.go` |
| AC13 | `GET /files/{slug}` → type-tagged metadata + linked-locations (session_materials FK **and** exercise-audio GIN JSONB `@>`); soft-deleted file OR host excluded; envelope GFW-5; **no view-rate** | Handler integ | P1 | B | `_knowledge_hub_file_detail_atdd_test.go` |
| AC2/AC3 | Folder+file CRUD (create/rename/move/soft-delete) full `{data,meta}` envelope, tenant-scoped; `GET /storage/usage` → `{usedBytes, limitBytes}` | Handler integ | P1 | B | `_knowledge_hub_crud_atdd_test.go` |
| AC11 | Replay: confirm on already-confirmed key → structured slog `Info` counter emitted (policy-note only) | Handler integ (log capture) | P2 | B | `_confirm_replay_counter_atdd_test.go` |

### Red-phase requirement — confirmed
- Group A files **fail on first run today** (413/audit/redaction paths unimplemented) — verified conceptually against current `upload_handler.go` (returns 200/no-audit/no-redaction).
- Group B files are **red-by-construction** the instant their `_` prefix is dropped (reference symbols that T1–T5/T12 create).
- Every positive assertion is paired with a negative (project-context Test Meta-Rules): e.g. quota test asserts the winner's row exists AND the loser's does not; RLS asserts own-tenant sees AND cross-tenant sees zero.

### Coverage guardrails
- Deterministic tenant IDs `TenantAID`/`TenantBID` (TEST-BE-1). Never `t.Parallel()` on shared-tx DB tests. Never `DISABLE ROW LEVEL SECURITY`.
- Confidence gate: object-key/prefix format, cap constants, error codes (`FILE_TOO_LARGE`/`STORAGE_FULL`/`R2_KEY_PREFIX_MISMATCH`) are all pinned in the story ACs — no fabrication needed. `maxFolderDepth` value is **not** pinned in the story → scaffold uses a named `const maxFolderDepth` and flags it for dev to confirm (confidence < 8).

### ATDD applicability (from story Dev Notes "WF-8 / ATDD")
Story explicitly green-lights red tests NOW for: slog redaction (AC10), presign expiry/content-type lock (AC8), `R2_KEY_PREFIX_MISMATCH` audit+403 (AC9a), **quota-concurrency (AC12)**, **delete-on-mismatch (AC9)**, **confirm idempotency (AC4)**, **folder cycle-guard (AC2)**. All have clear oracles → all unblocked for red-phase scaffolding.

## Step 4C — Generation Results (TDD RED PHASE)

**Mode:** sequential (single-author, backend). E2E worker N/A (zero UI surface — 4.4b owns UI).

**Red-phase realization** (Go-adapted `test.skip()` equivalent):
- **1 ACTIVE** file — compiles today, FAILS today (verified: over-cap → 200 instead of 413; under-cap controls PASS). This is the live red canary.
- **7 BUILD-EXCLUDED** `_`-prefixed scaffolds — the Go toolchain ignores them (verified: absent from `go list` build set; `go vet ./internal/handler` clean), so `go test ./...` stays green until the dev drops each `_` prefix as its task lands. Concrete assertions against the target API shape (no placeholders).

| File | ACs | Red mechanism | Un-prefix after |
|---|---|---|---|
| `handler/upload_presign_size_atdd_test.go` | AC6, AC7-L2 | ACTIVE — fails now | (keep active; it's the layer-2 regression) |
| `handler/_upload_confirm_hardening_atdd_test.go` | AC4, AC9, AC9a | build-excluded | T3 (StorageService.Delete + mock.Deleted/DeleteError), T4/T5 (reshaped handler) |
| `handler/_upload_slog_redaction_atdd_test.go` | AC10, AC11 | build-excluded | T6 (`logging.NewRedactingJSONHandler`) |
| `handler/_knowledge_hub_handler_atdd_test.go` | AC2, AC3, AC13, AC12 | build-excluded | T5/T7 (handlers+routes+`NewKnowledgeHubTestServerBareMux`) |
| `test/_files_rls_test.go` | AC1, AC3 | build-excluded | T1 (table+RLS), T2 (sqlc) |
| `test/_folders_rls_test.go` | AC1, AC2 | build-excluded | T1, T2 |
| `test/_storage_quota_race_test.go` | AC12 | build-excluded | T1 (`storage_limit_bytes`), T4/T5 (`FileService.ConfirmUpload`) |
| `test/_presign_content_length_range_atdd_test.go` | AC7-L3 | build-excluded, SPIKE-GATED | T3a (only if R2 enforces Content-Length-Range on PUT — else DELETE) |

### Acceptance-criteria coverage
| AC | Covered by | Notes |
|---|---|---|
| AC1 (schema + 4-policy RLS) | `_files_rls_test.go`, `_folders_rls_test.go` | 6-pattern grid ×2 tables |
| AC2 (folder CRUD + cycle/depth guard) | `_folders_rls_test.go`, `_knowledge_hub_handler_atdd_test.go` | cycle→422 active; depth limit NEEDS-DECISION |
| AC3 (file CRUD, soft-delete) | `_files_rls_test.go`, `_knowledge_hub_handler_atdd_test.go` | soft-delete excluded from list |
| AC4 (confirm idempotency) | `_upload_confirm_hardening_atdd_test.go` | double-confirm→one row, no 500 |
| AC5 (MIME allowlist pre-presign) | existing `upload_handler_test.go` | already green — regression only |
| AC6 (per-file caps, named consts, 413) | `upload_presign_size_atdd_test.go` | ACTIVE boundary table |
| AC7 L2/L3/L4 | presign-size (L2 active) · content-length-range (L3 spike) · confirm-hardening (L4) | L3 contingent on T3a |
| AC8 (presign security) | existing `upload_handler_test.go` + presign-size | 5-min/lock/prefix mostly green today |
| AC9 (confirm hardening: delete-on-mismatch/fail-closed/orphan) | `_upload_confirm_hardening_atdd_test.go` | 4-case matrix |
| AC9a (prefix mismatch 403 + audit) | `_upload_confirm_hardening_atdd_test.go` | 403 exists; audit row net-new |
| AC10 (slog redaction) | `_upload_slog_redaction_atdd_test.go` | non-vacuous (request_id survives) |
| AC11 (replay counter) | `_upload_slog_redaction_atdd_test.go` | skip-sketch, policy-only v1 |
| AC12 (storage ceiling, serialized) | `_storage_quota_race_test.go`, `_knowledge_hub_handler_atdd_test.go` | **SetupRawPool** race + `/storage/usage` |
| AC13 (file detail + linked locations) | `_knowledge_hub_handler_atdd_test.go` | FK + GIN, exclude soft-deleted, no view-rate |

### Open items flagged for the dev (confidence gate)
- **`maxFolderDepth` value is NOT pinned** in the story ACs → scaffold skips the depth test with a NEEDS-DECISION marker. Confirm the constant before activating.
- **Error codes** for the folder cycle (`FOLDER_CYCLE`?) and the exact **HTTP status for HeadObject transport failure** (`502` used as a placeholder) are my best-reads — confirm against `api.yaml`/spec (T7) when writing them.
- **T3a spike outcome** decides whether `_presign_content_length_range_atdd_test.go` is activated or **deleted** (do not leave it as a silent skip).

### Task-by-task activation (dev handoff)
1. Implement the task (T1…T13) per the story.
2. For its scaffold: drop the leading `_` (or un-`t.Skip`), reconcile the `// TODO(dev)` sqlc/handler symbol names against the generated code.
3. Run the now-active test → confirm it FAILS first, then implement until GREEN.
4. Keep `go test ./...` green: only un-prefix a scaffold once its dependencies exist.
5. The ACTIVE canary (`upload_presign_size_atdd_test.go`) stays and must be GREEN before the story is done.
