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

  const last = messages[messages.length - 1]
  // Streaming has "started" once the assistant bubble has real text in it —
  // until then (retrieval + first token), keep showing the Thinking… bubble.
  const streamingStarted = loading && last?.role === 'assistant' && last.content.length > 0

  // Follow the reply as it grows, not just when a new message is added.
  const lastContentLength = last?.content.length ?? 0
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth' })
  }, [messages.length, lastContentLength, loading])

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <p className="chat-empty">Ask a question to get started.</p>
        ) : (
          messages.map((m, i) =>
            // The empty placeholder (sources arrived, no text yet) stays hidden
            // so it doesn't render as a blank bubble next to Thinking….
            m.role === 'assistant' && !m.content && !m.isError ? null : (
              <ChatTurn key={i} message={m} />
            ),
          )
        )}

        {loading && !streamingStarted && (
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
