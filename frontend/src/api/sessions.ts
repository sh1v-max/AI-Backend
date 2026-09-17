import { API_URL } from './client'
import { log } from '../utils/logger'
import type { ChatMessage, SessionSummary } from '../types/chat'

export async function fetchSessions(): Promise<SessionSummary[]> {
  log.info('api:sessions', 'GET /sessions')
  const res = await fetch(`${API_URL}/sessions`)
  const sessions: SessionSummary[] = await res.json()
  log.info('api:sessions', `received ${sessions.length} session(s)`, sessions)
  return sessions
}

export async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  log.info('api:sessions', `GET /sessions/${sessionId}/messages`)
  const res = await fetch(`${API_URL}/sessions/${sessionId}/messages`)
  const rows: { role: 'user' | 'assistant'; content: string }[] = await res.json()
  log.info('api:sessions', `received ${rows.length} message(s) for session ${sessionId}`, rows)
  return rows.map((r) => ({ role: r.role, content: r.content }))
}
