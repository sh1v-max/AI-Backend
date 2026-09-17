import { ChatSources } from './ChatSources'
import type { ChatMessage } from '../../types/chat'

interface ChatTurnProps {
  message: ChatMessage
}

export function ChatTurn({ message }: ChatTurnProps) {
  return (
    <div className={`chat-turn chat-turn--${message.role}`}>
      <div
        className={`chat-bubble chat-bubble--${message.role} ${
          message.isError ? 'chat-bubble--error' : ''
        }`}
      >
        {message.content}
      </div>

      {message.sources && <ChatSources sources={message.sources} />}
    </div>
  )
}
