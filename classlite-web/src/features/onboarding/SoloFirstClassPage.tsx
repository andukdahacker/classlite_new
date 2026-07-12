/**
 * SoloFirstClassPage — Story 2-3b AC8/AC9/AC10/AC11/AC12/AC13, Task 7.
 *
 * The `/setup/first-class` (s05) Solo Teacher variant. Simplified single-
 * class form: cohortName + startDate + read-only teacher pill. Optional
 * horizontal template ribbon (Sally-S6). Wire submits
 * `teacherEmail: user.email` — server derives `explicit_self` (Solo IS
 * explicitly the teacher; Winston-W4 wire-null decoupling does NOT apply).
 *
 * Resume routing (AC10 rows 8–9):
 *   persona='operator'|'founder' → /setup/spawn (wrong-persona guard)
 *   persona=null → /welcome
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError } from '@/lib/api-fetch'
import { useAuth } from '@/hooks/useAuth'
import { authKeys } from '@/features/auth/api/authKeys'
import { AssignChip } from '@/components/domain/AssignChip'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import { useOnboardingProgress } from './api/useOnboardingProgress'
import { useSpawnClasses } from './api/useSpawnClasses'
import { useListTemplates } from './api/useListTemplates'
import { useOnboardingAutoSave } from './OnboardingAutoSaveContext'
import { useCountdown } from './hooks/useCountdown'
import { TemplateRibbon } from './components/TemplateRibbon'
import { queueArrivalToast } from './arrivalToast'

interface SoloFormValues {
  cohortName: string
  startDate: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function useSoloSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        cohortName: z
          .string()
          .transform((v) => v.trim())
          .refine((v) => Array.from(v).length >= 1, {
            message: t('onboarding.spawn.error.cohortRequired'),
          })
          .refine((v) => Array.from(v).length <= 120, {
            message: t('onboarding.spawn.error.cohortMax', { max: 120 }),
          }),
        startDate: z
          .string()
          .refine((v) => ISO_DATE_RE.test(v), {
            message: t('onboarding.spawn.error.startDateInvalid'),
          }),
      }),
    [t],
  )
}

export default function SoloFirstClassPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const progress = useOnboardingProgress()
  const templates = useListTemplates()
  const spawn = useSpawnClasses()
  const autoSave = useOnboardingAutoSave()
  const schema = useSoloSchema()

  const persona = progress.data?.persona ?? null
  const priorPayload = progress.data?.payload ?? null
  const priorTemplateDraft = useMemo(
    () =>
      (priorPayload?.templateDraft ?? {}) as unknown as TemplateDraftPayload,
    [priorPayload?.templateDraft],
  )

  const [templateId, setTemplateId] = useState<string | null>(
    priorTemplateDraft.selectedTemplateId ?? null,
  )
  const [buildFromScratch, setBuildFromScratch] = useState(
    priorTemplateDraft.buildFromScratch === true,
  )
  // R1-C1-P18 — auto-pick the first template only when it has a real id
  // string. Older seeds returning entries with undefined `id` would leave
  // templateId as `undefined`, defeating the `templateId === null` submit
  // gate (undefined !== null).
  useEffect(() => {
    if (templateId !== null || buildFromScratch) return
    if (!templates.data || templates.data.length === 0) return
    const firstId = templates.data[0]?.id
    if (typeof firstId !== 'string' || firstId.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTemplateId(firstId)
  }, [templates.data, templateId, buildFromScratch])

  // R1-C1-P2 — rehydrate form defaults from prior draft when progress
  // resolves. `defaultValues` is a snapshot at mount; when the GET arrives
  // AFTER mount we need `form.reset(...)` to seed RHF with the saved row.
  const draftDefaults: SoloFormValues = useMemo(() => {
    const saved = priorTemplateDraft.classesDraft?.[0]
    return {
      cohortName: saved?.cohortName ?? '',
      startDate: saved?.startDate ?? '',
    }
  }, [priorTemplateDraft])

  const form = useForm<SoloFormValues>({
    resolver: zodResolver(schema),
    defaultValues: draftDefaults,
    mode: 'onTouched',
  })

  // Reset RHF to draft defaults when the user is not editing — one-shot on
  // GET resolution + safe against clobbering in-progress typing.
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

  // AC10 resume routing rows 8–9.
  const routingResolvedRef = useRef(false)
  useEffect(() => {
    if (progress.isLoading) return
    // R1-C1-P9 — do NOT punt to /welcome on transient GET error; let the
    // page render its (skeleton or error-safe) UI and let the query retry.
    if (progress.isError) return
    if (routingResolvedRef.current) return
    if (persona === null) {
      routingResolvedRef.current = true
      navigate('/welcome', { replace: true })
      return
    }
    if (persona === 'operator' || persona === 'founder') {
      routingResolvedRef.current = true
      navigate('/setup/spawn', { replace: true })
      return
    }
    routingResolvedRef.current = true
  }, [progress.isLoading, progress.isError, persona, navigate])

  // R1-C1-P2 — Solo autosave: scheduleSave on watched-value change, mirror
  // the ClassSpawnPage pattern. Spreads `priorTemplateDraft` to preserve
  // `selectedTemplateId` + any other fields (Amelia-S5 invariant).
  const watchedCohortName = useWatch({
    control: form.control,
    name: 'cohortName',
  })
  const watchedStartDate = useWatch({
    control: form.control,
    name: 'startDate',
  })
  useEffect(() => {
    if (progress.isLoading || progress.isError) return
    if (!user) return
    autoSave.scheduleSave({
      schemaVersion: 1,
      personaChoice: persona,
      centerDraft: priorPayload?.centerDraft ?? null,
      templateDraft: {
        ...priorTemplateDraft,
        selectedTemplateId: buildFromScratch ? null : templateId,
        buildFromScratch: buildFromScratch ? true : null,
        classesDraft: [
          {
            cohortName: watchedCohortName ?? '',
            startDate: watchedStartDate ?? '',
            teacherEmail: user.email,
          },
        ],
      } as unknown as Record<string, unknown>,
    })
  }, [
    watchedCohortName,
    watchedStartDate,
    templateId,
    buildFromScratch,
    autoSave,
    persona,
    user,
    progress.isLoading,
    progress.isError,
    priorPayload?.centerDraft,
    priorTemplateDraft,
  ])

  const retryCountdown = useCountdown({ initialSeconds: 0 })
  const [rateLimitCopy, setRateLimitCopy] = useState<string | null>(null)
  const [genericErrorCopy, setGenericErrorCopy] = useState<string | null>(null)
  const [autoSaveWarning, setAutoSaveWarning] = useState(false)

  const handleSpawnError = useCallback(
    (err: ApiError) => {
      // R1-C1-P10 — TEMPLATE_NOT_FOUND handling for Solo. Stale
      // selectedTemplateId (deleted template) resets to null so the
      // auto-pick effect re-seeds from templates.data[0].
      if (err.status === 404 && err.code === 'TEMPLATE_NOT_FOUND') {
        setTemplateId(null)
        setBuildFromScratch(false)
        void templates.refetch()
        setGenericErrorCopy(t('onboarding.spawn.error.templateNotFound'))
        return
      }
      if (err.status === 403) {
        if (err.code === 'INVALID_TENANT_CLAIM') {
          queryClient.setQueryData(authKeys.session(), null)
          navigate('/login', { replace: true })
          return
        }
        if (err.code === 'EMAIL_VERIFICATION_REQUIRED') {
          navigate('/verify-email', { replace: true })
          return
        }
        if (err.code === 'CENTER_REQUIRED') {
          queueArrivalToast('onboarding.spawn.error.centerRequiredToast')
          navigate('/setup/center', { replace: true })
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
        if (seconds > 0) {
          retryCountdown.reset(seconds)
          setRateLimitCopy(
            t('onboarding.spawn.error.rateLimited', { seconds }),
          )
        } else {
          // R1-C1-P12 — Retry-After: 0 (or missing header) falls to generic
          // copy; announcing "Try again in 0 seconds" is a Sally-I2 violation.
          setGenericErrorCopy(
            t('onboarding.spawn.error.generic', {
              requestId: err.requestId ?? 'unknown',
            }),
          )
        }
        return
      }
      setGenericErrorCopy(
        t('onboarding.spawn.error.generic', {
          requestId: err.requestId ?? 'unknown',
        }),
      )
    },
    [navigate, queryClient, retryCountdown, t, templates],
  )

  const onSubmit = form.handleSubmit(async (values) => {
    if (!user) return
    setGenericErrorCopy(null)
    setRateLimitCopy(null)
    setAutoSaveWarning(false)
    // R1-C1-P7 — the pre-submit flush is not silent. A failure signals a
    // stalled network condition; surface it via `autoSaveWarning` (Murat-S5
    // three-state gate) while still proceeding with the spawn (spawn is
    // forward progress).
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
    const effectiveTemplateId = buildFromScratch ? null : templateId
    if (effectiveTemplateId === null) {
      // R1-C1-P15 — buildFromScratch is a blocked path in v1. AC8 requires
      // the AC4 blocked variant (Alert + CTA to pick a template). The UI
      // below the form renders that variant when `buildFromScratch === true`,
      // so this guard is defensive; the submit CTA is hidden in that variant.
      return
    }
    try {
      const result = await spawn.mutateAsync({
        templateId: effectiveTemplateId,
        classes: [
          {
            cohortName: values.cohortName,
            startDate: values.startDate,
            teacherEmail: user.email,
          },
        ],
      })
      // R1-C2-P1 — terminal PUT bumps `currentStep: 'done'` per AC6.
      await autoSave.flushWithLatch(
        {
          schemaVersion: 1,
          personaChoice: persona,
          centerDraft: priorPayload?.centerDraft ?? null,
          templateDraft: {
            ...priorTemplateDraft,
            selectedTemplateId: effectiveTemplateId,
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

  const submitDisabled =
    spawn.isPending ||
    retryCountdown.isActive ||
    !user ||
    (!buildFromScratch && templateId === null)

  // R1-C1-P17 — UX-1 Loading state. Gate the form until progress resolves
  // so the mount-time draftDefaults snapshot has the saved row available.
  if (progress.isLoading) {
    return (
      <section
        aria-labelledby="solo-page-heading"
        className="mx-auto max-w-3xl"
        aria-busy="true"
      >
        <div
          data-testid="solo-form-skeleton"
          className="mt-6 h-64 animate-pulse rounded-lg bg-slate-200"
        />
      </section>
    )
  }

  return (
    <section aria-labelledby="solo-page-heading" className="mx-auto max-w-3xl">
      <p className="text-sm text-slate-500">
        {t('onboarding.solo.eyebrow', { current: 3, total: 3 })}
      </p>
      <h1
        id="solo-page-heading"
        className="mt-2 font-serif text-3xl leading-tight text-slate-900"
      >
        {t('onboarding.solo.title')}
      </h1>
      <p className="mt-2 text-slate-600">{t('onboarding.solo.subtitle')}</p>

      {/* R1-C1-P15 — AC8 buildFromScratch blocked variant mirrors AC4
          (Alert + prominent "Pick a template" CTA replacing the submit).
          The submit form below is only rendered on the template path. */}
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
              onClick={() => setBuildFromScratch(false)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {t('onboarding.spawn.pickTemplateInsteadCta')}
            </button>
          </div>
        </div>
      ) : (
      <form
        onSubmit={onSubmit}
        className="mt-6 space-y-4"
        aria-busy={spawn.isPending}
        noValidate
      >
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-slate-700">
                {t('onboarding.spawn.cohortName.label')}
              </span>
              <input
                type="text"
                placeholder={t('onboarding.spawn.cohortName.placeholder')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...form.register('cohortName')}
              />
              {form.formState.errors.cohortName?.message ? (
                <p className="mt-1 text-xs text-red-700">
                  {form.formState.errors.cohortName.message}
                </p>
              ) : null}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-700">
                {t('onboarding.spawn.startDate.label')}
              </span>
              <input
                type="date"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                {...form.register('startDate')}
              />
              {form.formState.errors.startDate?.message ? (
                <p className="mt-1 text-xs text-red-700">
                  {form.formState.errors.startDate.message}
                </p>
              ) : null}
            </label>
          </div>
          <div className="mt-4">
            <span className="mb-1 block text-sm text-slate-700">
              {t('onboarding.spawn.teacher.label')}
            </span>
            <AssignChip
              state="assigned"
              value={{
                userId: user?.id,
                email: user?.email,
                displayName: t('onboarding.solo.teacher.locked', {
                  userFullName: user?.displayName ?? user?.email ?? 'You',
                }),
                role: 'Owner',
              }}
              lockedTo="self"
              onOpenComposer={() => undefined}
              onClear={() => undefined}
            />
            <p className="mt-1 text-xs text-slate-500">
              {t('onboarding.solo.teacher.helper')}
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-medium text-slate-900">
            {t('onboarding.solo.templatePickDetails')}
          </h2>
          {templates.isLoading ? (
            <div className="mt-4 flex gap-4 overflow-x-auto">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  aria-busy="true"
                  className="h-32 min-w-[220px] animate-pulse rounded-lg bg-slate-200"
                />
              ))}
            </div>
          ) : templates.data ? (
            <TemplateRibbon
              templates={templates.data.slice(0, 4)}
              selectedValue={buildFromScratch ? null : templateId}
              onChange={(id, bfs) => {
                setTemplateId(id)
                setBuildFromScratch(bfs)
              }}
            />
          ) : null}
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitDisabled}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {t('onboarding.solo.saveAndSpawnCta')}
          </button>
        </div>

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

        {autoSaveWarning ? (
          <div
            role="status"
            className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {t('onboarding.spawn.error.autoSaveWarning')}
          </div>
        ) : null}
      </form>
      )}
    </section>
  )
}
