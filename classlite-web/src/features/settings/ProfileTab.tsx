/**
 * ProfileTab — Story 2-5a AC3 + AC4 + AC5.
 *
 * Owner-only form for editing center identity: name / contactEmail /
 * brandColor / logo (view-only) / timezone. Save flow uses RHF + Zod →
 * PATCH /api/centers/{id} → optimistic triple + `authKeys.session()`
 * cache write (Winston-S10 + FW-2).
 *
 * Composition per story: About card + Danger Zone side cards + inline
 * ReopenChecklistCta (gated on snoozed state). Loading / Error trilogy
 * per UX-1 (skeleton mirroring form shape; error alert with retry).
 */
import { useEffect, type ReactElement } from 'react'
import { useForm, useWatch, type Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-fetch'
import DeadLinkTrigger from '@/features/dashboard/components/DeadLinkTrigger'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCenterProfile } from './api/useCenterProfile'
import { useUpdateCenterProfile } from './api/useUpdateCenterProfile'
import {
  DEFAULT_PROFILE_FORM_VALUES,
  centerSettingsProfileSchema,
  type CenterSettingsProfileFormValues,
} from './lib/schemas'
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_WHITELIST,
  isSupportedTimezone,
} from './lib/timezoneWhitelist'
import { ReopenChecklistCta } from './components/ReopenChecklistCta'

/* eslint-disable no-restricted-syntax -- brand-color wire values shared with CenterSetupPage (FU-2-3a-C) */
const BRAND_COLOR_VALUES = [
  '#1e3a8a',
  '#d97706',
  '#166534',
  '#991b1b',
  '#b45309',
  '#6b6f7a',
] as const
const BRAND_COLOR_LABEL_KEYS: Record<(typeof BRAND_COLOR_VALUES)[number], string> = {
  '#1e3a8a': 'onboarding.center.form.brandColor.deepNavy',
  '#d97706': 'onboarding.center.form.brandColor.amber',
  '#166534': 'onboarding.center.form.brandColor.green',
  '#991b1b': 'onboarding.center.form.brandColor.red',
  '#b45309': 'onboarding.center.form.brandColor.brown',
  '#6b6f7a': 'onboarding.center.form.brandColor.gray',
}
/* eslint-enable no-restricted-syntax */

const SAVE_ERROR_TOAST_ID = 'settings-profile-save-error'
const SAVE_SUCCESS_TOAST_ID = 'settings-profile-save'

interface ErrorMessage {
  key: string
  values?: Record<string, string | number>
}

function pickErrorMessage(err: unknown): ErrorMessage {
  if (!(err instanceof ApiError)) return { key: 'settings.error.generic' }
  switch (err.status) {
    case 401:
      return { key: 'settings.error.auth' }
    case 403:
      return { key: 'settings.error.forbidden' }
    case 422:
      return { key: 'settings.error.validation' }
    case 429:
      return err.retryAfterSeconds != null && err.retryAfterSeconds > 0
        ? {
            key: 'settings.error.rateLimitWithRetry',
            values: { seconds: err.retryAfterSeconds },
          }
        : { key: 'settings.error.rateLimit' }
    default:
      return err.requestId
        ? {
            key: 'settings.error.genericWithRequestId',
            values: { requestId: err.requestId },
          }
        : { key: 'settings.error.generic' }
  }
}

interface BrandColorPickerProps {
  control: Control<CenterSettingsProfileFormValues>
  onSelect: (color: string) => void
  hexInputProps: React.InputHTMLAttributes<HTMLInputElement>
  hexErrorKey?: string
  t: TFunction
}

/**
 * Extracted so `useWatch` (RHF v7 subscription API) can replace the
 * lint-flagged `form.watch()` reads inside a render loop. useWatch is
 * React-Compiler-safe; form.watch is not.
 *
 * D1 (2026-07-15 review): free-form hex input rendered alongside the
 * 6-swatch radiogroup. Zod schema validates hex format at submit; picker
 * writes to the same `brandColor` form field via RHF register so the two
 * surfaces stay synchronized.
 */
