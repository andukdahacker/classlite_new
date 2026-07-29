---
epic: 4
story: 4.3b
story_key: 4-3b-ai-content-generation-dialog-and-preview
baseline_commit: 636556e308f4e1e1afcef40db581b9d02484da72
created: 2026-07-28
audience: frontend
size: M
depends_on: [4.3a, 4.2, 4.1]
splits_from: 4-3-ai-content-generation-pipeline
scope_decision: "SPLIT (Ducdo 2026-07-28). Frontend half of Story 4.3 — the s17 AIGenerateDialog (3 modes: Generate section / questions / distractors), the job-polling hook with 2s→4s→8s progressive backoff + 5-min stuck + failure surfaces, preview→accept/edit/dismiss that inserts generated content into the editor via 4.2's autosave, the credit counter UI, and en/vi i18n. HARD-BLOCKED on Story 4.3a (needs POST /api/exercises/{id}/ai-generate + GET /api/jobs/{jobId} + the regenerated client.ts + Zod). No backend work here — all endpoints/contracts are 4.3a's."
---

# Story 4.3b: AI Content Generation — Dialog, Polling & Preview (s17)

Status: ready-for-dev

## ⚠️ Scope banner — read first

This is the **frontend half** of the AI content-generation pipeline (`epic-04.md:82-123`, screen **s17** `docs/classlite-entry/02c-teacher-content-grading.html:6232-6360`). It builds the **AI generation dialog** that opens from the exercise editor's three AI affordances, **polls the async job**, and lets the teacher **preview → accept / edit / dismiss** generated content before it enters the exercise.

**HARD-BLOCKED on Story 4.3a — do not start until 4.3a is `done`.** 4.3a owns the `jobs` table, the worker/Gemini pipeline, the `ai_credit_ledger`, and **both endpoints this story consumes**: `POST /api/exercises/{id}/ai-generate` (→ 202 `{jobId}`) and `GET /api/jobs/{jobId}` (→ typed `{status, result, errorDetails, …}`). All request/response types + Zod schemas arrive **pre-generated in `client.ts`** from 4.3a's `api.yaml`; this story never hand-writes API types (TS-2, XL-1) and adds **no backend code**.

**Inherits from 4.2 (`done`):** the two-panel `ExerciseEditorPage` at `/exercises/{id}/edit` (own Rolldown chunk under the `/exercises` `RouteRoleGate`), `editorStore`, `useExerciseAutosave` (FW-8 non-optimistic, `updated_at`-preconditioned PATCH — **this is how accepted content is persisted**, not a new mutation), the `SectionTypePicker` (currently **5 cards, no AI card** — this story adds the 6th "Generate section" AI card, `deferred-work.md:603`), the 5 question editors, and the `exercises.editor.*` i18n namespace with en/vi parity discipline.

**Reuse, don't reinvent:** insertion rides 4.2's autosave (accepted preview → merge into `content` → existing debounced PATCH, already `ValidateExerciseContentStructural`-gated server-side). Polling uses a **TS-3 query-key factory** (`['jobs', jobId]`) + `staleTime:0` (FW-3 justified — live job status) with **client-driven progressive backoff**, since a fixed refetch interval can't ramp 2→4→8s. No Zustand for server state (jobs live in Query — TS/FW rules).

## Story

As a Teacher (or Admin/Owner),
I want a dialog to configure an AI generation, watch its progress, and preview the result before it touches my exercise,
So that I can draft sections, questions, and distractors quickly while staying in control of what actually gets inserted.

## Acceptance Criteria

Adapted from `epic-04.md` Story 4.3 (the UI subset) + Failure-Path ACs + PRD FR-24/25/26 + s17.

**AC1 — Dialog opens in three modes with cost + credit counter shown before confirm (FR-24/25/26; epic AC1)**
**Given** the exercise editor, **When** the teacher triggers an AI affordance — **"Generate section"** (a 6th card added to `SectionTypePicker`), **"Generate questions"** (from a section), or **"Generate distractors/option"** (from an MCQ question) — **Then** the **s17 `AIGenerateDialog`** opens in the matching mode with the correct fields (section: **section-type chips · topic/material textarea · target-band chips · question-count chips · question-mix chips**; questions: **topic · type · count**; distractors: **difficulty · count** — `02c:6290-6339`), the **estimated credit cost is displayed before confirming** ("est. cost 1 credit"), and a **credit counter** ("N of 50 monthly AI credits used", `02c:6353`) is visible. Section-type chips align to the **editor's 5 supported types** (Reading/Listening/Writing/Speaking/Grammar; **Writing/Speaking = prompt-only "AI drafts the prompt"** per `02c:6299`; the mockup's "Vocabulary" chip stays deferred — matches 4.2). The param form is a **standard RHF + `zodResolver`** form (FW-8).

