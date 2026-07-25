/** Story 2.7 — serializeCsv RFC 4180 escaping (the error-report CSV, AC5). */
import { describe, expect, test } from 'vitest'
import { serializeCsv } from '../downloadCsv'

describe('serializeCsv', () => {
  test('joins a header + rows with CRLF line endings', () => {
    const out = serializeCsv(['row', 'email', 'reason'], [['1', 'a@b.com', 'INVALID_EMAIL']])
    expect(out).toBe('row,email,reason\r\n1,a@b.com,INVALID_EMAIL')
  })

  test('escapes cells containing commas, quotes, or newlines', () => {
    const out = serializeCsv(
      ['email', 'reason'],
      [['x@y.com', 'has, comma'], ['z@w.com', 'has "quote"'], ['n@l.com', 'has\nnewline']],
    )
    expect(out).toContain('"has, comma"')
    expect(out).toContain('"has ""quote"""')
    expect(out).toContain('"has\nnewline"')
  })

  // Code review (FB4) — CSV formula injection: a failed-row email is attacker
  // text; a leading = + - @ must be neutralized so a spreadsheet treats it as
  // text, not a live formula.
  test('neutralizes formula-injection cells with a leading quote', () => {
    const out = serializeCsv(
      ['email', 'reason'],
      [['=HYPERLINK("x")', 'INVALID_EMAIL'], ['+1', 'a'], ['-2', 'b'], ['@ref', 'c']],
    )
    expect(out).toContain("'=HYPERLINK")
    expect(out).toContain("'+1")
    expect(out).toContain("'-2")
    expect(out).toContain("'@ref")
  })
})
