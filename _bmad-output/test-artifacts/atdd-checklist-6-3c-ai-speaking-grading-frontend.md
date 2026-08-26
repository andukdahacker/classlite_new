---
storyId: '6.3c'
storyKey: '6-3c-ai-speaking-grading-frontend'
storyFile: '_bmad-output/implementation-artifacts/6-3c-ai-speaking-grading-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-6-3c-ai-speaking-grading-frontend.md'
detectedStack: 'frontend'
executionMode: 'sequential (author-direct — component-test story, not Playwright-E2E)'
generatedBy: '/bmad-tea AT 6-3c (Murat)'
lastSaved: '2026-08-25'
wf8Gate: false   # story §Testing: no FE AC ≥ risk 6; R3=9 discharged in 6-3b. ATDD optional.
generatedTestFiles:
  - classlite-web/src/features/grading/hooks/__tests__/useAiGradeSpeakingJob.test.tsx   # RED (import missing module)
  - classlite-web/src/features/grading/__tests__/story-6-3c-i18n.test.ts                # RED (40 keys missing, 3 exact-copy asserts)
inputDocuments:
  - _bmad-output/implementation-artifacts/6-3c-ai-speaking-grading-frontend.md
  - _bmad-output/implementation-artifacts/6-3b-ai-speaking-grading-backend.md
  - _bmad-output/implementation-artifacts/6-2b-ai-assisted-writing-grading-frontend.md
  - _bmad-output/implementation-artifacts/6-3a-speaking-grading-manual.md
  - docs/project-context.md  # TEST-FE-1..6, TEST-UX-*, FW-*, TS-2/6, UX-1/2, CQ-3, XL-1
  - classlite-web/src/features/grading/hooks/useAiGradeJob.ts (+ __tests__)  # twin template
  - classlite-web/src/lib/api/client.ts (AISpeakingGradeResult / AISpeakingMoment / Job)
---

# ATDD Checklist — Story 6.3c: AI-Assisted Speaking Grading (Frontend)

> **Murat's framing (risk vs value).** This ATDD run is **optional** — the story's
> own §Testing says no FE AC maps to risk ≥ 6 (the R3=9 worker risk was discharged
> red-first in 6-3b) so this is **not** a WF-8 hard gate. Red-first pays off where
> logic is deterministic and the seam is fixed: the **async job hook** and the
> **i18n key contract**. Those two are scaffolded red now (both fail for the right
> reason — verified). The **component/page matrix** (Task 7) is better built
> **green-alongside** the components whose prop surface is still fluid, then
> expanded post-dev via `/bmad-tea TA 6-3c`. This doc is the full map for both.
>
> **The one non-negotiable regardless of this run: AC9** — confidence / rationale /
> transcript must be teacher-only and provably ABSENT from the student
> `ResultSpeakingPlayback` path. That is a **mandatory DoD test**, not optional.

---

## Red-phase files generated now (verified failing for the right reason)

| File | Level | Red signal (verified) | Turns green when |
|---|---|---|---|
| `hooks/__tests__/useAiGradeSpeakingJob.test.tsx` | Hook (vitest + MSW + fake timers) | `Failed to resolve import "../useAiGradeSpeakingJob"` — module absent | Task 1 authors the hook twin |
| `__tests__/story-6-3c-i18n.test.ts` | i18n contract (vitest) | `assertI18nParity` → en+vi each missing 40 keys; 3 exact-copy asserts `undefined` | Task 6 adds `speakingGrading.ai.*` to both locales |

**Mock seam = MSW at the HTTP boundary (TEST-FE-1).** Never mock `useQuery`/`useMutation`.
Fake timers drive backoff/slow/stuck **inside `act`** — no RTL `waitFor` on real time.

---

## AC → test map (all 20)

