/**
 * CenterSetupPage — Story 2-3a AC4/AC5/AC6/AC7/AC10/AC11/AC13/AC14, Task 7.
 *
 * The `/setup/center` (screen s01) page. RHF + zodResolver + `values` prop
 * (Amelia-B4 fold — `defaultValues` snapshots at mount and would silently
 * discard a saved draft rehydrated by a later GET progress).
 *
 * Submit sequence per AC7:
 *   client Zod → POST /api/centers → cache write + PUT progress →
 *   navigate('/setup/template', { replace: true }).
 *
 * Error branches: 409 → two-line recovery + Open Dashboard CTA (Sally-S4),
 * 422 → RHF field errors, 403 → verify-email link, 429 → countdown-disabled
 * submit + interpolated seconds (Murat-B3), 500 → generic + requestId.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ApiError } from '@/lib/api-fetch'
import {
  BRAND_COLOR_VALUES,
  DEFAULT_BRAND_COLOR,
  useCenterSetupSchema,
  type BrandColorValue,
  type CenterSetupFormValues,
} from './lib/centerSetupSchema'
import { slugifyPreview } from './lib/slugPreview'
import { getInitials } from './lib/letterMark'
import { useCreateCenter } from './api/useCreateCenter'
import { useOnboardingProgress } from './api/useOnboardingProgress'
import { usePutOnboardingProgress } from './api/usePutOnboardingProgress'
import { useOnboardingAutoSave } from './OnboardingAutoSaveContext'
import { onboardingSubmitFlag } from './onboardingSubmitFlag'
import { useCountdown } from './hooks/useCountdown'
import { RadioGroupTiles } from './components/RadioGroupTile'

/* eslint-disable no-restricted-syntax -- brand-color wire values (FU-2-3a-C) */
const BRAND_COLOR_LABEL_KEYS: Record<BrandColorValue, string> = {
  '#1e3a8a': 'onboarding.center.form.brandColor.deepNavy',
  '#d97706': 'onboarding.center.form.brandColor.amber',
  '#166534': 'onboarding.center.form.brandColor.green',
  '#991b1b': 'onboarding.center.form.brandColor.red',
  '#b45309': 'onboarding.center.form.brandColor.brown',
  '#6b6f7a': 'onboarding.center.form.brandColor.gray',
}
/* eslint-enable no-restricted-syntax */

interface AlreadyHasCenterDetails {
  centerName: string
  shortCode: string
}

interface CenterErrorState {
  kind:
    | 'alreadyHasCenter'
    | 'validation'
    | 'verificationRequired'
    | 'rateLimited'
    | 'generic'
  message: string
  requestId: string | null
  alreadyHasCenter?: AlreadyHasCenterDetails
  retryAfterSeconds?: number
}

interface ValidationErrorDetail {
  field?: string
  message?: string
}

