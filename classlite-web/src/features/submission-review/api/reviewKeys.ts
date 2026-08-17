/**
 * reviewKeys — TanStack Query key factory for the submission-review feature
 * (Story 5.5a, TS-3). Hierarchical so `invalidateQueries({ queryKey: reviewKeys.all })`
 * drops both the result read and the on-demand audio mint for a review page.
 */
export const reviewKeys = {
  all: ['submissionReview'] as const,
  detail: (assignmentId: string) =>
    [...reviewKeys.all, 'detail', assignmentId] as const,
  audio: (assignmentId: string) =>
    [...reviewKeys.all, 'audio', assignmentId] as const,
}
