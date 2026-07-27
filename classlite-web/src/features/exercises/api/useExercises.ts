/**
 * useExercises — Story 4.1 role-scoped, filtered, paginated exercise list
 * (AC1/AC2). Uses apiFetchWithMeta (not apiFetch) so `meta.pagination` +
 * `meta.skillCounts` survive the envelope unwrap. `keepPreviousData` keeps the
 * table from flickering to empty on a page/filter change (Winston).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta } from '@/lib/api-fetch'
import {
  exerciseKeys,
  type ExerciseListParams,
  type ExerciseListScope,
} from './exercisesKeys'

export type ExerciseListItem = components['schemas']['ExerciseListItem']
export type ExerciseSkill = components['schemas']['ExerciseSkill']
type ListMeta = components['schemas']['EnvelopeMetaPaginated']
export type PaginationMeta = components['schemas']['PaginationMeta']
export type SkillCount = components['schemas']['SkillCount']

const STALE_TIME_MS = 30 * 1000

export interface ExerciseListResult {
  items: ExerciseListItem[]
  pagination: PaginationMeta
  skillCounts: SkillCount[]
}

function buildQueryString(params: ExerciseListParams): string {
  const search = new URLSearchParams()
  search.set('page', String(params.page))
  search.set('pageSize', String(params.pageSize))
  if (params.skill) search.set('skill', params.skill)
  if (params.tag) search.set('tag', params.tag)
  if (params.band != null) search.set('band', String(params.band))
  return search.toString()
}

export function useExercises(
  centerId: string | null | undefined,
  scope: ExerciseListScope,
  params: ExerciseListParams,
) {
  return useQuery({
    queryKey: centerId
      ? exerciseKeys.list(centerId, scope, params)
      : exerciseKeys.listDisabled(),
    queryFn: async (): Promise<ExerciseListResult> => {
      const envelope = await apiFetchWithMeta<ExerciseListItem[], ListMeta>(
        `/api/exercises?${buildQueryString(params)}`,
      )
      return {
        items: envelope.data,
        pagination: envelope.meta.pagination,
        skillCounts: envelope.meta.skillCounts,
      }
    },
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
    placeholderData: keepPreviousData,
  })
}
