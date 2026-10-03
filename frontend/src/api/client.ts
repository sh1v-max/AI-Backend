import { log } from '../utils/logger'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export class ApiError extends Error {}

export async function parseJsonOrThrow(res: Response) {
  const data = await res.json()
  if (!res.ok) {
    log.error('api', `${res.status} ${res.url}`, data)
    throw new ApiError(data.error || `Request failed with status ${res.status}`)
  }
  return data
}

// ---------- Auth.4 — the login token ----------
//
// The backend now answers 401 to every data request without a valid token, so
// the token has to live somewhere that survives a page refresh: localStorage.
// Every read/write is wrapped in try/catch because localStorage can throw
// (blocked storage, some private-browsing modes). If it does, the app still
// works for that tab — it just gets a fresh guest on the next load.

const TOKEN_KEY = 'docmind:token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    log.warn('api', 'could not save the token to localStorage — it will be lost on refresh')
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // nothing to clean up if storage isn't available
  }
}

// useAuth registers what should happen when the server rejects our token
// (usually: throw it away and start over as a fresh guest). It's a callback
// set from outside because this file is fetch-only and doesn't know about
// React state.
//
// The handler is told WHICH token got rejected. That matters when several
// requests fail at once: the first 401 makes useAuth fetch a new token, and a
// late 401 from an old request must not throw away the NEW one. The handler
// compares the rejected token with the current one and ignores stale ones.
type UnauthorizedHandler = (rejectedToken: string | null) => void
let unauthorizedHandler: UnauthorizedHandler | null = null

export function onUnauthorized(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler
}

// fetch(), plus the Authorization header. Every api/ file uses this instead
// of calling fetch directly, so "send the token" lives in exactly one place.
//
// `path` is relative to API_URL, e.g. '/documents'.
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken()

  // new Headers(...) keeps whatever headers the caller passed (e.g.
  // Content-Type for JSON) and adds Authorization on top. It does NOT add a
  // Content-Type of its own — important for /upload, where the browser has to
  // set the multipart boundary itself.
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_URL}${path}`, { ...init, headers })

  if (res.status === 401) {
    log.warn('api', `401 on ${path} — token missing, invalid or expired`)
    unauthorizedHandler?.(token)
  }
  return res
}
