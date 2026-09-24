// ATDD RED-PHASE fixtures + MSW handlers for Story 8-2b — the analytics
// frontend slice over the DONE 8-2a backend: GET /api/analytics (role-scoped
// home) and GET /api/analytics/classes/{id} (class performance).
//
// This file is VALID TypeScript on its own and imports the ALREADY-SHIPPED
// generated 8-2a wire types (`components['schemas']['Analytics*' | 'Class*' |
// 'SkillHeatmap*' | 'MistakePattern*' | 'BandOverTimePoint' | 'SubmissionRate']`
// from '@/lib/api/client'). Typing the fixtures against the generated shapes is
// deliberate: it is the D1 PROVISIONAL→final contract co-finalization guard —
// if any 8-2a analytics shape drifts under the codegen re-run (Task 1 strips the
// PROVISIONAL markers), these fixtures stop compiling, surfacing the drift
// BEFORE the UI silently mis-renders. The RED signal for the *.test.tsx
// consumers is the missing modules (AnalyticsRoute / AnalyticsHome /
// ClassPerformanceView / SkillWeekHeatmap / BandTrendChart / the analytics
// lib fns), NOT this file.
//
// Convention: [[reference_atdd_red_convention]] — FE red-phase = import a
// not-yet-existing module → `tsc -b` + Vitest import failure. No `test.skip()`.
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type AnalyticsHome = components['schemas']['AnalyticsHome']
type AnalyticsClassSummary = components['schemas']['AnalyticsClassSummary']
type ClassPerformance = components['schemas']['ClassPerformance']
type BandOverTimePoint = components['schemas']['BandOverTimePoint']
type SkillHeatmap = components['schemas']['SkillHeatmap']
type SkillHeatmapCell = components['schemas']['SkillHeatmapCell']
type MistakePatterns = components['schemas']['MistakePatterns']
type MistakePattern = components['schemas']['MistakePattern']
type AnalyticsAtRiskItem = components['schemas']['AnalyticsAtRiskItem']
type SubmissionRate = components['schemas']['SubmissionRate']
type EnvelopeMeta = components['schemas']['EnvelopeMeta']
type StudentPerformance = components['schemas']['StudentPerformance']
type StudentSubmissionStats = components['schemas']['StudentSubmissionStats']

// ---------------------------------------------------------------------------
// The injected clock (D-notes: analytics reads meta.serverTime like 8-1b — no
// Date.now() in render). Week anchors below are center-tz Mondays.
// ---------------------------------------------------------------------------
export const FIXED_SERVER_TIME = '2026-09-16T10:00:00.000Z'
export const DEFAULT_CENTER_ID = 'c-1'

// The 4 IELTS Writing criteria — the heatmap ROWS (D2). Wire strings.
export const CRITERIA: readonly string[] = [
  'taskResponse',
  'coherenceCohesion',
  'lexicalResource',
  'grammaticalRange',
]

// Dense, contiguous, Monday-anchored weeks — the SHARED x-axis both charts
// consume (D15b / D14d). `skillHeatmap.weeks` ≡ `bandOverTime[].weekStart`.
export const WEEKS: readonly string[] = [
  '2026-08-31',
  '2026-09-07',
  '2026-09-14',
]

// Deterministic ids so negative/absence assertions can name a specific row.
export const CLASS_A_ID = 'cls-analytics-a'
export const CLASS_B_ID = 'cls-analytics-b'
export const AT_RISK_STUDENT_ID = 'stu-at-risk-1'
export const TARGET_BAND = 6.5

// ---------------------------------------------------------------------------
// Envelope helper — apiFetchWithMeta returns { data, meta } (D-notes).
// ---------------------------------------------------------------------------
function envelope<T>(
  data: T,
  serverTime: string = FIXED_SERVER_TIME,
): { data: T; meta: EnvelopeMeta } {
  return { data, meta: { serverTime } }
}

// ---------------------------------------------------------------------------
// Home builders
// ---------------------------------------------------------------------------
export function classSummary(
  overrides: Partial<AnalyticsClassSummary> = {},
): AnalyticsClassSummary {
  return {
    classId: CLASS_A_ID,
    className: 'IELTS Foundation A',
    studentCount: 18,
    avgBand: 6.0,
    atRiskCount: 2,
    onTimeRate: 0.82,
    ...overrides,
  }
}