function BrandColorPicker({
  control,
  onSelect,
  hexInputProps,
  hexErrorKey,
  t,
}: BrandColorPickerProps): ReactElement {
  const selectedColor = useWatch({ control, name: 'brandColor' })
  return (
    <fieldset className="space-y-2" data-testid="settings-profile-brandColor-picker">
      <legend className="text-sm font-medium text-slate-900">
        {t('settings.profile.form.brandColor.label')}
      </legend>
      <div
        role="radiogroup"
        aria-label={t('settings.profile.form.brandColor.label')}
        className="flex flex-wrap gap-2"
      >
        {BRAND_COLOR_VALUES.map((color) => {
          const label = t(BRAND_COLOR_LABEL_KEYS[color])
          return (
            <label
              key={color}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs"
            >
              <input
                type="radio"
                name="brandColor"
                value={color}
                aria-label={label}
                checked={selectedColor === color}
                onChange={() => onSelect(color)}
              />
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-sm border border-slate-300"
                style={{ backgroundColor: color }}
              />
              <span>{label}</span>
            </label>
          )
        })}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Label
          htmlFor="settings-profile-brandColor-hex"
          className="text-xs text-slate-600"
        >
          {t('settings.profile.form.brandColor.hexLabel')}
        </Label>
        <Input
          id="settings-profile-brandColor-hex"
          data-testid="settings-profile-brandColor-hex-input"
          type="text"
          inputMode="text"
          spellCheck={false}
          maxLength={7}
          placeholder={t('settings.profile.form.brandColor.hexPlaceholder')}
          className="w-32 font-mono"
          {...hexInputProps}
        />
      </div>
      {hexErrorKey ? (
        <p
          role="alert"
          data-testid="settings-profile-brandColor-hex-error"
          className="text-sm text-red-700"
        >
          {t(hexErrorKey)}
        </p>
      ) : null}
    </fieldset>
  )
}

export interface ProfileTabProps {
  centerId: string
}

