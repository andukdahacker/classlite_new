/**
 * PersonaSelectPage — Story 2-3a AC1/AC2/AC3/AC10/AC13/AC14, Task 6.
 *
 * The `/welcome` (screen s00) page. Renders 3 persona cards (Operator /
 * Founder / Solo Teacher) in a `role="radiogroup"` with zero selection on
 * first paint (Sally-B1 fold). Continue button is genuinely disabled until
 * the user picks one. Continue-click sequence per AC3:
 *   POST /api/onboarding/persona → PUT /api/onboarding/progress → navigate.
 *
 * Resume routing (AC10) fires on mount from `useOnboardingProgress()` per
 * the 5-row decision table pinned in the story spec.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ApiError } from '@/lib/api-fetch'
import { useOnboardingProgress } from './api/useOnboardingProgress'
import { useSetPersona } from './api/useSetPersona'
import { usePutOnboardingProgress } from './api/usePutOnboardingProgress'
import type { PersonaValue } from './lib/personaSchema'
import { PERSONA_VALUES, isPersonaValue } from './lib/personaSchema'
import {
  RadioGroupTiles,
} from './components/RadioGroupTile'
import { PersonaCard } from './components/PersonaCard'
import { OperatorIllustration } from './components/illustrations/OperatorIllustration'
import { FounderIllustration } from './components/illustrations/FounderIllustration'
import { SoloIllustration } from './components/illustrations/SoloIllustration'

export default function PersonaSelectPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const progress = useOnboardingProgress()
  const setPersona = useSetPersona()
  const putProgress = usePutOnboardingProgress()

  // `userSelected` tracks whether the user has interacted with the radiogroup
  // in this session. The effective selection reads from `userSelected` first
  // (user's explicit choice trumps a stale resume), then falls back to the
  // persona rehydrated from GET progress on mount.
  const [userSelected, setUserSelected] = useState<PersonaValue | null>(null)
  // R1-P14 — validate the persona field against the enum before trusting it
  // as a `PersonaValue`. A legacy/renamed server value would otherwise render
  // no `aria-checked` selection while `submitDisabled` stays false → user
  // clicks Continue → POST persona sends garbage → generic error.
  const rehydratedPersona: PersonaValue | null = isPersonaValue(
    progress.data?.persona,
  )
    ? progress.data.persona
    : null
  const selected: PersonaValue | null = userSelected ?? rehydratedPersona

  const setSelected = (value: PersonaValue) => {
    setUserSelected(value)
  }

  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<
    'verificationRequired' | 'generic' | null
  >(null)

  // AC10 — resume routing on FIRST successful GET progress only. Once we
  // fire an initial routing decision, subsequent progress-cache changes
  // (from `handleContinue`'s explicit invalidate) must NOT re-trigger the
  // effect — that would race the explicit `navigate('/setup/center')`.
  const hasRoutedOnMountRef = useRef(false)
  useEffect(() => {
    if (!progress.data) return
    if (hasRoutedOnMountRef.current) return
    hasRoutedOnMountRef.current = true
    const { persona, currentStep } = progress.data
    if (currentStep === 'done') {
      navigate('/dashboard', { replace: true })
      return
    }
    if (
      persona !== null &&
      (currentStep === 'template' ||
        currentStep === 'spawn' ||
        currentStep === 'solo_first_class')
    ) {
      navigate('/setup/template', { replace: true })
      return
    }
    if (persona !== null && currentStep === 'center') {
      navigate('/setup/center', { replace: true })
      return
    }
  }, [progress.data, navigate])

  const submitDisabled =
    selected === null || setPersona.isPending || putProgress.isPending

  const handleContinue = async () => {
    if (selected === null) return
    setErrorMessage(null)
    setErrorKind(null)
    try {
      await setPersona.mutateAsync(selected)
      await putProgress.mutateAsync({
        currentStep: 'center',
        payload: {
          schemaVersion: 1,
          personaChoice: selected,
          centerDraft: null,
          templateDraft: null,
        },
      })
      navigate('/setup/center', { replace: true })
    } catch (err) {
      surfaceContinueError(err)
    }
  }

  const surfaceContinueError = (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') {
        setErrorKind('verificationRequired')
        setErrorMessage(
          t('onboarding.persona.error.emailVerificationRequired'),
        )
        return
      }
      if (err.code === 'RATE_LIMIT_EXCEEDED') {
        setErrorKind('generic')
        setErrorMessage(
          t('onboarding.persona.error.rateLimited', {
            seconds: err.retryAfterSeconds ?? 60,
          }),
        )
        return
      }
    }
    setErrorKind('generic')
    setErrorMessage(t('onboarding.persona.error.generic'))
  }

  if (progress.isLoading) {
    return (
      <div
        data-testid="skeleton-onboarding"
        className="grid gap-6 py-16"
        aria-busy="true"
      >
        <div className="h-6 w-64 animate-pulse rounded bg-slate-200" />
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-56 animate-pulse rounded-lg bg-slate-200"
            />
          ))}
        </div>
      </div>
    )
  }

  if (progress.isError) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {t('onboarding.persona.error.generic')}
        </div>
        <button
          type="button"
          onClick={() => void progress.refetch()}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          {t('onboarding.persona.error.retryCta')}
        </button>
      </div>
    )
  }

  const items = [
    {
      value: 'operator' as const,
      ariaLabel: `${t('onboarding.persona.operator.title')}: ${t('onboarding.persona.operator.lede')}`,
      render: ({ selected: isSel }: { selected: boolean }) => (
        <PersonaCard
          illustration={<OperatorIllustration />}
          title={t('onboarding.persona.operator.title')}
          lede={t('onboarding.persona.operator.lede')}
          description={t('onboarding.persona.operator.description')}
          selected={isSel}
        />
      ),
    },
    {
      value: 'founder' as const,
      ariaLabel: `${t('onboarding.persona.founder.title')}: ${t('onboarding.persona.founder.lede')}`,
      render: ({ selected: isSel }: { selected: boolean }) => (
        <PersonaCard
          illustration={<FounderIllustration />}
          title={t('onboarding.persona.founder.title')}
          lede={t('onboarding.persona.founder.lede')}
          description={t('onboarding.persona.founder.description')}
          selected={isSel}
        />
      ),
    },
    {
      value: 'solo_teacher' as const,
      ariaLabel: `${t('onboarding.persona.solo.title')}: ${t('onboarding.persona.solo.lede')}`,
      render: ({ selected: isSel }: { selected: boolean }) => (
        <PersonaCard
          illustration={<SoloIllustration />}
          title={t('onboarding.persona.solo.title')}
          lede={t('onboarding.persona.solo.lede')}
          description={t('onboarding.persona.solo.description')}
          selected={isSel}
        />
      ),
    },
  ] satisfies ReadonlyArray<{
    value: PersonaValue
    ariaLabel: string
    render: (s: { selected: boolean }) => React.ReactNode
  }>

  // Assert the enum stays in sync with the card list.
  if (items.length !== PERSONA_VALUES.length) {
    throw new Error('persona card list drifted from PERSONA_VALUES enum')
  }

  return (
    <section className="mx-auto max-w-5xl py-12">
      <div className="text-center">
        <p className="text-sm uppercase tracking-wider text-slate-500">
          {t('onboarding.persona.eyebrow')}
        </p>
        <h1 id="persona-title" className="mt-3 font-serif text-4xl italic">
          {t('onboarding.persona.title')}
        </h1>
        <p className="mt-2 text-slate-600">
          {t('onboarding.persona.subtitle')}
        </p>
      </div>

      <RadioGroupTiles<PersonaValue>
        ariaLabelledBy="persona-title"
        value={selected}
        onChange={setSelected}
        items={items}
        className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      />

      {errorMessage ? (
        <div
          role="alert"
          className="mx-auto mt-6 max-w-2xl rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <p>{errorMessage}</p>
          {errorKind === 'verificationRequired' ? (
            <p className="mt-2">
              <a href="/verify-email" className="underline">
                /verify-email
              </a>
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 flex justify-center">
        <button
          type="button"
          disabled={submitDisabled}
          onClick={() => void handleContinue()}
          className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-6 py-3 text-sm font-medium text-white disabled:opacity-40"
        >
          {(setPersona.isPending || putProgress.isPending) ? (
            <span
              data-testid="persona-continue-spinner"
              aria-hidden="true"
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
            />
          ) : null}
          {t('onboarding.persona.continueCta')}
        </button>
      </div>
    </section>
  )
}
