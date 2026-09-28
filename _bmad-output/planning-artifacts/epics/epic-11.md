# Epic 11: Product Documentation as Source of Truth & Self-Correcting QA Loop

**FRs:** none owned (verification infrastructure — see Non-Functional Requirements Addressed).

---

## Description

Promote product documentation from a design-time artifact into the app's **verified source
of truth**, then drive a self-correcting test loop off it — automated (Playwright against the
real stack) and manual (guided human sessions) — so that ClassLite reaches user-ready with
a mechanism that keeps it there.

No FRs are directly owned by this epic. Epic 11 is verification infrastructure: it does not
add user-facing capability, it builds the apparatus that proves the capability delivered by
Epics 2–10 actually works, and keeps proving it. (Same posture as Epic 1A, which owns no FRs
and enables all of them.)

This epic exists because the project has feature coverage without a verification spine.
Epics 1–10 ship the product; nothing currently proves the shipped product matches its
specification, and the one artifact that could — the Playwright suite — has rotted
unguarded (measured 2026-09-27: **13 failed / 21 skipped / 44 passed**, every feature spec
stubbed via `page.route()` so no full-stack path is exercised, and `tests/e2e/auth.setup.ts`
still writing a placeholder session cookie carrying a TODO from Story 1.5).

### v0.2 — party-mode review context (2026-09-27)

v0.1 was reviewed by Murat, Winston, Paige and Amelia as independent subagents. All four
converged, separately, on five defects. v0.2 applies them:

1. **The loop could edit its own oracle.** v0.1 asserted the doc is the oracle that makes
   triage decidable and never forbade the loop writing it — so the loop could resolve an
   ambiguity by editing the doc, then "unambiguously" fix the app to match. Closed by **R6**.
2. **The gate was behind the gate.** v0.1's 11.1 gated every other story and was itself
   gated on "Epic 10 complete" — parking the seed script, tenant isolation, real auth and the
   CI gate (the five absences that *caused* the rot) behind two backlog epics. Six of nine
   stories sat behind unbuilt work. Closed by splitting on the shipped/unshipped chapter
   boundary; **11-1a, 11-2, 11-3a and 11-8a now have no Epic 9/10 dependency at all.**
3. **11.3 was not an L**, and its front-matter schema was to be designed in the same story
   that applied it across 88 screens. v0.1 applied "stabilise the data contract first" to the
   manual ledger (R3) and failed to apply it to itself. Closed by the 11-3a schema pilot.
4. **R1's first guardrail was unimplementable.** "Every app-side fix carries the doc entry
   used as justification" requires an *addressable* locus; free-form prose has none. Closed
   by the addressability requirement in R2 and 11-3a.
5. **Test-side edits were unguarded** — the exact failure mode R1's own rationale names.
   v0.1's three guardrails all pointed at the app side, the newly-added surface, leaving the
   pre-existing and most-permitted surface open. Closed by **R1 guardrails 4–6**.

Two overclaims in v0.1 are also corrected below (NFR-3 and NFR-4 are far better verified than
v0.1 implied, which was inflating story 11-5).

### v0.3 — launch-sequencing round (2026-09-28)

Round 2 of party-mode put `OQ-11-4` ("does Epic 11 gate launch?") to John (PM) and Mary
(Analyst). Both rejected the question's framing, independently and for the same reason.

**Ducdo ruled: v1 is effectively empty — his own center only.** That settles the branch both
reviewers said would reorder everything. Consequences, recorded so they are not re-derived:
v2 is a **greenfield launch, not a migration**; the "parallel vs in-place" cutover decision in
`docs/manual-setup.md` is trivial and v1 stays up indefinitely; Story 2.7's **roster-only**
CSV import (no classes, assignments, submissions or grades) costs nothing because there is no
teaching history to carry; and **Epic 9 is upside, not survival** — nobody is paying today, so
cutting over cannot interrupt revenue. What it does *not* soften: there is still no external
validation of demand, and the irreversibility risks below are about the *pilot's* data, not v1's.

**John's correction — "launch" was two dates wearing one word.** Story 11-8a (deploy pipeline,
migration step, gate, rollback) is the only artifact in the entire backlog that can put v2 on
the internet. So Wave A does not *gate* launch, **Wave A constitutes it**. Everything else in
this epic governs how confidently you launch, not whether you can.

**Mary's correction — the dominant risk is not a quality risk.** Four months, 100+ stories,
101 endpoints, zero external contact. This loop verifies the product against *our own* screen
inventory: a self-referential oracle. Documenting `s00`–`s87` to ourselves cannot tell us
whether `s43` should exist. Against an unvalidated demand assumption, "the Playwright suite has
rotted" is a rounding error.

**Both converged on two artifacts missing from every epic in the project.** Added here as
`11-0a` and `11-0b`, and deliberately numbered to sort *first*, because John's own observation
about 11-8a applies: in this project story numbers read as sequence, and a dep-free
launch-critical item at position 8 gets built eighth.

1. **`11-0b` — AI grading calibration.** Nothing anywhere asserts a band-7 essay scores near 7,
   or that Vietnamese feedback is useful to a Vietnamese seventeen-year-old. That is the
   product's entire value claim with zero coverage. Mary: *"this is not a testing gap and Epic
   11 will not close it"* — a Playwright spec proves the grade renders, only an
   examiner-scored gold set proves it is right. John: a wrong band shown to a parent is not a
   bug, it is the end of that center, and in a referral market the end of the next five. It is
   **product evidence, not QA**, and it gates exposure.
2. **`11-0a` — backend telemetry.** Promoted from `FU-11-SENTRY`, because Murat was right that a
   prerequisite with no story never gets sequenced. Mary's framing is the sharper one: if tenant
   A sees tenant B's students in production, **you will not find out.** Blindness is the gate.

**Three further v0.3 changes:**

- **`11-5` splits.** John: do *not* rebuild 87 specs before first users. `11-5a` is the
  money-path smoke plus the CI gate — login → class → assignment → all four attempt types →
  grade → student reads result, against the real stack. `11-5b` is the full per-journey rebuild,
  and it moves behind the pilot along with `11-6a`/`11-6b`. Both reviewers: the loop's payback
  scales with change-volume × cost-of-escaped-defect, and with zero users the second term is
  near zero today and large after a pilot. Build it when the pilot has told you which five
  flows matter — you will write a better suite for less.
- **Waves re-gated by what they actually gate** — exposure vs paid GA — rather than by
  dependency alone, with an explicit **L1 pilot milestone** between them.
