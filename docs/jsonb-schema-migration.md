# JSONB Schema Migration Strategy

_Story 4.5. The versioned-upgrade machinery for JSONB `content`/`params`/`result`/`payload` blobs: a lazy read-path ladder that upgrades any row on read, plus a hardened operator batch tool that sweeps rows ahead of time. **As of 4.5 every entity is v1 and every production upgrader chain is EMPTY** — this document is the mechanism + the runbook for the day the first real v2 lands._

---

## THE GOVERNING INVARIANT (read this first)

> **The lazy read-path ladder IS the correctness guarantee. The batch tool is an OPTIMIZATION.**

Every row is upgraded on read through its store choke point, from its own stored version, with no assumption that it is already current. The batch tool exists only so the system needn't pay lazy-upgrade cost forever and can eventually drop old rungs. **Therefore the batch tool is ALLOWED to skip rows** — soft-deleted (`deleted_at`), freshly inserted at an old version, or concurrently modified (the `xmin` guard) — because a skipped row is harmless: it upgrades on its next read. A *clobbered* row is not harmless.

**Nobody may ever "optimize" the read path by dropping the lazy upgrade because "the batch tool handled everything."** Restored/soft-deleted rows would break silently. This invariant is written as the package doc of `classlite-api/tools/jsonbmigrate`.

---

## The ladder pattern

- `model.MigrateJSONB(raw, fromVersion, currentVersion, upgraders)` (`internal/model/schema_migration.go`) is the one generic engine. `upgraders[v]` is an `UpgradeFunc` upgrading a blob `v → v+1`. The stepwise `for v := from; v < current; v++` loop **structurally enforces monotonic, one-rung-at-a-time** upgrading (never `v → v+2`, never a silent skip). A gap, `from < 1`, or `from > current` is a typed `SchemaVersionError` — never a panic. The caller does the final `json.Unmarshal`.
- Rungs are **blob-level and type-erased** (`json.RawMessage → json.RawMessage`) so the ladder needn't keep every historical `vN` Go struct alive ("struct archaeology"). **The price of that erasure is a mandatory per-rung contract test** (see AC4): each rung's output blob must unmarshal cleanly into the next rung's expected input struct (and the final rung's output into the current typed struct). The `RawMessage → RawMessage` signature cannot catch a silent field-drop at compile time — the contract test does.
- The exercise choke point `store.UnmarshalExerciseContent` (`internal/store/exercise_content.go`) routes through the ladder before returning the typed struct, so **callers (service/handler/worker) never see a legacy version** (GO-7).

## Column-versioned vs blob-probed — the source-of-truth rule

| Version source | Example | Batch-tool eligible? |
|---|---|---|
| **DB column** (`schema_version`, `params_schema_version`) | `exercises.content`, `jobs.params` | **Yes** — the tool keys its keyset + guards off the column. |
| **In-blob** field (probed from the JSON) | `onboarding_progress.payload`, `jobs.result` | **No** — read-path-only. A batch sweep would have to parse every blob to discover its version; there is no indexed column to key off. |

Column-versioned entities can be swept eagerly by the batch tool. Blob-probed entities upgrade **only** lazily on read. When you add a versioned blob, decide the source deliberately — a column is what makes an entity batch-tool-eligible.

## The three (four) independent version lines — NEVER share a constant

| Entity | Constant | Source | Choke point | 4.5 status |
|---|---|---|---|---|
| Exercise `content` | `store.CurrentExerciseSchemaVersion` | column | `UnmarshalExerciseContent` | **on the ladder** |
| Job `params` | `model.AIJobParamsSchemaVersion` | column | worker `Unmarshal` | documented only |
| Job `result` | `model.AIResponseSchemaVersion` | blob + col | dispatcher | documented only |
| Onboarding `payload` | `model.OnboardingPayloadSchemaVersion` | blob | `MigrateOnboardingPayload` | **not rewired** (documented 2nd example) |

They version **independently**. Never collapse them onto one shared constant.

## GO-7 exception inventory rule

GO-7 says JSONB is always decoded to a typed struct at/below the store boundary. There is **one sanctioned exception**: shape-dependent SQL that reads a versioned blob's structure **without** going through the ladder. Today that is the exercise LIST path's `jsonb_array_length(content->'sections')` + lateral question count (`internal/store/queries/exercises.sql`) — a second, un-laddered reader valid only for v1.

**Rule: any shape-dependent SQL over a versioned JSONB column is a ladder bypass and MUST be inventoried when that entity's version bumps.** Each such site carries a `TRIPWIRE:` comment, and a regression test pins "SQL count == laddered Go count" for v1 (`internal/service/exercise_jsonb_count_tripwire_test.go`) so the divergence is loud the day a reshaped v2 lands.

