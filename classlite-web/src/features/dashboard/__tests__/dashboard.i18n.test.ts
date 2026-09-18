// ATDD RED-PHASE — Story 8-1b, Task 9 (i18n parity). AC18.
//
// RED NATURE: all imports resolve, so this file is RUNTIME-red — the net-new
// dashboard.* keys do not exist in en.json / vi.json yet, so the assertions
// fail until Task 9 lands. No `test.skip()` ([[reference_atdd_red_convention]]).
//
// UX-2: Vietnamese is co-primary — every net-new string MUST exist in BOTH
// en.json AND vi.json in the same change. The global i18n-parity-coverage test
// enforces en↔vi symmetry; this focused test asserts the specific 8-1b key
// FAMILIES are present in both locales (a representative key per family).
import { describe, expect, test } from 'vitest'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'

const enKeys = en as Record<string, string>
const viKeys = vi as Record<string, string>

// Representative net-new keys per family (dashboard.{teacher,owner,student,
// weekStrip,atRisk.reason,capacity,welcome}.*). The dev may add more; these
// anchor each family's existence in both locales.
const REQUIRED_KEYS = [
  'dashboard.teacher.viewAll',
  'dashboard.teacher.glanceDisclaimer',
  'dashboard.teacher.retry',
  'dashboard.owner.pulseTitle',
  'dashboard.owner.todayTitle',
  'dashboard.owner.needsAttentionTitle',
  'dashboard.student.glanceDisclaimer',
  'dashboard.student.dueSoonTitle',
  'dashboard.weekStrip.next',
  'dashboard.atRisk.reason.attendance_below_floor',
  'dashboard.atRisk.reason.consecutive_missed',
  'dashboard.atRisk.reason.band_drop',
  'dashboard.capacity.label',
  'dashboard.welcome.headline',
] as const

describe('8-1b i18n — dashboard.* key families exist in en + vi (AC18, UX-2)', () => {
  test.each(REQUIRED_KEYS)('P1 "%s" exists in en.json', (key) => {
    expect(enKeys[key]).toBeTruthy()
  })

  test.each(REQUIRED_KEYS)('P1 "%s" exists in vi.json (co-primary)', (key) => {
    expect(viKeys[key]).toBeTruthy()
  })

  test('P1 no dashboard.* key is present in one locale but missing in the other', () => {
    const dashEn = Object.keys(enKeys).filter((k) => k.startsWith('dashboard.'))
    const dashVi = Object.keys(viKeys).filter((k) => k.startsWith('dashboard.'))
    const missingInVi = dashEn.filter((k) => !(k in viKeys))
    const missingInEn = dashVi.filter((k) => !(k in enKeys))
    expect({ missingInVi, missingInEn }).toEqual({ missingInVi: [], missingInEn: [] })
  })
})
