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

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO_ROOT, "docs/product/screens.yaml");
const ID_GRAMMAR = /^s\d{2}[a-z]?$/;
const TOKEN_RE = /\bs\d{2}[a-z]?\b/g;
const SCAN_EXTS = new Set([".md", ".yaml", ".yml"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".playwright",
  "test-results", "playwright-report", ".next", "coverage",
]);
const VALID_STATUS = new Set(["shipped", "unbuilt-epic-9", "unbuilt-epic-10"]);
const VALID_PROVENANCE = new Set(["asserted-from-design-intent", "verified-against-build"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
const ids = new Set();
for (const e of entries) {
  if (!ID_GRAMMAR.test(e.id)) {
    errors.push(`manifest: id ${JSON.stringify(e.id)} violates grammar s\\d{2}[a-z]?`);
    continue;
  }
  if (ids.has(e.id)) errors.push(`manifest: duplicate id ${e.id}`);
  ids.add(e.id);
  const unq = (v) => (v || "").replace(/^"|"$/g, "");
  if (!VALID_STATUS.has(unq(e.implementation_status)))
    errors.push(`manifest ${e.id}: invalid implementation_status ${JSON.stringify(e.implementation_status)}`);
  if (!VALID_PROVENANCE.has(unq(e.provenance)))
    errors.push(`manifest ${e.id}: invalid provenance ${JSON.stringify(e.provenance)}`);
  if (!DATE_RE.test(unq(e["last-verified"])))
    errors.push(`manifest ${e.id}: last-verified must be YYYY-MM-DD, got ${JSON.stringify(e["last-verified"])}`);
  if (e.title === undefined) errors.push(`manifest ${e.id}: missing title`);
  if (e.route === undefined) errors.push(`manifest ${e.id}: missing route (use null if none)`);
  if (e.detailDoc === undefined) errors.push(`manifest ${e.id}: missing detailDoc (null until 11-3a/b)`);
}
if (ids.size !== 89)
  errors.push(`manifest: expected 89 screen entries (s00–s87 + s10a), found ${ids.size}`);

// --- 2/3. Walk docs, collect token references ---------------------------------
const tokenFiles = new Map(); // token -> Set(relpath)
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
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
