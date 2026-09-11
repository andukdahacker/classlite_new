/**
 * questionHandlers — MSW builders for the anchored Q&A feature tests (Story
 * 7.4b), mirroring enrolmentHandlers.ts. Fixtures are built over the generated
 * wire types (TS-2); the ONE mock seam is the HTTP boundary (TEST-FE-1). Every
 * builder takes `Partial<T>` overrides; handler factories accept an optional
 * body-capture callback and an overridable result.
 */
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type Question = components['schemas']['Question']
type QuestionReply = components['schemas']['QuestionReply']
type QuestionThread = components['schemas']['QuestionThread']
type QuestionAnchor = components['schemas']['QuestionAnchor']
type AskQuestionRequest = components['schemas']['AskQuestionRequest']
type ReplyRequest = components['schemas']['ReplyRequest']
type BatchReplyRequest = components['schemas']['BatchReplyRequest']
type PaginationMeta = components['schemas']['PaginationMeta']
type EnvelopeMetaPagination = components['schemas']['EnvelopeMetaPagination']

const SERVER_TIME = '2026-09-10T00:00:00Z'
export const QA_CENTER_ID = '00000000-0000-0000-0000-0000000000c1'
export const QA_EXERCISE_ID = '00000000-0000-0000-0000-0000000000e1'
export const QA_CLASS_ID = '00000000-0000-0000-0000-0000000000a1'
export const QA_STUDENT_ID = '00000000-0000-0000-0000-0000000000d1'
export const QA_QUESTION_ID = '00000000-0000-0000-0000-0000000000f1'

function envelope<T>(data: T): { data: T; meta: { serverTime: string } } {
  return { data, meta: { serverTime: SERVER_TIME } }
}

function pagination(overrides: Partial<PaginationMeta> = {}): PaginationMeta {
  return { page: 1, pageSize: 20, total: 0, totalPages: 1, ...overrides }
}

function listEnvelope(
  data: Question[],
  paginationOverrides: Partial<PaginationMeta> = {},
): { data: Question[]; meta: EnvelopeMetaPagination } {
  return {
    data,
    meta: {
      serverTime: SERVER_TIME,
      pagination: pagination({ total: data.length, ...paginationOverrides }),
    },
  }
}

function errorBody(code: string, requestId: string) {
  return { error: { code, message: `${code} (fixture)`, requestId, details: null } }
}

export function itemAnchor(overrides: Partial<QuestionAnchor> = {}): QuestionAnchor {
  return {
    schemaVersion: 1,
    sectionIndex: 0,
    questionGroupIndex: 0,
    questionIndex: 0,
    charStart: null,
    charEnd: null,
    ...overrides,
  }
}

export function question(overrides: Partial<Question> = {}): Question {
  return {
    id: QA_QUESTION_ID,
    exerciseId: QA_EXERCISE_ID,
    classId: QA_CLASS_ID,
    studentId: QA_STUDENT_ID,
    studentName: 'Asker Student',
    studentAvatarUrl: null,
    anchorType: 'item',
    anchorRef: itemAnchor(),
    anchorExcerpt: 'the wisdom of crowds',
    content: 'Why is the answer B and not C?',
    status: 'open',
    createdAt: '2026-09-10T01:00:00Z',
    ...overrides,
  }
}

export function questionReply(
  overrides: Partial<QuestionReply> = {},
): QuestionReply {
  return {
    id: 'reply-1',
    questionId: QA_QUESTION_ID,
    authorId: '00000000-0000-0000-0000-0000000000b1',
    authorName: 'Teacher One',
    authorAvatarUrl: null,
    content: 'Look again at the second paragraph.',
    visibility: 'shared',
    createdAt: '2026-09-10T02:00:00Z',
    ...overrides,
  }
}

export function questionThread(
  q: Question = question(),
  replies: QuestionReply[] = [],
): QuestionThread {
  return { question: q, replies }
}

// --- list ---

export function listHandlers(
  data: Question[] = [question()],
  paginationOverrides: Partial<PaginationMeta> = {},
) {
  return [
    http.get('/api/questions', () =>
      HttpResponse.json(listEnvelope(data, paginationOverrides)),
    ),
  ]
}

export const listEmptyHandlers = [
  http.get('/api/questions', () => HttpResponse.json(listEnvelope([]))),
]

export const listErrorHandlers = [
  http.get('/api/questions', () => HttpResponse.error()),
]

// --- thread ---

export function threadHandlers(thread: QuestionThread = questionThread()) {
  return [
    http.get(`/api/questions/${thread.question.id}`, () =>
      HttpResponse.json(envelope(thread)),
    ),
  ]
}

export function threadNotFoundHandlers(questionId: string = QA_QUESTION_ID) {
  return [
    http.get(`/api/questions/${questionId}`, () =>
      HttpResponse.json(errorBody('QUESTION_NOT_FOUND', 'req-qa-404'), {
        status: 404,
      }),
    ),
  ]
}

// --- ask ---

export function askHandlers(
  onBody?: (body: AskQuestionRequest) => void,
  result: Question = question({ status: 'open' }),
) {
  return [
    http.post('/api/questions', async ({ request }) => {
      if (onBody) onBody((await request.json()) as AskQuestionRequest)
      return HttpResponse.json(envelope(result), { status: 201 })
    }),
  ]
}

export const askTargetNotFound404 = [
  http.post('/api/questions', () =>
    HttpResponse.json(errorBody('QUESTION_TARGET_NOT_FOUND', 'req-qa-t404'), {
      status: 404,
    }),
  ),
]

// --- reply ---

export function replyHandlers(
  onBody?: (body: ReplyRequest) => void,
  result: QuestionReply = questionReply(),
  questionId: string = QA_QUESTION_ID,
) {
  return [
    http.post(`/api/questions/${questionId}/replies`, async ({ request }) => {
      if (onBody) onBody((await request.json()) as ReplyRequest)
      return HttpResponse.json(envelope(result), { status: 201 })
    }),
  ]
}

// --- resolve ---

export function resolveHandlers(questionId: string = QA_QUESTION_ID) {
  return [
    http.patch(`/api/questions/${questionId}`, () =>
      HttpResponse.json(envelope({ id: questionId, status: 'resolved' })),
    ),
  ]
}

// --- batch reply ---

export function batchReplyHandlers(
  onBody?: (body: BatchReplyRequest) => void,
  result: QuestionReply[] = [questionReply()],
) {
  return [
    http.post('/api/questions/batch-reply', async ({ request }) => {
      if (onBody) onBody((await request.json()) as BatchReplyRequest)
      return HttpResponse.json(envelope(result), { status: 201 })
    }),
  ]
}

export const batchReplyNotFound404 = [
  http.post('/api/questions/batch-reply', () =>
    HttpResponse.json(errorBody('QUESTION_NOT_FOUND', 'req-qa-b404'), {
      status: 404,
    }),
  ),
]