Priority: **P0** = security/data-integrity or core money path · **P1** = primary UX contract ·
**P2** = secondary/edge · **P3** = cosmetic. Level: **H**=hook · **C**=component · **P**=page-integration · **I**=i18n · **A**=a11y(axe).

### A. Enqueue + poll + credit gate

| AC | Scenario | Lvl | Pri | Red assertion / seam | Where |
|---|---|---|---|---|---|
| 1 | "Run AI grading" → confirm → empty-body POST → generating, 2/4/8s backoff | H+C | P1 | hook: `enqueue()` POSTs once, phase `generating`, backoff gaps `[2000,4000,8000]` | **hook ✅ (red now)** + panel (green) |
| 1 | **No auto-enqueue on mount/remount** | C | P0 | render panel → assert **zero** POST to `/ai-grade` until CTA→confirm | panel (green) |
| 2 | Idempotent 200 ≡ 202 — poll returned jobId, no 2nd credit | H | P1 | hook: `enqueueStatus:200` → 1 POST, polls to ready | **hook ✅ (red now)** |
| 3 | Re-run gate: existing suggestion → confirm shows re-charge warning; reopen NEVER re-enqueues | C+P | P0 | mount with `aiSpeakingSuggestion` set → 0 POST on mount; CTA → dialog `rerunWarning` visible | panel + page (green) |
| 4 | `409 SUBMISSION_TOO_LONG` / `SUBMISSION_NOT_GRADABLE` → idle, **no credit, no poll, no refund toast** | C | P0 | MSW POST→409 → panel idle + inline i18n; assert **no** GET `/jobs/*`, **no** refund toast | panel (green) |

### B. Suggestion review — band strip + interleaved moments

| AC | Scenario | Lvl | Pri | Red assertion / seam | Where |
|---|---|---|---|---|---|
| 5 | Band strip: 4 speaking criteria `{band,rationale,confidence}` + Accept/Edit/Dismiss + disclaimer + overall preview | C | P1 | Accept writes `draft.scores[criterion]`; disclaimer exact copy; overall reuses `SpeakingBandInputs` treatment | domain surface (green) |
| 6 | AI moment cards **inline in `NotesRail`**, sorted by `timestampMs`; null-ts → general zone; avatar/type/criterion/confidence badge + actions | C+P | P1 | Accept appends `SpeakingDraftComment{source:'ai'}`; null-timestamp renders in general zone (never dropped) | domain + page (green) |
| 7 | AI waveform markers distinct from teacher pins; cluster + active-highlight; click seeks + highlights rail card; null-ts → no marker | C | P2 | `WaveformPin.source` widening; assert 6-3a teacher-pin render **byte-unchanged** when `source` absent | waveform unit (green) |
| 8 | "Accept all praise" bulk-accepts praise only; **skips a card open in Edit** (buffer not discarded); nothing auto-applies | C | P1 | bulk touches praise only; in-edit card untouched | domain + page (green) |
| 9 | **Confidence/rationale/transcript teacher-only; DROPPED on accept; ABSENT from student path** | P | **P0** | `buildSpeakingGradeInput()` sends neither; **negative:** `ResultSpeakingPlayback` renders no confidence/rationale/transcript/AI-chip | **page + student-negative (green — MANDATORY DoD)** |

> **AC9 note:** `ResultSpeakingPlayback.tsx` today contains zero confidence/rationale/
> transcript refs (verified) — the invariant holds now. The negative test **locks**
> it so a future edit can't leak teacher-only data onto the student surface.

### C. Transcript panel + partial success

| AC | Scenario | Lvl | Pri | Red assertion / seam | Where |
|---|---|---|---|---|---|
| 10 | `available` → "View transcript" reveals transcript + meta (duration from `analyzedDurationMs`, time from `latencyMs`) | C | P2 | collapsible; meta via i18n formatter (TS-6, numeric→mm:ss) | panel (green) |
| 11 | `unavailable` → **value-first** "Transcript unavailable — band proposals below"; bands+moments usable; **NOT refunded** | H+C | P1 | hook: partial_success = phase `ready`, errorKind `null`, `transcriptionStatus:'unavailable'`; panel header exact copy | **hook ✅ (red now)** + panel (green) |