export default function CenterSetupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const progress = useOnboardingProgress()
  const createCenter = useCreateCenter()
  const putProgress = usePutOnboardingProgress()
  const autoSave = useOnboardingAutoSave()
  const schema = useCenterSetupSchema()

  const [errorState, setErrorState] = useState<CenterErrorState | null>(null)
  // 429 Retry-After countdown via shared hook (Story 2-3b Task 3.4 refactor —
  // Amelia-B6 fold; extracted so ClassSpawnPage + SoloFirstClassPage consume
  // the same tick + cleanup semantics).
  const retryCountdown = useCountdown({ initialSeconds: 0 })
  const remainingRetrySeconds = retryCountdown.remainingSeconds
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const draftDefaults: CenterSetupFormValues = useMemo(() => {
    const draft = progress.data?.payload?.centerDraft ?? null
    return {
      name: draft?.name ?? '',
      brandColor:
        (draft?.brandColor as BrandColorValue | null | undefined) ??
        DEFAULT_BRAND_COLOR,
    }
  }, [progress.data])

  // R1-P39 (R1-D3): skip re-sync from GET progress when the user has typed
  // since the last commit. Uses `defaultValues` (mount-snapshot, Amelia-B4's
  // original concern) PLUS an effect that calls `form.reset(draftDefaults)`
  // ONLY when the form is not dirty. First GET progress resolve lands
  // cleanly; subsequent server echoes during typing do not clobber the
  // user's input. `form.reset` is a method call — React 19's
  // set-state-in-effect lint targets direct setState hooks, not RHF's
  // internal state mutation, so this pattern stays clean.
  const form = useForm<CenterSetupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: draftDefaults,
    mode: 'onTouched',
  })
  const isDirty = form.formState.isDirty
  useEffect(() => {
    if (!isDirty) {
      form.reset(draftDefaults, { keepDirty: false })
    }
  }, [draftDefaults, isDirty, form])

  // AC14 — focus lands on the center-name input on mount.
  useEffect(() => {
    nameInputRef.current?.focus()
    // NOTE: We intentionally do NOT clear `onboardingSubmitFlag` on
    // unmount — the flag is reset in both branches of `onSubmit` (success
    // + error). Clearing on unmount would race the layout's post-navigate
    // re-render.
  }, [])

  const watchedName = useWatch({ control: form.control, name: 'name' }) ?? ''
  const watchedBrandColor =
    useWatch({ control: form.control, name: 'brandColor' }) ?? DEFAULT_BRAND_COLOR

  // Auto-save on tracked field change.
  useEffect(() => {
    if (progress.isLoading) return
    if ((watchedName ?? '').trim().length === 0) return
    autoSave.scheduleSave({
      schemaVersion: 1,
      personaChoice: progress.data?.persona ?? null,
      centerDraft: {
        name: watchedName,
        brandColor: watchedBrandColor,
        logoUrl: null,
      },
      templateDraft: null,
    })
  }, [
    watchedName,
    watchedBrandColor,
    autoSave,
    progress.data?.persona,
    progress.isLoading,
  ])

  // AC10 — center-step drift protection.
  useEffect(() => {
    if (!progress.data) return
    const { persona, currentStep } = progress.data
    if (currentStep === 'done') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (persona === null) {
      navigate('/welcome', { replace: true })
      return
    }
    // R1-P16: drift protection for a deep-link race — user arrives at
    // /setup/center with persona set but `currentStep` still at 'persona'
    // (server hasn't observed the PUT progress that AC3 fires). Bounce
    // back to /welcome so the PUT lands before the center form paints.
    if (currentStep === 'persona') {
      navigate('/welcome', { replace: true })
      return
    }
    // Story 2-3b Amelia-B4 amendment — persona-branch the currentStep→route
    // dispatch. Solo Teacher's step order goes through `/setup/first-class`,
    // NOT `/setup/template`; without this branch the first Solo user who
    // resumes would double-redirect.
    if (
      currentStep === 'template' ||
      currentStep === 'spawn' ||
      currentStep === 'solo_first_class'
    ) {
      if (persona === 'solo_teacher') {
        navigate('/setup/first-class', { replace: true })
        return
      }
      const target =
        currentStep === 'template' ? '/setup/template' : '/setup/spawn'
      navigate(target, { replace: true })
    }
  }, [progress.data, navigate])

  const submitDisabled =
    createCenter.isPending ||
    autoSave.savingState === 'saving' ||
    remainingRetrySeconds > 0

  const onSubmit = form.handleSubmit(async (data) => {
    setErrorState(null)
    // Flip the layout-guard suppression flag BEFORE the mutation kicks off.
    // The layout's `session.center != null → /dashboard` guard would
    // otherwise race the navigate below (the cache write in
    // `useCreateCenter.onSuccess` re-renders `useAuth` before our navigate
    // fires); the flag lets the layout skip the redirect while we complete
    // the intended /setup/template transition. Reset in both branches
    // (success + error) so the flag never latches across submits.
    onboardingSubmitFlag.set(true)
    try {
      const created = await createCenter.mutateAsync({
        name: data.name.trim(),
        brandColor: data.brandColor,
        logoUrl: null,
      })
      // Spec-order: PUT progress advance BEFORE navigate — with the guard-
      // suppression flag holding through the transition, we no longer need
      // to reverse the sequence. If PUT progress fails, the user stays on
      // /setup/center with an error surface (not wedged on /dashboard by
      // the banner-to-nonexistent-route loop).
      // Story 2-3b Amelia-B4 amendment — persona-branch the next-step target.
      // Solo Teacher goes to /setup/first-class (`currentStep: 'solo_first_class'`);
      // Operator + Founder go to /setup/template.
      const isSolo = progress.data?.persona === 'solo_teacher'
      const nextStep = isSolo ? 'solo_first_class' : 'template'
      const nextRoute = isSolo ? '/setup/first-class' : '/setup/template'
      await putProgress.mutateAsync({
        currentStep: nextStep,
        payload: {
          schemaVersion: 1,
          personaChoice: progress.data?.persona ?? null,
          centerDraft: {
            name: created.name,
            brandColor: created.brandColor,
            logoUrl: created.logoUrl,
          },
          templateDraft: null,
        },
      })
      navigate(nextRoute, { replace: true })
      onboardingSubmitFlag.set(false)
    } catch (err) {
      onboardingSubmitFlag.set(false)
      surfaceCenterError(err)
    }
  })

  const surfaceCenterError = (err: unknown) => {
    if (!(err instanceof ApiError)) {
      setErrorState({
        kind: 'generic',
        message: t('onboarding.center.error.generic', { requestId: 'unknown' }),
        requestId: null,
      })
      return
    }
    if (err.code === 'USER_ALREADY_HAS_CENTER') {
      const details = extractAlreadyHasCenter(err.details)
      // R1-P18: if the server omits either field the interpolated copy
      // renders "(.classlite.app)" — a visibly broken message. Fall back
      // to a generic 409 copy that doesn't try to name the sibling center.
      const useSpecific =
        details !== null &&
        details.centerName.length > 0 &&
        details.shortCode.length > 0
      setErrorState({
        kind: 'alreadyHasCenter',
        message: useSpecific
          ? t('onboarding.center.error.userAlreadyHasCenter', {
              centerName: details.centerName,
              shortCode: details.shortCode,
            })
          : t('onboarding.center.error.userAlreadyHasCenterGeneric'),
        requestId: err.requestId,
        alreadyHasCenter: details ?? undefined,
      })
      return
    }
    if (err.code === 'VALIDATION_ERROR') {
      const details = err.details as ValidationErrorDetail[] | undefined
      if (Array.isArray(details)) {
        for (const item of details) {
          if (
            typeof item.field === 'string' &&
            typeof item.message === 'string' &&
            (item.field === 'name' || item.field === 'brandColor')
          ) {
            form.setError(item.field as 'name' | 'brandColor', {
              message: item.message,
            })
          }
        }
      }
      setErrorState({
        kind: 'validation',
        message: t('onboarding.center.error.nameInvalid'),
        requestId: err.requestId,
      })
      return
    }
    if (err.code === 'EMAIL_VERIFICATION_REQUIRED') {
      setErrorState({
        kind: 'verificationRequired',
        message: t('onboarding.center.error.emailVerificationRequired'),
        requestId: err.requestId,
      })
      return
    }
    if (err.code === 'RATE_LIMIT_EXCEEDED') {
      const seconds = err.retryAfterSeconds ?? 60
      setErrorState({
        kind: 'rateLimited',
        // Message is re-interpolated on each render using
        // `remainingRetrySeconds` (below in the alert JSX) so the seconds
        // count down visually. Storing the seed here for a11y announcement.
        message: t('onboarding.center.error.rateLimited', { seconds }),
        requestId: err.requestId,
        retryAfterSeconds: seconds,
      })
      // Guard against `Retry-After: 0` — skip the disable window entirely
      // rather than flashing "Try again in 0s" for one tick.
      if (seconds > 0) {
        retryCountdown.reset(seconds)
      }
      return
    }
    setErrorState({
      kind: 'generic',
      message: t('onboarding.center.error.generic', {
        requestId: err.requestId ?? 'unknown',
      }),
      requestId: err.requestId,
    })
  }

  const shortCode = slugifyPreview(watchedName)
  const initials = getInitials(watchedName)

  const brandColorItems = BRAND_COLOR_VALUES.map((color) => ({
    value: color,
    ariaLabel: t(BRAND_COLOR_LABEL_KEYS[color]),
    render: ({ selected }: { selected: boolean }) => (
      <span
        aria-hidden="true"
        className={
          'block h-9 w-9 rounded-full border-2 transition-colors ' +
          (selected ? 'border-slate-900' : 'border-transparent')
        }
        style={{ backgroundColor: color }}
      />
    ),
  }))

  return (
    <section className="mx-auto max-w-xl py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm text-slate-500">
          {t('onboarding.center.step', { current: 2, total: 4 })}
        </p>
        <h1 className="mt-2 font-serif text-3xl italic">
          {t('onboarding.center.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('onboarding.center.subtitle')}
        </p>

        <form className="mt-8 space-y-6" onSubmit={(e) => void onSubmit(e)}>
          <div>
            <label
              htmlFor="center-name"
              className="block text-sm font-medium text-slate-800"
            >
              {t('onboarding.center.form.nameLabel')}
            </label>
            {(() => {
              // R1-P15: hoist the register() result so the ref callback and
              // the spread share ONE call. The prior double `form.register('name')`
              // produced a fresh ref fn identity per render, causing subtle
              // ref-churn with the `values` reactive rehydrate.
              const registered = form.register('name')
              return (
                <input
                  id="center-name"
                  type="text"
                  autoComplete="off"
                  placeholder={t('onboarding.center.form.namePlaceholder')}
                  {...registered}
                  ref={(el) => {
                    nameInputRef.current = el
                    registered.ref(el)
                  }}
                  className="mt-2 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              )
            })()}
            <p className="mt-1 text-xs text-slate-500">
              {t('onboarding.center.form.branchesCaption')}
            </p>
            <p className="mt-2 text-xs text-slate-600">
              <span className="text-slate-500">
                {t('onboarding.center.form.shortCodePreviewLabel')}:
              </span>{' '}
              <span className="font-mono">
                {shortCode
                  ? `${shortCode}.classlite.app`
                  : t('onboarding.center.form.shortCodeFallback')}
              </span>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {t('onboarding.center.form.shortCodeCaveat')}
            </p>
            {form.formState.errors.name?.message ? (
              <p className="mt-2 text-sm text-red-700">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          <div>
            <p className="block text-sm font-medium text-slate-800">
              {t('onboarding.center.form.brandingLabel')}
            </p>
            <RadioGroupTiles<BrandColorValue>
              ariaLabel={t('onboarding.center.form.brandingLabel')}
              value={watchedBrandColor as BrandColorValue}
              onChange={(v) =>
                form.setValue('brandColor', v, { shouldDirty: true })
              }
              items={brandColorItems}
              className="mt-2 flex gap-3"
            />
            <p className="mt-2 text-xs text-slate-500">
              {t('onboarding.center.form.uploadLogoCaption')}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={
                'flex h-14 w-14 items-center justify-center rounded-md font-serif text-lg text-white ' +
                (initials === '' ? 'border border-dashed border-slate-300' : '')
              }
              style={{
                backgroundColor: initials === '' ? undefined : watchedBrandColor,
              }}
            >
              {initials}
            </span>
            <p className="text-xs text-slate-500">
              {t('onboarding.center.form.nextCaption')}
            </p>
          </div>

          {errorState ? (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
            >
              <p>
                {errorState.kind === 'rateLimited' && remainingRetrySeconds > 0
                  ? t('onboarding.center.error.rateLimited', {
                      seconds: remainingRetrySeconds,
                    })
                  : errorState.message}
              </p>
              {errorState.kind === 'alreadyHasCenter' ? (
                <>
                  <p className="mt-2 text-red-800">
                    {t('onboarding.center.error.userAlreadyHasCenter.hint')}
                  </p>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={() => navigate('/dashboard')}
                      className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                    >
                      Open Dashboard →
                    </button>
                    <a
                      href="/support?type=account-security"
                      className="text-xs underline"
                    >
                      Contact support
                    </a>
                  </div>
                </>
              ) : null}
              {errorState.kind === 'verificationRequired' ? (
                <p className="mt-2">
                  <a href="/verify-email" className="underline">
                    /verify-email
                  </a>
                </p>
              ) : null}
              {errorState.requestId ? (
                <p className="mt-2 font-mono text-xs text-slate-500">
                  {errorState.requestId}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-3">
            <button
              type="submit"
              disabled={submitDisabled}
              className="w-full rounded-md bg-slate-900 px-6 py-3 text-sm font-medium text-white disabled:opacity-40"
            >
              {t('onboarding.center.form.saveContinueCta')}
            </button>
            <button
              type="button"
              className="text-xs text-slate-500 underline"
              onClick={async () => {
                // R1-P12: await the flush so the PUT lands BEFORE the
                // navigate unmounts the auto-save hook and drops the
                // in-flight settle.
                try {
                  await autoSave.flush()
                } finally {
                  navigate('/dashboard', { replace: true })
                }
              }}
            >
              {t('onboarding.wizard.saveAndFinishLater')}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}

function extractAlreadyHasCenter(
  details: unknown,
): AlreadyHasCenterDetails | null {
  if (details && typeof details === 'object') {
    const record = details as Record<string, unknown>
    const centerName =
      typeof record.centerName === 'string' ? record.centerName : ''
    const shortCode =
      typeof record.shortCode === 'string' ? record.shortCode : ''
    if (centerName.length === 0 && shortCode.length === 0) return null
    return { centerName, shortCode }
  }
  return null
}
