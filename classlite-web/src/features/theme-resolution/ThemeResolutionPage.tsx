/**
 * ThemeResolutionPage — DEV-ONLY scratch route for Story 1.7a AC3 + AC4.
 *
 * Mounts primitives and typography samples that exercise the four orthogonal
 * shadcn token resolution paths (--primary, --input/--ring, --card,
 * --popover/overlay) plus the Fraunces/Geist/Geist Mono font chain. The
 * Playwright spec (e2e/theme-resolution.spec.ts, typography-resolution.spec.ts)
 * navigates here and asserts computed-style values against the canonical
 * tokens.css mapping.
 *
 * Production builds MUST NOT include this component. The App router gates the
 * mount on `import.meta.env.DEV`, so Rolldown tree-shakes the import away in
 * non-dev builds. Task 11.9 greps `dist/` to confirm.
 *
 * Why native elements instead of full shadcn Card/Input/Dialog primitives:
 * Story 1.7a explicitly forbids running `npx shadcn add` (FW-7 + R41). Native
 * elements styled with the same shadcn utility classes exercise the IDENTICAL
 * resolution chain: Tailwind utility → @theme inline color var → :root
 * shadcn var → --cl-* token → hex value. The chain is what's under test.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeResolutionPage() {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground px-12 py-10">
      <header className="mb-10">
        <h1
          data-testid="typo-h1"
          className="font-heading text-4xl text-foreground"
        >
          Design system baseline
        </h1>
        <h2
          data-testid="typo-h2"
          className="font-heading text-2xl text-foreground mt-2"
        >
          Theme resolution scratch route
        </h2>
        <h3
          data-testid="typo-h3"
          className="font-heading text-xl text-foreground mt-2"
        >
          Story 1.7a AC3 + AC4
        </h3>
        <p
          data-testid="typo-body"
          className="font-sans text-base text-muted-foreground mt-4"
        >
          Body copy renders in the body sans-serif and resolves through the
          muted-foreground token.
        </p>
        <div className="mt-3 flex gap-4">
          <span data-testid="typo-stat" className="font-mono text-2xl">
            42.0
          </span>
          <span data-testid="typo-label" className="font-mono text-sm">
            band score
          </span>
        </div>
      </header>

      <section className="space-y-6">
        {/* Button matrix — default + destructive variants override radius to
            --cl-radius-sm (6px) per UX §5.4. The default shadcn template uses
            rounded-lg (10px) which is correct for Card, not Button. The
            override exercises the @theme inline `--radius-sm → --cl-radius-sm`
            mapping that drives the brand-correct button radius. */}
        <div className="flex flex-wrap gap-4 items-start">
          <Button
            data-testid="btn-default"
            variant="default"
            className="rounded-sm"
          >
            Primary action
          </Button>
          <Button
            data-testid="btn-destructive"
            variant="destructive"
            className="rounded-sm"
          >
            Destructive action
          </Button>
        </div>

        {/* Input — native element using shadcn input + ring utilities.
            Exercises --input border + --ring focus outline tokens. */}
        <div>
          <label
            htmlFor="input-default"
            className="block text-sm text-foreground mb-2"
          >
            Sample input
          </label>
          <input
            id="input-default"
            data-testid="input-default"
            type="text"
            placeholder="Type here…"
            className="block w-full max-w-sm rounded-sm border border-input bg-background text-foreground px-3 py-2 focus:outline-2 focus:outline-ring focus:outline-offset-2"
          />
        </div>

        {/* Card — exercises --card bg + --card-foreground text + --radius-lg
            (10px). Border uses --border default. */}
        <div
          data-testid="card-default"
          className="bg-card text-card-foreground rounded-lg border border-border p-6 max-w-md"
        >
          <h3 className="font-heading text-lg mb-2">Card title</h3>
          <p className="font-sans text-sm text-muted-foreground">
            Card content uses card + card-foreground tokens.
          </p>
        </div>

        {/* Dialog overlay — uses popover + popover-foreground tokens.
            Custom controlled implementation avoids depending on a primitive
            we haven't scaffolded yet. The overlay is what the spec asserts. */}
        <div>
          <Button
            data-testid="dialog-trigger"
            variant="default"
            className="rounded-sm"
            onClick={() => setDialogOpen(true)}
          >
            Open dialog
          </Button>
          {dialogOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40"
              onClick={() => setDialogOpen(false)}
            >
              <div
                data-testid="dialog-content"
                role="dialog"
                aria-modal="true"
                className="bg-popover text-popover-foreground rounded-xl border border-border p-6 max-w-md w-full mx-4"
                onClick={(event) => event.stopPropagation()}
              >
                <h3 className="font-heading text-lg mb-2">Dialog title</h3>
                <p className="font-sans text-sm mb-4">
                  Dialog overlay binds popover + popover-foreground tokens.
                </p>
                <Button
                  variant="default"
                  className="rounded-sm"
                  onClick={() => setDialogOpen(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export default ThemeResolutionPage