---

## The batch tool (`scripts/migrate-jsonb.sh`)

```
scripts/migrate-jsonb.sh --entity=exercises --from=1 --to=2 [--after-id=<uuid>] [--batch-size=100]
```

Hardened properties (all regression-tested, `tools/jsonbmigrate/migrate_test.go`):

- **Superuser, cross-tenant.** Runs on `MIGRATION_DATABASE_URL` (fallback `DATABASE_URL`), bypassing RLS to sweep every tenant. Sound because every write is a same-row read-modify-write keyed by `id` — RLS is not the correctness boundary; the ladder + `schema_version` + `xmin` guards are. Keep the pool ephemeral and the admin queries isolated from request-serving code.
- **Keyset, not OFFSET** (`id > $after ORDER BY id`) — the tool mutates `schema_version` out from under its own cursor, so OFFSET would skip rows.
- **One transaction per batch** (default 100). Never one giant tx (long locks, WAL bloat, not resumable). Each batch commits independently → **resumable**: a mid-run failure leaves committed batches at `--to`, the rest at `--from`; a re-run picks up only the remaining `--from` rows (the version predicate makes this automatic). `--after-id` resumes from a known point.
- **Lost-update `xmin` guard** (the top correctness trap). The write is `WHERE id = $ AND schema_version = $from AND xmin::text = $readXmin`. A concurrent live writer who changed `content` but left `schema_version` unchanged bumps the row's `xmin`, so the tool's write matches **zero rows** and the row is **skipped + logged, never clobbered**. A version-only guard would silently overwrite the user's edit with stale-upgraded content — this is why the guard is `xmin`, not `updated_at`.
- **Poison-row abort.** A NULL/empty/undecodable-at-version blob aborts the run, surfaces the offending PK, and exits non-zero — no silent skip (a silently-skipped bad row is a permanently-mixed-version table nobody notices).
- **Arg guards, zero writes.** Unknown `--entity`, `--to` ≠ the entity's current version, `--from >= --to`, or `--from < 1` → clean error, non-zero exit, no writes.

> Implementation note: the guarded UPDATE is a **raw pgx statement** inside the tool, not a sqlc query, because sqlc's static analyzer resolves the `xmin` system column in a SELECT target list but not in an UPDATE ... WHERE predicate. The keyset LIST stays in sqlc (`internal/store/queries/exercise_jsonb_migration.sql`).

---

## First-v2 runbook — the day a real schema change lands

When an entity genuinely needs a new blob shape, do this (exercise-flavored; generalize per entity):

1. **Author the rung.** Add `vN → vN+1` as an `UpgradeFunc` in the entity's upgrader map (`exerciseUpgraders` for exercises). The rung is a pure `RawMessage → RawMessage` transform.
2. **Write the per-rung contract test** (mandatory — AC4). Prove `rung[N]`'s output unmarshals cleanly into `rung[N+1]`'s input struct, and the final rung's output into the current typed struct. This is what catches a silent field-drop.
3. **Bump the current-version constant** (`CurrentExerciseSchemaVersion`). New writes stamp `N+1`; old rows upgrade lazily on read; the service write-back stamps `N+1` on next save.
4. **Decide backfill / default semantics.** What does a newly-required field default to for existing rows? Additive-with-a-default is easy; a semantic transform is not — spell it out in the rung and the test.
5. **Inventory the GO-7 exceptions.** Grep for shape-dependent SQL over this blob (the `TRIPWIRE:` comments). Branch each on `schema_version` or move it to app-side counting. The tripwire test will already be failing if you skipped this.
6. **Run the batch tool per environment** (staging → prod), off-peak: `scripts/migrate-jsonb.sh --entity=<e> --from=N --to=N+1`. Verify counts; re-run is safe (idempotent via the version predicate).
7. **Only after every environment is swept**, consider dropping the `vN` rung — and never before, because soft-deleted/restored rows may still be at `vN`.

### What Story 4.5 did NOT solve (honest handoff — do NOT assume these are done)

- **Real-transform correctness.** 4.5 proves the *machinery* with synthetic rungs. A real `vN → vN+1` transform's business correctness is that story's job.
- **Backfill-default semantics** for newly-required fields on existing rows.
- **Down-migration / rollback of a JSONB shape.** There is no `--down`. Reverting a shape is a fresh forward rung.
- **Big-tenant timeout / throttle tuning.** The tool batches at 100 with no inter-batch sleep; a very large table may need pacing.
- **Entity-specific batch wrinkles** for `jobs.params` / `jobs.result` (blob-probed `result` is not batch-eligible without a column) and any future entity. Only `exercises` is registered today.
