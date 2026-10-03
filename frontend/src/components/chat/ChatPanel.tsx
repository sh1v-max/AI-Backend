import { useEffect, useRef } from 'react'
import { ChatCircleText } from '@phosphor-icons/react'
import { ChatTurn } from './ChatTurn'
import { ChatInputForm } from './ChatInputForm'
import { BrandMark } from '../common/BrandMark'
import type { ChatMessage } from '../../types/chat'

interface ChatPanelProps {
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  loading: boolean
  // what the empty state says it's about: a filename, or "All documents"
  scopeLabel: string
}

// Starter questions for an empty chat. Clicking one sends it straight away,
// so a first-time visitor (or a recruiter) sees an answer in one click
// instead of facing a blank box.
const SUGGESTIONS = [
  'Summarize this in 5 bullet points',
  'What are the key facts and numbers?',
  'Explain the main idea simply',
]

export function ChatPanel({ messages, input, onInputChange, onSend, loading, scopeLabel }: ChatPanelProps) {
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
        {/* The conversation sits in one centred column (like a document page)
            instead of stretching across a wide screen, which made long
            answers hard to read. */}
        <div className="chat-column">
          {messages.length === 0 ? (
            <div className="chat-empty">
              <ChatCircleText size={28} weight="duotone" className="chat-empty-icon" aria-hidden />
              <h2>Ask anything about {scopeLabel}</h2>
              <p>Answers come only from your document, with the passages they used.</p>
              <div className="suggestion-row">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="suggestion" onClick={() => onSend(s)} disabled={loading}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) =>
              // The empty placeholder (sources arrived, no text yet) stays hidden
              // so it doesn't render as a blank bubble next to Thinking….
              m.role === 'assistant' && !m.content && !m.isError ? null : (
                <ChatTurn key={i} message={m} complete={!(loading && i === messages.length - 1)} />
              ),
            )
          )}

          {loading && !streamingStarted && (
            <div className="chat-turn chat-turn--assistant chat-thinking" role="status">
              <BrandMark size={28} />
              <div className="thinking-dots" aria-label="Thinking">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      <ChatInputForm value={input} onChange={onInputChange} onSubmit={onSend} disabled={loading} />
    </div>
  )
}
