# Story 7.4b: Anchored Q&A — Frontend (Student Rail + Teacher Console)

Status: done

---
story_id: "7.4b"
epic: 7
story_key: "7-4b-anchored-qa-frontend"
split_of: "7.4 → 7-4a (backend keystone, done) + 7-4b (frontend, this)"
baseline_commit: "0525e30"
sequence: "7-4a (done) → 7-4b (this)"
depends_on: ["7-4a (backend contract + tables + endpoints)", "5.2a (attempt-read/handle si:gi:qi)", "6.1 (essayAnchors selection primitives)", "7-2b/7-3b (people feature idiom)"]
---

## Story

As a **Student in an active attempt** and as a **Teacher answering questions**,
I want the **in-attempt Q&A sidebar (s36)** to ask anchored questions without leaving my attempt, and the **teacher Q&A console (s18)** to see, reply, resolve, and batch-answer questions across my classes,
so that the anchored Q&A system shipped in 7-4a becomes a usable end-to-end feature over its stable, adversarially-verified contract.

**Context:** 7-4a shipped the greenfield backend — `questions`/`question_replies` tables (FORCE-RLS), 6 endpoints on an open chain (Owner/Admin reach the handler and get an empty envelope), role-scoped reads, `personal`/`shared` visibility, batch reply, event seam. **This story is the sole consumer.** Ducdo ruled (2026-09-10, below) **keep 7-4b whole** (both role surfaces), **defer mobile** (s80/s85 → FU), **AC9 backend widening in-scope** (thin full-stack), **defer the standalone student list** to the Epic 8 dashboard. Read shapes were left **PROVISIONAL** by 7-4a for this story to co-finalize.

## Acceptance Criteria

### Student in-attempt sidebar (s36)

**AC1 (open panel, non-disruptive)** — **Given** a Student on `/assignments/:assignmentId/attempt` (`AttemptPage`, full-bleed outside `AppLayout`, `routes.tsx:874-899`), **When** they open Q&A via a `?questions=open` param (URL-state mirror `useSettingsTab.ts:29-46` — `useSearchParams` + `setSearchParams(next,{replace:true})`), **Then** a right-side `Sheet` (`components/ui/sheet.tsx`, currently unused) renders the anchored-Q&A rail **without unmounting or disrupting the attempt** (answer draft/timer/navigator state preserved — the panel is an overlay, never a route change). Closing deletes the param.

**AC2 (highlight → anchor)** — **Given** the panel open, **When** the student targets an item (`qwrap-${si}:${gi}:${qi}` DOM id, `ExerciseAttemptShell.tsx:327-336`) via an "? Ask about this" affordance, or selects passage text, or chooses "Whole exercise", **Then** a composer opens with an "Attach to: This item / Whole exercise" scope chooser producing the wire `QuestionAnchor`: item → `{sectionIndex, questionGroupIndex, questionIndex}`; passage span → `{sectionIndex, charStart, charEnd}` (offsets via `captureSelectionOffsets`/`normalizeAnchor`, `essayAnchors.ts:64-165`); whole-exercise → `anchorType='exercise'`, `anchorRef=null`. An **`anchorExcerpt` text snapshot** is captured at ask-time (authoritative for display). Anchor pin color: **orange = item**, **blue = exercise** (UX:370).

**AC3 (ask submit)** — **When** the student submits (content `maxLength 5000`, non-empty enforced client-side via zod + disabled button), **Then** `POST /api/questions` is called with `{assignmentId (from route param), anchorType, anchorRef?, anchorExcerpt?, content}` (**never** `classId/exerciseId/studentId` — server-derived, SEC-7). On `201` the thread list invalidates (`questionsKeys.all`, non-optimistic) and the new card shows **awaiting**. `404 QUESTION_TARGET_NOT_FOUND` / `403 INSUFFICIENT_ROLE` / `422 VALIDATION_ERROR` → the UX-1 error state (i18n message, one retry), never a raw code.

**AC4 (read own threads in-panel)** — **Given** the panel, **Then** the student sees **their own** questions for this exercise (`GET /api/questions?exercise_id=<derived>`) and each thread's replies (`GET /api/questions/{id}`), rendered as `AnchoredQuestionCard`s with orange/blue pins and, when answered, the teacher reply (author name + relative time). All in-panel — the attempt is never left (AC of §6.3, UX:369-373).

