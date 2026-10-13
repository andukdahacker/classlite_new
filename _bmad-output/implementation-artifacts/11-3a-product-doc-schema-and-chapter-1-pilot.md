# Story 11.3a: Product Doc Schema + Chapter 1 Pilot

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: e4904b6
epic: 11
story: 11-3a
size: M
wf8_gate: false   # 11-3a is NOT in the ≥6 ATDD trip list (11-1a/11-2/11-6b/11-8a). Doc work + a read-only lint extension; no ≥6 risk. Lint-logic still ships with a red demonstration (DD-RED) by hygiene precedent, not WF-8 mandate.
depends_on: [11-1a]
audience: full-stack + docs
gates_exposure: false   # Runs parallel to the rest of Wave A; gates nothing for launch. Freezing the schema early is what keeps 11-3b/c cheap.
---

## Story

As a **developer and as the loop**,
I want **a frozen product-documentation schema proven on one real chapter, with `docs/classlite-entry/` split into an authority-graded archive and an absorbed `docs/product/` oracle**,
so that **88 screens are never written against a schema being designed in the same breath (the exact self-referential-oracle risk R3 warns about — v0.1 designed the ledger and applied it to 88 screens at once and failed) and every downstream consumer — human, Playwright, the loop — resolves against one addressable, verified oracle**.

> **This story's real output is a MEASURED NUMBER, not a document.** "Done" is not "Chapter 1 looks nice" — it is a frozen schema, one chapter reconciled against the running build, and a recorded per-screen reconciliation cost that lets 11-3b/c be sized instead of guessed. A schema that cannot be proven cheap on 6 shipped screens must not be inflicted on the other 83.

## Acceptance Criteria (BDD)

### AC1 — The R2 split: archive the prototypes, absorb the IA, grade authority per chapter
- **Given** `docs/classlite-entry/` (14 `.html` prototypes + `index.html` + the living `classlite-ia.md`)
- **When** the split completes
- **Then** the HTML prototypes (the 13 chapter prototypes `01`,`02a–02d`,`03`,`04`,`05`,`06a–06c`,`07`,`08` **plus** the `index.html` nav hub = 14 `.html` files) live under `docs/archive/classlite-entry-prototypes/`
- **And** `docs/archive/classlite-entry-prototypes/README.md` grades authority **per chapter**: Chapters 1–5 and 8 = **SUPERSEDED** (`docs/product/` wins); Chapter 6 (`s50`–`s67`) and Chapter 7 (`s68`–`s73`) = **FROZEN-AND-BINDING** (the forward spec of record for Epic 10 and Epic 9 respectively, until those epics ship), with an explicit warning that an Epic 9/10 author must NOT discount Ch6/7 design intent just because it sits under `archive/`
- **And** the IA *content* is absorbed into `docs/product/` (not left in `classlite-entry/`)
- **And** a short **pointer stub** remains at the original `docs/classlite-entry/classlite-ia.md` path redirecting to `docs/product/`
- **And** the archive is **excluded from every lint, `tsc -b` and Playwright glob** (verified, not assumed)
- **And** **no `sNN` reference in the 86 story files was rewritten** (`git diff` touches none of them)