- **`11-9` reframed.** Mary's find, and nobody else made it: the Vietnamese manual test sessions
  are *a customer-research instrument wearing a QA costume*. Recruit prospective center owners
  and teachers rather than "testers", run the identical guided session, and harvest usability
  findings **and demand signal** from one hour of a stranger's time. Same cost, double the
  return, and it is the only thing in the plan that touches the demand gap at all.

**Also found while answering John's questions** (verified in code, not inferred):
`ai_credit_ledger` **records but does not enforce** — `internal/service/ai_grade_service.go:62`
states "There is NO 402 balance gate (Story 6.5)", and the ledger insert only computes
`balance_after` from `SUM(change)`. Storage *does* enforce (`file_service.go:249`, a
per-center serialized check against `storage_limit_bytes`). So disk is protected and Gemini
spend is not: pilot students would hit an uncapped API key on Ducdo's card. Carved out as
`FU-11-CREDITCAP` (P1, pre-exposure) — it belongs to Epic 9 but must not wait for it.

## Non-Functional Requirements Addressed

Epic 11 does not *implement* NFRs — it builds the machinery that **verifies** them. Two of six
are already well verified and are NOT in this epic's scope: **NFR-2 (Multi-tenancy)** and
**NFR-6 (Data integrity)**, both covered by the 228-file Go suite running against a real
Postgres as the non-superuser `classlite_app` role (cross-tenant grids, immutability
triggers, enrollment audit trails).

The four this epic addresses, stated precisely:

- **NFR-1 (Internationalization):** tester-facing step text and expected results authored
  bilingually. Extends the existing CI i18n-parity gate from key-presence to rendered
  behaviour: no untranslated key rendered, no `[object Object]`, no EN fallback leaking under
  `vi`, no layout overflow at VN string length (VN runs ~30% longer). Tone stays human; none
  of the above is tone.
- **NFR-3 (Performance):** the R31 query-count + EXPLAIN-no-SeqScan harness (8-1a) already
  exists and Lighthouse already runs in `ci-web.yml`. The genuine gaps are narrower than
  v0.1 claimed: FCP<2s on 4G is **unbudgeted** rather than unasserted (set a failing
  threshold in `lighthouserc.json` — a one-line change, not a story); grading<3s and
  search<500ms are **backend p95 budgets** belonging in the R31 harness, not routed through
  Playwright or k6. k6 load testing is assigned an owner in 11-8b (see FU-8-4-PERF).
- **NFR-4 (Security):** well verified at the **API layer** by the Go suite. What is absent is
  **UI-layer leak verification** — proving the UI does not surface what the API correctly
  withholds: navigation, menus, direct-URL access, and the per-role visibility matrix in the
  IA. That is a much narrower job than a per-role matrix across 88 screens.
- **NFR-5 (Accessibility):** full-page axe in a real browser is a **machine** job and is run
  across all routes in 11-5 as a data-driven loop — cheaper and more complete than the
  current handful of routes. Humans retain only screen-reader semantic *order* and
  keyboard-grading ergonomics.

## Ruling context (Ducdo, 2026-09-27)

Six rulings. R1–R4 were taken at planning time; **R5 and R6 were added by the party-mode
review.** They are recorded with rationale because the reasoning is the load-bearing part and
will not survive summarisation. All six are citable as binding authority by story files, code
reviews and loop diffs.

### R1 — Loop autonomy: auto-fix BOTH app and tests

Ducdo chose the highest-autonomy option over the recommended "auto-fix tests only".

**The risk this accepts:** every Playwright failure has three possible causes — the app is
wrong, the test is wrong, or the doc is wrong — plus two things that are not causes at all:
flake, and infrastructure failure. A loop that cannot distinguish them converges on *green*,
not on *correct*, by quietly weakening assertions until everything passes.

