import { useCallback, useEffect, useState } from 'react'
import { fetchSessions } from '../api/sessions'
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

  return { sessions, refresh }
}
