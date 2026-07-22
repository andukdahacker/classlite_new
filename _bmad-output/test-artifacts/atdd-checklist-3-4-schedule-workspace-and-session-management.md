---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation', 'step-03-verify-red']
lastStep: 'step-03-verify-red'
lastSaved: '2026-07-21'
storyId: '3.4'
storyKey: '3-4-schedule-workspace-and-session-management'
storyFile: '_bmad-output/implementation-artifacts/3-4-schedule-workspace-and-session-management.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-3-4-schedule-workspace-and-session-management.md'
generatedTestFiles:
  - 'classlite-api/internal/test/sessions_rls_test.go'
  - 'classlite-api/internal/handler/session_handler_atdd_test.go'
  - 'classlite-web/src/features/schedule/__tests__/SchedulePage.test.tsx'
  - 'classlite-web/src/features/schedule/__tests__/MySchedulePage.test.tsx'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-4-schedule-workspace-and-session-management.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md (R19)'
  - '_bmad-output/test-artifacts/test-design/test-design-progress.md (J19-001..004)'
  - 'classlite-api/internal/test/_TEMPLATE_rls_test.go, classes_rls_test.go, story_3_1_helpers.go'
  - 'classlite-api/internal/handler/class_handler_atdd_test.go'
  - 'classlite-api/internal/clock/clock.go (MockClock — pre-anticipates ScheduleService)'
  - 'classlite-web/src/features/classes/__tests__/TemplatesIndexPage.test.tsx'
---

# ATDD Checklist — Story 3.4: Schedule Workspace & Session Management

**Risk-gate:** R19 (DATA, 3×2 = **6**) — recurring "Apply to…" scope leak. Epic 3's ONLY risk ≥6. Per WF-8 this red-phase MUST be on the branch before `backlog → in-progress`. **DONE.**

**Convention:** genuinely-red (NOT `t.Skip()`/`test.skip()`). Two red modalities used:
- **runtime-red** — compiles, fails at runtime on the missing table (`relation "sessions" does not exist`).
- **compile/import-red** — references the not-yet-existing production surface (per Ducdo 2026-07-21 "full typed suite now, accept red build"). This is the strongest ATDD signal: the test pins the exact contract the implementation must satisfy.

**Frozen clock:** `frozenNow = 2026-08-15T00:00:00Z`. Series seeded as PAST `{08-02, 08-09}` + FUTURE `{08-16, 08-23, 08-30}` so the past/future boundary is deterministic (Murat BLOCKER-4). The service MUST take a `clock.Clock` (the `clock` package doc already names "ScheduleService: recurring session expansion, session boundaries").

---

## Generated red files & verified signals

| # | File | Red modality | Verified signal | Green task |
|---|---|---|---|---|
| 1 | `internal/test/sessions_rls_test.go` | runtime-red | `go test ./internal/test/ -run TestRLS_Session*` → **FAIL** `relation "sessions" does not exist (42P01)` ✅ ran | Task 1 (migration) |
| 2 | `internal/handler/session_handler_atdd_test.go` | compile-red | `go vet ./internal/handler/` → **1** undefined: `test.NewSessionTestServerBareMux` ✅ verified (single honest symbol) | Tasks 1–5 |
| 3 | `web/.../schedule/__tests__/SchedulePage.test.tsx` | import-red + type-red | `vitest run` → **FAIL** `Failed to resolve "@/features/schedule/SchedulePage"`; `sectionNameKey="schedule"` not in `SectionNameKey` ✅ ran | Task 8 (page), Task 11 (`SectionNameKey`) |
| 4 | `web/.../schedule/__tests__/MySchedulePage.test.tsx` | import-red | `vitest run` → **FAIL** `Failed to resolve "@/features/schedule/MySchedulePage"` ✅ ran | Task 9 |

> The editor LSP also flagged `@/lib/i18n`, `@/test/msw-server`, `ClassesPage` implicit-`any`/`Set<string>` — those are the **stale-generated-`client.ts` footgun** (3.1/3.2/3.3 precedent); Vite/vitest resolves them fine. CLI is authoritative.

---

## R19 scope matrix — the mandatory core (backend #2)

Each cell asserts BOTH the in-scope change AND every out-of-scope row byte-unchanged (per-scope negative-space — Murat BLOCKER-2). Semantics = **past-immutable** (party-mode reversal of "all includes past").

- [ ] **J19-001** `TestSession_Scope_This_OnlyTargetChanges` — edit `this` on 08-23 → only 08-23 changes; `{08-02,08-09,08-16,08-30}` intact.
- [ ] **J19-002 + J19-005** `TestSession_Scope_Future_TargetAndLaterOnly_BoundaryInclusive` — edit `future` on N=08-23 → N **and** 08-30 change (the `>=` INCLUDES N); earlier-future 08-16 unchanged; past unchanged. *(J19-005 is the off-by-one boundary the risk lives in.)*
- [ ] **J19-003 (rewritten)** `TestSession_Scope_All_FutureOnly_PastImmutable` — edit `all` → future `{08-16,08-23,08-30}` change; past `{08-02,08-09}` **immutable** (no retroactive history rewrite → protects 3.5 attendance).
- [ ] `TestSession_Edit_PastTarget_Rejected` — `this` on a past occurrence → **422 `SESSION_ALREADY_STARTED`**, row unmutated.
- [ ] `TestSession_Cancel_Future_NegativeSpace` — cancel `future` → future rows `status=cancelled` but **kept** (FR-17); earlier-future + past stay `scheduled`.
- [ ] `TestSession_Delete_All_FutureOnly_PastKept` — delete `all` → future rows gone; **past rows survive** (no attendance orphan).
- [ ] **J19-004** `TestSession_Concurrent_StaleUpdate_Conflict` — second edit with a stale `expectedUpdatedAt` → **409 `SESSION_CONFLICT`**; winner's value stands. *(This is why an `updated_at` optimistic guard is mandatory — there is no other oracle for "no corruption".)*