/** Teacher home — own classes only, one card with a NULL mini-stat (R-C). */
export const teacherHomeData: AnalyticsHome = {
  role: 'teacher',
  classes: [
    classSummary(),
    // avgBand + onTimeRate null → must render "—", NEVER 0 (R-C / D13).
    classSummary({
      classId: CLASS_B_ID,
      className: 'IELTS Foundation B',
      studentCount: 12,
      avgBand: null,
      atRiskCount: 0,
      onTimeRate: null,
    }),
  ],
}

export const ownerHomeData: AnalyticsHome = {
  role: 'owner',
  classes: [classSummary(), classSummary({ classId: CLASS_B_ID, className: 'IELTS Advanced B' })],
}

export const adminHomeData: AnalyticsHome = { ...ownerHomeData, role: 'admin' }

/** Empty classes — the D12 owner (teacher with no classes / fresh center). */
export const teacherHomeEmpty: AnalyticsHome = { role: 'teacher', classes: [] }

// ---------------------------------------------------------------------------
// Class-performance builders
// ---------------------------------------------------------------------------
function heatmapCell(
  criterion: string,
  weekStart: string,
  avgBand: number | null,
  sampleCount: number,
): SkillHeatmapCell {
  return { criterion, weekStart, avgBand, sampleCount }
}

/** Dense matrix; one NULL cell (avgBand null, sampleCount 0) that must render
 *  distinctly from a graded cell (AC22a). Bands chosen so distance-from-target
 *  monotonicity is observable: (taskResponse,wk2)=6.5 AT target (pale),
 *  (grammaticalRange,wk0)=3.0 FAR from target (saturated). */
export function skillHeatmap(overrides: Partial<SkillHeatmap> = {}): SkillHeatmap {
  const cells: SkillHeatmapCell[] = []
  for (const criterion of CRITERIA) {
    for (const weekStart of WEEKS) {
      cells.push(heatmapCell(criterion, weekStart, 6.0, 5))
    }
  }
  // The NULL cell — no grade this week for taskResponse@wk0.
  cells[0] = heatmapCell('taskResponse', WEEKS[0], null, 0)
  // An AT-target cell (pale) and a FAR-from-target cell (saturated).
  cells[2] = heatmapCell('taskResponse', WEEKS[2], TARGET_BAND, 6) // |6.5-6.5|=0
  cells[9] = heatmapCell('grammaticalRange', WEEKS[0], 3.0, 4) // |3.0-6.5|=3.5
  return { criteria: [...CRITERIA], weeks: [...WEEKS], cells, ...overrides }
}

/** Band-over-time — dense weeks; MIDDLE week null → the line must GAP, not
 *  plot 0 (AC15). */
export function bandOverTime(): BandOverTimePoint[] {
  return [
    { weekStart: WEEKS[0], avgBand: 5.5, submissionCount: 14 },
    { weekStart: WEEKS[1], avgBand: null, submissionCount: 0 }, // GAP, never 0
    { weekStart: WEEKS[2], avgBand: 6.5, submissionCount: 16 },
  ]
}

export function mistakePattern(overrides: Partial<MistakePattern> = {}): MistakePattern {
  return {
    skillSource: 'writing',
    criterion: 'coherenceCohesion',
    questionType: null,
    type: 'error',
    instanceCount: 23,
    affectedStudentCount: 9,
    trend: 'worsening',
    patternSource: 'human_comment',
    exampleQuote: null,
    exampleNote: null,
    ...overrides,
  }
}

export function mistakePatterns(overrides: Partial<MistakePatterns> = {}): MistakePatterns {
  return {
    coveredSources: ['writing', 'speaking'],
    // D12 (8-3b) — auto_graded answer_errors are now mined on BOTH surfaces, so the
    // real backend returns []; tests that exercise the excluded-note branch pass an
    // explicit ['auto_graded'] override.
    excludedSources: [],
    patterns: [
      mistakePattern(),
      // The calm `type='praise'` variant → "Strength" row (D16a).
      mistakePattern({
        skillSource: 'speaking',
        criterion: 'lexicalResource',
        type: 'praise',
        instanceCount: 11,
        affectedStudentCount: 7,
        trend: 'improving',
      }),
    ],
    ...overrides,
  }
}

export function atRiskItem(overrides: Partial<AnalyticsAtRiskItem> = {}): AnalyticsAtRiskItem {
  return {
    studentId: AT_RISK_STUDENT_ID,
    name: 'Tran Binh',
    attendanceRate: 0.62,
    overallBand: 5.5,
    // reasons enum MUST match dashboard.atRisk.reason.* keys exactly (D9).
    reasons: ['attendance_below_floor', 'band_drop'],
    ...overrides,
  }
}

