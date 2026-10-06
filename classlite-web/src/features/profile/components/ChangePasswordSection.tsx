/**
 * ChangePasswordSection — Story 9.4 (AC4 / AC7).
 *
 * RHF + zod (FW-8), reusing PasswordInput + PasswordStrengthBar. Maps the typed
 * backend errors inline: 401 INVALID_CURRENT_PASSWORD → the currentPassword
 * field; 409 PASSWORD_NOT_SET → the OAuth explanatory state; 422 → the relevant
 * field; anything else → a form-level alert. An OAuth-only account renders the
 * whole section DISABLED with the single "You sign in with Google" state (AC7).
 * Success clears the form and shows a confirmation (other sessions stay logged
 * in — AC4).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import PasswordInput from '@/features/auth/components/PasswordInput'
import PasswordStrengthBar from '@/features/auth/components/PasswordStrengthBar'
import { ApiError } from '@/lib/api-fetch'
import type { UserProfile } from '../api/useProfile'
import { useChangePassword } from '../api/useChangePassword'
import {
  useChangePasswordSchema,
  type ChangePasswordFormValues,
} from '../lib/changePasswordSchema'

interface ChangePasswordSectionProps {
  profile: UserProfile
}

export function ChangePasswordSection({ profile }: ChangePasswordSectionProps) {
  const { t } = useTranslation()
  const changePassword = useChangePassword()
  const [formError, setFormError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const schema = useChangePasswordSchema()
  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })
  const newPasswordValue = useWatch({ control: form.control, name: 'newPassword' })

  if (profile.isOauthOnly) {
    return (
      <section
        aria-labelledby="profile-password-heading"
        className="grid gap-2 rounded-lg border border-[var(--cl-line)] p-6"
        data-testid="profile-password-section"
      >
        <h2
          id="profile-password-heading"
          className="text-lg font-medium text-[var(--cl-ink)]"
        >
          {t('profile.password.heading')}
        </h2>
        <p
          className="text-sm text-[var(--cl-ink-soft)]"
          data-testid="profile-password-oauth-note"
        >
          {t('profile.password.oauthNote')}
        </p>
      </section>
    )
  }

  const onSubmit = (values: ChangePasswordFormValues) => {
    if (changePassword.isPending) return
    setFormError(null)
    setSuccess(false)
    changePassword.mutate(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      {
        onSuccess: () => {
          setSuccess(true)
          form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' })
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            if (error.status === 403 && error.code === 'INVALID_CURRENT_PASSWORD') {
              form.setError('currentPassword', {
                message: t('profile.password.errors.currentIncorrect'),
              })
              return
            }
            if (error.status === 409 && error.code === 'PASSWORD_NOT_SET') {
              setFormError(t('profile.password.oauthNote'))
              return
            }
          }
          setFormError(t('profile.password.errors.generic'))
        },
      },
    )
  }

  return (
    <section
      aria-labelledby="profile-password-heading"
      className="grid gap-4 rounded-lg border border-[var(--cl-line)] p-6"
      data-testid="profile-password-section"
    >
      <h2
        id="profile-password-heading"
        className="text-lg font-medium text-[var(--cl-ink)]"
      >
        {t('profile.password.heading')}
      </h2>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-4">
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.password.currentLabel')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
                    data-testid="profile-current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.password.newLabel')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    data-testid="profile-new-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <PasswordStrengthBar password={newPasswordValue ?? ''} />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('profile.password.confirmLabel')}</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    data-testid="profile-confirm-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {formError && (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="profile-password-error"
            >
              {formError}
            </p>
          )}
          {success && (
            <p
              role="status"
              className="text-sm text-[var(--cl-accent)]"
              data-testid="profile-password-success"
            >
              {t('profile.password.success')}
            </p>
          )}
          <div>
            <Button
              type="submit"
              disabled={changePassword.isPending}
              data-testid="profile-password-save"
            >
              {t('profile.password.save')}
            </Button>
          </div>
        </form>
      </Form>
    </section>
  )
}