export function ProfileTab({ centerId }: ProfileTabProps): ReactElement {
  const { t } = useTranslation()
  const { user } = useAuth()
  const profileQuery = useCenterProfile(centerId)
  const updateMutation = useUpdateCenterProfile(centerId)

  const form = useForm<CenterSettingsProfileFormValues>({
    resolver: zodResolver(centerSettingsProfileSchema),
    defaultValues: DEFAULT_PROFILE_FORM_VALUES,
  })

  // P4 (2026-07-15 review): guard reset on `!isDirty` so a background
  // refetch (window focus, onSettled invalidate) does NOT clobber in-flight
  // typing. Post-save the form is not dirty, so the onSuccess cache-write
  // still triggers a reset with the fresh server copy.
  // P10 (2026-07-15 review): server timezone may drift outside the current
  // whitelist (legacy row, whitelist trim); fall back to DEFAULT_TIMEZONE
  // so the <select> renders a real option and Save doesn't fail Zod with
  // an unhelpful "invalid literal".
  useEffect(() => {
    if (profileQuery.data && !form.formState.isDirty) {
      const serverTimezone = profileQuery.data.timezone
      form.reset({
        name: profileQuery.data.name,
        contactEmail: profileQuery.data.contactEmail ?? '',
        brandColor: profileQuery.data.brandColor ?? '',
        timezone: isSupportedTimezone(serverTimezone)
          ? serverTimezone
          : DEFAULT_TIMEZONE,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileQuery.data])

  if (profileQuery.isLoading) {
    return <ProfileTabSkeleton />
  }
  if (profileQuery.isError) {
    // P3 (2026-07-15 review): (a) retry CTA uses `tryAgain` label (was
    // `saveCta` = "Save changes" which misled users — the click refetches,
    // it does NOT save); (b) surface `requestId` in the alert body when
    // available for support correlation (AC4 spec requirement).
    const fetchErr = profileQuery.error
    const requestId =
      fetchErr instanceof ApiError && fetchErr.requestId
        ? fetchErr.requestId
        : null
    return (
      <div
        role="alert"
        className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        data-testid="settings-profile-fetch-error"
      >
        <p>
          {requestId
            ? t('settings.error.fetchWithRequestId', { requestId })
            : t('settings.error.fetch')}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          onClick={() => profileQuery.refetch()}
        >
          {t('settings.error.tryAgain')}
        </Button>
      </div>
    )
  }
  const profile = profileQuery.data
  if (!profile) {
    return <ProfileTabSkeleton />
  }

  const onSubmit = async (
    values: CenterSettingsProfileFormValues,
  ): Promise<void> => {
    try {
      // D4 (2026-07-15 review): empty input serializes as explicit JSON
      // `null` so the backend NULLs the column. Absent-key = no change,
      // `null` = clear-to-NULL, non-empty value = set. Symmetric across
      // contactEmail + brandColor.
      await updateMutation.mutateAsync({
        name: values.name,
        contactEmail: values.contactEmail === '' ? null : values.contactEmail,
        brandColor: values.brandColor === '' ? null : values.brandColor,
        timezone: values.timezone,
      })
      toast.success(t('settings.profile.saveSuccessToast'), {
        id: SAVE_SUCCESS_TOAST_ID,
      })
    } catch (err) {
      const { key, values: msgValues } = pickErrorMessage(err)
      toast.error(t(key, msgValues), {
        id: SAVE_ERROR_TOAST_ID,
      })
    }
  }

  return (
    <div
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="settings-tab-profile"
      id="settings-tabpanel-profile"
      data-testid="settings-tabpanel-profile"
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="space-y-6 rounded-lg border border-slate-200 bg-white p-6"
        noValidate
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('settings.profile.sectionHeading')}
          </h2>
          <ReopenChecklistCta userId={user?.id ?? null} />
        </header>

        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="settings-profile-name">
            {t('settings.profile.form.name.label')}
          </Label>
          <Input
            id="settings-profile-name"
            data-testid="settings-profile-name-input"
            {...form.register('name')}
            placeholder={t('settings.profile.form.name.placeholder')}
            maxLength={120}
          />
          {form.formState.errors.name?.message ? (
            <p role="alert" className="text-sm text-red-700">
              {t(form.formState.errors.name.message)}
            </p>
          ) : null}
        </div>

        {/* Contact email */}
        <div className="space-y-1.5">
          <Label htmlFor="settings-profile-contact-email">
            {t('settings.profile.form.contactEmail.label')}
          </Label>
          <Input
            id="settings-profile-contact-email"
            data-testid="settings-profile-contactEmail-input"
            type="email"
            {...form.register('contactEmail')}
            placeholder={t('settings.profile.form.contactEmail.placeholder')}
          />
          <p className="text-xs text-slate-500">
            {t('settings.profile.form.contactEmail.helper')}
          </p>
          {form.formState.errors.contactEmail?.message ? (
            <p role="alert" className="text-sm text-red-700">
              {t(form.formState.errors.contactEmail.message)}
            </p>
          ) : null}
        </div>

        {/* Short code — read-only (AC3) */}
        <div className="space-y-1.5">
          <Label htmlFor="settings-profile-short-code">
            {t('settings.profile.form.shortCode.label')}
          </Label>
          <Input
            id="settings-profile-short-code"
            data-testid="settings-profile-shortCode-input"
            value={profile.shortCode}
            readOnly
            disabled
          />
          <p className="text-xs text-slate-500">
            {t('settings.profile.form.shortCode.helperReadOnly')}
          </p>
        </div>

        {/* Brand color — 6-swatch picker + free-form hex input (D1) */}
        <BrandColorPicker
          control={form.control}
          onSelect={(color) =>
            form.setValue('brandColor', color, {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
          hexInputProps={form.register('brandColor')}
          hexErrorKey={form.formState.errors.brandColor?.message ?? undefined}
          t={t}
        />

        {/* Logo — display-only (AC3) */}
        <div className="space-y-1.5">
          <Label>{t('settings.profile.form.logo.label')}</Label>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded bg-slate-100 text-center text-xs leading-[3rem] text-slate-500">
              {profile.name.slice(0, 2).toUpperCase()}
            </div>
            <DeadLinkTrigger
              targetPath="/settings/logo-upload"
              targetSurface="settings-profile-logo-upload"
              epicNum={2}
              className="text-sm"
            >
              {t('settings.profile.form.logo.uploadCta')}
            </DeadLinkTrigger>
          </div>
        </div>

        {/* Timezone */}
        <div className="space-y-1.5">
          <Label htmlFor="settings-profile-timezone">
            {t('settings.profile.form.timezone.label')}
          </Label>
          <select
            id="settings-profile-timezone"
            data-testid="settings-profile-timezone-select"
            {...form.register('timezone')}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {TIMEZONE_WHITELIST.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-end">
          <Button
            type="submit"
            disabled={updateMutation.isPending || !form.formState.isDirty}
            data-testid="settings-profile-save-button"
          >
            {updateMutation.isPending
              ? t('settings.profile.saveInFlight')
              : t('settings.profile.saveCta')}
          </Button>
        </div>
      </form>

      <aside className="space-y-4">
        {/* About card */}
        <section
          aria-labelledby="settings-profile-about-heading"
          className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm"
        >
          <h3
            id="settings-profile-about-heading"
            className="text-sm font-semibold text-slate-900"
          >
            {t('settings.profile.about.title')}
          </h3>
          <p className="text-slate-700">
            {t('settings.profile.about.created', {
              // BLOCKER fix (2026-07-15 review): i18n datetime formatter
              // requires a Date/number, not an ISO string; template
              // placeholder is `{{val, datetime}}` matched to the `val`
              // options key. Prior template used `{{date}}` which never
              // resolved and rendered literal "{{date}}" to the user.
              val: new Date(profile.createdAt),
              formatParams: {
                val: {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                },
              },
            })}
          </p>
          {user ? (
            <p className="text-slate-700">
              {t('settings.profile.about.by', { name: user.displayName })}
            </p>
          ) : null}
          <p className="text-slate-700">{t('settings.profile.about.plan')}</p>
          <p className="text-slate-700">
            {t('settings.profile.about.id', { shortCode: profile.shortCode })}
          </p>
        </section>

        {/* Danger zone */}
        <section
          aria-labelledby="settings-profile-danger-heading"
          className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-4 text-sm"
        >
          <h3
            id="settings-profile-danger-heading"
            className="text-sm font-semibold text-red-900"
          >
            {t('settings.profile.dangerZone.title')}
          </h3>
          <div className="flex flex-col gap-2">
            <DeadLinkTrigger
              targetPath="/settings/transfer-ownership"
              targetSurface="settings-danger-transfer-ownership"
              epicNum={2}
              className="text-sm"
            >
              {t('settings.profile.dangerZone.transferOwnership')}
            </DeadLinkTrigger>
            <DeadLinkTrigger
              targetPath="/settings/archive-center"
              targetSurface="settings-danger-archive-center"
              epicNum={9}
              className="text-sm"
            >
              {t('settings.profile.dangerZone.archiveCenter')}
            </DeadLinkTrigger>
          </div>
        </section>
      </aside>
    </div>
  )
}

function ProfileTabSkeleton(): ReactElement {
  return (
    <div
      data-testid="settings-profile-skeleton"
      role="status"
      aria-live="polite"
      className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-6">
        <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
        <div className="h-10 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-10 w-full animate-pulse rounded bg-slate-100" />
        <div className="h-10 w-3/4 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-32 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
      </div>
    </div>
  )
}
