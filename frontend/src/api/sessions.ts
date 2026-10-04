import { authFetch, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { ChatMessage, SessionSummary } from '../types/chat'

// Auth.4 — authFetch instead of fetch (adds the token), and parseJsonOrThrow
// instead of a bare res.json() on the two reads, so a 401 becomes a readable
// error instead of an { error } object that crashes the code below it.

export async function fetchSessions(): Promise<SessionSummary[]> {
  log.info('api:sessions', 'GET /sessions')
  const res = await authFetch('/sessions')
  const sessions: SessionSummary[] = await parseJsonOrThrow(res)
  log.info('api:sessions', `received ${sessions.length} session(s)`, sessions)
  return sessions
}

export async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  log.info('api:sessions', `GET /sessions/${sessionId}/messages`)
  const res = await authFetch(`/sessions/${sessionId}/messages`)
  const rows: { role: 'user' | 'assistant'; content: string }[] = await parseJsonOrThrow(res)
  log.info('api:sessions', `received ${rows.length} message(s) for session ${sessionId}`, rows)
  return rows.map((r) => ({ role: r.role, content: r.content }))
}

export async function deleteSession(sessionId: string): Promise<void> {
  log.info('api:sessions', `DELETE /sessions/${sessionId}`)
  const res = await parseJsonOrThrow(await authFetch(`/sessions/${sessionId}`, { method: 'DELETE' }))
  log.info('api:sessions', 'delete complete', res)
}
