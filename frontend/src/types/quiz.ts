// Step 4.2F — matches the backend's Quiz/QuizQuestion shape (src/schemas/quiz.schema.ts)
export interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
}

export type Quiz = QuizQuestion[]
