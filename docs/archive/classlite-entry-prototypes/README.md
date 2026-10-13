# Archived entry prototypes — `classlite-entry`

_Archived by Story **11-3a** (the Epic-11 R2 split). These 14 `.html` files are the
original ClassLite design prototypes (~98,700 lines total). They were **moved, not
rewritten** — never opened, never transformed. They are kept for provenance and as the
frozen design intent for the chapters that have not yet been superseded by
[`docs/product/`](../../product/)._

> **This directory is excluded from every programmatic consumer** — `scripts/screens-lint.mjs`
> (markdown/yaml only; see `SKIP_DIRS`), `tsc -b`, and every Playwright glob. The `.html`
> files were already outside those globs; the exclusion is now explicit and defensive so a
> future `.md` dropped under `archive/` can never red the build. Nothing here is a source of
> truth for the lint — the manifest at `docs/product/screens.yaml` is.

## What moved

| File | Chapter(s) | Screens |
|---|---|---|
| `01-owner-onboarding.html` | 1 — Onboarding | `s00`–`s09` (persona-forked) |
| `02a-teacher-dashboard-classes.html` | 2a — Teacher · dashboard/classes | `s06`–`s10`, `s10a` |
| `02b-teacher-time.html` | 2b — Teacher · time | `s11`–`s14` |
| `02c-teacher-content-grading.html` | 2c — Teacher · content & grading | `s15`–`s25` |
| `02d-teacher-resources.html` | 2d — Teacher · resources | `s26`–`s28` |
| `03-student.html` | 3 — Student | `s29`–`s38` |
| `04-owner-admin.html` | 4 — Admin & Owner | `s39`–`s44` |
| `05-cross-role.html` | 5 — Across roles | `s45`–`s49` |
| `06a-inbox.html` | 6a — Inbox | `s50`–`s52` |
| `06b-empty-states.html` | 6b — Empty states | `s53`–`s62` |
| `06c-error-states.html` | 6c — Error states | `s63`–`s67` |
| `07-billing.html` | 7 — Billing & limits | `s68`–`s73` |
| `08-mobile.html` | 8 — Mobile | `s74`–`s87` |
| `index.html` | — | Cross-file navigation hub |

## Authority — graded **per chapter**

The prototypes do **not** all carry the same authority. Grade them by chapter:

| Chapter | Screens | Authority | What wins |
|---|---|---|---|
| 1 — Onboarding | `s00`–`s05` | **SUPERSEDED** | [`docs/product/01-onboarding.md`](../../product/01-onboarding.md) — Chapter 1 (`s00`–`s05`) fully reconciled against the shipped build by 11-3a. The IA's `s06`–`s09` are a file-scoped namespace reuse that carries its **teacher** meaning in Chapter 2 (`asserted-from-design-intent`, reconciled by 11-3b) — see the namespace note below; the onboarding Solo/Founder/handoff screens are documented there as persona/state variants, not as new IDs. |
| 2 — Teacher | `s06`–`s28`, `s10a` | **SUPERSEDED** | [`docs/product/02-teacher.md`](../../product/02-teacher.md) once 11-3b reconciles it; until then the shipped app is the truth and this prototype is reference only. |
| 3 — Student | `s29`–`s38` | **SUPERSEDED** | [`docs/product/03-student.md`](../../product/03-student.md) (reconciled by 11-3b). |
| 4 — Admin & Owner | `s39`–`s44` | **SUPERSEDED** | [`docs/product/04-admin-owner.md`](../../product/04-admin-owner.md) (reconciled by 11-3b). |
| 5 — Across roles | `s45`–`s49` | **SUPERSEDED** | [`docs/product/05-cross-role.md`](../../product/05-cross-role.md) (reconciled by 11-3b). |
| **6 — Inbox / Empty / Error** | **`s50`–`s67`** | **FROZEN-AND-BINDING** | **This prototype (`06a`/`06b`/`06c`).** The forward design spec of record for **Epic 10** until Epic 10 ships. |
| **7 — Billing & limits** | **`s68`–`s73`** | **FROZEN-AND-BINDING** | **This prototype (`07-billing.html`).** The forward design spec of record for **Epic 9** until Epic 9 ships. |
| 8 — Mobile | `s74`–`s87` | **SUPERSEDED** | [`docs/product/08-mobile.md`](../../product/08-mobile.md) (reconciled by 11-3b). |

### ⚠️ Warning to an Epic 9 / Epic 10 author

**Do NOT discount the Chapter 6 (`s50`–`s67`) and Chapter 7 (`s68`–`s73`) design intent just
because these files now sit under `archive/`.** They were archived as a *co-location* fix (the
living IA and ~98,700 lines of frozen HTML should never have shared one directory — that was the
actual defect R2 corrects), **not** as a deprecation of their content. For the inbox, empty-state,
error-state (Epic 10), and billing (Epic 9) surfaces, these prototypes remain the **binding**
forward spec. `docs/product/`'s Chapter 6 and 7 files are **shells** (`_Reconciliation pending
(11-3c)._`) precisely because those epics have not shipped — the design still lives here. When Epic
9/10 build begins, reconcile the shell against *this* prototype + the shipped build, then flip the
chapter's authority to SUPERSEDED in this table.

## Onboarding numbering scope (deliberate — do not "fix")

The onboarding chapter uses `s00`–`s09`, and the `s05`–`s09` range **also** appears in the teacher
chapter. This is intentional and file-scoped, exactly as the original IA documented
(`classlite-ia.md:8`, `:69`): hrefs were file-scoped (`01-owner-onboarding.html#s05` ≠
`02a-teacher-dashboard-classes.html#s06`), so onboarding was its own numbering namespace.

The **frozen manifest** `docs/product/screens.yaml` (one entry per `sNN`, from Story 11-1a)
collapsed that reuse: it assigns `chapter: 1 = s00–s05` and carries `s06–s09` with their **teacher**
meaning in `chapter: 2`. The onboarding "extra" screens the IA numbered `s06`–`s09` (Done-Solo,
Founder-template, Founder-spawn, Dashboard-handoff) are therefore documented in
[`docs/product/01-onboarding.md`](../../product/01-onboarding.md) as **persona/state variants** of
the canonical screens (`s04`/`s02`/`s03`/dashboard), **not** as new IDs — matching the IA's own
"same shape as s04 / same as s02 / same as s03" wording. No `sNN` token was renumbered anywhere.
