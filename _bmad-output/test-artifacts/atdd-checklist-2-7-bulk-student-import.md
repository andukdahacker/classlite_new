---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-04c-aggregate', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-24'
storyId: '2.7'
storyKey: '2-7-bulk-student-import'
storyFile: '_bmad-output/implementation-artifacts/2-7-bulk-student-import.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-2-7-bulk-student-import.md'
generationScope: 'BE-first gate (BE handler + integration/RLS + Task 6a auth + E2E J14 + role-gate); FE component matrix deferred to post-dev TA'
redPhaseTag: 'atdd_red_phase'
generatedTestFiles:
  - 'classlite-api/internal/test/story_2_7_helpers.go'
  - 'classlite-api/internal/handler/student_import_handler_atdd_test.go'
  - 'classlite-api/internal/handler/student_import_integration_atdd_test.go'
  - 'classlite-api/internal/test/student_import_rls_atdd_test.go'
  - 'classlite-api/internal/handler/auth_invite_import_atdd_test.go'
  - 'classlite-web/e2e/bulk-student-import.spec.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/2-7-bulk-student-import.md'
  - 'docs/project-context.md'
  - '_bmad-output/project-context.md'
  - 'classlite-api/internal/handler/enrollment_handler_atdd_test.go'
  - 'classlite-api/internal/test/story_3_4_5_helpers.go'
  - 'classlite-api/internal/test/helpers.go'
  - 'classlite-api/internal/test/fixtures.go'
detectedStack: 'fullstack'
generationMode: 'ai-generation'
---

# ATDD Red-Phase Checklist — Story 2.7: Bulk Student Import

> **Purpose:** RED-phase acceptance test scaffolds authored BEFORE implementation (WF-8). Story 2.7 touches **risk ≥6** — R1 cross-tenant leakage (score 9) and R15 SEC-1 role revalidation (score 6) — so ATDD red tests are **MANDATORY on the branch before `in-progress`** (project-context WF-8 hard rule). These tests must exist and FAIL first; dev turns them green.

## Step 1 — Preflight & Context

### Stack Detection
- **Detected stack:** `fullstack` (Go API in `classlite-api/` + React 19 SPA in `classlite-web/`).
- **Red-phase weight:** BE-heavy. The true `in-progress` gate is the backend handler + real-DB integration suite (R1, R15, partial-import, idempotency, parse-edge, Task 6a auth). E2E specs are authored as executable spec but only exercise fully once FE route `/students/import` + API land.

### Prerequisites (all satisfied)
- ✅ Story approved, `Status: ready-for-dev`, 6 ACs in BDD form.
- ✅ FE framework: `classlite-web/playwright.config.ts` (Playwright 1.50, `@axe-core/playwright`), `vitest.config.ts` (Vitest 4, `vitest-axe`), MSW at `src/test/msw-server.ts`.
- ✅ BE framework: `go.mod`, real-DB harness `internal/test/{helpers.go,fixtures.go}` (`SetupRawPool`, `SuperuserPool`, `TenantContext`, per-role `SignAccessTokenForRole`), bare-mux test-server precedent `story_3_4_5_helpers.go`.

### Config Flags (`_bmad/tea/config.yaml`)
| Flag | Value |
|---|---|
| `test_stack_type` | auto → **fullstack** |
| `tea_use_playwright_utils` | true |
| `tea_use_pactjs_utils` | false |
| `tea_pact_mcp` | none |
| `tea_browser_automation` | auto |
| `risk_threshold` | p1 |

### Authoritative Precedents Loaded (reuse, do not reinvent)
- **BE ATDD structure:** `classlite-api/internal/handler/enrollment_handler_atdd_test.go` — `package handler_test`, `SetupRawPool`, superuser-pool cross-tenant seeding, per-role bearer tokens, `errCodeOf`, `{data,meta}` envelope asserts, `t.Cleanup` teardown. **This is the template for the 2.7 handler red suite.**
- **BE test-server wiring:** `story_3_4_5_helpers.go::NewEnrollmentTestServerBareMux` — the pattern for a new `NewStudentImportTestServerBareMux` wired on the **owner/admin** chain (`RequireRole("owner","admin")`).
- **RLS adversarial:** `classlite-api/internal/test/enrollments_rls_test.go` (read+write isolation, deterministic tenant IDs).
- **FE component tests:** `classlite-web/src/features/settings/__tests__/RoomsTab.test.tsx` (MSW, real Query/Zustand, i18n both locales, `ErrorAlert`/`classifySaveError` reuse, axe).
- **FE E2E:** `classlite-web/e2e/*.spec.ts` + `tests/e2e/auth.setup.ts` (role storage-state), `route-role-gate.spec.ts` (role-negative route gating).

