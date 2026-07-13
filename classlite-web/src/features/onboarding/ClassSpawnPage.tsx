/**
 * ClassSpawnPage — Story 2-3b AC4/AC5/AC6/AC7/AC9/AC10/AC12/AC13, Task 6.
 *
 * The `/setup/spawn` (s03 Operator, s08 Founder) multi-row spawn form. RHF
 * + zodResolver + useFieldArray. On submit:
 *   client Zod → useAutoSave gate (Murat-S5 3-state) → useSpawnClasses →
 *   flushWithLatch(currentStep: 'done') → navigate('/setup/done').
 *
 * Load-bearing folds:
 *  - Winston-W4: Founder row-0 UI DISPLAY decoupled from WIRE payload;
 *    wire always sends `teacherEmail: null` for the Founder default so the
 *    server returns `founder_auto` (not `explicit_self`).
 *  - Sally-B3 never-touched sentinel: pre-fill display only if the draft
 *    for row 0 has `teacherEmail === undefined`; `null` = user's explicit
 *    hand-off clear, respect it.
 *  - Sally-B2: Build-from-scratch variant hides Save & spawn + swaps CTA
 *    to "← Pick a template".
 *  - Amelia-S3: 403 INVALID_TENANT_CLAIM clears auth cache BEFORE navigate,
 *    otherwise the layout guard bounces the user right back in.
 *  - Winston-W2: terminal `flushWithLatch({currentStep: 'done'})` bumps
 *    saveSeq + disables further scheduleSave until unmount.
 *  - Winston-W3: no invalidate on templates cache (handled by useSpawnClasses).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/lib/api-fetch'
import { useAuth } from '@/hooks/useAuth'
import { authKeys } from '@/features/auth/api/authKeys'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import type { AssignChipValue } from '@/components/domain/AssignChip'
import {
  useClassSpawnSchema,
  type ClassSpawnFormValues,
} from './lib/classSpawnSchema'
import { useOnboardingProgress } from './api/useOnboardingProgress'
import { useSpawnClasses } from './api/useSpawnClasses'
import { onboardingKeys } from './api/onboardingKeys'
import { useOnboardingAutoSave } from './OnboardingAutoSaveContext'
import { useCountdown } from './hooks/useCountdown'
import { ClassRow } from './components/ClassRow'
import { AssignTeacherComposer } from './components/AssignTeacherComposer'
import { SaveAndFinishLaterLink } from './components/SaveAndFinishLaterLink'
import { queueArrivalToast } from './arrivalToast'

interface RowState {
  chip: AssignChipValue | null
  starIcon: boolean
  composerOpen: boolean
}

const EMPTY_ROW = {
  cohortName: '',
  startDate: '',
  teacherEmail: null,
}

export default function ClassSpawnPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const progress = useOnboardingProgress()
  const spawn = useSpawnClasses()
  const autoSave = useOnboardingAutoSave()
  const schema = useClassSpawnSchema()
  // R1-C1-P6 — destructure the stable primitives we actually need. The
  // context return object may re-reference on savingState transitions;
  // depending on `autoSave` in the auto-save effect below would drive a
  // feedback loop.
  const { scheduleSave } = autoSave

  const persona = progress.data?.persona ?? null
  const priorPayload = progress.data?.payload ?? null
  // Memoize so useEffect dependency arrays that include this reference stay
  // stable across renders (lint warning suppression + correctness).
  const priorTemplateDraft = useMemo(
    () =>
      (priorPayload?.templateDraft ?? {}) as unknown as TemplateDraftPayload,
    [priorPayload?.templateDraft],
  )
  const selectedTemplateId = priorTemplateDraft.selectedTemplateId ?? null
  const buildFromScratch = priorTemplateDraft.buildFromScratch === true

  // R1-C1-P1 — Draft defaults are derived from `priorTemplateDraft` (which
  // reflects the resolved GET progress). The outer render gates on
  // `progress.isLoading` (see the early-return below) so RHF is only
  // constructed once we have real data — the empty-row seed never lands
  // over a real saved draft. `useMemo` deps intentionally track
  // `priorTemplateDraft` — if it changes between mount and RHF construction
  // (e.g. background refetch), the new defaults win only until the user
  // types (see the `form.reset` guard below).
  const draftDefaults: ClassSpawnFormValues = useMemo(() => {
    const savedRows = priorTemplateDraft.classesDraft
    if (savedRows && savedRows.length > 0) {
      return {
        templateId: selectedTemplateId,
        classes: savedRows.map((r) => ({
          cohortName: r.cohortName,
          startDate: r.startDate,
          teacherEmail: r.teacherEmail,
        })),
      }
    }
    return {
      templateId: selectedTemplateId,
      classes: [{ ...EMPTY_ROW }],
    }
  }, [priorTemplateDraft, selectedTemplateId])

  const form = useForm<ClassSpawnFormValues>({
    resolver: zodResolver(schema),
    defaultValues: draftDefaults,
    mode: 'onTouched',
  })
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'classes',
  })
  // R1-C1-P1 — safety belt: when the GET resolves AFTER first render (rare
  // if the outer isLoading gate lands, but StrictMode double-mount + cache
  // races can slip a first render through), reset RHF once from the saved
  // draft while the form is still pristine. If the user has already begun
  // typing, respect their input.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (hydratedRef.current) return
    if (progress.isLoading || progress.isError) return
    if (form.formState.isDirty) return
    hydratedRef.current = true
    form.reset(draftDefaults)
  }, [
    progress.isLoading,
    progress.isError,
    draftDefaults,
    form,
  ])

  // Per-row local UI state — AssignChip visible state + composer open flag.
  const [rowStates, setRowStates] = useState<RowState[]>(() =>
    fields.map(() => ({
      chip: null,
      starIcon: false,
      composerOpen: false,
    })),
  )
  // Track a ref to each row's AssignChip trigger for focus-return (Murat-S6).
  // Keyed by row index. On composer close we .focus() the corresponding button.
  // Using a stable Map ref so appended rows do not stomp existing entries.
  const chipTriggerRefs = useRef<
    Map<number, HTMLButtonElement | HTMLDivElement | null>
  >(new Map())

  // Sync rowStates when fields.length changes (append/remove). This IS an
  // intentional setState-in-effect: rowStates is per-row UI state (chip
  // display, composer visibility) that must stay array-index-aligned with
  // RHF's useFieldArray, and there is no useMemo path — chip state is not
  // derivable from fields (user-typed drafts + Founder auto-assign
  // injection each write here). The React 19 lint rule flags the shape;
  // the guard `prev.length === fields.length` makes it a no-op when
  // lengths match, avoiding cascade renders in the steady state.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRowStates((prev) => {
      if (prev.length === fields.length) return prev
      const next: RowState[] = []
      for (let i = 0; i < fields.length; i++) {
        next.push(
          prev[i] ?? { chip: null, starIcon: false, composerOpen: false },
        )
      }
      return next
    })
  }, [fields.length])

  // AC10 resume routing (rows 5–7). Row 7: template step → stay + soft toast.
  const [showResumeToast, setShowResumeToast] = useState(false)
  const routingResolvedRef = useRef(false)
  // setState-in-effect is intentional here: the "resume toast" affordance
  // fires ONCE after the FIRST successful GET progress resolves; the
  // routingResolvedRef guard ensures the state write does not cascade
  // (subsequent progress-cache changes are ignored).
  useEffect(() => {
    if (progress.isLoading) return
    // R1-C1-P9 — GET error should not deterministically punt the mid-spawn
    // user to /welcome. Stay on-page while the query retries (or shows the
    // loading skeleton per the early-return above).
    if (progress.isError) return
    if (routingResolvedRef.current) return
    const currentStep = progress.data?.currentStep ?? null
    if (persona === null) {
      routingResolvedRef.current = true
      navigate('/welcome', { replace: true })
      return
    }
    if (persona === 'solo_teacher') {
      routingResolvedRef.current = true
      navigate('/setup/first-class', { replace: true })
      return
    }
    routingResolvedRef.current = true
    if (currentStep === 'template') {
      // Row 7 — stay + soft toast
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowResumeToast(true)
    }
  }, [progress.isLoading, progress.isError, progress.data, persona, navigate])

  // AC7 Founder auto-assign — display-only injection on row 0 when
  // (persona=founder) AND (never-touched sentinel: classesDraft[0].teacherEmail
  // === undefined). Wire submit path always sends null for row 0 default
  // regardless of display (Winston-W4). Effect fires ONCE after the FIRST
  // successful GET progress resolves AND `user` is available — the ref only
  // latches after all prerequisites are met (R1-C1-P4).
  const founderInjectionAppliedRef = useRef(false)
  useEffect(() => {
    if (progress.isLoading || progress.isError) return
    if (founderInjectionAppliedRef.current) return
    // R1-C1-P4 — if the caller isn't a Founder, the decision is made and
    // the ref latches. Every other early exit MUST wait for the actual
    // dependencies before latching, otherwise a late-arriving `user` or
    // `progress.data` never triggers injection.
    if (persona !== 'founder') {
      founderInjectionAppliedRef.current = true
      return
    }
    if (!user) return
    const draftRow0 = priorTemplateDraft.classesDraft?.[0]
    const neverTouched =
      draftRow0 === undefined || draftRow0.teacherEmail === undefined
    // Latch AFTER user is known. If neverTouched is false (user cleared
    // row 0 explicitly), respect the empty display + fall through without
    // injection.
    founderInjectionAppliedRef.current = true
    if (!neverTouched) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRowStates((prev) => {
      const next = [...prev]
      next[0] = {
        chip: {
          userId: user.id,
          email: user.email,
          displayName: user.displayName ?? user.email,
          role: 'Founder',
        },
        starIcon: true,
        composerOpen: false,
      }
      return next
    })
  }, [progress.isLoading, progress.isError, persona, priorTemplateDraft.classesDraft, user])

  // Auto-save wire-up — watch `classes` array + spread priorTemplateDraft to
  // preserve selectedTemplateId + spawnedClassIds (Amelia-S5 invariant).
  const watchedClasses = useWatch({
    control: form.control,
    name: 'classes',
  }) as ClassSpawnFormValues['classes'] | undefined
  useEffect(() => {
    if (progress.isLoading || progress.isError) return
    if (!watchedClasses) return
    // R1-C1-P6 — depend on the stable `scheduleSave` primitive (destructured
    // once above), NOT the full context object. If the whole `autoSave`
    // object re-references on savingState transitions, this effect would
    // fire against unchanged inputs and drive a feedback loop.
    scheduleSave({
      schemaVersion: 1,
      personaChoice: persona,
      centerDraft: priorPayload?.centerDraft ?? null,
      templateDraft: {
        ...priorTemplateDraft,
        classesDraft: watchedClasses.map((row) => ({
          cohortName: row.cohortName ?? '',
          startDate: row.startDate ?? '',
          teacherEmail: row.teacherEmail ?? null,
        })),
      } as unknown as Record<string, unknown>,
    })
  }, [
    watchedClasses,
    scheduleSave,
    persona,
    progress.isLoading,
    progress.isError,
    priorPayload?.centerDraft,
    priorTemplateDraft,
  ])

  // 429 countdown (shared useCountdown hook — Amelia-B6 extraction).
  const retryCountdown = useCountdown({ initialSeconds: 0 })
  const [rateLimitCopy, setRateLimitCopy] = useState<string | null>(null)
  const [genericErrorCopy, setGenericErrorCopy] = useState<string | null>(null)
  const [autoSaveWarning, setAutoSaveWarning] = useState(false)

  // Wire submit payload row-by-row (Winston-W4 wire vs UI decoupling).
  function wireRowsFor(rows: ClassSpawnFormValues['classes']) {
    return rows.map((row, index) => {
      // Winston-W4: Founder row-0 auto-assign — wire is null even if UI displays
      const isFounderRow0Untouched =
        persona === 'founder' &&
        index === 0 &&
        (priorTemplateDraft.classesDraft?.[0]?.teacherEmail === undefined) &&
        (rowStates[0]?.starIcon ?? false) &&
        row.teacherEmail === null
      return {
        cohortName: row.cohortName,
        startDate: row.startDate,
        teacherEmail: isFounderRow0Untouched ? null : row.teacherEmail,
      }
    })
  }

  const handleSpawnError = useCallback(
    (err: ApiError) => {
      // R1-C1-P13 — spec AC6 requires refetch + arrival toast on top of
      // the navigate. Without the refetch, the destination page renders
      // stale cache (deleted template still visible); without the toast
      // the user has no context for the redirect.
      if (err.status === 404 && err.code === 'TEMPLATE_NOT_FOUND') {
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.templates(),
        })
        queueArrivalToast('onboarding.spawn.error.templateNotFoundToast')
        navigate('/setup/template', { replace: true })
        return
      }
      if (err.status === 422) {
        const details = err.details
        if (Array.isArray(details)) {
          for (const raw of details) {
            // R1-C1-P8 — API details are opaque; validate structurally
            // BEFORE calling into RegExp. Cast + optional-chain does not
            // protect against non-string `field` (which would throw on
            // `.match()`).
            if (typeof raw !== 'object' || raw === null) {
              setGenericErrorCopy(
                t('onboarding.spawn.error.generic', {
                  requestId: err.requestId ?? 'unknown',
                }),
              )
              continue
            }
            const entry = raw as {
              field?: unknown
              message?: unknown
              code?: unknown
            }
            const field =
              typeof entry.field === 'string' ? entry.field : null
            const message =
              typeof entry.message === 'string' ? entry.message : ''
            const code = typeof entry.code === 'string' ? entry.code : null
            const match = field?.match(/^classes\[(\d+)\]\.(\w+)$/)
            if (match) {
              const idx = Number(match[1])
              const fieldName = match[2] as
                | 'cohortName'
                | 'startDate'
                | 'teacherEmail'
              const messageOverride =
                code === 'SELF_INVITE_BLOCKED'
                  ? t('onboarding.spawn.error.teacherEmailSelfInvite')
                  : code === 'INVALID_TEACHER_EMAIL'
                    ? t('onboarding.spawn.error.teacherEmailInvalid')
                    : message
              form.setError(`classes.${idx}.${fieldName}` as const, {
                message: messageOverride,
              })
            } else {
              setGenericErrorCopy(
                t('onboarding.spawn.error.generic', {
                  requestId: err.requestId ?? 'unknown',
                }),
              )
            }
          }
        }
        return
      }
      if (err.status === 403) {
        if (err.code === 'EMAIL_VERIFICATION_REQUIRED') {
          navigate('/verify-email', { replace: true })
          return
        }
        if (err.code === 'CENTER_REQUIRED') {
          // R1-C1-P19 — arrival toast so the (rare) forced bounce back to
          // center-setup carries context for the user.
          queueArrivalToast('onboarding.spawn.error.centerRequiredToast')
          navigate('/setup/center', { replace: true })
          return
        }
        if (err.code === 'INVALID_TENANT_CLAIM') {
          queryClient.setQueryData(authKeys.session(), null)
          navigate('/login', { replace: true })
          return
        }
        setGenericErrorCopy(
          t('onboarding.spawn.error.generic', {
            requestId: err.requestId ?? 'unknown',
          }),
        )
        return
      }
      if (err.status === 429) {
        const seconds = err.retryAfterSeconds ?? 0
        // R1-C1-P12 — Retry-After: 0 (or missing) means "retry immediately";
        // announcing "Try again in 0 seconds" is a Sally-I2 violation and
        // the button re-enables anyway. Fall to the generic error surface.
        if (seconds > 0) {
          retryCountdown.reset(seconds)
          setRateLimitCopy(
            t('onboarding.spawn.error.rateLimited', { seconds }),
          )
        } else {
          setGenericErrorCopy(
            t('onboarding.spawn.error.generic', {
              requestId: err.requestId ?? 'unknown',
            }),
          )
        }
        return
      }
      // 500 or fallback
      setGenericErrorCopy(
        t('onboarding.spawn.error.generic', {
          requestId: err.requestId ?? 'unknown',
        }),
      )
    },
    [form, navigate, queryClient, retryCountdown, t],
  )

  const onSubmit = form.handleSubmit(async (values) => {
    setGenericErrorCopy(null)
    setRateLimitCopy(null)
    setAutoSaveWarning(false)
    if (values.templateId === null) return // Build-from-scratch is hidden by design
    // Murat-S5 3-state submit gate.
    // R1-C1-P7 — the pre-submit flush is not silent. A failure signals a
    // stalled network condition; surface it via `autoSaveWarning` while
    // still proceeding with the spawn (spawn is forward progress per
    // Murat-S5 ruling, but the SIGNAL must not be lost).
    if (autoSave.savingState === 'saving') {
      try {
        await autoSave.flush()
      } catch {
        setAutoSaveWarning(true)
      }
    } else if (
      autoSave.savingState === 'error' ||
      autoSave.savingState === 'persistentFailure'
    ) {
      setAutoSaveWarning(true)
    }
    const wireClasses = wireRowsFor(values.classes)
    try {
      const result = await spawn.mutateAsync({
        templateId: values.templateId,
        classes: wireClasses,
      })
      // R1-C2-P1 — terminal PUT bumps `currentStep: 'done'` explicitly per
      // AC6 spec; Provider's derived step is `'spawn'`, but the wizard is
      // complete once the spawn call succeeds and Story 2.3c owns the
      // `/setup/done` route that reads `currentStep === 'done'`.
      await autoSave.flushWithLatch(
        {
          schemaVersion: 1,
          personaChoice: persona,
          centerDraft: priorPayload?.centerDraft ?? null,
          templateDraft: {
            ...priorTemplateDraft,
            selectedTemplateId: values.templateId,
            spawnedClassIds: result.classes.map((c) => c.id),
          } as unknown as Record<string, unknown>,
        },
        { currentStep: 'done' },
      )
      navigate('/setup/done', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        handleSpawnError(err)
        return
      }
      setGenericErrorCopy(
        t('onboarding.spawn.error.generic', { requestId: 'unknown' }),
      )
    }
  })

  const handleAssignConfirmed = (
    index: number,
    result: { email: string; displayName?: string },
  ) => {
    form.setValue(`classes.${index}.teacherEmail`, result.email, {
      shouldDirty: true,
      shouldValidate: true,
    })
    setRowStates((prev) => {
      const next = [...prev]
      next[index] = {
        chip: {
          email: result.email,
          displayName: result.displayName ?? result.email,
          role: 'Teacher',
        },
        starIcon: false,
        composerOpen: false,
      }
      return next
    })
    // Focus return to trigger (Murat-S6)
    queueMicrotask(() => {
      chipTriggerRefs.current.get(index)?.focus()
    })
  }

  const handleComposerClose = (index: number) => {
    setRowStates((prev) => {
      const next = [...prev]
      const current = next[index] ?? {
        chip: null,
        starIcon: false,
        composerOpen: false,
      }
      next[index] = { ...current, composerOpen: false }
      return next
    })
    queueMicrotask(() => {
      chipTriggerRefs.current.get(index)?.focus()
    })
  }

  const handleOpenComposer = (index: number) => {
    setRowStates((prev) => {
      const next = [...prev]
      const current = next[index] ?? {
        chip: null,
        starIcon: false,
        composerOpen: false,
      }
      next[index] = { ...current, composerOpen: true }
      return next
    })
  }

  const handleClearAssignment = (index: number) => {
    form.setValue(`classes.${index}.teacherEmail`, null, {
      shouldDirty: true,
      shouldValidate: true,
    })
    setRowStates((prev) => {
      const next = [...prev]
      next[index] = {
        chip: null,
        starIcon: false,
        composerOpen: false,
      }
      return next
    })
  }

  const submitDisabled =
    spawn.isPending || retryCountdown.isActive || !user

  // R1-C1-P16 — UX-1 Loading state. Gate the form until progress resolves
  // so `draftDefaults` snapshots against real prior-draft data, not an
  // empty row seed that would clobber the server via auto-save.
  if (progress.isLoading) {
    return (
      <section
        aria-labelledby="spawn-page-heading"
        className="mx-auto max-w-4xl"
        aria-busy="true"
      >
        <div
          data-testid="spawn-form-skeleton"
          className="mt-6 h-96 animate-pulse rounded-lg bg-slate-200"
        />
      </section>
    )
  }

  return (
    <section aria-labelledby="spawn-page-heading" className="mx-auto max-w-4xl">
      <p className="text-sm text-slate-500">
        {t('onboarding.spawn.eyebrow', { current: 3, total: 4 })}
      </p>
      <h1
        id="spawn-page-heading"
        className="mt-2 font-serif text-3xl leading-tight text-slate-900"
      >
        {t('onboarding.spawn.title')}
      </h1>
      <p className="mt-2 text-slate-600">
        {t('onboarding.spawn.subtitle')}
      </p>

      {showResumeToast ? (
        <div
          role="status"
          className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"
        >
          {t('onboarding.wizard.resumedFromDraft')}
        </div>
      ) : null}

      {buildFromScratch ? (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">
            {t('onboarding.spawn.customTemplateNotice')}
          </p>
          <p className="mt-1">
            {t('onboarding.spawn.customTemplateNotice.pickInstead')}
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => navigate('/setup/template', { replace: true })}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {t('onboarding.spawn.pickTemplateInsteadCta')}
            </button>
          </div>
          {/* Story 2-3c AC4 (A-B1) — Save-and-finish-later inside the amber
              card is the only exit affordance from the buildFromScratch
              dead-end besides the "Pick a template" redirect. R1-C2-P4
              right-aligns to match the 3 other siblings + R1-C2-P5 uses
              the WCAG-safe slate token via the shared component. */}
          <div className="mt-3 flex justify-end">
            <SaveAndFinishLaterLink
              page="ClassSpawnPage.buildFromScratch"
              flush={autoSave.flush}
              primaryPending={spawn.isPending}
              tone="amber"
              layout="inline"
            />
          </div>
        </div>
      ) : (
        <form
          onSubmit={onSubmit}
          className="mt-6 space-y-4"
          aria-busy={spawn.isPending}
          noValidate
        >
          {fields.map((field, index) => (
            <div key={field.id}>
              <ClassRow
                index={index}
                showDelete={fields.length > 1}
                register={form.register}
                control={form.control}
                onRemove={() => remove(index)}
                chipState={rowStates[index]?.chip ?? null}
                chipStarIcon={rowStates[index]?.starIcon ?? false}
                onOpenComposer={() => handleOpenComposer(index)}
                onClearAssignment={() => handleClearAssignment(index)}
                chipRef={(el) => {
                  if (el) chipTriggerRefs.current.set(index, el)
                  else chipTriggerRefs.current.delete(index)
                }}
              />
              {rowStates[index]?.composerOpen && user ? (
                <AssignTeacherComposer
                  currentUserEmail={user.email}
                  onAssign={(result) => handleAssignConfirmed(index, result)}
                  onClose={() => handleComposerClose(index)}
                />
              ) : null}
            </div>
          ))}

          {fields.length === 1 ? (
            <p className="text-sm text-slate-500">
              {t('onboarding.spawn.rowMinimum')}
            </p>
          ) : null}

          <div className="flex justify-between">
            <button
              type="button"
              onClick={() =>
                append({
                  cohortName: '',
                  startDate: '',
                  teacherEmail: null,
                })
              }
              className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50"
            >
              {t('onboarding.spawn.addClassCta')}
            </button>
            <button
              type="submit"
              disabled={submitDisabled}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {spawn.isPending
                ? t('onboarding.spawn.saveAndSpawnCta.pending', {
                    n: fields.length,
                  })
                : t('onboarding.spawn.saveAndSpawnCta')}
            </button>
          </div>

          {autoSaveWarning ? (
            <div
              role="status"
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
            >
              {t('onboarding.spawn.error.autoSaveWarning')}
            </div>
          ) : null}

          {rateLimitCopy ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {rateLimitCopy}
            </div>
          ) : null}

          {genericErrorCopy ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {genericErrorCopy}
            </div>
          ) : null}

          {/* Story 2-3c AC4 — Save-and-finish-later affordance. Right-aligned
              BELOW the primary "Save & spawn" CTA with mt-3 spacing per
              S-B3 (never beside — fat-finger risk). Shared hook enforces
              double-click prevention + logs flush failures to Sentry
              (R1-C2-P1 + P2 + P3). */}
          <SaveAndFinishLaterLink
            page="ClassSpawnPage"
            flush={autoSave.flush}
            primaryPending={spawn.isPending}
          />
        </form>
      )}
    </section>
  )
}

