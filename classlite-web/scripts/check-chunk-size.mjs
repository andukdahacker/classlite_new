#!/usr/bin/env node
/**
 * check-chunk-size — Story 1-9c Task 8.5 (Winston enforcement-seam catch).
 *
 * Asserts gzipped size of named build chunks under `dist/assets/` does
 * not exceed the 8 KB ceiling. Bundle discipline rules without an
 * enforcement seam decay — this script IS the seam. Wire it into the
 * `build:check` package.json step (or a CI step) after `npm run build`.
 *
 * Originally drafted at Story 1-9b (per its spec) but the script wasn't
 * actually committed — 1-9b shipped without a check seam. Story 1-9c
 * lands it for the three auth pages currently under discipline:
 * ForgotPasswordPage, ResetPasswordPage, InviteAcceptancePage. Add a new
 * entry to TARGETS when a new auth chunk needs the ceiling.
 *
 * Usage:
 *   npm run build         # produce dist/
 *   node scripts/check-chunk-size.mjs   # green / red
 *
 * Exit codes:
 *   0 — all chunks under the ceiling (or chunk absent — see SOFT mode)
 *   1 — at least one chunk exceeded
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const DIST_DIR = resolve(HERE, '..', 'dist', 'assets')
const MAX_GZIPPED_BYTES = 8192 // 8 KB

const TARGETS = [
  {
    name: 'ForgotPasswordPage',
    pattern: /^ForgotPasswordPage-[\w-]+\.js$/,
  },
  {
    name: 'ResetPasswordPage',
    pattern: /^ResetPasswordPage-[\w-]+\.js$/,
  },
  {
    name: 'InviteAcceptancePage',
    pattern: /^InviteAcceptancePage-[\w-]+\.js$/,
  },
]

if (!existsSync(DIST_DIR)) {
  console.error(
    `check-chunk-size: dist/assets/ not found at ${DIST_DIR} — run \`npm run build\` first`,
  )
  process.exit(1)
}

const files = readdirSync(DIST_DIR)
let failed = false
let checked = 0

for (const target of TARGETS) {
  const matches = files.filter((f) => target.pattern.test(f))
  if (matches.length === 0) {
    console.error(
      `check-chunk-size: ${target.name} chunk missing from dist/assets/ — build artifact incomplete`,
    )
    failed = true
    continue
  }
  for (const f of matches) {
    const raw = readFileSync(resolve(DIST_DIR, f))
    const gz = gzipSync(raw)
    const ok = gz.length <= MAX_GZIPPED_BYTES
    checked += 1
    const label = ok ? 'OK' : 'FAIL'
    console.log(
      `check-chunk-size: ${label} ${f} — ${gz.length} bytes gzipped (ceiling ${MAX_GZIPPED_BYTES})`,
    )
    if (!ok) failed = true
  }
}

if (checked === 0) {
  console.error('check-chunk-size: no target chunks matched — TARGETS is empty?')
  process.exit(1)
}

if (failed) {
  console.error(
    `check-chunk-size: at least one chunk exceeded the ${MAX_GZIPPED_BYTES}-byte gzip ceiling`,
  )
  process.exit(1)
}

console.log(`check-chunk-size: all ${checked} chunks under the ceiling`)
