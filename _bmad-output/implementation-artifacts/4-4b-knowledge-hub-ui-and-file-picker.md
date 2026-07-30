# Story 4.4b: Knowledge Hub UI & File Picker (Frontend)

Status: done

<!--
baseline_commit: 03025ebf106fe1a3f92aa644e6e59ee2d4d29143
epic: 4 — Exercise Authoring, AI Content Generation & Knowledge Hub
story_key: 4-4b-knowledge-hub-ui-and-file-picker
size: M-L (frontend half of the split 4.4)
dependencies: 4.4a (endpoints + regenerated client.ts) — HARD BLOCK; 4.1/4.2 (exercise editor — BUILT), 3.5 (session materials — BUILT)
completion_notes_sibling: 4-4b-...-completion-notes.md (created at first dev pickup)
amended: 2026-07-30 party-mode review (Winston/Murat/Sally/John); Ducdo ratified pragmatic-trim + upload-UX/SVG/preview/picker-mode bundle
-->

## Story

As a teacher,
I want a Knowledge Hub UI to browse folders, upload files (with honest progress + failure states), preview file detail, and a "From Knowledge Hub" picker in exercises and materials,
so that I can organize and reuse my teaching files without leaving my workflow.

> **HARD BLOCK:** depends on 4.4a's endpoints and the regenerated `src/lib/api/client.ts`. Do not start until 4.4a is `review`/`done` and codegen is synced.

## Scope after party-mode trim (READ FIRST)

