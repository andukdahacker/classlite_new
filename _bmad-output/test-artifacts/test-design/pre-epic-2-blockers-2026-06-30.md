---
title: 'Pre-Epic-2 Blockers — R1 Mitigation Status Audit'
date: '2026-06-30'
flagged_by: 'Murat (TEA) — bmad-tea'
operator: 'Ducdo'
scope: 'Verify Pre-Epic-2 mitigations are in place before Story 2.1 enters dev'
status: 'OPEN — 1 blocker, 1 partial'
related_docs:
  - 'test-design-architecture.md § Risk Register (R1, score 9, timeline Pre-Epic 2)'
  - 'project-context.md § GO-1 (TenantContext required on every store method)'
  - 'blocker-resolutions-2026-06-04.md (precedent for pre-epic blocker resolution memos)'
related_epics:
  - 'epic-02.md (Onboarding, Center Setup & Roles)'
new_resource_families_introduced_by_epic_2:
  - 'centers'
  - 'onboarding_progress'
  - 'class_templates'
  - 'template_sessions'
  - 'classes (extended by spawn endpoint)'
---

# Pre-Epic-2 Blockers — R1 Mitigation Status

`test-design-architecture.md:122` lists R1 (cross-tenant data leakage via missing `TenantContext` on a Store method, score **9 / Critical**) with timeline **Pre-Epic 2** and mitigation strategy:

> golangci-lint custom analyzer + mandatory adversarial cross-tenant test per resource family (J15 grid).

Epic 2 introduces at least **5 new Store-touching resource families**. Each one is a new opportunity to forget `TenantContext` on a Store method and silently leak across tenants — exactly what R1 is designed to prevent. R1 must be downgradeable from BLOCK → MITIGATE before Story 2.1 enters dev.

## Audit results

| Mitigation component | Status | Evidence |
|---|---|---|
| **A. golangci-lint custom analyzer** enforcing project-context **GO-1** (first non-`ctx` parameter of every `Store` method must be `TenantContext`) | **MISSING** | No `.golangci.yml` exists at repo root OR in `classlite-api/`. No `cmd/tenantcheck/` or equivalent custom-analyzer package. GO-1 today is a convention enforced by code review only — not by tooling. |
| **B. Adversarial cross-tenant test grid per resource family (J15)** | **PARTIAL** | 25 `Test*` functions exist across 3 files in `classlite-api/internal/test/`: `adversarial_test.go` (11), `audit_logs_rls_test.go` (9), `auth_adversarial_test.go` (5). Coverage is decent for **today's** resources (auth, audit logs) but Epic 2's 5 new resource families have **zero** corresponding grid entries (no `centers_rls_test.go`, no `onboarding_progress_rls_test.go`, etc.). |

## Severity

R1 is the **highest-severity trap** named in `project-context.md § GO-1` — "compiles clean, leaks data." Without mitigation A, every Store method added during Epic 2 is one human review pass away from a multi-tenant data leak landing on `main`. The blast radius is unbounded — a single missing `TenantContext` argument can expose every tenant's center, onboarding state, or class template to every other tenant.

This is not a P2 advisory. It is a Pre-Epic-2 BLOCKER per the risk register's own timeline column.

## Recommended actions (Backend lead — Pre-Epic-2)

### Action 1 — Ship the TenantContext analyzer (mitigates A)

**Acceptance criteria:**

1. New `.golangci.yml` at `classlite-api/.golangci.yml` enabling a custom analyzer (built via `go-build-plugin` or shipped as a separate `golangci-lint custom` binary — Backend lead's call).
2. The analyzer asserts: for every method on any type named `*Store`, in package `classlite-api/internal/store/...`, the first non-`ctx` parameter MUST be of type `TenantContext`. Methods that take no business parameters (e.g. health checks) are explicitly allowlisted with a Godoc tag.
3. The analyzer FAILS the build on violation (`severity: error`), not warns.
4. Negative-fixture test: a deliberately wrong `Store` method file under `classlite-api/internal/store/_lintfixtures/missing_tc.go` is asserted to produce the analyzer error in CI — confirming the lint has teeth. (Same mechanism as Epic 1D's `missing-empty-export.stories.tsx` fixture for R52.)
5. CI workflow `ci-api.yml` wires `golangci-lint run` and gates merge on it.

**Expected effort:** small — analyzer is ~50 LOC of `analysis.Pass` scanning method signatures. The CI wiring + fixture is the larger fraction.

### Action 2 — Extend J15 adversarial test grid to Epic 2's resource families (mitigates B)

**Acceptance criteria:**

1. For each new Epic 2 Store (5 families listed in frontmatter), add a `{resource}_rls_test.go` file under `classlite-api/internal/test/` following the existing `audit_logs_rls_test.go` template.
2. Each file MUST cover the three mandatory R1 patterns:
   - `Test{Resource}_RLS_CrossTenantRead` — tenant A cannot read tenant B's rows
   - `Test{Resource}_RLS_CrossTenantWrite` — tenant A's UPDATE/DELETE against tenant B's row affects 0 rows (per `TEST-BE-1` in `project-context.md`)
   - `Test{Resource}_RLS_NullTenantContext` — missing `SET LOCAL` returns 0 rows, never all-rows leak
3. Tests use the existing `test.SetupDB(t)` + `test.TenantContext(t, db, tenantID)` harness. No mocking pgx.
4. Tests should be authored **alongside** each story's Store implementation, not retro-fitted at gate. Stage as part of `/bmad-tea AT` ATDD red-phase output per story.

**Timing:** Action 2 has natural per-story landing points (gated by `/bmad-tea AT`), but the **template/scaffold** for the 3-pattern grid should exist before Story 2.1 starts so the first story's AT can reference it.

## What is NOT in scope

- This memo does not re-open R3 (worker `SET LOCAL` enforcement). R3's timeline is **Pre-Epic 4**, and the A7 worker harness is partially built (see `blocker-resolutions-2026-06-04.md § A7`).
- This memo does not re-score R1. The risk register stays as written; R1 will be downgrade-able from BLOCK → MITIGATE once Actions 1 + 2 ship.

## Exit criteria for this blocker

- [ ] `.golangci.yml` with TenantContext analyzer lives at `classlite-api/.golangci.yml` and is wired into `ci-api.yml` (Action 1, ACs 1–5).
- [ ] Negative-fixture file produces the analyzer error in CI.
- [ ] Adversarial 3-pattern grid template + 1 worked example (e.g. `centers_rls_test.go`) committed before Story 2.1 transitions backlog → in-progress.
- [ ] This file's frontmatter `status` flipped to `RESOLVED` with a one-line resolution note + reference commit SHA.

Once exit criteria are met, append the resolution to this file (do not delete) so the audit trail survives.
