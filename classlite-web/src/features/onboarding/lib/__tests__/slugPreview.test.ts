/**
 * slugifyPreview — Story 2-3a AC5 + Task 2.3.
 *
 * The client-side slug preview MUST match the backend `internal/service/slug.go`
 * output for the 10-entry canonical Vietnamese test set. If the client + server
 * disagree, the wizard lies to the user — the preview promises `X.classlite.app`
 * but the server returns `Y.classlite.app`.
 *
 * The 10-entry canonical set + 30-char length-cap test are lifted verbatim
 * from `classlite-api/internal/service/slug_atdd_test.go:24-65` (Murat-B1
 * party-mode fold — story's original "7 entries" was a factual miscount).
 *
 * IMPORTANT: Any change to this test set MUST land in `slug.go` AND
 * `slug_atdd_test.go` in the same commit. FU-2-3a-H tracks unifying these via
 * a shared JSON fixture.
 *
 * RED phase: this file references `@/features/onboarding/lib/slugPreview` which
 * doesn't exist until Amelia lands Task 2.3. Compile error is the red signal.
 */
import { describe, expect, test } from 'vitest'
import { slugifyPreview } from '@/features/onboarding/lib/slugPreview'

describe('slugifyPreview — AC5 client mirror of backend Slugify', () => {
  const canonicalCases: Array<[string, string]> = [
    ['Trung tâm Anh ngữ Sài Gòn', 'trung-tam-anh-ngu-sai-gon'],
    ['Anh Văn Hội Việt Mỹ', 'anh-van-hoi-viet-my'],
    ['Trường Đại học FPT', 'truong-dai-hoc-fpt'],
    ['ĐH Ngoại Ngữ', 'dh-ngoai-ngu'],
    ['English & Beyond', 'english-beyond'],
    ['   Multi   space   ', 'multi-space'],
    ['!!!', ''],
    ['đại học', 'dai-hoc'],
    ['ĐẠI HỌC', 'dai-hoc'],
    ['Cộng Hòa', 'cong-hoa'],
  ]

  test.each(canonicalCases)(
    'canonical: %s → %s',
    (input, expected) => {
      expect(slugifyPreview(input)).toBe(expected)
    },
  )

  test('length cap: input yielding >30 chars is truncated to 30 with trailing hyphen re-trimmed', () => {
    // A long Vietnamese center name that would produce >30 chars naturally.
    const long =
      'Trung tâm Anh ngữ Sài Gòn Chi Nhánh Quận Một Trung Tâm Chính'
    const result = slugifyPreview(long)
    expect(result.length).toBeLessThanOrEqual(30)
    // No trailing hyphen after truncation
    expect(result.endsWith('-')).toBe(false)
  })

  test('single-word input preserves character', () => {
    expect(slugifyPreview('ClassLite')).toBe('classlite')
  })

  test('empty input returns empty string', () => {
    expect(slugifyPreview('')).toBe('')
    expect(slugifyPreview('   ')).toBe('')
  })

  test('mixed-case ASCII lowercases', () => {
    expect(slugifyPreview('IELTS Academy')).toBe('ielts-academy')
  })

  test('does not include non-ASCII combining marks in output', () => {
    // Result must be pure [a-z0-9-] after all rules apply.
    const result = slugifyPreview('Học Viện Á Châu')
    expect(result).toMatch(/^[a-z0-9-]+$/)
  })
})
