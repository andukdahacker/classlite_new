# Story 4.4b: Completion Notes

_Implementation record for [`4-4b-knowledge-hub-ui-and-file-picker.md`](./4-4b-knowledge-hub-ui-and-file-picker.md). Status: review._

## Dev Agent Record

### Debug Log

- **Cross-story gap #1 (RESOLVED, ratified by Ducdo): no frontend-readable file URL.** AC5 previews + downloads need a readable URL for a private R2 object, but 4.4a's `StorageService` only exposed `Presign` (PUT), `HeadObject`, server-side `GetObject`, and `Delete` — no presigned GET, no public bucket base, no `VITE_` asset env. Surfaced as a decision; Ducdo chose **add a signed-GET download endpoint** (keeps R2 private, key stays the boundary). Implemented `GET /api/knowledge-hub/files/{slug}/download` → `{ url }` (5-min presigned GET, resolved by slug under tenant RLS, SEC-8 key-prefix re-asserted). WF-1 followed: api.yaml → codegen → `PresignGet` on `StorageService`/R2/mock → `FileService.GetFileDownloadURL` → handler → route (main.go + the test harness's bare mux). Go build/vet/`go test ./internal/service/... ./internal/handler/...` all green (incl. 2 new handler tests: presigned-GET happy path + 404 unknown slug).
- **Cross-story gap #2 (DEFERRED — AC6b not met): materials picker is contract-blocked.** `CreateSessionMaterialRequest` is link-only (`title` + `url`, `url` must be absolute http/https). 4.4a added the `session_materials.file_id` column + `kind='file'` CHECK at the DB layer but did NOT extend the create API surface to accept a file reference. So the materials seam (session `MaterialsSection` + class `MaterialsTab`) cannot create a `kind='file'` material from the picker without an api.yaml + handler change in the session-detail/materials domain. Logged as follow-up FU-4-4-7. The reusable picker itself is built and ready to wire the moment that contract lands.
- **AC6a exercise-audio seam is a partial (client string-write; linked-location caveat).** Per AC6a ("writes the picked file's key/URL into the audio string ... pure client string-write") the seam writes the picked file's **object key** into `section.content` and suppresses the "invalid URL" state for a Knowledge Hub key. BUT 4.4a's AC13 exercise-audio linked-location resolver matches `sections[].knowledgeFileId` (a JSONB field), not the `content` string — so the "Used in EX-…" back-link for an audio file will NOT populate until the exercise content model carries a `knowledgeFileId` field (a 4.2 content-contract change: `editorTypes` + Go `ValidateExerciseContent` + autosave). Logged as follow-up FU-4-4-8. The picker + string-write work today; the link resolution is the deferred half.
- **IDE incremental diagnostics were noisy false positives** (`Cannot find module '@/…'`, `React refers to a UMD global`) on every new file. Real `tsc --noEmit -p tsconfig.app.json` was clean throughout — trusted that over the incremental checker.
- **MSW intercepts the XHR R2 PUT** in jsdom, so the upload phase-machine test drives presign → PUT → confirm end-to-end (including the server-reject-after-client-ok and confirm-502 cases) without a real network.

### Completion Notes

Shipped the Knowledge Hub frontend end-to-end **plus** the ratified backend download endpoint:

- **T1 Routes** — `/knowledge-hub` (index) + `/knowledge-hub/files/:slug` mirror the `/exercises` gate (owner/admin/teacher; deep imports → dedicated Rolldown chunks). Dead-link stubs removed: the sidebar already pointed at `/knowledge-hub` (now live); the dashboard `addResources` checklist item graduated to `targetShipped: true`.
- **T2 Feature folder** — `api/` (TS-3 `knowledgeHubKeys`, folders/files optimistic-triple hooks mirroring `makeContentHooks` but bespoke for the KH URLs, detail/usage/download queries, upload primitives), `lib/` (hand-written Zod schemas + caps mirroring the server, fileKind, folderTree, size/date formatters, error-copy resolvers), `components/`, and the two pages.
- **T3 Upload phase-machine** — client A9 layer-1 pre-check → presign → XHR PUT (progress) → confirm→create. The page owns the machine; "Finalizing…" caps the bar so 100% never reads as success; retry re-runs from presign without re-selecting; a server reject reuses the SAME copy as the client (`uploadErrorCopy` is the single source).
- **T4 File detail + preview** — all AC5 fallbacks: SVG via `<img>` (non-executing, stored-XSS guard), WebM `canPlayType` → download fallback, desktop `<embed>` vs mobile Open for PDF, universal "Preview unavailable" error leg; metadata (TS-6 local-date formatter); linked-locations list. No view-rate.
- **T5 Picker** — ONE reusable `KnowledgeHubPicker` with the required `mode` contract `{ allowedTypes, selection, confirmVerbKey, emptyKey, onConfirm }`. Placed feature-local + barrel-exported (TS-7) rather than `domain/` because it depends on the KH data hooks and `domain/` forbids feature imports (FW-7). Seams: (a) exercise audio — wired, partial (see above); (b) materials — deferred (contract gap); (c) AI "Use as topic" — wired, seeds the free-text topic, file NOT attached.
- **T6 Storage tab** — Settings → Storage read-only meter + role-split 100% state (owner upgrade CTA vs member ask-owner). 80/95% ladder deferred per the party-mode trim.
- **T7 i18n** — `knowledgeHub.*` + `storage.*` + `settings.tabs.storage` + `app.permissionDenied.section.knowledgeHub.header` in en + vi. Interpolated-number strings (storage usage, `FILE_TOO_LARGE` cap, delete title, select aria) got Vietnamese word-order review; parity test green.
- **T8 Tests** — 32 new FE tests (page trilogy + empty states + role-gate; upload same-copy/role-split/retry/502; detail + SVG-sandbox + webm + unavailable; picker mode-contract; storage role-negative) + 2 backend handler tests. All at the MSW HTTP boundary (never mock Query); axe on hub/detail/picker/storage.

**Deviations / partials vs the spec:**
- AC6b (materials seam) — **NOT met**, contract-blocked (FU-4-4-7).
- AC6a (exercise-audio linked-location) — **partial**, string-write only (FU-4-4-8).
- Backend endpoint added to a "frontend" story — ratified pragmatic amendment (Ducdo).

### Implementation Plan (as executed)

1. Pre-flight: read every named reuse artifact + the 4.4a API contract + generated client.
2. Surfaced the download-URL gap → Ducdo ratified the signed-GET endpoint → built it API-first (WF-1) with tests.
3. Built the FE foundation (lib + api), then upload dialog, browser page, detail + preview, picker, storage tab.
4. Wired routes, settings tab, dead-link graduation; added en/vi i18n.
5. Wired seams (c) + (a); identified (b) as contract-blocked → deferred.
6. Wrote 32 FE tests; ran full suite (2044 pass), tsc, eslint, i18n-parity, build.

## File List

