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
