import { API_URL, parseJsonOrThrow } from './client'
import { log } from '../utils/logger'
import type { Quiz } from '../types/quiz'

interface QuizResponse {
  documentId: string
  quiz: Quiz
}

// Step 4.2F — POST /quiz. Not streamed (unlike /chat-stream): a half-received
// quiz can't be validated or rendered, so this is a plain fetch + await, same
// shape as sendChatMessage — the whole thing arrives at once or not at all.
export async function generateQuiz(documentId: string): Promise<QuizResponse> {
  log.info('api:quiz', `POST /quiz — document=${documentId}`)

  const res = await fetch(`${API_URL}/quiz`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId }),
  })

  const data: QuizResponse = await parseJsonOrThrow(res)
  log.info('api:quiz', `quiz received (${data.quiz.length} question(s))`, data)

  return data
}
