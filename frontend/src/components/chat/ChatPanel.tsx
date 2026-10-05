import { useEffect, useRef } from 'react'
import { ChatTurn } from './ChatTurn'
import { ChatInputForm } from './ChatInputForm'
import { ScopeSelect } from './ScopeSelect'
import { BrandMark } from '../common/BrandMark'
import type { ChatMessage } from '../../types/chat'
import type { UploadedDocument } from '../../types/document'

interface ChatPanelProps {
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  loading: boolean
  // UI.4 — for the scope picker in the chat box
  activeDocument: { documentId: string; filename: string } | null
  documents: UploadedDocument[]
  onChangeScope: (documentId: string) => void
}

// UI.1 — only shown once a conversation exists. The empty state with the
// starter questions moved to the home screen (NewChatScreen), which is where
// a new chat now starts.
export function ChatPanel({
  messages,
  input,
  onInputChange,
  onSend,
  loading,
  activeDocument,
  documents,
  onChangeScope,
}: ChatPanelProps) {
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
          {messages.map((m, i) =>
            // The empty placeholder (sources arrived, no text yet) stays hidden
            // so it doesn't render as a blank bubble next to Thinking….
            m.role === 'assistant' && !m.content && !m.isError ? null : (
              <ChatTurn key={i} message={m} complete={!(loading && i === messages.length - 1)} />
            ),
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

      <ChatInputForm
        value={input}
        onChange={onInputChange}
        onSubmit={onSend}
        disabled={loading}
        toolbar={
          activeDocument && (
            // no switching mid-answer: a new chat would swap the messages out
            // from under the stream that's still writing into them
            <ScopeSelect
              activeDocument={activeDocument}
              documents={documents}
              onChange={onChangeScope}
              disabled={loading}
            />
          )
        }
      />
    </div>
  )
}
