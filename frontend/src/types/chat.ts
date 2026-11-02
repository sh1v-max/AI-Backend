export interface ChatSource {
  content: string
  distance: number
  // Step 3.3 — which PDF this chunk came from (filename is null for old
  // chunks whose documents row no longer exists)
  documentId: string
  filename: string | null
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
  sources?: ChatSource[]
  // AG.4 — what the agent is doing right now ("Searching for …"), only on
  // the bubble that's still streaming. Never saved, never restored.
  status?: string
  // AG.5 — the button under a quiz offer. Arrives with the reply, not saved:
  // after a reload the offer comes back from history as plain text.
  action?: ChatAction
}

// AG.5 — what the button under a quiz offer does (same shape as the server's
// ChatAction in quizOffer.service.ts)
export type ChatAction =
  | { type: 'quiz'; documentId: string; filename: string }
  | { type: 'quiz_picker' }

// AG.2 — what the server's router decided (in /chat's JSON and the stream's
// meta). Only for devtools/logs; the UI doesn't branch on it.
export interface ChatRoute {
  intent: 'document_question' | 'smalltalk' | 'quiz_request'
  by: 'vector' | 'llm' | 'fallback'
  margin: number | null
}

export interface SessionSummary {
  sessionId: string
  documentId: string
  filename: string | null
  title: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
}
