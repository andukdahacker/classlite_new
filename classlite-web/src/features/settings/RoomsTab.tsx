/**
 * RoomsTab — Story 2-5b AC2.
 *
 * List of physical rooms + synthetic "Online · Google Meet" row rendered
 * only when `centerProfile.googleMeetConnected === true`. When
 * disconnected, the synthetic row disappears (Sally-S7 + John ACCEPT).
 * Its Settings CTA navigates to ?tab=integrations. CRUD via shipped
 * shadcn <Dialog>; delete via <AlertDialog>. AC6: 409 ROOM_NAME_TAKEN
 * surfaces as an inline field error on `name`, NOT a toast.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Link } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DEFAULT_ROOM_FORM_VALUES,
  roomSchema,
  type RoomFormValues,
} from './lib/schemas'
import { useMutateRoom, useRooms, type Room } from './api/useRooms'
import { useCenterProfile } from './api/useCenterProfile'

interface Props {
  centerId: string
}

export function RoomsTab({ centerId }: Props): ReactElement {
  const { t } = useTranslation()
  const roomsQuery = useRooms(centerId)
  const profileQuery = useCenterProfile(centerId)

  const [formDialog, setFormDialog] = useState<
    { open: false } | { open: true; room: Room | null }
  >({ open: false })
  const [toDelete, setToDelete] = useState<Room | null>(null)

  return (
    <div
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="settings-tab-rooms"
      id="settings-tabpanel-rooms"
      data-testid="settings-tabpanel-rooms"
      className="space-y-4 rounded-lg border border-slate-200 bg-white p-6"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('settings.rooms.sectionHeading')}
        </h2>
        <Button size="sm" onClick={() => setFormDialog({ open: true, room: null })}>
          {t('settings.rooms.addCta')}
        </Button>
      </div>
      {roomsQuery.isPending ? (
        <SkeletonList prefix="room-row-skeleton" />
      ) : roomsQuery.isError ? (
        <ErrorAlert onRetry={() => roomsQuery.refetch()} />
      ) : roomsQuery.data && roomsQuery.data.length === 0 ? (
        <EmptyState
          headline={t('settings.rooms.empty.headline')}
          body={t('settings.rooms.empty.body')}
          cta={t('settings.rooms.empty.cta')}
          onCta={() => setFormDialog({ open: true, room: null })}
        />
      ) : (
        <ol className="divide-y divide-slate-100">
          {roomsQuery.data?.map((room) => (
            <li
              key={room.id}
              data-testid={`room-row-${room.id}`}
              className="flex items-center justify-between py-3"
            >
              <div className="flex-1">
                <p className="font-medium text-slate-900">{room.name}</p>
                <p className="text-sm text-slate-500">
                  {t('settings.rooms.row.capacityLabel', { count: room.capacity })}
                  {room.description ? ` · ${room.description}` : null}
                </p>
              </div>
              <div className="ml-4 flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFormDialog({ open: true, room })}
                >
                  {t('settings.rooms.row.editCta')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setToDelete(room)}>
                  {t('settings.rooms.row.deleteCta')}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {/*
        Synthetic Meet row rendered ABOVE the empty/list decision — an online-
        only center (0 physical rooms, Meet connected) previously saw the
        "No physical rooms yet" empty state with no visible Meet integration
        row, actively misleading the user about integration status. Amended
        /bmad-code-review 2-5b Round 1 P10 (2026-07-15).
      */}
      {!roomsQuery.isPending &&
      !roomsQuery.isError &&
      profileQuery.data?.googleMeetConnected ? (
        <ol
          className="divide-y divide-slate-100"
          data-testid="rooms-synthetic-list"
        >
          <SyntheticMeetRow />
        </ol>
      ) : null}

      {formDialog.open ? (
        <RoomFormDialog
          centerId={centerId}
          initial={formDialog.room}
          onClose={() => setFormDialog({ open: false })}
        />
      ) : null}
      {toDelete ? (
        <RoomDeleteDialog
          centerId={centerId}
          room={toDelete}
          onClose={() => setToDelete(null)}
        />
      ) : null}
    </div>
  )
}