### Added — frontend
- `classlite-web/src/features/knowledge-hub/KnowledgeHubPage.tsx`
- `classlite-web/src/features/knowledge-hub/KnowledgeFileDetailPage.tsx`
- `classlite-web/src/features/knowledge-hub/index.ts`
- `classlite-web/src/features/knowledge-hub/api/knowledgeHubKeys.ts`
- `classlite-web/src/features/knowledge-hub/api/foldersApi.ts`
- `classlite-web/src/features/knowledge-hub/api/filesApi.ts`
- `classlite-web/src/features/knowledge-hub/api/useFileDetail.ts`
- `classlite-web/src/features/knowledge-hub/api/useStorageUsage.ts`
- `classlite-web/src/features/knowledge-hub/api/useFileDownloadUrl.ts`
- `classlite-web/src/features/knowledge-hub/api/uploadKnowledgeFile.ts`
- `classlite-web/src/features/knowledge-hub/lib/fileKind.ts`
- `classlite-web/src/features/knowledge-hub/lib/knowledgeHubSchemas.ts`
- `classlite-web/src/features/knowledge-hub/lib/folderTree.ts`
- `classlite-web/src/features/knowledge-hub/lib/formatFileSize.ts`
- `classlite-web/src/features/knowledge-hub/lib/formatFileDate.ts`
- `classlite-web/src/features/knowledge-hub/lib/uploadErrorCopy.ts`
- `classlite-web/src/features/knowledge-hub/lib/storageCopy.ts`
- `classlite-web/src/features/knowledge-hub/components/UploadDialog.tsx`
- `classlite-web/src/features/knowledge-hub/components/RenameDialog.tsx`
- `classlite-web/src/features/knowledge-hub/components/MoveDialog.tsx`
- `classlite-web/src/features/knowledge-hub/components/ConfirmDeleteDialog.tsx`
- `classlite-web/src/features/knowledge-hub/components/FilePreview.tsx`
- `classlite-web/src/features/knowledge-hub/components/KnowledgeHubPicker.tsx`
- `classlite-web/src/features/settings/StorageTab.tsx`
- `classlite-web/src/features/knowledge-hub/__tests__/harness.tsx`
- `classlite-web/src/features/knowledge-hub/__tests__/KnowledgeHubPage.test.tsx`
- `classlite-web/src/features/knowledge-hub/__tests__/UploadDialog.test.tsx`
- `classlite-web/src/features/knowledge-hub/__tests__/KnowledgeFileDetailPage.test.tsx`
- `classlite-web/src/features/knowledge-hub/__tests__/KnowledgeHubPicker.test.tsx`
- `classlite-web/src/features/settings/__tests__/StorageTab.test.tsx`

### Modified — frontend
- `classlite-web/src/routes.tsx` — `/knowledge-hub` routes (gated, lazy chunks)
- `classlite-web/src/components/shared/PermissionDenied.tsx` — `knowledgeHub` SectionNameKey
- `classlite-web/src/features/settings/SettingsPage.tsx` + `hooks/useSettingsTab.ts` — Storage tab
- `classlite-web/src/features/dashboard/lib/checklistDefinition.ts` — `addResources` → `targetShipped: true`
- `classlite-web/src/features/exercises/components/editor/ExerciseSectionCard.tsx` — audio "From Knowledge Hub" picker seam (a)
- `classlite-web/src/features/exercises/AIGenerateDialog.tsx` — "Use as topic" picker seam (c)
- `classlite-web/src/locales/en.json`, `vi.json` — knowledgeHub/storage/settings keys
- `classlite-web/src/lib/api/client.ts` — regenerated (DownloadUrl + getFileDownloadUrl)

### Added / Modified — backend (ratified download endpoint)
- `classlite-api/api.yaml` — `GET /api/knowledge-hub/files/{slug}/download` + `DownloadUrl`/`EnvelopeDownloadUrl`
- `classlite-api/internal/service/storage.go`, `storage_r2.go`, `storage_mock.go` — `PresignGet`
- `classlite-api/internal/service/file_service.go` — `GetFileDownloadURL` (slug → prefix-guard → presign GET)
- `classlite-api/internal/handler/knowledge_hub_handler.go` — `DownloadFile`
- `classlite-api/cmd/api/main.go` + `internal/test/story_4_4_helpers.go` — route registration
- `classlite-api/internal/handler/knowledge_hub_handler_atdd_test.go` — 2 download tests

## Follow-ups logged (deferred-work.md)
- **FU-4-4-7** — Materials picker seam (AC6b): extend `CreateSessionMaterialRequest` with `fileId` + `kind='file'` (api.yaml + handler + tests), then wire the already-built picker into `MaterialsSection` + `MaterialsTab`.
- **FU-4-4-8** — Exercise-audio linked-location (AC6a full): add `knowledgeFileId` to the exercise content model so 4.4a's AC13 resolver populates the "Used in EX-…" back-link for audio files.
