# BMAD Story File Conventions

_Project-specific rules for story files under `_bmad-output/implementation-artifacts/`. Applies to every story created from Story 1d-4 onward._

## Why this doc exists

Story 1d-3 (`1d-3-app-shell-stack.md`) reached ~830 lines after the implementation Dev Agent Record + Change Log + party-mode review appendix landed in the same file. John (PM) flagged the file as a graveyard at the post-implementation party-mode review on 2026-06-21 — context-engineering threshold crossed; future agents loading the story for code review or follow-up work pay for the inflation.

This doc codifies the split convention agreed at that review.

## The convention — from Story 1d-4 onward

**Stays in the story file** (canonical story spec — bounded, durable):

- Story title + Status
- YAML frontmatter (baseline_commit etc.)
- `## Story` (As-a / I-want / so-that)
- `## Acceptance Criteria (BDD)` — the contract
- `## Tasks / Subtasks` — the work plan
- `## Dev Notes` — pre-dev context the implementer needs to understand the spec
- `## Definition of Done` — the merge bar
- `## Out of Scope`
- `## Change Log` — capped at the **5 most recent** entries; older entries archive to a sibling `change-log.md` if traceability is needed

**Moves to a sibling file** `_bmad-output/implementation-artifacts/{story-key}-completion-notes.md`:

- `## Dev Agent Record` — Debug Log, Completion Notes, Implementation Plan
- `## File List` — what was added / modified / deleted
- Party-mode review appendices (post-implementation reviewer findings, respondent rebuttals, triage decisions)

**Why the split:**