// SyntheticMeetRow — react-router <Link> for SPA-preserving navigation.
// Amended /bmad-code-review 2-5b Round 1 P9 (2026-07-15) — previously used a
// raw <a href> which triggered a full page reload on click, losing the in-
// memory TanStack Query cache and any unsaved dialog state elsewhere in the
// tree. Preserving the SPA state model per FW-1 (route loaders / Query cache
// contract).
function SyntheticMeetRow(): ReactElement {
  const { t } = useTranslation()
  return (
    <li
      data-testid="room-row-synthetic-meet"
      className="flex items-center justify-between border-t-2 border-dashed border-slate-200 py-3"
    >
      <div className="flex-1">
        <p className="font-medium text-slate-900">
          {t('settings.rooms.synthetic.meet.name')}
        </p>
      </div>
      <Link
        to="/settings?tab=integrations"
        className="text-sm font-medium text-blue-700 hover:underline"
      >
        {t('settings.rooms.synthetic.meet.settingsCta')}
      </Link>
    </li>
  )
}

// -----------------------------------------------------------------------------
// Room form dialog with AC6 UNIQUE-conflict inline field error handling.
// -----------------------------------------------------------------------------

interface RoomFormDialogProps {
  centerId: string
  initial: Room | null
  onClose: () => void
}

function RoomFormDialog({
  centerId,
  initial,
  onClose,
}: RoomFormDialogProps): ReactElement {
  const { t } = useTranslation()
  const mutate = useMutateRoom(centerId)
  const [saveError, setSaveError] = useState<SaveDialogError | null>(null)
  const defaultValues: RoomFormValues = initial
    ? {
        name: initial.name,
        description: initial.description ?? '',
        capacity: initial.capacity,
      }
    : DEFAULT_ROOM_FORM_VALUES
  const form = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchema),
    defaultValues,
  })

  const onSubmit: SubmitHandler<RoomFormValues> = (values) => {
    setSaveError(null)
    const body = {
      name: values.name,
      description: values.description === '' ? null : values.description,
      capacity: values.capacity,
    }
    const input =
      initial === null
        ? ({ kind: 'create', body } as const)
        : ({ kind: 'update', id: initial.id, body } as const)
    mutate.mutate(input, {
      onSuccess: () => {
        toast.success(t('settings.rooms.saveSuccessToast'))
        onClose()
      },
      onError: (err) => {
        // AC6 — ROOM_NAME_TAKEN 409 → inline field error on `name`, no toast.
        if (isRoomNameTakenError(err)) {
          form.setError('name', {
            message: 'settings.rooms.form.name.errors.taken',
          })
          return
        }
        // All other non-validation server errors surface as a dialog-body
        // Alert with a retry action. Amended /bmad-code-review 2-5b Round 1
        // P1 (2026-07-15) — previously non-409 errors were silently dropped,
        // leaving the user staring at an un-disabled Save button with no
        // feedback.
        setSaveError(classifySaveError(err))
      },
    })
  }
  const retry = form.handleSubmit(onSubmit)

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial === null
              ? t('settings.rooms.form.dialogTitleCreate')
              : t('settings.rooms.form.dialogTitleEdit')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {saveError ? (
            <SaveErrorAlert
              error={saveError}
              onRetry={() => {
                setSaveError(null)
                void retry()
              }}
              testId="room-save-error"
            />
          ) : null}
          <FormField
            id="room-name"
            label={t('settings.rooms.form.name.label')}
            error={form.formState.errors.name?.message}
          >
            <Input
              id="room-name"
              placeholder={t('settings.rooms.form.name.placeholder')}
              {...form.register('name')}
            />
          </FormField>
          <FormField
            id="room-description"
            label={t('settings.rooms.form.description.label')}
            error={form.formState.errors.description?.message}
          >
            <Input id="room-description" {...form.register('description')} />
          </FormField>
          <FormField
            id="room-capacity"
            label={t('settings.rooms.form.capacity.label')}
            error={form.formState.errors.capacity?.message}
          >
            <Input
              id="room-capacity"
              type="number"
              min={1}
              max={500}
              {...form.register('capacity', { valueAsNumber: true })}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('settings.rooms.form.cancelCta')}
            </Button>
            <Button type="submit" disabled={mutate.isPending}>
              {t('settings.rooms.form.saveCta')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface RoomDeleteDialogProps {
  centerId: string
  room: Room
  onClose: () => void
}

function RoomDeleteDialog({
  centerId,
  room,
  onClose,
}: RoomDeleteDialogProps): ReactElement {
  const { t } = useTranslation()
  const mutate = useMutateRoom(centerId)
  return (
    <AlertDialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('settings.rooms.delete.confirmHeadline')}
          </AlertDialogTitle>
          <AlertDialogDescription>{room.name}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>
            {t('settings.rooms.delete.cancelCta')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              mutate.mutate(
                { kind: 'delete', id: room.id },
                {
                  onSuccess: () => {
                    toast.success(t('settings.rooms.deleteSuccessToast'))
                    onClose()
                  },
                  onError: () => {
                    toast.error(t('settings.error.generic'))
                  },
                },
              )
            }}
          >
            {t('settings.rooms.delete.confirmCta')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// isRoomNameTakenError inspects the thrown error for the 409 envelope.
// apiFetch throws ApiError with .code set from the response error envelope.
function isRoomNameTakenError(err: Error): boolean {
  return err instanceof ApiError && err.code === 'ROOM_NAME_TAKEN'
}

// -----------------------------------------------------------------------------
// Shared sub-components (duplicated locally to keep this file self-contained;
// TermCalendarTab has an equivalent set — extract to a shared module in the
// Round 1 code review if the surface grows).
// -----------------------------------------------------------------------------

function SkeletonList({ prefix }: { prefix: string }): ReactElement {
  return (
    <ul className="space-y-2" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          data-testid={`${prefix}-${i}`}
          className="h-12 animate-pulse rounded-md bg-slate-100"
        />
      ))}
    </ul>
  )
}

