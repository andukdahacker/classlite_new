/**
 * contentSchemas — Story 3.5 hand-written Zod form schemas (openapi-zod-client
 * is disabled; TS-2 keeps form shapes independent of the generated wire types).
 * Notes/materials/exercises are standard RHF forms (FW-8), NOT the writing-editor
 * exemption: explicit submit, zodResolver validation.
 */
import { z } from 'zod'

const NOTE_BODY_MAX = 5000
const MATERIAL_TITLE_MAX = 200
const MATERIAL_URL_MAX = 2048
const EXERCISE_TITLE_MAX = 200
const EXERCISE_INSTRUCTIONS_MAX = 5000
const EXERCISE_LINK_MAX = 2048

/**
 * isHttpUrl reports whether a string is an absolute http/https URL. Used both to
 * validate material/exercise link inputs (block javascript:/data:/relative at
 * the form) AND to guard the rendered `href` so a stored value that predates
 * this rule can never become a live script-scheme sink. Mirrors the backend
 * `httpURLField` guard and the auth `sanitizeNextParam` scheme allow-list.
 */
export function isHttpUrl(value: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

const httpUrl = z.string().trim().refine(isHttpUrl, { message: 'must be an http or https URL' })

export const noteFormSchema = z.object({
  body: z.string().trim().min(1).max(NOTE_BODY_MAX),
})
export type NoteFormValues = z.infer<typeof noteFormSchema>

export const materialFormSchema = z.object({
  title: z.string().trim().min(1).max(MATERIAL_TITLE_MAX),
  url: httpUrl.pipe(z.string().max(MATERIAL_URL_MAX)),
})
export type MaterialFormValues = z.infer<typeof materialFormSchema>

export const exerciseFormSchema = z.object({
  title: z.string().trim().min(1).max(EXERCISE_TITLE_MAX),
  instructions: z.string().trim().max(EXERCISE_INSTRUCTIONS_MAX).optional(),
  link: z.union([httpUrl.pipe(z.string().max(EXERCISE_LINK_MAX)), z.literal('')]).optional(),
})
export type ExerciseFormValues = z.infer<typeof exerciseFormSchema>
