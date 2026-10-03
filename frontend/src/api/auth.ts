import { API_URL, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { AuthResponse, User } from '../types/auth'

// Auth.4 — the auth endpoints use plain fetch, not authFetch. authFetch
// reports every 401 to useAuth as "your token died, start over" — but here a
// 401 is an expected ANSWER that useAuth is already waiting for, not an
// accident to recover from. (Login / register arrive with the login UI in
// AUTH.6.)

// Creates a brand-new guest user on the server and returns its token.
export async function guestLogin(): Promise<AuthResponse> {
  log.info('api:auth', 'POST /auth/guest')
  const res = await fetch(`${API_URL}/auth/guest`, { method: 'POST' })
  const data: AuthResponse = await parseJsonOrThrow(res)
  log.info('api:auth', `guest created — ${data.user.id.slice(0, 8)}`)
  return data
}

// "Does this saved token still work, and who is it?" Returns null when the
// server says no (expired, tampered, or the user row is gone), and throws for
// anything else (server down, network off) — those mean "try again", not
// "your token is bad".
export async function fetchMe(token: string): Promise<User | null> {
  log.info('api:auth', 'GET /auth/me')
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) {
    log.warn('api:auth', 'saved token rejected by /auth/me')
    return null
  }
  const data: { user: User } = await parseJsonOrThrow(res)
  log.info('api:auth', `token valid — ${data.user.id.slice(0, 8)} (${data.user.isGuest ? 'guest' : 'registered'})`)
  return data.user
}
