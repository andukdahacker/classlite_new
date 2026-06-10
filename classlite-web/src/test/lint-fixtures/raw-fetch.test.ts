/// <reference types="node" />
/**
 * AC8 — raw `fetch` is forbidden in src/features/**.
 *
 * Mirrors the 1-7a bad-hex unit fixture pattern. Lints the fixture text
 * with the project's flat config and a `filePath` aliased into
 * `src/features/...` so the AC8 override matches.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../../../')
const FIXTURE_CODE = "export function bad() { return fetch('/api/x') }\n"

describe('AC8 raw fetch rule', () => {
  test('no-restricted-globals fires on raw fetch in a feature file', async () => {
    const eslint = new ESLint({
      cwd: PROJECT_ROOT,
      overrideConfigFile: resolve(PROJECT_ROOT, 'eslint.config.js'),
    })
    const results = await eslint.lintText(FIXTURE_CODE, {
      filePath: resolve(PROJECT_ROOT, 'src/features/test/RawFetchPage.tsx'),
    })
    const messages = results[0].messages
    const hit = messages.find((m) => m.ruleId === 'no-restricted-globals')
    expect(hit, 'no-restricted-globals must fire on raw fetch').toBeTruthy()
    expect(hit!.message).toMatch(/Direct fetch is forbidden/)
  })

  test('the rule does NOT fire on lib/ — that tier is the only legitimate fetch consumer', async () => {
    const eslint = new ESLint({
      cwd: PROJECT_ROOT,
      overrideConfigFile: resolve(PROJECT_ROOT, 'eslint.config.js'),
    })
    const results = await eslint.lintText(FIXTURE_CODE, {
      filePath: resolve(PROJECT_ROOT, 'src/lib/api-fetch.ts'),
    })
    const messages = results[0].messages
    const hit = messages.find((m) => m.ruleId === 'no-restricted-globals')
    expect(
      hit,
      'no-restricted-globals must NOT fire on lib/ files',
    ).toBeUndefined()
  })
})
