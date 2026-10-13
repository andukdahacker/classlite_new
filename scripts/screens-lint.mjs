#!/usr/bin/env node
// screens-lint.mjs — Story 11-1a (AC4 / DD8/DD9/DD15). Self-contained repo-level
// lint (no external deps, mirroring classlite-web/scripts/i18n-parity.mjs) that
// pins the s00–s87 + s10a screen-ID vocabulary as a provenance RATCHET.
//
// What it checks (SHAPE / uniqueness / referential-integrity + valid enums —
// NOT provenance correctness, DD8; flagging the known-provisional
// `asserted-from-design-intent` entries would get the lint disabled in a week):
//
//   1. Manifest shape: every screens.yaml entry carries the required fields with
//      valid enum values; ids are unique and match the s\d{2}[a-z]? grammar.
//   2. token -> entry: every sNN token referenced in the docs has a manifest entry
//      (catches an orphaned / typo'd id).
//   3. entry -> doc: every manifest entry is referenced by at least one doc
//      (catches a dead manifest row).
//   4. the RECONCILIATION RATCHET (Story 11-3a / DD15): a RECONCILED entry
//      (non-null detailDoc) must be `verified-against-build` + a well-formed
//      `verified-sha`, OR carry a dated `provenance-exemption`, AND its detailDoc
//      file must exist. Non-reconciled (detailDoc: null) entries are untouched by
//      the ratchet (DD8). Plus: top-level `source` must point into docs/product/.
//
// It is READ-ONLY. It NEVER rewrites the 86 story files (epic-11.md:276) — it
// validates and FAILS; discipline is a build failure, not a sed.
//
// Scope: markdown + yaml under the repo (where sNN tokens are genuinely SCREEN
// references). Code files (.ts/.go) are deliberately NOT scanned — an `s\d{2}`
// identifier in code is not a screen reference and would false-positive the lint
// into being ignored. The GitHub workflow's path triggers are repo-wide
// (.github/workflows/screens-lint.yml) so the lint RUNS on any commit (DD8); the
// mockup .html prototypes under docs/classlite-entry/ are naturally excluded
// (not markdown/yaml) — 11-3a owns their archive split.
//
// Exit codes: 0 = clean; 1 = violations found; 2 = lint error (bad manifest path).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// SCREENS_LINT_ROOT / SCREENS_LINT_MANIFEST are TEST-ONLY overrides consumed by
// the Story 11-3a Task-0 harness (scripts/__tests__/screens-lint.test.mjs) so it
// can point the lint at a throwaway fixture tree. CI sets NEITHER, so the
// production resolution (repo root + docs/product/screens.yaml) is byte-identical.
const REPO_ROOT =
  process.env.SCREENS_LINT_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST =
  process.env.SCREENS_LINT_MANIFEST ?? join(REPO_ROOT, "docs/product/screens.yaml");