**AC2 — Confirm enqueues and polls with progressive backoff (epic AC2, AC3)**
**Given** a valid configuration, **When** the teacher confirms, **Then** the client `POST`s `/api/exercises/{id}/ai-generate` → receives `{ jobId }` (202) and begins polling `GET /api/jobs/{jobId}` with **progressive backoff 2s → 4s → 8s** (then holds at 8s), **reducing poll frequency while navigated away** (`architecture.md:246`). The dialog shows a **generating/loading state** (skeleton/spinner with an honest "Generating…" message) while `status ∈ {pending,processing}`. Polling **stops** on `complete`/`failed`/dialog-close/unmount (no leaked intervals).

**AC3 — Preview → accept / edit / dismiss (FR-24/25/26; epic AC4, AC5)**
**Given** the job reaches `complete`, **When** the result returns, **Then** the dialog renders a **preview** of the generated content (`02c:6342-6349` — e.g. "Passage 4 · 487 words · 14 questions: 7 T/F/NG · 7 gap-fill · keyed") with three actions: **Accept/Insert** → the generated fragment is **merged into the editor `content`** at the right place (new section appended / questions appended to the section / distractors set on the question) and **persisted via 4.2's autosave** (no new endpoint); **Edit** → insert then leave the teacher on the normal editor to adjust; **Dismiss/Cancel** → discard, nothing inserted. **Regenerate** re-runs the job (new enqueue → new credit cost). Accepted content immediately obeys the editor's normal validity/autosave rules.

