import {
  Archive,
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileQuestion,
  GraduationCap,
  Inbox,
  LayoutDashboard,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { Role } from '@/hooks/useRole'
import type { SidebarNavGroup } from './SidebarShell'

/**
 * Per-role default sidebar nav sets — content for AC2–AC5.
 *
 * Sourced VERBATIM from `_bmad-output/planning-artifacts/classlite-ia.md`
 * lines 16–19 (sidebar per-role conventions) plus the per-role visibility
 * matrix at lines 294–303 (Settings owner-only, Knowledge hub /
 * Archive teacher+owner+admin only). When updating this file, re-read
 * the IA — the AC review will compare row-for-row.
 *
 * IA citation per nav set (line numbers in `classlite-ia.md`):
 *   Owner    — line 16 (column 2)
 *   Admin    — line 17 (column 2) = Owner MINUS Settings
 *   Teacher  — line 18 (column 2)
 *   Student  — line 19 (column 2) — student-tone labels
 */

function icon(Component: LucideIcon) {
  return <Component className="size-4" />
}

const OWNER_GROUPS: ReadonlyArray<SidebarNavGroup> = [
  {
    items: [
      { labelKey: 'sidebar.owner.dashboard', icon: icon(LayoutDashboard), href: '/dashboard' },
      { labelKey: 'sidebar.owner.people', icon: icon(Users), href: '/people/staff' },
      { labelKey: 'sidebar.owner.students', icon: icon(GraduationCap), href: '/people/students' },
      { labelKey: 'sidebar.owner.enrolment', icon: icon(ArrowLeftRight), href: '/people/enrolment' },
      { labelKey: 'sidebar.owner.importStudents', icon: icon(GraduationCap), href: '/students/import' },
      { labelKey: 'sidebar.owner.classes', icon: icon(BookOpen), href: '/classes' },
      { labelKey: 'sidebar.owner.schedule', icon: icon(CalendarDays), href: '/schedule' },
      { labelKey: 'sidebar.owner.exercises', icon: icon(ClipboardList), href: '/exercises' },
      { labelKey: 'sidebar.owner.analytics', icon: icon(BarChart3), href: '/analytics' },
      { labelKey: 'sidebar.owner.inbox', icon: icon(Inbox), href: '/inbox' },
      { labelKey: 'sidebar.owner.knowledgeHub', icon: icon(BookOpen), href: '/knowledge-hub' },
      { labelKey: 'sidebar.owner.archive', icon: icon(Archive), href: '/archive' },
    ],
  },
  {
    labelKey: 'sidebar.section.settings',
    items: [
      { labelKey: 'sidebar.owner.settings', icon: icon(Settings), href: '/settings' },
    ],
  },
]

const ADMIN_GROUPS: ReadonlyArray<SidebarNavGroup> = [
  {
    items: [
      { labelKey: 'sidebar.admin.dashboard', icon: icon(LayoutDashboard), href: '/dashboard' },
      { labelKey: 'sidebar.admin.people', icon: icon(Users), href: '/people/staff' },
      { labelKey: 'sidebar.admin.students', icon: icon(GraduationCap), href: '/people/students' },
      { labelKey: 'sidebar.admin.enrolment', icon: icon(ArrowLeftRight), href: '/people/enrolment' },
      { labelKey: 'sidebar.admin.importStudents', icon: icon(GraduationCap), href: '/students/import' },
      { labelKey: 'sidebar.admin.classes', icon: icon(BookOpen), href: '/classes' },
      { labelKey: 'sidebar.admin.schedule', icon: icon(CalendarDays), href: '/schedule' },
      { labelKey: 'sidebar.admin.analytics', icon: icon(BarChart3), href: '/analytics' },
      { labelKey: 'sidebar.admin.inbox', icon: icon(Inbox), href: '/inbox' },
      { labelKey: 'sidebar.admin.knowledgeHub', icon: icon(BookOpen), href: '/knowledge-hub' },
      { labelKey: 'sidebar.admin.archive', icon: icon(Archive), href: '/archive' },
    ],
  },
]

const TEACHER_GROUPS: ReadonlyArray<SidebarNavGroup> = [
  {
    items: [
      { labelKey: 'sidebar.teacher.dashboard', icon: icon(LayoutDashboard), href: '/dashboard' },
      { labelKey: 'sidebar.teacher.classes', icon: icon(BookOpen), href: '/classes' },
      { labelKey: 'sidebar.teacher.schedule', icon: icon(CalendarDays), href: '/schedule' },
      { labelKey: 'sidebar.teacher.exercises', icon: icon(ClipboardList), href: '/exercises' },
      { labelKey: 'sidebar.teacher.questions', icon: icon(FileQuestion), href: '/questions' },
      { labelKey: 'sidebar.teacher.students', icon: icon(GraduationCap), href: '/students' },
      { labelKey: 'sidebar.teacher.analytics', icon: icon(BarChart3), href: '/analytics' },
      { labelKey: 'sidebar.teacher.inbox', icon: icon(Inbox), href: '/inbox' },
      { labelKey: 'sidebar.teacher.knowledgeHub', icon: icon(BookOpen), href: '/knowledge-hub' },
      { labelKey: 'sidebar.teacher.archive', icon: icon(Archive), href: '/archive' },
    ],
  },
]

const STUDENT_GROUPS: ReadonlyArray<SidebarNavGroup> = [
  {
    items: [
      { labelKey: 'sidebar.student.dashboard', icon: icon(LayoutDashboard), href: '/dashboard' },
      { labelKey: 'sidebar.student.myClasses', icon: icon(BookOpen), href: '/my-classes' },
      { labelKey: 'sidebar.student.assignments', icon: icon(ClipboardList), href: '/assignments' },
      { labelKey: 'sidebar.student.mySchedule', icon: icon(CalendarDays), href: '/my-schedule' },
      // Story 7.4b (AC17/D4): the student "Questions" sidebar link is PARKED —
      // students ask only in-attempt via the `?questions=open` rail (FR-38); the
      // former href pointed at a fictional `/exercises/active/attempt`. The
      // standalone student "My questions" list is deferred to Epic 8 / Story 8.1
      // (s29 dashboard card). The `sidebar.student.questions` key stays in the
      // locales (parity) for that future surface.
      { labelKey: 'sidebar.student.myPerformance', icon: icon(BarChart3), href: '/my-performance' },
      { labelKey: 'sidebar.student.inbox', icon: icon(Inbox), href: '/inbox' },
    ],
  },
]

export const SIDEBAR_NAV_BY_ROLE: Record<Role, ReadonlyArray<SidebarNavGroup>> = {
  owner: OWNER_GROUPS,
  admin: ADMIN_GROUPS,
  teacher: TEACHER_GROUPS,
  student: STUDENT_GROUPS,
}
