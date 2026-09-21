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
