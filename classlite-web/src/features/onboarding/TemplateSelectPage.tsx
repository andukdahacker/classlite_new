/**
 * TemplateSelectPage — Story 2-3b AC1/AC2/AC3/AC10/AC11/AC12/AC13, Task 5.
 *
 * The `/setup/template` (s02 Operator, s07 Founder) page. Renders the
 * template grid + Build-from-scratch tile inside a `role="radiogroup"`,
 * with an inline preview drawer that expands below the grid on selection.
 *
 * Resume-routing (AC10 rows 1–4) fires on FIRST successful GET progress
 * only; subsequent progress-cache changes must NOT re-trigger routing (the
 * explicit `navigate('/setup/spawn')` on Continue would race).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-fetch'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'
import { useOnboardingProgress } from './api/useOnboardingProgress'
import { usePutOnboardingProgress } from './api/usePutOnboardingProgress'
import { useListTemplates, type Template } from './api/useListTemplates'
import { useOnboardingAutoSave } from './OnboardingAutoSaveContext'
import { RadioGroupTiles } from './components/RadioGroupTile'
import { TemplateCard } from './components/TemplateCard'
import { BuildFromScratchTile } from './components/BuildFromScratchTile'
import { TemplatePreview } from './components/TemplatePreview'
import { consumeArrivalToast } from './arrivalToast'

const BUILD_FROM_SCRATCH_VALUE = '__build_from_scratch__'

export default function TemplateSelectPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const progress = useOnboardingProgress()
  const templates = useListTemplates()
  const putProgress = usePutOnboardingProgress()
  const autoSave = useOnboardingAutoSave()

  const [selectedValue, setSelectedValue] = useState<string | null>(null)

  // R1-C1-P13 arrival-toast plumbing — surface toasts queued by upstream
  // pages (e.g. ClassSpawnPage's TEMPLATE_NOT_FOUND / CENTER_REQUIRED
  // redirects) after this page mounts. `consumeArrivalToast` returns the
  // pending key + clears it in one call.
  useEffect(() => {
    const pending = consumeArrivalToast()
    if (pending) toast.info(t(pending))
  }, [t])

  // AC10 rows 1–4 — resume routing on FIRST successful GET only.
  const routingResolvedFromFreshDataRef = useRef(false)
  useEffect(() => {
    if (progress.isLoading) return
    // R1-C1-P9 — GET error must not punt user to /welcome. Stay on-page and
    // render the templates.isError branch (or the loading skeleton while a
    // retry is inflight); do NOT re-run the persona-null → /welcome branch
    // against undefined progress.data.
    if (progress.isError) return
    if (routingResolvedFromFreshDataRef.current) return
    const persona = progress.data?.persona ?? null
    const currentStep = progress.data?.currentStep ?? null
    if (persona === null) {
      routingResolvedFromFreshDataRef.current = true
      navigate('/welcome', { replace: true })
      return
    }
    if (persona === 'solo_teacher') {
      routingResolvedFromFreshDataRef.current = true
      navigate('/setup/first-class', { replace: true })
      return
    }
    // R1-C1-P11 — currentStep === 'center' means the user hasn't finished
    // center setup. Route back to /setup/center rather than accepting a
    // template pick against a non-existent center (would 403 CENTER_REQUIRED
    // at the spawn step).
    if (currentStep === 'center') {
      routingResolvedFromFreshDataRef.current = true
      navigate('/setup/center', { replace: true })
      return
    }
    if (currentStep === 'done') {
      routingResolvedFromFreshDataRef.current = true
      navigate('/dashboard', { replace: true })
      return
    }
    if (currentStep === 'spawn' || currentStep === 'solo_first_class') {
      routingResolvedFromFreshDataRef.current = true
      navigate('/setup/spawn', { replace: true })
      return
    }
    routingResolvedFromFreshDataRef.current = true
  }, [progress.isLoading, progress.isError, progress.data, navigate])

  const selectedTemplate: Template | null = useMemo(() => {
    if (!templates.data || selectedValue === null) return null
    if (selectedValue === BUILD_FROM_SCRATCH_VALUE) return null
    return templates.data.find((tpl: Template) => tpl.id === selectedValue) ?? null
  }, [templates.data, selectedValue])
  const buildFromScratchSelected = selectedValue === BUILD_FROM_SCRATCH_VALUE

  const handleContinue = async () => {
    if (selectedValue === null) return
    // R1-C1-P5 — flush any inflight debounced auto-save before the explicit
    // terminal PUT, so the two writes cannot interleave.
    try {
      await autoSave.flush()
    } catch {
      // Auto-save errors are non-blocking; the explicit PUT below is the
      // source of truth for this navigation.
    }
    const priorPayload = progress.data?.payload ?? null
    const priorTemplateDraft = (priorPayload?.templateDraft ??
      {}) as unknown as TemplateDraftPayload
    // R1-C1-P14 (TS-1) — buildFromScratch is `true` or explicit `null`,
    // never `undefined`. `JSON.stringify` drops undefined keys; OpenAPI
    // contract requires explicit null for absent values.
    const templateDraft: TemplateDraftPayload = {
      ...priorTemplateDraft,
      selectedTemplateId: buildFromScratchSelected
        ? null
        : selectedValue,
      buildFromScratch: buildFromScratchSelected ? true : null,
    }
    await putProgress.mutateAsync({
      currentStep: 'spawn',
      payload: {
        schemaVersion: 1,
        personaChoice: progress.data?.persona ?? null,
        centerDraft: priorPayload?.centerDraft ?? null,
        templateDraft: templateDraft as unknown as {
          [key: string]: unknown
        },
      },
    })
    navigate('/setup/spawn', { replace: true })
  }

  const isSeedIncomplete =
    templates.error instanceof ApiError &&
    templates.error.code === 'SEED_INCOMPLETE'
  const requestId =
    templates.error instanceof ApiError
      ? templates.error.requestId ?? 'unknown'
      : 'unknown'

  return (
    <section aria-labelledby="template-page-heading" className="mx-auto max-w-4xl">
      <p className="text-sm text-slate-500">
        {t('onboarding.template.eyebrow', { current: 3, total: 4 })}
      </p>
      <h1
        id="template-page-heading"
        className="mt-2 font-serif text-3xl leading-tight text-slate-900"
      >
        {t('onboarding.template.title')}
      </h1>
      <p className="mt-2 text-slate-600">
        {t('onboarding.template.subtitle')}
      </p>

      <div className="mt-8">
        {templates.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                data-testid={`template-skeleton-${i}`}
                aria-busy="true"
                className="h-40 animate-pulse rounded-lg bg-slate-200"
              />
            ))}
          </div>
        ) : templates.isError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            <p>
              {isSeedIncomplete
                ? t('onboarding.template.error.seedIncomplete')
                : t('onboarding.template.error.generic', { requestId })}
            </p>
            {isSeedIncomplete ? null : (
              <button
                type="button"
                onClick={() => void templates.refetch()}
                className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-800 hover:bg-red-100"
              >
                {t('onboarding.template.error.retryCta')}
              </button>
            )}
          </div>
        ) : templates.data ? (
          <RadioGroupTiles<string>
            ariaLabelledBy="template-page-heading"
            value={selectedValue}
            onChange={(v) => setSelectedValue(v)}
            items={[
              ...templates.data.map((template: Template) => ({
                value: template.id,
                ariaLabel: template.name,
                render: ({ selected }: { selected: boolean }) => (
                  <TemplateCard template={template} selected={selected} />
                ),
              })),
              {
                value: BUILD_FROM_SCRATCH_VALUE,
                ariaLabel: t('onboarding.template.buildFromScratch.title'),
                render: ({ selected }: { selected: boolean }) => (
                  <BuildFromScratchTile selected={selected} />
                ),
              },
            ]}
            className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
          />
        ) : null}
      </div>

      {selectedValue !== null && (selectedTemplate || buildFromScratchSelected) ? (
        <TemplatePreview
          template={selectedTemplate}
          buildFromScratch={buildFromScratchSelected}
          onContinue={() => void handleContinue()}
          pending={putProgress.isPending}
        />
      ) : (
        <div className="mt-8 flex justify-end">
          <button
            type="button"
            disabled
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white opacity-50"
          >
            {t('onboarding.template.continueCta')}
          </button>
        </div>
      )}
    </section>
  )
}
