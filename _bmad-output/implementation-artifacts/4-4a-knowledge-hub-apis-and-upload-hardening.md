# Story 4.4a: Knowledge Hub APIs & Upload Hardening (Backend — Core)

Status: done

<!--
baseline_commit: 03025ebf106fe1a3f92aa644e6e59ee2d4d29143
epic: 4 — Exercise Authoring, AI Content Generation & Knowledge Hub
story_key: 4-4a-knowledge-hub-apis-and-upload-hardening
size: L (backend core of the split 4.4; storage-overflow ladder + analytics carved out — see "Scope after party-mode trim")
dependencies: 1.2e (presigned uploads — BUILT), 3.5 (session_materials — BUILT)
unblocks: 4-4b-knowledge-hub-ui-and-file-picker (needs these endpoints + regenerated client.ts)
completion_notes_sibling: 4-4a-...-completion-notes.md (created at first dev pickup)
amended: 2026-07-30 party-mode review (Winston/Murat/Sally/John); Ducdo ratified pragmatic-trim + 4 correctness bundles
-->

## Story

As a backend engineer,
I want the Knowledge Hub data model, CRUD APIs, and a hardened upload path (A9 per-file size caps + A10 presign security + a correct storage ceiling),
so that the frontend (4.4b) can upload, organize, and reference files safely with tenant isolation and a serialized storage cap.

## Scope after party-mode trim (READ FIRST)

Party-mode review (2026-07-30) ratified a **pragmatic trim** of the epic's A9 overflow ladder + analytics, keeping only what serves the JTBD ("upload a file and reuse it in a lesson") and is correct under concurrency:

