/// <reference types="node" />
/**
 * AC5 stylelint rule-config unit test.
 *
 * Loads the dashboard's `.stylelintrc.json` programmatically and lints the
 * paired `.fixture` files using stylelint's Node API. Asserts the raw-hex
 * rule fires on the CSS fixture and stays silent on the canonical
 * tokens.css path (positive control + negative control).
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import stylelint from 'stylelint'
import { describe, expect, test } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = resolve(HERE, '../../../.stylelintrc.json')
const FIXTURE_BAD_CSS = resolve(HERE, 'bad-hex.css.fixture')
const TOKENS_CSS = resolve(HERE, '../../tokens.css')

const stylelintConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

describe('AC5 stylelint raw-hex rule contract', () => {
  test('flags raw hex in src CSS (non-tokens) with the configured message', async () => {
    const code = readFileSync(FIXTURE_BAD_CSS, 'utf8')
    const result = await stylelint.lint({
      code,
      // codeFilename simulates a real CSS file under src/ — anywhere that's
      // NOT tokens.css. ignoreFiles in the config matches tokens.css only.
      codeFilename: resolve(HERE, '../../../src/components/__fake-fixture.css'),
      config: stylelintConfig,
    })

    expect(result.errored, 'fixture should fail the raw-hex rule').toBe(true)
    const warnings = result.results.flatMap((r) => r.warnings)
    expect(warnings.length).toBeGreaterThan(0)
    const colorRuleHit = warnings.some((w) => w.rule === 'color-no-hex')
    expect(colorRuleHit, 'color-no-hex rule must fire on raw hex').toBe(true)
    const customMessage = warnings.some((w) =>
      w.text.includes('--cl-* design token'),
    )
    expect(customMessage, 'the custom AC5 rule message must surface').toBe(true)
  })

  test('exempts tokens.css from the raw-hex rule (negative control)', async () => {
    const code = readFileSync(TOKENS_CSS, 'utf8')
    const result = await stylelint.lint({
      code,
      codeFilename: TOKENS_CSS,
      config: stylelintConfig,
    })
    const warnings = result.results.flatMap((r) => r.warnings)
    const colorRuleHit = warnings.some((w) => w.rule === 'color-no-hex')
    expect(
      colorRuleHit,
      'tokens.css should be exempt from color-no-hex',
    ).toBe(false)
  })
})