**Live evidence** (2026-09-27): `e2e/onboarding-persona-center.spec.ts:167` fails with a
strict-mode violation because a later story added an `sr-only` live-region duplicate of
"Auto-save on". **Two different fixes make it green** — loosen the locator to `.first()`, or
target the visible node specifically — and nothing in the test says which is correct. This is
a *class*, not a bug: rebuilding 19 specs against the same ambiguity re-breaks on the next
a11y addition (see 11-5's query convention). Separately `e2e/bilingual-smoke.spec.ts` passes
14/14 in isolation and fails 2 under 4 parallel workers.

**Six mandated structural guardrails. Policy is not mechanism; each of these must be
enforceable by something other than the agent's own judgement.**

1. **Reviewable diff, never a direct commit — enforced architecturally, not by rule.**
   *Ruled 2026-09-28.* **The loop holds no git identity and cannot invoke git at all.** It writes
   patch files to a proposals directory, each validated with `git apply --check` and each citing
   the locus that justifies it; a human applies them. This is deliberately a *capability*
   decision rather than a *permission* decision: a deny rule on `Bash(git commit:*)` is the
   weakest available layer, because a loop that wants to commit can reach git by another spelling.
   Three backstops sit behind the architecture, in decreasing importance — branch protection on
   `main`; a `pre-commit` hook rejecting an unrecognised committer identity; and a deny rule on
   `git commit`/`git push` in the loop's own settings. The architecture does the work; the rules
   only catch a mistake in the architecture. **The deny-rule layer is a permissions change and is
   Ducdo's to apply when 11-6b is built — recorded here, not pre-applied.**
2. **App-side auto-fix only against a normative, verified, single locus.** Permitted only
   when the failing assertion maps to **exactly one** documented locus, that locus carries a
   **normative** statement (MUST / always / never), and its provenance is
   `verified-against-build`. Zero loci, two or more loci, a `descriptive` statement, or an
   `asserted-from-design-intent` entry ⇒ escalate. This replaces v0.1's unadjudicable
   "unambiguously contradicts".
3. **Test-side edits are guarded by an assertion-strength ratchet.** A loop-authored test
   diff is classified WEAKENING — escalate, never auto-land — on any of: net decrease in
   `expect(` count for the spec; locator broadening (`.first()`, `.nth()`, role → CSS, exact
   text → regex); `toHaveText` → `toBeVisible`/`toBeTruthy`; any added `timeout:`; any added
   `skip`/`fixme`; any `waitForTimeout`. A per-spec assertion floor is recorded in the ledger;
   a fix dropping below it stops. **This is the guardrail v0.1 was missing, and it covers the
   failure mode R1's own rationale describes.**
4. **Auto-fix exclusion zone.** No auto-generated app-side diff may touch migrations, RLS
   policies, authz / role-scoping code, `ai_credit_ledger` or billing, the grading pipeline,
   or immutable-grade snapshots — regardless of how clear the doc is. Those are precisely the
   existing ≥6 risks. A failure of the shape "teacher B sees a student from class A" (7-2a's
   non-disclosure 404s, 8-3a's student-privacy authz) is trivially made green by widening a
   role scope, and the loop would be behaving exactly as specified. Escalate unconditionally.
5. **Circuit breaker and review-capacity cap.** Full Go suite and affected web suite must be
   green before a diff is offered. Open auto-fix diffs are capped at **three per cycle**
   (*ruled 2026-09-28* — tighter than the 5 review proposed, and sized to a **single reviewer**:
   three patches, each needing the diff read *and* its doc citation verified, is already a real
   hour, and at daily cadence 5/cycle is ~35 a week that one person cannot review). The loop stops
   app-side fixing at the cap, and **hitting the cap is itself a signal** that the build or the
   doc is wrong, not that there are three bugs. Forty unreviewed diffs is
   functionally auto-commit, because nobody reads #37. A cycle emitting 40 fixes does not mean
   40 bugs — it means the build or the doc is wrong. Stop and escalate. The loop also carries
   a per-finding iteration ceiling and a hard stop.
6. **Flake is never fixed, and "flake" is defined narrowly.** Four outcome classes, not two:
   **app-wrong / test-wrong / doc-wrong** (causes, triaged) and **flake / infra-defect** (not
   causes). *Flake* = non-deterministic failure at **fixed worker count against an isolated
   tenant**. Worker-count-sensitive failure is an **INFRA/FIXTURE DEFECT** routed to 11-1a,
   not flake — `bilingual-smoke`'s parallel failure is shared-state contention, and
   quarantining it would use this epic to hide this epic's own bug. Stack faults (OOM,
   non-zero exit, infra abort) **invalidate the whole cycle**, never a single spec, and are
   never fed to triage. Retries: ×1 in CI, 0 locally — ×2 makes flake the cheapest path to
   green, a perverse incentive on a loop optimising for green. Every retry-pass is a recorded
   flake *event* feeding a per-spec rate; 2% needs nothing, 15% is a defect. Quarantine
   requires a budget, a named owner, a hypothesis, and an **expiry of two CYCLES, not 14 days**
   (*ruled 2026-09-28*: a day-count means something different at hourly cadence than at weekly,
   whereas a cycle is the same unit whatever the schedule — at two cycles it fails the build). It
   is shrink-only per cycle, must still **run and report** while non-gating, and operates at
   **assertion** granularity, not file — quarantining a spec because one assertion flakes buys
   silence on the other thirteen. An auto-fix that later flakes is **auto-reverted**, not quarantined — otherwise
   "flake is never fixed" plus app-write authority launders a bad fix into a silenced test.

**Why the documentation is load-bearing rather than decorative** — the doc is the *oracle*
that makes the loop's triage decidable. Without it, R1 is unsafe. Which is exactly why R6
exists.

### R2 — `docs/classlite-entry/` SPLITS; `docs/product/` becomes the oracle

**This is a split, not a move.** `docs/classlite-entry/` currently holds two artifact classes
with opposite lifecycles: one 338-line living contract (`classlite-ia.md`) and ~98,700 lines
of frozen HTML prototypes. Co-locating them is the actual defect. State this explicitly,
because "retire and migrate the tree" invites someone to `git mv` the lot and hand 98,700
lines of HTML to the reconciliation story as input — the difference between an L and a
disaster.

- Prototypes → `docs/archive/classlite-entry-prototypes/` with a README.
- IA content → absorbed into `docs/product/`.

**The archive README must grade authority per chapter, because "design history" is false for
two of them today.** Chapters 1–5 and 8 are **SUPERSEDED** — `docs/product/` wins. Chapters 6
(`s50`–`s67`) and 7 (`s68`–`s73`) are **FROZEN-AND-BINDING** — they remain the forward spec of
record for Epics 10 and 9 until those epics ship. An Epic 9/10 story author who finds design
intent under a path labelled "archive" will discount it.

**Hard constraint: `s00`–`s87` carry forward VERBATIM.** No renumbering, no re-slugging, no
"tidying" the intentional gaps in the onboarding numbering scope (the IA notes its own
mismatch with by-role numbering is deliberate). Those IDs are live vocabulary in **86 story
files** and are the join key across doc → test → failure history.

**"Verbatim IDs plus a pointer" is an intention, not a mechanism.** A pointer is a forwarding
address, not a change-of-address notice to 86 correspondents. Three things make it mechanical,
and all three land in **11-1a**, not buried in the reconciliation story:

1. **An ID manifest** — `docs/product/screens.yaml`, one entry per `sNN`: id, title, route,
   section, role visibility, chapter, `implementation_status` (`shipped` / `unbuilt-epic-9` /
   `unbuilt-epic-10`), `provenance` (`verified-against-build <SHA>` /
   `asserted-from-design-intent`), path to its detail doc, `last-verified`, and the story that
   verified it. One artifact serving all three consumers: humans navigate it, Playwright
   imports it, the loop resolves against it.
2. **A CI lint** — every `sNN` token under `docs/` and `_bmad-output/` resolves to a manifest
   entry, and every manifest entry is reachable from a doc. ~30 lines, and it is the only
   thing that actually protects 86 story files. It converts "no renumbering" from a vow into
   a build failure. Plus a **staleness** check: flag entries whose `last-verified` predates
   their screen's last code change. An oracle without a staleness detector arbitrates against
   fiction in six months.
3. **An explicit no-rewrite clause** — do NOT `sed` the 86 story files. They are historical
   implementation artifacts; rewriting them destroys the audit trail for zero gain. The IDs
   stay valid *because* they carry verbatim.

**Addressability is a hard requirement of R2, because R1 guardrail 2 depends on it.**
`docs/product/` is chapter-sharded (eight files + manifest + index — a structure-preserving
transform of the chapters that already exist, which keeps journeys intact for tests and gives
one reviewable diff per chapter). Within a chapter, each screen is `## sNN — Title` with a
**fixed sub-structure** (Purpose / Route / Roles / Controls / States / Behaviours / Out of
scope), which yields stable anchors without a database. Control-level detail uses **stable
slugs scoped under the screen ID** — `s24/auto-save-indicator`, `s24/auto-save-announcement` —
derived from the accessible name, declared in the doc, and used verbatim as the Playwright
locator key. One vocabulary, two renderings; **not** a second numbering axis.

This is what dissolves the cited live failure: declare the visible status node and the
`sr-only` announcement as two controls and the strict-mode ambiguity becomes decidable in
exactly one direction. Normative statements within a screen carry assertion IDs so a test, a
diff and a ledger row can all cite the same locus. **11-3a designs and freezes this schema on
Chapter 1; 11-3b/c apply it.**

`docs/product/` sits outside `_bmad-output/` deliberately — `_bmad-output/` is regenerable
workflow output, the oracle is a long-lived artifact consumed by runtime tooling. The archived
prototypes must be excluded from every lint, `tsc -b` and Playwright glob.

### R3 — Manual testing ships in TWO PHASES

Phase 1 = CLI/TUI session runner for Ducdo + a few devs, reading `docs/product/`, writing
results straight to the repo. Phase 2 = non-technical center staff / VN teachers.

Rationale for the split: avoid building a tester-facing surface on top of a test format that
is still churning.

**The consequence that must not be missed:** phase 1's real job is stabilising the *data
contract*, not finding bugs. The ledger schema must be designed for the non-technical case
from day one — structured records a form could populate, not free-form prose a dev types.
Same schema both phases; only the intake surface changes. Otherwise phase 2 is a rewrite.

**Phase gate:** two consecutive cycles with no change to the ledger schema or doc structure,
**plus** repro-codification demonstrated working (a human fail turned into a Playwright test
that then caught the fix).

### R4 — No Drive, no hosted connector, no hosted tester app

The interchange is a plain **`.xlsx` generated per session**: tester fills it, emails it to
Ducdo/the team, a human verifies, then it is handed to Claude for fixing.

**The xlsx is a TRANSPORT, not a store.** Truth stays in the repo ledger; each returned
workbook is *ingested*. N spreadsheets in an inbox is not a history.

**Observation vs lifecycle — the load-bearing split:**

| Tracked | Lives where | Why |
|---|---|---|
| What went wrong | Workbook + repo | Per-observation; tester writes it, ingest copies it in |
| Tested by whom | Workbook header tab | Session-level, not per-row; also weights the signal |
| **Fixed when** | **Repo only** | A workbook is a snapshot already stale when emailed; fix state across N copies yields N conflicting truths |

**Three fields testers will never supply — the generator must stamp them:** (1) **git SHA of
the build tested** (highest-value cell in the workbook; without it a report cannot be triaged
as already-fixed), (2) a **stable finding id assigned at GENERATION time**, keyed on
**screen-ID + control slug + assertion id — not step index**, which breaks the moment 11-4/11-5
renumber steps, (3) session metadata once, in a header tab.

**Recurrence is the highest-priority signal in the system:** a finding id returning after
being marked fixed is a regression, and it is only detectable because the id survived the
round trip.

**Accepted tradeoff:** no automatic evidence capture. Mitigations — an in-app "copy
diagnostics" affordance dumping `request_id` + build SHA + locale + route to the clipboard
(the API already emits `request_id` per request), plus asking testers to screen-record with
OS-native tools and note the failure timestamp. Workbooks use **data-validation dropdowns**
for verdict/severity with generated columns protected; free-text verdicts break ingest.
**Ingest treats the workbook as untrusted input** — parse cached values not formulas, cap file
size and row count.

**Bilingual text is a VIEW of the oracle, not a second oracle.** The tester's expected-result
string is *derived* from the doc's normative statement, never separately authored — two
oracles in two languages and the loop cannot triage at all. VN text is authored, not
machine-translated at runtime, and the workbook carries both languages side by side so a
Vietnamese bug report traces to an English step.

### R5 — Machine vs human split: complementary, never duplicated *(binding)*

Promoted from an unnumbered v0.1 subsection. It binds, so it is citable.

| | Owns |
|---|---|
| **Machine** | Deterministic assertions · role-visibility matrix · regression · empty/error states · i18n rendered-behaviour parity · **full-page axe across all routes** |
| **Human** | Only what has no machine oracle |

Above all, **AI grading quality** — no Playwright assertion can say a band-7 writing grade was
fair or that Vietnamese speaking feedback was useful, and that is the product's core value
proposition (Epics 4 and 6).

**But "no assertion says it was fair" does not mean there is no machine oracle.** 11-4 builds a
**frozen golden set**: expert-banded writing/speaking submissions plus four machine
assertions — (a) band within ±0.5 of expert on N samples, (b) **stability**: the same
submission graded twice lands within tolerance, (c) rubric-criteria coverage: every criterion
present, non-empty, in the requested language, (d) no PII and no fabricated citations in
feedback. **(b) cannot be skipped** — Gemini will ship a model revision and silently regress
the core value proposition, and sampled human review runs on a cadence while drift does not.
The golden set converts human review from the *only* signal into the *escalation* signal.

Human sampling is a **rubric with a sample size and an agreement measure**, not a vibe:
double-score 20% and report agreement, or rubric drift and grader drift are
indistinguishable. Also human: VN copy tone, visual layout, real-device audio capture, and
Chapter 8's 14 mobile screens on real hardware.

**Asymmetry rules, both directions.** A human *fail* is strong signal; a human *pass* is weak
(they may not have known what to look for). Capture rich evidence on fail. **Never let a human
pass retire an automated test, and never let an automated pass retire a human check** — or the
first inconvenient week, someone points at green Playwright and the rubric sampling quietly
dies. A human fail **never auto-fixes app code** — no repro, no oracle, so R1's guardrails
have nothing to arbitrate against. Every human finding ends as either a permanent automated
test or an explicit documented known-issue. Nothing evaporates.

### R6 — The loop may NEVER write to `docs/product/` *(added by review; closes R1's hole)*

The oracle is human-write-only from the loop's perspective. The loop may **propose** a doc
diff into the escalation queue; it may never land one. Doc changes come only from a human or
from a story.

**Why this is not optional.** All four reviewers reached it independently. An agent that can
edit the oracle can manufacture its own justification: resolve an ambiguity by editing the
doc, then "unambiguously" fix the app to match under R1 guardrail 2. The convergence failure
R1 is designed to prevent reappears one layer up, silently, and retroactively legitimises
every app fix that cited the edited clause. v0.1 declared the doc the oracle and left the
write path open; that was the single most serious defect in it.

`docs/product/` also needs a **named human owner**. A source of truth with no named reviewer
is a wiki.

## Prerequisites

Seed data comes **before** the documentation pass — you cannot document or screenshot 88 empty
screens, nor have Playwright act as a real user against no data.

| Prerequisite | Current state |
|---|---|
| Deterministic seed dataset | `scripts/seed.sh` is an empty stub. Story 8.5 supersede-mapped to 11-1a (8-5 stays keyed) |
| **Test database**, separate from the dev DB | Conflated with tenancy in v0.1. Per-worker tenant isolation does **not** stop row accumulation — 485 centers of residue is a *database* problem, and nothing currently deletes it |
| Per-worker tenant isolation + reset | Absent; without it "retest to confirm" confirms nothing |
| Real login for E2E | `tests/e2e/auth.setup.ts` writes a stub cookie with a Story-1.5 TODO; 1.5 shipped in June. **Owned by 11-2, named by path, because that TODO survived three months precisely because no story named the file** |
| Playwright in CI | `ci-web.yml` never runs it — the direct cause of the rot. See `FU-11-CI` |
| Backend error tracking | `SentryDSN` in `internal/config/config.go` is a decorative field. See `FU-11-SENTRY` |
| Working deploy pipeline | `deploy.yml` has **no migration step** (130 migrations) and no gate. Not a missing feature — a latent guaranteed-failure defect. See `FU-11-DEPLOY` (**P0**) |
| Staging deployment | Every Staging box in `docs/manual-setup.md` unchecked. Gates 11-9 |
| **Deterministic (stubbed) grading path** | Absent. A loop exercising Epics 4+6 repeatedly burns real Gemini credits against `ai_credit_ledger` and real rate limits. Machine tests need a stub; human sampling needs a budget |
| **Resource budget** | The local stack was OOM-killed 2026-09-27. Playwright must run against a **built preview**, not the Vite dev server (that alone is most of the memory); `--workers=1` locally; full suite CI-only with a documented local subset. AC on 11-1a |
| **Backup/restore proven** | 11-8b stands up environments holding real center data. "Backups enabled" is a checkbox; "we have restored one" is the gate |

**Backwards dependency on Epics 9 and 10.** Those epics are *written before* Epic 11 runs, so
their story authors must register every new screen in `screens.yaml` at create-story time.
This needs one line in `epic-09.md` and `epic-10.md` — recording it only here guarantees they
never see it.

## Risk register additions

Epic 11 introduces risk classes with no existing analogue and **must** be registered in
`_bmad-output/test-artifacts/test-design/test-design-architecture.md`. v0.1 added none, which
created a WF-8 hole: deferred ACs ⇒ no risk score ⇒ nothing for the ≥6 gate to key on ⇒ the
epic silently opts out of the project's own testing protocol. For an epic about verification
that is not a joke worth keeping. Provisional scores below; ratify at create-story.

| Provisional | Risk | Score |
|---|---|---|
| R-11-1 | Loop weakens assertions → false green | ≥6 |
| R-11-2 | Autonomous agent writes app code against a mutable or intent-derived oracle | ≥6 |
| R-11-3 | **Real-auth harness mints sessions reachable in a non-test build** — highest-severity *new* risk in the epic; needs a negative test asserting the harness path is dead under production config | ≥6 |
| R-11-4 | Seed/test-tenant data reaching staging or production — sharpened by FU-11-DEPLOY creating a real deploy path | ≥6 |
| R-11-5 | Cross-tenant leak via shared test tenants under parallel workers | ≥6 |
| R-11-6 | Sentry PII over student submissions/grades, minors possible | ≥6 |

**WF-8 mapping.** `11-1a`, `11-2`, `11-6b` and `11-8a` trip the ≥6 ATDD gate. Red phase for
harness stories is Go/vitest **on the harness code**, not Playwright-on-Playwright. The E2E
red convention does not exist yet: a spec imports a not-yet-existing page-object/fixture
module so `tsc -b` goes red, consistent with the existing FE convention — document it in
`docs/bmad-story-conventions.md` as part of 11-2. For `11-6b` **the red phase is the guardrail
tests**: a doc-`silent` fixture MUST produce an escalation and MUST NOT produce a patch; a
patch lacking a locus citation MUST be rejected; a net-negative-assertion test diff MUST
escalate. All unit-testable, all red-first. `11-8a` takes a **documented WF-8 exception**
(red-phase is pantomime for infra) rather than silence.

## Stories

Seventeen stories. **Waves are named by what they gate, not by dependency** — v0.3's correction,
since "launch" turned out to be two dates wearing one word.

| Wave | Gates | Contents |
|---|---|---|
| **A** | **Exposure** — first real users. Wave A *is* launch; nothing else can deploy v2 | 11-0a · 11-0b · 11-8a · 11-1a · 11-2 · 11-3a · 11-5a |
| **— L1 —** | *Design-partner cohort milestone: 2–3 centers, free, hand-held, v1 left running* | |
| **B** | **Paid GA** — built after the pilot says which flows matter | 11-3b · 11-4 · 11-5b · 11-6a · 11-6b · 11-7 |
| **C** | Genuinely epic-gated (Chapter 6 = Epic 10, Chapter 7 = Epic 9) | 11-1b · 11-3c |
| **D** | Tester-facing and GA provisioning | 11-8b · 11-9 |

Acceptance criteria are written for the Wave A stories whose scope depends on nothing unbuilt —
they are interface contracts, and deferring them defers nothing while losing what downstream
compiles against. The rest defer to `/bmad-create-story` with fresh recon, per this project's
pattern of material scope movement at that step.

---

### Wave A — gates EXPOSURE (and constitutes launch)

#### Story 11-0a: Backend Error Tracking & Request-Scoped Telemetry

| Field        | Value        |
| ------------ | ------------ |
| Size         | S            |
| Audience     | Backend      |
| Dependencies | none         |

**As** Ducdo, **I want** backend errors and request-scoped context to reach somewhere I can
search, **so that** a cross-tenant leak or a lost submission in front of a pilot center is
something I discover rather than something a customer tells me about weeks later.

Promotes `FU-11-SENTRY` into a sequenced story. `SentryDSN` is currently read in
`internal/config/config.go` and logged, with no dependency in `go.mod`, no init and no capture —
backend errors go to stdout and vanish. The frontend is genuinely instrumented but inert for
want of a DSN. **Session replay stays OFF in every environment** until masking is verified
(education product, minors plausible — see the resolved question below). Also covers log
retention: Sentry gives you errors, triage needs request-scoped logs, and Railway retention is
short. The API already emits `request_id` per request, so correlation is half-built.

**Done when:** a deliberately triggered backend error is searchable with its `request_id`, and
the frontend DSN is live in every deployed environment.

#### Story 11-0b: AI Grading Calibration Gold Set

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | QA + product       |
| Dependencies | none               |

**As a** teacher deciding whether to trust an AI band score, **I want** the grader's output
measured against real examiner judgement, **so that** I am not doing double work reading a
plausible-but-wrong grade and regrading by hand.

**Product evidence, not QA.** A frozen set of IELTS writing and speaking samples with
examiner-assigned bands, plus the four machine assertions from R5 — band accuracy vs expert,
**stability** (same submission graded twice within tolerance), rubric-criteria coverage, and no
PII or fabricated citations. Stability is the one that cannot be skipped: Gemini will ship a
model revision and silently regress the core value proposition, and cadence-based human
sampling would not notice. Feeds 11-4's rubric rather than duplicating it.

**Sourcing — ruled 2026-09-28: published anchors plus the center's own banded work, in that
order.** Seed from official Cambridge/IDP sample answers, which ship with **examiner-assigned
bands and commentary** — authoritative, already banded, free. Then have a teacher band a set of
the center's own real submissions to cover **bands 4–6**, where published samples are thin (they
skew to model answers at higher bands) and where these students actually sit. This beats either
pure option: the published half anchors against accredited judgement so an in-house grading bias
cannot quietly become the gold standard, and the second half doubles as real-data validation on
the distribution that matters. A certified examiner stays available as the escalation if the two
halves disagree.

