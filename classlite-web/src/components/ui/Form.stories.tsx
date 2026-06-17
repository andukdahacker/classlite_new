/**
 * Form — Story 1d-2 AC1.
 *
 * Canonical RHF + `zodResolver` wiring. Per AC1 + AC8: schema messages are
 * localized via `t()` so FormMessage renders locale-correct copy in both
 * en and vi (validation copy used to leak as raw key strings — code review
 * 2026-06-17 fix). Submit handler is a `vi.fn()`-style fake promise (NOT
 * MSW, NOT a real `useMutation`).
 *
 * Two locale-pinned stories (`WithRHFAndZodResolverEn` / `WithRHFAndZodResolverVi`)
 * each set `parameters.globals.locale` and run `play` to assert the rendered
 * validation copy matches `i18n.t(...)` under that locale — the per-AC8
 * "play runs twice (en + vi)" contract.
 *
 * Writing-editor RHF exemption (FW-8): the writing editor uses the
 * document-editing pattern with debounced TanStack Query mutations and a
 * "Saved/Saving" indicator — never form validation, submit buttons, or
 * blocking modals. That surface ships in Epic 5 Story 5-3.
 */
import { useMemo } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

import i18n from '@/lib/i18n'
import { Button } from './button'
import { Input } from './input'
import { Checkbox } from './checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './form'

// Static FormValues type — the schema itself is built per render so the
// Zod messages can flow through `t()` for locale-correct validation copy
// (code review 2026-06-17 contract). The shape is simple enough that
// hand-typing it is cleaner than `z.infer<typeof staticShape>`.
type FormValues = {
  email: string
  name: string
  agreed: boolean
}

function WithRHFAndZodResolverImpl() {
  const { t } = useTranslation()
  const schema = useMemo(
    () =>
      z.object({
        email: z.email({ message: t('storybook.form.emailInvalid') }),
        name: z
          .string()
          .min(1, { message: t('storybook.form.nameRequired') }),
        agreed: z.boolean().refine((v) => v, {
          message: t('storybook.form.agreedRequired'),
        }),
      }),
    [t],
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', name: '', agreed: false },
    mode: 'onSubmit',
  })

  const onSubmit = (values: FormValues): Promise<void> =>
    new Promise((resolve) => {
      // Fake submit — primitives are pre-state. `values` is intentionally
      // unused; the play function asserts the validation-error branch
      // before submit ever succeeds.
      void values
      setTimeout(resolve, 0)
    })

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="grid w-80 gap-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.common.email')}</FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder={t('storybook.placeholder.email')}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t('storybook.form.emailHelp')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t('storybook.form.nameLabel')}{' '}
                <span className="text-muted-foreground">
                  {t('storybook.label.required')}
                </span>
              </FormLabel>
              <FormControl>
                <Input
                  placeholder={t('storybook.placeholder.name')}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="agreed"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(value) => field.onChange(value === true)}
                />
              </FormControl>
              <div className="grid gap-1">
                <FormLabel>{t('storybook.form.agreedLabel')}</FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />
        <Button type="submit">{t('auth.login.submit')}</Button>
      </form>
    </Form>
  )
}

const meta = {
  title: 'ui/Form',
  component: WithRHFAndZodResolverImpl,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WithRHFAndZodResolverImpl>

export default meta
type Story = StoryObj<typeof meta>

export const WithRHFAndZodResolver: Story = {
  render: () => <WithRHFAndZodResolverImpl />,
}

// Locale-pinned variants — discharge AC8's "play runs twice (en + vi)
// asserting locale-correct validation copy" contract. Each story sets
// `parameters.globals.locale` so the i18n provider re-renders with that
// locale before the play function runs, then submits an empty form and
// asserts the rendered error matches `i18n.t(...)` under the active locale.
//
// AC8 contract: a play that only checked "validation fires" without
// verifying which copy renders would mask R38 (e.g., an English-only
// fallback silently shipping in vi). The assertions explicitly compare
// against the locale-resolved translation.

const validationPlay = async (
  locale: 'en' | 'vi',
  canvasElement: HTMLElement,
) => {
  // The preview decorator listens to globals.locale and calls
  // i18n.changeLanguage() during render. Re-issue here so the play
  // function reads the right locale via i18n.t() — globals propagation
  // races against the play start in headless test-runner mode.
  await i18n.changeLanguage(locale)
  const canvas = within(canvasElement)
  const submit = await canvas.findByRole('button', {
    name: i18n.t('auth.login.submit'),
  })
  await userEvent.click(submit)
  // Each FormMessage renders the localized Zod message — assert the
  // exact translated string is in the DOM.
  await waitFor(async () => {
    expect(
      await canvas.findByText(i18n.t('storybook.form.emailInvalid')),
    ).toBeInTheDocument()
    expect(
      await canvas.findByText(i18n.t('storybook.form.nameRequired')),
    ).toBeInTheDocument()
    expect(
      await canvas.findByText(i18n.t('storybook.form.agreedRequired')),
    ).toBeInTheDocument()
  })
}

export const WithRHFAndZodResolverEn: Story = {
  parameters: { globals: { locale: 'en' } },
  render: () => <WithRHFAndZodResolverImpl />,
  play: async ({ canvasElement }) => {
    await validationPlay('en', canvasElement)
  },
}

export const WithRHFAndZodResolverVi: Story = {
  parameters: { globals: { locale: 'vi' } },
  render: () => <WithRHFAndZodResolverImpl />,
  play: async ({ canvasElement }) => {
    await validationPlay('vi', canvasElement)
  },
}