interface EmptyStateProps {
  headline: string
  body: string
  cta?: string
  onCta?: () => void
}

function EmptyState({ headline, body, cta, onCta }: EmptyStateProps): ReactElement {
  return (
    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <p className="text-sm font-medium text-slate-900">{headline}</p>
      <p className="mt-1 text-sm text-slate-500">{body}</p>
      {cta && onCta ? (
        <Button className="mt-4" onClick={onCta}>
          {cta}
        </Button>
      ) : null}
    </div>
  )
}

interface ErrorAlertProps {
  onRetry: () => void
}

function ErrorAlert({ onRetry }: ErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
    >
      <p>{t('settings.error.fetch')}</p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
        {t('settings.error.tryAgain')}
      </Button>
    </div>
  )
}

interface FormFieldProps {
  id: string
  label: string
  error?: string | undefined
  children: ReactElement
}

function FormField({ id, label, error, children }: FormFieldProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Save-failure alert — added /bmad-code-review 2-5b Round 1 P1 (2026-07-15).
// Duplicate of the equivalent helpers in TermCalendarTab.tsx to keep this
// file self-contained; extract with the other duplicated sub-components in
// FU-2-5b-B.
// -----------------------------------------------------------------------------

type SaveDialogError =
  | { kind: 'validation' }
  | { kind: 'forbidden' }
  | { kind: 'auth' }
  | { kind: 'rateLimit'; retryAfter?: number }
  | { kind: 'generic'; requestId?: string }

function classifySaveError(err: unknown): SaveDialogError {
  const anyErr = err as {
    status?: number
    requestId?: string
    retryAfter?: number
    code?: string
  }
  const status = anyErr?.status
  if (status === 401) return { kind: 'auth' }
  if (status === 403) return { kind: 'forbidden' }
  if (status === 422) return { kind: 'validation' }
  if (status === 429) {
    return anyErr.retryAfter !== undefined
      ? { kind: 'rateLimit', retryAfter: anyErr.retryAfter }
      : { kind: 'rateLimit' }
  }
  return anyErr?.requestId !== undefined
    ? { kind: 'generic', requestId: anyErr.requestId }
    : { kind: 'generic' }
}

interface SaveErrorAlertProps {
  error: SaveDialogError
  onRetry: () => void
  testId?: string
}

function SaveErrorAlert({ error, onRetry, testId }: SaveErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  let message: string
  switch (error.kind) {
    case 'validation':
      message = t('settings.error.validation')
      break
    case 'forbidden':
      message = t('settings.error.forbidden')
      break
    case 'auth':
      message = t('settings.error.auth')
      break
    case 'rateLimit':
      message =
        error.retryAfter !== undefined
          ? t('settings.error.rateLimitWithRetry', { seconds: error.retryAfter })
          : t('settings.error.rateLimit')
      break
    case 'generic':
      message =
        error.requestId !== undefined
          ? t('settings.error.genericWithRequestId', { requestId: error.requestId })
          : t('settings.error.generic')
      break
  }
  return (
    <div
      role="alert"
      data-testid={testId}
      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
    >
      <p>{message}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-2"
        onClick={onRetry}
      >
        {t('settings.error.tryAgain')}
      </Button>
    </div>
  )
}