**Done when:** Gemini's bands sit within the agreed tolerance of examiner bands across the set,
a deliberately perturbed grade is caught, and a Vietnamese teacher has rated the VN feedback's
usefulness.

#### Story 11-8a: Deploy Pipeline — Migrations, Gate, Smoke, Rollback

| Field        | Value        |
| ------------ | ------------ |
| Size         | M            |
| Audience     | Infra        |
| Dependencies | none         |

**As the** team, **I want** the deploy pipeline to apply migrations and refuse to ship on
failure, **so that** the first real deploy does not meet an empty schema.

**`FU-11-DEPLOY`, P0 — ahead of everything.** This is the only story in the backlog that can
put v2 on the internet, which is why John's reading is that Wave A does not gate launch, it
*is* launch. `deploy.yml` has no migration step for 130 migrations, and fires on any green
`main` straight to production with no gate, approval, smoke test or rollback path. With v1
effectively empty the *data-loss* severity is lower than feared, but the pipeline is still the
gate on exposing anything at all.

**Done when:** a deploy with a failing migration aborts without shipping, and a rollback has
been exercised once.

##### Acceptance Criteria

**Given** 130 migrations and a target database
**When** deploy runs
**Then** `migrate up` runs as a **dedicated privileged migrator credential in a CI step**, not as `classlite_app` and not on API boot
**And** DDL privilege never resides in the long-running app process (preserving what the 228-file Go suite protects)

