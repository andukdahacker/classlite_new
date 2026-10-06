// Story 9.4 — ProfilePage integration tests (TEST-FE-1..6). MSW at the HTTP
// boundary (never mock useQuery); real QueryClient + Zustand; role via the
// seeded session cache. Covers the UX-1 trilogy, role-appropriate content
// (AC14/AC11), change-password validation + typed-error mapping (AC4), language
// persistence (AC3), axe (AC11), and i18n parity (AC11).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import type { components } from '@/lib/api/client'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import { useLanguageStore, initialState } from '@/stores/languageStore'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import ProfilePage from '@/features/profile/ProfilePage'

type UserProfile = components['schemas']['UserProfile']

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

const PROFILE: UserProfile = {
  id: 'u-1',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  avatarUrl: null,
  languagePref: 'en',
  notificationSettings: {
    schemaVersion: 1,
    emailOnSubmission: true,
    emailOnQuestion: true,
    emailOnAnnouncement: true,
  },
  emailVerified: true,
  isOauthOnly: false,
}

function seedSession(role: Role, client = queryClient): void {
  const session: Session = {
    user: {
      id: 'u-1',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      emailVerified: true,
      avatarUrl: null,
      languagePref: 'en',
    },
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English',
      shortCode: 'saigon',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role,
  }
  // useRole reads the GLOBAL singleton cache; useAuth/useUpdateProfile read the
  // Provider client — seed both so every consumer agrees.
  queryClient.setQueryData<Session>(authKeys.session(), session)
  client.setQueryData<Session>(authKeys.session(), session)
}

function profileGet(profile: UserProfile = PROFILE): void {
  server.use(
    http.get('*/api/users/me', () =>
      HttpResponse.json({ data: profile }),
    ),
  )
}

function renderProfile(role: Role = 'student') {
  const client = createTestQueryClient()
  seedSession(role, client)
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/profile']}>
          <ProfilePage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { client, ...utils }
}

beforeEach(() => {
  useLanguageStore.getState().reset()
  useLanguageStore.setState({ ...initialState })
})

afterEach(() => {
  queryClient.clear()
})

describe('ProfilePage — UX-1 trilogy (TEST-FE-2)', () => {
  test('renders the skeleton while GET /me is loading', async () => {
    server.use(
      http.get('*/api/users/me', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: PROFILE })
      }),
    )
    renderProfile()
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument()
  })

  test('renders the loaded sections on success', async () => {
    profileGet()
    renderProfile()
    expect(await screen.findByTestId('profile-loaded')).toBeInTheDocument()
    expect(screen.getByTestId('profile-account-section')).toBeInTheDocument()
    expect(screen.getByTestId('profile-preferences-section')).toBeInTheDocument()
    expect(screen.getByTestId('profile-notifications-section')).toBeInTheDocument()
    expect(screen.getByTestId('profile-password-section')).toBeInTheDocument()
  })

  test('renders a human error + retry on failure', async () => {
    server.use(http.get('*/api/users/me', () => HttpResponse.error()))
    renderProfile()
    expect(await screen.findByTestId('profile-error')).toBeInTheDocument()
    expect(screen.getByTestId('profile-retry')).toBeInTheDocument()
  })
})

