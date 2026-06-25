/**
 * authKeys contract test — the literal `['auth', 'session']` shape is
 * duplicated in `src/lib/auth-refresh.ts` to avoid an import cycle
 * (see `authKeys.ts` JSDoc). This contract assertion catches any future
 * rename so the duplicated literal in `auth-refresh.ts` can be updated
 * in lock-step.
 */
import { describe, expect, test } from 'vitest'
import { authKeys } from '@/features/auth/api/authKeys'

describe('authKeys factory', () => {
  test('session() returns the literal ["auth", "session"] tuple', () => {
    expect(authKeys.session()).toEqual(['auth', 'session'])
  })

  test('all returns the ["auth"] root', () => {
    expect(authKeys.all).toEqual(['auth'])
  })

  test('session() is hierarchical under all (partial-match invalidation safe)', () => {
    expect(authKeys.session().slice(0, authKeys.all.length)).toEqual(
      authKeys.all,
    )
  })

  test('loginMutation() and registerMutation() are distinct from session() and from each other (P5 amendment)', () => {
    // The cache write key (session) stays shared between mutations
    // because both populate the same slot; the mutation keys are
    // separate so mutationCache.findAll can disambiguate the type.
    expect(authKeys.loginMutation()).toEqual(['auth', 'mutation', 'login'])
    expect(authKeys.registerMutation()).toEqual([
      'auth',
      'mutation',
      'register',
    ])
    expect(authKeys.loginMutation()).not.toEqual(authKeys.session())
    expect(authKeys.registerMutation()).not.toEqual(authKeys.session())
    expect(authKeys.loginMutation()).not.toEqual(authKeys.registerMutation())
  })

  test('mutation keys are hierarchical under all', () => {
    expect(authKeys.loginMutation().slice(0, authKeys.all.length)).toEqual(
      authKeys.all,
    )
    expect(authKeys.registerMutation().slice(0, authKeys.all.length)).toEqual(
      authKeys.all,
    )
  })

  test('Story 1-9a — verifyStatus(pollId), resendMutation(), verifyEmailMutation() shapes', () => {
    expect(authKeys.verifyStatus('poll-uuid-1')).toEqual([
      'auth',
      'verify-status',
      'poll-uuid-1',
    ])
    expect(authKeys.resendMutation()).toEqual(['auth', 'mutation', 'resend'])
    expect(authKeys.verifyEmailMutation()).toEqual([
      'auth',
      'mutation',
      'verify-email',
    ])
  })

  test('Story 1-9a — verifyStatus keys for distinct pollIds are distinct (no cache collision)', () => {
    expect(authKeys.verifyStatus('A')).not.toEqual(authKeys.verifyStatus('B'))
  })

  test('Story 1-9a — verify mutation keys are distinct from each other AND from login/register mutations', () => {
    const all = [
      authKeys.loginMutation(),
      authKeys.registerMutation(),
      authKeys.resendMutation(),
      authKeys.verifyEmailMutation(),
    ]
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        expect(all[i]).not.toEqual(all[j])
      }
    }
  })

  test('Story 1-9a — verify keys are hierarchical under all', () => {
    expect(
      authKeys.verifyStatus('x').slice(0, authKeys.all.length),
    ).toEqual(authKeys.all)
    expect(
      authKeys.resendMutation().slice(0, authKeys.all.length),
    ).toEqual(authKeys.all)
    expect(
      authKeys.verifyEmailMutation().slice(0, authKeys.all.length),
    ).toEqual(authKeys.all)
  })
})