**Given** a migration that exits non-zero
**Then** the deploy aborts fail-closed and no new image receives traffic

**Given** a successful deploy
**Then** a post-deploy smoke check runs against `/health` and one authenticated route
**And** a documented rollback path exists and has been exercised once

**Given** `main` goes green
**Then** production deploy requires an explicit gate, not merely a successful CI run

#### Story 11-1a: Seed Data, Fixtures & Test-Tenant Isolation (shipped domain)

| Field        | Value        |
| ------------ | ------------ |
| Size         | L            |
| Audience     | Backend      |
| Dependencies | none         |

**As a** developer, **I want** a deterministic seeded dataset with per-worker tenant isolation
and a reliable reset, **so that** every test and every manual session starts from a known
state instead of eight epics of accumulated residue.

Supersedes Story 8.5 (which stays keyed in `sprint-status.yaml` — Epic 8 cannot close with a
story silently vanished). Carries the `screens.yaml` manifest, the s-ID lint and the staleness
check from R2, because they protect 86 story files and must exist before the doc pass starts.
Separates the **test database** problem from the tenancy problem: per-worker isolation does not
stop row accumulation, and 485 centers of residue is a database-lifecycle defect.

**Done when:** a clean checkout can produce an identical multi-role center twice, and tenant A
cannot observe tenant B under parallel workers.

