/**
 * PasswordInput — Story 1-8 AC1.
 *
 * Consumer: `LoginPage` + `RegisterPage`. Wraps the shadcn `Input`
 * primitive with an eye-toggle that swaps `type="password"` ↔
 * `type="text"`. Forwards ALL standard `<input>` props so React Hook
 * Form's `register()` spread works without special-casing.
 *
 * React 19 — refs are plain props (no `forwardRef`). The caller passes
 * `ref` like any other prop; the wrapper threads it to the inner
 * `Input` primitive.
 *
 * The toggle aria-label resolves via `t('auth.common.passwordToggleAria')`.
 * The eye icon is decorative (`aria-hidden="true"`) since the button
 * label is the accessible name.
 */
import { useState, type ComponentProps, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export interface PasswordInputProps
  extends Omit<ComponentProps<'input'>, 'type'> {
  ref?: Ref<HTMLInputElement>
}

export default function PasswordInput({
  className,
  ref,
  ...rest
}: PasswordInputProps) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState(false)
  const toggleLabel = t('auth.common.passwordToggleAria')

  return (
    <div data-slot="password-input" className="relative">
      <Input
        ref={ref}
        type={revealed ? 'text' : 'password'}
        // Reserve room for the toggle button so the input text never
        // collides with the eye icon (40px button + 8px gutter).
        className={cn('pr-12', className)}
        {...rest}
      />
      <button
        type="button"
        data-testid="password-toggle"
        aria-label={toggleLabel}
        aria-pressed={revealed}
        onClick={() => setRevealed((v) => !v)}
        className={cn(
          'absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground transition-colors',
          'hover:text-foreground focus-visible:text-foreground focus-visible:outline-none',
        )}
      >
        {revealed ? (
          <EyeOffIcon aria-hidden="true" className="size-4" />
        ) : (
          <EyeIcon aria-hidden="true" className="size-4" />
        )}
      </button>
    </div>
  )
}
