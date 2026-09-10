/**
 * isEnrollableClass — Story 7.3b (code-review decision DN2, Ducdo 2026-09-10).
 * The client mirror of the 7-3a server contract `assertEnrollable`: a student may
 * only be enrolled INTO (Add / Transfer target) a class that is `upcoming` or
 * `active`. A `paused` or `ended` class is a guaranteed 422 `CLASS_NOT_ENROLLABLE`,
 * so the target-class picker must not offer it.
 *
 * Distinct from `isAssignableClass` (which excludes only `ended`): that filter
 * answers "can a TEACHER still be assigned here" and is correct for the SOURCE
 * picker (it reflects where the student actually is — a paused class is a valid
 * source to transfer/withdraw FROM). Enrollment TARGETS use this narrower gate.
 */
const ENROLLABLE_CLASS_STATUSES = new Set(['upcoming', 'active'])

/**
 * isEnrollableClass reports whether a class may receive a NEW enrollment
 * (i.e. it is `upcoming` or `active`), mirroring the 7-3a server guard.
 * @param cls - a class carrying its lifecycle `status`
 * @returns true only for `upcoming` / `active` classes
 */
export function isEnrollableClass(cls: { status: string }): boolean {
  return ENROLLABLE_CLASS_STATUSES.has(cls.status)
}
