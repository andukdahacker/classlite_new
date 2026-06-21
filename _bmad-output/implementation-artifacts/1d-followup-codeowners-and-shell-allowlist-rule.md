# Story 1d-followup-codeowners: CODEOWNERS file + `*Shell` allowlist rule

Status: backlog

> **Origin: Story 1d-3 party-mode review, 2026-06-21 (John + Winston + Murat).** Story 1d-3 shipped the predicate-gated `PURE_LAYOUT_SHELL_ALLOWLIST` for the *Shell three-state lint exemption (Option A — closed 2026-06-18 by Ducdo). The closure depended on a CODEOWNERS rule making TEA (Murat) a required reviewer on `src/test/storybook-rules/required-exports.ts` so a standalone allowlist-only PR would be auto-rejected. The repo did not have a CODEOWNERS file at all, so the rule was deferred to this follow-up.
>
> John's framing (party-mode 2026-06-21): "File a follow-up story to introduce CODEOWNERS *with* the *Shell rule baked in. Don't backfill it as a one-line PR." Winston (party-mode 2026-06-21): "A predicate without an owner is just a speed bump. Anyone with merge rights can expand the set, update the doc, update the test, and ship it in one PR. The test catches accidental drift; CODEOWNERS catches intentional drift by the wrong person."
>
> Hard deadline: **before Epic 1 closes.** The longer this floats, the higher the risk of someone expanding `PURE_LAYOUT_SHELL_ALLOWLIST` in a PR that no reviewer with story context sees.

## Story

As an engineering lead,
I want a `CODEOWNERS` file at the repo root with team-owned paths and a TEA-required-reviewer rule on `src/test/storybook-rules/required-exports.ts`,
so that intentional drift on load-bearing lint rules (e.g., expanding the `*Shell` allowlist) cannot ship without a reviewer who understands the rule's intent.

## Acceptance Criteria (BDD)

### AC1: `CODEOWNERS` file lives at the repo root

**Given** the project root,
**When** a developer opens a PR,
**Then** GitHub recognizes `/CODEOWNERS` (or `.github/CODEOWNERS`) and applies its review rules.

### AC2: TEA owns the `*Shell` allowlist rule file

**Given** a PR that modifies `classlite-web/src/test/storybook-rules/required-exports.ts`,
**When** the PR is opened,
**Then** TEA (Murat — or the GitHub team / user mapped to that role) is automatically added as a required reviewer; the PR cannot merge without explicit approval from that reviewer.

### AC3: Team ownership covers the load-bearing trio

**Given** the three load-bearing areas surfaced during 1d-3:
- `classlite-web/src/test/storybook-rules/required-exports.ts` — *Shell allowlist + three-state lint
- `classlite-web/scripts/i18n-parity.mjs` — namespace-coverage assertion
- `classlite-web/scripts/lib/strip-comments-and-strings.mjs` — shared source-scanning util

**When** any of these files are touched,
**Then** TEA is required-reviewer for the first two; Winston (architecture) is required-reviewer for the third (the shared util is architecture-touching; a third bug should escalate to a real tokenizer, which is an architectural decision).

### AC4: Documented in `storybook-conventions.md`

**Given** a future agent reading `classlite-web/docs/storybook-conventions.md` § 3.1,
**When** the section says "CODEOWNERS rule on `src/test/storybook-rules/required-exports.ts` has TEA (Murat) as a required reviewer,"
**Then** that claim is TRUE — the conventions doc and the actual `CODEOWNERS` file are in lockstep.

### AC5: `bmad-story-conventions.md` is owned by John

**Given** a PR that modifies `docs/bmad-story-conventions.md`,
**Then** John (PM — or his GitHub team mapping) is required-reviewer. The story-file split convention is a process rule; process owner reviews.

## Tasks / Subtasks

- [ ] **Task 1 (AC1):** Add `/CODEOWNERS` at repo root. Format per GitHub spec.
- [ ] **Task 2 (AC2 + AC3):** Map team/user identifiers for Winston, Murat, John. Confirm with Ducdo who the GitHub accounts behind each role are (or whether to use team handles like `@team-tea`).
- [ ] **Task 3 (AC2):** Add rule for `classlite-web/src/test/storybook-rules/required-exports.ts → TEA`.
- [ ] **Task 4 (AC3):** Add rules for `classlite-web/scripts/i18n-parity.mjs → TEA` and `classlite-web/scripts/lib/strip-comments-and-strings.mjs → Architect`.
- [ ] **Task 5 (AC5):** Add rule for `docs/bmad-story-conventions.md → PM`.
- [ ] **Task 6 (AC4):** Read `classlite-web/docs/storybook-conventions.md` § 3.1; confirm the CODEOWNERS claim is now TRUE; if the doc claims more than the rules actually enforce, amend.
- [ ] **Task 7:** Configure GitHub branch protection on `main` to "Require review from Code Owners" (one-time repo-admin task — Ducdo confirms).
- [ ] **Task 8:** Note in PR description: this is the closure of the CODEOWNERS leg of Story 1d-3 AC7.a / Option A allowlist (party-mode review 2026-06-21).

## Dev Notes

### Why this is its own story, not a one-line PR

John's framing at the party-mode review: a CODEOWNERS file should ship with a thought-out rule set, not as a backfill for a single rule. Introducing CODEOWNERS for the first time has UX implications (every PR now triggers code-owner notifications) and the rule set should be deliberate. A one-line `* @ducdo` would defeat the purpose.

### Out of scope

- Branch protection rule configuration on `main` is in scope (Task 7) but other repo-admin work (status checks, merge button rules, signing requirements) is NOT — file separately if needed.
- Migrating existing owners to GitHub teams (vs individual users) is out of scope. Pick whichever shape Ducdo has set up today.
- Adding CODEOWNERS rules for `_bmad-output/` story files is out of scope — those evolve story-by-story; over-locking would slow down BMAD agents.

### Inheritance from Story 1d-3

- `PURE_LAYOUT_SHELL_ALLOWLIST` lives at `classlite-web/src/test/storybook-rules/required-exports.ts:38-43`. The closed-set vitest assertion ("the closed set is the exact triple") fails loudly if the allowlist grows without doc updates.
- `storybook-conventions.md` § 3.1 documents the predicate; AC4 ensures the CODEOWNERS claim in that doc becomes true.

## Definition of Done

- [ ] `/CODEOWNERS` exists at repo root.
- [ ] Rules cover all four files named above (`required-exports.ts`, `i18n-parity.mjs`, `strip-comments-and-strings.mjs`, `bmad-story-conventions.md`).
- [ ] Branch protection on `main` requires code-owner review.
- [ ] `storybook-conventions.md` § 3.1 CODEOWNERS claim is verified accurate.
- [ ] Ducdo merges with a test PR that confirms the required-reviewer flow fires.

## Out of Scope

- Adding owners for legacy files outside the 1d-3 surface — that's continuous tech-debt, not this story's scope.
- Renaming or restructuring the test/storybook-rules directory.
- A custom GitHub Action to enforce the predicate-gated allowlist programmatically (the vitest test already does this; CODEOWNERS adds the human leg).
