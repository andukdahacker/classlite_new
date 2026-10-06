/**
 * AccountSection — Story 9.4 Account block (AC1 / AC5 / AC7 / AC13).
 *
 * Name (RHF + zod, FW-8) + avatar (AvatarField) share ONE Save (AC13). Email is
 * read-only with a support escape hatch (AC7 / D16 — email is the global login
 * identity, so the hatch is support@, not "contact your admin"). An OAuth-only
 * account surfaces a single "You sign in with Google" explanatory state covering
 * the locked email (and the disabled password control in ChangePasswordSection).
 * Save PUTs the FULL snapshot (D5) — name + avatar merged over the unchanged
 * languagePref / notificationSettings read from the loaded profile.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { useRole } from '@/hooks/useRole'
import type { UserProfile } from '../api/useProfile'
import { useUpdateProfile } from '../api/useUpdateProfile'
import { AvatarField } from './AvatarField'

const SUPPORT_EMAIL = 'support@classlite.app'

interface AccountSectionProps {
  profile: UserProfile
}

export function AccountSection({ profile }: AccountSectionProps) {
  const { t } = useTranslation()
  const role = useRole()
  const updateProfile = useUpdateProfile()
  const [pendingAvatarKey, setPendingAvatarKey] = useState<string | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [saveError, setSaveError] = useState(false)

  const schema = useMemo(
    () =>
      z.object({
        fullName: z
          .string()
          .trim()
          .min(1, { message: t('profile.account.errors.nameRequired') }),
      }),
    [t],
  )
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: profile.fullName },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })

  const liveName = form.watch('fullName')

  const onSubmit = (values: Values) => {
    setSaveError(false)
    updateProfile.mutate(
      {
        fullName: values.fullName.trim(),
        // D5 full snapshot: merge the pending avatar key over the unchanged
        // language + notification fields read from the loaded profile.
        avatarUrl: pendingAvatarKey ?? profile.avatarUrl,
        languagePref: profile.languagePref,
        notificationSettings: profile.notificationSettings,
      },
      {
        onSuccess: () => {
          setPendingAvatarKey(null)
          setPendingPreview(null)
        },
        onError: () => setSaveError(true),
      },
    )
  }

  return (
    <section
      aria-labelledby="profile-account-heading"
      className="grid gap-4 rounded-lg border border-[var(--cl-line)] p-6"
      data-testid="profile-account-section"
    >
      <h2
        id="profile-account-heading"
        className="text-lg font-medium text-[var(--cl-ink)]"
      >
        {t('profile.account.heading')}
      </h2>

      <AvatarField
        currentAvatarUrl={profile.avatarUrl}
        pendingPreviewUrl={pendingPreview}
        name={liveName || profile.fullName}
        disabled={role === null}
        onUploaded={(key, preview) => {
          setPendingAvatarKey(key)
          setPendingPreview(preview)
        }}
      />

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.account.nameLabel')}</FormLabel>
                <FormControl>
                  <Input
                    data-testid="profile-name-input"
                    autoComplete="name"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Email — read-only (AC7). */}
          <div className="grid gap-1.5">
            <label
              htmlFor="profile-email"
              className="text-sm font-medium text-[var(--cl-ink)]"
            >
              {t('profile.account.emailLabel')}
            </label>
            <Input
              id="profile-email"
              value={profile.email}
              readOnly
              disabled
              data-testid="profile-email-input"
            />
            {profile.isOauthOnly ? (
              <p
                className="text-xs text-[var(--cl-ink-soft)]"
                data-testid="profile-oauth-note"
              >
                {t('profile.account.oauthNote')}
              </p>
            ) : (
              <p className="text-xs text-[var(--cl-ink-soft)]">
                {t('profile.account.emailSupportNote', { email: SUPPORT_EMAIL })}
              </p>
            )}
          </div>

          {saveError && (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="profile-account-save-error"
            >
              {t('profile.account.errors.saveFailed')}
            </p>
          )}

          <div>
            <Button
              type="submit"
              disabled={updateProfile.isPending}
              data-testid="profile-account-save"
            >
              {t('profile.account.save')}
            </Button>
          </div>
        </form>
      </Form>
    </section>
  )
}
