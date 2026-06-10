/// <reference types="node" />
/**
 * AC8 — axios import is forbidden in src/features/**.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../../../')
const FIXTURE_CODE = "import axios from 'axios'\nexport const client = axios\n"

describe('AC8 axios import rule', () => {
  test('no-restricted-imports fires on an axios import in a feature file', async () => {
    const eslint = new ESLint({
      cwd: PROJECT_ROOT,
      overrideConfigFile: resolve(PROJECT_ROOT, 'eslint.config.js'),
    })
    const results = await eslint.lintText(FIXTURE_CODE, {
      filePath: resolve(PROJECT_ROOT, 'src/features/test/AxiosPage.tsx'),
    })
    const messages = results[0].messages
    const hit = messages.find((m) => m.ruleId === 'no-restricted-imports')
    expect(
      hit,
      'no-restricted-imports must fire on `import axios`',
    ).toBeTruthy()
    expect(hit!.message).toMatch(/axios is forbidden/)
  })

  test('the rule does NOT fire on hook files when no axios is imported', async () => {
    const eslint = new ESLint({
      cwd: PROJECT_ROOT,
      overrideConfigFile: resolve(PROJECT_ROOT, 'eslint.config.js'),
    })
    const results = await eslint.lintText("export const x = 1\n", {
      filePath: resolve(PROJECT_ROOT, 'src/hooks/useNoop.ts'),
    })
    const messages = results[0].messages
    const hit = messages.find((m) => m.ruleId === 'no-restricted-imports')
    expect(hit, 'no-restricted-imports should not fire without axios').toBeUndefined()
  })
})