### D. Rehydrate + non-triggering reader

| AC | Scenario | Lvl | Pri | Red assertion / seam | Where |
|---|---|---|---|---|---|
| 12 | Reopen (no active job) + `aiSpeakingSuggestion != null` → reviewable; accepted-band set seeded from `draft.scores`; merged moments not duplicated | P | P1 | dedup key = `timestampMs` (mirror `WritingGradingPage.acceptAiComment`) | page (green) |
| 13 | **Non-triggering co-teacher reads `aiSpeakingSuggestion`, never the creator-private poll** | P | P0 | assert **no** GET `/api/jobs/*` when there is no locally-created job | page (green — negative) |

### E. Slow + failure paths

| AC | Scenario | Lvl | Pri | Red assertion / seam | Where |
|---|---|---|---|---|---|
| 14 | 30s "taking longer" · 60s "unusually slow — grade manually"; no intermediate `retrying` | H+C | P1 | hook: `slowLevel` 0→1@30s→2@60s; `stuck` @5min | **hook ✅ (red now)** + panel copy (green) |
| 15 | Non-blocking "ready — Review?" overlay gated on **session-edited** flag (not seeded/revise); `aria-live`; no clobber | C | P1 | overlay only when session-edited; merge action present; does not auto-open | panel (green) + a11y |
| 16 | Terminal `audio_unavailable` → refund toast (exact copy) + inline "Ask student to re-record"; once-per-episode, not re-fired on language switch | H+C | P1 | hook: errorKind `audio_unavailable`; toast latch via `failedToastedRef` | **hook ✅ (red now)** + panel (green) |
| 17 | `invalid_band_scores` → "grade manually" **all fields empty**; `invalid_ai_response` → refund toast; `poll_error` → inline retry **no credit toast** | H+C | P1 | hook: three distinct errorKinds; panel: empty-form on invalid scores, no toast on poll_error | **hook ✅ (red now)** + panel (green) |
| 18 | Loading/Empty/Error trilogy: skeletons (no spinner), inline retry (not full-page), all copy i18n | C | P1 | skeleton mirrors final layout; no hardcoded English / HTTP codes | panel (green) |

### F. i18n + a11y

