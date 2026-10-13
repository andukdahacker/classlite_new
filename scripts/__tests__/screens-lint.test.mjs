#!/usr/bin/env node
// screens-lint.test.mjs — Story 11-3a Task 0 (AC7, the DD-RED demonstration) +
// the 11-3a code-review hardening (anchor validation, calendar-valid exemptions).
//
// The BEHAVIOURAL SPEC for the Task-4 provenance ratchet. Run it:
//
//     node --test scripts/__tests__/
//
// RED-PHASE NOTE (this file is the red signal, per the repo's red-phase
// convention — `reference_atdd_red_convention` + bmad-story-conventions.md):
// authored BEFORE the Task-4 lint extension exists. Against the *unextended*
// lint (the state at baseline e4904b6) the SCREENS_LINT_ROOT/SCREENS_LINT_MANIFEST
// env hooks do not exist, so every case runs against the real (clean) repo and the
// five exit-1 cases below FAIL (the lint exits 0):
//   - `reconciled entry still asserted → exit 1`      FAILS,
//   - `detailDoc file missing → exit 1`               FAILS,
//   - `detailDoc #anchor dangling → exit 1`           FAILS,
//   - `malformed provenance-exemption date → exit 1`  FAILS,
//   - `malformed verified-sha → exit 1`               FAILS.
// Those five failures ARE the red. Once Task 4 lands the ratchet + the two env
// hooks (and the code-review hardening adds the anchor + calendar checks), every
// case goes green and this file becomes the permanent regression guard for the
// ratchet (it survives, it is never deleted).
//
// GREEN-PHASE SEAMS the extension must provide (one place to reconcile):
//   1. `SCREENS_LINT_ROOT`     — override REPO_ROOT (the dir the lint walks).
//   2. `SCREENS_LINT_MANIFEST` — override the manifest path.
//      Both are TEST-ONLY: CI sets neither, so production behaviour is byte-identical.
//   3. The ratchet: a non-null `detailDoc` ⇒ `provenance == verified-against-build`
//      + well-formed `verified-sha`, UNLESS a dated `provenance-exemption` is present.
//   4. The file-existence check: a non-null `detailDoc`'s path (anchor stripped),
//      resolved against REPO_ROOT, must exist on disk as a file.
//   5. The anchor check (11-3a code review): the `#anchor` must resolve to a real
//      `##` heading in that file AND start with the entry's own id.
//   6. The exemption date must be a real calendar date (YYYY-MM-DD).
//
// FIXTURE NOTE: the fixtures mutate `s00` — the manifest's FIRST entry, which
// 11-3a reconciled (verified-against-build + a real detailDoc). We copy the real
// `docs/product/01-onboarding.md` into the fixture so the genuine s00–s05 anchors
// resolve; the mutation then drives s00 into each ratchet-violating state. Every
// run is in a fresh tmpdir; the real tree is never touched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = join(HERE, "..", "screens-lint.mjs");
const REAL_MANIFEST = join(HERE, "..", "..", "docs/product/screens.yaml");
const REAL_ONBOARDING = join(HERE, "..", "..", "docs/product/01-onboarding.md");
// s00's real reconciled detailDoc anchor (heading `## s00 — Persona pick`).
const S00_ANCHOR = "docs/product/01-onboarding.md#s00--persona-pick";

// Run the lint against a fixture root; return { code, err } without throwing on
// the non-zero exit the violation cases expect.
function runLint(root, manifest) {
  try {
    const stdout = execFileSync("node", [LINT], {
      encoding: "utf8",
      env: { ...process.env, SCREENS_LINT_ROOT: root, SCREENS_LINT_MANIFEST: manifest },
    });
    return { code: 0, out: stdout, err: "" };
  } catch (e) {
    return { code: e.status ?? 1, out: e.stdout ?? "", err: e.stderr ?? "" };
  }
}

// Rewrite s00's block. s00 is the FIRST entry, so String.replace's first-match
// semantics target it exactly. 11-3a left s00 at `verified-against-build` with a
// non-null detailDoc; the options below drive it into each ratchet state.
function mutateS00(text, { detailDoc, provenance, verifiedSha, exemption } = {}) {
  let out = text;
  if (provenance !== undefined) {
    out = out.replace(
      "    provenance: verified-against-build",
      `    provenance: ${provenance}`,
    );
  }
  if (detailDoc !== undefined) {
    out = out.replace(
      `    detailDoc: "${S00_ANCHOR}"`,
      `    detailDoc: ${detailDoc}`,
    );
  }
  if (verifiedSha !== undefined) {
    out = out.replace(`    verified-sha: "e4904b6"`, `    verified-sha: ${verifiedSha}`);
  }
  if (exemption !== undefined) {
    out = out.replace(
      `    verified-sha: "e4904b6"`,
      `    verified-sha: "e4904b6"\n    provenance-exemption: ${exemption}`,
    );
  }
  return out;
}

