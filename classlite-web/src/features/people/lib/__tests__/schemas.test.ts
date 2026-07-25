/** Story 2.7 code review (FB3) — client-side file-size guard on the import
 * picker so an oversize file is rejected before a presigned PUT streams it. */
import { describe, expect, test } from 'vitest'
import { importFileSchema, MAX_IMPORT_FILE_BYTES } from '../schemas'

function fileOfSize(name: string, size: number): File {
  const file = new File(['x'], name, { type: 'text/csv' })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('importFileSchema', () => {
  test('rejects a file over the size cap with the fileTooLarge i18n key', () => {
    const result = importFileSchema.safeParse(fileOfSize('big.csv', MAX_IMPORT_FILE_BYTES + 1))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('people.import.errors.fileTooLarge')
    }
  })

  test('accepts a file exactly at the cap', () => {
    const result = importFileSchema.safeParse(fileOfSize('ok.csv', MAX_IMPORT_FILE_BYTES))
    expect(result.success).toBe(true)
  })

  test('rejects a wrong extension (type gate wins over size)', () => {
    const result = importFileSchema.safeParse(fileOfSize('notes.txt', 10))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('people.import.errors.wrongType')
    }
  })
})
