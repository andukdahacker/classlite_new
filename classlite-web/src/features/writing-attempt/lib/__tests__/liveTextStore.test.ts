// Story 5.3 Task 2 (AC2) — the live-text store: get/set/subscribe, notify only on
// an actual change (so an idempotent set does not churn subscribers).
import { describe, expect, test, vi } from 'vitest'
import { createLiveTextStore } from '../liveTextStore'

describe('createLiveTextStore', () => {
  test('seeds the initial value and reads it back', () => {
    const store = createLiveTextStore('seed')
    expect(store.get()).toBe('seed')
  })

  test('set updates the value and notifies subscribers', () => {
    const store = createLiveTextStore('')
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('hello')
    expect(store.get()).toBe('hello')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  test('an idempotent set (same value) does NOT notify', () => {
    const store = createLiveTextStore('x')
    const listener = vi.fn()
    store.subscribe(listener)
    store.set('x')
    expect(listener).not.toHaveBeenCalled()
  })

  test('unsubscribe stops notifications', () => {
    const store = createLiveTextStore('')
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.set('y')
    expect(listener).not.toHaveBeenCalled()
  })
})
