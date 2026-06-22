import { useTranslation } from 'react-i18next'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar'
import type { Role } from '@/hooks/useRole'

/**
 * UserPill — `s06` sidebar foot identity slot.
 *
 * Pure layout: avatar + name + data-driven role label. No hooks beyond
 * i18n; consumer passes `name`, `avatarUrl`, `role`. The 1-7c placeholder
 * (`shared/UserPill.tsx`) read from `useAuth()` + `useRole()` and rendered
 * a no-session login button — both responsibilities move out of the
 * component (consumer or `AppShell.banner` slot).
 */
const ROLE_LABEL_KEYS = {
  owner: 'userPill.role.owner',
  admin: 'userPill.role.admin',
  teacher: 'userPill.role.teacher',
  student: 'userPill.role.student',
} as const satisfies Record<Role, string>

export interface UserPillProps {
  name: string
  avatarUrl?: string | null
  role: Role
}

/**
 * Build avatar initials from a user-facing display name. Trims whitespace,
 * splits on any whitespace run, drops empty parts, and reads the first
 * codepoint of each remaining word with `Array.from(part)` so surrogate
 * pairs (emoji, supplementary-plane characters) stay intact. Falls back
 * to `?` so the Avatar never renders an empty bubble.
 */
function deriveInitials(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return initials.length > 0 ? initials : '?'
}

export function UserPill({ name, avatarUrl, role }: UserPillProps) {
  const { t } = useTranslation()
  const initials = deriveInitials(name)
  const roleLabel = t(ROLE_LABEL_KEYS[role])
  // Empty string is truthy — passing `src=""` triggers a redundant request
  // to the current page URL and renders the broken-image placeholder.
  const safeAvatarUrl = avatarUrl?.trim() ? avatarUrl : null

  return (
    <div className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-sm text-sidebar-foreground">
      <Avatar size="sm" className="ring-2 ring-sidebar-primary">
        {safeAvatarUrl ? <AvatarImage src={safeAvatarUrl} alt="" /> : null}
        <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{name}</span>
        <span
          data-testid="user-pill-role"
          className="truncate text-xs opacity-70"
        >
          {roleLabel}
        </span>
      </div>
    </div>
  )
}
