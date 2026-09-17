import { useEffect, useRef } from 'react'
import { Spinner } from '@phosphor-icons/react'
import { ChatTurn } from './ChatTurn'
import { ChatInputForm } from './ChatInputForm'
import type { ChatMessage } from '../../types/chat'

interface ChatPanelProps {
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  loading: boolean
}

export function ChatPanel({ messages, input, onInputChange, onSend, loading }: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <p className="chat-empty">Ask a question about this document to get started.</p>
        ) : (
          messages.map((m, i) => <ChatTurn key={i} message={m} />)
        )}

        {loading && (
          <div className="chat-bubble chat-bubble--assistant chat-bubble--loading">
            <Spinner size={16} weight="bold" className="spin" aria-hidden />
            Thinking…
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <ChatInputForm value={input} onChange={onInputChange} onSubmit={onSend} disabled={loading} />
    </div>
  )
}