## Step 2 — Generation Mode

**Mode chosen: AI Generation** (not browser recording).

*Why:* Per step-02 rule, fullstack red-phase where the target UI/route (`/students/import`) and API endpoints **do not yet exist** — there is nothing to record against. Backend scenarios are generated from the ACs + OpenAPI-shaped contract in the story + source anchors. FE E2E/component scaffolds are generated from the settings/enrollment precedents. Recording (CLI/MCP) is deferred to post-dev TA once the real UI is live.

## Step 3 — Test Strategy (AC → Level → Priority)

### Risk anchors driving the red phase
| Risk | Score | Red-phase obligation |
|---|---|---|
| **R1** cross-tenant leakage | **9** | Import as tenant A → 0 rows visible to tenant B (read AND write); cross-tenant file-key (`centerB/imports/…` passed by center A) → **403**. `GetObject` bypasses RLS, so the file-key guard needs its own negative — the write-isolation test alone will NOT catch a file-read leak (Blocker #4). |
| **R15** SEC-1 role revalidation | **6** | Role re-read from `center_members` inside the import tx; teacher/student caller → **403 INSUFFICIENT_ROLE**; a **stale/elevated owner-JWT for a DB teacher** still 403 (the deciding-factor test, EDGE-2). |

### AC → Scenario → Level → Priority
| AC | Scenario | Level | Priority | Red test id |
|---|---|---|---|---|
| AC2 | valid + invalid rows → per-row status classification | Integration (real DB) | P0 | INT-BULK-001 |
| AC2 | malformed/missing header → file-level ValidationError, **0 persisted** | Integration | P0 | INT-BULK-002 |
| AC2 | email normalization: `Foo@X.com`/`foo@x.com` deduped intra-file **and** at lookup | Integration | P0 | INT-BULK-EDGE-dupe |
| AC2 | UTF-8 BOM header strip; XLSX numeric/date-typed email cell coerced; multi-sheet → first sheet only | Integration | P1 | INT-BULK-EDGE-parse |
| AC2/AC3 | cross-tenant existing-account resolved by email link | Integration | P1 | INT-BULK-003 |
| AC4 | confirm creates user + `center_members(student)` + enrollment via **sqlc on import tx** + best-effort invite | Integration | P0 | INT-BULK-CONFIRM |
| AC4 | `unassigned` row (no class) → student member, **no enrollment**, no crash | Integration | P1 | INT-BULK-UNASSIGNED |
| AC5 | partial success: some row errors, valid rows persisted, downloadable error-report data present | Integration | P0 | INT-BULK-PARTIAL |
| AC5 | commit/audit failure → **full rollback, 0 persisted** (retryable) | Integration | P1 | INT-BULK-ROLLBACK |
| AC4 | sequential re-run → no double-insert (`CreateEnrollmentIfNotActive` ON CONFLICT) | Integration | P0 | INT-BULK-004 |
| AC4 | **concurrent** `ConfirmImport` of same file → constraint holds, no doubles, losing row reported skipped | Integration | P1 | INT-BULK-CONCURRENT |
| — | **preview→confirm divergence**: class renamed between preview & confirm → confirm re-classifies, no crash | Integration | P1 | INT-BULK-DIVERGE |
| **R1** | import in tenant A → nothing visible to tenant B (read+write) | Integration/RLS | **P0** | RLS-IMPORT-ISOLATION |
| **R1** | cross-tenant file-key (`centerB/…` by center A) → **403 FORBIDDEN** | Handler | **P0** | H-IMPORT-CROSSKEY-403 |
| AC1/AC6 | owner/admin 200; teacher/student → **403 INSUFFICIENT_ROLE**; stale-owner-JWT-for-teacher → 403 (R15) | Handler | **P0** | H-IMPORT-ROLE |
| AC6 | >200 data rows → **422 IMPORT_ROW_LIMIT_EXCEEDED** (200 ok / 201 reject / header excluded) | Handler | P0 | H-IMPORT-ROWLIMIT |
| AC3/AC4 | missing key → **404 IMPORT_FILE_NOT_FOUND**; full `{data,meta}` + `{error:{code,message,requestId}}` shapes | Handler | P1 | H-IMPORT-ENVELOPE |
| Task 6a | pre-provisioned student (NULL pw, NULL google_id) accepts invite w/ password → **201** | Integration (auth) | **P0** | AUTH-IMPORT-CLAIM |
| Task 6a | genuine OAuth user (NULL pw, google_id set) + password → still **409** (no OAuth regression) | Integration (auth) | **P0** | AUTH-OAUTH-GUARD |
| Task 6a | existing password user unaffected | Integration (auth) | P1 | AUTH-EXISTING-PW |
| AC1/AC3/AC5 | J14-001 valid 50-row happy journey | E2E | P1 | E2E-J14-001 |
| AC2/AC3/AC5 | J14-002 dupes+malformed → partial → error-CSV download | E2E | P1 | E2E-J14-002 |
| AC4 | J14-004 retry idempotency | E2E | P1 | E2E-J14-004 |
| UX-3/TEST-FE-6 | student cannot reach `/students/import` — route-gated, absent from DOM (role-negative) | E2E/Component | P1 | FE-ROLE-GATE |
| AC1/AC3/AC5 | dropzone state matrix, per-row badges, summary banner `aria-live`, Confirm-enabled-with-errors, submit-lock, i18n en+vi, axe | Component | P2 | *(post-dev TA — see note)* |

### Red-phase level policy (no duplicate coverage)
- **Business rules & security** live at **Integration/Handler (real DB, real middleware)** — the backend seam is the real DB in transactions (3.4.5 established: services call `generated.New(tx)`, **no mock-store seam**). This is where R1, R15, partial-import, idempotency, and parse-edge are proven.
- **E2E** verifies the *user journey* only (upload → preview → confirm → result/CSV), never re-asserts classification logic or permission math.
- **Component** three-state/dropzone/i18n/a11y matrix is **P2** — per the per-story protocol it belongs to **post-dev `/bmad-tea TA`** (stage 3), not the red gate. The one FE red worth landing pre-dev is the **role-negative route gate** (cheap, security-relevant).

### Red-phase guarantee
Every scaffold is authored to **fail before implementation**: BE files reference not-yet-existing symbols (`NewStudentImportTestServerBareMux`, `PreviewImport`/`ConfirmImport`, `CreateEnrollmentIfNotActive`, the `/api/students/import*` routes) → **compile/assertion failure**; E2E specs target the not-yet-mounted `/students/import` route → fail on navigation. Dev turns them green (Task 11).

## Step 4 / 4C — Generated Red-Phase Scaffolds

**Mode:** sequential AI generation. **Red mechanism (Go):** the `//go:build atdd_red_phase` tag — the repo's established red-phase convention (`cmd/api/signing_key_validation_atdd_test.go`, Story 1.5). The untagged build (CI) excludes these files, so the not-yet-built production symbols they reference do NOT break the shared packages. Run the red suite with:

```
cd classlite-api && go test -tags atdd_red_phase ./internal/...
```

**Red mechanism (Playwright):** `test.describe.skip()` — the repo's infra-pending convention (`route-role-gate.spec.ts`, FU-2-5-N).

### Files
| File | Level | Tests | Red on |
|---|---|---|---|
| `classlite-api/internal/test/story_2_7_helpers.go` | harness | — | `service.NewStudentImportService`, `handler.NewStudentImportHandler`, `service.StudentImportService`, `MockStorageService.SeedObject` (single source of the speculative constructor) |
| `classlite-api/internal/handler/student_import_handler_atdd_test.go` | handler | 11 | role R15 (owner/admin 200, teacher/student/stale-owner-JWT 403), cross-tenant file-key 403, row-limit 200/201, missing-key 404, envelope, 401 |
| `classlite-api/internal/handler/student_import_integration_atdd_test.go` | integration | 12 | INT-BULK-001/002/003/004, other-center, dedup, BOM, confirm-graph, unassigned, partial, concurrent, preview→confirm divergence; +1 `t.Skip` placeholder (rollback — needs audit-fault seam) |
| `classlite-api/internal/test/student_import_rls_atdd_test.go` | RLS (R1) | 2 | cross-tenant read isolation + write isolation on import-created rows |
| `classlite-api/internal/handler/auth_invite_import_atdd_test.go` | auth (Task 6a) | 3 | pre-provisioned student claim success, genuine-OAuth guard 409, existing-pw unaffected |
| `classlite-web/e2e/bulk-student-import.spec.ts` | E2E (skipped) | 4 | J14-001/002/004 + `/students/import` role-gate negative |

### Red-phase verification (evidence)
- ✅ **Untagged build/CI clean:** `go build ./...` OK · `go vet ./internal/handler ./internal/test` OK · `go test ./internal/handler ./internal/test` → *"no tests to run"* (red files invisible without the tag).
- ✅ **Tagged build fails on the RIGHT symbols only:** `go test -tags atdd_red_phase ./internal/...` → `undefined: service.NewStudentImportService | handler.NewStudentImportHandler | service.StudentImportService`, `MockStorageService has no method SeedObject`. No failures originate from test logic (helper signatures, syntax, imports all verified against real precedents). This is the intended RED.
- ✅ **E2E collects:** `playwright test --list bulk-student-import.spec.ts` → 4 tests, all under `describe.skip`.

## Acceptance-Criteria Coverage (red → green owner)
| AC / Risk | Red tests | Turns green in |
|---|---|---|
| AC2 (parse/validate) | INT-001/002, dedup, BOM, other-center | Task 4 (`PreviewImport`) |
| AC3 (preview + partial contract) | Preview 200 envelope, partial (Confirm enabled) | Task 4/6 + Task 8 (FE) |
| AC4 (confirm creates graph) | INT-confirm, unassigned, 004, concurrent | Task 5/7 (`ConfirmImport` + `CreateEnrollmentIfNotActive`) |
| AC5 (partial success + report) | INT-partial (+rollback placeholder) | Task 5 + Task 8 (error-CSV) |
| AC6 (200-row limit) | row-limit 200/201 boundary | Task 4 (`maxImportRows`) |
| **R1** (leak, score 9) | cross-tenant file-key 403 **and** RLS read+write isolation | Task 4/5 tenant-key guard + RLS |
| **R15** (SEC-1, score 6) | teacher/student 403 + stale-owner-JWT 403 | Task 5 in-tx role re-validation |
| Task 6a (auth claim) | claim-success / OAuth-409 / existing-pw | Task 6a (google_id-keyed guard) |

## Next Steps — Task-by-Task Activation (the implementation checklist)
Turn the red suite green in this order; each item names the story task and the symbol the red build is blocked on:

1. **Task 1 — Storage seam.** Add `GetObject(ctx, key) ([]byte, error)` to `StorageService` + `R2StorageService`; add `SeedObject(key string, content []byte)` **and** `GetObject` to `MockStorageService` (`storage_mock.go`). → unblocks the harness compile.
2. **Task 4 — `PreviewImport`.** New `service.StudentImportService` + `NewStudentImportService(db, storage, auditSvc, clock)`; tenant-key `HasPrefix` guard; BOM strip; CSV/XLSX parse; classify; `maxImportRows=200`. → greens preview + parse-edge + row-limit + cross-key + other-center.
3. **Task 7 — sqlc/api.yaml.** Add `CreateEnrollmentIfNotActive` (ON CONFLICT DO NOTHING); additive `api.yaml` paths + schemas; `scripts/codegen.sh`.
4. **Task 5 — `ConfirmImport`.** SEC-1 tx choreography + in-tx role re-validation (greens R15 stale-JWT) + per-row savepoint fan-out + audit + commit. → greens confirm-graph, unassigned, partial, 004, concurrent, divergence, RLS isolation.
5. **Task 6 — handler + routes + error mapper arms** (`INSUFFICIENT_ROLE`, `FORBIDDEN`, `IMPORT_FILE_NOT_FOUND`, `IMPORT_ROW_LIMIT_EXCEEDED`, `VALIDATION_ERROR`). → greens `NewStudentImportHandler` + envelope negatives.
6. **Task 6a — auth guard.** Re-key the `auth_invite.go:88` OAuth rejection on `google_id IS NOT NULL`. → greens the 3 auth tests.
7. **Rollback placeholder.** Implement the Task 5 audit-fault seam, then un-`Skip` `TestImport_INTRollback_CommitFailure_ZeroPersisted`.
8. **FE (Tasks 8/9) + FU-2-5-N harness.** Build `features/people` + `/students/import` route, then flip the `describe.skip` in `bulk-student-import.spec.ts`.

## Deferred to post-dev `/bmad-tea TA` (not in this red gate)
FE component matrix (dropzone state machine, per-row badges, `aria-live` summary, submit-lock, error-CSV blob util, i18n en+vi key existence, axe) + MSW fault injection. Per the WF-8 per-story protocol, TA (stage 3) expands P2/P3 + role-negative component coverage after dev.

## Definition of Done (this ATDD run)
- ✅ Red scaffolds exist on the branch BEFORE `in-progress` (WF-8 hard rule for risk ≥6).
- ✅ R1 (read+write+file-key) and R15 (role re-validation incl. stale-JWT) both have red coverage.
- ✅ Untagged CI stays green; red observable only under `-tags atdd_red_phase`.
- ⏭️ Story Task 0 checkbox may be ticked; proceed to `dev-story` (green phase). Post-dev: `/bmad-tea TA` then `/bmad-tea RV`.
