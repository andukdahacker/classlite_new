/**
 * StudentNotesPanel — Story 7.2b (Task 6, AC15-18). The s10 teacher-notes
 * surface: a chronological (ASC) log of `StudentNote[]` + a composer
 * (content + Flag toggle + Save) + a per-note flag toggle + an
 * author/owner-gated delete. Notes are STAFF-only (a student caller 403s on
 * every verb — not a student-facing surface, so the at-risk/flag red is fine).
 *
 * Two note states only — plain / flagged (D11): the contract carries a
 * `flagged` boolean, not a severity, so the mockup's red "warn" tier is NOT
 * backed. The ⎘ Attach + @ Mention affordances are deferred (FU-7-2-A/B) and
 * intentionally ABSENT.
 *
 * TEST-FE-6 (security-adjacent, MANDATORY): the delete control renders ONLY for
 * the note's author OR an owner/admin — gating happens HERE (not inside a child
 * that's always mounted) so the negative assertion "no delete control in the
 * DOM for a non-author teacher" holds. The backend enforces (403 FORBIDDEN);
 * this is the UI companion + a defense-in-depth toast.
 *
 * When composed inside `StudentDetailPage`, `initialNotes` seeds the cache from
 * the detail's embedded `notes` (no second fetch); mounted standalone the panel
 * fetches its own list.
 */
import { useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api-fetch'
import { useRole } from '@/hooks/useRole'
import { useStudentNotes, type StudentNote } from '../api/useStudents'
import {
  useCreateStudentNote,
  useSetStudentNoteFlag,
  useDeleteStudentNote,
} from '../api/useStudentActions'
import { useStaffSession } from '../lib/useStaffSession'
import { formatStaffDateTime } from '../lib/formatStaffDate'

const FORBIDDEN_STATUS = 403
const SKELETON_ROWS = [0, 1] as const

export interface StudentNotesPanelProps {
  studentId: string
  /** Seeded from the whole-student detail's embedded notes (detail composition). */
  initialNotes?: StudentNote[]
}

export function StudentNotesPanel({
  studentId,
  initialNotes,
}: StudentNotesPanelProps): ReactElement {
  const { t, i18n } = useTranslation()
  const role = useRole()
  const session = useStaffSession()
  const viewerId = session?.user.id ?? null
  const isOwnerOrAdmin = role === 'owner' || role === 'admin'

  const notesQuery = useStudentNotes(studentId, initialNotes)
  const createNote = useCreateStudentNote(studentId)
  const flagNote = useSetStudentNoteFlag(studentId)
  const deleteNote = useDeleteStudentNote(studentId)

  const [content, setContent] = useState('')
  const [flagged, setFlagged] = useState(false)

  function canDelete(note: StudentNote): boolean {
    // Gate on the stable author id, not the display name (namesakes collide and a
    // renamed/absent name would deny an author their own note). Backend 403 is
    // the real guard; this is the UI companion (D11).
    return isOwnerOrAdmin || (viewerId !== null && note.authorId === viewerId)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (content.trim() === '' || createNote.isPending) return
    createNote.mutate(
      { content, flagged },
      {
        onSuccess: () => {
          setContent('')
          setFlagged(false)
          toast(t('people.student.notes.createSuccess'))
        },
        onError: () => toast(t('people.student.notes.createError')),
      },
    )
  }

  function handleFlagToggle(note: StudentNote): void {
    flagNote.mutate(
      { noteId: note.noteId, flagged: !note.flagged },
      { onError: () => toast(t('people.student.notes.flagError')) },
    )
  }

  function handleDelete(note: StudentNote): void {
    deleteNote.mutate(
      { noteId: note.noteId },
      {
        onSuccess: () => toast(t('people.student.notes.deleteSuccess')),
        onError: (error) => {
          const forbidden =
            error instanceof ApiError && error.status === FORBIDDEN_STATUS
          toast(
            t(
              forbidden
                ? 'people.student.notes.deleteForbidden'
                : 'people.student.notes.deleteError',
            ),
          )
        },
      },
    )
  }

  const placeholder = t('people.student.notes.placeholder')
  const notes = notesQuery.data ?? []

  return (
    <section
      data-testid="student-notes-panel"
      aria-label={t('people.student.notes.heading')}
      className="rounded-lg border border-slate-200 p-4"
    >
      <h2 className="mb-3 font-fraunces text-lg text-slate-900">
        {t('people.student.notes.heading')}
      </h2>

      <form onSubmit={handleSubmit} className="mb-4 flex flex-col gap-2">
        <Textarea
          aria-label={placeholder}
          placeholder={placeholder}
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={flagged ? 'default' : 'outline'}
            size="sm"
            aria-pressed={flagged}
            onClick={() => setFlagged((prev) => !prev)}
          >
            {t('people.student.notes.flagToggle')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={content.trim() === '' || createNote.isPending}
          >
            {t('people.student.notes.save')}
          </Button>
        </div>
      </form>

      {notesQuery.isPending ? (
        <div className="space-y-2">
          {SKELETON_ROWS.map((i) => (
            <Skeleton key={i} className="h-16 w-full" data-testid={`note-skeleton-${i}`} />
          ))}
        </div>
      ) : notesQuery.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
        >
          <span>{t('people.student.notes.error')}</span>
          <Button size="sm" variant="outline" onClick={() => notesQuery.refetch()}>
            {t('people.student.notes.retry')}
          </Button>
        </div>
      ) : notes.length === 0 ? (
        <p
          data-testid="notes-empty"
          className="rounded-md border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400"
        >
          {t('people.student.notes.empty')}
        </p>
      ) : (
        <ul aria-label={t('people.student.notes.listAria')} className="space-y-2">
          {notes.map((note) => (
            <li
              key={note.noteId}
              data-testid={`student-note-${note.noteId}`}
              data-flagged={String(note.flagged)}
              className={`rounded-md border p-3 ${
                note.flagged
                  ? 'border-l-4 border-l-[color:var(--cl-accent-2)] border-slate-200 bg-[color:var(--cl-tint-gold)]'
                  : 'border-slate-200'
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  {note.authorName} · {formatStaffDateTime(note.createdAt, i18n.language)}
                </span>
                <div className="flex items-center gap-1">
                  {note.flagged ? (
                    <span className="font-medium text-[color:var(--cl-amber)]">
                      {t('people.student.notes.flaggedBadge')}
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-pressed={note.flagged}
                    disabled={flagNote.isPending && flagNote.variables?.noteId === note.noteId}
                    onClick={() => handleFlagToggle(note)}
                  >
                    {t('people.student.notes.flagToggle')}
                  </Button>
                  {canDelete(note) ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-testid={`note-delete-${note.noteId}`}
                      disabled={
                        deleteNote.isPending && deleteNote.variables?.noteId === note.noteId
                      }
                      onClick={() => handleDelete(note)}
                    >
                      {t('people.student.notes.delete')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-sm text-slate-800">{note.content}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