**KEPT in this story:**
- Per-file size caps (A9 layers 1-4) — these are per-file, not plan-storage.
- A10 presign security (prefix, content-type lock, MIME, 5-min, audit, slog redaction, replay telemetry).
- A **single storage ceiling** hard-block at 100% — but enforced **at confirm-in-transaction with a lock** (party-mode's highest-severity finding), not at presign.
- `centers.storage_limit_bytes` (a single per-center byte ceiling, default = free cap), NOT a three-tier `plan_tier` enum.

**DEFERRED out of Epic 4** (logged in `deferred-work.md`):
- 80% / 95% storage warnings + 95% owner email → **Epic 9** (billing/plan-overflow, where paying centers exist). *John: "a fire alarm for a building with no tenants."*
- `>100 GB / 24 h` abuse alert → **Epic 9** (collapses into "block + log" for now).
- `file_views` table + "X of N students viewed" analytics → **analytics epic** (read-receipts are a feature, not a field). File detail ships **without** view-rate.
- Three-tier `plan_tier` model + plan changes/purchase → **Epic 9** owns the real billing model and backfills `storage_limit_bytes`.

## Context & Reuse Map (read before touching anything)

**The presigned-upload foundation already exists — reuse and harden, do NOT reinvent.** Story 1.2e (extended by 2.7) shipped presign→PUT→confirm.

| Concern | Status | Location |
|---|---|---|
| `POST /api/uploads/presign` + `/confirm` | **BUILT** | `internal/handler/upload_handler.go` |
| R2 client + `StorageService` interface | **BUILT** | `internal/service/storage.go`, `storage_r2.go`, `storage_mock.go` |
| Key pattern `{center_id}/{feature}/{uuid}.{ext}` | **BUILT** | `upload_handler.go:107` |
| `knowledge` feature slug in allowlist | **BUILT (reserved)** | `upload_handler.go:33` |
| Presign expiry = 5 min (A10 #4) | **BUILT** | `upload_handler.go:109` |
| MIME allowlist (pdf/png/jpg/svg/mp3/wav/webm) | **BUILT** | `upload_handler.go:17-29` |
| Tenant-key prefix guard (SEC-8) on confirm | **BUILT** | `upload_handler.go:138-140` |
| Storage mock (`SeedObject`, `HeadObjectError`) | **BUILT** | `internal/service/storage_mock.go` |
| Test harness / fixtures / RLS template | **BUILT** | `internal/test/helpers.go` (`SetupDB`), `fixtures.go`, `_TEMPLATE_rls_test.go` |
| ATDD secret-log capture precedent | **BUILT** | `internal/worker/secret_logging_atdd_test.go` |

| Net-new | Status | Action |
|---|---|---|
| `files`/`folders` tables + RLS | **NOT FOUND** | Author migration (prefix **> `20260728140000`**) |
| `centers.storage_limit_bytes` (single ceiling) | **NOT FOUND** | Add column, default = free cap; read-only this story |
| `session_materials.file_id` FK + `kind='file'` | **NOT FOUND** | Add FK column + widen CHECK (FU-3-5-C) |
| Content-Length-Range on presign (A9 layer 3) | **NOT FOUND** (deferred from 1.2e) | Extend `Presign` to an options struct with `MaxBytes` — **spike R2 support first** |
| Confirm-tx storage lock (100% hard-block) | **NOT FOUND** | Advisory lock / `FOR UPDATE` around read-then-insert |
| `/confirm` size + content-type re-validation + orphan contract (A9 layer 4) | **NOT FOUND** | HeadObject re-validate + delete-on-mismatch (best-effort + telemetry) |
| slog redaction of R2 URLs / `X-Amz-Signature` (A10 #6) | **NOT FOUND** | `ReplaceAttr` on `cmd/api/main.go:37` |

## Acceptance Criteria

Traceable to `epic-04.md` Story 4.4 (151-165) + locked **A9**/**A10** (`test-artifacts/test-design/blocker-resolutions-2026-06-04.md`), as amended by the 2026-07-30 party-mode trim.

### Group A — Data model & folder/file CRUD
- **AC1** Given the migration (prefix > `20260728140000`), When applied, Then `folders` (id, center_id, parent_folder_id nullable self-FK, name, timestamps, `deleted_at`) and `files` (id, center_id, folder_id nullable FK, name, slug unique-per-center, object_key unique-per-center, content_type, size_bytes bigint, uploaded_by, timestamps, `deleted_at`) exist with 4-policy FORCE RLS + `idx_files_center_folder`; `centers.storage_limit_bytes bigint NOT NULL DEFAULT 524288000` (500 MiB); `session_materials.file_id` nullable FK added and its `kind` CHECK widened to include `'file'`. Down-migration reverses cleanly.
- **AC2** Given folder endpoints, When a teacher creates/renames/moves/deletes a folder, Then the change persists, is tenant-scoped, and supports nesting via `parent_folder_id`. **A move that would create a cycle (folder into its own descendant) or exceed `maxFolderDepth` is rejected with a typed 422** — enforced by a recursive-CTE ancestor check at move time (the 4.4b tree render is a recursive walk; it MUST terminate). Move to a foreign-tenant parent is impossible under RLS and additionally rejected.
- **AC3** Given file endpoints, When a teacher renames, moves (reparent), or soft-deletes a file, Then the change persists. **Delete is soft-delete** (`deleted_at`) per the ratified user-authored-content policy — the R2 object and row are retained; storage accounting and all list queries filter `deleted_at IS NULL`.

### Group B — Upload record, MIME & confirm idempotency
- **AC4** Given `/uploads/confirm` succeeds for a `knowledge` file, When the frontend calls the create-file endpoint, Then a `files` record is created (name, size_bytes, content_type, folder_id, object_key, slug). The presign request carries a new `sizeBytes` field. **Confirm/create is idempotent by `(center_id, object_key)`**: a client retry returns the same file, writes exactly one row, and counts storage exactly once (never a 500 on the duplicate).
- **AC5** Given an upload, When the type is checked, Then only **PDF, PNG, JPG, SVG, MP3, WAV, WebM** are accepted server-side BEFORE presigning (A10 #3, `upload_handler.go:17-29`); extension↔Content-Type must match (`:90-94`).

### Group C — Per-file size caps (A9, 4 layers; server owns 2/3/4)
- **AC6** Given locked A9 caps, When an upload runs, Then: **Knowledge Hub PDF 50 MB · image (PNG/JPG/SVG) 15 MB · Listening audio (MP3/WAV) 100 MB** — **named constants** (CQ-3), keyed by feature+extension. Exceeding returns **413** with i18n code **`FILE_TOO_LARGE`** and a message including the cap in MB.
- **AC7** Given defense-in-depth (layers 2-4; layer 1 = client, in 4.4b), Then: **(2)** `/uploads/presign` returns 413 `FILE_TOO_LARGE` (using request `sizeBytes`) BEFORE generating the URL; **(3)** the presigned URL signs a `Content-Length-Range` matching the cap — **CONTINGENT on the spike (T3a) confirming R2 enforces it on S3-compatible PUT; if not, layer 3 is dropped and layer 4 becomes the authoritative size guard, documented**; **(4)** `/uploads/confirm` HeadObject re-validates actual stored size — see AC9 for the delete/orphan semantics.

### Group D — R2 presign security & confirm hardening (A10)
- **AC8** Given `/uploads/presign`, Then: **(a)** the `{center_id}` prefix is derived from JWT tenant context (built from context, not client input); **(b)** Content-Type locked into the signed payload; **(c)** MIME allowlist validated server-side; **(d)** expiry **5 min** (keep `:109`).
- **AC9** Given `/uploads/confirm`, Then it re-validates: **(a)** `{center_id}` prefix vs JWT (`:138-140`, keep) — on mismatch, **403 + audit-log `R2_KEY_PREFIX_MISMATCH`**; **(b)** HeadObject Content-Type matches the locked one; **(c)** stored size ≤ per-feature cap; **(d)** object exists. **On a size/content-type mismatch → delete the object (best-effort) + return 413/422; if the delete itself fails, do NOT write the row and emit an `orphaned_object` telemetry counter (a later reaper sweep can reclaim).** On a **HeadObject transport error (network, not a mismatch) → fail closed: no row, no delete** (do not phantom-delete an object that may be fine).
- **AC10** Given slog config, When any path could log a presigned URL/signature, Then slog masks values/URLs matching `s3.amazonaws.com|r2.cloudflarestorage.com` and `X-Amz-Signature` params — never logged. A capture test grep-asserts absence of the signature AND presence of `request_id` (proves logging ran) — mirror `secret_logging_atdd_test.go`.
- **AC11** Given the replay-detection hook, When `/uploads/confirm` runs and HeadObject shows the object was already confirmed for the same key, Then the event is counted (structured slog `Info` counter). Policy note only: promote to dedup table if >3/month post-launch.

### Group E — Storage ceiling (100% hard-block, serialized)
- **AC12** Given the storage ceiling, When a file is confirmed, Then the **hard-block is enforced at confirm INSIDE the transaction that inserts the `files` row**, serialized per-center via `pg_advisory_xact_lock(center_id-hash)` (or `SELECT … FOR UPDATE` on a per-center accounting anchor). Accounting = `SUM(size_bytes) WHERE deleted_at IS NULL AND center_id = :id`; if `used + new > centers.storage_limit_bytes` → reject with **409 `STORAGE_FULL`** (i18n "Storage full…"), delete the just-uploaded object (best-effort + orphan telemetry per AC9), write no row. **`/uploads/presign` does a fast-fail UX pre-check only (advisory, explicitly NON-authoritative)** so the user isn't told "ok" then rejected after a 50 MB upload. Existing files stay accessible. `GET /api/storage/usage` returns `{ usedBytes, limitBytes }`.

### Group F — File detail & linked locations (no view-rate)
- **AC13** Given `GET /api/knowledge-hub/files/{slug}`, Then it returns type-tagged metadata (content_type, size, upload date) and **linked locations** (exercises/sessions referencing the file). Resolver is **pinned**: session-material links via the indexed `session_materials.file_id` FK; exercise-audio links via a **GIN-indexed JSONB containment** query over exercise `content` (the GIN index is mandatory — this runs on every detail load). A linked location whose file OR host is soft-deleted (`deleted_at IS NOT NULL`) is excluded. Envelope per GFW-5. **No "X of N viewed" (deferred).**

## Tasks / Subtasks

> **API-first (WF-1):** `api.yaml` → `codegen.sh` → migration → `migrate.sh` → `.sql` queries → `codegen.sh` (LAST) → Go impl.

- [x] **T1 — Schema migration** (AC1, AC3): `folders`, `files` (soft-delete, unique slug + object_key per center) + 4-policy FORCE RLS + indexes incl. **GIN on exercise `content`** for the linked-locations resolver; `centers.storage_limit_bytes` (default 524288000); `session_materials.file_id` nullable FK + widen `kind` CHECK to `'file'` (FU-3-5-C). **No `file_views` table (deferred).**
- [x] **T2 — sqlc queries** (`queries/files.sql`, `folders.sql`): CRUD, soft-delete, list-by-folder, slug lookup, `SUM(size_bytes)` usage, recursive-CTE ancestor check for the cycle guard, linked-locations (FK join + JSONB `@>`). Then `codegen.sh`.
- [x] **T3 — `Presign` → options struct** (AC7 layer 3): change `StorageService.Presign(ctx, key, contentType, expiry)` → `Presign(ctx, PresignParams{Key, ContentType, Expiry, MaxBytes})`; `MaxBytes` **non-optional for PUT** (no zero-value sentinel — a security control must not have a silent "unbounded" default). Update mock + all existing callers (imports/2.7; speaking/Epic-5 later). **Cross-service (WF-4) — same commit as callers, flag in review.**
  - [x] **T3a — SPIKE (do before relying on layer 3):** verify R2 enforces `Content-Length-Range` on S3-compatible presigned **PUT** (not just POST policy). If it does, wire it in `storage_r2.go`. If NOT, drop layer 3, make AC9 layer-4 the authoritative size guard, and document the finding in the completion notes.
- [x] **T4 — Harden `upload_handler.go`** (AC4-AC12): `sizeBytes` request field; presign size pre-check → 413 + advisory storage pre-check (UX fast-fail); **confirm idempotency by (center_id, object_key)**; HeadObject size+content-type re-validation; **delete-on-mismatch (best-effort) + `orphaned_object` telemetry on delete failure + fail-closed on HeadObject transport error**; audit-log on prefix mismatch; replay telemetry counter; **confirm-tx storage hard-block with per-center advisory lock (AC12)**.
- [x] **T5 — Knowledge Hub domain (handler/service/store)** (AC2, AC3, AC13): folders CRUD **+ cycle/depth guard on move**; files list/get-by-slug/rename/move/soft-delete; `GET /api/storage/usage`; file-detail + linked-locations resolver. GO-1 TenantContext, GO-2 custom errors, GO-3 layers, GFW-5 envelope.
- [x] **T6 — slog redaction** (AC10): `ReplaceAttr` on the JSON handler at `cmd/api/main.go:37`; ATDD capture test (mirror `secret_logging_atdd_test.go`).
- [x] **T7 — api.yaml** (WF-1, FIRST): knowledge-hub endpoints (folders, files, file detail `{slug}`, `/storage/usage`) + extend presign request with `sizeBytes` + document 413 `FILE_TOO_LARGE` / 403 `R2_KEY_PREFIX_MISMATCH` / 409 `STORAGE_FULL` / 422 folder-cycle. Then `codegen.sh`.
- [x] **T8 — Tests** (WF-8 partial ATDD — see Dev Notes): `files_rls_test.go`/`folders_rls_test.go` (4-policy cross-tenant read+write, TEST-BE-1, deterministic tenant IDs); **storage-concurrency test** (two goroutines confirming uploads that individually fit but jointly exceed → exactly one succeeds; soft-delete frees space and unblocks — real DB, TEST-BE-2); **delete-on-mismatch matrix** (size>cap→deleted/no-row; wrong-type→deleted; `HeadObjectError`→fail-closed, no phantom delete; delete-fails→orphan telemetry); **confirm idempotency** (double-confirm→one row, counted once); **folder cycle-guard** (move into own descendant→422); slog capture (AC10); handler integration full-envelope (TEST-BE-3); service unit w/ mocked store (TEST-BE-4). `story_4_4_helpers.go` HTTP harness + storage-mock injection.
- [x] **T9 — WF-9 docs**: R2 bucket + `R2_*` env + Resend already tracked (1.2e/1.4 rows) — do NOT duplicate. Update STALE `.env.example` (missing `R2_*`, `RESEND_*`, `GEMINI_*`). Note `storage_limit_bytes` default seed.

### Review Findings

_Code review 2026-07-30 (`/bmad-code-review 4-4a`, **Chunk 1 — upload hardening**; adversarial Blind Hunter + Edge Case Hunter + Acceptance Auditor, different LLM). Build + vet green. Chunk 2 (Knowledge Hub domain + storage quota) is a separate follow-up run._

**Decision needed:**

- [x] [Review][Decision] **Layer-4 authoritative size guard is knowledge-only.** Non-knowledge features (`speaking`/`imports`/`avatars`, incl. AC6 Listening-audio 100 MB) have only the bypassable advisory presign 413; confirm just HeadObjects + echoes metadata and never re-checks `meta.Size`. [upload_handler.go:130,212] **RESOLVED 2026-07-30 (Ducdo): accepted as ratified scope** — non-knowledge caps were never authoritative pre-4-4a and these features don't create a Hub `files` row or touch quota. Completion-notes wording tightened to scope "authoritative" to `knowledge`.

**Patch:**

- [x] [Review][Patch] Presign accepts negative `sizeBytes` [upload_handler.go:100] — **FIXED**: added a `sizeBytes >= 0` field validation (0/absent still = "unknown" for 1.2e/2.7 back-compat) so a negative can't defeat the layer-2 413 gate or underflow the advisory storage pre-check.
- [x] [Review][Patch] slog redactor covers attribute values only, not the record message [logging/redact.go] — **FIXED**: wrapped the JSON handler in a `redactingHandler` whose `Handle` runs `redactPattern` over `r.Message` (with `WithAttrs`/`WithGroup` re-wrap so derived loggers keep the guard).
- [x] [Review][Patch] Redactor pattern omits `X-Amz-Credential`/`X-Amz-Security-Token` [logging/redact.go] — **FIXED**: both added to the alternation so a bare credential fragment (access-key ID / session token) is redacted even without the host/signature.

**Dismissed as noise (3):** extension-keyed caps ignore `feature` (documented by-design — one ext → one cap); knowledge confirm falls back to metadata-echo when `h.Files==nil` (production always wires `Files` via `NewUploadHandler`); object-key `../` passes the prefix guard (unreachable — keys are server-generated at presign and R2 uses literal keys).

**Carried to Chunk 2 review (`file_service.go` — not triaged here):** confirm content-type compare is exact + case-sensitive (parameterized/differently-cased MIME → 422 + deletes a valid object); `HeadObject` `(nil,nil)` → nil-deref panic; `ConfirmUpload` skips `validateName` (RenameMoveFile validates); idempotent replay after object deletion returns 502 not the existing row (HeadObject precedes the idempotency lookup); zero-byte object accepted. → **all triaged in Chunk 2 below.**

#### Chunk 2 — Knowledge Hub domain + storage quota

_Code review 2026-07-30 (`/bmad-code-review 4-4a`, **Chunk 2**; same 3-layer adversarial pass). RLS 4-policy FORCE, AC12 serialized ceiling, AC13 linked-locations (no view-rate), and deferred-item absence all verified SATISFIED._

**Decision needed:**

- [x] [Review][Decision] **Folder soft-delete has no cascade/guard — orphaned quota-consuming contents + latent cycle-guard bypass.** `SoftDeleteFolder` stamps only the one folder row [folders.sql:47]; its files/subfolders keep `deleted_at IS NULL`, so they still count in `SumFileSizeByCenter`, still list, and point at an invisible parent. Worse, `FolderAncestorIDs` filters `deleted_at IS NULL` in both arms [folders.sql:65,70], so a live descendant chain through a soft-deleted mid-chain folder truncates the ancestor walk → the move cycle-guard misses a real ancestor and can write a physical `parent_folder_id` cycle [file_service.go RenameMoveFolder]; a later restore then makes the CTE non-terminating. **RESOLVED 2026-07-30 (Ducdo): option (b) — cascade soft-delete to the whole subtree (folders + files) + free quota, in one tx** → becomes patch below. This also fixes the cycle-bypass with no CTE change: a live folder can no longer have a soft-deleted ancestor, so the `deleted_at` filter in `FolderAncestorIDs` is safe.

**Patch:**

- [x] [Review][Patch] **[FIXED]** Folder soft-delete must cascade (D2 resolution) [file_service.go SoftDeleteFolder + folders.sql] — soft-delete the entire subtree (descendant folders + their files) in one tenant tx so quota is freed and no live folder retains a soft-deleted ancestor. Add a recursive descendant query + subtree soft-delete; keep it inside `mutateInTenantTx`.

- [x] [Review][Patch] **[FIXED]** `ConfirmUpload` skips folder existence/tenant validation [file_service.go ConfirmUpload] — no `assertFolderExists` (unlike RenameMoveFile/CreateFolder); a non-existent `folderId` → wrapped 500, and a cross-tenant `folderId` satisfies the global FK (FK bypasses RLS; `files_insert` WITH CHECK only validates `center_id`) → a file row can point at another center's folder. Add `assertFolderExists` before insert.
- [x] [Review][Patch] **[FIXED]** `ConfirmUpload` skips `validateName` [file_service.go ConfirmUpload] — only `TrimSpace`+default; `files.name` is unbounded `text`, so an over-length/control-char name bypasses the 200-rune rule enforced on rename/create. Add `validateName`.
- [x] [Review][Patch] **[FIXED]** Down migration re-adds `kind` CHECK before handling `file` rows [down.sql:8,10] — `ADD CONSTRAINT CHECK (kind IN ('link'))` validates existing rows and errors on any `kind='file'` row. Delete/convert `kind='file'` rows (and drop `file_id`) before re-adding the constraint.
- [x] [Review][Patch] **[FIXED]** Confirm content-type compare is exact + case/parameter-sensitive → deletes a valid object [file_service.go:226] — `meta.ContentType != expectedMIME` 422s + best-effort-deletes a legitimately-uploaded object on `Application/PDF` or `application/pdf; charset=…`. Use `mime.ParseMediaType` + case-fold before comparing.
- [x] [Review][Patch] **[FIXED]** `HeadObject` `(nil,nil)` → nil-deref panic [file_service.go:215] — only `err` is guarded; a `meta==nil,err==nil` return panics at `meta.Size`. Add `|| meta == nil` → `UploadVerificationFailedError`.
- [x] [Review][Patch] **[FIXED]** Idempotency short-circuit runs AFTER HeadObject re-validation (object-gone replay fixed; soft-deleted-row replay left as a known low edge) [file_service.go:215 vs :265] — a retried confirm whose object was reaped/transient-errored returns 502/413/422 instead of the already-persisted row (AC4). Check `(center_id, object_key)` before HeadObject; return the existing non-deleted row (don't surface a soft-deleted row as success).
- [x] [Review][Patch] **[FIXED]** Confirm doesn't re-reject non-allowlisted extensions [file_service.go:220,226] — an ext outside `AllowedExtensions` skips both the size cap and the content-type check (and `used+meta.Size` could int64-overflow), storing an uncapped object. Server-generated keys make it near-unreachable, but add a defense-in-depth allowlist re-check (the path the code claims is authoritative).

**Defer (logged as follow-up in deferred-work.md):**

- [x] [Review][Defer] Move depth guard ignores the moved subtree's own height [file_service.go RenameMoveFolder] — checks only the moved folder's new depth, so descendants can exceed `maxFolderDepth=10`. Termination is still guaranteed by the cycle guard and `maxFolderDepth` is a non-AC UX ceiling → low, logged for follow-up.
- [x] [Review][Defer] Slug unique-violation → 500 instead of retry [file_service.go InsertFileIdempotent] — `ON CONFLICT` targets `(center_id, object_key)` only; a `(center_id, slug)` collision (32-bit suffix, negligible probability) raises 23505 → 500. Logged for a future retry-with-fresh-slug.

**Dismissed as noise (4):** `validateName` accepts control/bidi chars (v1 input-hygiene, no AC); zero-byte object accepted (no min-size AC); advisory-lock hash collision across centers (not a correctness issue — still exactly-once per center); `requireOwnerTenant` naming (verified: only asserts a populated tenant; the real gate is service-side `assertClassRole` owner/admin/teacher).

## Dev Notes

### Party-mode findings folded in (2026-07-30)
- **[Winston/Murat — highest severity] Quota is a TOCTOU race if checked at presign.** Bytes don't exist until confirm; presign-time `SUM` lets N concurrent uploads all read headroom and blow past the cap (free tier = revenue leak). Enforcement lives at **confirm-in-transaction with a per-center lock** (AC12/T4). Presign check is UX only.
- **[Winston] `Presign` positional `maxBytes` is a footgun** — a sentinel in a security param silently disables layer 3. Options struct, `MaxBytes` non-optional for PUT (T3).
- **[Winston] Don't assume R2 honors `Content-Length-Range` on PUT** — spike it (T3a); layer 4 is the backstop.
- **[Winston] Folder cycle/depth** — the recursive tree render must terminate; guard at move (AC2).
- **[Winston] Linked-locations resolver pinned** — FK for `session_materials`, GIN-indexed JSONB for exercise audio; exclude soft-deleted on either end (AC13).
- **[Murat] Delete-on-mismatch + confirm idempotency + HeadObject-transport-error** are idempotency/failure contracts, now explicit (AC9/AC4).
- **[John] Scope trimmed** — single `storage_limit_bytes` (not a 3-tier enum nobody can set to non-free before Epic 9); overflow ladder + abuse + file_views deferred.

### A9 caps are named constants (CQ-3)
e.g. `const knowledgePDFMaxBytes = 50 * 1024 * 1024`. Document MB vs MiB (500 MiB ceiling = 524288000).

### Presign drift
1.2e's original AC said 15-min; A10 locked 5 min; code already ships 5 min (`:109`) — don't regress.

### `storage_limit_bytes` is READ-ONLY in this story
Seeded to the free cap; nothing in 4.4a writes it. Epic 9 introduces the real plan model and the write path. Do NOT build a plan-change endpoint here.

### WF-8 / ATDD
A9/A10 are security-and-money ACs → ATDD applies. **Green-light red tests now** for: slog redaction (clear oracle), presign expiry, content-type lock, `R2_KEY_PREFIX_MISMATCH` audit+403. These are well-specified. The quota-concurrency, delete-on-mismatch, and idempotency contracts are now specified above (they weren't at first draft) → their red tests are also unblocked. Backend rules: GO-1/2/3/5, GFW-3/5, RLS 4-policy per new table, never `DISABLE ROW LEVEL SECURITY`.

### ATDD Artifacts (Murat / bmad-tea AT, 2026-07-30)
Red-phase scaffolds generated before dev. **1 active** (fails now) + **7 build-excluded** `_`-prefixed (drop the `_` per task).
- Checklist + AC coverage + activation order: `_bmad-output/test-artifacts/atdd-checklist-4-4a-knowledge-hub-apis-and-upload-hardening.md`
- ACTIVE canary (keep green at DoD): `classlite-api/internal/handler/upload_presign_size_atdd_test.go` (AC6/AC7-L2)
- Build-excluded scaffolds: `handler/_upload_confirm_hardening_atdd_test.go` (AC4/AC9/AC9a) · `handler/_upload_slog_redaction_atdd_test.go` (AC10/AC11) · `handler/_knowledge_hub_handler_atdd_test.go` (AC2/AC3/AC12/AC13) · `test/_files_rls_test.go` (AC1/AC3) · `test/_folders_rls_test.go` (AC1/AC2) · `test/_storage_quota_race_test.go` (AC12 — **SetupRawPool, not SetupDB**) · `test/_presign_content_length_range_atdd_test.go` (AC7-L3, **spike-gated on T3a — activate or delete**)
- Dev decisions flagged: `maxFolderDepth` value not pinned; folder-cycle error code + HeadObject-transport HTTP status are placeholders — confirm in T7 `api.yaml`.

### References
- Epic `epics/epic-04.md#Story 4.4` (127-165); A9/A10 `test-artifacts/test-design/blocker-resolutions-2026-06-04.md`; FR-54/55/61 `prds/.../prd.md`; Architecture `architecture.md` §File Storage (155-166) §File Upload Flow (467-471); deferred `implementation-artifacts/deferred-work.md` (FU-4-2-A, FU-3-5-C, 1.2e `/confirm` size-validation, **new FU-4-4-* trim deferrals**); rules `docs/project-context.md`; conventions `docs/bmad-story-conventions.md`.

## Definition of Done

- AC1-AC13 met and end-to-end exercised against the R2 mock (`verify` the presign→confirm→create + the quota-block path — not just unit asserts).
- `go test ./...` green (new RLS + concurrency + delete-on-mismatch + idempotency + cycle-guard + slog capture); `go vet`, `gofmt` clean; `codegen.sh` synced (api.yaml ↔ generated ↔ `classlite-web/src/lib/api/client.ts` for 4.4b).
- Migration up+down verified on fresh DB; RLS proven on `files`/`folders`.
- T3a spike resolved (layer 3 wired OR dropped-with-rationale); A9 layers demonstrable; A10 slog redaction proven by capture test.
- WF-6: consider all three CI pipelines for the shared `api.yaml`/generated change.
- Dev Agent Record + File List in the sibling completion-notes.

## Out of Scope (deferred — see deferred-work.md FU-4-4-*)

- 80% / 95% storage warnings + 95% owner email → **Epic 9**.
- `>100 GB / 24 h` abuse alert → **Epic 9** (for now: block + log at 100%).
- `file_views` table + "X of N students viewed" → **analytics epic**.
- Three-tier `plan_tier` model + plan changes/purchase UI → **Epic 9** (owns the real billing model; backfills `storage_limit_bytes`).
- All frontend → **4.4b**. Global ⌘K search (FR-67); Archive s28; hard-purge reaper (orphan-object sweep is a natural home for it later); per-file sharing; dedup table (A10 telemetry-only v1).

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-07-29 | Split from Story 4.4 (Ducdo confirmed) into backend half. | Amelia |
| 2026-07-30 | **Party-mode review + amended.** Ducdo ratified pragmatic-trim + 4 correctness bundles: (1) quota enforced at confirm-in-tx w/ per-center advisory lock (was presign TOCTOU); (2) `Presign`→options-struct w/ non-optional MaxBytes + R2 Content-Length-Range spike (T3a); (3) folder cycle/depth guard + linked-locations resolver pinned (FK + GIN); (4) confirm idempotency + delete-on-mismatch/orphan/HeadObject-transport contracts. Trimmed: `plan_tier` 3-tier → single `storage_limit_bytes`; 80/95%/owner-email/abuse-alert + `file_views`/X-of-N deferred to Epic 9 / analytics. Retitled "Core". | Amelia |
| 2026-07-30 | **Green-phase complete** via `/bmad-dev-story 4-4a` (Amelia). `in-progress → review`. All T1–T9 shipped, AC1–AC13 met. Migration `20260730120000_create_knowledge_hub` (files/folders 4-policy FORCE RLS + GIN `content jsonb_path_ops` + `centers.storage_limit_bytes` 524288000 default + `session_materials.file_id`/`kind='file'`, up+down verified). sqlc files/folders queries (recursive-CTE ancestor walk for cycle/depth — reshaped for sqlc analyzer). `FileService` (confirm-in-tx per-center `pg_advisory_xact_lock` ceiling, `(center_id,object_key)` idempotency, HeadObject re-validate + delete-on-mismatch + fail-closed + `orphaned_object` telemetry, folder cycle/depth guard, linked-locations FK+GIN resolver). Hardened `upload_handler` (presign A9 layer-2 413 + advisory 409; confirm prefix-guard 403+audit → confirm-create). `logging.NewRedactingJSONHandler` (A10) wired process-wide. api.yaml + client.ts synced. **T3a SPIKE outcome (B): R2 does NOT enforce Content-Length-Range on presigned PUT (POST-policy-only) → layer 3 DROPPED, layer-4 confirm HeadObject is authoritative; no MaxBytes presign param (would be a silent-unbounded footgun). Spike-gated test deleted, not skipped.** `maxFolderDepth=10` pinned. Uploads now authenticated (were unauthenticated in 1.2e). `go build`/`go vet ./...`/`gofmt`/`go test ./...` all green (RLS 6-grid ×2, quota concurrency race on SetupRawPool, delete-on-mismatch matrix, idempotency, cycle+depth guard, slog capture, file-detail FK+GIN links). Dev Agent Record + File List in the sibling completion-notes. | Amelia |
