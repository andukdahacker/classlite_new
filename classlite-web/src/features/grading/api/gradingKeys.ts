/**
 * gradingKeys — TanStack Query key factory for the teacher Writing grading feature
 * (Story 6.1, TS-3). Hierarchical so `invalidateQueries({ queryKey: gradingKeys.all })`
 * drops the grading read AND the queue for a class after a grade/revise. Mirrors
 * reviewKeys / templateKeys (mutation keys live on the factory too).
 */
export const gradingKeys = {
  all: ['grading'] as const,
  detail: (submissionId: string) =>
    [...gradingKeys.all, 'detail', submissionId] as const,
  queue: (classId: string, assignmentId: string) =>
    [...gradingKeys.all, 'queue', classId, assignmentId] as const,
  gradeMutation: (submissionId: string) =>
    [...gradingKeys.all, 'mutation', 'grade', submissionId] as const,
  reviseMutation: (submissionId: string) =>
    [...gradingKeys.all, 'mutation', 'revise', submissionId] as const,
  // Story 6.2b (T5, FD1): the ai-grade ENQUEUE mutation key. The subsequent
  // poll reuses the shared `jobKeys.detail(jobId)` (['jobs', jobId]) — no new
  // factory member for the poll, so the two ai-grade consumers (this + the
  // 4.3b generation hook) share the one job-poll cache slot.
  aiGradeMutation: (submissionId: string) =>
    [...gradingKeys.all, 'mutation', 'aiGrade', submissionId] as const,
  // Story 6.4b (D2): the objective override + release mutation keys. Their
  // invalidation sets DIFFER (D2/Winston): an override does not change queue
  // membership → invalidate `detail` ONLY; a release flips submitted→graded →
  // invalidate `detail` + `all`. The two keys keep them independently trackable.
  overrideMutation: (submissionId: string) =>
    [...gradingKeys.all, 'mutation', 'override', submissionId] as const,
  releaseMutation: (submissionId: string) =>
    [...gradingKeys.all, 'mutation', 'release', submissionId] as const,
}