##### Acceptance Criteria

**Given** a clean database
**When** the seed runs twice
**Then** row counts are identical after each run (idempotent)
**And** the dataset covers all roles (owner/admin/teacher/student) across Epics 1–8 entities

**Given** seeded tenants A and B
**When** a session scoped to A queries the five RLS tables exercised by 8-4a
**Then** zero rows of B's data are visible in either direction

**Given** seeded tenants A and B
**When** `reset(A)` runs
**Then** B's row counts are unchanged

**Given** the seed has run
**Then** it writes `tests/e2e/.auth/credentials.json` (gitignored) for `11-2` to consume
**And** `docs/product/screens.yaml` exists with one entry per `s00`–`s87`
**And** the CI lint fails on any `sNN` token under `docs/` or `_bmad-output/` with no manifest entry

**Given** a developer machine
**When** the documented resource budget is applied
**Then** Postgres + API + a built web preview + the documented worker ceiling run without OOM
**And** a destructive dev-DB reset exists, env-guarded, refusing to run outside dev

#### Story 11-2: Real-Auth E2E Harness

| Field        | Value        |
| ------------ | ------------ |
| Size         | S            |
| Audience     | Full-stack   |
| Dependencies | 11-1a        |

**As a** developer, **I want** Playwright to authenticate as a real user of each role,
**so that** the dashboard, cross-subdomain and mobile projects test something other than a
placeholder cookie.

Retires `tests/e2e/auth.setup.ts`'s `classlite_session=stub-session-token-for-phase-0` and its
Story-1.5 TODO — **named by path**, because that TODO survived three months precisely because no
story named the file. Documents the E2E red-phase convention.

**Done when:** no stub cookie remains in the repo and every Playwright project authenticates
through the real login endpoint.

##### Acceptance Criteria

**Given** the credentials manifest from 11-1a
**When** `auth.setup.ts` runs
**Then** it POSTs the real login endpoint and captures a real `Set-Cookie` per role
**And** no hard-coded stub token remains anywhere under `tests/`

**Given** an authenticated teacher storageState
**When** a role-scoped route is requested
**Then** 200 for the owning role
**And** 404 (not 403) for a non-owning teacher, matching 7-2a's non-disclosure axis

**Given** production configuration
**When** the harness's session-minting path is exercised
**Then** it is unreachable (negative test for risk R-11-3)

**Given** refresh-token rotation mid-run
**Then** the storageState survives, or the harness re-authenticates deterministically

