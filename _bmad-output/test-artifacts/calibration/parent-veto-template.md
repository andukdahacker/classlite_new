# Parent-veto — English-feedback usefulness to a bilingual teacher (Story 11-0b, AC7/DD6)

_Product-evidence artifact. One honest "no" is worth more than any 5-point average._

## What this is (and is NOT)

This captures a **binary veto with a reason** from a qualified **bilingual (Vietnamese) teacher** on real AI-generated writing feedback:

> **"Would you let this feedback go home to a parent — yes / no? If no, why?"**

It is **NOT** a numeric usefulness score. A single scored rating (n=1) is theater (John). The signal is the veto + its reason, not an average.

## The honest limitation this artifact names (DD6)

The shipped grader produces **English-only** feedback — there is **no Vietnamese output anywhere** in the product today (confirmed by recon: no locale toggle in `internal/worker`, `internal/gemini`, or `internal/config`). Therefore:

- This rates **English feedback read by a fluent bilingual adult**, not Vietnamese feedback read by the student. A band-4 teenager cannot necessarily read band-7 English feedback *about their band-5 English* — the signal routes through the one fluent adult in the room (Mary).
- The missing capability — **the product emits no Vietnamese output** — is filed as **FU-11-0B-VN-FEEDBACK** and is a deferral of the *product*, not of polish. Do not read a green veto here as "Vietnamese feedback is good"; there is none.

## Procedure

1. Run the authoritative calibration (bands-4-6 center cohort) so real feedback exists in `jobs.result` / the report.
2. Select a representative sample of graded feedback (mix of bands 4–6; include at least one low-confidence grade).
3. For **each** item, a bilingual teacher fills one row below. The teacher sees the student essay + the AI feedback (criteria rationales + comments + overall feedback).
4. **Any single "no" is a smoke detector** — record the reason and route it to the grading-quality backlog; do not average it away.
5. Commit the filled table alongside the calibration report under `_bmad-output/test-artifacts/calibration/`.

## Veto record

| Sample ID | Teacher (initials) | Date | Let it go home to a parent? (yes/no) | If no — why | Notes |
|---|---|---|---|---|---|
| _(e.g. center-w-012)_ | | | | | |
| | | | | | |
| | | | | | |

## Reading the result

- **≥1 "no"** → the feedback is not yet parent-safe. The reason names the fix (wrong tone, factually wrong, confusing to a VN reader, over-harsh, etc.). This blocks `done` until addressed or consciously accepted by Ducdo.
- **All "yes"** → necessary (not sufficient) evidence the English feedback is usable by the bilingual teacher who mediates it to the family. Pair with AC1 accuracy + AC2 stability for the full trust picture.
