import * as React from "react"
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      /*
       * CL-THEME-SWAP: tokenized pulse for editorial-paper rhythm. The shadcn
       * default `animate-pulse` is 2s linear; AC4 swaps to the slower
       * `--cl-skeleton-pulse-duration` (2.4s) + `--cl-skeleton-pulse-easing`
       * tokens in tokens.css. `motion-safe:` prefix gates the animation on
       * `prefers-reduced-motion: no-preference` so reduced-motion users get
       * a static surface (AC8 + 1D-P1-049..052).
       */
      className={cn(
        "rounded-md bg-muted motion-safe:animate-pulse motion-safe:[animation-duration:var(--cl-skeleton-pulse-duration)] motion-safe:[animation-timing-function:var(--cl-skeleton-pulse-easing)]",
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