export function submissionRate(overrides: Partial<SubmissionRate> = {}): SubmissionRate {
  return { onTimeCount: 8, totalDue: 10, rate: 0.8, ...overrides }
}

export function classPerformance(overrides: Partial<ClassPerformance> = {}): ClassPerformance {
  return {
    classId: CLASS_A_ID,
    className: 'IELTS Foundation A',
    targetBand: TARGET_BAND,
    cohortAvgBand: 6.0,
    cohortAvgDelta: 0.3,
    onTimeSubmissionRate: 0.8,
    atRiskCount: 1,
    hasWritingContent: true,
    bandOverTime: bandOverTime(),
    skillHeatmap: skillHeatmap(),
    mistakePatterns: mistakePatterns(),
    atRiskStudents: [atRiskItem()],
    submissionRate: submissionRate(),
    ...overrides,
  }
}

export const classPerformanceData = classPerformance()

/** targetBand null → D11 fallback across heatmap/sparkline/tile/affordance. */
export const classPerformanceNoTarget = classPerformance({ targetBand: null })

/** hasWritingContent false → heatmap zone shows the DR-D "covers Writing" copy,
 *  NOT an empty 4×N grid (AC14 / D14c). */
export const classPerformanceNoWriting = classPerformance({
  hasWritingContent: false,
  skillHeatmap: { criteria: [...CRITERIA], weeks: [...WEEKS], cells: [] },
})

/** Every nullable field null → the 4-up stats + zones must render "—", not 0. */
export const classPerformanceAllNull = classPerformance({
  targetBand: null,
  cohortAvgBand: null,
  cohortAvgDelta: null,
  onTimeSubmissionRate: null,
  submissionRate: submissionRate({ onTimeCount: 0, totalDue: 0, rate: null }),
})

/** 0-point trend → empty-zone; 1-point trend → a dot (D14b, AC15). */
export const classPerformanceZeroTrend = classPerformance({ bandOverTime: [] })
export const classPerformanceOneTrend = classPerformance({
  bandOverTime: [{ weekStart: WEEKS[0], avgBand: 6.0, submissionCount: 10 }],
})

/** Empty mistakes / at-risk with non-empty coveredSources → per-zone empty
 *  states distinct from the excluded-source note (AC18/19). */
export const classPerformanceEmptyZones = classPerformance({
  mistakePatterns: mistakePatterns({ patterns: [] }),
  atRiskStudents: [],
})

// ---------------------------------------------------------------------------
// Handlers — GET /api/analytics (home) + GET /api/analytics/classes/:id
// ---------------------------------------------------------------------------
export function homeHandlers(data: AnalyticsHome, serverTime: string = FIXED_SERVER_TIME) {
  return [http.get('/api/analytics', () => HttpResponse.json(envelope(data, serverTime)))]
}

export const teacherHomeHandlers = homeHandlers(teacherHomeData)
export const ownerHomeHandlers = homeHandlers(ownerHomeData)
export const adminHomeHandlers = homeHandlers(adminHomeData)
export const teacherHomeEmptyHandlers = homeHandlers(teacherHomeEmpty)

export function classPerfHandlers(
  data: ClassPerformance,
  serverTime: string = FIXED_SERVER_TIME,
) {
  return [
    http.get('/api/analytics/classes/:id', () => HttpResponse.json(envelope(data, serverTime))),
  ]
}

export const classPerfDefaultHandlers = classPerfHandlers(classPerformanceData)

