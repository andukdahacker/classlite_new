# Story 3.1 — Proposed Spec Edits (from party-mode review)

**Target file:** `3-1-class-crud-lifecycle-and-creation-ui.md`
**Decisions locked (Ducdo, 2026-07-19):** A-2 = accept **404** · B-1 = **keep** paused→ended disallowed · B-2 = **keep** per-field template Switches · A-3 = capacity **not clearable + `CHECK > 0`**.
**Flagged for confirmation:** EDIT 12 (dim Ended-only) overrides UX §5.6.

Each edit is CURRENT → REVISED against the story as it stands. Apply top-to-bottom.

---

### EDIT 1 — AC1: teacherless class + capacity CHECK *(G, A-3)*

**CURRENT (AC1, last sentence):**
> When a Teacher creates a class, `teacher_id` defaults to the caller unless an explicit teacher/`pendingTeacherEmail` is provided; the `classes_teacher_mutex` CHECK (teacher_id XOR pending_teacher_email) must hold.

**REVISED — append:**
> When a Teacher creates a class, `teacher_id` defaults to the caller unless an explicit teacher/`pendingTeacherEmail` is provided; the `classes_teacher_mutex` CHECK (teacher_id XOR pending_teacher_email) must hold. **When an Owner/Admin creates a class, `teacher_id`/`pendingTeacherEmail` is REQUIRED in the request (no caller default) — an owner does not auto-assign themselves; the mutex forbids a fully unassigned class.** `capacity`, when provided, must satisfy `capacity > 0` (DB `CHECK`); `capacity` is nullable at create and **cannot be cleared back to NULL via `PATCH` in this story** (COALESCE keeps it — see AC6).

---

### EDIT 2 — AC2: null-vs-omit wire contract *(A-4, required now that B-2 keeps toggles)*

**CURRENT (AC2, parenthetical):**
> each behind an include/exclude `Switch` (excluded → that field is sent `null`/omitted, not copied).

**REVISED:**
> each behind an include/exclude `Switch`. **Wire contract: the per-field toggle applies to CREATE only. An excluded field is OMITTED from `CreateClassRequest` (key absent), so the new row's column is `NULL`/DB-default — the template value is never copied. `CreateClassRequest` fields are all optional; absent = unset.** (Edit-mode reuses the same dialog but the template toggle wall is not shown — see AC6 for `PATCH` semantics.)

---

### EDIT 3 — AC4: compare-and-swap concurrency guard + audit-not-written *(A-1, C-2, D)*

**CURRENT (AC4, after the arrow block):**
> Any other move (e.g. `upcoming→ended`, `paused→ended`, `ended→active`, same-state no-op) returns `422 INVALID_STATUS_TRANSITION`. A legal transition writes a `class.status_changed` audit row (`Before:{status:old}, After:{status:new}`) and returns `200` + `EnvelopeClass` with `updatedAt` advanced.

**REVISED:**
> Any other move (e.g. `upcoming→ended`, `paused→ended`, `ended→active`, same-state no-op) returns `422 INVALID_STATUS_TRANSITION`, **and writes NO audit row** (a rejected transition must not emit `class.status_changed`). A legal transition writes a `class.status_changed` audit row (`Before:{status:old}, After:{status:new}`) and returns `200` + `EnvelopeClass` with `updatedAt` advanced.
>
> **Concurrency (compare-and-swap, MANDATORY):** the map check must not be a bare read-then-write. `UpdateClassStatus` issues `UPDATE ... SET status=$new, updated_at=now() WHERE id=$1 AND status=$expected RETURNING ...`; a `0`-row result means the row moved under a concurrent transition → return `INVALID_STATUS_TRANSITION` (re-fetch to report actual current state). Equivalent: `SELECT ... FOR UPDATE` the row inside the same tx before validating. Two racing legal moves from the same state MUST NOT both commit.

---

### EDIT 4 — AC6: 404 authz contract + PATCH null semantics *(A-2, A-3)*

**CURRENT (AC6, authz sentence):**
> Authz: `owner`/`admin` may edit/transition **any** class in the center; `teacher` may edit/transition **only** a class assigned to them (`teacher_id = caller`) — otherwise `403 FORBIDDEN`.