#### Story 11-3a: Product Doc Schema + Chapter 1 Pilot

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Full-stack + docs  |
| Dependencies | 11-1a              |

**As a** developer and as the loop, **I want** a frozen documentation schema proven on one
chapter, **so that** 88 screens are not written against a schema being designed in the same
breath.

Performs the R2 split (archive vs absorb, with the graded-authority README), authors the
per-screen sub-structure, the control-slug naming rule, assertion IDs, `implementation_status`
and `provenance` fields, the bilingual derivation rule, and reconciles Chapter 1 (`s00`–`s09`,
all shipped) as calibration. Runs in parallel with the rest of Wave A and **gates nothing for
exposure** — but freezing the schema early is what keeps 11-3b cheap.

**Done when:** Chapter 1 is reconciled, the schema is frozen, and the per-screen reconciliation
cost is a measured number rather than an estimate.

##### Acceptance Criteria

**Given** `docs/classlite-entry/`
**When** the split completes
**Then** the 13 HTML prototypes live under `docs/archive/classlite-entry-prototypes/` with a README grading Chapters 1–5 and 8 SUPERSEDED and Chapters 6–7 FROZEN-AND-BINDING
**And** a pointer remains at the old `classlite-ia.md` path
**And** the archive is excluded from every lint, `tsc -b` and Playwright glob
**And** no `sNN` reference in the 86 story files was rewritten

**Given** a reconciled screen in Chapter 1
**Then** it carries Purpose / Route / Roles / Controls / States / Behaviours / Out of scope
**And** each normative statement has an assertion ID and an `assertion_strength`
**And** each control needing a locator has a slug scoped under the screen ID
**And** its manifest entry carries `implementation_status`, `provenance` and `last-verified`

**Given** the "Auto-save on" dual-render case
**Then** the visible indicator and the `sr-only` announcement are declared as two distinct controls

**Given** the pilot is complete
**Then** the measured per-screen reconciliation cost is recorded for sizing 11-3b and 11-3c

#### Story 11-5a: Money-Path Smoke + CI Gate

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Frontend + QA      |
| Dependencies | 11-1a, 11-2        |

**As** Ducdo, **I want** one real-stack journey proven green in CI before any center touches
this, **so that** the path the whole product exists to serve is known to work end to end —
which it never has been.

**No full-stack path has ever been exercised.** This is the one: owner login → class →
assignment → each of the four attempt types → grade → student reads the result. Against the real
stack, seeded, authenticated. Lands the Playwright CI gate itself (superseding `FU-11-CI`) plus
the quarantine lane and the **dual-rendered-text query convention** into
`docs/bmad-story-conventions.md` — the `sr-only` break is a class, not a bug, and rebuilding
specs without the convention re-breaks on the next a11y addition. Built preview, not the Vite
dev server. **Explicitly not** the 87-screen grid; that is 11-5b, after the pilot.

**Done when:** CI fails on a regression in the money path, and the quarantine allow-list is
shrink-only.

---

### — Milestone L1: design-partner cohort —

2–3 centers, free, hand-held, v1 left running. Ducdo *is* the error tracking until 11-0a lands,
which is why 11-0a precedes this. Obtain Polar credentials during this window so they never
become the blocker on Epic 9 — Mary's note that the only revenue path is gated on a signup form
stands. Everything in Wave B is built against what L1 actually asks for.

---

### Wave B — gates PAID GA (built after L1)

#### Story 11-3b: Product Doc Reconciliation — shipped chapters

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack + docs  |
| Dependencies | 11-3a              |

Chapters 2–5 and 8. **Done when:** every `s`-ID there is marked verified or drifted, drift filed.

#### Story 11-4: Scenario Design, Machine/Human Split & Rubric

| Field        | Value        |
| ------------ | ------------ |
| Size         | M            |
| Audience     | QA           |
| Dependencies | 11-3a, 11-0b |

Per R5, prioritised by what L1 showed matters. Consumes 11-0b's gold set rather than rebuilding
it; adds the rubric sample size and agreement measure (double-score 20%, or rubric drift and
grader drift are indistinguishable) and the role-visibility authz grid.

#### Story 11-5b: Playwright Rebuild — remaining journeys

| Field        | Value                  |
| ------------ | ---------------------- |
| Size         | L                      |
| Audience     | Frontend + QA          |
| Dependencies | 11-5a, 11-4            |

Replaces the remaining stubbed specs journey by journey, **sequenced by L1's evidence, not by
chapter order**. Full-page axe across all routes (machine work per R5) and the i18n
rendered-behaviour fixture land here.

#### Story 11-6a: Loop Harness — Read-Only

| Field        | Value        |
| ------------ | ------------ |
| Size         | L            |
| Audience     | Full-stack   |
| Dependencies | 11-5b        |

Classify / quarantine / record-back / escalate — **writes nothing.** Five-class outcome model per
R1 guardrail 6, record-back keyed by screen-ID + control slug + assertion id, stack-health
assertion around every spec. Sentry consumed as a **scenario generator, not a fix trigger.**
Split from the original single story so the classifier's precision is measured before it is
granted authority.

#### Story 11-6b: Loop Harness — Write Authority

| Field        | Value                                          |
| ------------ | ---------------------------------------------- |
| Size         | L                                              |
| Audience     | Full-stack                                     |
| Dependencies | 11-6a + the two-condition precision gate below |

Implements all six R1 guardrails as mechanism.

**Gate — ruled 2026-09-28. Two conditions, both over two consecutive cycles:** (a) ≥90% agreement
with Ducdo's triage across all five outcome classes, **and** (b) **zero false-confident
classifications** — no case where the loop called something safe-to-patch when the truth was
test-wrong or doc-wrong. **(b) is the real gate.** Overall agreement is the wrong sole metric
because the five classes are **not symmetric in consequence**: 90% overall could conceal a 30%
error rate on the one class carrying write authority, and a missed flake and a wrong app-patch are
not equally bad. (b) is the only error that ships a bad patch.

If the gate is not met, write authority stays off and nothing is lost but the interval — 11-6a
keeps delivering triage, quarantine and escalation, which is most of the value. **The red phase is
the guardrail tests.**

#### Story 11-7: Manual Session Runner — CLI + Workbook Generator/Parser

| Field        | Value            |
| ------------ | ---------------- |
| Size         | L                |
| Audience     | Full-stack       |
| Dependencies | 11-3a, 11-4      |

Four tabs (Session / Steps / Notes / Rubric), stamped provenance, regression-workbook mode,
untrusted-input ingest. The parser is the real work — it must survive renamed tabs, values
pasted over dropdowns, and reordered or deleted rows, which is exactly why generation-time
finding IDs earn their keep. Uses the `xlsx` skill.