**AC4 — Stuck job surface at 5 minutes (epic Failure-Path AC1)**
**Given** a job still `processing` after **5 minutes**, **When** polling continues, **Then** the UI shows **"Taking longer than expected"** with a **"Cancel and retry"** option (re-enqueue). (4.3a's stuck-sweep independently marks the row failed+refunds; the UI reflects whichever resolves first — a subsequent poll seeing `failed` shows AC5.)

**AC5 — Failure surfaces are distinct and honest (epic Failure-Path AC3, AC4)**
**Given** the job `status='failed'`, **When** polling sees it, **Then**: for a **retries-exhausted / provider failure** → **"Generation failed — please try again or create content manually"** with a **direct link to manual creation** (the normal add-section/question flow); for **`error_details='invalid_ai_response'`** → a **distinct message** that a **retry won't help — adjust the prompt/topic and regenerate** (never a bare "retry the same thing"). No raw HTTP codes or stack traces (UX-1). A failed generation **does not silently cost a credit** — 4.3a refunds; the UI may reflect the restored counter on next read.

**AC6 — Trilogy, i18n (both locales), a11y (UX-1, UX-2, TEST-FE-2)**
**Given** the dialog's states, **When** it loads / generates / errors, **Then** loading = honest generating state, empty/pre-run = the config form, error = human message + one action (all three per UX-1); **every string in `en.json` AND `vi.json`** under `exercises.ai.*` (parity test green) — dialog labels, chips, **est-cost + credit-counter** (ICU `{used} of {total}`, not concatenation — UX-2), preview summary, and the **three distinct failure messages** (whole Vietnamese sentences, never "Generation"+"failed"); dialog is **focus-trapped, returns focus to the trigger on close, `aria-live` announces generating→complete→failed transitions** (TEST-UX-2); numeric copy uses i18n interpolation/plurals (`t('exercises.ai.questionCount', {count})`).

**AC7 — Scope & safety inherited (UX-3, SEC-1)**
**Given** the dialog lives inside the `/exercises/{id}/edit` chunk, **When** access is evaluated, **Then** it is only reachable for a user who may edit the exercise (inherited 4.2 `RouteRoleGate` + teacher-own/owner-admin-any scope; students never download the chunk). A cross-scope enqueue **surfaces the server's 404/403 as a human error**, not a crash. The client shows the credit counter but **never trusts a client-side balance to gate** — the server authorizes (4.3a; the hard 402 limit is 6.5).

## Tasks / Subtasks

> **Pre-dev (mandatory):** confirm **4.3a is `done`** and `client.ts`/Zod carry `AIGenerateRequest`/`Job`/`JobStatus`/`AIGenerationResult` + the two endpoints. Read the s17 mockup `02c:6232-6360` (dialog layout, chips, preview, credit footer). Read 4.2's `useExerciseAutosave`, `editorStore`, `SectionTypePicker`, and the `exercises.editor.*` locale block. **No `api.yaml`/codegen in this story** (WF-3 — frontend-only).

### Frontend (classlite-web)

- [ ] **T1 — Job-polling hook (AC2, AC4, AC5)**
  - [ ] `features/exercises/hooks/useAiGenerationJob.ts` — `enqueue(mode, params)` → `POST …/ai-generate` (via generated client) → jobId; then poll `GET /jobs/{jobId}` with a **TS-3 key factory** `jobKeys = { detail: (id) => ['jobs', id] }`, `staleTime:0` (FW-3 comment: live status), **progressive backoff 2→4→8s** (compute `refetchInterval` from elapsed/attempt, ramp then hold; slower when `document.hidden`), stop on terminal/close/unmount. Expose `{ phase: idle|generating|preview|stuck|failed, result, errorKind, elapsedMs, regenerate, cancel }`. `errorKind` distinguishes `invalid_ai_response` from generic-failed (AC5). **5-min → `stuck`** (AC4). Never `useEffect`-fetch (FW-4).
- [ ] **T2 — s17 AIGenerateDialog + 3 modes (AC1, AC3, AC6, AC7)**
  - [ ] `features/exercises/AIGenerateDialog.tsx` — shadcn dialog (focus-trap, return-focus), header per mode, **RHF + `zodResolver`** param form (chips = controlled toggles), **est-cost + credit-counter** row, generating state, **preview panel** + **Accept/Insert · Edit · Dismiss · Regenerate** (`02c:6352-6357`). Mode-specific field sets (section/questions/distractors). Section-type chips = editor's 5 types (Writing/Speaking prompt-only helper; no Vocabulary). Barrel-export via `@/features/exercises`.
  - [ ] `AiGenerationPreview.tsx` — renders the `AIGenerationResult` fragment summary (counts/band) + the accept/edit/dismiss actions.
- [ ] **T3 — Wire the three affordances + insertion via autosave (AC1, AC3)**
  - [ ] Add the **6th "Generate section" AI card** to `SectionTypePicker` (4.2 shipped 5, no AI card) → opens dialog in `section` mode. Add **"Generate questions"** trigger on a section and **"Generate distractors/option"** on an MCQ question editor. On Accept: **merge the fragment into `content`** (append section / append groups to `sectionId` / set options on the questionId) and let **`useExerciseAutosave` persist it** (reuse — no new mutation; the merge respects the array-index ordering + structural validity 4.2 established). Guard: an incomplete/edited fragment still flows through the editor's normal state.
- [ ] **T4 — i18n + FE tests (AC1–AC7)**
  - [ ] `exercises.ai.*` in `en.json` + `vi.json`: dialog titles/subtitles per mode, field labels + chip labels, **est-cost + credit-counter (ICU `{used}/{total}`)**, generating message, preview summary (pluralized counts), **three distinct failure messages** (whole sentences) + stuck message + "create manually" link. `i18n-parity-coverage.test.ts` green; `npm run i18n-parity`.
  - [ ] Component tests (Vitest + **MSW at the HTTP boundary, never mock Query** — TEST-FE-1): **three-state** (TEST-FE-2); **enqueue→poll→complete→preview** (MSW returns 202 then pending→processing→complete across polls); **progressive backoff timing** (assert intervals ramp 2→4→8, not fixed — deferred MSW resolution + fake timers); **accept inserts + triggers autosave PATCH** (assert the fragment merged + one PATCH); **dismiss inserts nothing**; **stuck at 5min** shows the cancel/retry surface (fake timers); **failed** vs **invalid_ai_response** show **distinct** messages; **polling stops on unmount/close** (no leaked interval); role-negative — student never reaches the chunk (TEST-FE-6, inherited gate); `axe` (focus-trap, aria-live); `assertI18nParity`.
  - [ ] `tsc -b && eslint && vitest && npm run build` clean; editor chunk still isolated (`e2e/route-bundle-boundaries.spec.ts` green — the dialog ships inside the existing `/exercises/:id/edit` chunk, no new route).

### Close-out

- [ ] **T5 — Deferred-work + docs**
  - [ ] `deferred-work.md` **FU-4-3-B**: **From-Hub source-material drag-attach** in the topic field → Story 4.4 (4.3b is free-text only); **live credit-counter accuracy + the 402 hard-limit block + Settings→Credits UI** → Story 6.5 (4.3b displays the counter from the read endpoint but does not enforce a limit); **user-cancel refund semantics** (cancel-before-processing vs mid-processing, A6 matrix) → confirm with 6.5. No new env/service (WF-9 skip). Dev Agent Record + File List → sibling `4-3b-…-completion-notes.md`.

## Dev Notes

### Scope decisions (why this shape)

1. **Insertion reuses 4.2's autosave — it is NOT a new write path.** Accept merges the generated fragment into the same `content` document the editor already autosaves (FW-8 non-optimistic, `updated_at`-preconditioned). This gives us structural validation, 409 concurrency handling, and the save indicator for free — and keeps "preview before insert" honest (nothing persists until Accept).
2. **Jobs are server state → they live in Query, not Zustand (TS-3/FW-6).** The polling hook owns `['jobs', jobId]` with a client-driven backoff; a fixed `refetchInterval` can't ramp 2→4→8s, so compute it per attempt. `staleTime:0` is the one justified deviation (FW-3 comment required).
3. **Three failure messages are genuinely different actions (AC5).** Generic-failed → retry or go manual; `invalid_ai_response` → change the prompt (retry is pointless — 4.3a won't auto-retry it); stuck → cancel/retry. Collapsing them into one "try again" is a UX-1 violation and misleads the teacher.
4. **Section-type chips follow the editor's 5 types, not the mockup's chip set.** The mockup shows "Vocabulary" (`02c:6296`); 4.2 shipped Reading/Listening/Writing/Speaking/Grammar and deferred a Vocabulary decision — 4.3b stays aligned to what the editor can actually hold. Writing/Speaking are prompt-only (AI drafts the prompt text).
5. **The credit counter is display-only.** 4.3b reads and shows "N of 50"; the server authorizes generation and 4.3a records the ledger. The hard 402 limit + accurate live balance + reconciliation are 6.5 — do not fake a client-side gate.

### Reuse map

- **Insertion + persistence:** 4.2 `features/exercises/hooks/useExerciseAutosave.ts`, `stores/editorStore.ts`, the `content` merge helpers / `lib/questionTypes.ts` / `lib/sectionTypes.ts` (append-section / append-group / set-options), `ExerciseEditorPage.tsx` (host).
- **Triggers:** 4.2 `components/editor/SectionTypePicker.tsx` (add the AI card), `QuestionGroupCard.tsx` / `questions/McqQuestionEditor.tsx` (add generate-questions / generate-distractors triggers).
- **Query plumbing:** TS-3 key factory pattern (`features/exercises/api/exercisesKeys.ts`), `lib/api-fetch.ts` / query-client, generated `client.ts` + Zod (from 4.3a). `useGrading`-style polling is the sibling reference architecture calls out (`architecture.md:246,1007`) — none exists yet, so this hook is the first.
- **Dialog/primitives + tokens:** shadcn dialog, chips/toggle, `--cl-accent` Switch (`02c:522-532`); s17 mockup `02c:6232-6360`; skill colors `ux:220-223`.
- **i18n + tests:** `exercises.editor.*` parity discipline, `i18n-parity-coverage.test.ts`, MSW setup, `axe`, `e2e/route-bundle-boundaries.spec.ts`.

### Testing standards summary

- MSW at the HTTP boundary, never mock Query (TEST-FE-1); one `QueryClient` per test, `retry:false`. Three-state (TEST-FE-2). Fake timers for backoff-ramp + 5-min-stuck. Assert **accept → merge + exactly one autosave PATCH**, **dismiss → zero PATCH**, **poll stops on unmount** (no leaked interval — the classic hook leak). Distinct-failure-message assertions (generic vs invalid_ai_response). i18n both locales incl. ICU credit counter + three failure sentences (TEST-FE-4). axe: focus-trap + return-focus + aria-live (TEST-UX-2). Role-negative inherited (student can't reach the chunk).

### References

- [Source: epics/epic-04.md#Story-4.3] — dialog + cost + preview + question/distractor gen (88-114); Failure-Path stuck-5min (120), retries-exhausted-manual-link (122), invalid_ai_response-not-retried (123).
- [Source: prds/prd-classlite_new-2026-05-26/prd.md#FR-24..FR-26] — preview-before-insert, est-cost, credit-counter (446-464).
- [Source: docs/classlite-entry/02c-teacher-content-grading.html#s17] — dialog (6232-6360): 3 modes (6238), type/topic/band/count/mix fields (6290-6339), preview + est-cost (6342-6349), credit footer + actions (6352-6357), AI card in picker (6191).
- [Source: architecture.md] — 202+poll 2/4/8s + slower-when-away (246), `AIGenerateDialog.tsx` location (785), jobs Query key `['jobs',jobId]` (452), `useGrading` polling sibling (1007), FW-1/3/4 data rules.
- [Source: 4-2-… story] — `useExerciseAutosave` (FW-8 non-optimistic + `updated_at` precondition), `editorStore`, `SectionTypePicker` (5 cards, no AI), 5 question editors, `exercises.editor.*` en/vi parity; [4-3a-… story] — the two endpoints + `client.ts` contract this consumes.
- [Source: deferred-work.md] — FU-4-2-A → 4.3 carve-out (599-603): AI card + AIDialog(s17) + generate-option.
- [Source: docs/project-context.md] — TS-2/3/6, FW-1/3/4/6/8, UX-1/2/3, TEST-FE-1/2/4/6, TEST-UX-2, XL-1.

## Definition of Done

- [ ] 4.3a `done`; `client.ts`/Zod carry the two endpoints + `Job`/`AIGenerateRequest`/`AIGenerationResult`; no hand-written API types (TS-2/XL-1); **zero backend changes** in this story.
- [ ] s17 `AIGenerateDialog` opens in all 3 modes with correct fields + **est-cost + credit counter** shown before confirm; param form = RHF + zodResolver; section chips = editor's 5 types (Writing/Speaking prompt-only; no Vocabulary).
- [ ] Confirm → enqueue(202) → poll with **2→4→8s** backoff (slower when hidden); generating state; polling stops on terminal/close/unmount.
- [ ] Preview → **Accept inserts via 4.2 autosave** (section/questions/distractors merged correctly, one PATCH) / **Edit** leaves teacher in editor / **Dismiss inserts nothing** / **Regenerate** re-enqueues.
- [ ] **5-min stuck** surface (cancel/retry); **generic-failed** (manual link) vs **`invalid_ai_response`** (adjust-prompt) are **distinct** messages; no raw codes/traces.
- [ ] `exercises.ai.*` en/vi parity green (ICU credit counter, three failure sentences, pluralized counts); axe clean (focus-trap, return-focus, aria-live).
- [ ] `tsc -b && eslint && vitest && npm run build` clean; dialog ships inside the existing `/exercises/:id/edit` chunk (no new route; bundle-boundary e2e green). FU-4-3-B logged; dev record in sibling completion-notes.

## Out of Scope

- **All backend** (jobs table, worker, Gemini, ledger, endpoints) → **Story 4.3a**.
- **From-Knowledge-Hub source-material drag-attach** in the topic field → **Story 4.4** (free-text only here).
- **Accurate live credit balance, the hard 402 credit-limit block, Settings→Credits UI, add-on purchase** → **Story 6.5** (counter is display-only).
- **AI grading UI** (Writing/Speaking) → **Epic 6**.
- **User-cancel refund matrix** (before vs mid `processing`) → confirmed with 6.5; 4.3b's "cancel and retry" re-enqueues, it does not assert refund semantics.

## Change Log

| Date | Change |
|---|---|
| 2026-07-28 | Story created (ready-for-dev). **Split from 4.3** (Ducdo): 4.3b = frontend — s17 `AIGenerateDialog` (3 modes), job-polling hook (2/4/8s backoff, 5-min stuck), preview→accept/edit/dismiss inserting via 4.2 autosave, credit-counter UI, en/vi i18n, distinct failure surfaces. **HARD-BLOCKED on Story 4.3a** (endpoints + `client.ts`). No backend code. |