**REVISED:**
> Authz: `owner`/`admin` may edit/transition **any** class in the center; `teacher` may edit/transition **only** a class assigned to them (`teacher_id = caller`). **A `teacher`'s read/write is teacher-scoped, so a class not assigned to them is invisible under the scoped query and returns `404 CLASS_NOT_FOUND` — NOT `403`.** (Teacher-sees-nothing: a teacher cannot distinguish "another teacher's class" from "does not exist"; this is the intended security posture. There is no cross-teacher `403` within a center for these endpoints.) **`PATCH` is set-only in 3.1: absent field = unchanged (`COALESCE(narg, existing)`); nullable fields (`capacity`, `description`, `color`, `targetBand`, `endDate`, …) CANNOT be cleared to NULL via `PATCH` this story — send a new value or leave absent.** Clearing support is out of scope (forward).

---

### EDIT 5 — Response Envelope Contract: error table row *(A-2)*

**CURRENT (error table, FORBIDDEN row):**
> | `FORBIDDEN` (`INSUFFICIENT_ROLE`) | 403 | A Teacher attempts to edit/transition a class they are not assigned to (AC5 mutation authz). Reuses the shipped `*service.ForbiddenError` → 403 mapping. |

**REVISED:**
> | `CLASS_NOT_FOUND` | 404 | A Teacher attempts to `GET`/`PATCH`/`POST-status` a class not assigned to them — teacher-scoped query returns 0 rows (no cross-teacher `403`; see AC6). |

*(The generic `FORBIDDEN` role-gate mapping still exists for the `classChain` role guard; it is simply not the cross-teacher path. Drop the row above or reword to the role-gate case only.)*

---

### EDIT 6 — Task 0: ATDD gate — AC4 + AC5 unconditionally mandatory *(D)*

**CURRENT:**
> **Task 0 — ATDD gate (AC4, AC5).** … If ANY AC maps to a risk score ≥6 … `/bmad-tea AT` RED-phase acceptance tests are **mandatory** before `in-progress` (WF-8). Transition enforcement (AC4) and teacher-scope isolation (AC5) are the high-risk candidates. Otherwise skippable at engineer discretion.

**REVISED:**
> **Task 0 — ATDD gate (AC4, AC5).** **AC4 (transition enforcement — FIRST state machine in the codebase, no precedent) and AC5 (teacher-scope isolation — cross-teacher data boundary) are UNCONDITIONALLY mandatory** `/bmad-tea AT` RED-phase before `in-progress` (WF-8): novelty and authz-boundary blast radius are ≥6 by construction. The "if score ≥6 in the register" clause applies only to the remaining ACs (AC1–AC3), skippable at engineer discretion.

---

### EDIT 7 — Task 1: capacity CHECK + updated_at contract + end_date invariants *(A-3, C-1, C-3)*

**CURRENT (Task 1 up):**
> `up`: `ALTER TABLE classes ADD COLUMN description text, ADD COLUMN capacity integer, ADD COLUMN due_dates_enabled boolean NOT NULL DEFAULT false, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN end_date date, ADD COLUMN color text;` (+ optional CHECK `capacity > 0`).

**REVISED:**
> `up`: `ALTER TABLE classes ADD COLUMN description text, ADD COLUMN capacity integer, ADD COLUMN due_dates_enabled boolean NOT NULL DEFAULT false, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN end_date date, ADD COLUMN color text, ADD CONSTRAINT classes_capacity_positive CHECK (capacity IS NULL OR capacity > 0);` **(CHECK is REQUIRED, not optional — the API boundary must enforce it, not just Zod.)** **`updated_at` DEFAULT fires on INSERT only; every `UpdateClass`/`UpdateClassStatus` query MUST `SET updated_at = now()` explicitly in the query body (no trigger — keeps it greppable). `end_date` carries NO cross-field validation in 3.1 (may precede start; `due_dates_enabled` independent) — documented, deliberate.**

---

### EDIT 8 — Task 2: split codegen runs + grep all row readers *(F-1, C-6)*

**CURRENT (Task 2, first bullet + last bullet):**
> **REGRESSION-CRITICAL:** `CreateClass` is called by shipped `ClassService.Spawn` … update that callsite … the Spawn ATDD suite (`class_atdd_test.go`) MUST stay green.
> … Run `scripts/codegen.sh` (WF-3 — last script after any `.sql` touch).

