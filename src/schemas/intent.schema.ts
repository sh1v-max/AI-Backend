import { z } from 'zod'

// AG.1 — the router's output: which kind of message is this? Same two-halves
// idea as the quiz (Step 4.1): Gemini is ASKED for this shape (the response
// schema at the bottom), and Zod VERIFIES it before anything trusts it.
//
// Three intents, as in the roadmap. "Which documents do I have?" is NOT its
// own intent: it's a document question, and the listDocuments tool (AG.3)
// answers it.

export const INTENTS = ['document_question', 'smalltalk', 'quiz_request'] as const

export const Intent = z.enum(INTENTS)
export type Intent = z.infer<typeof Intent>

// What the LLM classifier must reply: { "intent": "smalltalk" }. Anything
// else (another word, a missing field, prose) fails safeParse and the router
// falls back to document_question — today's behaviour, the safe default.
export const IntentReply = z.object({ intent: Intent })

// The same shape in Gemini's structured-output format (uppercase types, like
// quizResponseSchema). `enum` constrains the model to exactly these 3 strings.
export const intentResponseSchema = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: [...INTENTS] },
  },
  required: ['intent'],
}
