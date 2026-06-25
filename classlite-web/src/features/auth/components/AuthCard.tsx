/**
 * AuthCard — Story 1-8 AC1.
 *
 * Plain `<section role="region">` (NOT a shadcn `Card` composition —
 * Winston decision 2026-06-25: composing `Card` would override three of
 * its four visual properties via className, which is forking via
 * className anyway). Three slots — heading (consumer passes the `<h1>`),
 * body (form), footer (cross-screen link).
 *
 * Container shape:
 *   - `max-w-[420px]` desktop / `w-full` mobile (mobile collapse handled
 *     by parent layout container)
 *   - `rounded-[14px]`
 *   - `shadow-[var(--cl-shadow-card)]`
 *   - `bg-[var(--cl-surface)]`
 *
 * `regionLabel` is the `aria-label` for the region landmark; consumer
 * passes a localized string (e.g. `t('auth.login.title')`) so the
 * landmark is named correctly even though the visible H1 lives inside
 * `heading`.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface AuthCardProps {
  /** Localized aria-label for the region landmark. */
  regionLabel: string
  /** Heading slot — consumer typically passes the `<h1>`. */
  heading: ReactNode
  /** Body slot — typically the form. */
  body: ReactNode
  /** Footer slot — typically the cross-screen link. */
  footer?: ReactNode
  className?: string
}

export default function AuthCard({
  regionLabel,
  heading,
  body,
  footer,
  className,
}: AuthCardProps) {
  return (
    <section
      role="region"
      aria-label={regionLabel}
      data-slot="auth-card"
      className={cn(
        'mx-auto grid w-full gap-6 rounded-[14px] bg-[var(--cl-surface)] p-6 sm:p-8 md:max-w-[420px]',
        'shadow-[var(--cl-shadow-card)]',
        className,
      )}
    >
      <div data-slot="auth-card-heading" className="grid gap-2 text-center">
        {heading}
      </div>
      <div data-slot="auth-card-body" className="grid gap-4">
        {body}
      </div>
      {footer ? (
        <div
          data-slot="auth-card-footer"
          className="text-center text-sm text-muted-foreground"
        >
          {footer}
        </div>
      ) : null}
    </section>
  )
}
