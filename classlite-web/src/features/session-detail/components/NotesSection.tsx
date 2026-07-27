/**
 * NotesSection — Story 3.5 (AC3). Add / edit / delete session notes. Notes are
 * standard content (NOT the writing-editor exemption): an explicit RHF form with
 * zodResolver validation + a Save button. Mutations are optimistic (FW-2).
 */
import { useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  useSessionNotes,
  useCreateNote,
  useUpdateNote,
  useDeleteNote,
  type SessionNoteWire,
} from '../api/sessionContentApi'
import { noteFormSchema, type NoteFormValues } from '../lib/contentSchemas'
import { ContentSectionFrame } from './ContentSectionFrame'
import { useEditFocusReturn, isOptimisticId } from '../lib/rowState'

export function NotesSection({ sessionId }: { sessionId: string }): ReactElement {
  const { t } = useTranslation()
  const query = useSessionNotes(sessionId)
  const create = useCreateNote(sessionId)
  const notes = query.data ?? []

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { body: '' },
  })

  const onAdd = form.handleSubmit((values) => {
    create.mutate(
      { body: values.body },
      { onSuccess: () => form.reset({ body: '' }) },
    )
  })

  return (
    <ContentSectionFrame
      titleKey="session.notes.title"
      testid="session-notes"
      count={notes.length}
      isPending={query.isPending}
      isError={query.isError}
      isEmpty={notes.length === 0}
      onRetry={() => query.refetch()}
      emptyKey="session.notes.empty"
      addForm={
        <form onSubmit={onAdd} className="space-y-2" data-testid="session-notes-add-form">
          <Textarea
            {...form.register('body')}
            aria-label={t('session.notes.field.body')}
            placeholder={t('session.notes.field.bodyPlaceholder')}
            rows={2}
          />
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={create.isPending}>
              {t('session.notes.add')}
            </Button>
          </div>
        </form>
      }
    >
      <ul className="space-y-2" data-testid="session-notes-list">
        {notes.map((note) => (
          <NoteRow key={note.id} sessionId={sessionId} note={note} />
        ))}
      </ul>
    </ContentSectionFrame>
  )
}

function NoteRow({
  sessionId,
  note,
}: {
  sessionId: string
  note: SessionNoteWire
}): ReactElement {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const create = useCreateNote(sessionId)
  const update = useUpdateNote(sessionId)
  const remove = useDeleteNote(sessionId)
  const editTriggerRef = useEditFocusReturn(editing)
  const isOptimistic = isOptimisticId(note.id)

  const form = useForm<NoteFormValues>({
    resolver: zodResolver(noteFormSchema),
    defaultValues: { body: note.body },
  })

  const onSave = form.handleSubmit((values) => {
    update.mutate(
      { id: note.id, body: { body: values.body } },
      { onSuccess: () => setEditing(false) },
    )
  })

  // Optimistic delete + an Undo affordance: the row is removed immediately; the
  // toast lets the user re-create it (a new id/position — content is what matters).
  const onDelete = () => {
    remove.mutate(note.id, {
      onSuccess: () => {
        toast.success(t('session.detail.content.deleted'), {
          action: {
            label: t('session.detail.content.undo'),
            onClick: () => create.mutate({ body: note.body }),
          },
        })
      },
      onError: () => toast.error(t('session.detail.content.deleteError')),
    })
  }

  if (editing) {
    return (
      <li className="rounded-md border border-slate-200 p-2">
        <form onSubmit={onSave} className="space-y-2">
          {/* autoFocus moves focus into the field when edit mode opens (TEST-UX-2) */}
          <Textarea {...form.register('body')} autoFocus aria-label={t('session.notes.field.body')} rows={2} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('session.detail.content.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={update.isPending}>
              {t('session.detail.content.save')}
            </Button>
          </div>
        </form>
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-slate-200 p-2" data-testid="session-note-row">
      <p className="min-w-0 whitespace-pre-wrap break-words text-sm text-slate-700">{note.body}</p>
      <div className="flex shrink-0 gap-1">
        <Button ref={editTriggerRef} size="sm" variant="ghost" disabled={isOptimistic} onClick={() => setEditing(true)}>
          {t('session.detail.content.edit')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={isOptimistic || remove.isPending}
          onClick={onDelete}
        >
          {t('session.detail.content.delete')}
        </Button>
      </div>
    </li>
  )
}
