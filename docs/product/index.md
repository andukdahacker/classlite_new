# ClassLite product oracle — index

_This is the home of `docs/product/`, the Epic-11 **source of truth** for ClassLite's screen
inventory. It absorbs the content of the former `docs/classlite-entry/classlite-ia.md` (now a
[pointer stub](../classlite-entry/classlite-ia.md)) and splits it into one chapter shard per
chapter of the frozen manifest. The machine-readable manifest is
[`screens.yaml`](./screens.yaml); the frozen per-screen schema is [`SCHEMA.md`](./SCHEMA.md)._

> **One entry per `sNN`.** The manifest collapsed the original IA's deliberate file-scoped ID reuse
> (onboarding `s05–s09` vs teacher `s06–s09`) into one entry per screen id — 89 entries total
> (`s00`–`s87` + the inserted `s10a`). The persona-forked onboarding "extra" screens are documented
> as persona/state variants of their canonical screens, not as new IDs (see Chapter 1). No `sNN`
> token was renumbered anywhere in the repo.

## Chapter shards

| Chapter | Shard | Screens | Status |
|---|---|---|---|
| 1 — Onboarding | [`01-onboarding.md`](./01-onboarding.md) | `s00`–`s05` | **Reconciled (11-3a pilot)** |
| 2 — Teacher | [`02-teacher.md`](./02-teacher.md) | `s06`–`s28`, `s10a` | Shell → 11-3b |
| 3 — Student | [`03-student.md`](./03-student.md) | `s29`–`s38` | Shell → 11-3b |
| 4 — Admin & Owner | [`04-admin-owner.md`](./04-admin-owner.md) | `s39`–`s44` | Shell → 11-3b |
| 5 — Across roles | [`05-cross-role.md`](./05-cross-role.md) | `s45`–`s49` | Shell → 11-3b |
| 6 — Inbox / Empty / Error | [`06-inbox-empty-error.md`](./06-inbox-empty-error.md) | `s50`–`s67` | Shell → 11-3c (Epic 10) |
| 7 — Billing & limits | [`07-billing.md`](./07-billing.md) | `s68`–`s73` | Shell → 11-3c (Epic 9) |
| 8 — Mobile | [`08-mobile.md`](./08-mobile.md) | `s74`–`s87` | Shell → 11-3b |

## Persona → role mapping _(onboarding only)_

Onboarding uses **persona labels** (how the user identifies); the rest of the product uses **role
labels** (permissions).

| Onboarding persona | Product role | Notes |
|---|---|---|
| **Operator** | Admin | Runs the center, does not teach. |
| **Founder** | Owner | Owns the center and also teaches at least one class. |
| **Solo teacher** | Teacher _(single-user workspace)_ | No center-management surface — just classes they teach. |

**Role ladder:** Teacher < Admin < Owner (fixed). Student is a separate consumer role outside the
ladder.

## Section summary

| Chapter | Prototype file (archived) | Screens | Range |
|---|---|---|---|
| 1 — Onboarding _(persona-forked)_ | `01-owner-onboarding.html` | 10 | `s00–s09` |
| 2a — Teacher · dashboard, classes & students | `02a-teacher-dashboard-classes.html` | 6 | `s06–s10, s10a` |
| 2b — Teacher · time | `02b-teacher-time.html` | 4 | `s11–s14` |
| 2c — Teacher · content & grading | `02c-teacher-content-grading.html` | 11 | `s15–s25` |
| 2d — Teacher · resources | `02d-teacher-resources.html` | 3 | `s26–s28` |
| 3 — Student | `03-student.html` | 10 | `s29–s38` |
| 4 — Admin & Owner | `04-owner-admin.html` | 6 | `s39–s44` |
| 5 — Across roles | `05-cross-role.html` | 5 | `s45–s49` |
| 6a — Inbox | `06a-inbox.html` | 3 | `s50–s52` |
| 6b — Empty states | `06b-empty-states.html` | 10 | `s53–s62` |
| 6c — Error states | `06c-error-states.html` | 5 | `s63–s67` |
| 7 — Billing & limits | `07-billing.html` | 6 | `s68–s73` |
| 8 — Mobile | `08-mobile.html` | 14 | `s74–s87` |

> The prototype "10 onboarding screens / `s00–s09`" row reflects the **original IA numbering**; the
> frozen manifest collapses it to `s00–s05` + 4 persona/state variants. See Chapter 1.

## Per-role visibility matrix

**A** = full access · **scoped** = same screen, role-scoped data · **—** = not visible

| Section | Teacher | Student | Admin | Owner |
|---|---|---|---|---|
| Dashboard | own `s06` | own `s29` | center `s48` | center `s48` |
| Classes — index/detail (s07–s09) | own | — _(uses s30)_ | A center-wide | A center-wide |
| My classes (s30–s31) | — | own | — | — |
| Student detail (s10) | own students | — | scoped, all | scoped, all |
| Students top-level | own roster `s10a` | — | center `s42` | center `s42` |
| Sessions (s11–s12) | own | — | A | A |
| Schedule (s13–s14) | own | — _(uses s32)_ | center | center |
| My schedule (s32) | — | own | — | — |
| Exercises (s15–s17) | own bank | — | A | A |
| Exercise attempt (s33–s34) | — | own | — | — |
| Submission & result (s35) | — _(grades it)_ | own | — | — |
| Questions (s18 / s36) | own (answer) | own (ask) | **— no visibility** | own (answer; if teaches) |
| Templates (s19–s22) | A | — | A | A |
| Grading (s23–s25) | A | — | — | A (if teaches) |
| Knowledge hub (s26–s27) | shared | read (when shared) | curate | curate |
| Archive (s28) | own | — | center-wide | center-wide |
| My performance (s37) | — | own | — | — |
| Profile (s38) | own | own | own | own |
| People · Staff (s39–s41) | — | — | A _(no Owner invite)_ | A |
| People · Students (s42) | — | — | A | A |
| People · Enrolment (s43) | — | — | A | A |
| Roles & permissions (s44) | — | — | — | A |
| Analytics (s45–s47) | own classes/students | own self via `s37` | center-wide | center-wide |
| Center settings (s49) | — _(returns s67)_ | — | — | A |
| Inbox (s50–s52) | own role | own role | own role | own role |
| Billing (s68–s73) | — | — | — | A |

---

_Provenance: absorbed from `docs/classlite-entry/classlite-ia.md` by Story 11-3a (baseline
`e4904b6`). The archived HTML prototypes and their per-chapter authority grading live in
[`docs/archive/classlite-entry-prototypes/README.md`](../archive/classlite-entry-prototypes/README.md)._