| AC | Scenario | Lvl | Pri | Red assertion / seam | Where |
|---|---|---|---|---|---|
| 19 | `speakingGrading.ai.*` in **both** en+vi (reuse `criterion.*` + `grading.ai.confirm.*`, don't re-key); `STORY_6_3C` closed list + prefix ratchet | I | P1 | `assertI18nParity` + ratchet + 3 exact-copy asserts | **i18n ✅ (red now)** |
| 20 | axe clean on panel + confirm dialog + transcript disclosure; Accept/Edit/Dismiss reachable by role/label; ready overlay `aria-live`; focus returns to trigger on dialog close; markers keyboard-reachable | A | P1 | `vitest-axe` `toHaveNoViolations`; role queries not aria-label grep (TEST-FE-5) | panel + domain (green) |

---

## Handed to dev — build GREEN-alongside (Task 7)

These are **not** scaffolded red (prop surface still fluid; higher churn than value).
Build them green as each component lands, then expand coverage via `/bmad-tea TA 6-3c`.

1. **`AiSpeakingGradePanel.test.tsx`** — three-state (skeleton / suggestions / poll-error inline retry, TEST-FE-2); no-auto-enqueue (AC1); re-run gate (AC3); `SUBMISSION_TOO_LONG` no-credit (AC4); partial_success value-first header (AC11); `audio_unavailable` refund + re-record (AC16); invalid-scores empty-form + `invalid_ai_response` toast (AC17); 30s/60s copy (AC14); once-per-episode toast latch (not re-fired on language switch).
2. **`SpeakingGradingPage.ai.test.tsx`** — the **combined harness** (6-3a waveform jsdom stubs `AudioContext`/`getContext`/`getBoundingClientRect` **+** the ai-grade MSW seam — no existing file combines both; build once). Rail interleave sorted by `timestampMs` + null→general (AC6); merged `pins` teacher∪AI + click-seek (AC7); Accept handlers → draft (bands→`scores`, moments→`{source:'ai'}`, `confidence` dropped) (AC5/6/9); reopen rehydrate + seeded accepted-bands (AC12); **non-triggering teacher does not poll** (AC13, negative); ready overlay on session-edited (AC15).
3. **`AISpeakingGradeSuggestion.test.tsx`** (+ `.stories.tsx`) — band strip + `AiMomentCard`; teacher-only confidence/rationale render; "Accept all praise" skip-in-edit (AC8); axe (AC20).
4. **`ResultSpeakingPlayback` negative** (AC9, **MANDATORY DoD**) — an accepted `source:'ai'` moment reaches the student path as a plain teacher note: **no** confidence / rationale / transcript / AI-chip in the DOM. Baseline verified clean today; this test guards against regression.

---

## Reuse anchors (do NOT reinvent — from story Dev Notes)

- **Hook twin:** `useAiGradeJob.ts` (+ test) → diffs are only: narrow on `'moments'`, add `audio_unavailable`, expose `transcriptionStatus`. Same `jobKeys` poll, same persisted-jobId key scheme (Writing XOR Speaking → no collision).
- **Confirm gate:** `AiGradeConfirmDialog` (lives in `components/AiGradePanel.tsx`) — skill-agnostic, reuse **as-is**; confirm copy stays `grading.ai.confirm.*`.
- **Draft merge:** `speakingGradingDraft.ts` — `SpeakingDraftComment.source:'ai'` already reserved (no shape change); `buildSpeakingGradeInput()` already strips `id`/`source`.
- **Band math:** `speakingOverallBand.ts` — `computeSpeakingOverallBand`, `SPEAKING_CRITERION_KEYS` (use these, **not** the writing `computeOverallBand`).
- **Rehydrate:** `useGradingSubmission` already returns `view.aiSpeakingSuggestion` (unused today) — wire as 6-2b wired `view.aiSuggestion`.
- **Wiring precedent:** `WritingGradingPage.acceptAiBand`/`acceptAiComment` — mirror, swapping the anchor dedup key → `timestampMs`.

## Guardrails that bite (project-context)

TanStack Query owns server state — no `useEffect` fetching (FW-4); the poll's `staleTime:0` is the one justified FW-3 deviation; durations stay numeric until the i18n formatter (TS-6); `AISpeakingGradeSuggestion` is `domain/`, panel wiring is feature-local (FW-7); named constants for 30s/60s/backoff (CQ-3); speaking surface is RHF-exempt (FW-8, keep the durable-`useState` draft); **no `codegen.sh`** — contract is fixed (WF-3). If you find yourself editing `client.ts`, STOP.

## Next steps

1. **Dev (Task 1):** author `useAiGradeSpeakingJob.ts` → the red hook file activates all 8 describe blocks. Run `npx vitest run src/features/grading/hooks/__tests__/useAiGradeSpeakingJob.test.tsx`.
2. **Dev (Task 6):** add the 40 `speakingGrading.ai.*` keys (both locales, exact SD7/SD8 copy) → the red i18n file goes green.
3. **Dev (Tasks 3-5,7):** build the 4 green-alongside suites above; **AC9 negative is DoD-blocking**.
4. **Post-dev:** `/bmad-tea TA 6-3c` to expand the partial_success / audio_unavailable / role-negative matrix (the story's recommended path).
5. **Gate:** `tsc -b` clean · vitest green (three-state + negatives) · axe clean · ci-web passes.
