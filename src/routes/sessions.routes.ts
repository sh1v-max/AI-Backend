import { Router } from 'express'
import {
  getMessagesForSession,
  listSessions,
  deleteSession,
} from '../repositories/chatMessages.repository'

export const sessionsRouter = Router()

sessionsRouter.get('/sessions', async (_req, res) => {
  const sessions = await listSessions()
  res.json(sessions)
})

sessionsRouter.get('/sessions/:sessionId/messages', async (req, res) => {
  const messages = await getMessagesForSession(req.params.sessionId)
  res.json(messages)
})

sessionsRouter.delete('/sessions/:sessionId', async (req, res) => {
  await deleteSession(req.params.sessionId)
  res.json({ deleted: req.params.sessionId })
})
