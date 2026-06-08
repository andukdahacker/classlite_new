# Lint Exceptions Registry

This document tracks every `eslint-disable` / `stylelint-disable` / equivalent
lint suppression in the codebase. A suppression that is NOT registered here
fails code review.

## Why this exists

Per Story 1-7a party-mode review (Winston, 2026-06-08): "Each new 'but this one
is special' gets a disable, the disables accumulate, and three years later half
the codebase has them and the lint rule is theatre." The registry forces every
suppression to go through a named-and-reviewed process.

## Process for adding a new exception

1. Open a PR that adds the `disable` directive AND appends an entry to this
   file in the SAME commit.
2. Entry MUST include: file:line, rule disabled, rationale, reviewer name,
   date, expiry condition (when should this be revisited?).
3. Reviewer (any non-author engineer) confirms the rationale is unique-enough
   that the lint rule itself should NOT be relaxed instead.
4. PR approval is gated on the registry entry's completeness.

## Active exceptions

_(none — Story 1-7a originally proposed one for the dot-grid pattern, but
it was retired via the `--cl-ink-dot` token promotion. This section stays
empty until a real exception is needed.)_

## CI guard escalation triggers

(Forward-referenced from Story 1-7a AC6 — populate when escalation criteria
are hit.)

- **R41 (shadcn hand-edits in `classlite-web/src/components/ui/`):** currently
  advisory `::warning::` in CI. Escalates to `::error::` when either:
  (a) ≥ 2 hand-edits land in `main` within a single epic, OR
  (b) any future `shadcn upgrade` produces a merge conflict due to a prior
      hand-edit. See Story 1-7a AC6 trip-wire table.