---

### Wave C — genuinely gated on Epics 9 and 10

#### Story 11-1b: Seed Extension — Epic 9 & Epic 10 entities

| Field        | Value                        |
| ------------ | ---------------------------- |
| Size         | S                            |
| Audience     | Backend                      |
| Dependencies | 11-1a, Epic 9, Epic 10       |

**Done when:** Chapter 6 and 7 screens render seeded, non-empty.

#### Story 11-3c: Product Doc Reconciliation — Chapters 6 & 7

| Field        | Value                        |
| ------------ | ---------------------------- |
| Size         | M                            |
| Audience     | Full-stack + docs            |
| Dependencies | 11-3a, Epic 9, Epic 10       |

**Done when:** the archive README downgrades Chapters 6–7 from FROZEN-AND-BINDING to SUPERSEDED.

---

### Wave D — tester-facing and GA provisioning

#### Story 11-8b: Staging Environment Provisioning

| Field        | Value               |
| ------------ | ------------------- |
| Size         | M                   |
| Audience     | Infra + Ducdo toil  |
| Dependencies | 11-8a               |

The Staging column of `docs/manual-setup.md`: Railway project, Cloudflare Pages, DNS, secrets.
Largely Ducdo's toil rather than dev capacity — size accordingly. Owns **k6 / FU-8-4-PERF
against staging** (never local; load numbers from a machine that OOMs are noise) and the
**proven** backup/restore gate — "backups enabled" is a checkbox, "we have restored one" is the
gate. Epic 9's payment provider needs sandbox credentials and webhook delivery here.

#### Story 11-9: Guided Sessions with Prospective Centers (VN-first)

| Field        | Value                              |
| ------------ | ---------------------------------- |
| Size         | M                                  |
| Audience     | Full-stack + product               |
| Dependencies | 11-7, 11-8b, R3 phase gate met     |

**As a** Vietnamese teaching-center owner who has never seen this product, **I want** to be
walked through it in my own language, **so that** I can tell you both what is broken and whether
I would pay for it.

**Reframed in v0.3 (Mary).** This was scoped as recruiting "testers"; it is a customer-research
instrument wearing a QA costume. Recruit **prospective center owners and teachers** instead, run
the identical guided session, and harvest usability findings *and* demand signal from the same
hour. It is the only story in the plan that touches the demand gap — which both round-2
reviewers named as the dominant risk to the venture, ahead of anything this epic verifies.

VN-first workbooks with text **derived** from the oracle per R4, the in-app copy-diagnostics
affordance, and a distribution + ingest runbook. **No hosted app** per R4.

**Done when:** a non-technical prospective customer completes a session unaided, their workbook
ingests clean, and their willingness-to-pay is recorded.

## Open Questions

**None outstanding.** All five were ruled by Ducdo on 2026-09-27/28. Recorded below so they are not
re-litigated, and so the *reasoning* survives — which is the part that decays.

- **OQ-11-1 — what mechanically prevents the loop committing?** → **The loop holds no git identity
  and cannot invoke git.** Patch files to a proposals directory; a human applies them. Backstops in
  decreasing importance: branch protection on `main`, a `pre-commit` hook rejecting an unrecognised
  committer, a deny rule on `git commit`/`git push`. Chosen as a *capability* decision rather than a
  *permission* one, because a deny rule is the weakest layer — git can be reached by another
  spelling. The deny-rule layer is a permissions change, **Ducdo's to apply when 11-6b is built**;
  recorded, not pre-applied. → R1 guardrail 1.
- **OQ-11-2 — diff cap and quarantine expiry.** → **Three open auto-fix diffs per cycle**, tighter
  than review's 5 and sized to a single reviewer; hitting the cap is a signal, not a quota.
  **Quarantine expires after two CYCLES, not 14 days** — a cycle is the same unit at any cadence.
  → R1 guardrails 5 and 6.
- **OQ-11-3 — what gates write authority?** → **Two conditions over two consecutive cycles:** ≥90%
  agreement with Ducdo's triage across the five classes, **and zero false-confident
  classifications**. The second is the real gate; the classes are not symmetric in consequence and
  an overall percentage can hide the one error that ships a bad patch. → 11-6b.
- **OQ-11-4 — does Epic 11 gate launch?** → **No.** John and Mary, separately: Wave A does not gate
  launch, it *constitutes* it — 11-8a is the only story that can deploy v2. Wave B gates **paid
  GA**, not first users. Epic 9 gates **revenue only**. Epic 10 gates nothing and should be
  re-scoped against what L1 asks for (John's bet: it halves — a Vietnamese center runs on Zalo and
  will keep running on Zalo whether or not you build an inbox). Ducdo ruled **v1 effectively
  empty**, so this is a greenfield launch and the cutover question is moot.
- **OQ-11-5 — where does examiner judgement come from?** → **Published anchors plus the center's own
  banded work.** Official Cambridge/IDP samples carry examiner bands and commentary, anchoring
  against accredited judgement so an in-house bias cannot become the gold standard; a teacher then
  bands real submissions to cover bands 4–6, where published samples are thin and these students
  sit. A certified examiner remains the escalation if the halves disagree. → 11-0b.

**Applied on a reviewer's recommendation, not explicitly ratified** — flagged so it is a conscious
inheritance rather than an unexamined assumption: Winston's **migration privilege model**
(`migrate up` as a dedicated privileged credential in a CI step, never on API boot). It survived
two review rounds unchallenged and is written into 11-8a's acceptance criteria. Say so if you want
it revisited.

**Resolved earlier, kept for the record:**

- *Where does the unbuilt-screen flag live?* → the `screens.yaml` `implementation_status` field. Not
  the scenario layer: two oracles and R1's decidability argument collapses. An `unbuilt` assertion
  SKIPS with reason, and one that *starts passing* reports doc staleness.
- *Sentry session-replay PII masking?* → **replay OFF in every environment** until masking is
  verified; masking is a hard precondition inside 11-0a. The loop consumes Sentry *events*, which
  need no replay, so nothing is blocked. Education product, minors plausible, Vietnamese
  jurisdiction — a consent dimension may also exist; default off until answered.
- *Does the Playwright suite need a CI-only mode?* → not a question, a prerequisite. CI is the
  default; local is an opt-in subset against a built preview at `--workers=1`. An OOM would
  otherwise be *classified* as flake and quarantined, silently eroding the suite — hence the
  stack-health requirement in 11-6a.