**AC5 (shared classmate read — AC9 end-to-end, FU-7-4-E backend)** — **Given** a teacher replied `shared` to a classmate's question, **When** an **actively-enrolled** classmate (not the asker) opens that thread, **Then** they see the question head + the **`shared` reply only** (never `personal` replies). A thread with **no `shared` reply** (personal-only, or unanswered) still `404`s a non-asker classmate (non-disclosure preserved). Delivered by widening the student branch of `GetQuestionForReader` (`questions.sql:59-73`) — see Task 1; `ListRepliesForReader` (`questions.sql:131-157`) already scopes replies correctly and needs **no change**.

### Teacher console (s18)

**AC6 (route + cross-class list)** — **Given** a Teacher, **When** they navigate to the **new top-level `/questions`** route (under `AppLayout`, `RouteRoleGate allowedRoles={['teacher']}`, `sectionNameKey='questions'`), **Then** `QuestionsConsolePage` lists **all questions across classes they teach** (`GET /api/questions`, service role-scoped — Teacher = `classes.teacher_id = me`) with each question's **anchored context** (excerpt + orange/blue pin) shown, paginated (`page`/`page_size` → `meta.pagination`).

**AC7 (unanswered filter)** — **Given** the console, **Then** an "Unanswered ▾" filter toggles `?unanswered=true`; resolved questions are excluded from that view and from the open count.

**AC8 (reply + visibility toggle)** — **Given** a question, **When** the teacher replies via the per-card composer with a **visibility toggle** — **"Private" → `personal`**, **"Shared with your class" → `shared`** (D5) — **Then** `POST /api/questions/{id}/replies {content, visibility, resolve:false}` inserts the reply and it appears in-thread below the question.

**AC9 (Send & resolve)** — **Given** the composer, **When** the teacher uses the combined **"Send & resolve"** action, **Then** the reply posts with `resolve:true` (question flips `open→resolved` in one tx, server-side) and the question drops from the unanswered queue (`questionsKeys.all` invalidate).

