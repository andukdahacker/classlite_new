/**
 * CollapsibleEmailForm — Story 1-8 AC1.
 *
 * Wraps shadcn `Collapsible` with the visual contract from UX-DR7:
 * dashed border collapsed → solid border expanded. Controlled `open`
 * prop so the consumer (LoginPage / RegisterPage) can force-expand on
 * server validation error (e.g., 422 on a hidden field).
 *
 * `triggerLabel` is a ReactNode slot so the consumer passes the
 * localized "Sign in with email" / "Sign up with email" copy directly.
 *
 * Children render INSIDE `<CollapsibleContent>`. The trigger is rendered
 * as a full-width button so the entire row is the affordance.
 */
import type { ReactNode } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export interface CollapsibleEmailFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerLabel: ReactNode
  children: ReactNode
}

export default function CollapsibleEmailForm({
  open,
  onOpenChange,
  triggerLabel,
  children,
}: CollapsibleEmailFormProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      data-slot="collapsible-email-form"
      className={cn(
        'w-full rounded-lg p-3 transition-colors',
        // dashed → solid border per UX-DR7. The border color is muted
        // either way; transitions on the line style only.
        open
          ? 'border border-solid border-border'
          : 'border border-dashed border-border',
      )}
    >
      <CollapsibleTrigger
        data-testid="collapsible-email-trigger"
        className={cn(
          'flex w-full items-center justify-center rounded-md px-2 py-2 text-sm font-medium',
          'text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        )}
      >
        {triggerLabel}
      </CollapsibleTrigger>
      <CollapsibleContent
        data-testid="collapsible-email-content"
        className="pt-4"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
