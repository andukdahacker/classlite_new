# Chapter 2 — Teacher

_Product oracle shard for Chapter 2. Part of `docs/product/` — the Epic-11 source of truth. Screen IDs and metadata below are authoritative (from `screens.yaml`); the per-screen bodies are **shells**._

> **Reconciliation pending (11-3b).** Every screen in this chapter carries a `## sNN — Title`
> heading so the `entry → doc` integrity check in `scripts/screens-lint.mjs` stays green, but the
> Purpose / Route / Roles / Controls / States / Behaviours / Out-of-scope sub-structure is authored
> when **11-3b** reconciles this chapter against the running build. Until then:
> the **shipped app** is the truth and the SUPERSEDED prototype under
> [`docs/archive/classlite-entry-prototypes/`](../archive/classlite-entry-prototypes/README.md) is reference only.

See [`index.md`](./index.md) for the section summary and per-role visibility matrix, and
[`SCHEMA.md`](./SCHEMA.md) for the frozen per-screen schema these shells will be filled against.

---

## s06 — Teacher dashboard

- **Route:** `/dashboard`
- **Roles:** [teacher]
- **Section:** Dashboard
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s07 — Classes index

- **Route:** `/classes`
- **Roles:** [teacher]
- **Section:** Classes
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s08 — Class detail — Overview

- **Route:** `/classes/{id}`
- **Roles:** [teacher]
- **Section:** Class detail
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s09 — Class detail — tabs

- **Route:** `/classes/{id}`
- **Roles:** [teacher]
- **Section:** Class detail
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s10 — Student detail

- **Route:** `/classes/{id}/students/{sid}`
- **Roles:** [teacher]
- **Section:** Student detail
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s10a — Students — across my classes

- **Route:** `/students`
- **Roles:** [teacher]
- **Section:** Students
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s11 — Sessions list

- **Route:** `/classes/{id}/sessions`
- **Roles:** [teacher]
- **Section:** Sessions
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s12 — Session detail

- **Route:** `/classes/{id}/sessions/{ssid}`
- **Roles:** [teacher]
- **Section:** Session detail
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s13 — Schedule workspace

- **Route:** `/schedule`
- **Roles:** [teacher]
- **Section:** Schedule
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s14 — Create/edit session modal

- **Route:** `/schedule?session=edit`
- **Roles:** [teacher]
- **Section:** Schedule
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s15 — Exercises library

- **Route:** `/exercises`
- **Roles:** [teacher]
- **Section:** Exercises
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s16 — Exercise editor

- **Route:** `/exercises/{id}/edit`
- **Roles:** [teacher]
- **Section:** Exercises
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s17 — AI dialog

- **Route:** `/exercises/{id}/edit?ai=section`
- **Roles:** [teacher]
- **Section:** Exercises
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s18 — Anchored Q&A — teacher

- **Route:** `/exercises/{id}?questions=open`
- **Roles:** [teacher]
- **Section:** Questions
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s19 — Class templates index

- **Route:** `/classes/templates`
- **Roles:** [teacher]
- **Section:** Templates
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s20 — Template detail

- **Route:** `/classes/templates/{id}`
- **Roles:** [teacher]
- **Section:** Templates
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s21 — Edit template

- **Route:** `/classes/templates/{id}/edit`
- **Roles:** [teacher]
- **Section:** Templates
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s22 — Create class from template

- **Route:** `/classes/new?from={tpl}`
- **Roles:** [teacher]
- **Section:** Templates
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s23 — Writing grading

- **Route:** `/classes/{id}/grading/{aid}/{sid}`
- **Roles:** [teacher]
- **Section:** Grading
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s24 — Speaking grading

- **Route:** `/classes/{id}/grading/{aid}/{sid}`
- **Roles:** [teacher]
- **Section:** Grading
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s25 — Auto-grade review

- **Route:** `/classes/{id}/grading/{aid}/{sid}`
- **Roles:** [teacher]
- **Section:** Grading
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s26 — Knowledge hub

- **Route:** `/knowledge-hub`
- **Roles:** [teacher]
- **Section:** Knowledge hub
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s27 — Document detail

- **Route:** `/knowledge-hub/files/{slug}`
- **Roles:** [teacher]
- **Section:** Knowledge hub
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

## s28 — Archive

- **Route:** `/archive`
- **Roles:** [teacher]
- **Section:** Archive
- **Status:** `shipped`

_Reconciliation pending (11-3b)._

