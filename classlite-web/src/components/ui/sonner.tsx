/*
 * CL-THEME-SWAP: shadcn's stock sonner ships `import { useTheme } from "next-themes"`
 * — next-themes is NOT a project dep and this is a Vite/SPA (no Next.js).
 * The project is light-only (no `.dark` toggle wired at the app level yet),
 * so `theme="light"` is pinned here to prevent Sonner's default `"system"`
 * auto-detection from rendering dark toasts over a light-only app when the
 * OS reports `prefers-color-scheme: dark`. When a real theme provider lands,
 * swap this to read from that source. Pattern 2 reason: missing semantic
 * slot — no project-level theme provider hook exists yet.
 *
 * CL-THEME-SWAP: the upstream sonner export sets `--normal-bg` /
 * `--normal-text` / `--normal-border` / `--border-radius` custom
 * properties via an inline style object. Inline styles are banned by
 * AC7 audit grep #5. Those CSS variables now live in `.cl-toaster`
 * inside `src/index.css`, so the Toaster only carries the className.
 */
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster cl-toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      {...props}
    />
  )
}

export { Toaster }