// Build a self-contained fixture: a (possibly mutated) copy of the real 89-entry
// manifest + a doc that references every id (so entry↔doc stays satisfied and the
// count check passes) + the REAL chapter-1 doc (so the genuine s00–s05 detailDoc
// anchors resolve), isolating the ratchet as the only thing under test.
function makeFixture(mutate) {
  const root = mkdtempSync(join(tmpdir(), "screens-lint-"));
  mkdirSync(join(root, "docs", "product"), { recursive: true });
  const real = readFileSync(REAL_MANIFEST, "utf8");
  const manifestText = mutate ? mutate(real) : real;
  const manifest = join(root, "docs", "product", "screens.yaml");
  writeFileSync(manifest, manifestText);
  // A doc referencing every id keeps token↔entry + entry↔doc green.
  const ids = [...manifestText.matchAll(/^\s*-\s+id:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  writeFileSync(
    join(root, "all-screens.md"),
    "# fixture\n\n" + ids.map((id) => `- ${id}`).join("\n") + "\n",
  );
  // The real chapter-1 doc so s00–s05's genuine `#anchor`s resolve to headings.
  copyFileSync(REAL_ONBOARDING, join(root, "docs", "product", "01-onboarding.md"));
  return { root, manifest };
}

test("clean fixture (real reconciled s00–s05) exits 0", () => {
  const { root, manifest } = makeFixture(null);
  const r = runLint(root, manifest);
  assert.equal(r.code, 0, `expected clean fixture to pass:\n${r.err}`);
});

test("RATCHET: reconciled entry downgraded to asserted-from-design-intent exits 1", () => {
  const { root, manifest } = makeFixture((t) =>
    mutateS00(t, { provenance: "asserted-from-design-intent" }),
  );
  const r = runLint(root, manifest);
  assert.equal(r.code, 1, "expected exit 1 when a reconciled entry is asserted");
  assert.match(r.err, /provenance/i, `expected a provenance ratchet violation, got:\n${r.err}`);
});

test("FILE-EXISTS: reconciled entry whose detailDoc file is missing exits 1", () => {
  const { root, manifest } = makeFixture((t) =>
    mutateS00(t, { detailDoc: '"docs/product/does-not-exist.md#s00--persona-pick"' }),
  );
  const r = runLint(root, manifest);
  assert.equal(r.code, 1, "expected exit 1 when detailDoc points at a missing file");
  assert.match(
    r.err,
    /does-not-exist\.md|not an existing file/i,
    `expected a detailDoc file-existence violation, got:\n${r.err}`,
  );
});

test("ANCHOR: reconciled entry whose detailDoc #anchor matches no heading exits 1", () => {
  const { root, manifest } = makeFixture((t) =>
    mutateS00(t, { detailDoc: '"docs/product/01-onboarding.md#s00--bogus-anchor"' }),
  );
  const r = runLint(root, manifest);
  assert.equal(r.code, 1, "expected exit 1 when the detailDoc #anchor is dangling");
  assert.match(r.err, /anchor/i, `expected an anchor violation, got:\n${r.err}`);
});

test("ANCHOR: reconciled entry whose #anchor points at another screen's section exits 1", () => {
  // s01's real heading exists in the copied doc, but it is not s00's section.
  const { root, manifest } = makeFixture((t) =>
    mutateS00(t, { detailDoc: '"docs/product/01-onboarding.md#s01--center-setup"' }),
  );
  const r = runLint(root, manifest);
  assert.equal(r.code, 1, "expected exit 1 when the #anchor belongs to a different screen");
  assert.match(r.err, /anchor/i, `expected a cross-screen anchor violation, got:\n${r.err}`);
});

test("EXEMPTION: a dated provenance-exemption lets an asserted reconciled entry pass", () => {
  const { root, manifest } = makeFixture((t) =>
    mutateS00(t, {
      provenance: "asserted-from-design-intent",
      exemption: "2026-10-13 pilot calibration — provenance upgrade tracked in 11-3b",
    }),
  );
  const r = runLint(root, manifest);
  assert.equal(r.code, 0, `expected a dated exemption to pass the ratchet:\n${r.err}`);
});

test("EXEMPTION: a malformed (impossible) exemption date does NOT grant a pass — exits 1", () => {
  const { root, manifest } = makeFixture((t) =>
    mutateS00(t, {
      provenance: "asserted-from-design-intent",
      exemption: "2026-13-45 not a real calendar date",
    }),
  );
  const r = runLint(root, manifest);
  assert.equal(r.code, 1, "expected exit 1 — an impossible exemption date must not bypass the ratchet");
  assert.match(r.err, /provenance/i, `expected the ratchet to still fire, got:\n${r.err}`);
});

test("RATCHET: reconciled + verified-against-build but malformed verified-sha exits 1", () => {
  const { root, manifest } = makeFixture((t) => mutateS00(t, { verifiedSha: '"not-a-sha!"' }));
  const r = runLint(root, manifest);
  assert.equal(r.code, 1, "expected exit 1 when verified-sha is malformed");
  assert.match(r.err, /verified-sha/i, `expected a verified-sha violation, got:\n${r.err}`);
});