- The story file is the **spec**. It should be readable as a contract whether the story is `ready-for-dev` or `done`. A 1000-line spec isn't a spec, it's an archive.
- The completion notes are the **implementation record**. They're load-bearing for future code review and onboarding, but they don't define what the story is _supposed_ to do.
- Splitting lets an agent loading the story file for follow-up work (e.g., creating Story 1d-4 with this story's inheritance map) read the spec without the full implementation transcript.

## Required structure of the sibling file

```markdown
# Story {key}: Completion Notes

_Implementation record for [`{key}.md`](./{key}.md). Status: {review|done}._

## Dev Agent Record

### Debug Log
{terse bullet list of issues hit during impl + how resolved}

### Completion Notes
{summary of what shipped, deferrals, deviations from spec}

### Implementation Plan (summary)
{ordered list of how the work was actually executed}

## File List

### Added
{paths}

### Modified
{paths with one-line why}

### Deleted
{paths with one-line why}

## Party-Mode Review Appendix (if applicable)
{reviewer findings, respondent rebuttals, triage decisions}
```

The sibling file's status mirrors the story file's status. When the story moves `review → done`, append a final summary entry to the story's `Change Log` referencing the sibling file's final commit.

## How this is enforced

There is no automated lint. Discipline lives in three places:

1. **The `bmad-dev-story` skill** (project-customized at `_bmad/custom/bmad-dev-story.toml` — persistent_facts pointer to this doc).
2. **The `bmad-create-story` skill** (project-customized at `_bmad/custom/bmad-create-story.toml` — persistent_facts pointer to this doc).
3. **Code review** — flag any new story file >600 lines as a convention violation.

## Migration of existing stories

Stories 1d-1, 1d-2, 1d-3 are **NOT** migrated. The convention applies to 1d-4 and onward. Retrofitting older story files is more disruptive than the benefit of consistency — they stay in their current shape and the split lives at the boundary.

## Open questions for the convention

- Should the sibling file be created at story creation (empty placeholder) or at first dev pickup? Currently: at first dev pickup, since most stories never reach implementation.
- Should the Change Log entry-cap (5 most recent) be configurable per epic? Currently: no, the cap is global.
- Status `done`: should the sibling file be archived (move to `archive/`) once the story is closed? Currently: no, stays adjacent for git-grep discovery.

Revisit these at the Epic 1D retrospective.

## Money boundary — the billing price model (Story 9-1a, D25; ratified Ducdo 2026-09-28)

The `internal/plan` Go catalog (Free/Pro/Studio limits + VND prices + VAT) is **DISPLAY-ONLY**. Nothing persisted references these price constants as historical truth.

- **Polar is authoritative** for amounts actually charged.
- Story 9.2 invoices **snapshot** their own `amount`/`vat`/`currency` at charge time — they never re-read the Go catalog.
- The VAT split is **10% inclusive, round-half-up on the integer VND**: `subtotal = round(price / 1.1)`, `vat = price - subtotal`, so the two always re-sum to the price exactly. This rule is identical in Go (`internal/plan.Subtotal`/`VAT`), the FE, and Polar.
- Money is **integer VND** everywhere — never a float.
- A documented reconcile follow-up (catalog vs Polar-charged) belongs to Epic 9's payment stories, not here.

## E2E red-phase convention (Story 11-2; mandated by epic-11.md:453)

The repo's general red-phase convention (see `reference_atdd_red_convention`) has
two language-specific forms. This section documents the **E2E / Playwright +
harness** form so later E2E stories don't invent a new one.

**The red signal for an E2E or harness story is a compile-fail / assertion-fail
on a not-yet-existing seam — never `test.skip` and never a bare TODO.**

- **Playwright `*.spec.ts` and harness modules → `tsc -b` TS2307.** A new spec
  (or a vitest harness `*.test.ts`) imports the not-yet-created harness module
  (e.g. `../lib/auth-harness`). `tsc -b` covers `tests/e2e/**` via
  `tsconfig.e2e.json` (the root `tsconfig.json` references it), so the missing
  module turns the typecheck RED with `TS2307`. `tsc -b` — not `tsc --noEmit` —
  is the real gate (see `reference_web_typecheck_gate_is_tsc_b`); `tsc --noEmit`
  on the solution root is an empty-program false-green.
- **Vitest harness `*.test.ts` → red-by-assertion.** Pure-logic / filesystem
  harness tests (guard predicates, bundle-exclusion scans, no-stub scans) run
  under vitest and fail by assertion against the current tree — a BEHAVIORAL red
  that survives as a permanent regression guard once green (e.g. the no-stub
  guard reds against today's fabricated session and stays green after).
- **Runner split.** Playwright owns `tests/e2e/**/*.spec.ts`; vitest owns
  `tests/e2e/**/*.test.ts` (added to vitest `include`). Never widen vitest to
  `*.spec.ts` or it will try to collect Playwright specs.
- **WF-8 harness-story gate is vitest/Go on the harness code, NOT
  Playwright-on-Playwright** (`test-design-architecture.md:242`). A harness
  story discharges its ≥6 risk with unit tests on the harness logic — the
  Playwright spec is the convention demo + the live behavioral proof, run
  locally against a seeded stack.
- **Data-dependent assertions skip-with-reason when the external artifact is
  absent.** A harness test that consumes a DB-dependent, gitignored seed output
  (e.g. `credentials.json`) skips-with-reason when it is missing (so the unit
  gate is green in a DB-less CI) and asserts fully when present — the same idiom
  as an env-gated spec (`test.skip(!process.env.X, …)`). The pure-logic WF-8
  guards never skip.
- **Document every green-phase SEAM** in the spec/test header block so the dev
  has one place to reconcile.

## Dual-rendered-text query convention (Story 11-5a; AC8)

When a component renders the SAME text in two nodes — a visually-hidden
`sr-only` live-region (what a screen reader announces) AND an `aria-hidden="true"`
visible label (what a sighted user sees) — a bare `getByText('…')` matches BOTH
and **strict-mode-violates**. This double match is a **class, not a bug**: it is
*correct* accessibility. The live region announces state TRANSITIONS only; the
visible label carries detail (e.g. a ticking "last saved Ns ago") that must
NEVER be announced, so the two legitimately co-exist with identical text in an
idle state.

Known instances (both resolve to **"Auto-save on"** in `idle`):
`onboarding/AutoSaveIndicator.tsx:70` (`onboarding.wizard.autoSaving.idle`) and
`exercises/.../EditorAutoSaveIndicator.tsx:64` (`exercises.editor.autosave.idle`).

**Query the VISIBLE node by excluding `sr-only`** — scope to `[aria-hidden="true"]`
(both indicators put the visible label there), or to a `data-status` attribute
(the editor indicator exposes one), or to a scoped `data-testid`:

```ts
// correct — scope to the visible (aria-hidden) node inside the indicator
await expect(
  page.getByTestId('auto-save-indicator').locator('[aria-hidden="true"]'),
).toBeVisible()

// incorrect — matches BOTH the sr-only announcement AND the visible label
await expect(page.getByText('Auto-save on')).toBeVisible() // strict-mode violation
```

**`.first()` is BANNED** as the fix — it masks the real node count and silently
re-breaks the moment another a11y node (a second live region, a tooltip) is
added. Scope to the structural marker instead. Proven on the live rot it names:
`e2e/onboarding-persona-center.spec.ts`'s `sr-only` "Auto-save on" strict-mode
violation (`deferred-work.md:122`), fixed under this convention.
