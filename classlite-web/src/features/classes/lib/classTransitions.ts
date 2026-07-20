/**
 * classTransitions — client mirror of the server's authoritative lifecycle
 * transition map (Story 3.1 AC4). The server is the source of truth; this
 * mirror lets the UI offer only legal next states (the current state is absent
 * from the menu, so the same-state 422 is unreachable from the UI).
 */
import type { ClassStatus } from '../api/useClasses'

export const CLIENT_TRANSITIONS: Record<ClassStatus, ClassStatus[]> = {
  upcoming: ['active'],
  active: ['paused', 'ended'],
  paused: ['active'],
  ended: [],
}
