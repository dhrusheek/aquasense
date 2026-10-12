import { useSyncExternalStore } from 'react'

const KEY = 'aq-pond'

function read(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get('pond') === '0') return false
  } catch {
    /* no window */
  }
  try {
    return window.localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let value = typeof window === 'undefined' ? true : read()
const listeners = new Set<() => void>()

/** Current pond preference; ?pond=0 turns it off for this load. */
export function pondEnabledNow(): boolean {
  return value
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function set(v: boolean) {
  value = v
  try {
    window.localStorage.setItem(KEY, v ? '1' : '0')
  } catch {
    /* storage blocked */
  }
  listeners.forEach((fn) => fn())
}

/** Pond preference as React state, persisted in localStorage `aq-pond`. */
export function usePondEnabled(): [boolean, (v: boolean) => void] {
  const v = useSyncExternalStore(subscribe, pondEnabledNow, () => true)
  return [v, set]
}
