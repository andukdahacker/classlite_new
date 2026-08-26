---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-identify-targets', 'step-03-generate-and-verify']
lastStep: 'step-03-generate-and-verify'
lastSaved: '2026-08-26'
story: '6-3c-ai-speaking-grading-frontend'
inputDocuments:
  - _bmad-output/implementation-artifacts/6-3c-ai-speaking-grading-frontend.md
  - _bmad-output/implementation-artifacts/6-3c-ai-speaking-grading-frontend-completion-notes.md
  - _bmad-output/implementation-artifacts/deferred-work.md
  - .claude/skills/bmad-tea/resources/knowledge/test-priorities-matrix.md
  - .claude/skills/bmad-tea/resources/knowledge/test-quality.md
---

# Test Automation Summary — Story 6.3c (AI Speaking Grading, Frontend)

**Author:** Murat (Test Architect), `/bmad-tea TA 6-3c` — 2026-08-26
**Run after:** `/bmad-code-review 6-3c` (6 patches applied, suite 2824 green)
**Stack:** frontend (classlite-web) · Vitest 4 + RTL + MSW + vitest-axe · Playwright present for E2E flows (not used here — see decision)

## Scope decision (risk vs value)

Story 6-3c is a **thin FE feature, risk 4** — not a WF-8 hard gate (R3=9 was discharged in the 6-3b worker). It arrived at TA already densely covered: 100 tests across 6 files (hook / panel / page / domain / i18n / student-negative), **including 6 regression tests just added by code review** (4 axe/a11y, 1 AC15 review-gate page integration, 1 re-run `acceptedMoments` reset). The mock seam is fixed by convention: **MSW at the HTTP boundary (TEST-FE-1)**; real `QueryClient`.

**No E2E added — deliberate.** Per the project Test Meta-Rule ("E2E tests verify user flows, not business logic; if a Playwright test checks a calculation or permission rule, the service layer is under-tested"), the 6-3c interactions (accept/edit/dismiss a moment, interleaved timeline, credit-gate, wire-strip) are business logic best asserted at the component/page level against the MSW seam. An E2E here would duplicate that logic through a slower, flakier lens. The AC9 leak-guard — the one security-adjacent line — is already a mandatory component negative test (`resultSpeaking-ai-negative.test.tsx`).

## Coverage gaps identified → closed

The pre-TA suite covered the happy paths, all five terminal `errorKind`s (incl. `poll_error` transition in the hook), partial_success, idempotent-200, persisted-resume, slow/stuck bands, non-triggering-reader, rehydrate/interleave, and the AC9 wire-strip. Remaining **P2 page-level integration** gaps (moment *actions* were only unit-covered on the card, not integrated through the page draft/rail/waveform) + one component branch:

| # | Pri | Target | File | Why it mattered |
|---|-----|--------|------|-----------------|
| 1 | P2 | **Accept all praise** (page batch) | `SpeakingGradingPage.ai.test.tsx` | Named TA target in deferred-work; exercises the batch merge + the code-review patch-2 (button hidden once no un-accepted praise remains); asserts non-praise moments are left untouched |
| 2 | P2 | **Dismiss moment** (page) | `SpeakingGradingPage.ai.test.tsx` | Only *accept* was integration-tested; dismiss must remove the rail card AND the waveform pin and mint NO draft comment |
| 3 | P2 | **Edit-then-Accept moment** (page) | `SpeakingGradingPage.ai.test.tsx` | The edited text (not the AI original) must be what merges into the draft — the per-card Edit buffer → page draft path had no page-level assertion |
| 4 | P2 | **`SUBMISSION_NOT_GRADABLE` inline reject** | `AiSpeakingGradePanel.test.tsx` | The second enqueue-reject copy branch was untested (only `SUBMISSION_TOO_LONG`); no-credit-spent → no toast |

## What was NOT added (and why)

- **Hook `poll_error` / stuck / slow bands** — already covered (`useAiGradeSpeakingJob.test.tsx`), driven with fake timers inside `act`. No duplication.
- **AC15 ready-overlay page gate + full run→ready cycle + re-run reset** — added by the preceding code review; not re-added.
- **Live-job `audio_unavailable` refund toast at the page level** — the toast (panel, constructed props) and the terminal transition (hook) are each covered; a third page-level integration is low marginal value for risk 4. Logged as optional below.

## DoD compliance (test-quality checklist)

- ✅ No hard waits — MSW-backed `findBy*`/`waitFor` on real state; the live seam's first poll is immediate (no backoff sleep).
- ✅ No conditional flow control; assertions explicit in test bodies.
- ✅ Each new test < 40 lines; files remain well under 300.
- ✅ Self-cleaning — `localStorage.clear()` + `vi.restoreAllMocks()`/`unstubAllGlobals()` in `beforeEach`/`afterEach` (durable draft + persisted jobId isolated per test).
- ✅ i18n via keys (`i18n.t(...)`), never hardcoded English.
- ✅ Negative assertions paired with positives (dismiss → card AND pin AND text absent; edited text present → original absent).

## Gates

- `tsc -b` clean · ESLint clean (new test files)
- **Full web suite: 2828 passed / 208 files** (was 2824 post-review → **+4 TA tests, 0 regressions**)

## Recommended follow-ups (optional, not blockers)

- `/bmad-tea RV 6-3c` — test-review pass over the expanded suite (hidden-assertion / flake sweep).
- Optional page-level `audio_unavailable` live-job integration if the refund UX becomes higher-traffic.
- The one review **defer** stands: `stuck`-in-persisted-jobId-clear (pre-existing, byte-identical in the writing twin) — fix both hooks in lockstep (logged in deferred-work.md); a regression test should land WITH that fix, not before.