**REVISED — append to the regression bullet:**
> **Sequence the codegen: CHUNK 1 = `CreateClass` extension + Spawn callsite (`class.go:~387`) + `codegen.sh` + green `class_atdd_test.go`, committed/verified BEFORE the new queries. New queries (`ListClasses`/`ListClassesByTeacher`/`UpdateClass`/`UpdateClassStatus`) get a SEPARATE `codegen.sh` run** — a single mega-codegen widens the blast radius onto Spawn. **Before finishing Task 2, grep every reader of the `classes` row/model (not just `CreateClass`): sqlc regenerates all row structs with the 6 new columns; any `SELECT *`/hand-scan shipped by 2.2 must be reconciled.**

---

### EDIT 9 — Task 6: classSchema copy-not-move + cache-key hierarchy *(C-5, C-7)*

**CURRENT (Task 6 bullets):**
> `api/classesKeys.ts` (factory: `all, list(centerId, scope), detail(id), createMutation, transitionMutation`).
> … `lib/classSchema.ts` (lift validators from `onboarding/lib/classSpawnSchema.ts`; single-class, no array wrapper; Zod messages as i18n keys).

**REVISED:**
> `api/classesKeys.ts` (factory: `all, list(centerId, scope), detail(id), createMutation, transitionMutation`). **`scope` (`'all'` for owner/admin vs `'teacher:<userId>'`) is part of the list key — the role-split means owner and teacher lists are DIFFERENT cache entries. `useTransitionClassStatus`/`useUpdateClass` optimistic patches MUST update every cached `list(...)` scope a class appears in (the `useMutateRoom` triple is single-audience and does NOT cover this — extend it).**
> … `lib/classSchema.ts` (**COPY** field validators from `onboarding/lib/classSpawnSchema.ts` — do NOT move/re-point onboarding's import, that flow is shipped; note the duplication as debt; single-class, no array wrapper; Zod messages as i18n keys).

---

### EDIT 10 — AC7: inert-row omit + dormant deferred columns + per-tab empty *(E-2, E-3, E-5)*

**CURRENT (AC7, relevant clauses):**
> **Students** (deferred placeholder "—") · **Sessions** (deferred placeholder "—") …
> … Ended/upcoming rows dimmed 0.7. Row click is inert this story (detail is Story 3.2) — wire a no-op or omit until 3.2 (document choice). **Loading/Empty/Error trilogy mandatory** (UX-1): skeleton rows … / `s54` empty-state … / inline `role="alert"` retry …

**REVISED:**
> **Students** (deferred — render as a visibly *dormant* cell: muted/low-contrast with a "coming soon" affordance, NOT a bare "—" which reads as a load failure; data lands 3.2) · **Sessions** (deferred, same dormant treatment; data lands 3.4) …
> … Ended rows dimmed 0.7; **Upcoming rows stay full opacity** (see EDIT 12). **Row click is inert this story → OMIT the affordance entirely: no `cursor:pointer`, no hover-elevation, no click handler. Interactivity attaches only to real targets (status pill per AC8, Actions menu); the class name becomes a link in 3.2 when its destination exists.** **Loading/Empty/Error trilogy mandatory** (UX-1): skeleton rows … / `s54` empty-state … / inline `role="alert"` retry. **The `s54` create-CTA hero is scoped to the truly-zero-classes case; a status tab filtered to zero rows shows a quiet inline "Nothing {status} right now", NOT the hero (which would misreport an empty center).**

---

### EDIT 11 — AC8: status pill IS the transition control *(E-1, E-4, Winston no-op)*

**CURRENT (AC8):**
> Status transitions surfaced via a `Select`/`DropdownMenu` that only offers **legal** next states (map mirrored client-side for affordance; server remains source of truth); optimistic update with rollback (FW-2 triple).

**REVISED:**
> **Status transitions are surfaced by making `ClassStatusPill` itself the trigger** (pill + subtle caret + hover/focus affordance) → `DropdownMenu` offering **only legal next states** (map mirrored client-side; server is source of truth). **The current state is ABSENT from the menu (not disabled-and-listed) — this makes the same-state no-op unreachable from the UI, so the AC4 `active→active` 422 can never be user-triggered.** Lifecycle does NOT live in the row's kebab/Actions menu (that holds Edit only). **Optimistic update with rollback (FW-2 triple): on server reject the pill snaps back to the LITERAL prior status/color and the error surfaces via an inline `role="alert"` adjacent to the row — not a floating toast.**

---

### EDIT 12 — AC7: dim Ended only ⚠️ OVERRIDES UX §5.6 — confirm *(E-6 / B-3)*

**CURRENT:**
> Ended/upcoming rows dimmed 0.7.

**REVISED:**
> Ended rows dimmed 0.7; Upcoming rows full opacity (blue pill already signals "future"; dimming the most action-adjacent row reads as "expired"). **⚠️ This overrides UX-spec §5.6 as written — confirm with design or revert to both-dimmed.**

---

### EDIT 13 — Task 7: decide form factor before the e2e chunk *(F-2)*

**CURRENT (Task 7):**
> Extend `e2e/route-bundle-boundaries.spec.ts` with a `/classes` cross-chunk assertion.

**REVISED — append:**
> **Decide the Dialog-vs-`/classes/new`-route form factor (AC8) BEFORE writing this chunk:** a route adds a `RouteRoleGate` + its own bundle boundary + a `/classes/new` cross-chunk assertion; a Dialog does not. The choice cascades into this spec and `PermissionDenied` `SectionNameKey` — it is not an independent parallel track.

---

### EDIT 14 — Testing section: additions & cuts *(D)*

**REVISED — replace the Testing bullets' emphasis per Murat's risk read. Add:**
- **Store — concurrency:** two concurrent `UpdateClassStatus` from the same state → exactly one commits (compare-and-swap, EDIT 3). *Highest-regret test.*
- **Service — audit-not-written:** every illegal transition asserts audit-row-count UNCHANGED (not just the error code).
- **Handler — garbage status:** `status:"deleted"` / wrong-case / `""` / null → validation-422 at the boundary (distinct shape from `INVALID_STATUS_TRANSITION`), never reaches the store.
- **Write-scope isolation:** teacher `PATCH`/status on a class not theirs → **404** (EDIT 4) at handler; RLS `WITH CHECK` blocks the write on the 0-rows path; reparent to a non-member center rejected.
- **Mutex on update:** setting `teacher_id` clears `pendingTeacherEmail` and vice versa; "teacher edits invited-but-unassigned" (email == `pendingTeacherEmail`, `teacher_id` null) → 404/forbidden per EDIT 4.
- **Store — `updated_at` monotonicity:** advances on update, `created_at` untouched.
- **Migration down-path:** up→down→up idempotent; down drops the 6 columns + CHECK cleanly.
- **FE optimistic rollback — 3 named tests:** apply→200 settles · apply→422 rolls back to the SPECIFIC prior status + `role="alert"` · illegal blocked client-side but 422 handled if forced.
- **Audit assertions are content** (actor_id, from_status, to_status, class_id), not existence.

**Cut as over-testing:**
- axe: full pass on the index only; dialog gets a focus-trap/label smoke check, not a second full axe.
- Don't re-assert the full envelope shape on all 6 legal transitions — shape once (create→upcoming), status-code + error-shape for the rest.
- i18n: keep en+vi key-existence; do NOT assert rendered Vietnamese strings.
- `due_dates_enabled` default: keep the store DB-default assertion + FE Switch-off; cut the redundant service-layer re-assertion.

---

### EDIT 15 — Dev Notes → Open Questions: close Q1 *(B-1)*

**CURRENT (Open Q1):**
> 1. **Paused→Ended** is disallowed … If product wants direct Paused→Ended, add it to `classTransitions` and amend the epic …

**REVISED:**
> 1. **Paused→Ended** is disallowed (resume→end). **CLOSED 2026-07-19 (Ducdo): keep disallowed — epic-AC exact arrow set is authoritative. Terminal path is `paused→active→ended`.** No map change.

---

## No-change confirmations (raised, deliberately NOT edited)

- **Due-dates OFF by default (AC3)** — confirmed correct (Sally's commitment argument); matches spec, no edit.
- **paused→ended (B-1)** — kept disallowed (EDIT 15).
- **Per-field template Switches (AC2)** — kept; only the wire contract clarified (EDIT 2).

## Items still owed a call before dev "done" (not spec text — process)

- **G ship-alone value (John):** internally sequence 3.1→3.2 fine; do NOT release the dormant-column `/classes` list to paying teachers ahead of 3.2. Product/release decision, not a story edit.