Party-mode (2026-07-30) trimmed the storage-overflow ladder + analytics (see 4.4a). Frontend consequences:
- **Settings → Storage tab: reduced to a read-only usage display** (`usedBytes / limitBytes` from `GET /api/storage/usage`) + the **100% "Storage full" state**. The **80% / 95% warning ladder is DEFERRED** (Epic 9).
- **File detail ships WITHOUT "X of N students viewed"** (deferred to analytics epic). No view-recording on the frontend.
- **Kept + hardened** (Sally's bundle): upload-failure UX, SVG/preview fallbacks, the storage-full state surfaced **at the upload seam** with role-split copy, and a picker `mode` contract.

## Context & Reuse Map (read before touching anything)

| Concern | Status | Location |
|---|---|---|
| FE presign→PUT→confirm client | **BUILT** | `src/features/people/api/useUploadImportFile.ts` (XHR PUT for progress + `no-restricted-globals` compliance; plain async fn so the page owns the phase machine) |
| Optimistic-CRUD factory | **BUILT** | `src/features/session-detail/api/sessionContentApi.ts` (`makeContentHooks` — cancel+snapshot+patch→rollback→invalidate, FW-2) |
| Trilogy wrapper (loading/empty/error) | **BUILT** | `src/features/session-detail/components/ContentSectionFrame.tsx` |
| Two-empty-state pattern | **BUILT** | `src/features/exercises/ExerciseLibraryPage.tsx` (`TrueEmptyHero` vs `FilteredEmpty`) |
| Route shape to mirror | **BUILT** | `/exercises` group `src/routes.tsx:289-331` (`RouteRoleGate`, index + `:slug`, deep-import per Rolldown chunk) |
| `/knowledge-hub` sidebar + dashboard-checklist links | **BUILT (dead-link stubs)** | `sidebarNavConfig.tsx:48,70,87`, `dashboard/lib/checklistDefinition.ts:150-152`, `DeadLinkTrigger.tsx:7` |
| Query-key factory pattern | **BUILT** | `src/features/exercises/api/exercisesKeys.ts:19-34` (TS-3) |
| `apiFetch` (envelope unwrap, Bearer, 401 refresh) | **BUILT** | `src/lib/api-fetch.ts`; `apiFetchWithMeta` for paginated |
| Role hook / gate | **BUILT** | `useRole()` / `RoleGate` (UX-3) |
| Settings tab pattern | **BUILT** | `src/features/settings/` (`ProfileTab`, `RoomsTab`, `useSettingsTab`) |
| i18n en/vi + parity test | **BUILT** | `src/locales/en.json`, `vi.json` (flat dot-notation); `src/lib/test/__tests__/i18n-parity-coverage.test.ts` |

| Integration seam (currently a stub) | Location | Backend audit (Winston) |
|---|---|---|
| Exercise editor Listening audio field | `ExerciseSectionCard.tsx:9-11,154-163` | **No backend work** — writes the picked file's key/URL into the audio string via the existing 4.2 exercise-autosave PATCH |
| Class materials (`ComingSoonPanel`) + session materials | `classes/tabs/MaterialsTab.tsx`, `session-detail/components/MaterialsSection.tsx:52-70` | **Needs 4.4a** `session_materials.file_id` + `kind='file'` (in 4.4a-core) |
| AI dialog topic seed | `exercises/AIGenerateDialog.tsx` — `SectionForm` | **No backend work** — seeds the free-text topic client-side (FU-4-3-B-1) |

## Acceptance Criteria

- **AC1** Given a teacher navigates to `/knowledge-hub`, When the page loads, Then a folder-based browser (folder tree/breadcrumb + tile grid, type-tinted icons, tags, "Used in EX-…" back-links) renders with the Loading/Empty/Error trilogy (UX-1). Empty distinguishes true-empty (warm first-run CTA) from filtered-empty. Route-gated owner/admin/teacher.
- **AC2** Given the browser, When a teacher creates/renames/moves/deletes a folder or renames/moves/deletes a file, Then the UI updates via the optimistic triple (FW-2) against 4.4a endpoints. Folder-move that 4.4a rejects as a cycle (422) rolls back with a human message. Delete is soft (row retained server-side); the UI removes it (undo-toast per 3.5 precedent optional).
- **AC3** Given upload, When the teacher picks a file, Then: **(layer-1)** client size pre-check rejects oversized files immediately with i18n `FILE_TOO_LARGE` incl. the cap in MB → `presign(sizeBytes)` → XHR PUT to R2 (progress bar) → `confirm` → create-file. Reuse `useUploadImportFile.ts`; feature `'knowledge'`; only PDF/PNG/JPG/SVG/MP3/WAV/WebM selectable.
- **AC4 (upload-failure UX — Sally)** Given the upload can fail after the client said "ok", Then each stage has a distinct human message (never a raw HTTP code): **presign fail**, **transfer fail mid-PUT**, **confirm/server-reject fail**. Specifically: **(a)** the progress bar's final segment reads **"Finalizing…"** (the confirm step) so 100% fill never reads as success — success is the tile appearing in the grid; **(b)** a **server-side rejection uses the SAME copy as the client** (`FILE_TOO_LARGE` w/ cap, or `STORAGE_FULL`) — the user must not be able to tell client-catch from server-catch; **(c)** **Retry without re-selecting the file** on transfer failure; **(d)** "survives interruption" is defined for v1 as **re-PUT from zero** (not resumable multipart) — state it in the UI copy ("Resuming upload…" is not promised).
- **AC5 (file detail)** Given `/knowledge-hub/files/{slug}`, Then it shows type-specific **preview**, **metadata** (type, size, upload date via TS-6 i18n date formatter), and **linked locations** (exercises/sessions). **No view-rate (deferred).** Preview fallbacks are mandatory: **(a)** **SVG rendered sandboxed / non-executing** (never inline `<svg>` injection — stored-XSS guard; coordinate with any 4.4a sanitization); **(b)** WebM audio → "Download to play" fallback where the browser can't decode; **(c)** PDF on mobile (the responsive-fallback surface) → first-page thumbnail + Open, not an inline paged viewer; **(d)** a universal **"Preview unavailable — Download to view"** state (the Error leg of the trilogy on the preview pane) whenever a preview can't render, with metadata still shown.
- **AC6 (picker `mode` contract — Sally)** Given the "From Knowledge Hub" picker, Then it is ONE reusable browse-select dialog with a required `mode` prop `{ allowedTypes, selection: 'single'|'multi', confirmVerb, onConfirm }` and a per-seam empty state. Integrations: **(a)** `ExerciseSectionCard.tsx` audio field — `allowedTypes: audio`, single, verb "Insert audio", replaces the "coming soon" stub; **(b)** `MaterialsSection.tsx` + `MaterialsTab.tsx` — multi-select multi-type, verb "Attach", `ComingSoonPanel` → real list (uses `kind='file'` from 4.4a); **(c)** `AIGenerateDialog` `SectionForm` — single, verb **"Use as topic"** (seeds the free-text topic; the file is NOT attached to the exercise — the verb must telegraph this), FU-4-3-B-1.
- **AC7 (storage-full at the seam — Sally)** Given the storage ceiling, When the teacher opens the upload dialog at 100%, Then the dialog leads with the **`STORAGE_FULL`** message and does not let them pick a file. Copy is **role-split** (UX-3): owner sees the upgrade CTA ("Delete files or upgrade to Studio"); a teacher who cannot upgrade sees "Storage is full — ask your center owner to free up space." The Settings → Storage tab shows the read-only usage meter + the same 100% state. (80%/95% inline warnings deferred.)
- **AC8 (i18n)** Given UX-2, Then all new `knowledgeHub.*` and `storage.*` keys exist in BOTH `en.json` and `vi.json`, pluralized where needed. **Every interpolated-number string** (FILE_TOO_LARGE cap, progress stage labels, storage usage) gets a **Vietnamese word-order review** (not machine order), and every **constrained container** (back-link chips, storage banner, progress labels, buttons) gets a vi.json overflow check before dev-complete. i18n-parity test stays green.

## Tasks / Subtasks

- [x] **T1 — Routes** (AC1, AC5): `/knowledge-hub` (index) + `/knowledge-hub/files/:slug` added to `src/routes.tsx`, mirroring `/exercises`; deep-import per Rolldown chunk (verified: `KnowledgeHubPage-*.js` isolated 27 kB). Dead-link stub removed (sidebar already live; dashboard `addResources` → `targetShipped: true`).
- [x] **T2 — `knowledge-hub` feature folder**: `api/knowledgeHubKeys.ts` (TS-3), folders/files optimistic-triple hooks (FW-2, bespoke — the KH URLs don't fit the session-scoped `makeContentHooks`), `lib/` hand-written Zod (TS-2), `components/` (folder tree, breadcrumb, tile grid, upload dialog, detail preview, picker), trilogy + two empty states.
- [x] **T3 — Upload client + failure UX** (AC3, AC4): fresh XHR-PUT primitives (`uploadKnowledgeFile.ts`); client size pre-check vs per-feature caps; presign(sizeBytes)→PUT→confirm chain; page owns the phase machine with distinct presign/transfer/confirm surfaces, "Finalizing…" final segment (bar caps at 99%), retry-without-reselect, same-copy server rejection (`uploadErrorCopy` single source).
- [x] **T4 — File detail page** (AC5): type-specific preview with ALL fallbacks (SVG via `<img>` sandbox, WebM `canPlayType`→download-fallback, mobile-PDF Open vs desktop `<embed>`, universal "Preview unavailable"); metadata (TS-6 local date fmt); linked-locations list. No view recording. **Needed a new backend signed-GET download endpoint (ratified — see Change Log).**
- [x] **T5 — "From Knowledge Hub" picker** (AC6): ONE `KnowledgeHubPicker` + `mode` contract built. Seam (c) AI "Use as topic" wired; seam (a) exercise-audio wired (client string-write). **Seam (b) materials DEFERRED (FU-4-4-7) — `CreateSessionMaterialRequest` is link-only; needs the create API extended for `fileId`/`kind='file'`. AC6a linked-location is partial (FU-4-4-8).**
- [x] **T6 — Settings → Storage tab + storage-full seam** (AC7): read-only usage meter from `/api/storage/usage`; 100% state; role-split copy via `useRole()`; 100% block surfaced in the upload dialog. (No 80/95% ladder.)
- [x] **T7 — i18n** (AC8): `knowledgeHub.*` + `storage.*` + `settings.tabs.storage` en+vi; Vietnamese interpolation word-order review; parity test green (728).
- [x] **T8 — Tests**: 32 FE tests + 2 backend. Trilogy three-state per data surface (TEST-FE-2); MSW at HTTP boundary incl. presign + R2 XHR PUT + **server-reject-after-client-ok** + **confirm-502** (TEST-FE-1); role-gate absence — teacher sees ask-owner not the owner CTA, student denied (TEST-FE-6); **SVG sandbox** (rendered via `<img>`, no inline `<svg>`/`<object>`); i18n key existence both locales (TEST-FE-4); axe on hub/detail/picker/storage (TEST-FE-5). No UI store added (TEST-FE-3 N/A).

### Review Findings

#### Chunk A — Backend download endpoint (`/bmad-code-review 4-4b`, 2026-07-30, 3-layer adversarial)

- [x] [Review][Decision→Patch] Presigned GET pins no `Content-Disposition`/filename [classlite-api/internal/service/storage_r2.go:61-87] — 3-way consensus. **RESOLVED (Ducdo: harden now, disposition-param shape).** Discovered the FE shares one URL for preview (`<img>`/`<audio>`/`<embed>`) AND download (`useFileDownloadUrl.ts`, `FilePreview.tsx:143`), so forcing `attachment` on the shared URL would break the desktop-PDF `<embed>` (AC5c). **Fix:** added optional `?disposition=attachment` query param → inline default (preview) vs attachment+RFC-5987 filename (download). Threaded `PresignGetOpts{Attachment, Filename}` through `StorageService.PresignGet` (interface/R2/mock) + `GetFileDownloadURL(…, attachment bool)` + handler. api.yaml + codegen (`client.ts` `disposition?: "attachment"`). **Carry-forward → Chunk B:** the FE download `<a>` must request `?disposition=attachment`; preview keeps the plain URL.
- [x] [Review][Decision] SEC-8 prefix-mismatch on download returns 403 silently — no `R2_KEY_PREFIX_MISMATCH` audit [classlite-api/internal/service/file_service.go:492-494] — **RESOLVED (Ducdo: accept asymmetry).** The guard lives in the service layer (slug→key), where no audit logger is wired; upload's guard+audit is in the handler. Branch is RLS-unreachable in normal operation — wiring a service→audit dependency for a dead branch isn't worth it. Left as a silent 403; now covered by a test.
- [x] [Review][Patch] SEC-8 403 branch + presign-failure 500 path untested [classlite-api/internal/handler/knowledge_hub_handler_atdd_test.go] — **DONE.** Added 3 tests: `TestFileDownload_AttachmentDisposition_ForcesFilename` (D1 + inline-negative), `TestFileDownload_PresignFailure_Returns500`, `TestFileDownload_KeyPrefixMismatch_Returns403` (raw-seeded bad-prefix row → 403 `R2_KEY_PREFIX_MISMATCH`). `go build`/`vet`/`gofmt` clean; `go test ./internal/handler/ ./internal/service/` green.
- [x] [Review][Defer] No `HeadObject` existence check before signing — a DB row whose R2 object was deleted out-of-band returns 200 + a URL that 404s only in the browser [classlite-api/internal/service/file_service.go:495-498] — deferred, by-design tradeoff for presigning (blind+edge, low).

**Dismissed as noise (10):** soft-delete-still-downloadable (FALSE POSITIVE — `files.sql:53` filters `deleted_at IS NULL`); EMAIL_VERIFICATION_REQUIRED unenforced (FALSE POSITIVE — `requireVerified` is in `knowledgeChain`); codegen not in chunk (FALSE POSITIVE — `getFileDownloadUrl` present at `client.ts:8048`); UUID canonicalization raw-vs-parsed (consistent with upload path, `tc.CenterID` is the single JWT source); slug format validation (contained — query param only, Go 1.22 single-segment); bearer-less 5-min shareable URL (by-design, matches ratified contract); `uuid.Parse` → 500 (legitimate internal invariant on a validated JWT center); no rate-limiting (pre-existing across all KH endpoints, not this change); `readInTenantTx` TOCTOU (acceptable for a 5-min token); unbounded `expiry` at storage layer (YAGNI — sole caller passes a 5-min const).

#### Chunk B — Hub browser + upload/data layer (`/bmad-code-review 4-4b`, 2026-07-30, 3-layer adversarial; edge+auditor re-run after mid-response API failures)

- [x] [Review][Decision→Defer] Mobile PDF preview omits the AC5c first-page thumbnail — Open-only [components/FilePreview.tsx:2162-2172] — **RATIFIED (Ducdo): accept the Open-only trim** (thumbnail needs pdf.js, heavy, on a responsive-fallback surface). Thumbnail → deferred-work (FU-4-4-9).
- [x] [Review][Decision→Defer] Browser tiles omit AC1's "tags" + per-tile "Used in EX-…" back-links [KnowledgeHubPage.tsx:538-585] — **RATIFIED (Ducdo): accept** — `files` has no `tags` column (backend gap), back-links present on the detail page. Tile tags → deferred-work (FU-4-4-10) if wanted later.
- [x] [Review][Patch] Download `<a>` never requests `?disposition=attachment` — cross-origin inline URL (SVG opens inline, reopening the XSS the `<img>` sandbox closed) [api/useFileDownloadUrl.ts, components/FilePreview.tsx] — blind+edge+auditor (CRITICAL). **DONE.** `useFileDownloadUrl` gains a `disposition: 'inline'|'attachment'` arg (own query key); `FilePreview` fetches a second attachment-URL for the Download link (falls back to inline until it settles); preview tags keep the plain inline URL.
- [x] [Review][Patch] Disabled queries render an infinite skeleton [KnowledgeHubPage.tsx] — blind+edge. **DONE.** `isPending` now gated on `Boolean(centerId)` so a missing center reaches empty/error, not an eternal skeleton.
- [x] [Review][Patch] Optimistic `optimistic-<uuid>` folder clickable/actionable with a non-existent id [api/foldersApi.ts, KnowledgeHubPage.tsx] — blind+edge. **DONE.** Exported `isOptimisticFolderId`; `selectFolder` ignores optimistic ids and `FolderTile pending` disables open + hides actions until settle.
- [x] [Review][Patch] No media `onError` fallback for an expired/failed URL [components/FilePreview.tsx] — edge. **DONE.** `<img>`/`<audio>` get `onError` → the universal "Preview unavailable" body (metadata + download link retained).
- [x] [Review][Patch] In-flight R2 PUT never aborted on unmount [api/uploadKnowledgeFile.ts, components/UploadDialog.tsx] — blind+edge. **DONE.** `transferToStorage` takes an `AbortSignal`; `UploadDialog` holds an `AbortController` and aborts on unmount (cleanup effect) — reduces orphans ahead of the deferred FU-4-4-6 reaper.
- [x] [Review][Patch] STORAGE_FULL at the finalize seam shows generic, not role-split, copy [components/UploadDialog.tsx] — blind. **DONE.** `ErrorState` now consumes the (previously dead) `role` prop → `storageFullBodyKey(role)` at the finalize seam, matching StorageFullBlock (AC7).
- [x] [Review][Patch] `useStorageUsage` not refetched on dialog open [KnowledgeHubPage.tsx] — blind. **DONE.** `openUpload` refetches usage so the AC7 100% block reflects current headroom.
- [x] [Review][Patch] 0-byte `NaN` progress + `limitBytes<=0` full/percent disagreement [api/uploadKnowledgeFile.ts, lib/formatFileSize.ts] — edge. **DONE.** Guarded the division (`total>0 ? … : 0`); `isStorageFull` now treats `limit<=0` as full (matches `storagePercent`).
- [x] [Review][Patch] Optimistic rollback untested [api/foldersApi.ts] — blind. **DONE.** Added `__tests__/foldersApi.test.tsx` — a delayed-422 folder rename paints optimistically then rolls back to the snapshot (FW-2). Also tightened the vacuous SVG-sandbox assertion to `img.tagName === 'IMG'`.

**Chunk B gates:** `tsc --noEmit` clean, ESLint 0, **full FE suite 2071/2071** (incl. the new rollback test), `npm run build` clean (KnowledgeHubPage isolated 27.5 kB chunk). All 11 editor-surfaced TS diagnostics were LSP false-positives (tsc is clean).

**Dismissed as noise (7):** progress bar hits 100% at finalize (FALSE POSITIVE — AC4a intentionally reserves 100% for the "Finalizing…" label; transfer caps at 99%); SVG-sandbox test "asserts nothing" (PARTIAL FP — the positive `kh-preview-image` src + `object`/`embed` null checks do prove the property; only one selector line is dead, dropped while patching); `useFileDownloadUrl(slug, true)` enabled-gate inert (folded into the disposition patch); duplicated descendant-walk `descendantIds`/`descendantIdSet` (minor maintainability); `files` unmemoized while `folders` memoized (harmless); `formatFileSize` "1,024 KB" float-boundary (cosmetic, rare exact-power boundary); query-key sentinel `'__none__'` vs `''` (no-op — diverges only when queries are disabled and mutations unreachable).

#### Chunk C — Picker, integrations, settings, i18n (`/bmad-code-review 4-4b`, 2026-07-31, 3-layer adversarial)

- [x] [Review][Patch] Per-seam empty copy unreachable when a folder holds only disallowed-type files [components/KnowledgeHubPicker.tsx:106] — blind+edge (High). **DONE.** `nothingSelectable` now counts `isAllowed`-filtered files (`selectableCount`), so an audio-only picker on a PDF folder shows the empty copy, not a wall of disabled rows.
- [x] [Review][Patch] Cancel/close doesn't reset selection or folder → stale state on reopen [components/KnowledgeHubPicker.tsx] — blind+edge (High). **DONE.** New `handleOpenChange` resets `selected` + `folderId` on every close (Cancel/backdrop/confirm route through it).
- [x] [Review][Patch] Picker infinite skeleton when `centerId` is null [components/KnowledgeHubPicker.tsx:104] — blind+edge+auditor. **DONE.** `isPending` gated on `Boolean(centerId)`, mirroring the Chunk-B page fix.
- [x] [Review][Patch] `isKnowledgeAudioRef` false-positives on free-typed text containing `/knowledge/` [exercises/components/editor/ExerciseSectionCard.tsx:78-80] — blind+edge. **DONE.** Replaced the substring check with a shape regex `^[^/\s:]+\/knowledge\/[^/\s]+\.[a-z0-9]+$` (the `:` exclusion also keeps real https URLs out).
- [x] [Review][Patch] Orphaned `audioUploadComingSoon` i18n key (CQ-1) [locales/en.json, vi.json] — blind+auditor. **DONE.** Removed from both locales (grep-confirmed zero code refs).
- [x] [Review][Patch] AI "Use as topic" seeds `picked.name` with extension [exercises/AIGenerateDialog.tsx] — blind+edge. **DONE.** Strips the extension (`replace(/\.[^/.]+$/, '')`).
- [x] [Review][Patch] Redundant `kind as FileKind` cast [components/KnowledgeHubPicker.tsx:214] — blind. **DONE.** Removed.
- [x] [Review][Patch] Picker happy-path-only tests [__tests__/KnowledgeHubPicker.test.tsx] — blind (coverage). **DONE (partial).** Added 3 tests: single-select replacement (evict prior), cancel-clears-selection, and audio-only-empty-with-only-PDFs (PC1). **Minor gap noted:** no dedicated `ExerciseSectionCard` render-test for the audio-ref detection — no existing harness for that component; standing one up was disproportionate for a now regex-hardened one-liner. The picker onConfirm→objectKey wiring is exercised at the picker level.

**Chunk C gates:** `tsc --noEmit` clean, ESLint 0 errors (2 pre-existing `watch()` React-Compiler warnings, untouched), **full FE suite 2074/2074** (i18n parity green after the key removal), `npm run build` clean.

**Dismissed as noise (4):** StorageTab over-quota / `limitBytes=0` out-of-range ARIA (VERIFIED HANDLED — `storagePercent` clamps to [0,100]; `isStorageFull(limit<=0)` now true after the Chunk-B fix; trilogy present); file-kind chip renders the raw uppercase enum not an i18n value (cosmetic, `aria-hidden` so SR gets the localized label, and consistent with the shipped `FileTile` chip — a cross-feature follow-up if wanted); static dialog title ignores mode (the mode-driven confirm verb + per-seam empty already differentiate the seams); `useCenterId` subscribes to the whole query cache (the `Object.is` bail on the stable id prevents re-render churn — standard `useSyncExternalStore` pattern).

## Dev Notes

### Party-mode findings folded in (2026-07-30)
- **[Sally — top] Upload divergence UX** — a progress bar that fills then errors is a betrayal. "Finalizing…" final segment, same-copy server rejection, retry-without-reselect, defined "survives interruption" (AC4).
- **[Sally] SVG is executable markup** — sandbox/non-executing render (AC5a). Security gap in UX clothing.
- **[Sally] Preview fallbacks** — WebM decode, mobile PDF, universal "Preview unavailable" (AC5b-d).
- **[Sally] Warning where the pain is** — storage-full at the upload seam + role-split copy (AC7).
- **[Sally] Picker `mode` contract** — one dialog, three declared behaviors incl. the "Use as topic" verb (AC6).
- **[Sally] Vietnamese** — interpolated-number word-order + constrained-container overflow review (AC8).
- **[John/trim] Deferred** — Settings→Storage 80/95% ladder + owner email + "X of N viewed" out (Epic 9 / analytics).

### Patterns to mirror (do not invent)
- **Route:** `/exercises` `:289-331`. **Optimistic CRUD:** `makeContentHooks` (`sessionContentApi.ts:61`). **Trilogy:** `ContentSectionFrame`; two empty states from `ExerciseLibraryPage.tsx`. **Upload:** `useUploadImportFile.ts` (plain async fn, XHR PUT, Content-Type locked, 60s timeout). **apiFetch:** unwraps `{data}`, Bearer (TS-8), silent 401 refresh (TS-5); paginated → `apiFetchWithMeta`. **Zod hand-written per feature**; openapi-typescript = types only.

### FE rules
FW-2 optimistic triple; FW-3 explicit `staleTime`; FW-4 no `useEffect` for server state; FW-7 tiers (picker = `domain/` if reused, else feature-local); TS-2/3/6; UX-1 trilogy; UX-2 en/vi; UX-3 role rendering (storage-full copy is role-split); TEST-FE-*.
- **Mobile (UX-4):** Knowledge Hub is "mobile-triage / responsive fallback" (ux-spec §11) — read-only reading surface; 44×44 targets, ≥16px inputs, grid reflow; mobile-PDF is a degraded fallback (AC5c).

### References
- Epic `epics/epic-04.md#Story 4.4` (127-165); UX `ux-design-specification.md` §8.3 (s26/s27), §11; FR-54/55/61 `prds/.../prd.md`; deferred `implementation-artifacts/deferred-work.md` (FU-4-2-A, FU-3-5-C, FU-4-3-B-1, **FU-4-4-* trim deferrals**); rules `docs/project-context.md`; conventions `docs/bmad-story-conventions.md`.
- **Backend contract:** `4-4a-knowledge-hub-apis-and-upload-hardening.md` — endpoints, envelope shapes, `sizeBytes` presign field, `/storage/usage`, `FILE_TOO_LARGE`/`R2_KEY_PREFIX_MISMATCH`/`STORAGE_FULL` codes, confirm-failure/orphan contract.

## Definition of Done

- AC1-AC8 met and demonstrably exercised (`verify` the upload flow incl. a forced server-reject + confirm-failure via MSW).
- `tsc --noEmit` clean, ESLint 0 errors, full FE suite green (incl. SVG-sandbox + server-reject-after-ok tests), i18n en/vi parity green, `npm run build` clean (new pages isolated as Rolldown chunks).
- Trilogy on every data component + the preview pane; role-absence tests for owner-only controls; axe clean.
- Dead-link stub for `/knowledge-hub` removed; sidebar/checklist navigate to the real page.
- Dev Agent Record + File List in the sibling completion-notes.

## Out of Scope

- All backend → 4.4a. 80%/95% storage warnings + owner email, "X of N viewed" → Epic 9 / analytics (deferred). Plan upgrade/purchase UI (Epic 9) — the Storage tab only *reads* usage + shows the owner upgrade CTA copy at 100%.
- Global ⌘K search (FR-67); Archive s28; file restore UI (see 4.4a soft-delete note — decide the honest confirm-dialog warning here); per-file sharing.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-07-29 | Split from Story 4.4 (Ducdo confirmed) into frontend half. | Amelia |
| 2026-07-30 | **Party-mode review + amended.** Folded Sally's bundle: upload-failure UX (AC4), SVG/preview fallbacks (AC5), storage-full at the seam + role-split copy (AC7), picker `mode` contract w/ "Use as topic" verb (AC6), Vietnamese interpolation review (AC8). Trimmed: Settings→Storage reduced to read-only usage + 100% state (80/95% ladder deferred); file-detail view-rate removed (deferred). Winston's 3-seam backend audit documented (only materials needs 4.4a). | Amelia |
| 2026-07-30 | **Green-phase (mostly) complete** via `/bmad-dev-story 4-4b` (Amelia). `in-progress → review`. AC1–AC5, AC7, AC8 **met**; AC6 **partial** (picker + seams a/c wired, seam b deferred). Shipped `/knowledge-hub` browser (folder tree/breadcrumb/tile grid + trilogy + two empty states), upload phase-machine (client A9 pre-check → presign → XHR PUT → confirm; "Finalizing…" caps at 99%; retry-without-reselect; same-copy server reject via `uploadErrorCopy`), file detail + preview (SVG-`<img>` sandbox, WebM download-fallback, mobile-PDF Open, universal unavailable), reusable `KnowledgeHubPicker` + `mode` contract, Settings→Storage read-only meter + role-split 100% state, `knowledgeHub.*`/`storage.*` en+vi. **Cross-story addition (ratified by Ducdo):** 4.4a shipped no frontend-readable file URL, so added `GET /api/knowledge-hub/files/{slug}/download` (5-min presigned GET, SEC-8 prefix-guarded) + `StorageService.PresignGet` (WF-1: api.yaml→codegen→backend→FE). **Deferred:** AC6b materials seam (contract gap — `CreateSessionMaterialRequest` link-only → FU-4-4-7); AC6a exercise-audio linked-location (needs `knowledgeFileId` in exercise content → FU-4-4-8). Gates: `tsc` clean, ESLint 0, FE suite **2044/2044**, i18n-parity 728, `npm run build` clean (KnowledgeHubPage isolated chunk); backend `go build`/`vet`/`go test ./internal/service/… ./internal/handler/…` green. Dev record + File List in the sibling completion-notes. | Amelia |
