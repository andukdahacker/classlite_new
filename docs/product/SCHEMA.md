# The product-doc schema — frozen contract

_Story 11-3a froze this schema on **one** chapter (Chapter 1, `s00`–`s05`) before any other chapter
is written. Freezing first is deliberate: Epic-11 risk **R3** is that a schema designed **while** it
is applied across 88 screens fails (that is how v0.1 failed). Everything a downstream consumer — a
human author, Playwright, the QA loop — needs to resolve against `docs/product/` is defined here.
Chapters 2–8 are reconciled against **this** contract in 11-3b / 11-3c; they do not get to invent a
new shape._

**This file is frozen.** Changing the schema is a deliberate, reviewed act (it invalidates every
reconciled chapter and every finding keyed against it), not a side effect of authoring a chapter.

---

## 1. Per-screen sub-structure (fixed, in this order)

Every **reconciled** screen is documented under a `## sNN — Title` heading (the title matches the
screen's `title` in [`screens.yaml`](./screens.yaml)) with exactly these sub-sections, in order:

1. **Purpose** — one sentence: what the screen is for and to whom.
2. **Route** — the real route (or `—` for a screen that is a state/overlay of another route).
3. **Roles** — the roles that can reach it. Lists the **canonical** reachers and matches the
   manifest `roles` array. A **persona/state variant** that reaches the same screen by a different
   route (e.g. Solo reaching `s04`/`/setup/done` via `DoneHeroPanel`'s persona branch) is described
   in this prose **but is not added to the manifest `roles`** — the manifest array stays the
   canonical-reacher set so Playwright/loop consumers key on a stable list, and variants live in the
   screen's narrative (per DD1, onboarding extras are persona/state variants, never new IDs or roles).
4. **Controls** — every locator-bearing control, each with its **control slug** (§4).
5. **States** — the Loading / Empty / Error / and any domain states the screen renders (UX-1).
6. **Behaviours** — the normative statements, each with an **assertion ID** + **strength** (§2) and
   a **bilingual view** (§5).
7. **Out of scope** — what this screen explicitly does **not** do (kills scope-creep assertions).

A **shell** screen (not yet reconciled) carries only the `## sNN — Title` heading plus the manifest
Route/Roles/Section/Status and a `_Reconciliation pending (<story>)._` marker. The `## sNN` heading
is mandatory even in a shell so the `entry → doc` integrity check in `scripts/screens-lint.mjs`
stays green for all 89 ids.

---

## 2. Assertion IDs + strength

Every **normative statement** in a screen's **Behaviours** (and any normative Controls/States note)
carries an **assertion ID** and an **`assertion_strength`**.

### Grammar

Assertion IDs are **scoped under the screen id** so they survive the step-renumbering that 11-4 /
11-5 will do (R3/R4 — the loop keys findings on these, not on volatile step numbers):

```
sNN/aN                     — a screen-level assertion            e.g.  s00/a1
sNN/<control-slug>/aN      — an assertion anchored to a control  e.g.  s00/continue/a1
```

- `N` is a positive integer, assigned in authoring order within its scope, never reused once
  retired (append-only — retiring an assertion leaves a gap, it does not renumber survivors).
- Prefer the control-anchored form whenever the statement is about a specific control.

### `assertion_strength` (enum — exactly these three)

| Strength | Meaning | Loop behaviour |
|---|---|---|
| `must`  | A hard guarantee. A build that violates it is a defect. | A `must` that the build contradicts is a **fail**. |
| `should`| A strong expectation; a deliberate, documented exception is permitted. | A violated `should` is a **concern**, triaged not auto-failed. |
| `may`   | An allowed-but-optional behaviour. | Informational; never a failure on its own. |

The loop's weakening-detector (R-11-1) reads `assertion_strength`: silently downgrading an assertion
(`must` → `should` → `may`) across a reconciliation is the exact drift the ratchet + the loop guard
against. **Strength is only ever raised or held without review; lowering it is a reviewed act.**

### In-doc form

Write each as a tagged list item so it is greppable and the strength is machine-readable:

```md
- **[s00/a1 · must]** The Continue button is disabled until a persona is selected.
  - _vi:_ Nút Tiếp tục bị vô hiệu hoá cho đến khi chọn một vai trò.
```

---

## 3. (reserved)

_Section intentionally left as a stable anchor; provenance rules are §6._

---

## 4. Control-slug rule

Every control that a test (or a human) needs to **locate** carries a **control slug**:

```
sNN/<kebab-slug>
```

- `<kebab-slug>` is derived from the control's **accessible name** (its label / `aria-label` /
  visible text), lower-cased, non-alphanumerics collapsed to single hyphens. It is **declared in the
  doc** and is usable **verbatim as a Playwright locator key** (the manual-session runner + the loop
  both resolve controls by this slug, never by a brittle CSS path).
- The slug is **stable across step-renumbering** — it is anchored to the screen + the control's
  purpose, not to a position.
- Where the shipped control exposes a `data-testid`, record it next to the slug so the slug ↔ DOM
  mapping is explicit and verifiable.

### Worked example — the "Auto-save on" dual-render _(the canonical case)_

This is the example the rule exists for: **one piece of state, rendered twice** — once as a
**visible status node** and once as a separate **`sr-only` live-region announcement** — must be
**two distinct controls**, because a locator that targets "the save status" would otherwise be
ambiguous (it matches two nodes, or silently the wrong one), and the visible text and the announced
text are deliberately *different* (the visible one ticks "Last saved 5s ago"; the announced one is a
static "Last saved" so screen readers are not assaulted every second).

**The real screen that renders it** (confirmed by grepping `classlite-web/src` on baseline
`e4904b6` — this **corrects the epic's provisional `s24`**, which is Speaking-grading and has no
autosave live-region):

> **Primary — the true dual-render: the onboarding shell's `AutoSaveIndicator`**
> (`classlite-web/src/features/onboarding/components/AutoSaveIndicator.tsx:70–80`), rendered on
> Chapter-1 screens **`s01` / `s02` / `s03` / `s05`** (every `/setup/*` step except `/welcome` and
> `/setup/done`). It literally renders two sibling nodes for the same state:
>
> ```tsx
> <span role="status" aria-live="polite" className="sr-only">{announcement}</span>  // announced
> <span aria-hidden="true">{visibleLabel}</span>                                      // visible
> ```
>
> The idle label is the literal string **"Auto-save on"** (`onboarding.wizard.autoSaving.idle`); the
> announced form of `saved` is the static "Last saved" (`…savedAnnouncement`), while the visible form
> ticks "Last saved {{seconds}}s ago".
>
> **Secondary — the single-node variant: the writing editor's `SaveStatusIndicator`**
> (`classlite-web/src/features/attempts/components/SaveStatusIndicator.tsx`), rendered on the writing
> attempt **`s34`** (`/assignments/{id}/write`) and mobile essay **`s78`**. Here the visible label
> **is** the live region (one `role="status" aria-live="polite" aria-label="Auto-save status"` node,
> text not `aria-hidden`). This is a valid accessible pattern — and it is exactly why the slug rule
> gives each render-concern its own slug even when the shipped component currently fuses them: a
> future split, or a locator that needs the *announced* text vs the *visible* pill, stays addressable
> without a schema change.

**The two slugs** (illustrated on `s01`; the same pair applies on `s02`/`s03`/`s05`):

| Slug | Renders | Accessible handle |
|---|---|---|
| `s01/auto-save-indicator` | the **visible** status node (ticks "Last saved Ns ago") | `aria-hidden` span, `data-testid="auto-save-indicator"` |
| `s01/auto-save-announcement` | the **`sr-only`** live-region announcement (static state) | `role="status" aria-live="polite"` span |

> Reconciliation note (DD6): the epic cited `s24/auto-save-*`; the grep shows the dual-render lives
> on the onboarding shell (Chapter 1) and the writing editor (`s34`/`s78`), **never `s24`**. This
> worked example is a schema demonstration — `s34`/`s78` reconcile for real in 11-3b/c.

---

## 5. Bilingual derivation (R4) — a view, not a second oracle

Vietnamese is co-primary (UX-2), but the docs must have **one** oracle, not two that can disagree.

- Each **normative EN statement** carries a **VN view** that is **derived/authored from the EN**,
  recorded inline under the assertion (the `_vi:_` line in §2). It is **not** machine-translated at
  runtime and **not** separately authored — two independently-authored language oracles are exactly
  what makes the loop's triage undecidable (which one is right?).
- The VN view is a **rendering of the same assertion**; when the EN assertion changes, its VN view is
  re-derived in the same edit. The loop compares behaviour against the EN assertion; the VN view is
  for human authors and VN-locale verification.
- VN authoring may require a native speaker (Ducdo); a dev may **dev-draft** the VN view for review.
  The pilot records VN authoring cost separately so 11-3b/c sizing is honest.

---

## 6. Provenance + `verified-sha` (the ratchet — DD15)

Each manifest entry carries `provenance` (enum: `asserted-from-design-intent` |
`verified-against-build`), `detailDoc` (`null` until reconciled; then `path#anchor` into a chapter
doc), `last-verified` (`YYYY-MM-DD`), and — once reconciled — `verified-sha`.

**The ratchet**, enforced by `scripts/screens-lint.mjs` (AC4) the moment a screen is reconciled:

> A **non-null `detailDoc`** (⇒ the screen has been reconciled) **FAILS the lint** unless its
> `provenance` is **`verified-against-build`** carrying a well-formed **`verified-sha`** (a 7–40 char
> lowercase hex git sha) — **OR** the entry carries a dated exemption
> `provenance-exemption: YYYY-MM-DD <reason>`.
> The lint also FAILS if a non-null `detailDoc`'s file (anchor stripped, resolved from the repo root)
> does not exist on disk.

- `verified-against-build` means: an author navigated/read the **shipped** screen at `verified-sha`
  and the doc's assertions match what the build does. It is a claim about a **specific commit**.
- `provenance-exemption` is the pressure-relief valve: a reconciliation that must land before the
  provenance can be fully upgraded (e.g. a VN-view awaiting native review) states a date + reason and
  passes — but the exemption is visible, dated, and greppable, so it cannot rot silently.
- **Staleness** (the screen drifting away from `verified-sha` as the app changes) is detected by a
  git-log detector that is **out of scope here** → it lands in **11-3b** (`FU-11-1A-STALENESS`).
  11-3a produces the `verified-against-build <sha>` provenance that staleness will consume.

### Flat-key discipline (the lint parser is hand-rolled)

`screens.yaml` is parsed by a zero-dependency line parser — **every field must stay a flat
`key: value` line**. `verified-sha` and `provenance-exemption` are flat keys for this reason. Do not
nest them under a sub-map.

---

## 7. Worked skeleton

```md
## s00 — Persona pick

**Purpose.** <one sentence>

**Route.** `/welcome`

**Roles.** all

**Controls.**
- `s00/operator-card` — the Operator persona tile (radio). `data-testid` / accessible name: …
- `s00/continue` — the Continue button. …

**States.**
- **Loading** — <skeleton description> (`data-testid="…"`).
- **Error** — <message + retry>.
- …

**Behaviours.**
- **[s00/a1 · must]** <EN assertion>.
  - _vi:_ <VN view>.
- **[s00/continue/a1 · must]** <EN assertion about the Continue control>.
  - _vi:_ <VN view>.

**Out of scope.**
- <what this screen does not do>
```
