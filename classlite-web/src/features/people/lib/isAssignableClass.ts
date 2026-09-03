/**
 * isAssignableClass — Story 7.1b (code-review decision 2026-09-03). Shared filter
 * for the two class pickers (the Owner assign-class panel and the teacher-invite
 * field): a teacher can only be assigned to a class that has not ended.
 *
 * ClassStatus is `upcoming | active | paused | ended` — there is no literal
 * "archived" for classes; `ended` is the terminal/completed state. Excluding only
 * `ended` keeps upcoming/paused classes assignable, so a fresh center's first
 * (upcoming) class still appears in the picker.
 */
const ENDED_CLASS_STATUS = 'ended'

/**
 * isAssignableClass reports whether a class may still receive a teacher
 * assignment (i.e. it has not reached the terminal `ended` state).
 * @param cls - a class carrying its lifecycle `status`
 * @returns true unless the class has ended
 */
export function isAssignableClass(cls: { status: string }): boolean {
  return cls.status !== ENDED_CLASS_STATUS
}
