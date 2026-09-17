import { useCallback, useEffect, useState } from 'react'
import { deleteSession as deleteSessionRequest, fetchSessions } from '../api/sessions'
import { log } from '../utils/logger'
import type { SessionSummary } from '../types/chat'

export function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])

  const refresh = useCallback(() => {
    log.info('useSessions', 'refresh() — reloading session list')
    fetchSessions()
      .then((sessions) => {
        log.info('useSessions', `session list updated (${sessions.length} session(s))`)
        setSessions(sessions)
      })
      .catch((err) => {
        log.warn('useSessions', 'session list refresh failed (non-fatal)', err)
      })
  }, [])

  useEffect(() => {
    log.info('useSessions', 'mount')
    refresh()
  }, [refresh])

  async function deleteSession(sessionId: string): Promise<boolean> {
    log.info('useSessions', `deleteSession() called — ${sessionId}`)
    try {
      await deleteSessionRequest(sessionId)
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId))
      log.info('useSessions', `session ${sessionId} removed from state`)
      return true
    } catch (err) {
      log.error('useSessions', `delete failed for ${sessionId}`, err)
      return false
    }
  }

  return { sessions, refresh, deleteSession }
}
