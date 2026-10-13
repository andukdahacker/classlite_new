# Chapter 5 — Across roles

_Product oracle shard for Chapter 5. Part of `docs/product/` — the Epic-11 source of truth. Screen IDs and metadata below are authoritative (from `screens.yaml`); the per-screen bodies are **shells**._

> **Reconciliation pending (11-3b).** Every screen in this chapter carries a `## sNN — Title`
> heading so the `entry → doc` integrity check in `scripts/screens-lint.mjs` stays green, but the
> Purpose / Route / Roles / Controls / States / Behaviours / Out-of-scope sub-structure is authored
> when **11-3b** reconciles this chapter against the running build. Until then:
> the **shipped app** is the truth and the SUPERSEDED prototype under
> [`docs/archive/classlite-entry-prototypes/`](../archive/classlite-entry-prototypes/README.md) is reference only.

See [`index.md`](./index.md) for the section summary and per-role visibility matrix, and
[`SCHEMA.md`](./SCHEMA.md) for the frozen per-screen schema these shells will be filled against.

---

## s45 — Analytics home

- **Route:** `/analytics`
- **Roles:** [all]
- **Section:** Analytics
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s46 — Class performance

- **Route:** `/analytics/class/{id}`
- **Roles:** [all]
- **Section:** Analytics
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s47 — Student performance

- **Route:** `/analytics/student/{id}`
- **Roles:** [all]
- **Section:** Analytics
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s48 — Admin/Owner dashboard

- **Route:** `/dashboard`
- **Roles:** [admin, owner]
- **Section:** Dashboard
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s49 — Center settings

- **Route:** `/settings`
- **Roles:** [owner]
- **Section:** Settings
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

