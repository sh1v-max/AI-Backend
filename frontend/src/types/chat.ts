export interface ChatSource {
  content: string
  distance: number
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