const ID_GRAMMAR = /^s\d{2}[a-z]?$/;
const TOKEN_RE = /\bs\d{2}[a-z]?\b/g;
const SCAN_EXTS = new Set([".md", ".yaml", ".yml"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".playwright",
  "test-results", "playwright-report", ".next", "coverage",
]);
// Story 11-3a (AC1/AC4) — the archived HTML prototypes + any future `.md` under
// archive/ are reference-only and must NEVER red the lint. Skipped by
// repo-relative PATH (not bare name) so a feature dir happening to be named
// `archive` elsewhere — e.g. classlite-web/src/features/archive — is untouched.
const SKIP_PATHS = new Set(["docs/archive"]);
const VALID_STATUS = new Set(["shipped", "unbuilt-epic-9", "unbuilt-epic-10"]);
const VALID_PROVENANCE = new Set(["asserted-from-design-intent", "verified-against-build"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A git sha (short or full) and a dated exemption `YYYY-MM-DD <reason>` (11-3a).
const SHA_RE = /^[0-9a-f]{7,40}$/;
const EXEMPTION_RE = /^\d{4}-\d{2}-\d{2}\s+\S/;

// GitHub-style heading slug: lowercase, drop every char that is not word/space/
// hyphen, then spaces -> hyphens. Used by the ratchet to prove a detailDoc
// `#anchor` resolves to a real `##` heading in the target file — the ratchet's
// core promise (SCHEMA §6). "## s00 — Persona pick" -> "s00--persona-pick".
function slugifyHeading(text) {
  return text.trim().toLowerCase().replace(/[^\w\- ]/g, "").replace(/ /g, "-");
}

// Calendar-valid YYYY-MM-DD (rejects 2026-13-45). Hand-rolled leap-year check so
// the lint stays dependency-free and avoids Date() entirely (deterministic).
function isValidYmd(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

const errors = [];

// --- 1. Parse + shape-check the manifest (hand-rolled; the shape is fixed) ----
function parseManifest() {
  let raw;
  try {
    raw = readFileSync(MANIFEST, "utf8");
  } catch (e) {
    console.error(`screens-lint: cannot read manifest ${MANIFEST}: ${e.message}`);
    process.exit(2);
  }
  const lines = raw.split("\n");
  const entries = [];
  let cur = null;
  const push = () => { if (cur) entries.push(cur); cur = null; };
  for (const line of lines) {
    const idm = line.match(/^\s*-\s+id:\s*(\S+)\s*$/);
    if (idm) { push(); cur = { id: idm[1], _line: line }; continue; }
    if (!cur) continue;
    const kv = line.match(/^\s+([\w-]+):\s*(.*)$/);
    if (kv) cur[kv[1]] = kv[2].trim();
  }
  push();
  return entries;
}

const entries = parseManifest();

// --- 1b. Top-level `source` must point into docs/product/ (11-3a / DD17) ------
// classlite-ia.md is archived; the manifest's source of record is now the
// absorbed oracle. Re-read is cheap and keeps the top-level scan off the
// per-entry parser (which only captures `- id:` blocks).
{
  const manifestRaw = readFileSync(MANIFEST, "utf8");
  const m = manifestRaw.match(/^source:[ \t]*(.*)$/m);
  const sourceVal = m
    ? m[1].replace(/\s+#.*$/, "").trim().replace(/^"|"$/g, "")
    : "";
  if (!sourceVal.startsWith("docs/product/"))
    errors.push(
      `manifest: top-level source must point into docs/product/ (DD17), got ${JSON.stringify(sourceVal)}`,
    );
}

const ids = new Set();
for (const e of entries) {
  if (!ID_GRAMMAR.test(e.id)) {
    errors.push(`manifest: id ${JSON.stringify(e.id)} violates grammar s\\d{2}[a-z]?`);
    continue;
  }
  if (ids.has(e.id)) errors.push(`manifest: duplicate id ${e.id}`);
  ids.add(e.id);
  // Strip a trailing ` # comment` (whitespace-anchored, so it never eats the `#`
  // in a detailDoc anchor like `…md#s00`) then surrounding quotes. Mirrors the
  // top-level `source` parser so inline comments are handled symmetrically.
  const unq = (v) =>
    (v || "").replace(/\s+#.*$/, "").replace(/^"|"$/g, "").trim();
  if (!VALID_STATUS.has(unq(e.implementation_status)))
    errors.push(`manifest ${e.id}: invalid implementation_status ${JSON.stringify(e.implementation_status)}`);
  if (!VALID_PROVENANCE.has(unq(e.provenance)))
    errors.push(`manifest ${e.id}: invalid provenance ${JSON.stringify(e.provenance)}`);
  if (!DATE_RE.test(unq(e["last-verified"])))
    errors.push(`manifest ${e.id}: last-verified must be YYYY-MM-DD, got ${JSON.stringify(e["last-verified"])}`);
  if (e.title === undefined) errors.push(`manifest ${e.id}: missing title`);
  if (e.route === undefined) errors.push(`manifest ${e.id}: missing route (use null if none)`);
  if (e.detailDoc === undefined) errors.push(`manifest ${e.id}: missing detailDoc (null until 11-3a/b)`);

  // Story 11-3a (AC4 / DD15) — the provenance RATCHET. The moment a screen is
  // RECONCILED (non-null detailDoc), it must be `verified-against-build` with a
  // well-formed `verified-sha`, OR carry a dated `provenance-exemption`; and its
  // detailDoc file must exist. This is the "must-upgrade-by-reconciliation" gate
  // DD15 reserved — it bites the instant reconciliation starts, not later. Still
  // READ-ONLY (a build FAIL, never a rewrite). Non-reconciled entries are NOT
  // checked for provenance correctness (DD8 — flagging the known-provisional
  // `asserted-from-design-intent` rows would get the lint disabled in a week).
  const detailDoc = unq(e.detailDoc);
  // null spellings (YAML `null`/`~`, case-insensitive) and a blank value all mean
  // "not reconciled" — the ratchet leaves them alone. Writing a blank instead of
  // `null` no longer silently skips BOTH the missing-field and the ratchet checks.
  const reconciled = detailDoc !== "" && !/^(null|~)$/i.test(detailDoc);
  if (reconciled) {
    const [filePart, anchor] = detailDoc.split("#");
    let fileOk = false;
    if (!filePart) {
      errors.push(`manifest ${e.id}: detailDoc is missing its file path (got ${JSON.stringify(detailDoc)})`);
    } else {
      let stat = null;
      try { stat = statSync(join(REPO_ROOT, filePart)); } catch { /* missing */ }
      if (!stat || !stat.isFile())
        errors.push(`manifest ${e.id}: detailDoc points at a path that is not an existing file: ${filePart}`);
      else fileOk = true;
    }
    // The ratchet's CORE promise (SCHEMA §6): the `#anchor` must resolve to a real
    // `##` heading in the target file AND belong to THIS screen. A reconciled
    // "verified-against-build" pointer that lands on a dead, wrong-screen, or
    // empty-shell heading is exactly the false confidence the ratchet exists to
    // prevent — file-existence alone is not enough.
    if (fileOk) {
      if (!anchor) {
        errors.push(
          `manifest ${e.id}: detailDoc has no #anchor — it must point at the screen's heading (e.g. ${filePart}#${e.id}--…)`,
        );
      } else {
        const headingSlugs = new Set(
          [...readFileSync(join(REPO_ROOT, filePart), "utf8").matchAll(/^#{2,}\s+(.+?)\s*$/gm)]
            .map((m) => slugifyHeading(m[1])),
        );
        if (!headingSlugs.has(anchor))
          errors.push(
            `manifest ${e.id}: detailDoc #anchor ${JSON.stringify(anchor)} matches no heading in ${filePart}`,
          );
        else if (anchor !== e.id && !anchor.startsWith(`${e.id}-`))
          errors.push(
            `manifest ${e.id}: detailDoc #anchor ${JSON.stringify(anchor)} is not this screen's section (expected it to start with ${e.id})`,
          );
      }
    }
    const exemption = unq(e["provenance-exemption"]);
    const hasExemption =
      EXEMPTION_RE.test(exemption) &&
      isValidYmd(+exemption.slice(0, 4), +exemption.slice(5, 7), +exemption.slice(8, 10));
    if (!hasExemption) {
      if (unq(e.provenance) !== "verified-against-build")
        errors.push(
          `manifest ${e.id}: reconciled (detailDoc set) but provenance is ${JSON.stringify(e.provenance)} — a reconciled entry must be verified-against-build or carry a dated provenance-exemption (YYYY-MM-DD <reason>)`,
        );
      else if (!SHA_RE.test(unq(e["verified-sha"])))
        errors.push(
          `manifest ${e.id}: reconciled but verified-sha is missing/malformed ${JSON.stringify(e["verified-sha"])} (expected 7–40 lowercase hex)`,
        );
    }
  }
}
if (ids.size !== 89)
  errors.push(`manifest: expected 89 screen entries (s00–s87 + s10a), found ${ids.size}`);

// --- 2/3. Walk docs, collect token references ---------------------------------
const tokenFiles = new Map(); // token -> Set(relpath)
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    // Normalize to forward slashes so the skip matches on Windows checkouts too
    // (relative() yields `docs\archive` there, which would miss the Set).
    if (SKIP_PATHS.has(relative(REPO_ROOT, full).replace(/\\/g, "/"))) continue; // docs/archive (11-3a)
    // A dangling symlink or a file removed between readdir and stat throws; skip
    // it rather than crash with an uncaught stack trace (which would exit with a
    // code outside the documented 0/1/2 contract and red the CI job spuriously).
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) { walk(full); continue; }
    if (!SCAN_EXTS.has(extname(name))) continue;
    if (full === MANIFEST) continue; // the manifest defines, it is not a reference
    let text;
    try {
      text = readFileSync(full, "utf8");
    } catch {
      continue;
    }
    const seen = text.match(TOKEN_RE);
    if (!seen) continue;
    const rel = relative(REPO_ROOT, full);
    for (const tok of seen) {
      if (!tokenFiles.has(tok)) tokenFiles.set(tok, new Set());
      tokenFiles.get(tok).add(rel);
    }
  }
}
walk(REPO_ROOT);

// token -> entry: every referenced sNN token must have a manifest entry.
for (const [tok, files] of [...tokenFiles].sort()) {
  if (!ids.has(tok)) {
    const sample = [...files].slice(0, 5).join(", ");
    errors.push(`orphan token ${tok}: referenced in docs but has NO manifest entry (e.g. ${sample})`);
  }
}
// entry -> doc: every manifest entry must be referenced by at least one doc.
for (const id of [...ids].sort()) {
  if (!tokenFiles.has(id)) {
    errors.push(`dead entry ${id}: in screens.yaml but referenced by no doc`);
  }
}

// --- Report -------------------------------------------------------------------
if (errors.length > 0) {
  console.error(`screens-lint: ${errors.length} violation(s):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error(`\nThe lint is read-only; fix the manifest (docs/product/screens.yaml) or the offending reference.`);
  process.exit(1);
}
console.log(`screens-lint: OK — ${ids.size} screen ids, all referenced, all referencing tokens resolved.`);
process.exit(0);
