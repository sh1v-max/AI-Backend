import { Router } from 'express'
import { generateQuiz } from '../services/quiz.service'
import { withErrorHandling } from '../utils/errors'
import { pipelineStart } from '../utils/pipelineLogger'

export const quizRouter = Router()

// Step 4.2 — POST /quiz: { documentId } -> a validated, shuffled quiz.
// Deliberately not streamed (unlike /chat-stream) — half a JSON object is
// useless, so the client waits for the complete, checked result.
quizRouter.post('/quiz', withErrorHandling('POST /quiz', async (req, res) => {
  const t0 = Date.now()
  pipelineStart('quiz', 'POST /quiz')

  const result = await generateQuiz({ documentId: req.body.documentId }, t0)
  if (!result.ok) return res.status(result.status).json({ error: result.error })

  res.json({ documentId: result.documentId, quiz: result.quiz })
}))
