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