### AC2 — The frozen per-screen schema, proven on reconciled Chapter 1 screens
- **Given** a reconciled screen in Chapter 1
- **Then** it carries the fixed sub-structure **Purpose / Route / Roles / Controls / States / Behaviours / Out of scope** under a `## sNN — Title` heading
- **And** each **normative statement** carries an **assertion ID** scoped under the screen ID and an **`assertion_strength`** (enum: `must` / `should` / `may`)
- **And** each control that needs a locator carries a **slug scoped under the screen ID** (`sNN/<kebab-slug>`, derived from the control's accessible name, declared in the doc, usable verbatim as a Playwright locator key)
- **And** its `screens.yaml` entry carries a non-null `detailDoc` (path + anchor into the chapter doc), `provenance: verified-against-build` with its `verified-sha`, and a `last-verified` date

### AC3 — The dual-render control rule (the thing that dissolves the cited live failure)
- **Given** the "Auto-save on" dual-render case (a visible status node **and** an `sr-only` live-region announcement of the same state)
- **Then** the schema's control-slug rule declares them as **two distinct controls** (`<screen>/auto-save-indicator` and `<screen>/auto-save-announcement`), demonstrated as the canonical worked example in the schema-authoring guide
- **And** the worked example cites the **actual screen that renders it in the shipped app** (confirmed by grepping `classlite-web/src` — the epic's `s24` citation is provisional; `s24` is Speaking-grading in the IA). The **canonical** worked example is the onboarding shell's `AutoSaveIndicator` (`classlite-web/src/features/onboarding/components/AutoSaveIndicator.tsx`), rendered on `s01`/`s02`/`s03`/`s05` — it is the **true two-node dual-render** (a visible `aria-hidden` status node **and** a separate `sr-only` `role="status"` live region, idle string "Auto-save on"). The writing editor's `SaveStatusIndicator` (`s34` / mobile `s78`) is the **single-node variant** (one `role="status"` region) and is cited as the secondary example — see DD6 (amended at code review 2026-10-13).

### AC4 — The provenance ratchet becomes a build gate (DD15, wired at reconciliation start)
- **Given** `scripts/screens-lint.mjs`
- **When** a screen entry has a **non-null `detailDoc`** (i.e. it has been reconciled)
- **Then** the lint **FAILS** unless that entry's `provenance` is `verified-against-build` **with** a well-formed `verified-sha`, OR the entry carries a **dated exemption** (`provenance-exemption: YYYY-MM-DD <reason>`)
- **And** the lint FAILS if a non-null `detailDoc` points at a file that does not exist
- **And** the lint still passes read-only, still asserts the 89-entry count and bidirectional token↔doc integrity, and **still never rewrites any file**
- **And** the DD17 `source` re-point to `docs/product/` is reflected in the manifest's top-level `source` key

### AC5 — Lint stays green end-to-end after the split
- **Given** the archive move + the 8 chapter docs + the re-pointed manifest
- **Then** `node scripts/screens-lint.mjs` exits 0 (every one of the 89 `sNN` entries is still referenced by at least one scanned `docs/product/*.md` doc — i.e. archiving `classlite-ia.md`'s content did not orphan any `entry → doc` reference)

### AC6 — The pilot produces a sizing number
- **Given** the Chapter-1 pilot is complete
- **Then** the **measured per-screen reconciliation cost** (per screen: EN assertion count, VN authored y/n + VN time, control-slug count, wall-clock/effort) is recorded in the completion notes, with an explicit extrapolation to size 11-3b (Chapters 2–5, 8) and 11-3c (Chapters 6–7)

### AC7 — Red demonstration of the new gate (hygiene, not WF-8)
- **Given** the extended lint
- **Then** a documented red case is shown to fail and then pass: (a) a reconciled entry (`detailDoc` set) left at `provenance: asserted-from-design-intent` → lint exits 1; (b) a `detailDoc` pointing at a missing file → lint exits 1; proving the ratchet actually bites before the green commit lands

## Tasks / Subtasks

- [x] **Task 0 — Red demonstration of the ratchet gate (AC7)** *(do first; it is the spec for Task 4)*
  - [x] Add a lightweight check (a `scripts/__tests__/screens-lint.*` node/vitest harness, or a documented manual red-run in the completion notes) that: temporarily sets a `detailDoc` + leaves `asserted-from-design-intent` → asserts exit 1; sets a dangling `detailDoc` → asserts exit 1. Confirm RED against the *current* (unextended) lint is impossible (no such logic yet) → this is the behavioural spec for Task 4.

- [x] **Task 1 — R2 split: archive the prototypes (AC1)**
  - [x] Create `docs/archive/classlite-entry-prototypes/`; `git mv` all 14 `.html` files (`01-owner-onboarding.html`, `02a–02d`, `03-student.html`, `04-owner-admin.html`, `05-cross-role.html`, `06a–06c`, `07-billing.html`, `08-mobile.html`, `index.html`) into it. Do NOT open/transform the HTML — it is 98,700 lines; it moves, it is not read.
  - [x] Author `docs/archive/classlite-entry-prototypes/README.md`: the per-chapter authority table (Ch1–5+8 SUPERSEDED → `docs/product/`; Ch6 `s50–s67` + Ch7 `s68–s73` FROZEN-AND-BINDING for Epic 10/9), the Epic-9/10-author warning, and the deliberate onboarding-numbering-scope note (`classlite-ia.md:8`, `:69`: `s05–s09` reuse across onboarding + teacher chapters is intentional / file-scoped).

- [x] **Task 2 — Absorb the IA into `docs/product/` as the sharded oracle (AC1, AC5)**
  - [x] Create the 8 chapter files `docs/product/01-onboarding.md` … `08-mobile.md` + `docs/product/index.md`. `index.md` carries the IA's two consolidated tables (Section summary `classlite-ia.md:257–272`; Per-role visibility matrix `:276–307`) and the persona→role mapping (`:34–43`).
  - [x] In EVERY chapter file, emit a `## sNN — Title` heading for each screen the manifest assigns to that chapter (all 89 across the 8 files), so that `entry → doc` stays satisfied for all screens after `classlite-ia.md` is archived. Chapters 2–8 bodies are **shells** marked `_Reconciliation pending (11-3b / 11-3c)._`; only Chapter 1 is fully authored this story.
  - [x] Replace `docs/classlite-entry/classlite-ia.md` with a pointer stub (redirect note to `docs/product/`). Keep the file at its path so the AC1 "pointer remains" holds; its content is one short paragraph + links, not an sNN inventory.

- [x] **Task 3 — Fully reconcile Chapter 1 against the running build (AC2, AC3, AC6)**
  - [x] For each Chapter-1 screen (manifest `chapter: 1` = **s00–s05**, per DD1), write Purpose / Route / Roles / Controls / States / Behaviours / Out of scope from the IA (`classlite-ia.md:54–69`) **verified against the shipped app** (navigate/read `classlite-web/src/features/onboarding/**`), capturing the two universal Chapter-1 behaviours (quiet "save and finish later" exit; "skip this step").
  - [x] Document the persona-forked onboarding flow's apparent "extra" screens as **persona/state variants of existing canonical screens** (NOT new IDs): Solo-done = variant of `s04`; Founder-template = variant of `s02`; Founder-spawn = variant of `s03`; Dashboard-handoff = the onboarding state of the dashboard — per the IA's own "same shape as s04 / same as s02 / same as s03" wording (`:64–67`). This resolves the `s05–s09` collision without renumbering (DD1).
  - [x] Assign assertion IDs + `assertion_strength` to every normative statement; declare control slugs for every locator-bearing control.
  - [x] Author the EN assertions; author (or dev-draft for Ducdo review) the **VN view** of each normative statement per the bilingual-derivation rule (DD7). Record VN authoring cost separately.
  - [x] Add the schema-authoring guide `docs/product/SCHEMA.md` (the frozen contract: sub-structure, assertion-ID grammar, `assertion_strength` enum, control-slug rule + the auto-save dual-render worked example, bilingual-derivation rule, provenance/`verified-sha` rules).
  - [x] Record the per-screen cost table → completion notes (AC6).

- [x] **Task 4 — Extend `scripts/screens-lint.mjs` (AC4, AC5, AC7)**
  - [x] Add the ratchet: `detailDoc != null` ⇒ `provenance == verified-against-build` + well-formed `verified-sha`, unless a dated `provenance-exemption` is present → else exit 1.
  - [x] Add `detailDoc` file-existence check (non-null path must resolve on disk).
  - [x] Add `docs/archive/` to `SKIP_DIRS` (defensive; HTML is already un-scanned, but the moved content + any future `.md` under archive must never red the lint).
  - [x] Parse + preserve the new flat `verified-sha` / `provenance-exemption` keys without breaking the hand-rolled line parser (keep flat `key: value` shape — there is no YAML lib). Keep `ids.size !== 89` (count unchanged — Chapter 1 reconciles in place, adds no entries).
  - [x] Re-point manifest top-level `source` → `docs/product/` (DD17); update `source_verified_sha` to the baseline.
  - [x] Run `node scripts/screens-lint.mjs` → exit 0.

- [x] **Task 5 — Verify tool-glob exclusions + no regressions (AC1, AC5)**
  - [x] Confirm `docs/archive/**` and `docs/product/*.md` are outside `tsc -b` roots and every Playwright glob (`classlite-web/tsconfig*.json`, `playwright.config.ts`, `tests/e2e/**`). Add an explicit exclude only if a glob currently reaches them.
  - [x] `git diff --stat` proves zero changes to the 86 story files under `_bmad-output/`.

### Review Findings

_Code review 2026-10-13 (bmad-code-review, Amelia). 3-layer adversarial (Blind Hunter / Edge Case Hunter / Acceptance Auditor), all at Opus-4.8 capability. All 7 ACs substantively met; no Critical/High that blocks. Findings verified against the real tree (lint line numbers are the working-tree file, not the assembled diff). 2 decision-needed, 7 patch, 1 defer, 4 dismissed._

**Decision-needed — RULED by Ducdo 2026-10-13 (both → patch):**
- [x] [Review][Patch] DD6 / AC3 worked example — **RULED: ratify the correction.** The onboarding `AutoSaveIndicator` (Ch1 `s01`/`s02`/`s03`/`s05`) is the canonical dual-render example (two distinct sibling nodes, literal `"Auto-save on"` idle string); `s34`/`s78` is documented as the single-node (`role="status"`) variant. Amend AC3's Given-clause + the Forks section (fork-5) in this story file to cite the AutoSaveIndicator and drop the s34/s78-as-example wording (pragmatic-interpretation convention — amend the spec to match build truth, not the code). SCHEMA.md + `01-onboarding.md` already reflect this → no doc churn there.
- [x] [Review][Patch] `s04` manifest `roles` — **RULED: annotate SCHEMA (variant), no manifest change.** Keep `s04 roles: [operator, founder]` per DD1. Add a SCHEMA §1 note: `roles` lists the canonical reachers; persona variants (e.g. Solo → `/setup/done` via `DoneHeroPanel`) are documented in the screen's Roles prose, not in the manifest `roles` array. This resolves the "roles matches the manifest" contradiction by refining the rule, not the data.

**Patch (code issues, unambiguous fix):**
- [x] [Review][Patch] Provenance ratchet never validates the detailDoc `#anchor` — only `existsSync(filePart)` [scripts/screens-lint.mjs:141-142] — a reconciled "verified-against-build" entry whose anchor is dead, points at another screen's heading, resolves to an empty/`_pending_` shell, is a directory, or is anchor-only (`#s00` → `filePart===""` → repo root exists) all PASS. SCHEMA §6 promises `path#anchor` integrity; the code enforces only `path`. Fix: require a non-empty file part + `statSync().isFile()`, read the target and assert the anchor slug matches a `## ` heading (ideally the entry's own `id`). Flagged by all 3 layers.
- [x] [Review][Patch] Archive README authority table row 1 contradicts its own body + the manifest [docs/archive/classlite-entry-prototypes/README.md:40-41] — "1 — Onboarding | `s00`–`s09` | SUPERSEDED | fully reconciled … by 11-3a" claims `s06`–`s09` are reconciled by this story, but `01-onboarding.md` reconciles only `s00`–`s05` and the README body (same file) + manifest carry `s06`–`s09` with their teacher meaning (chapter 2, `asserted-from-design-intent`, → 11-3b). The same four IDs are labeled both "reconciled by 11-3a" and "pending 11-3b." Fix: scope row 1 to `s00`–`s05` reconciled, note `s06`–`s09` are teacher/chapter-2 → 11-3b.
- [x] [Review][Patch] Test `mutateS00` now mutates `s06`, not `s00` [scripts/__tests__/screens-lint.test.mjs:64-78] — this same diff flipped `s00`–`s05` to `verified-against-build` + non-null `detailDoc`, so the first `provenance: asserted-from-design-intent` / `detailDoc: null` lines now belong to `s06`. `String.replace` first-match targets s06; the guiding comment ("s00 is the manifest's FIRST entry") is false. Not a false-green today, but brittle (a future anchor check on the injected `#s00--persona-pick` landing on an s06 row would red for the wrong reason). Fix: anchor the replacement on a deterministically-asserted id, or compute the target id from the manifest, and correct the comment.
- [x] [Review][Patch] Blank / non-canonical `detailDoc` escapes the ratchet [scripts/screens-lint.mjs:119,128,138-139,150] — `detailDoc: ""` (or key with no value) is defined so the `missing detailDoc` check skips it, and `reconciled` is false so the ratchet never runs; a YAML null alias (`~`, `Null`) is treated as a real path and reds the lint; an inline `# comment` on `verified-sha` is not stripped (the per-entry `kv[2].trim()` differs from the top-level `source` parser which strips `/\s+#.*$/`), failing a legit sha. Fix: normalize null spellings, treat blank as "not reconciled" explicitly (or error), strip inline comments symmetrically.
- [x] [Review][Patch] `provenance-exemption` date is shape-only and never expires [scripts/screens-lint.mjs:65,144] — `EXEMPTION_RE` accepts impossible calendar dates (`2026-13-45`) and there is no max-age, so an exemption suppresses the ratchet forever — the exact "silent rot" SCHEMA §6 says it prevents. Fix: calendar-validate the date; decide a max-age (or explicitly document no-expiry as intended).
- [x] [Review][Patch] `SKIP_PATHS` compared against OS-separator-dependent `relative()` output [scripts/screens-lint.mjs:59,166] — the forward-slash literal `"docs/archive"` won't match `docs\archive` on a Windows checkout, so a future `.md` under `docs/archive/` would be scanned (the archived README's `s00`–`s87` tokens would red the lint). `SKIP_DIRS` name-matching is already OS-agnostic. Fix: normalize separators before the Set lookup.
- [x] [Review][Patch] AC6 recorded must/should/may split is off by one [completion-notes AC6 table + story Change Log] — recorded `19/6/2` sums to 27, not the stated 26; the actual list is 19 must / 5 should / 2 may = 26 (the `6` double-counts a Deviations-section prose cross-reference, not a new assertion). Headline 26/32/26 is correct; only the strength split is wrong. Since the pilot's sizing number is the deliverable, correct the recorded split to `19/5/2`.

**Deferred (real but not actionable now):**
- [x] [Review][Defer] Low-severity theoretical lint hardening [scripts/screens-lint.mjs:100,105,157] — `source:` prefix test is purely lexical (accepts traversal `docs/product/../../x`); the hardcoded `89` double-reports on a malformed/duplicate id (a second misleading "expected 89" on top of the real grammar error); the second manifest re-read (top-level `source`) is unguarded by try/catch so a TOCTOU delete between reads exits 1 instead of the documented 2. All author-controlled, negligible real-world impact — deferred, pre-existing-class.

**Dismissed (noise / false positive):** `unq()` throws on undefined (false — line 119 `(v || "")` coerces nullish to `""`); VN view count 27 vs 26 (not a defect — coverage is complete, recorded count is one low); `SHA_RE` rejects uppercase hex (git shas are lowercase by convention); red-phase "4 of 6 cases vacuous" (correct per the repo's documented red-phase convention — the 2 ratchet exit-1 cases ARE the genuine red; tests are green and correct now).

## Dev Notes

### Why this story exists (context)
Epic 11 is the product-docs-as-source-of-truth + QA loop epic. `docs/product/` is the **oracle** that makes the loop's triage decidable (R1/R6) and that Playwright + the manual-session runner resolve against. R2 splits the co-located `docs/classlite-entry/` (one living IA + ~98,700 lines of frozen HTML — "co-locating them is the actual defect") into an authority-graded archive plus the absorbed oracle. R3 warns that designing the ledger/doc schema *while* applying it across 88 screens is how v0.1 failed; **11-3a freezes the schema on ONE chapter first.** This story gates nothing for launch and runs parallel to the rest of Wave A. [Source: epic-11.md:237–298, :659–699]

### The frozen contract from 11-1a (do NOT break it)
- **`docs/product/screens.yaml`** — 89 entries (`s00–s87` + `s10a`), one per `sNN`. Per-entry fields: `id`, `title`, `route` (or `null`), `section`, `chapter` (1–8), `roles` (inline array), `implementation_status` (`shipped`|`unbuilt-epic-9`|`unbuilt-epic-10`), `provenance` (`asserted-from-design-intent`|`verified-against-build`), `detailDoc` (`null` today), `last-verified` (`YYYY-MM-DD`), `verified-by`. Top-level: `version`, `source`, `source_verified_sha`. [Source: docs/product/screens.yaml:1–34]
- **`scripts/screens-lint.mjs`** (155 lines, zero-dep, hand-rolled line parser) — its own CI workflow `.github/workflows/screens-lint.yml` (repo-wide path triggers, Node 22). Checks: manifest shape + enums, `ids.size === 89`, grammar `^s\d{2}[a-z]?$`, bidirectional token↔doc. Scans **only** `.md`/`.yaml`/`.yml`. Does NOT check provenance correctness, staleness, `detailDoc` existence, or top-level `source`. **It is the ONLY programmatic consumer of `screens.yaml`** — no Playwright/TS/Go import reads it yet. The parser is brittle: keep any new field a flat `key: value` line. [Source: scripts/screens-lint.mjs:1–155]
- **No-rewrite rule is a hard build constraint**: the lint is read-only; the 86 story files keep their verbatim `sNN` tokens; the IDs stay valid *because* they carry forward unchanged. [Source: epic-11.md:255–278]

### Key design decisions
- **DD1 — Pilot scope = manifest `chapter: 1` (s00–s05), reconciled to the FROZEN oracle, not the superseded IA's "s00–s09."** The IA calls Chapter 1 `s00–s09`, but `s05–s09` are a deliberate *file-scoped* namespace reuse (onboarding Solo/Founder/handoff screens share IDs with teacher `s06–s09`). `screens.yaml` — one entry per `sNN` — already collapsed that collision: `chapter:1 = s00–s05`, and `s06–s09` carry their **teacher** meaning in `chapter:2`. The manifest is frozen and is the oracle the lint/Playwright/loop key on; `docs/product/` shards off its `chapter` field. So the pilot reconciles `s00–s05` and documents the onboarding "extra" screens as persona/state variants of `s02`/`s03`/`s04`/dashboard (Task 3) — the IA literally describes them that way. **This is the #1 fork for Ducdo** (see Open Forks). [Source: classlite-ia.md:8–9,:54–69; screens.yaml:24–133]
- **DD2 — `docs/product/` = 8 chapter files + `index.md` + `screens.yaml`.** Chapter-sharded = a structure-preserving transform of the manifest's 8 chapters; one reviewable diff per chapter. All 8 files emit a `## sNN` heading per screen so `entry → doc` survives archiving `classlite-ia.md` (Chapters 2–8 are shells this story).
- **DD3 — Archive is a MOVE of HTML, an ABSORB of the IA, a POINTER at the old path.** 14 `.html` → `docs/archive/classlite-entry-prototypes/`; never opened. `classlite-ia.md` content → `docs/product/`; a stub redirect stays at the old path.
- **DD4 — The provenance ratchet keys on `detailDoc` (DD15 wired at reconciliation start).** Non-null `detailDoc` ⇒ must be `verified-against-build` + `verified-sha`, else a dated exemption, else lint fails. This is the "must-upgrade-by-reconciliation" gate DD15 reserved for 11-3a/b — it exists the moment reconciliation starts, not as an afterthought. [Source: 11-1a DD15, DD17; screens.yaml header:10–18]
- **DD5 — Assertion scheme (frozen here):** assertion IDs scoped under the screen (recommend `sNN/aN`, or `sNN/<control-slug>/aN` when control-anchored); `assertion_strength ∈ {must, should, may}`. Keyed on screen-ID + control slug + assertion id so finding IDs survive the step-renumbering that 11-4/11-5 will do (R3/R4). The loop's weakening-detection (R-11-1) reads `assertion_strength`. [Source: epic-11.md:292–293,:335–337; test-design-architecture.md:233]
- **DD6 — The auto-save dual-render example — RE-RULED at code review 2026-10-13.** The epic's `s24/auto-save-*` citation (epic-11.md:286) is still provisional (the IA's `s24` is Speaking-grading). The original DD6 named `s34`/`s78` as the example screen, but the grep done during dev + confirmed at code review shows the **true two-node** dual-render is the onboarding shell's `AutoSaveIndicator` (`s01`/`s02`/`s03`/`s05`): a visible `aria-hidden` status node **and** a separate `sr-only` `role="status" aria-live="polite"` region, idle string "Auto-save on". The writing editor's `SaveStatusIndicator` (`s34` / mobile essay `s78`) is a **single** `role="status"` region → documented as the single-node variant, not the canonical example. **RULED (Ducdo): ratify the correction** — the SCHEMA.md worked example uses the onboarding `AutoSaveIndicator` as primary + `s34`/`s78` as the single-node variant (pragmatic-interpretation convention: amend the spec to match build truth). `s34`/`s78` reconcile for real in 11-3b/c, not here. [Source: AutoSaveIndicator.tsx:70–80; SaveStatusIndicator.tsx:34–37; project-context.md TEST-UX-3; epic-11.md:163–166,:286–291]
- **DD7 — Bilingual = a VIEW of the oracle, not a second oracle (R4).** Each normative EN statement has a VN view that is **derived/authored** from it (never machine-translated at runtime, never separately authored — two oracles and the loop cannot triage). The schema carries the VN slot; the pilot authors VN for Chapter 1 so the measured cost is honest. VN authoring may need Ducdo (native speaker) — dev may draft for review. [Source: epic-11.md:317,:351–356; project-context.md UX-2]
- **DD8 — Staleness detector is OUT (→ 11-3b, FU-11-1A-STALENESS).** 11-3a produces the `verified-against-build <sha>` provenance that staleness needs; the git-log detector itself lands in 11-3b. Do not build it here. [Source: deferred-work.md:1291]

### Chapter-1 pilot screen inventory (the reconciliation target, s00–s05)
From `classlite-ia.md:54–69` — verify each against `classlite-web/src/features/onboarding/**` before writing:
- **s00** `/welcome` · roles [all] · Persona pick (Operator/Solo/Founder) → routes to one of three flows; no sidebar yet.
- **s01** `/setup/center` · [operator, founder] · Center setup: name & brand; optional logo (defaults to letter mark); live preview.
- **s02** `/setup/template` · [operator, founder] · Build template: pick suggested IELTS template or build from scratch; editable preview. *(Founder variant: pre-flags one class self-assigned.)*
- **s03** `/setup/spawn` · [operator, founder] · Spawn classes: duplicate template into N classes; per-class teacher (required, inline-invite) + students (optional). *(Founder variant: first class auto-assigned to founder.)*
- **s04** `/setup/done` · [operator, founder] · Done: summary; "Open Dashboard" CTA. *(Solo variant = "Done — Solo", same shape.)*
- **s05** `/setup/first-class` · [solo] · Solo first class: single class form, teacher locked to "you"; no center-management surface.
- Universal (all Ch1): quiet "save and finish later" exit; "skip this step" pattern.

### Forks — ALL RULED by Ducdo 2026-10-13 (each to the recommended default; ACs stand unchanged)
1. **Pilot scope** → **RULED: s00–s05** (manifest/oracle-faithful; onboarding extras as persona/state variants of s02/s03/s04/dashboard, no renumber). *(rejected: literal s00–s09, which reintroduces the file-scoped ID collision the one-entry-per-sNN manifest killed.)*
2. **Chapter shells** → **RULED: write all 8 chapter files now** as shells (Ch1 authored, Ch2–8 shells) so `entry → doc` stays green after archiving `classlite-ia.md`.
3. **Ratchet gate timing** → **RULED: wire the `detailDoc ⇒ verified-against-build` gate now in 11-3a** (DD15 — exists the moment reconciliation starts).
4. **VN authoring for Chapter 1** → **RULED: author VN now** (dev may draft for Ducdo review; record VN cost separately so 11-3b/c sizing is honest).
5. **Auto-save example screen** → **RE-RULED at code review 2026-10-13: the onboarding `AutoSaveIndicator` (`s01`/`s02`/`s03`/`s05`) is the canonical two-node dual-render; `s34`/`s78` (`SaveStatusIndicator`) is the single-node variant; the epic's `s24` is still corrected.** The original ruling (s34/s78 as the example) was based on the epic text; the dev grep + code review found s34/s78 is single-node, so the build-truth example is the onboarding indicator. See DD6.

### Project Structure Notes
- Pure docs + one `.mjs` lint extension. **No `api.yaml`, no `codegen.sh`, no migrations, no cross-service, no new dependency.** WF-1/WF-2/WF-3 do not fire.
- New/changed paths: `docs/archive/classlite-entry-prototypes/**` (moved HTML + README), `docs/product/{01-onboarding…08-mobile}.md`, `docs/product/index.md`, `docs/product/SCHEMA.md`, `docs/product/screens.yaml` (edited: Ch1 `detailDoc`/`provenance`/`verified-sha` + top-level `source`), `docs/classlite-entry/classlite-ia.md` (→ pointer stub), `scripts/screens-lint.mjs` (extended).
- `docs/product/` sits **outside** `_bmad-output/` deliberately (long-lived artifact consumed by runtime tooling, not regenerable workflow output). [Source: epic-11.md:296–298]

### References
- [Source: epic-11.md:237–298] — R2 split, graded archive, addressability, sub-structure, control slugs, assertion IDs
- [Source: epic-11.md:300–356] — R3 two-phase / R4 bilingual-view + finding-ID keying
- [Source: epic-11.md:659–699] — Story 11-3a statement + the 4 AC groups
- [Source: docs/classlite-entry/classlite-ia.md:8–9,:34–43,:54–69,:165,:202,:257–307] — chapter structure, persona map, Chapter-1 content, Ch6/7 ranges, consolidated tables
- [Source: docs/product/screens.yaml:1–34] + [scripts/screens-lint.mjs:1–155] — the frozen manifest schema + lint contract
- [Source: 11-1a story DD6/DD7/DD8/DD9/DD15/DD17] — registry/ratchet/source-race rulings 11-3a inherits
- [Source: deferred-work.md:1291] — FU-11-1A-STALENESS (→ 11-3b, not here)
- [Source: test-design-architecture.md:229–245] — R-11-1 assertion-strength ratchet; WF-8 trip list excludes 11-3a

## Definition of Done
- All 7 ACs met; `node scripts/screens-lint.mjs` exits 0; the AC7 red cases demonstrably fail on the extended lint before passing.
- `docs/product/SCHEMA.md` frozen; Chapter 1 (s00–s05) fully reconciled with assertion IDs + strengths + control slugs + bilingual views; its 6 manifest entries flipped to `verified-against-build` + `verified-sha` + non-null `detailDoc`.
- Archive README grades authority per chapter; archive excluded from lint/`tsc -b`/Playwright (verified); pointer stub at the old `classlite-ia.md` path.
- `git diff` proves **zero** edits to the 86 story files.
- The measured per-screen reconciliation cost + 11-3b/c extrapolation recorded in `11-3a-product-doc-schema-and-chapter-1-pilot-completion-notes.md`.
- The 5 Open Forks are ruled by Ducdo before/at dev pickup (defaults are written into the ACs; a different ruling edits the ACs first).

## Out of Scope
- Reconciling Chapters 2–5, 8 (→ **11-3b**, shipped chapters) and Chapters 6–7 (→ **11-3c**, Epic 9/10-dependent). This story writes their **shells only**.
- The git-log **staleness detector** (→ 11-3b, FU-11-1A-STALENESS).
- Any rewrite of the 86 story files' `sNN` tokens (hard-forbidden).
- Opening/transforming the 98,700 lines of archived HTML.
- The manual-session runner / xlsx / workbook (R3/R4 → 11-7), scenario rubric (11-4), the loop (11-6a/b). 11-3a only *freezes the schema they consume*.

## Change Log
| Date | Change | Author |
|---|---|---|
| 2026-10-13 | Story created (bmad-create-story, Amelia). backlog→ready-for-dev. Deps 11-1a (done). Size M, WF-8 NOT tripped. 2-agent artifact recon (baseline e4904b6). SURFACED the pilot-scope collision: IA Ch1 = s00–s09 but frozen screens.yaml = chapter:1 s00–s05 (file-scoped ID reuse collapsed by the one-entry-per-sNN manifest) → DD1 + fork 1. Ratchet gate keyed on detailDoc (DD15 wired here). Auto-save example is s34/s78 not the epic's s24 (DD6). 5 forks saved for Ducdo. | Amelia |
| 2026-10-13 | All 5 forks RULED by Ducdo, each to the recommended default (s00–s05 pilot · all-8-shells · ratchet-now · VN-now · s34/s78-correct-epic). ACs unchanged; forks section marked ruled. Ready for /bmad-dev-story 11-3a. | Amelia |
| 2026-10-13 | **Implemented (bmad-dev-story, Amelia). in-progress→review.** All 7 ACs green. R2 split (14 `.html` git-mv'd to `docs/archive/classlite-entry-prototypes/` + graded README + pointer stub); 8 chapter docs + `index.md` + frozen `SCHEMA.md` in `docs/product/` (all 89 `sNN` get a `## sNN` heading); Chapter 1 (`s00–s05`) fully reconciled against the shipped build at `verified-sha e4904b6` (26 assertions · 19/5/2 must/should/may · 32 control slugs · 26 dev-drafted VN views). `screens-lint.mjs` extended with the DD15 provenance ratchet + `detailDoc` file-existence + `docs/archive` skip + top-level `source`→`docs/product/` check + test-only env hooks; `node scripts/screens-lint.mjs` exits 0 (89 ids). AC7 red→green via `scripts/__tests__/screens-lint.test.mjs` (6/6 green; red proven first). **DD6 grep correction flagged for Ducdo:** the true two-node "Auto-save on" dual-render is the onboarding shell's `AutoSaveIndicator` (Ch1 `s01/s02/s03/s05`), not `s34/s78` (which is single-node) — SCHEMA.md cites both. `git diff` touches zero of the 86 story files. Measured sizing + 11-3b/c extrapolation + full Dev Agent Record / File List in [`11-3a-…-completion-notes.md`](./11-3a-product-doc-schema-and-chapter-1-pilot-completion-notes.md). | Amelia |
| 2026-10-13 | **Code review (bmad-code-review, Amelia). review→done.** 3-layer adversarial (Blind/Edge/Auditor @ Opus-4.8); all 7 ACs confirmed met. 2 decision-needed RULED by Ducdo + 9 patches APPLIED + verified; 1 deferred (low lint hardening → deferred-work.md); 4 dismissed. **Patches:** (1) ratchet now validates the detailDoc `#anchor` resolves to a real `##` heading **and** belongs to the entry's own screen — not just file-existence (SCHEMA §6's core promise; was file\-only, all 3 layers flagged); (2) hardened parser — blank/`~`/case-insensitive `null` detailDoc, symmetric inline-comment strip in `unq`, `isFile` guard, calendar-valid exemption date (`2026-13-45` no longer bypasses); (3) `SKIP_PATHS` separator-normalized (Windows); (4) test suite rewritten to mutate the real reconciled `s00` + copy the real Ch1 doc (the old `mutateS00` silently targeted s06 after the reconciliation flip) — **8/8 green**, now covers anchor + bad-exemption; (5) archive README row 1 scoped to `s00`–`s05` (was double-assigning `s06`–`s09` to both 11-3a and 11-3b); (6) AC6 strength split corrected `19/6/2`→`19/5/2` (the `6` double-counted the Deviations cross-ref of `s-ch1/a3`). **Decisions:** DD6/AC3/fork-5 re-ruled — onboarding `AutoSaveIndicator` is the canonical two-node dual-render, `s34`/`s78` the single-node variant (SCHEMA already reflected it); SCHEMA §1 Roles rule refined — persona variants live in prose, not the manifest `roles` array (so `s04` stays `[operator, founder]`). Real lint green (89 ids, exit 0). | Amelia |

## Dev Agent Record

_Per `bmad-story-conventions.md`, the full Dev Agent Record (Agent Model, Debug Log, Completion Notes,
Implementation Plan), the AC6 measured sizing table, and the File List live in the sibling record:_
**[`11-3a-product-doc-schema-and-chapter-1-pilot-completion-notes.md`](./11-3a-product-doc-schema-and-chapter-1-pilot-completion-notes.md)**.