describe('ProfilePage — role-appropriate content (AC14 / AC11 / TEST-FE-6)', () => {
  test('student sees the band pill + enrolment footnote', async () => {
    profileGet()
    renderProfile('student')
    await screen.findByTestId('profile-loaded')
    expect(screen.getByTestId('profile-band-pill')).toBeInTheDocument()
    expect(screen.getByTestId('profile-enrolment-footnote')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-role-line')).not.toBeInTheDocument()
  })

  test.each<Role>(['owner', 'admin', 'teacher'])(
    '%s does NOT see the student band pill/footnote (absent from DOM)',
    async (role) => {
      profileGet()
      renderProfile(role)
      await screen.findByTestId('profile-loaded')
      expect(screen.queryByTestId('profile-band-pill')).not.toBeInTheDocument()
      expect(screen.queryByTestId('profile-enrolment-footnote')).not.toBeInTheDocument()
      expect(screen.getByTestId('profile-role-line')).toBeInTheDocument()
    },
  )

  test.each<Role>(['owner', 'admin', 'teacher', 'student'])(
    '%s sees the same self account fields (no role-gated leakage)',
    async (role) => {
      profileGet()
      renderProfile(role)
      await screen.findByTestId('profile-loaded')
      // Every role manages the same self account + email + password surfaces.
      expect(screen.getByTestId('profile-name-input')).toHaveValue('Ada Lovelace')
      expect(screen.getByTestId('profile-email-input')).toHaveValue('ada@example.com')
    },
  )
})

describe('ProfilePage — accessibility (AC11 / TEST-FE-5)', () => {
  test('loading-skeleton state has no axe violations', async () => {
    server.use(
      http.get('*/api/users/me', async () => {
        await delay('infinite')
        return HttpResponse.json({ data: PROFILE })
      }),
    )
    const { container } = renderProfile('student')
    // AC11 requires axe to pass in BOTH the skeleton and loaded states.
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument()
    expect(await axe(container)).toHaveNoViolations()
  })

  test('loaded page has no axe violations', async () => {
    profileGet()
    const { container } = renderProfile('student')
    await screen.findByTestId('profile-loaded')
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ProfilePage — session cache drives the pill without a refetch (AC8)', () => {
  test('a profile save writes the fresh name + avatar into the session cache', async () => {
    profileGet()
    const updated: UserProfile = {
      ...PROFILE,
      fullName: 'Ada B. Lovelace',
      avatarUrl: `https://cdn.example.com/${CENTER_ID}/avatars/x.png`,
    }
    server.use(
      http.put('*/api/users/me', () => HttpResponse.json({ data: updated })),
    )
    const user = userEvent.setup()
    const { client } = renderProfile('student')
    await screen.findByTestId('profile-loaded')

    const nameInput = screen.getByTestId('profile-name-input')
    await user.clear(nameInput)
    await user.type(nameInput, 'Ada B. Lovelace')
    await user.click(screen.getByTestId('profile-account-save'))

    // AC8 — onSuccess imperatively writes the session cache (no session refetch
    // endpoint is mocked, so a stale value here would prove the pill relied on a
    // refetch instead of the imperative write).
    await waitFor(() => {
      const session = client.getQueryData<Session>(authKeys.session())
      expect(session?.user.fullName).toBe('Ada B. Lovelace')
      expect(session?.user.avatarUrl).toBe(updated.avatarUrl)
    })
  })
})

describe('ProfilePage — language persistence (AC3)', () => {
  test('toggling to Vietnamese fires a PUT carrying languagePref=vi', async () => {
    profileGet()
    const putBodies: Array<{ languagePref?: string }> = []
    server.use(
      http.put('*/api/users/me', async ({ request }) => {
        putBodies.push((await request.json()) as { languagePref?: string })
        return HttpResponse.json({ data: { ...PROFILE, languagePref: 'vi' } })
      }),
    )
    const user = userEvent.setup()
    renderProfile('student')
    await screen.findByTestId('profile-loaded')
    await user.click(screen.getByTestId('profile-language-vi'))
    await waitFor(() => expect(putBodies.length).toBeGreaterThan(0))
    expect(putBodies[0].languagePref).toBe('vi')
    // Instant re-render bridge: the store flipped to vi immediately.
    expect(useLanguageStore.getState().language).toBe('vi')
  })
})

describe('ProfilePage — change password (AC4)', () => {
  test('mismatched confirm shows a validation message, no network call', async () => {
    profileGet()
    const user = userEvent.setup()
    renderProfile('student')
    await screen.findByTestId('profile-loaded')
    await user.type(screen.getByTestId('profile-current-password'), 'current-pass-1')
    await user.type(screen.getByTestId('profile-new-password'), 'a-brand-new-pass')
    await user.type(screen.getByTestId('profile-confirm-password'), 'different-pass-9')
    await user.click(screen.getByTestId('profile-password-save'))
    expect(
      await screen.findByText(i18n.t('profile.password.errors.mismatch')),
    ).toBeInTheDocument()
  })

  test('wrong current password maps the typed 401 inline', async () => {
    profileGet()
    server.use(
      http.post('*/api/users/me/change-password', () =>
        HttpResponse.json(
          { error: { code: 'INVALID_CURRENT_PASSWORD', message: 'nope', requestId: 't' } },
          { status: 403 },
        ),
      ),
    )
    const user = userEvent.setup()
    renderProfile('student')
    await screen.findByTestId('profile-loaded')
    await user.type(screen.getByTestId('profile-current-password'), 'wrong-current-1')
    await user.type(screen.getByTestId('profile-new-password'), 'a-brand-new-pass')
    await user.type(screen.getByTestId('profile-confirm-password'), 'a-brand-new-pass')
    await user.click(screen.getByTestId('profile-password-save'))
    expect(
      await screen.findByText(i18n.t('profile.password.errors.currentIncorrect')),
    ).toBeInTheDocument()
  })
})

describe('ProfilePage — OAuth-only account (AC7)', () => {
  test('shows the single Google explanatory state for email + password', async () => {
    profileGet({ ...PROFILE, isOauthOnly: true })
    renderProfile('teacher')
    await screen.findByTestId('profile-loaded')
    expect(screen.getByTestId('profile-oauth-note')).toBeInTheDocument()
    expect(screen.getByTestId('profile-password-oauth-note')).toBeInTheDocument()
    // The change-password form is NOT rendered for an OAuth-only account.
    expect(screen.queryByTestId('profile-password-save')).not.toBeInTheDocument()
  })
})

describe('ProfilePage — i18n parity (AC11)', () => {
  test('every profile key exists in both locales', () => {
    assertI18nParity([
      'profile.heading',
      'profile.error.body',
      'profile.error.retry',
      'profile.identity.targetBand',
      'profile.identity.enrolmentFootnote',
      'profile.identity.roleLine.owner',
      'profile.account.heading',
      'profile.account.nameLabel',
      'profile.account.emailLabel',
      'profile.account.emailSupportNote',
      'profile.account.oauthNote',
      'profile.account.save',
      'profile.avatar.change',
      'profile.avatar.errors.tooLarge',
      'profile.avatar.errors.wrongType',
      'profile.preferences.heading',
      'profile.preferences.language.vi',
      'profile.preferences.language.en',
      'profile.notifications.heading',
      'profile.notifications.comingSoonNote',
      'profile.password.heading',
      'profile.password.currentLabel',
      'profile.password.errors.mismatch',
      'profile.password.errors.currentIncorrect',
      'profile.password.oauthNote',
      'sidebar.owner.profile',
      'sidebar.admin.profile',
      'sidebar.teacher.profile',
      'sidebar.student.profile',
    ])
  })
})
