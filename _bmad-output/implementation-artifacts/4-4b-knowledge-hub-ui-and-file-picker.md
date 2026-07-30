# Story 4.4b: Knowledge Hub UI & File Picker (Frontend)

Status: ready-for-dev

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

- [ ] **T1 — Routes** (AC1, AC5): add `/knowledge-hub` (index) + `/knowledge-hub/files/:slug` to `src/routes.tsx`, mirroring `/exercises` (`:289-331`); deep-import per Rolldown chunk. Remove the `/knowledge-hub` dead-link stub.
- [ ] **T2 — `knowledge-hub` feature folder**: `api/knowledgeHubKeys.ts` (TS-3), query/mutation hooks via `makeContentHooks` (FW-2), `lib/` hand-written Zod schemas (Zod NOT codegen'd; form types from Zod infer, never generated API types — TS-2), `components/` (folder tree, breadcrumb, tile grid, upload dialog, detail preview), trilogy via `ContentSectionFrame`, two empty states.
- [ ] **T3 — Upload client + failure UX** (AC3, AC4): copy `useUploadImportFile.ts` (XHR PUT); client size pre-check vs per-feature cap constants; `presign(sizeBytes)`→PUT→`confirm`→create-file chain; page owns the phase state machine with distinct presign/transfer/confirm failure surfaces, "Finalizing…" final segment, retry-without-reselect, and same-copy server rejection.
- [ ] **T4 — File detail page** (AC5): type-specific preview with ALL fallbacks (SVG sandboxed, WebM download-fallback, mobile-PDF thumbnail+Open, universal "Preview unavailable"); metadata (TS-6 date fmt); linked-locations list. No view recording.
- [ ] **T5 — "From Knowledge Hub" picker** (AC6): one dialog + `mode` contract; integrate into the 3 seams with their declared `allowedTypes`/`selection`/`confirmVerb`. Per Winston's audit: seams (a) and (c) are pure client string-writes; seam (b) uses 4.4a's `file_id`/`kind='file'`.
- [ ] **T6 — Settings → Storage tab + storage-full seam** (AC7): read-only usage meter from `/api/storage/usage`; 100% state; role-split copy via `useRole()`; surface the 100% block in the upload dialog. (No 80/95% ladder.)
- [ ] **T7 — i18n** (AC8): `knowledgeHub.*` + `storage.*` en+vi; Vietnamese interpolation/overflow review; parity test green.
- [ ] **T8 — Tests**: trilogy three-state per data component (TEST-FE-2); MSW at HTTP boundary incl. presign + R2 PUT + a **server-reject-after-client-ok** case and a **confirm-failure** case (TEST-FE-1, mock the R2 URL); role-gate absence — teacher does NOT see the owner upgrade CTA, student does not see curate controls (TEST-FE-6); **SVG sandbox test** (an uploaded SVG with a script payload does not execute); i18n key existence both locales (TEST-FE-4); axe on hub, detail, picker, storage tab (TEST-FE-5); Zustand `reset()` if any UI store added (TEST-FE-3).

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