**AC10 (batch reply)** — **Given** the teacher multi-selects similar questions, **Then** a `BatchActionBar` shows **"N selected · similar questions"** with a combined reply; submit calls `POST /api/questions/batch-reply {questionIds, content, visibility, resolve?}` (max 50). It is **all-or-nothing**: any `404 QUESTION_NOT_FOUND` (a question the teacher doesn't teach) surfaces the error with **no local mutation** — never a partial-success UI.

**AC11 (standalone resolve)** — **Given** a question, **When** the teacher resolves it directly, **Then** `PATCH /api/questions/{id} {status:'resolved'}` runs and the question leaves the unanswered queue. Resolve is one-way (reopen deferred, FU-7-4-D).

### Contract + cross-cutting

**AC12 (role isolation — test what's absent, TEST-FE-6)** — **Then** `/questions` is unreachable by Student/Owner/Admin (route role-gate → `PermissionDenied`); the console and its controls are **absent from the DOM** (not merely hidden) for non-teachers; the student panel is student-only. Owner/Admin hitting the API already receive an empty envelope (7-4a) — no console duplicates that.

**AC13 (co-finalize PROVISIONAL read shapes)** — **Then** `Question` and `QuestionReply` in `api.yaml` are enriched with denormalized display fields — `Question.studentName` + `Question.studentAvatarUrl` (nullable), `QuestionReply.authorName` + `QuestionReply.authorAvatarUrl` (nullable) — the **PROVISIONAL** markers are stripped (mirror 7-2b/7-3b co-finalize), the store queries `LEFT JOIN users` to populate them, service/handler response structs carry them (GO-5 explicit nulls), and `scripts/codegen.sh` is re-run (sqlc + openapi-typescript + zod). No hand-edits to generated files (XL-1).

**AC14 (wire the AnchoredQuestionCard shell)** — **Then** the static domain shell `AnchoredQuestionCard` (`components/domain/AnchoredQuestionCard.tsx`, JSDoc already names "Epic 7 Story 7.4") gains the behavior it intentionally omitted: a **submit callback** (wire the dead reply button, `:156-161`), a **visibility toggle** (personal/shared), **anchor-pin color** (orange item / blue exercise), and a **textarea `maxLength`** (5000, matching the contract). It stays presentational — data + mutations live in the rail/console containers; wire types → card view-model mapping lives in the feature.

**AC15 (data idiom — clone people)** — **Then** a `src/features/questions/` feature mirrors `features/people/`: `api/questionsKeys.ts` (root `['questions']`, per-slot spreads for cascade invalidate), no-loader `useQuery` reads (`useQuestions`), `useMutation`+`invalidateQueries({queryKey: questionsKeys.all})` writes (`useQuestionActions`, **non-optimistic** — server truths), `apiFetch<T>`/`apiFetchWithMeta<T[], EnvelopeMetaPagination>` envelope-unwrap, explicit `staleTime` (FW-3). Generated types from `@/lib/api/client` (TS-2: never form state).

**AC16 (i18n + a11y + UX-1 trilogy)** — **Then** all strings are keys in **both** `en.json` **and** `vi.json` — a new `questions.*` namespace + `anchoredQuestion.*` extensions (visibility labels, pin labels) — held in parity (`i18n-parity-coverage.test.ts`); `SectionNameKey` gains `'questions'` (`PermissionDenied.tsx:45-57`) with copy in both locales. The rail and console each implement the **Loading (skeleton) / Empty / Error** trilogy (UX-1). `Sheet` focus-trap + return-focus-on-close and composer keyboard flow pass `axe` (TEST-FE-5, TEST-UX-2).

**AC17 (sidebar activation)** — **Then** the **teacher** sidebar "Questions" link (`sidebarNavConfig.tsx:89`, dead `/exercises/active?questions=open`) is repointed to `/questions` (mirror how `/students` was activated); the **student** sidebar "Questions" link (`:106`, fictional `/exercises/active/attempt?questions=open`) is **parked** (removed or disabled with a code comment) — students ask only in-attempt (FR-38); the standalone student "My questions" list is deferred to Epic 8 / Story 8.1 (s29 dashboard card) per D4.

## Tasks / Subtasks

- [x] **Task 1 — Backend: co-finalize read shapes + AC9 widening** (AC5, AC13) — *WF-1 sequence: `api.yaml` → `.sql` → `codegen.sh`*
  - [x] `api.yaml`: add `studentName`/`studentAvatarUrl` (nullable) to `Question` (~L8829); `authorName`/`authorAvatarUrl` (nullable) to `QuestionReply` (~L8873); **strip the `# PROVISIONAL` comments**. Mark new fields `nullable: true`, add to `required`.
  - [x] `internal/store/queries/questions.sql`: `LEFT JOIN users` in `ListQuestionsForReader`/`GetQuestionForReader`/`ListRepliesForReader` to select display name + avatar. **Widen** `GetQuestionForReader` student branch with: `student_id=reader OR (active enrollment in q.class_id AND EXISTS shared reply)`. `ListRepliesForReader` visibility branches unchanged (only the author LEFT JOIN added).
  - [x] `question_service.go` converters + `question_handler.go` `questionResponse`/`questionReplyResponse` structs: carry the new fields (GO-5 explicit nulls, no `omitempty`).
  - [x] `scripts/codegen.sh` (sqlc + openapi-typescript). `client.ts` regenerated; no hand-edits.
  - [x] **Adversarial store test** (`internal/test/question_ac5_widening_test.go`): classmate (active enrollment) reaches a `shared` thread via `GetQuestionForReader`; a **personal-only** or **unanswered** thread still `404`s the classmate; asker + teacher paths + owner/admin elision unchanged; + display-field enrichment assertion. `go build`/`vet`/`gofmt` clean; Q&A `go test ./internal/test ./internal/service ./internal/handler -race -p 1` green.
- [x] **Task 2 — `features/questions/` scaffolding** (AC15) — clone `features/people/api/`
  - [x] `api/questionsKeys.ts` (root `['questions']`; slots `list(params)`, `thread(id)`, `askMutation()`, `replyMutation()`, `resolveMutation()`, `batchReplyMutation()`).
  - [x] `api/useQuestions.ts` (list via `apiFetchWithMeta<Question[], EnvelopeMetaPagination>`; thread via `apiFetch<QuestionThread>`; explicit `staleTime`, `placeholderData: keepPreviousData`).
  - [x] `api/useQuestionActions.ts` (ask/reply/resolve/batch `useMutation` → `invalidateQueries({queryKey: questionsKeys.all})`; `JSON_HEADERS`; typed `ApiError`).
  - [x] `lib/questionAnchor.ts` (map `si:gi:qi` handle ↔ `QuestionAnchor`; passage-span builder) + `lib/questionSchemas.ts` (zod composer forms — TS-2 form types are zod-inferred) + `lib/questionCardModel.ts` + `lib/questionFormat.ts`.
  - [x] `api/__tests__/questionHandlers.ts` (MSW builders over generated wire types, `envelope()`/paginated helpers — mirror `enrolmentHandlers.ts`).
- [x] **Task 3 — Wire `AnchoredQuestionCard`** (AC14) — extended the domain shell: controlled submit + send-&-resolve callbacks, personal/shared visibility toggle, orange/blue pin (`role="img"`), `maxLength=5000`, real i18n keys; view-model mapper `Question`+replies → card props in the feature (card stays presentational).
- [x] **Task 4 — Student in-attempt panel (s36)** (AC1–AC4) — `StudentQuestionPanel` mounted in `ExerciseAttemptShell`; `?questions=open` `useSearchParams` URL-state (replace:true); right-side `Sheet` (modal, focus-trap); scope chooser (item/exercise/passage) + passage capture over `essayAnchors` on `[data-qa-passage]`; orange/blue pins; own-thread read (`StudentQuestionThread`); UX-1 trilogy.
- [x] **Task 5 — Teacher console (s18)** (AC6–AC11) — `QuestionsConsolePage.tsx` + `/questions` route + `RouteRoleGate`; `AnchoredQuestionsRailShell` (domain) + `BatchActionBar` (domain) + `TeacherQuestionCard` (feature wrapper: per-card RHF reply/visibility/send-&-resolve, standalone resolve, multi-select); "Unanswered" filter; batch all-or-nothing; UX-1 trilogy.
- [x] **Task 6 — Sidebar + i18n + section-key** (AC12, AC16, AC17) — teacher link → `/questions`; student link parked (comment referencing D4/Epic 8); `questions.*` + `anchoredQuestion.*` keys in `en.json` **and** `vi.json`; `SectionNameKey += 'questions'` + `PermissionDenied` copy both locales.
- [x] **Task 7 — Tests + gates + docs** (all ACs) — 26 questions tests green: three-state trilogy (TEST-FE-2), i18n both locales (TEST-FE-4), **role-absence** (TEST-FE-6 — console absent for student/owner/admin), `axe` (TEST-FE-5), ask SEC-7 body + batch all-or-nothing + reply/send-&-resolve body assertions; `STORY_7_4B_KEYS` parity. `tsc -b` = 0; touched-area regression (100 tests) green. `FU-7-4-F` filed, `FU-7-4-E` resolved. Dev Agent Record + File List → sibling `7-4b-anchored-qa-frontend-completion-notes.md`.

## Dev Notes

### Ducdo rulings (2026-09-10)
- **D1 (7-4b) — Keep whole.** One story covers the student in-attempt sidebar (s36) **and** the teacher console (s18) **and** the FU-7-4-E backend widening. Not split into 7-4b/7-4c.
- **D2 (7-4b) — Defer mobile.** `MobileQAThread` (s80) + `MobileQuestionReplyComposer` (s85) are a **distinct component tree** (UX-4, chat-bubble not responsive-squish) → **FU-7-4-F**. This story ships the desktop rail/console with Tailwind responsive-min (readable at 390px), not the purpose-built mobile tree.
- **D3 (7-4b) — AC9 backend widening in-scope.** Delivering the classmate-visible `shared` thread (AC5) requires widening `GetQuestionForReader` + `codegen.sh` (no new endpoint/param) — this makes 7-4b **thin full-stack**. Matches the 7-4a code-review D2→opt1 that earmarked FU-7-4-E for this story.
- **D4 (7-4b) — Defer the standalone student list.** Students ask only in-attempt (FR-38); a standalone student "My questions" page has no ask affordance. The real standalone read surface is the **s29 dashboard "My questions" card** (Epic 8 / Story 8.1). Park the dead student sidebar link; do **not** build a student list page here.
- **D5 (co-finalize consequence, Amelia — flagged for confirmation at dev pickup).** The teacher console cannot render "who asked" and the rail cannot render "who replied" from the current read shapes (`studentId`/`authorId` uuids only). Co-finalizing the PROVISIONAL shapes (AC13) therefore **enriches** them with denormalized display name + avatar via a `LEFT JOIN users`. This is the standard 7-2b/7-3b co-finalize move and a project-context "end-to-end working" requirement — but it is an Amelia decision, not an explicit epic AC. If a leaner shape is preferred (e.g. a separate people lookup), raise it before Task 1.

### Backend contract to consume (7-4a — verified)
- **Endpoints** (all on the open chain `extractTenant→requireVerified→requireCenter→ErrorMapper`, `main.go:641-657` — **no** role gate; Owner/Admin reach the handler):
  - `POST /api/questions` → 201 `EnvelopeQuestion`; errors 403 `INSUFFICIENT_ROLE` (non-student), 404 `QUESTION_TARGET_NOT_FOUND` (not attempt-owner/not-enrolled), 422 `VALIDATION_ERROR`.
  - `GET /api/questions?exercise_id=&class_id=&status=&unanswered=&page=&page_size=` → 200 `EnvelopeQuestionList` (role-scoped, empty for owner/admin — never null/403).
  - `GET /api/questions/{id}` → 200 `EnvelopeQuestionThread`; 404 `QUESTION_NOT_FOUND` (non-disclosure).
  - `POST /api/questions/{id}/replies {content, visibility, resolve?}` → 201 `EnvelopeQuestionReply`; 403 (student), 404 (owner/admin/non-teaching-teacher), 422.
  - `PATCH /api/questions/{id} {status:'resolved'}` → 200 `EnvelopeResolveResult`; 404 (non-teaching), 422 (status≠resolved).
  - `POST /api/questions/batch-reply {questionIds, content, visibility, resolve?}` (max 50) → 201 `EnvelopeQuestionReplyList` (plain `EnvelopeMeta`, **not** paginated); all-or-nothing 404.
- **Generated types** (`client.ts:3189-3284`): enums `QuestionStatus`(open|resolved), `QuestionVisibility`(personal|shared), `QuestionAnchorType`(item|exercise); `QuestionAnchor{schemaVersion(readOnly), sectionIndex, questionGroupIndex|null, questionIndex|null, charStart|null, charEnd|null}`; `Question`, `QuestionReply`, `QuestionThread`; stable request bodies `AskQuestionRequest`/`ReplyRequest`/`ResolveQuestionRequest`/`BatchReplyRequest`; envelopes per type.
- **Pagination:** query `page`+`page_size` (snake) → `meta.pagination{page,pageSize,total,totalPages}` (camel). Use `apiFetchWithMeta` for the list, `apiFetch` for singletons (unwraps `.data`, TS-4).

### Frontend reuse map — cite, do not reinvent
- **Data idiom:** `features/people/api/peopleKeys.ts` (key factory), `useEnrolment.ts` (no-loader `useQuery`, header comment "ZERO loader-prefetch — component owns the UX-1 trilogy"), `useEnrolmentActions.ts` (`useMutation` + `invalidateQueries(peopleKeys.all)`, non-optimistic, `JSON_HEADERS`). `apiFetch`/`apiFetchWithMeta` at `lib/api-fetch.ts:156-166,214`.
- **URL-state panel:** `features/settings/hooks/useSettingsTab.ts:29-46` (`useSearchParams` + `setSearchParams(next,{replace:true})`, delete param for default). `Sheet` at `components/ui/sheet.tsx` (base-ui dialog; `side="right"`; exports `Sheet/SheetContent/SheetHeader/...`; **currently zero consumers**).
- **Attempt handle + selection:** `features/quiz-attempt/lib/attemptContent.ts:50-73` (`si:gi:qi` handle, `parseHandle`, `flattenQuestions`); `ExerciseAttemptShell.tsx:205-246,327-336` (`qwrap-${handle}` ids, `focusQuestion`). Passage-span offsets: `lib/essayAnchors.ts:64-165` (`captureSelectionOffsets`, `normalizeAnchor`, UTF-16 clamp-safe; **server parity**). Mouseup composer precedent: `WritingGradingPage.tsx:228-327` (durable draft `{anchorStart,anchorEnd,rectTop,rectLeft,...}` + `getBoundingClientRect` positioning + cancel clears selection).
- **Shell to wire:** `components/domain/AnchoredQuestionCard.tsx` — props `{question, onRequestAiSuggest?}`; static shell (submit button at `:156-161` has **no onClick**; no visibility toggle; no pin; no `maxLength`; `anchoredExcerpt.location` is a human string in the fixture). Keep it domain + presentational.
- **Domain components to build:** `AnchoredQuestionsRailShell` (layout-only rail: count + filter head + inner stack, states default/empty — `component-inventory.md:136`), `BatchActionBar` ("N selected · similar Q3" strip — `:141`). Feature-local (anchor logic coupled): `QuestionAnchorPin` (orange/blue dot, `:138`), `QuestionAnchorHighlight` (span highlight, `:139`).
- **Route + gate:** `routes.tsx` (add `/questions` under `AppLayout`, `RouteRoleGate allowedRoles={['teacher']}` mirror the people routes); `PermissionDenied.tsx:45-57` `SectionNameKey` union + `isTeacherOnly` branch (`:71-73`). Sidebar `sidebarNavConfig.tsx:89,106`.
- **i18n:** flat dot-keyed `translation` namespace in `src/locales/{en,vi}.json` (loaded `lib/i18n.ts`); `anchoredQuestion.*` already has 5 keys (`en.json:548-552`); no `questions.*` yet. Parity enforced by `src/lib/test/__tests__/i18n-parity-coverage.test.ts`.
- **Tests:** no shared `renderWithQuery` — local `render*` per file (`createTestQueryClient` + `I18nextProvider i18n` + `QueryClientProvider` + `MemoryRouter`); MSW `server` from `@/test/msw-server`, `server.use(...)` per case; session seeded into cache via `queryClient.setQueryData(authKeys.session(), ...)`. Precedent: `features/people/__tests__/StudentsCenterPage.test.tsx:65-94`, `StudentRoutesGate.test.tsx`.

### Anchor mapping (D2) — the frontend half of the 7-4a positional model
The `ExerciseAttemptShell` handle is `${section}:${group}:${question}` and the wire anchor is `{sectionIndex, questionGroupIndex, questionIndex}` — **direct 1:1 map** (Task 2 `lib/questionAnchor.ts`). The exercise is `EXERCISE_LOCKED` once a submission exists (`attemptContent.ts:9-15`), so indices are stable during an attempt. `schemaVersion` is `readOnly` (server stamps `1`) — never send it. The `anchorExcerpt` snapshot is display-authoritative; the positional path is best-effort re-highlight (D2 accepts R28 wrong-section-after-edit as low with the excerpt mitigation).

### Visibility labels (author these — UX gives only the shared side)
`shared` → **"Shared with your class"** (UX:372,498, verbatim). `personal` → **"Private"** (UX says only "vs private" with no chip label — author "Private" en / "Riêng tư" vi). Do **not** invent other enum values — the contract is `personal|shared` only.

### Deferrals (file in Task 7)
- **FU-7-4-F** — Mobile Q&A tree: `MobileQAThread` (s80, chat-bubble, inline bottom composer) + `MobileQuestionReplyComposer` (s85, + AI-suggest bottom sheet). Distinct component tree per UX-4 (`component-inventory.md:269-274,310`). P2.
- **Carried from 7-4a (not this story):** FU-7-4-A inbox→Epic 10, FU-7-4-B dashboard "Unanswered" rail→Epic 8, FU-7-4-C reply edit/delete, FU-7-4-D reopen resolved, AI-suggest reply (Epic 10 inbox — the `onRequestAiSuggest` shell prop stays chrome-only here).
- **Standalone student "My questions" list** → Epic 8 / Story 8.1 (s29 dashboard card), D4.

### Project Structure & Workflow Notes
- **WF-1 sequence (this story touches backend):** `api.yaml` → `scripts/codegen.sh` → backend struct/query edits → frontend consumes regenerated `client.ts`. **WF-3:** a `.sql` file is touched → `codegen.sh` is the **last** script run before FE work. Additive read-shape fields + one query widening = additive/non-breaking; sole consumer is this story → single commit (mirror 7-2b/7-3b co-finalize), no atomic cross-service PR ceremony.
- No cross-feature deep imports (TS-7 — barrel `@/features/questions`). New feature dir `src/features/questions/` (kebab feature dir, `component-inventory` tiers: shells domain, anchor components feature).
- Generated files read-only (XL-1): `client.ts`, `store/generated/`.

### References
- Story spec (backend): [Source: _bmad-output/implementation-artifacts/7-4a-anchored-qa-backend.md] (ACs, 7-4b handoff L169-174, anchor shape L144-157)
- FU-7-4-E gap: [Source: _bmad-output/implementation-artifacts/deferred-work.md:993]; store `questions.sql` `GetQuestionForReader`(59-73)/`ListRepliesForReader`(131-157)
- Epic: [Source: _bmad-output/planning-artifacts/epics.md#Story-7.4] (L2593-2645); FR-38/39/40 (L326-328)
- UX: [Source: _bmad-output/planning-artifacts/ux-design-specification.md] §6.3 (365-374), s18 (482), s36 (498), mobile (612-623)
- Components: [Source: _bmad-output/planning-artifacts/component-inventory.md] (136-141, 269-274, 292-293, 327-328)
- Rules: project-context.md — TS-1..8 (nulls/keys/envelope/401/Bearer), FW-1..8 (loader/optimistic/staleTime/useEffect-ban), UX-1..4 (trilogy/i18n/role/mobile), TEST-FE-1..6, XL-1..3, WF-1/3/4; `docs/bmad-story-conventions.md`, `reference_atdd_red_convention`, `reference_web_typecheck_gate_is_tsc_b` (use `tsc -b`).
- Precedent stories: 7-2b/7-3b (people feature idiom + PROVISIONAL co-finalize), 5.2a (attempt handle), 6.1 (essayAnchors), 1d-4 (AnchoredQuestionCard shell).

## Definition of Done
- All 17 ACs met; 7 tasks checked.
- **Student:** `?questions=open` opens the Sheet over `AttemptPage` without disrupting the attempt; highlight→anchor (item orange / exercise blue) ask works; own threads read in-panel; a classmate sees a `shared` reply thread but not personal-only/unanswered (AC5).
- **Teacher:** `/questions` lists cross-class questions; Unanswered filter; reply + Private/Shared toggle; Send & resolve; batch reply (all-or-nothing); standalone resolve; console absent from DOM for non-teachers.
- **Backend:** `GetQuestionForReader` widened + adversarial store test green (classmate shared-visible; personal-only/unanswered 404); read shapes enriched (display name/avatar) + PROVISIONAL markers stripped; `go build/vet` clean, Q&A `go test -race -p 1` green (except the pre-existing `Spawn` date-bomb).
- **Contract:** `scripts/codegen.sh` re-run; `client.ts` regenerated, no hand-edits; **`tsc -b` = 0** (checks test files).
- **FE quality:** UX-1 trilogy on rail + console; i18n `questions.*`+`anchoredQuestion.*` in both locales (parity test green); role-absence tests (TEST-FE-6); `axe` clean; Sheet focus-trap/return.
- FU-7-4-F filed. Dev Agent Record + File List → sibling completion-notes (story stays the spec, <600 lines).

## Out of Scope
- **Mobile** chat-bubble tree (s80/s85) → FU-7-4-F.
- **Standalone student "My questions"** list page → Epic 8 / Story 8.1 (s29). Student Q&A here is in-attempt only.
- In-app **Inbox** items (FU-7-4-A → Epic 10); teacher dashboard **"Unanswered" rail** (FU-7-4-B → Epic 8); **AI-suggest** reply (Epic 10 — `onRequestAiSuggest` stays chrome).
- Reply **edit/delete** (FU-7-4-C), **reopen** resolved (FU-7-4-D), **@mention**/attachments (7-2 deferrals).
- Any **new** Q&A endpoint or mutation-body change — mutation bodies are stable (7-4a); this story only enriches read shapes + widens one read query.
- Anchoring **outside an attempt** (teacher-authored/library questions) — students ask during attempts only (FR-38).

## Review Findings

_Code review 2026-09-11 (`/bmad-code-review 7-4b`, Amelia). 3-layer adversarial (Blind Hunter · Edge Case Hunter · Acceptance Auditor). All 17 ACs Met or Partial — no Critical/High confirmed. 4 Blind-Hunter findings dismissed as diff-only false positives (teacher footer never derefs `teacherReply`; `ListRepliesForReader` carries its own visibility+enrollment predicate; the anchor no-op is covered by `submitDisabled`; replies are `ORDER BY created_at ASC`)._

### Decision-needed (resolved — Ducdo 2026-09-11)
- [x] [Review][Decision] Passage-selection auto-opens the Q&A Sheet mid-attempt — **RESOLVED: keep auto-open per AC2** ("selects passage text → composer opens"). No change. `StudentQuestionPanel.tsx:97-126`
- [x] [Review][Decision] Teacher can reply to / "Send & resolve" an already-resolved thread — **RESOLVED: gate the composer off when `state==='answered'`/resolved** (→ patch below). `AnchoredQuestionCard.tsx:187`
- [x] [Review][Decision] AC5 widening discloses asker name + verbatim question to enrolled classmates — **RESOLVED: visible to the class on a shared answer is intended** (class-forum semantics). No change. `questions.sql:70-92`
- [x] [Review][Decision] Timestamps render absolute, not AC4 "relative time" — **RESOLVED: accept absolute (pragmatic interpretation of the AC absolute).** The raw-ISO fix (patch below) still applies. `questionFormat.ts`

### Patch
- [x] [Review][Patch] Gate the teacher reply composer off on resolved threads — hide/disable the composer + visibility toggle + Send&resolve when the card `state==='answered'` (decision D2) [`AnchoredQuestionCard.tsx:187`, `TeacherQuestionCard.tsx`]
- [x] [Review][Patch] Question card renders raw ISO `askedAt` — the mappers never set `askedAtLabel`, and `toTeacherCardModel` isn't even given a formatter [`questionCardModel.ts:54,83` → `AnchoredQuestionCard.tsx:167`]
- [x] [Review][Patch] Standalone resolve errors are swallowed (no UX-1 surface) — `resolveMutation.error` is never read/rendered [`TeacherQuestionCard.tsx:86`]
- [x] [Review][Patch] Open-count badge is page-local, not the queue total — derive from `meta.pagination.total` (true under the unanswered filter) [`QuestionsConsolePage.tsx:92-95,134`]
- [x] [Review][Patch] Stale `page` beyond `totalPages` strands the console on an empty page — clamp `page` when `totalPages` shrinks (resolve last unanswered on page 2+) [`QuestionsConsolePage.tsx:42,96,186`]
- [x] [Review][Patch] `StudentQuestionThread` swallows thread-fetch errors → false "awaiting" — no `thread.isError` branch [`StudentQuestionThread.tsx:16-22`]
- [x] [Review][Patch] No client-side batch max-50 cap — `selected` is unbounded; oversize batch → generic error [`QuestionsConsolePage.tsx:43,77`]
- [x] [Review][Patch] Stale cross-page/filter selection carried into batch reply — `selected` not pruned on page/filter change [`QuestionsConsolePage.tsx:43,45-51,197,210`]
- [x] [Review][Patch] Reply composer stays enabled while a standalone resolve is in-flight — composer `submitting` uses `replyMutation.isPending` not `busy` [`TeacherQuestionCard.tsx:111`]
- [x] [Review][Patch] Duplicated `5000` content-max constant across three files — `REPLY_CONTENT_MAX`/`CONTENT_MAX`/`QUESTION_CONTENT_MAX` [`AnchoredQuestionCard.tsx:39`, `BatchActionBar.tsx`, `questionSchemas.ts`]
- [x] [Review][Patch] Double error-key lookup with non-null assertion — compute the key once [`QuestionsConsolePage.tsx:126`, `TeacherQuestionCard.tsx:113-114`]

### Deferred
- [x] [Review][Defer] Per-thread N+1 fetch in the student rail — each `StudentQuestionThread` calls `GET /api/questions/{id}`; avoiding it needs the list to embed replies (a contract change), out of scope per "no new endpoint or mutation-body change" [`StudentQuestionThread.tsx:16`] — deferred, needs contract change

## Change Log
| Date | Version | Description | Author |
|---|---|---|---|
| 2026-09-10 | 0.1 | Story drafted — 7.4 frontend consumer over the 7-4a contract. 3-agent parallel recon (backend contract + FU-7-4-E gap · frontend surface/idiom · UX s18/s36 + component-inventory). 4 Ducdo rulings (D1 keep-whole · D2 defer mobile→FU-7-4-F · D3 AC9 backend widening in-scope · D4 defer standalone student list→Epic 8) + D5 co-finalize=enrich-with-display-names (Amelia, flagged). 17 ACs / 7 tasks. | Amelia |
| 2026-09-11 | 1.0 | Implemented → review. D5 confirmed=enrich (display name+avatar via LEFT JOIN users). Thin full-stack, single commit: backend read shapes enriched + `GetQuestionForReader` AC5 widening + adversarial store test (FU-7-4-E discharged); `features/questions/` (people idiom) + `AnchoredQuestionCard` wired + student rail (s36) + teacher console (s18) + 2 domain shells + `/questions` route/sidebar/section-key + i18n both locales. Gates: go build/vet/gofmt clean, Q&A `-race -p 1` green; web `tsc -b`=0, 26 questions tests + 100-test touched-area regression green. FU-7-4-F filed. Dev record → sibling completion-notes. | Amelia |
| 2026-09-11 | 1.1 | review → done via `/bmad-code-review 7-4b` (Amelia). 3-layer adversarial (Blind Hunter · Edge Case Hunter · Acceptance Auditor); all 17 ACs Met/Partial, no Critical/High. 4 decisions (Ducdo): keep passage auto-open per AC2 · gate teacher composer off on resolved (→patch) · asker identity visible to class is intended · accept absolute timestamps. 11 patches applied: raw-ISO askedAt label into both card mappers, resolved-state composer gate, swallowed resolve-error surfaced, open-count from true meta total (separate unanswered query), page clamp on shrink, StudentQuestionThread error state, batch max-50 client cap + tooMany i18n, stale-selection clear on page/filter change, composer disabled during resolve, single-sourced 5000 content-max, compute-once error keys. 3 new i18n keys both locales + parity. 4 dismissed (diff-only false positives). 1 deferred (student-rail N+1 → deferred-work.md). Gates: `tsc -b --force`=0, 833 tests green (questions feature + i18n parity). Frontend-only — no backend/codegen touched. Changes UNCOMMITTED. | Amelia |
