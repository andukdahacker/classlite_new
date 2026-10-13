# Chapter 3 — Student

_Product oracle shard for Chapter 3. Part of `docs/product/` — the Epic-11 source of truth. Screen IDs and metadata below are authoritative (from `screens.yaml`); the per-screen bodies are **shells**._

> **Reconciliation pending (11-3b).** Every screen in this chapter carries a `## sNN — Title`
> heading so the `entry → doc` integrity check in `scripts/screens-lint.mjs` stays green, but the
> Purpose / Route / Roles / Controls / States / Behaviours / Out-of-scope sub-structure is authored
> when **11-3b** reconciles this chapter against the running build. Until then:
> the **shipped app** is the truth and the SUPERSEDED prototype under
> [`docs/archive/classlite-entry-prototypes/`](../archive/classlite-entry-prototypes/README.md) is reference only.

See [`index.md`](./index.md) for the section summary and per-role visibility matrix, and
[`SCHEMA.md`](./SCHEMA.md) for the frozen per-screen schema these shells will be filled against.

---

## s29 — Student dashboard

- **Route:** `/dashboard`
- **Roles:** [student]
- **Section:** Dashboard
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s30 — My classes

- **Route:** `/my-classes`
- **Roles:** [student]
- **Section:** Classes
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s31 — Class detail — student

- **Route:** `/my-classes/{id}`
- **Roles:** [student]
- **Section:** Class detail
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s32 — My schedule

- **Route:** `/my-schedule`
- **Roles:** [student]
- **Section:** Schedule
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s33 — Exercise attempt

- **Route:** `/exercises/{id}/attempt`
- **Roles:** [student]
- **Section:** Exercises
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s34 — Writing attempt editor

- **Route:** `/assignments/{id}/write`
- **Roles:** [student]
- **Section:** Assignments
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s35 — Submission & result

- **Route:** `/assignments/{id}/result`
- **Roles:** [student]
- **Section:** Assignments
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s36 — Anchored Q&A — student

- **Route:** `/exercises/{id}/attempt?questions=open`
- **Roles:** [student]
- **Section:** Questions
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s37 — My performance

- **Route:** `/my-performance`
- **Roles:** [student]
- **Section:** Analytics
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s38 — Profile & settings

- **Route:** `/profile`
- **Roles:** [student]
- **Section:** Profile
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