## Cross-teacher + role isolation (backend #2)

- [ ] `TestSession_CrossTeacher_404_AndListAbsent` — teacherA on teacherB's class session → GET/PATCH/DELETE **404 `SESSION_NOT_FOUND`**; teacherA's LIST array **OMITS** B's sessions (absent, not hidden — the likeliest real leak, Murat BLOCKER-6; RLS only isolates tenants).
- [ ] `TestSession_Student_Forbidden_AllVerbs` — student → **403 `INSUFFICIENT_ROLE`** on GET-list / GET-detail / POST / PATCH / DELETE.

## Recurrence bound + list window (backend #2)

- [ ] `TestSession_Recurrence_RequiresEndDate` — recurring POST w/o `endDate` → 422.
- [ ] `TestSession_Recurrence_CapExceeded` — daily to 2027-12-31 (>200) → **422 `RECURRENCE_LIMIT_EXCEEDED`**. *(Green must also add the 200-OK / 201-→422 boundary trio.)*
- [ ] `TestSession_List_RangeTooWide` — 365-day range → **422 `SCHEDULE_RANGE_TOO_WIDE`** (Winston window cap).
- [ ] `TestSession_Get_SeriesCounts` — `GET /{id}` returns `series:{total:5, upcoming:3, completed:2}` (the scope-UI count oracle).

## RLS grid (backend #1 — runtime-red, ran)

- [ ] 6-pattern J15 grid: CrossTenantRead / Insert(WITH CHECK) / Write(0-rows) / Delete(0-rows) / NullTenant / UnsetTenant.
- [ ] `TestRLS_Session_TenantCannotReparentOwnRow` — WITH CHECK on UPDATE.
- [ ] `TestSessions_ClassDeleteRestrict` — `class_id ON DELETE RESTRICT` blocks deleting a class with sessions (Winston fold).

## Frontend role-negative (FE #3, #4 — import-red, ran)

- [ ] `SchedulePage.test.tsx`: teacher/owner see `schedule-workspace`; **student → PermissionDenied, `schedule-workspace` ABSENT** (TEST-FE-6).
- [ ] `MySchedulePage.test.tsx`: student sees `my-schedule-placeholder` + `mySchedule.empty.headline`; NOT the staff workspace; no `role="alert"`, no `schedule-skeleton` (empty-state, not error/spinner).

---

## Coverage completed inline during GREEN (Task 6/12 — mandatory, not discretionary)

R19 forced full backend rigor up front; the following round out the suite and are authored as the service/handler/UI land (each has its oracle pinned above or in the story):
- Recurrence cap **200-OK / 201-→422** boundary trio; `weekly`+`custom` multi-weekday occurrence counts; `recurrence_tz` stamped; `ends_at>starts_at`.
- `recurrence.go` **pure occurrence-generator unit table** (prefer lowest level — daily/weekly/custom/endDate inclusivity).
- Audit-row emission per verb (`session.created/.updated/.cancelled/.deleted`), envelope `{data,meta}` + className/classColor JOIN, `[from,to)` straddle boundary.
- FE: three-state per screen **incl. the modal trilogy** (class-select skeleton / zero-classes empty / async submit-error+retry+preserve); calendar view render + mini-month↔grid sync + keyboard-create + roving focus + hidden linear list; `RecurrenceScopeConfirm` safe-default + `{{date}}`/`{{count}}` + danger confirm; overlap width-split; cancelled pill+aria distinct from past; axe each screen; `route-bundle-boundaries` (no calendar leak into student/dashboard); i18n parity + `STORY_3_4_KEYS`.

## Green-phase order (fastest feedback)

`Task 1 migration → 2 sqlc → 3 api.yaml → 4 codegen → 5 service+handler+NewSessionTestServerBareMux (turns backend #1+#2 green) → 6 backend tests → [backend gate green] → 7 data layer → 8 SchedulePage (turns FE #3 green) → 9 MySchedulePage (FE #4) → 10 Sessions-tab → 11 i18n + SectionNameKey (turns the type-red + missing-key runtime-red green) → 12 FE tests + bundle + full regression.`

## Verification snapshot (this ATDD run)

- `go test ./internal/test/ -run TestRLS_Session*` → **FAIL 42P01** (expected; table missing). ✅
- `go vet ./internal/handler/` → 1 undefined: `NewSessionTestServerBareMux` (expected; single honest symbol). ✅
- `go vet ./internal/test/` → **clean** (RLS file compiles; runtime-red only). ✅
- `vitest run src/features/schedule/__tests__/` → 2 failed, both `Failed to resolve import "@/features/schedule/{Schedule,MySchedule}Page"` (expected). ✅
- **Zero production code touched.** Baseline `1141d6f`.
