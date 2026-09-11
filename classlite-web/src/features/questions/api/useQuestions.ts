/**
 * useQuestions — no-loader TanStack Query reads for the anchored Q&A feature
 * (Story 7.4b, AC4/AC6/AC15). ZERO loader-prefetch: the component owns the UX-1
 * trilogy (loading/empty/error). Generated wire types from '@/lib/api/client'
 * (TS-2 — never used as form state). Paginated list → apiFetchWithMeta; single
 * thread → apiFetch (envelope unwrapped, TS-4).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, apiFetchWithMeta } from '@/lib/api-fetch'
import { questionsKeys, type QuestionListParams } from './questionsKeys'

export type Question = components['schemas']['Question']
export type QuestionReply = components['schemas']['QuestionReply']
export type QuestionThread = components['schemas']['QuestionThread']
export type QuestionAnchor = components['schemas']['QuestionAnchor']
export type QuestionStatus = components['schemas']['QuestionStatus']
export type QuestionVisibility = components['schemas']['QuestionVisibility']
export type QuestionAnchorType = components['schemas']['QuestionAnchorType']
export type EnvelopeMetaPagination =
  components['schemas']['EnvelopeMetaPagination']
export type PaginationMeta = components['schemas']['PaginationMeta']

const STALE_TIME_MS = 30 * 1000
export const QUESTIONS_PAGE_SIZE = 20

function listPath(params: QuestionListParams): string {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('page_size', String(QUESTIONS_PAGE_SIZE))
  if (params.exerciseId) search.set('exercise_id', params.exerciseId)
  if (params.classId) search.set('class_id', params.classId)
  if (params.status) search.set('status', params.status)
  if (params.unanswered) search.set('unanswered', 'true')
  return `/api/questions?${search.toString()}`
}

/**
 * GET /api/questions — role-scoped list (AC6). Teacher → own classes; student →
 * own; owner/admin → empty envelope (never 403). Paginated.
 */
export function useQuestions(params: QuestionListParams) {
  return useQuery({
    queryKey: questionsKeys.list(params),
    queryFn: () =>
      apiFetchWithMeta<Question[], EnvelopeMetaPagination>(listPath(params)),
    staleTime: STALE_TIME_MS,
    placeholderData: keepPreviousData,
  })
}

/**
 * GET /api/questions/{id} — one thread + reader-scoped replies (AC4/AC5). A
 * thread the caller cannot see 404s (ApiError) — the component renders the
 * error state. `enabled` guards an absent id (closed panel).
 */
export function useQuestionThread(questionId: string | null) {
  return useQuery({
    queryKey: questionsKeys.thread(questionId ?? ''),
    queryFn: () => apiFetch<QuestionThread>(`/api/questions/${questionId}`),
    staleTime: STALE_TIME_MS,
    enabled: questionId !== null && questionId !== '',
  })
}
