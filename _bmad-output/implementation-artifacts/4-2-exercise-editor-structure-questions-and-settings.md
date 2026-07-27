---
epic: 4
story: 4.2
story_key: 4-2-exercise-editor-structure-questions-and-settings
baseline_commit: 752bbd59f10f6f731649cdf8baeb0581bb4507de
created: 2026-07-27
audience: full-stack
size: L
depends_on: [4.1]
scope_decision: "SPLIT (pragmatic). 4.2 ships the two-panel authoring editor (s16): metadata sidebar + drag-reorderable sections (5 types incl. Grammar) + 5 question-type editors + exercise settings (time-limit + case-sensitive) + FW-8 non-optimistic VALIDITY-GATED debounced autosave with an updated_at optimistic-concurrency precondition. The v1 ExerciseContent contract is CO-DEVELOPED WITH 4.1 (ratified Ducdo 2026-07-27) — 4.1 declares the COMPLETE v1 shape (incl. Settings), materialized at create, so ONE shape under schema_version=1, NO bump, NO defaults-on-read; the false-zero-value trap is DESIGNED OUT (all settings defaults = Go zero; normalization is fixed Epic-5 grading behavior, not per-row config). DEFERRED: locked/finalize/Unfinalize (FR-23) → Epic 5 (no assignments/submissions; converted to a BLOCKING AC on Story 5.1); assigned-classes sidebar → Epic 5; From-Hub material import + audio R2 upload → Story 4.4 (Reading/Grammar/Listening = fill-text-manually; Listening audio = URL field w/ inline validity); AI 'Generate section/option' → Story 4.3. HARD-BLOCKED on 4.1 landing first. Party-mode-hardened 2026-07-27 (Winston/Murat/Sally/John)."
---

# Story 4.2: Exercise Editor — Structure, Questions & Settings

Status: ready-for-dev

## ⚠️ Scope banner — read first

Story 4.2 (`epic-04.md:53-79`) is the **two-panel structured exercise editor** (screen **s16**, route `/exercises/{id}/edit`): metadata sidebar + a content panel of drag-reorderable sections holding question groups, plus exercise-level settings and debounced autosave. Two epic ACs pull in data that does not exist yet, so this story is scoped pragmatically — the "omit/defer, never fake" posture ratified for 4.1. **Party-mode-hardened 2026-07-27** (10 amendments folded — see Change Log).

**Hard dependency — 4.2 is BLOCKED until Story 4.1 lands.** 4.1 is spec'd but **0% implemented** (verified). The **v1 `ExerciseContent` contract is now CO-DEVELOPED across 4.1+4.2** (ratified Ducdo): **4.1 declares the COMPLETE v1 shape — including `Settings` — and materializes default settings at create.** So there is **exactly one physical shape stamped `schema_version=1`, no bump, and no settings-less rows ever reach this editor** (Winston: two shapes under one version is a lie that detonates in Story 4.5's dispatch). 4.2 also inherits from 4.1: the `exercises` table, `exercise_content.go`, the `/exercises` module + route + role gate, the `'exercises'` `SectionNameKey`, and the `PATCH /api/exercises/{id}` endpoint **with the `updated_at` optimistic-concurrency precondition**. **Do not start 4.2 until 4.1 is `done`.**

**Resolution (pragmatic; party-mode-hardened):**

