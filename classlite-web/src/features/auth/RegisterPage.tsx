/**
 * RegisterPage — Story 1-8 AC3.
 *
 * Twin to LoginPage with the deltas pinned by the spec:
 *   - Includes Full name + Email + Password (+ PasswordStrengthBar)
 *   - No remember-me / forgot-password row
 *   - Submit success populates session cache with `accessToken: null`
 *     and navigates to `/verify-email?pollId=...`
 *   - 409 EMAIL_ALREADY_REGISTERED → `setError('email', ...)` + force-expand
 *   - 422 VALIDATION_ERROR → iterate `details` array and `setError` per field
 *   - 429 RATE_LIMIT_EXCEEDED → form-level Alert
 *   - 201 with `emailDelivery: 'failed'` → non-blocking warning toast
 *
 * Thumb-zone exception (Sally amendment) — see LoginPage JSDoc.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import AuthCard from '@/features/auth/components/AuthCard'
import CollapsibleEmailForm from '@/features/auth/components/CollapsibleEmailForm'
import GoogleOAuthButton from '@/features/auth/components/GoogleOAuthButton'
import PasswordInput from '@/features/auth/components/PasswordInput'
import PasswordStrengthBar from '@/features/auth/components/PasswordStrengthBar'
import { useRegister } from '@/features/auth/api/register'
import {
  useRegisterSchema,
  type RegisterFormValues,
} from '@/features/auth/lib/registerSchema'
import { ApiError } from '@/lib/api-fetch'

interface ValidationFieldError {
  field: string
  message: string
}

function isFieldErrorArray(value: unknown): value is ValidationFieldError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'field' in entry &&
        'message' in entry,
    )
  )
}

const ALLOWED_FIELDS = new Set(['fullName', 'email', 'password'])

type FieldName = 'fullName' | 'email' | 'password'

export default function RegisterPage() {
  const { t } = useTranslation()
  const [emailFormOpen, setEmailFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const schema = useRegisterSchema()
  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', email: '', password: '' },
    mode: 'onBlur',
  })
  const register = useRegister()
  const isPending = register.isPending

  const passwordValue = useWatch({ control: form.control, name: 'password' })

  const onSubmit = (values: RegisterFormValues) => {
    // (P6 amendment 2026-06-25) Enter key while pending bypasses the
    // submit button's `disabled` and re-fires handleSubmit; without
    // this guard, a slow network + impatient user could double-submit.
    if (isPending) return
    setFormError(null)
    register.mutate(values, {
      onSuccess: (result) => {
        if (result.emailDelivery === 'failed') {
          toast.warning(t('auth.register.emailDelivery.failedToast'))
        }
      },
      onError: (error) => {
        if (!(error instanceof ApiError)) {
          setFormError(t('auth.register.error.generic'))
          return
        }
        if (
          error.status === 409 &&
          error.code === 'EMAIL_ALREADY_REGISTERED'
        ) {
          // Force-expand so the inline message is visible even if the
          // user collapsed the form mid-flight.
          setEmailFormOpen(true)
          form.setError('email', {
            message: t('auth.register.error.emailTaken'),
          })
          return
        }
        if (error.status === 422 && error.code === 'VALIDATION_ERROR') {
          setEmailFormOpen(true)
          // (P2 amendment 2026-06-25) Track the applied-error count so a
          // 422 whose `details` are valid array shape but contain ONLY
          // non-allowlisted field names (e.g. `[{field: 'captcha'}]`)
          // doesn't silently leave the user with no feedback. Falls back
          // to the generic form-level alert if nothing was set on a field.
          let applied = 0
          if (isFieldErrorArray(error.details)) {
            for (const fieldError of error.details) {
              if (ALLOWED_FIELDS.has(fieldError.field)) {
                form.setError(fieldError.field as FieldName, {
                  // Backend messages may be English until server-side i18n
                  // lands — accept as-is per CQ-5 contract.
                  message: fieldError.message,
                })
                applied++
              }
            }
          }
          if (applied === 0) {
            setFormError(t('auth.register.error.generic'))
          }
          return
        }
        if (error.status === 429 && error.code === 'RATE_LIMIT_EXCEEDED') {
          setFormError(t('auth.register.error.rateLimited'))
          return
        }
        setFormError(t('auth.register.error.generic'))
      },
    })
  }

  const googleLabel = useMemo(() => t('auth.register.googleCta'), [t])

  return (
    <AuthCard
      regionLabel={t('auth.register.title')}
      heading={
        <h1
          className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
          data-testid="register-heading"
        >
          {t('auth.register.title')}
        </h1>
      }
      body={
        <div className="grid gap-4">
          <GoogleOAuthButton label={googleLabel} disabled={isPending} />

          {emailFormOpen && (
            <div
              className="relative flex items-center"
              data-testid="email-form-divider"
            >
              <Separator className="flex-1" />
              <span className="px-3 text-xs uppercase text-muted-foreground">
                {t('auth.common.dividerOr')}
              </span>
              <Separator className="flex-1" />
            </div>
          )}

          <CollapsibleEmailForm
            open={emailFormOpen}
            onOpenChange={setEmailFormOpen}
            triggerLabel={t('auth.register.emailCollapse')}
          >
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                noValidate
                className="grid gap-3"
                data-testid="register-form"
              >
                <FormField
                  control={form.control}
                  name="fullName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.register.fullName')}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="name"
                          placeholder={t(
                            'auth.register.fullNamePlaceholder',
                          )}
                          aria-required="true"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.common.email')}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          autoComplete="email"
                          inputMode="email"
                          placeholder={t('auth.common.emailPlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('auth.common.password')}</FormLabel>
                      <FormControl>
                        <PasswordInput
                          autoComplete="new-password"
                          placeholder={t('auth.common.passwordPlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <PasswordStrengthBar password={passwordValue ?? ''} />

                {formError && (
                  <div
                    role="alert"
                    data-testid="register-form-error"
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
                  >
                    {formError}
                  </div>
                )}

                <Button
                  type="submit"
                  size="lg"
                  className="h-12 w-full"
                  disabled={isPending}
                  data-testid="register-submit"
                >
                  {t('auth.register.submit')}
                </Button>

                <p className="text-xs text-muted-foreground">
                  {t('auth.register.terms')}
                </p>
              </form>
            </Form>
          </CollapsibleEmailForm>
        </div>
      }
      footer={
        <a
          href="/login"
          className="text-[var(--cl-accent)] underline"
          data-testid="register-signin-link"
        >
          {t('auth.register.signInLink')}
        </a>
      }
    />
  )
}
