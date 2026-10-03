import { useEffect, useState } from 'react'
import { fetchMe, guestLogin } from '../api/auth'
import { clearToken, getToken, onUnauthorized, setToken } from '../api/client'
import { log } from '../utils/logger'
import type { User } from '../types/auth'

// Auth.4 — works out who the user is before anything else in the app runs.
//
// On load:
//   token saved?
//     yes → GET /auth/me ── valid   → ready (that user)
//                        └─ invalid → throw it away, fall through
//     no  → POST /auth/guest → save the new token → ready (a fresh guest)
//
// So a first-time visitor never sees a login screen: they silently become a
// guest, and from then on every request carries that guest's token.

export type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; user: User }
  | { status: 'error'; message: string }

async function resolveUser(): Promise<User> {
  const saved = getToken()
  if (saved) {
    const user = await fetchMe(saved)
    if (user) return user
    clearToken()
  }

  const { token, user } = await guestLogin()
  setToken(token)
  return user
}

// React StrictMode (dev only) mounts every component twice on purpose, to
// catch side effects that aren't safe to repeat. Two mounts would mean two
// POST /auth/guest calls and two guest users on a first visit. Keeping the
// in-progress promise at MODULE level (outside the component, so both mounts
// see the same variable) makes the second call reuse the first one's request.
let inFlight: Promise<User> | null = null

function ensureUser(): Promise<User> {
  if (!inFlight) {
    inFlight = resolveUser().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  // Bumping this re-runs the effect below: used by retry() and when the
  // server rejects our token mid-session.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // `cancelled` guards against setting state after this effect was cleaned
    // up (StrictMode's extra unmount, or a newer attempt starting).
    let cancelled = false

    ensureUser()
      .then((user) => {
        if (cancelled) return
        log.info('useAuth', `ready — ${user.id.slice(0, 8)} (${user.isGuest ? 'guest' : user.email})`)
        setState({ status: 'ready', user })
      })
      .catch((err) => {
        if (cancelled) return
        log.error('useAuth', 'could not get a user', err)
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Could not reach the server',
        })
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  // If any data request comes back 401 (token expired, or the user row was
  // deleted), start over as a fresh guest instead of leaving the app stuck.
  useEffect(() => {
    onUnauthorized((rejectedToken) => {
      // A late 401 from a request that used an OLD token — we've already
      // moved on, so don't throw away the current one.
      if (rejectedToken !== getToken()) return
      log.warn('useAuth', 'token rejected mid-session — starting over as a new guest')
      clearToken()
      setState({ status: 'loading' })
      setAttempt((n) => n + 1)
    })
    return () => onUnauthorized(null)
  }, [])

  function retry() {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  return { state, retry }
}
