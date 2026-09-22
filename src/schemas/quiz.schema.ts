import { z } from 'zod'

// Step 4.1 — the shape a quiz MUST have. The same tool that validates request
// bodies, aimed the other way: the LLM is just another untrusted client, so
// nothing it sends gets used until it has passed through these schemas.

export const QUIZ_LENGTH = 5
export const OPTIONS_PER_QUESTION = 4

export const QuizQuestion = z
  .object({
    question: z.string().min(1),
    // exactly 4 options — not 3, not 5
    options: z.array(z.string().min(1)).length(OPTIONS_PER_QUESTION),
    // a whole number 0..3, i.e. an index into `options`. The string "2" is rejected.
    correctIndex: z.number().int().min(0).max(OPTIONS_PER_QUESTION - 1),
  })
  // .refine() = a custom rule the type shapes can't express. Four identical
  // options would make a "quiz" with no real choice.
  .refine((q) => new Set(q.options).size === q.options.length, {
    message: 'options must all be different',
    path: ['options'],
  })

export const Quiz = z.array(QuizQuestion).length(QUIZ_LENGTH)

// One schema, two things: the runtime check above AND this TypeScript type,
// so the two can never drift apart.
export type QuizQuestion = z.infer<typeof QuizQuestion>
export type Quiz = z.infer<typeof Quiz>

// The same shape written in the format Gemini's structured-output mode wants
// (a subset of OpenAPI/JSON Schema). Handing this to the API *constrains* the
// model toward the right shape — but it doesn't replace the Zod check above:
// the API is asked nicely, Zod is the guard at the door.
export const quizResponseSchema = {
  type: 'ARRAY',
  minItems: QUIZ_LENGTH,
  maxItems: QUIZ_LENGTH,
  items: {
    type: 'OBJECT',
    properties: {
      question: { type: 'STRING' },
      options: {
        type: 'ARRAY',
        minItems: OPTIONS_PER_QUESTION,
        maxItems: OPTIONS_PER_QUESTION,
        items: { type: 'STRING' },
      },
      correctIndex: { type: 'INTEGER' },
    },
    required: ['question', 'options', 'correctIndex'],
  },
}
