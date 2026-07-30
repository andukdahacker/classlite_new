# Story 4-4a: Completion Notes

_Implementation record for [`4-4a-knowledge-hub-apis-and-upload-hardening.md`](./4-4a-knowledge-hub-apis-and-upload-hardening.md). Status: review._

## Dev Agent Record

### Debug Log

- **sqlc + recursive CTE.** sqlc's analyzer could not resolve columns of a recursive CTE inside an `EXISTS`/qualified subquery (`ambiguous "id"` → `alias does not exist`). Reshaped the cycle/depth guard into a single `FolderAncestorIDs :many` that selects the plain `id` column; the service derives both the cycle check (membership) and depth (count) in Go. Still a recursive-CTE ancestor walk (honors AC2), just sqlc-analyzable.
- **Adding columns de-aliased existing queries.** `centers.storage_limit_bytes` + `session_materials.file_id` made `generated.Center`/`generated.SessionMaterial` differ from the `SELECT`-explicit-column queries that used to alias them → compile breaks in settings/center/session_content. Fixed by appending the new columns to those queries' column lists so they realign to the model structs (behavior-preserving).
- **Presign `sizeBytes` required-field regression.** Making `sizeBytes` a required presign field 422'd the existing 1.2e/2.7 presign tests (which predate it). Made it optional server-side — the A9 cap (layer 2) is enforced only when provided; layer 4 (confirm HeadObject) is the authoritative guard **for `knowledge` uploads** (non-knowledge features keep 1.2e verify-and-echo — accepted ratified scope, see review D1). Canary still sends it.
- **Storage-full deletes the orphan.** The soft-delete-frees-space test initially failed on the retry because the earlier STORAGE_FULL rejection best-effort-deleted the object (AC12 orphan cleanup). Test now re-seeds the mock before the retry (models the client re-uploading after freeing space) — correct behavior surfacing.
- **`uuidPgToPtr` already existed** in `class_handler.go`; removed the duplicate from the knowledge handler.

### Completion Notes