/** 500 on the home read — drives the inline role="alert" + retry trilogy. */
export const home500Handlers = [
  http.get('/api/analytics', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-an-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** 500 on the class read — per-zone error trilogy (AC22). */
export const classPerf500Handlers = [
  http.get('/api/analytics/classes/:id', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-cp-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** 404 CLASS_NOT_FOUND — teacher-not-owner or non-existent id → inline
 *  not-found, never a raw error / partial payload (AC11, non-disclosure D4). */
export const classPerf404Handlers = [
  http.get('/api/analytics/classes/:id', () =>
    HttpResponse.json(
      { error: { code: 'CLASS_NOT_FOUND', message: 'not found', requestId: 'req-cp-404', details: null } },
      { status: 404 },
    ),
  ),
]

// ---------------------------------------------------------------------------
// Student-performance builders (Story 8-3b) — GET /api/analytics/students/:id
// (teacher framing) + GET /api/analytics/me (student framing, peer fields
// stripped). The `framing` discriminator drives ALL softening (D5).
// ---------------------------------------------------------------------------
export const STUDENT_ID = 'stu-analytics-1'

export function studentSubmissionStats(
  overrides: Partial<StudentSubmissionStats> = {},
): StudentSubmissionStats {
  return {
    submissionRate: { onTimeCount: 8, totalDue: 10, rate: 0.8 },
    totalSubmissionCount: 12,
    gradedSubmissionCount: 9,
    praisePinCount: 4,
    errorPinCount: 6,
    hasData: {
      bandProgression: true,
      skillBreakdown: true,
      mistakePatterns: true,
      submissionStats: true,
    },
    ...overrides,
  }
}

/** Teacher `/students/{id}` — carries the peer fields (classAvgBand,
 *  affectedStudentCount). A middle-week null band → the trend GAPs (never 0). */
export function studentPerformance(
  overrides: Partial<StudentPerformance> = {},
): StudentPerformance {
  return {
    studentId: STUDENT_ID,
    studentName: 'Nguyen An',
    framing: 'teacher',
    classId: CLASS_A_ID,
    targetBand: TARGET_BAND,
    submissionStats: studentSubmissionStats(),
    skillBreakdown: [
      {
        skill: 'writing',
        overallBand: 5.5,
        classAvgBand: 6.0,
        criteria: [{ criterion: 'coherenceCohesion', avgBand: 5.5 }],
      },
      { skill: 'reading', overallBand: 6.5, classAvgBand: 6.0, criteria: [] },
    ],
    bandProgression: [
      {
        skill: 'writing',
        points: [
          { weekStart: WEEKS[0], avgBand: 5.0, submissionCount: 2 },
          { weekStart: WEEKS[1], avgBand: null, submissionCount: 0 }, // GAP
          { weekStart: WEEKS[2], avgBand: 5.5, submissionCount: 3 },
        ],
      },
    ],
    mistakePatterns: mistakePatterns(),
    ...overrides,
  }
}

/** Student `/me` — the backend STRIPS peer fields service-side (classAvgBand
 *  null, affectedStudentCount null) and sets framing "student" (FR-50, D5). */
export function myPerformance(
  overrides: Partial<StudentPerformance> = {},
): StudentPerformance {
  return studentPerformance({
    framing: 'student',
    skillBreakdown: [
      { skill: 'writing', overallBand: 5.5, classAvgBand: null, criteria: [] },
      { skill: 'reading', overallBand: 6.5, classAvgBand: null, criteria: [] },
    ],
    mistakePatterns: mistakePatterns({
      patterns: [
        mistakePattern({
          affectedStudentCount: null,
          exampleQuote: 'Your conclusion restates the intro.',
          exampleNote: 'Try a forward-looking final sentence.',
        }),
      ],
    }),
    ...overrides,
  })
}

export function studentPerfHandlers(
  data: StudentPerformance,
  serverTime: string = FIXED_SERVER_TIME,
) {
  return [
    http.get('/api/analytics/students/:id', () =>
      HttpResponse.json(envelope(data, serverTime)),
    ),
  ]
}

export function myPerfHandlers(
  data: StudentPerformance,
  serverTime: string = FIXED_SERVER_TIME,
) {
  return [http.get('/api/analytics/me', () => HttpResponse.json(envelope(data, serverTime)))]
}

/** 500 on the student read → the single-aggregate view blanks + inline retry. */
export const studentPerf500Handlers = [
  http.get('/api/analytics/students/:id', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-sp-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** 404 STUDENT_NOT_FOUND — teacher out of scope (non-disclosure D4/D5). */
export const studentPerf404Handlers = [
  http.get('/api/analytics/students/:id', () =>
    HttpResponse.json(
      { error: { code: 'STUDENT_NOT_FOUND', message: 'not found', requestId: 'req-sp-404', details: null } },
      { status: 404 },
    ),
  ),
]

/** 403 INSUFFICIENT_ROLE — a student who somehow reaches the teacher route. */
export const studentPerf403Handlers = [
  http.get('/api/analytics/students/:id', () =>
    HttpResponse.json(
      { error: { code: 'INSUFFICIENT_ROLE', message: 'forbidden', requestId: 'req-sp-403', details: null } },
      { status: 403 },
    ),
  ),
]

/** 500 on /me → the student view blanks + inline retry. */
export const myPerf500Handlers = [
  http.get('/api/analytics/me', () =>
    HttpResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'boom', requestId: 'req-me-500', details: null } },
      { status: 500 },
    ),
  ),
]

/** A never-resolving handler is intentionally NOT provided — loading-state
 *  tests assert the skeleton synchronously BEFORE MSW resolves (the
 *  DashboardRoute / StaffListPage precedent: query pending on first paint). */
