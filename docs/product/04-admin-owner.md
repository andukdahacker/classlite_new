# Chapter 4 — Admin & Owner

_Product oracle shard for Chapter 4. Part of `docs/product/` — the Epic-11 source of truth. Screen IDs and metadata below are authoritative (from `screens.yaml`); the per-screen bodies are **shells**._

> **Reconciliation pending (11-3b).** Every screen in this chapter carries a `## sNN — Title`
> heading so the `entry → doc` integrity check in `scripts/screens-lint.mjs` stays green, but the
> Purpose / Route / Roles / Controls / States / Behaviours / Out-of-scope sub-structure is authored
> when **11-3b** reconciles this chapter against the running build. Until then:
> the **shipped app** is the truth and the SUPERSEDED prototype under
> [`docs/archive/classlite-entry-prototypes/`](../archive/classlite-entry-prototypes/README.md) is reference only.

See [`index.md`](./index.md) for the section summary and per-role visibility matrix, and
[`SCHEMA.md`](./SCHEMA.md) for the frozen per-screen schema these shells will be filled against.

---

## s39 — Staff list

- **Route:** `/people/staff`
- **Roles:** [admin, owner]
- **Section:** People
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s40 — Staff detail

- **Route:** `/people/staff/{id}`
- **Roles:** [admin, owner]
- **Section:** People
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s41 — Invite staff modal

- **Route:** `/people/staff?invite=new`
- **Roles:** [admin, owner]
- **Section:** People
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s42 — Students — center-wide

- **Route:** `/people/students`
- **Roles:** [admin, owner]
- **Section:** People
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s43 — Enrolment

- **Route:** `/people/enrolment`
- **Roles:** [admin, owner]
- **Section:** People
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s44 — Roles & permissions

- **Route:** `/people/permissions`
- **Roles:** [owner]
- **Section:** People
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

