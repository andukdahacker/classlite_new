# Story 11-3a: Completion Notes

_Implementation record for [`11-3a-product-doc-schema-and-chapter-1-pilot.md`](./11-3a-product-doc-schema-and-chapter-1-pilot.md). Status: review._

## Dev Agent Record

### Agent Model Used
Amelia (bmad-dev-story) — Claude Opus 4.8 (1M). Baseline `e4904b6`.

### Debug Log

- **Red harness runner.** `node --test scripts/__tests__/` (bare dir) crashes on Node 26
  (`MODULE_NOT_FOUND`); pointed the runner at the file (`node --test scripts/__tests__/screens-lint.test.mjs`).
  CI (Node 22) + local (Node 26) both run it that way.
- **Red confirmed before green.** Against the unextended lint the harness failed 3/6 (the two ratchet
  cases + the file-exists case), passing the 3 trivially-green cases — exactly the DD-RED signal. After
  Task 4 all 6 pass.
- **No app source touched** — pure docs + one `.mjs` lint extension + its node:test harness. No
  `api.yaml`, no `codegen.sh`, no migration, no TS/Go. The pre-existing `tsc` diagnostics in
  `classlite-web/tests/e2e/**` (auth-harness `TS2307`, etc.) are Story 11-2's red-phase artifacts,
  untouched by and unrelated to this story.

### Completion Notes

**What shipped (all 7 ACs green):**

- **AC1 — R2 split.** `git mv`'d all 14 `.html` prototypes (13 chapters + `index.html`) to
  `docs/archive/classlite-entry-prototypes/` as renames (content never opened/transformed — the files
  show as `R` in `git status`, zero content diff). Authored the per-chapter graded-authority README
  (Ch1–5/8 **SUPERSEDED**, Ch6 `s50–s67`/Ch7 `s68–s73` **FROZEN-AND-BINDING** for Epic 10/9) with the
  explicit Epic-9/10-author warning + the deliberate `s05–s09` file-scoped-reuse note. IA content
  absorbed into `docs/product/`; a pointer stub remains at the old `classlite-ia.md` path.
- **AC2 — frozen per-screen schema, proven on Chapter 1.** `docs/product/SCHEMA.md` freezes the
  sub-structure (Purpose/Route/Roles/Controls/States/Behaviours/Out-of-scope), the `sNN/aN`
  assertion-ID grammar, the `must`/`should`/`may` strength enum, the `sNN/<kebab-slug>` control-slug
  rule, the bilingual-view rule, and the provenance/`verified-sha` rules. Chapter 1 (`s00–s05`) fully
  reconciled against the shipped app; its 6 manifest entries flipped to `verified-against-build` +
  `verified-sha: e4904b6` + non-null `detailDoc`.
- **AC3 — dual-render control rule + the corrected screen citation.** The SCHEMA.md worked example is
  the canonical two-distinct-controls demonstration (`<screen>/auto-save-indicator` +
  `<screen>/auto-save-announcement`). **Grep correction (DD6, flagged for Ducdo):** the epic's `s24`
  was already known-wrong; DD6 re-pointed to `s34`/`s78`. The grep shows the **true two-node
  dual-render** (separate visible `aria-hidden` node + separate `sr-only` `aria-live` node, literal
  string **"Auto-save on"**) is the **onboarding shell's `AutoSaveIndicator`**
  (`classlite-web/src/features/onboarding/components/AutoSaveIndicator.tsx:70–80`), rendered on
  Chapter-1 screens `s01`/`s02`/`s03`/`s05` — i.e. **this chapter**. The writing editor's
  `SaveStatusIndicator` (`s34`/`s78`) is a **single combined node**, not a dual-render. The schema
  cites **both** (onboarding as the primary true dual-render; `s34`/`s78` as the single-node variant),
  which both honours fork-5's ruling (grep-confirmed, exact strings, corrects `s24`) and is truthful
  about what the grep found. AC3's own Given clause ("a visible status node **and** an `sr-only`
  live-region announcement" + "Auto-save on") in fact matches the onboarding component exactly.
