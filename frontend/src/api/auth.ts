import { API_URL, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { AuthResponse, User } from '../types/auth'

// Auth.4 — the auth endpoints use plain fetch, not authFetch. authFetch
// reports every 401 to useAuth as "your token died, start over" — but here a
// 401 is an expected ANSWER that useAuth is already waiting for, not an
// accident to recover from.

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

// Auth.6 — log in to an existing account. A wrong email or password comes
// back as 401 "Invalid email or password", which parseJsonOrThrow turns into
// an error the form can show.
export async function login(email: string, password: string): Promise<AuthResponse> {
  log.info('api:auth', 'POST /auth/login')
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data: AuthResponse = await parseJsonOrThrow(res)
  log.info('api:auth', `logged in — ${data.user.id.slice(0, 8)}`)
  return data
}

// Auth.6 — create an account. `guestToken` is the current guest's token: the
// server then upgrades THAT user in place (same id), so everything uploaded
// as a guest stays. Without it, a brand-new empty account is made.
export async function register(email: string, password: string, guestToken: string | null): Promise<AuthResponse> {
  log.info('api:auth', `POST /auth/register${guestToken ? ' (upgrading the current guest)' : ''}`)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (guestToken) headers.Authorization = `Bearer ${guestToken}`
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  })
  const data: AuthResponse = await parseJsonOrThrow(res)
  log.info('api:auth', `registered — ${data.user.id.slice(0, 8)}`)
  return data
}
