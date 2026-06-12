/**
 * useLanguageInit — seeds + subscribes the language store (Story 1-7c AC6).
 *
 * Mount once in `App.tsx`. On first render:
 *
 *   1. Read the `lang` cookie via `readLanguageCookie()`.
 *   2. If present, seed `useLanguageStore` AND tell react-i18next to
 *      activate the cookie-named language. This keeps the store, the
 *      `<LanguageToggle>` `aria-pressed`, and the rendered `t()` strings
 *      in sync from the very first frame.
 *
 * The effect ALSO subscribes to the store. Subsequent `setLanguage(lng)`
 * mutations from the toggle trigger the side-effect bridge here:
 *
 *   - `writeLanguageCookie(lng)` so the choice persists across reloads
 *     AND propagates to other subdomains on `.classlite.app`.
 *   - `i18n.changeLanguage(lng)` so every `t()` call re-resolves.
 *   - `BroadcastChannel('lang').postMessage(lng)` so other open tabs of
 *     the dashboard pick up the change live (D4 mitigation).
 *
 * The effect ALSO subscribes to a `BroadcastChannel('lang')`. When another
 * tab posts a language change, this tab's store is updated via
 * `useLanguageStore.setState({language})` WITHOUT re-broadcasting and
 * WITHOUT re-writing the cookie (the originating tab already did both) —
 * the prev-equality guard in the store subscriber short-circuits the
 * I/O echo. Tabs stay live-in-sync; no ping-pong loop.
 *
 * The side effects live outside the store action because project-context
 * FW-5 forbids Zustand stores from owning side effects and FW-6 forbids
 * Zustand from triggering downstream library calls — the subscription
 * boundary keeps the store pure while the I/O stays observable here.
 *
 * `useEffect` is permitted (project-context FW-4 explicitly allows
 * "third-party library integration" and "subscription cleanup" — both
 * apply here).
 */
import { useEffect, useRef } from 'react'
import * as Sentry from '@sentry/react'
import i18n from '@/lib/i18n'
import { useLanguageStore } from '@/stores/languageStore'
import type { Language } from '@/stores/languageStore'
import {
  readLanguageCookie,
  writeLanguageCookie,
} from '@/lib/language-cookie'

const LANG_CHANNEL_NAME = 'classlite.lang'

function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'vi'
}

export function useLanguageInit(): void {
  const seeded = useRef(false)

  useEffect(() => {
    if (!seeded.current) {
      seeded.current = true
      const cookieLang = readLanguageCookie()
      if (cookieLang) {
        useLanguageStore.setState({ language: cookieLang })
        i18n.changeLanguage(cookieLang).catch((err: unknown) => {
          Sentry.captureException(err)
        })
      }
    }

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(LANG_CHANNEL_NAME)
        : null

    // Sentinel: when a remote BroadcastChannel message drives a store
    // update, the subscriber below must skip its I/O (cookie + i18n) so
    // the receiving tab doesn't fight the sender. Synchronous flip
    // because Zustand fires subscribers synchronously on setState.
    let applyingRemote = false

    const unsubscribe = useLanguageStore.subscribe((state, prev) => {
      if (state.language === prev.language) return
      if (applyingRemote) return
      writeLanguageCookie(state.language)
      i18n.changeLanguage(state.language).catch((err: unknown) => {
        Sentry.captureException(err)
      })
      if (channel) {
        try {
          channel.postMessage(state.language)
        } catch (err) {
          Sentry.captureException(err)
        }
      }
    })

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const remoteLang = event.data
        if (!isLanguage(remoteLang)) return
        if (useLanguageStore.getState().language === remoteLang) return
        // Apply via the store so any UI bound to `language` re-renders
        // (LanguageToggle aria-pressed, etc.) — but flip the sentinel so
        // the subscriber's cookie write doesn't re-broadcast. The sender
        // already wrote the cookie; doing it again would race their
        // write and could echo back through another channel listener.
        applyingRemote = true
        try {
          useLanguageStore.setState({ language: remoteLang })
        } finally {
          applyingRemote = false
        }
        i18n.changeLanguage(remoteLang).catch((err: unknown) => {
          Sentry.captureException(err)
        })
      }
    }

    return () => {
      unsubscribe()
      if (channel) channel.close()
    }
  }, [])
}
