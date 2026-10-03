import { Router } from 'express'
import {
  getMessagesForSession,
  listSessions,
  deleteSession,
} from '../repositories/chatMessages.repository'

export const sessionsRouter = Router()

// Auth.3 — every query below is scoped to req.user!.id (set by requireAuth).
// Someone else's sessionId behaves exactly like a session that doesn't exist:
// an empty transcript, and a delete that removes nothing.

sessionsRouter.get('/sessions', async (req, res) => {
  const sessions = await listSessions(req.user!.id)
  res.json(sessions)
})

sessionsRouter.get('/sessions/:sessionId/messages', async (req, res) => {
  const messages = await getMessagesForSession(req.params.sessionId, req.user!.id)
  res.json(messages)
})

sessionsRouter.delete('/sessions/:sessionId', async (req, res) => {
  await deleteSession(req.params.sessionId, req.user!.id)
  res.json({ deleted: req.params.sessionId })
})