- **AC4 — the provenance ratchet is a build gate.** `scripts/screens-lint.mjs` now fails when a
  reconciled entry (non-null `detailDoc`) is not `verified-against-build` + well-formed `verified-sha`
  (unless a dated `provenance-exemption`), and when a non-null `detailDoc` points at a missing file.
  Top-level `source` re-pointed to `docs/product/` and asserted by the lint (DD17);
  `source_verified_sha` → `e4904b6`. The hand-rolled flat-key parser preserves the new
  `verified-sha`/`provenance-exemption` keys; `ids.size === 89` unchanged; still read-only.
- **AC5 — lint green end-to-end.** `node scripts/screens-lint.mjs` exits 0 (89 ids, all referenced
  bidirectionally) after the archive move + 8 chapter docs + re-pointed manifest. Archiving
  `classlite-ia.md`'s content orphaned no `entry → doc` reference because all 89 `sNN` get a `## sNN`
  heading across the 8 chapter files.
- **AC6 — the sizing number.** Recorded below.
- **AC7 — red demonstration.** `scripts/__tests__/screens-lint.test.mjs` (node:test, zero-dep) shows
  the ratchet red → green: (a) reconciled-but-asserted → exit 1; (b) dangling `detailDoc` → exit 1;
  (c) malformed `verified-sha` → exit 1; plus the exemption + clean + verified cases pass. Red proven
  against the unextended lint before the green commit.

**Deferrals / deviations:**

- **VN views are dev-drafted, pending native review** (DD7). All 26 Chapter-1 assertions carry a
  `_vi:_` view; idiom needs Ducdo's native pass.
- **"Skip this step"** has no literal control in the shipped build — realised as optional fields +
  Save-and-finish-later. Documented as a `should` + a Deviations note in the chapter doc (shipped
  reality over IA prose).
- **Staleness detector** NOT built (→ 11-3b, `FU-11-1A-STALENESS`). 11-3a produced the
  `verified-against-build <sha>` provenance it will consume.

### Implementation Plan (as executed)

1. Recon: read the frozen `screens.yaml` + `screens-lint.mjs` + the full IA; verified Chapter-1
   against `classlite-web/src/features/onboarding/**`, `routes.tsx`, both locale files; grepped the
   two autosave components (onboarding `AutoSaveIndicator`, attempts `SaveStatusIndicator`).
2. **Task 0** — authored the red harness; ran it against the unextended lint → RED (3/6 fail).
3. **Task 1** — `git mv` 14 HTML + graded README.
4. **Task 2** — generated the 7 shell chapters from the manifest (83 headings) + hand-authored
   `index.md` + the pointer stub.
5. **Task 3** — froze `SCHEMA.md`; fully reconciled `01-onboarding.md`; flipped the 6 Ch-1 manifest
   entries + re-pointed `source`.
6. **Task 4** — extended the lint (ratchet, file-exists, archive skip, source check, test-only env
   hooks); lint exit 0; harness 6/6 green.
7. **Task 5** — verified tsc-b/Playwright globs never reach `docs/`; proved zero story-file diff.

## AC6 — Measured per-screen reconciliation cost (the pilot's real output)

**Chapter 1 pilot: 6 screens reconciled against the running build.**

| Screen | Assertions | …must/should/may | Control slugs | VN views (drafted) |
|---|---|---|---|---|
| `s00` Persona pick | 5 | 4/0/1 | 4 | 5 |
| `s01` Center setup | 4 | 3/1/0 | 6 | 4 |
| `s02` Build template | 3 | 2/1/0 | 5 | 3 |
| `s03` Spawn classes | 4 | 3/1/0 | 6 | 4 |
| `s04` Done | 3 | 2/0/1 | 4 | 3 |
| `s05` Solo first class | 3 | 3/0/0 | 7 | 3 |
| _Universal (shell, amortized once/chapter)_ | 4 | 2/2/0 | — | 4 |
| **Total** | **26** | **19/5/2** | **32** | **26** |