- **AC1–AC13 all met.** Migration up+down verified on the live dev DB (round-trip clean). RLS proven on `files` + `folders` via the 6-pattern cross-tenant grid ×2.
- **AC12 (highest-severity party-mode finding) — quota TOCTOU fixed.** The ceiling is enforced at `FileService.ConfirmUpload` INSIDE the tenant tx, serialized per-center via `pg_advisory_xact_lock(hashtextextended(center_id, 0))`. The concurrency test uses `SetupRawPool` (real separate connections — `SetupDB`'s single tx would mask the race) and proves exactly one of two jointly-over-ceiling confirms wins, with exactly one persisted row. Presign does an advisory (explicitly non-authoritative) 409 pre-check only.
- **AC4 idempotency** by `(center_id, object_key)` via `InsertFileIdempotent ... ON CONFLICT DO NOTHING` + a re-read; a retry returns the same file id, one row, counted once, and emits the AC11 replay Info counter.
- **AC9 delete-on-mismatch** matrix all green: size>cap→413+delete, wrong type→422+delete, HeadObject transport error→502 fail-closed (no row, NO phantom delete), delete-fails→`orphaned_object` telemetry.
- **T3a SPIKE — resolved, outcome (B).** R2/S3 presigned **PUT** has no `Content-Length-Range` condition (that is a POST-policy-only feature) and it cannot be verified against a real R2 bucket in this environment. **Layer 3 was DROPPED**; the confirm HeadObject size re-validation (layer 4) is the authoritative size guard **for `knowledge` uploads** (the only feature that creates a Hub `files` row; non-knowledge features remain advisory-only per review D1). Deliberately did **not** add a `MaxBytes` presign param — an unenforced security control is the exact silent-unbounded footgun party-mode flagged, so `Presign` stays positional. The spike-gated scaffold was **deleted**, not left as a silent skip.
- **A10 slog redaction** installed process-wide (`logging.NewRedactingJSONHandler` at `cmd/api/main.go`) — masks `s3.amazonaws.com`/`r2.cloudflarestorage.com` URLs + `X-Amz-Signature` in string/group/any attribute values while keeping `request_id` (non-vacuous).
- **AC13 linked-locations** resolver pinned: session links via the indexed `session_materials.file_id` FK; exercise-audio links via the GIN-indexed JSONB containment `content @> {"sections":[{"knowledgeFileId":"<id>"}]}` (`idx_exercises_content_gin`, `jsonb_path_ops`). Soft-deleted host or file excluded on either end. **No view-rate field** (test asserts its absence).
- **Uploads are now authenticated.** The presign/confirm endpoints were wired with NO middleware in 1.2e (and `ExtractTenant` never set `model.TenantID`, so they were effectively non-functional in prod). They now ride the knowledge chain (extractTenant → requireVerified → requireCenter). The handler reads the canonical `TenantContext` with a fallback to the raw `model.TenantID` key so the pre-middleware ATDD canary stays green.

### Dev decisions flagged for review

- **`maxFolderDepth = 10`** — not pinned by the story ACs; chosen here. The cycle guard alone guarantees the tree render terminates; depth is a secondary UX ceiling.
- **Routine file/folder CRUD audit is conditional-on-actor** (`auditIfActor` skips when `tc.UserID == ""`). The production chain always supplies a user; the direct-service quota tests exercise storage/quota without one. The security-critical `R2_KEY_PREFIX_MISMATCH` audit (AC9a) is written whenever an actor is present (always, in prod).
- **`4.4b` contract:** the "From Knowledge Hub" audio picker must write `{"knowledgeFileId": "<file uuid>"}` at the exercise section level for the AC13 exercise-link resolver to find it.

### Implementation Plan (as executed)

1. **T7** api.yaml (paths + schemas) → `openapi-typescript` validate.
2. **T1** migration (files/folders/ceiling/session_materials.file_id/GIN) → `migrate up`; up→down→up round-trip verified.
3. **T2** sqlc `files.sql` + `folders.sql` → `sqlc generate`; realigned `centers.sql`/`session_content.sql` column lists.
4. **T3/T3a** `StorageService.Delete` (+ mock/R2); Content-Length-Range spike concluded (layer 3 dropped); spike test deleted.
5. **T5** `service/upload_allowlist.go`, `size_caps.go`, `file_errors.go`, `file_service.go` (files+folders+confirm+storage); `handler/knowledge_hub_handler.go`.
6. **T4** rewrote `handler/upload_handler.go` (hardened presign + reshaped confirm); error-mapper arms; wired the knowledge chain in `main.go`.
7. **T6** `logging/redact.go` + `main.go` default handler.
8. **T8** activated/reconciled the ATDD scaffolds + `story_4_4_helpers.go` harness.
9. **T9** manual-setup.md note (`.env.example` already carried R2_*/RESEND_*/GEMINI_* from 4.3a — no change needed).
10. Final `codegen.sh`; `go build`/`go vet ./...`/`gofmt`/`go test ./...` green.

## File List

### Added
- `classlite-api/migrations/20260730120000_create_knowledge_hub.up.sql` / `.down.sql` — files/folders + RLS + ceiling + session_materials.file_id + GIN.
- `classlite-api/internal/store/queries/files.sql`, `folders.sql` — sqlc queries.
- `classlite-api/internal/service/file_service.go` — FileService (files+folders+confirm+storage+linked-locations).
- `classlite-api/internal/service/file_errors.go`, `size_caps.go`, `upload_allowlist.go` — typed errors, A9 caps, MIME allowlist + key parsing.
- `classlite-api/internal/handler/knowledge_hub_handler.go` — folder/file/storage handlers.
- `classlite-api/internal/logging/redact.go` — A10 redacting slog handler.
- `classlite-api/internal/test/story_4_4_helpers.go` — bare-mux harness + storage/limit/cleanup helpers.
- `classlite-api/internal/test/files_rls_test.go`, `folders_rls_test.go`, `storage_quota_race_test.go` — store/RLS/concurrency (were `_`-prefixed scaffolds).
- `classlite-api/internal/handler/upload_confirm_hardening_atdd_test.go`, `knowledge_hub_handler_atdd_test.go`, `upload_slog_redaction_atdd_test.go` — handler integration (activated scaffolds).

### Modified
- `classlite-api/api.yaml` — presign/confirm/knowledge-hub/storage paths + schemas + error codes.
- `classlite-api/internal/service/storage.go`, `storage_mock.go`, `storage_r2.go` — `Delete` method (+ mock `Deleted`/`DeleteError`).
- `classlite-api/internal/handler/upload_handler.go` — hardened presign + reshaped confirm.
- `classlite-api/internal/middleware/error_mapper.go` — 4.4a value-typed error arms (413/409/422/403/502).
- `classlite-api/cmd/api/main.go` — redacting logger + knowledge chain wiring; upload routes moved behind auth.
- `classlite-api/internal/store/queries/centers.sql`, `session_content.sql` — realign column lists to the new model fields.
- `classlite-api/internal/store/generated/*` — sqlc regen (read-only).
- `classlite-web/src/lib/api/client.ts` — openapi-typescript regen (read-only) for 4.4b.
- `docs/manual-setup.md` — Story 4.4a R2/storage-ceiling note.

### Deleted
- `classlite-api/internal/test/_presign_content_length_range_atdd_test.go` — spike outcome (B): R2 doesn't enforce Content-Length-Range on presigned PUT; layer 3 dropped.
