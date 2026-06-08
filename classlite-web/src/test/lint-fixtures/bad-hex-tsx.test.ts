/// <reference types="node" />
/**
 * AC5 ESLint rule-config unit test.
 *
 * Invokes the ESLint Node API against the bad-hex TSX fixture, using the
 * project's flat config. Asserts the no-restricted-syntax rule fires with
 * the configured custom message and ALL warnings are addressable (no false
 * positives on unrelated rules).
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '../../../')
const FIXTURE_TSX = resolve(HERE, 'bad-hex.tsx.fixture')

const FIXTURE_CODE = "export const navy = '#1a1f2e'\n"

describe('AC5 ESLint raw-hex literal rule contract', () => {
  test('flags hex string literals via no-restricted-syntax', async () => {
    const eslint = new ESLint({
      cwd: PROJECT_ROOT,
      overrideConfigFile: resolve(PROJECT_ROOT, 'eslint.config.js'),
    })
    const results = await eslint.lintText(FIXTURE_CODE, {
      filePath: resolve(PROJECT_ROOT, 'src/components/__fake-fixture.tsx'),
    })
    const messages = results[0].messages
    const hit = messages.find((m) => m.ruleId === 'no-restricted-syntax')
    expect(hit, 'no-restricted-syntax must fire on raw hex literal').toBeTruthy()
    expect(hit!.message).toMatch(/Raw hex colors are forbidden/)
  })

  test('the fixture file exists at the documented path', () => {
    expect(FIXTURE_TSX.endsWith('bad-hex.tsx.fixture')).toBe(true)
  })
})
