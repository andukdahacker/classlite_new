/**
 * useQuestionActions — TanStack mutations for the anchored Q&A feature (Story
 * 7.4b, AC3/AC8/AC9/AC10/AC11/AC15). Cloned from useEnrolmentActions: every
 * write is NON-OPTIMISTIC (the server truths role scope + resolve state) and
 * invalidates by the `questionsKeys.all` prefix on success. Mutation bodies are
 * the stable 7-4a wire types (TS-2). ApiError surfaces the UX-1 error state.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { questionsKeys } from './questionsKeys'
import type { Question, QuestionReply } from './useQuestions'

export type AskQuestionRequest = components['schemas']['AskQuestionRequest']
export type ReplyRequest = components['schemas']['ReplyRequest']
export type ResolveQuestionRequest =
  components['schemas']['ResolveQuestionRequest']
export type BatchReplyRequest = components['schemas']['BatchReplyRequest']

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** POST /api/questions — student asks (201). AC3. */
export function useAskQuestion() {
  const queryClient = useQueryClient()
  return useMutation<Question, ApiError, AskQuestionRequest>({
    mutationKey: questionsKeys.askMutation(),
    mutationFn: (body) =>
      apiFetch<Question>('/api/questions', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionsKeys.all })
    },
  })
}

/** POST /api/questions/{id}/replies — teacher reply, optional resolve (201). AC8/AC9. */
export function useReplyToQuestion() {
  const queryClient = useQueryClient()
  return useMutation<
    QuestionReply,
    ApiError,
    { questionId: string; body: ReplyRequest }
  >({
    mutationKey: questionsKeys.replyMutation(),
    mutationFn: ({ questionId, body }) =>
      apiFetch<QuestionReply>(`/api/questions/${questionId}/replies`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionsKeys.all })
    },
  })
}

export interface ResolveResult {
  id: string
  status: string
}

/** PATCH /api/questions/{id} — one-way resolve (200). AC11. */
export function useResolveQuestion() {
  const queryClient = useQueryClient()
  return useMutation<ResolveResult, ApiError, string>({
    mutationKey: questionsKeys.resolveMutation(),
    mutationFn: (questionId) =>
      apiFetch<ResolveResult>(`/api/questions/${questionId}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify({ status: 'resolved' } satisfies ResolveQuestionRequest),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionsKeys.all })
    },
  })
}

/**
 * POST /api/questions/batch-reply — one reply per listed question, all-or-nothing
 * (201, max 50). AC10. Any 404 (a question the teacher doesn't teach) throws with
 * NO local mutation — the component never renders a partial-success UI.
 */
export function useBatchReply() {
  const queryClient = useQueryClient()
  return useMutation<QuestionReply[], ApiError, BatchReplyRequest>({
    mutationKey: questionsKeys.batchReplyMutation(),
    mutationFn: (body) =>
      apiFetch<QuestionReply[]>('/api/questions/batch-reply', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionsKeys.all })
    },
  })
}