- **4.2 ships fully:** the s16 two-panel editor at `/exercises/{id}/edit` (own Rolldown chunk under the `/exercises` gate); metadata sidebar; **5 section types** (Reading passage / Listening audio / Writing prompt / Speaking cue card / **Grammar** — the mockup picker shows 5, `02c:6185-6192`); 5 **question types** (T/F/NG, Gap-fill, Matching Headings, MCQ, Short Answer) each with an **explicit interaction contract** (Dev Notes §"Per-type editor contracts" — the mockup renders only Reading + T/F/NG, so the rest are authored, grounded in the canonical green-"✓ KEY" pattern); exercise **settings** (time-limit toggle + minutes; **case-sensitive** toggle); **drag-drop + move-up/down** reorder of sections/groups/questions; **FW-8 non-optimistic, validity-gated debounced autosave** with the concurrency precondition.
- **The false-zero-value trap is DESIGNED OUT, not patched.** Settings = `{TimeLimitEnabled bool, TimeLimitMinutes int, CaseSensitive bool}` — every FR-22 default (time-limit off, case-**insensitive**) equals the Go zero value, so an unset settings block is already correct. **Hyphen/whitespace normalization is fixed always-on grading behavior owned by the Epic-5 matching engine**, not a per-row toggle (the mockup shows only case-sensitive; FR-22's "strips hyphens/whitespace before comparison" reads as a fixed rule). 4.1 still materializes explicit defaults at create (default-on-write) so blobs are self-describing — but there is no read-time reinterpretation anywhere (Winston: N readers agreeing by discipline is how you grade wrong silently).
- **Autosave is NON-optimistic (FW-8, architecture.md:461) AND validity-gated.** Debounced plain mutation + `editorStore` save-status — not the FW-2 optimistic triple. A **blank required field (title) does NOT fire a save** — it holds and shows a distinct **"Unsaved — add a title"** pending state, never the save-failure warning (Sally: an autosave firing into a half-cleared field either persists garbage or cries wolf on the one signal reserved for real failure). Every PATCH carries the last-read `updatedAt` precondition → **409 on a stale write → refetch + reload** (Winston: convert silent lost-update into a loud recoverable conflict).
- **Locked / finalize / Unfinalize (FR-23) → Epic 5, converted to a BLOCKING dependency.** The "locked once assigned + submitted" trigger reads `assignments` + `submissions` — **neither exists** (net-new Epic 5). No student attempt surface exists in 4.1/4.2, so a teacher **cannot** edit content a student is mid-attempt on (John: the hazard is physically impossible today). No manual "lock" toggle (John: it isn't FR-23, serves no current job, and would fight Epic 5's automatic lock). **FR-23 is written as a BLOCKING acceptance criterion into Story 5.1's DoD** (T12), not a floating traceability note — "an exercise with ≥1 assignment carrying ≥1 submission is read-only in the 4.2 editor; teacher may clone or unfinalize; graded submissions immutable." Clone-and-edit is already reachable via 4.1's **deep-copy Duplicate** (4.1 AC5/T6 assert mutate-copy→original-unchanged, so no shared-reference hazard — John's latent-bug check, closed).
- **Assigned-classes sidebar → Epic 5. From-Hub material import + audio-file R2 upload → Story 4.4.** Reading/Grammar/Listening sections use **fill-text-manually** inline content (the mockup's "import from Knowledge hub" link-card is the 4.4 path); Listening audio is a **URL-reference field with inline validity/preview + honest "file upload coming soon" helper** (Sally: a bare "Audio URL" for a teacher holding an `.mp3` is a trap). **AI "Generate section/option" → Story 4.3.**

Add deferred-work entry **FU-4-2-A** (with the FR-23-into-5.1 blocking carry-forward) before finalizing.

## Story

As a Teacher (or Admin/Owner),
I want a two-panel structured editor to define an exercise's sections, question groups, question types, and settings,
So that I can author reusable graded content (the locked/finalize lifecycle arrives with Assignments in Epic 5).

## Acceptance Criteria

Adapted from `epic-04.md` Story 4.2 + PRD FR-21/FR-22 (FR-23 deferred per the scope banner).

**AC1 — Two-panel editor loads (FR-21)** *(epic AC1)*
**Given** a Teacher/Admin/Owner opens `/exercises/{id}/edit` (s16) for an exercise they may edit (AC8),
**When** the editor loads,
**Then** a **two-panel layout** renders (300px sidebar + fluid content panel, `02c:482-492`): a **left metadata sidebar** (title, description, skill, tags, target band — **assigned-classes omitted**, Epic 5) and a **right content panel** listing ordered **section blocks** (drag grip · num badge · title · meta · Settings/Duplicate/Delete actions, `02c:6076-6088`). The route is its **own lazy Rolldown chunk** under the inherited `/exercises` `RouteRoleGate` (students never download it). Load via 4.1 `GET /api/exercises/{id}` (full typed `content` dispatch) into Query cache, **capturing the returned `updatedAt` as the autosave precondition baseline**; **loading = skeleton mirroring the two-panel shape**; **error = human message + one retry**; **cross-scope/not-found = 404 surface** (AC8).

**AC2 — Add/edit sections by type (FR-21)** *(epic AC2)*
**Given** the editor is open,
**When** the teacher adds a section, **Then** a **type-picker** offers **five** section types — **Reading passage, Listening audio, Writing prompt, Speaking cue card, Grammar** (`02c:6185-6192`; the AI "Generate section" card is **omitted**, Story 4.3) — appending a section with a skill-colored **type badge**, editable **title**, and a type-appropriate **content field**: Reading/Grammar = **fill-text passage** (inline; import-from-Hub is 4.4); Listening = **audio-URL field with inline validity/preview + "file upload coming soon" helper** + optional transcript; Writing = **prompt text**; Speaking = **cue-card text**. **Reading/Listening/Grammar host question groups; Writing/Speaking are prompt-only** (no groups — server-enforced, AC7). Section **type is independent of the exercise-level `skill`** (4.1 Dev Note #8). **Deleting a section that has content prompts a confirm** ("Delete this section and its N question groups?") and returns focus to the next section (or the add-section prompt) — AC9.

**AC3 — Add/edit questions by type, per interaction contract (FR-21)** *(epic AC3)*
**Given** a Reading/Listening/Grammar section exists,
**When** the teacher adds a question group, **Then** they pick one of five **question types** and the group renders a **type badge** + per-question rows written into the v1 `Question` shape (`{Text,Type,Options,CorrectAnswer,AcceptedVariants}`), each editor following its **interaction contract** (Dev Notes §"Per-type editor contracts"): **T/F/NG** = fixed True/NotGiven/False triad, mark one correct (green tint + "✓ KEY", `02c:6108-6124`); **MCQ** = variable option list (add/remove/reorder rows, ≥2, mark one correct → green "✓ KEY"; `correctAnswer` ∈ options, no duplicates); **Matching Headings** = a **shared heading bank** (add/remove/reorder, roman-numeral labeled) + per-item heading select (selected shows "✓ KEY"; two-column pairing); **Gap-fill** = text with a `______` blank token + `correctAnswer` + `acceptedVariants[]` chips; **Short Answer** = question text + `correctAnswer` + `acceptedVariants[]` chips. A **group must hold ≥1 question**; questions and groups can be **removed**. Correct-answer marking uses the canonical green tint (`#ecf4ec`/`#c5dccb`/green) + mono "✓ KEY".

**AC4 — Exercise settings persist (FR-22)** *(epic AC4)*
**Given** the settings panel (`02c:6198-6221`),
**When** the teacher toggles **time limit** (with a **minutes input** when enabled — the mockup shows the value as text; 4.2 adds the numeric control) and toggles **case-sensitive answer key** (default OFF ⇒ case-insensitive), **Then** the config persists into **`content.settings`** (JSONB, materialized by 4.1 at create) via the autosave. **No false-zero-value handling is needed** — every default equals the Go zero value. **Hyphen/whitespace normalization is fixed always-on grading behavior (Epic 5), not a settings toggle.** The matching/grading engine that consumes this config is Epic 5 — 4.2 persists config only.

**AC5 — Reorder (drag + keyboard/touch) persists (FR-21)** *(epic AC6)*
**Given** multiple sections, or groups within a section, or questions within a group,
**When** the teacher reorders,
**Then** the new order updates the in-memory `content` array **by array index** (no `position` column — order IS array position, mirroring `template_crud.go:144-161`) and **autosaves** (AC6). Reorder is operable **three ways**: dnd-kit pointer drag, dnd-kit `KeyboardSensor`, **and explicit move-up/move-down buttons** (the touch-safe + a11y fallback — native HTML5 drag is touch-hostile and this is mobile-heavy Vietnam; the buttons double as the TEST-UX-2 keyboard path — Sally). **A reorder during an in-flight autosave serializes** onto a single coherent document (never a partial write; the drag must not silently bounce back).

**AC6 — Autosave: FW-8 document pattern, non-optimistic, VALIDITY-GATED, concurrency-guarded (FR-21)** *(epic AC7)*
**Given** the teacher edits any field,
**When** they stop past the **debounce window (1500ms, named constant)**,
**Then** the **whole editor document** (metadata + full `content` blob) is **full-replace PATCHed** via 4.1's `PATCH /api/exercises/{id}` **carrying the last-read `updatedAt` precondition** (no new endpoint), and a **save-status indicator** reflects one of **five enumerated states** — `Saving…` / `Auto-saved · just now` / `Auto-saved · {N} ago` / `Unsaved — {reason}` / `Save failed — retry` (aria-live=polite; **announce only Saving/Saved/Failed transitions, never the ticking relative-time**; copy `AutoSaveIndicator.tsx:65-79`). **Validity gate:** a required field left blank (title) **does not fire a save** — it holds in the `Unsaved — add a title` state, never the failure state (Sally). **Non-optimistic** (architecture.md:461) — a plain debounced mutation, NOT the FW-2 triple; save state lives in the built-but-unwired **`editorStore.ts`** (4.2 is first consumer). **Concurrency:** a **409** (stale `updatedAt`) surfaces a non-blocking "opened elsewhere — reloading" and refetches; the manual **"Save exercise"** button (`02c:6003`) acts as flush + retry affordance (reachable without losing cursor). The editor body is **RHF-exempt** (FW-8). The debounce effect **depends on the stable `scheduleSave`/`flush` `useCallback` primitives, never the autosave object literal** (FW-4 loop guard — copy `CenterSetupPage.tsx:86-96`). **A settings-materialized load with zero user edits fires ZERO PATCH** (the FW-4 regression, tested — Murat).

**AC7 — Server-side content validation (FR-21, GO-7)** *(new — invariant guard)*
**Given** a full-content PATCH,
**When** the service validates `content` (`ValidateExerciseContent`, in `exercise_content.go`),
**Then** it enforces the v1 invariants → typed **`model.ValidationError` 422** (never 500, never persist garbage): section `type` ∈ 5-set; group `type` ∈ 5-set; **Writing/Speaking carry no groups**; **each group has ≥1 question**; **MCQ ≥2 options, no duplicate options, `correctAnswer` ∈ options**; **Matching Headings: non-empty heading bank, each `correctAnswer` ∈ bank**; **T/F/NG `correctAnswer` ∈ {true,false,notGiven}**; **Gap-fill/Short Answer `correctAnswer` non-blank AFTER trim/normalize** (reject `"   "`, `"​"`, `" "` — a `len>0` check is not a validity check, Murat). **Size guard:** a `MaxContentBytes` decode limit (4.1's `MaxBytesReader`) + per-collection caps (max sections/groups-per-section/questions-per-group/options-per-question, named constants) → **413/422** (validation runs on every 1500ms autosave — an unbounded document is a CPU/JSONB DoS reachable by any authenticated teacher, Murat 7/9). `schema_version`/`code` remain server-authoritative (4.1 smuggle guard holds).

**AC8 — Scope, routing & role gating (UX-3, SEC-1)** *(new — inherits 4.1)*
**Given** the editor route and the PATCH path,
**When** access is evaluated,
**Then** `/exercises/{id}/edit` is gated to **owner/admin/teacher** via the inherited `/exercises` `RouteRoleGate` (student → `PermissionDenied`, chunk not downloaded); a **teacher may edit only their own** exercise, **owner/admin any in-center** (4.1 `assertTeacherScope`); **cross-teacher/cross-tenant edit → 404** (same 404 as not-found, no oracle); **student PATCH → 403**; role re-validated from `center_members`. The 4.1 library **"Edit" row action repoints to `navigate('/exercises/{id}/edit')`**, and **4.1's post-create flow redirects into the editor** (the "no dead-end" wiring 4.1 deferred here — `4-1-…md:26,156`).

**AC9 — Trilogy + i18n + edge states (UX-1, UX-2)** *(new)*
**Given** the editor and its states,
**When** it loads / a pane is empty / it errors,
**Then** **three empty states** exist (Sally, per 4.1 skill-appropriate precedent): section-less exercise → "add your first section" prompt; empty section → "add a question group"; **empty question group → skill/type-appropriate copy** ("Add your first True/False statement" etc., not a blank dashed card). Loading = two-panel skeleton; error = human message + retry (non-blocking for autosave failures). Every string in **both** `en.json` and `vi.json` under `exercises.editor.*` (parity coverage test green), including the **five enumerated autosave states** — note **"just now"/"vừa xong" is a distinct string, not `N=0`** of the relative-time message (TS-6: relative time through the i18n formatter, ICU); section/question-type labels; the Listening "file upload coming soon" helper; the delete-section confirm. The failure message is a **whole Vietnamese sentence** (never "Save"+"failed" concatenation); **`EX-` codes and skill-letter tiles stay locale-invariant**.

## Tasks / Subtasks

> **Pre-dev (mandatory):** read mockup `docs/classlite-entry/02c-teacher-content-grading.html:5959-6229` (s16) for the canonical two-panel layout + the T/F/NG green-"✓ KEY" options grid (`:6108-6124`) + settings toggles (`:6198-6221`). **MCQ / Matching Headings / Short Answer / the Gap-fill key editor are NOT in the mockup** — build them per Dev Notes §"Per-type editor contracts" (grounded in the T/F/NG pattern + the grading-view heading format `02c:8018`).
>
> **Ordering guard (WF-1/WF-3):** backend FIRST — `exercise_content.go` semantic validation + `api.yaml` content sub-schema → `codegen.sh` (LAST). **No migration, no new endpoint** (settings ride in `content`; autosave reuses 4.1 `PATCH` + its `updatedAt` precondition). Atomic commit (client.ts regenerates, WF-4).

### Backend (classlite-api)

- [ ] **T1 — Per-type semantic validation in `exercise_content.go` (AC4, AC7)** *(4.1 declares the struct + type constants + Settings + MaxContentBytes; 4.2 adds the semantic rules)*
  - [ ] `ValidateExerciseContent(c ExerciseContent) error` → `model.ValidationError{Fields:[]FieldError{...}}` (GO-2), table-driven per type: section/group type ∈ their sets; **Writing/Speaking → no groups**; **≥1 question per group**; **MCQ** ≥2 options + **no-duplicate-options** + `correctAnswer` ∈ options; **Matching** non-empty bank + `correctAnswer` ∈ bank; **T/F/NG** `correctAnswer` ∈ {true,false,notGiven}; **Gap-fill/Short Answer** `correctAnswer` **non-blank after trim + unicode-blank normalization** (`strings.TrimSpace` + reject zero-width/nbsp). No panic on any shape.
  - [ ] **Per-collection caps** (named constants, CQ-3): `maxSectionsPerExercise`, `maxGroupsPerSection`, `maxQuestionsPerGroup`, `maxOptionsPerQuestion`, `maxContentBytes` → over-limit returns `413`/`422`. (Confirm 4.1's PATCH `MaxBytesReader` bound; if present, `maxContentBytes` is belt-and-suspenders.)
- [ ] **T2 — Wire validation into the 4.1 update path (AC6, AC7)**
  - [ ] In `exercise_service.go` `UpdateExercise`: after the typed unmarshal of the full-replace `content`, call `ValidateExerciseContent` → 422 **before** the write; the write already carries the **`updated_at` precondition** (4.1 T5) → 0 rows → **409**. `schema_version`/`code` untouched; settings persist inside the one JSONB blob. Audit unchanged (`LogWithinTx`).
- [ ] **T3 — api.yaml content sub-schema + codegen (AC1–AC4, AC7)**
  - [ ] Flesh out the `ExerciseContent` object 4.1 introduced: named schemas `ExerciseSection`, `QuestionGroup`, `Question`, `ExerciseSettings` (camelCase, GO-5 explicit nulls, `enum` for section/group `type`). `UpdateExerciseRequest.content` → `ExerciseContent`; PATCH op enumerates **409/413/422/428**. Run `scripts/codegen.sh` **LAST** → Go types + `client.ts` + Zod.
- [ ] **T4 — Backend tests (AC4, AC6, AC7; TEST-BE-1..4)**
  - [ ] **Semantic-validation units** (table-driven, adversarial rows): each type valid → persists; Writing/Speaking+groups → 422; group with 0 questions → 422; **MCQ** <2 options / dup options `["Paris","Paris"]` / correctAnswer∉options → 422; **Matching** empty bank / correctAnswer∉bank → 422; **T/F/NG** correctAnswer∉set → 422; **Gap-fill/Short** `"   "` / `"​"` / `" "` → 422; unknown type → 422; over-cap collections + oversize blob → 413/422; malformed/deep-nested → typed error, **no panic**.
  - [ ] **Settings round-trip** (no defaults-on-read to test — designed out): PATCH settings → GET returns them; a create-materialized row already carries explicit defaults; `schema_version` unchanged after a settings PATCH (reuse 4.1 smuggle assertion).
  - [ ] **Concurrency (409):** two PATCHes with the same stale `updatedAt` → first 200, second **409** (row unchanged by the loser). **Golden-contract test** — serialize a fully-populated `ExerciseContent` and assert JSON keys/casing match `api.yaml` (the MSW-drift gate, per 4.1's `meta.pagination` golden — Murat 6/9); export the same fixture for FE MSW.
  - [ ] **Autosave PATCH integration** through the 4.1 handler + real middleware (TEST-BE-3): teacher full-replace (metadata + multi-section content) → 200, full `{data,meta}`, `updated_at` bumped, `content` deep-equals sent; **cross-teacher → 404**, **student → 403** (forged-JWT scope). `go test ./... && go vet ./... && gofmt -l`.

### Frontend (classlite-web)

- [ ] **T5 — Editor route + two-panel shell + chunk (AC1, AC8, AC9)**
  - [ ] Register `path: ':id/edit'` under the `/exercises` gated group in `src/routes.tsx` (deep-import `ExerciseEditorPage`, own chunk; model `routes.tsx:360-377`). Own the query (no loader — FW-1); capture `updatedAt` baseline. `ExerciseEditorPage.tsx` — two-panel (`--cl-side-panel` sidebar + content panel); trilogy (skeleton / inline error+retry / 404). Barrel-export.
  - [ ] **Repoint 4.1 library "Edit"** → `navigate('/exercises/:id/edit')`; **wire 4.1 post-create → redirect into the editor** (UPDATE to `ExerciseLibraryPage.tsx`).
- [ ] **T6 — Autosave engine (document, non-optimistic, validity-gated, concurrency-guarded) (AC5, AC6)**
  - [ ] `features/exercises/hooks/useExerciseAutosave.ts` — adapt `onboarding/hooks/useAutoSave.ts` (1500ms debounce, `flush()`, `saveSeq` out-of-order guard) driving a **plain** `useUpdateExercise` (strip the optimistic triple) that PATCHes `{...metadata, content}` **+ the `updatedAt` precondition**. **Validity gate:** skip the save + emit `Unsaved — add a title` when a required field is blank. **409** → refetch + reload prompt. Push state into `stores/editorStore.ts` (first consumer). **FW-4:** effects depend on stable `scheduleSave`/`flush`, never the object (copy `CenterSetupPage.tsx:86-96`).
  - [ ] `AutoSaveIndicator` — port `onboarding/components/AutoSaveIndicator.tsx`; render the **five states**; aria-live transitions only; non-blocking failure with the "Save exercise" retry button.
- [ ] **T7 — Metadata sidebar (AC1, AC6, AC8)**
  - [ ] `EditorMetadataSidebar.tsx` — controlled inputs (title/description/skill/tags/target band) feeding the autosave (no RHF — FW-8). **No assigned-classes control** (Epic 5). Title required → blank blocks the save (AC6 gate) with an inline field message, not a modal.
- [ ] **T8 — Section authoring + reorder (AC2, AC5, AC9)**
  - [ ] `ExerciseSectionCard.tsx` — skill-colored type badge (reuse 4.1 `lib/exerciseCode.ts`), title + **type-appropriate content field** (fill-text passage for Reading/Grammar; audio-URL + validity/preview + helper for Listening; prompt for Writing/Speaking), actions incl. **delete-with-confirm + focus return**. Writing/Speaking prompt-only (no group affordance).
  - [ ] `SectionTypePicker.tsx` — **5 cards** (Reading/Listening/Writing/Speaking/Grammar); **no AI card** (4.3). Reorder: dnd-kit `SortableContext` + `KeyboardSensor` **+ move-up/down buttons** (touch/a11y); reorder is an autosaved change.
- [ ] **T9 — Question groups + 5 per-type editors + reorder (AC3, AC5)**
  - [ ] `QuestionGroupCard.tsx` — type badge + instructions + sortable question rows (drag + move buttons); add/remove; **≥1 question enforced in UI + server**.
  - [ ] Five editors writing the v1 `Question` shape, per Dev Notes contracts: `TfngQuestionEditor` (fixed triad radio + "✓ KEY"), `McqQuestionEditor` (variable option list add/remove/reorder + mark-correct + dup guard), `MatchingHeadingsEditor` (**two-column: shared heading bank ↔ per-item select**), `GapFillQuestionEditor` (`______` blank token + correctAnswer + variants chips), `ShortAnswerQuestionEditor` (correctAnswer + variants chips). Mirror server validation client-side (the "N errors to fix" pattern, `ux:390`); server authoritative (AC7).
  - [ ] `lib/questionTypes.ts` / `lib/sectionTypes.ts` — type → label/badge/prompt-only-flag/empty-question factory.
- [ ] **T10 — Settings panel (AC4)**
  - [ ] `ExerciseSettingsPanel.tsx` — Switch (`--cl-accent`, `02c:522-532`) for time-limit (+ **minutes number input** when on) and case-sensitive. Reads/writes `content.settings` via autosave. **No hyphen/whitespace toggles** (fixed Epic-5 behavior).
- [ ] **T11 — i18n + FE tests (AC3–AC9)**
  - [ ] `exercises.editor.*` in `en.json` + `vi.json`: **five autosave states** (incl. distinct `justNow`/`vừa xong`, relative-time via formatter), section/question-type labels, settings + minutes label, Listening "file upload coming soon" helper, delete-section confirm, empty-state copy (exercise/section/group), validation + `errorsToFix` messages. `i18n-parity-coverage.test.ts`; `npm run i18n-parity`.
  - [ ] Component tests (Vitest + MSW, never mock Query — TEST-FE-1): three-state; **autosave** — debounce-collapse-to-one-PATCH; **`Unsaved — add a title` on blank title fires NO save**; **settings-materialized load + zero edits → ZERO PATCH** (the FW-4 loop guard — Murat, mirror `CenterSetupPage.test.tsx`); **out-of-order** — delay PATCH#1's response past PATCH#2, assert seq-1 stale result ignored (deferred MSW resolution); **409** → reload prompt; non-optimistic (no premature cache write); non-blocking failure keeps focus; **each of 5 question editors** round-trip + client validation (MCQ dup/correct-in-options, T/F/NG set, Matching bank↔select); **section/group/question reorder** persists reordered array (drag + move-buttons + keyboard); **delete-section-you're-editing** → confirm + focus return; **settings** round-trip; role-negative student-blocked (TEST-FE-6); `assertI18nParity`; `axe` incl. keyboard-operable reorder.
  - [ ] `tsc -b && eslint && vitest && npm run build` (editor chunk isolated; `e2e/route-bundle-boundaries.spec.ts` green).

### Close-out

- [ ] **T12 — Deferred-work + docs**
  - [ ] **FU-4-2-A** → `deferred-work.md`: **FR-23 locked/finalize/Unfinalize → Epic 5, and it MUST be written as a BLOCKING acceptance criterion on Story 5.1's Definition of Done** (John — a traceability note has no teeth): *"an exercise with ≥1 assignment carrying ≥1 submission is read-only in the 4.2 editor; teacher may clone (deep-copy) or unfinalize; graded submissions immutable."* Also: **assigned-classes sidebar → Epic 5**; **From-Hub material import + audio-file R2 upload → Story 4.4**; **AI Generate section/option → Story 4.3**; **per-exercise normalization control (if ever wanted) → additive Epic-5 setting**. FR-21/FR-22 satisfied by 4.2 (FR-22 config-persist; grading Epic 5).
  - [ ] No new env/service → skip `docs/manual-setup.md` (WF-9). Dev Agent Record + File List → sibling `4-2-…-completion-notes.md` (bmad-story-conventions.md), NOT this file.

## Dev Notes

### Scope decisions (why this shape)

1. **v1 content is CO-DEVELOPED with 4.1; ONE shape, no bump, no defaults-on-read (Winston, ratified Ducdo).** 4.1 declares the full v1 struct incl. `Settings` and materializes defaults at create — so no settings-less row exists, `schema_version` stays an honest discriminator for Story 4.5, and there is no read-time reinterpretation to drift across layers. The additive-no-bump + defaults-on-read contortion in the first draft existed only to avoid touching a frozen-but-unshipped 4.1; un-freezing it dissolves both.
2. **The false-zero-value trap is DESIGNED OUT.** Settings = `{TimeLimitEnabled, TimeLimitMinutes, CaseSensitive}`; every FR-22 default equals the Go zero value. Normalization (hyphens/whitespace) is **fixed always-on grading behavior (Epic 5)**, not per-row config — matching the mockup (only case-sensitive is drawn) and FR-22 ("strips … before comparison" = a rule, not a toggle). No `ApplySettingsDefaults`-on-read anywhere.
3. **Autosave: FW-8 non-optimistic + validity-gated + concurrency-guarded.** Non-optimistic per architecture.md:461. Validity gate stops the blank-title phantom-save (Sally). The `updated_at` precondition (409) converts silent multi-tab lost-update into a loud recoverable conflict (Winston) — cheap insurance (one WHERE clause) on a full-blob-replace document. The zero-edit-zero-PATCH test is the FW-4 regression wearing a new hat (Murat).
4. **Locked/finalize/Unfinalize → Epic 5, as a BLOCKING 5.1 AC (John).** No attempt surface exists today, so the hazard is impossible now; but the deferral must have teeth or FR-23 silently dies when 5.1 lands. No manual lock toggle (not FR-23, would fight the automatic lock). Clone = 4.1 deep-copy Duplicate (verified deep-copy, no shared-reference bug).
5. **Whole editor = one autosaved document.** architecture.md:254 calls the sidebar a "standard form" but :537 exempts "the writing editor and its sub-components." One save mechanism beats two (Sally: teachers think "my exercise," not "a form + a stream"). Controlled inputs, no RHF.
6. **5 section types incl. Grammar** (mockup picker `02c:6187-6190` + UX "5 skill cards"). Section type ≠ exercise skill (4.1 #8). Reading/Grammar/Listening host groups + fill-text; Writing/Speaking prompt-only. From-Hub import + audio upload → 4.4.

### Per-type editor contracts (the mockup renders only Reading + T/F/NG — the rest are authored)

Canonical key-marking pattern (all types, `02c:6115-6116`): the correct option/answer is tinted green (`#ecf4ec` bg / `#c5dccb` border / `--cl-green` text) with a mono **"✓ KEY"** badge.

- **T/F/NG** *(mockup-canonical)* — fixed 3-option grid **True / Not Given / False**; teacher marks exactly one correct → green "✓ KEY". No add/remove (fixed triad). `Question.Text` = the statement; `CorrectAnswer` ∈ {`true`,`notGiven`,`false`}; `Options` unused.
- **MCQ** *(authored; extends the KEY grid to a list)* — variable **option list**: add / remove / reorder rows (dnd-kit + move buttons), each option a text input; a radio marks exactly one correct → that row gets "✓ KEY". Server: ≥2 options, no duplicates, `CorrectAnswer` (the option text) ∈ `Options`.
- **Matching Headings** *(authored; grounded in grading-view `02c:8018` `iii — Storage challenges`)* — **two-column pairing**: a **shared heading bank** (add/remove/reorder headings, auto roman-numeral labels) on one side; each **item** (paragraph reference, a `Question`) selects its correct heading from the bank on the other → selected shows "✓ KEY". v1 representation: the bank is replicated into each `Question.Options` (identical across the group) and `CorrectAnswer` = the selected heading (a possible Epic-5 normalization to a group-level bank is noted, not done now).
- **Gap-fill** *(authored; blank token per mockup `02c:6135` `The main barrier … is ______.`)* — `Question.Text` carries a `______` blank token; `CorrectAnswer` = primary answer (green "✓ KEY"); `AcceptedVariants[]` = alternates as add/remove chips.
- **Short Answer** *(authored)* — `Question.Text` = the question; `CorrectAnswer` + `AcceptedVariants[]` chips. Same key pattern.

### Reuse map — build on, do not reinvent

**Backend** — only net-new is the semantic-validation table (4.1 owns the struct/constants/Settings/MaxContentBytes/precondition).
- Content struct + Settings + version dispatch: **4.1's `exercise_content.go`** (extend with `ValidateExerciseContent`); never-null-object marshal `audit.go:149-188`.
- Full-replace-of-ordered-children + array-index order: `service/template_crud.go:85-195` (`:144-161`). Tenant-tx + in-tx audit + scope gate: `service/session_content.go:108-170`, `audit.go:98-108`. Reuse 4.1 `assertClassRole`(403)/`assertTeacherScope`(404) + the `updated_at`-precondition PATCH.
- Errors/envelope/PATCH: 4.1's `exercise_handler.go`/`exercise_service.go`; `model/errors.go`; `middleware/error_mapper.go`; `handler/response.go`. Golden test: mirror 4.1's `meta.pagination` golden.
- Tests: `test/helpers.go` (`SetupDB` RLS tx, `TenantContext`), 4.1's `NewExerciseTestServerBareMux` + `SignAccessTokenForRole`, forged-JWT scope `enrollment_handler_atdd_test.go:160-171`.

**Frontend** — the editor pattern is fully precedented; the per-type editors are the net-new UI.
- **Autosave (core reuse):** `onboarding/hooks/useAutoSave.ts` (1500ms debounce, `flush`, `saveSeq`), `OnboardingAutoSaveContext.tsx`, `components/AutoSaveIndicator.tsx:65-79` (aria-live). **FW-4 guard:** `CenterSetupPage.tsx:86-96` + `CenterSetupPage.test.tsx`.
- **Save-status store (first consumer):** `stores/editorStore.ts` (`saveStatus`/`dirty`/`lastSavedAt`, `initialState`+`reset`).
- **dnd-kit (installed, first usage):** `@dnd-kit/core@^6.3.1`/`sortable@^10`/`utilities@^3.2.2` — no plugin-review flag. `SortableContext` + `useSortable` + `KeyboardSensor`; pair with move-up/down buttons for touch/a11y.
- **Route + gate + chunk:** `routes.tsx:253-283` (`/exercises` from 4.1) + `:360-377` (templates `:id/edit`). `RouteRoleGate.tsx`; `e2e/route-bundle-boundaries.spec.ts`.
- **4.1 hooks the editor consumes:** `features/exercises/api/{exercisesKeys,useExercise,useUpdateExercise}.ts`; content types from regenerated `client.ts`.
- **Mockup:** `docs/classlite-entry/02c-teacher-content-grading.html:5959-6229` (s16); tokens `ux:220-223,321-324` (skill colors), `:298`/`02c:522-532` (Switch), `ux:390` ("N errors to fix").

### Naming boundary — session exercises vs the exercise library (still applies)

`session_exercises` (3.5) / `session-detail/*` are lightweight in-session ungraded rows — NOT this editor's entity. Hook names collide (`sessionContentApi.ts` exports `useCreateExercise`/`useUpdateExercise`/`useDeleteExercise`). Reach the library hooks via `@/features/exercises`; never import the session-detail ones; use the `useUpdateLibraryExercise` alias if test setup collides.

### Testing standards summary

- Backend: semantic-validation units (every type, valid + adversarial incl. dup-options/unicode-blank/zero-question-group/over-cap/oversize, no panic); settings round-trip; **409 concurrency**; **golden-contract** (nested camelCase vs api.yaml); autosave full-replace through real middleware (full envelope, cross-teacher 404 / student 403, forged-JWT). No new RLS grid (same `exercises` table 4.1 proves).
- Frontend: MSW at the boundary, never mock Query (TEST-FE-1); three-state (TEST-FE-2); **zero-edit→zero-PATCH (FW-4)**, blank-title-no-save, out-of-order-saveSeq, 409-reload, non-optimistic, non-blocking-failure; per-type round-trips; reorder persistence (drag + move + keyboard); delete-section focus; role-negative (TEST-FE-6); i18n both locales incl. 5 autosave states + distinct `justNow` (TEST-FE-4); axe incl. keyboard reorder (TEST-UX-2).

### References

- [Source: epics/epic-04.md#Story-4.2] — 7 epic ACs (72-78); two-panel + section/question/settings/lock/drag/autosave (61-69).
- [Source: prds/prd-classlite_new-2026-05-26/prd.md#FR-21..FR-23] — FR-21 two-panel + model (415-421); FR-22 settings incl. normalization + accepted-variants (423-430); **FR-23 locked → Epic 5** (432-436); FR-70 (888).
- [Source: architecture.md] — FW-8 document pattern + RHF exemption (189, 254-255, 537); **autosave NOT optimistic (461)**; JSONB + schema_version (206, 967); file structure (699, 620, 643, 670, 781-787); student-never-downloads-editor (253); `editorStore.ts` (894).
- [Source: docs/classlite-entry/02c-teacher-content-grading.html] — s16 (5959-6229): two-panel (482-492, 6013-6224), Reading section (6075-6145), **T/F/NG green ✓ KEY (6108-6124)**, Gap-fill row (6135), **5-card type-picker incl. Grammar (6185-6192)**, settings toggles (6198-6221), autosave state (6010), Switch CSS (522-532); grading-view Matching format (8018). MCQ/Matching/Short-Answer editors ABSENT.
- [Source: 4-1-exercise-library-and-crud-api.md] — the co-developed v1 `ExerciseContent` + Settings + create-materialization + `updated_at` precondition, `exercises` table, `/exercises` module/route/`SectionNameKey`, `assertTeacherScope`, deep-copy Duplicate.
- [Source: codebase] — `onboarding/hooks/useAutoSave.ts`, `AutoSaveIndicator.tsx:65-79`, `CenterSetupPage.tsx:86-96`; `stores/editorStore.ts`; `service/template_crud.go:85-195`; `service/session_content.go:108-170`, `audit.go:98-108`; `routes.tsx:253-283,360-377`; `package.json` (@dnd-kit/*).
- [Source: docs/project-context.md] — FW-2/4/8, GO-2/5/7, GFW-1/5, XL-1/2, SEC-1, TS-3/4/6, UX-1/2/3, TEST-BE-1..4, TEST-FE-1..6, TEST-UX-2/3, CQ-3/4, WF-1..4/9.

## Definition of Done

- [ ] In-scope ACs met (AC1–AC9); deferrals documented; **FR-23 written as a BLOCKING AC into Story 5.1's DoD** (not a bare note); FR-21/FR-22 satisfied by 4.2 (FR-22 config-persist; grading Epic 5).
- [ ] v1 `ExerciseContent` consumed as ONE shape under `schema_version=1` (co-developed in 4.1, incl. Settings); **no bump, no defaults-on-read** (false-zero trap designed out); `ValidateExerciseContent` enforces every AC7 invariant incl. **dup-options, unicode-blank-reject, ≥1-question-per-group, per-collection caps** → 422/413 (no panic).
- [ ] Autosave = FW-8 **non-optimistic**, 1500ms debounce, **validity-gated** (blank title → distinct `Unsaved` state, no save, no false failure), **`updated_at` precondition → 409 reload**; `editorStore` wired; **five enumerated states** (aria-live transitions); **FW-4 zero-edit→zero-PATCH green**; non-blocking failure + retry.
- [ ] Two-panel `/exercises/{id}/edit` in its own chunk under the `/exercises` gate; students blocked (route+DOM+chunk); teacher-scope 404 / student 403; 4.1 "Edit" repointed + post-create redirect wired.
- [ ] 5 section types (Writing/Speaking prompt-only, server-enforced) + 5 question-type editors per their interaction contracts (Matching = two-column; correct = green "✓ KEY"); reorder persists by array index via **drag + keyboard + move-buttons**; delete-section confirm + focus return; settings round-trip.
- [ ] `en.json` + `vi.json` parity green (`exercises.editor.*`, 5 autosave states incl. distinct `justNow`, relative-time via formatter, empty/validation/confirm copy); axe clean incl. keyboard reorder.
- [ ] Backend golden-contract test green (nested camelCase vs api.yaml); `go test ./... && go vet && gofmt -l` clean; `tsc -b && eslint && vitest && npm run build` clean; editor chunk isolated; `codegen.sh` last.
- [ ] FU-4-2-A added to `deferred-work.md`. Dev Agent Record + File List in sibling completion-notes.

## Out of Scope

- **Locked / finalize / Unfinalize (FR-23)** — read-only strip, `UnlockPathsCard`, assigned+submitted trigger → **Epic 5**, carried as a **blocking Story 5.1 AC** (FU-4-2-A). No manual lock toggle.
- **Assigned-classes sidebar control + the answer-matching/grading engine** (normalization + auto-grade execution) → **Epic 5**. 4.2 persists matching **config** only; normalization is fixed always-on Epic-5 behavior.
- **From-Hub imported-material picker + audio-file R2 upload** → **Story 4.4**. Listening audio is a URL-reference field (with validity/preview + honest helper) this story.
- **AI "Generate section/option" + `AIDialog` (s17)** + jobs/worker → **Story 4.3**.
- **JSONB lazy-upgrade / version-dispatch migration** → **Story 4.5** (4.2 stays one v1 shape).
- **Rich-text/WYSIWYG passage formatting** (Tiptap/Slate/Lexical, architecture.md:1080) — 4.2 section content is plain-text fields.
- **Student attempt/runtime** (countdown execution, s33 `ChoiceOption`/`GapInput`, auto-submit) → Epic 5.

## Change Log

| Date | Change |
|---|---|
| 2026-07-27 | Story created (ready-for-dev). Two-panel editor: sections + questions + settings + dnd-kit reorder + FW-8 non-optimistic debounced autosave. |
| 2026-07-27 | **Party-mode review amendments (Winston/Murat/Sally/John), ratified Ducdo — "fold all high-confidence + co-develop 4.1+4.2."** (1) **v1 contract co-developed with 4.1** — one shape under `schema_version=1`, no bump, Settings declared+materialized in 4.1; **false-zero-value trap designed out** (all defaults = Go zero; normalization = fixed Epic-5 behavior). (2) **`updated_at` optimistic-concurrency precondition** on autosave PATCH (409) — silent multi-tab lost-update → loud conflict (Winston). (3) **Validity-gated autosave** — blank title holds in a distinct `Unsaved` state, never a false save-failure (Sally). (4) **FW-4 zero-edit→zero-PATCH** mandatory test; out-of-order saveSeq test; **golden-contract test** for nested camelCase (Murat). (5) **Semantic validation hardened** — dup MCQ options, unicode-blank-reject, ≥1-question-per-group, **per-collection caps + MaxContentBytes DoS guard** (validation runs every autosave — Murat 7/9). (6) **5 section types incl. Grammar** (mockup picker); **per-type editor interaction contracts authored** (mockup has only Reading+T/F/NG) — **Matching Headings = two-column** (Sally). (7) **5 enumerated autosave states** incl. distinct `justNow`/`vừa xong` for vi (Sally). (8) **FR-23 → Epic 5 as a BLOCKING Story 5.1 AC**, not a bare note; no manual lock toggle; Duplicate confirmed deep-copy (John). (9) **Delete-section-you're-editing** confirm + focus return; **touch/keyboard reorder via move-buttons**; empty question-group copy (Sally). (10) **Listening audio URL** honest helper + inline validity (4.4 owns upload). |