**Per-screen marginal** (excludes the 4 amortized universal behaviours): **~3.7 assertions**,
**~5.3 control slugs**, **1 VN view per assertion**, all `verified-against-build`.

**One-time costs that do NOT recur per chapter:** freezing `SCHEMA.md`; resolving the `s05–s09`
file-scoped-collision (DD1) + documenting the 4 persona/state variants; the DD6 autosave-screen
grep-correction. These dominated the pilot's wall-clock (~1 focused session for the whole story) and
are now paid.

### Extrapolation → 11-3b / 11-3c

- **11-3b (shipped chapters 2–5, 8 = 59 screens).** Reconciles against a **running build** like this
  pilot. Budget **~4–7 assertions + ~5–7 slugs per screen** (denser surfaces — class-detail tabs,
  grading, analytics — skew higher; the 14 mobile screens skew lower as lean variants) → order
  **~300 assertions, ~350 control slugs, ~300 VN views**. **Recommend shipping 11-3b one chapter per
  reviewable diff** (DD2 already shards this way) rather than one mega-PR; it is correctly sized **L**.
  VN authoring (~300 views) is the dominant human cost — budget Ducdo's native-review time, or batch
  VN behind a dated `provenance-exemption` so EN reconciliation is not gated on it.
- **11-3c (Epic 9/10 chapters 6–7 = 24 screens).** These screens are **unbuilt** — the ratchet means
  they **cannot** be `verified-against-build` until Epic 9/10 ship. 11-3c is therefore
  **design-spec transcription from the FROZEN prototype**, not build-reconciliation: each reconciled
  entry must carry a dated `provenance-exemption` (reason: "unbuilt — Epic 9/10") or stay
  `detailDoc: null` until the epic ships. Lighter verification, same schema-authoring weight;
  **~100–150 assertions** across 24 screens. Sequence 11-3c to ride **after** Epic 9/10 build if a
  true `verified-against-build` provenance is wanted without exemptions.

## File List

### Added
- `docs/archive/classlite-entry-prototypes/README.md` — graded-authority archive README (AC1).
- `docs/product/SCHEMA.md` — the frozen per-screen schema (AC2/AC3).
- `docs/product/index.md` — section summary + per-role matrix + persona map (AC1).
- `docs/product/01-onboarding.md` — **reconciled** Chapter 1, `s00–s05` (AC2/AC3/AC6).
- `docs/product/02-teacher.md`, `03-student.md`, `04-admin-owner.md`, `05-cross-role.md`,
  `06-inbox-empty-error.md`, `07-billing.md`, `08-mobile.md` — chapter **shells** (AC5; all 89 `sNN`
  get a `## sNN` heading so `entry → doc` stays green).
- `scripts/__tests__/screens-lint.test.mjs` — the ratchet red/green harness (AC7).
- `_bmad-output/implementation-artifacts/11-3a-product-doc-schema-and-chapter-1-pilot-completion-notes.md` — this file.

### Modified
- `docs/product/screens.yaml` — 6 Ch-1 entries → `verified-against-build` + `detailDoc` + `verified-sha` + `last-verified` 2026-10-13; top-level `source` → `docs/product/` + `source_verified_sha` → `e4904b6` (DD17).
- `scripts/screens-lint.mjs` — provenance ratchet + `detailDoc` file-existence + `docs/archive` skip + top-level `source` check + test-only `SCREENS_LINT_ROOT`/`SCREENS_LINT_MANIFEST` env hooks (AC4).
- `docs/classlite-entry/classlite-ia.md` — content replaced with a pointer stub to `docs/product/` (AC1).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 11-3a `ready-for-dev` → `in-progress` → `review`.

### Renamed (git mv — content never opened; AC1, zero content diff)
- `docs/classlite-entry/{01-owner-onboarding,02a-teacher-dashboard-classes,02b-teacher-time,02c-teacher-content-grading,02d-teacher-resources,03-student,04-owner-admin,05-cross-role,06a-inbox,06b-empty-states,06c-error-states,07-billing,08-mobile,index}.html`
  → `docs/archive/classlite-entry-prototypes/` (14 files).

### Deleted
- None.
