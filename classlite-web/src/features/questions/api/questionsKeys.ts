/**
 * questionsKeys — TS-3 query-key factory for the anchored Q&A feature (Story
 * 7.4b), cloning the People feature idiom (peopleKeys). Root `['questions']`;
 * every read slot is a function returning `[...all, <group>, ...args] as const`
 * (params last so partial-match invalidation cascades); every mutation slot is
 * `[...all, 'mutation', '<verb>']`. Writes invalidate by the `all` prefix
 * (non-optimistic — the server truths, 7-4a).
 */
export const questionsKeys = {
  all: ['questions'] as const,
  list: (params: QuestionListParams) =>
    [...questionsKeys.all, 'list', params] as const,
  thread: (questionId: string) =>
    [...questionsKeys.all, 'thread', questionId] as const,
  askMutation: () => [...questionsKeys.all, 'mutation', 'ask'] as const,
  replyMutation: () => [...questionsKeys.all, 'mutation', 'reply'] as const,
  resolveMutation: () => [...questionsKeys.all, 'mutation', 'resolve'] as const,
  batchReplyMutation: () =>
    [...questionsKeys.all, 'mutation', 'batchReply'] as const,
} as const

/** List filters (AC6/AC7). Mirrors the backend snake-case query params. */
export interface QuestionListParams {
  page: number
  exerciseId?: string
  classId?: string
  status?: 'open' | 'resolved'
  unanswered?: boolean
}
