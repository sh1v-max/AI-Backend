import { useState } from 'react'
import { Check, Copy } from '@phosphor-icons/react'
import { ChatSources } from './ChatSources'
import { Markdown } from './Markdown'
import { BrandMark } from '../common/BrandMark'
import type { ChatMessage } from '../../types/chat'

interface ChatTurnProps {
  message: ChatMessage
  // false while this answer is still streaming in — the copy button would
  // only copy half of it
  complete?: boolean
}

export function ChatTurn({ message, complete = true }: ChatTurnProps) {
  // The user's own text stays plain: what they typed is shown exactly as
  // typed, never interpreted as markdown. Only the model's answers (and not
  // error messages) get rendered.
  if (message.role === 'user') {
    return (
      <div className="chat-turn chat-turn--user">
        <div className="chat-bubble chat-bubble--user">{message.content}</div>
      </div>
    )
  }

  return (
    <div className="chat-turn chat-turn--assistant">
      <BrandMark size={28} />
      <div className="chat-answer">
        {message.isError ? (
          <div className="chat-bubble chat-bubble--error">{message.content}</div>
        ) : (
          <Markdown>{message.content}</Markdown>
        )}

        {!message.isError && complete && (
          <ChatSources sources={message.sources ?? []} actions={<CopyButton text={message.content} />} />
        )}
      </div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard can be blocked (permissions, insecure origin) — nothing useful to show
    }
  }

  return (
    <button type="button" className="answer-action" onClick={copy} title="Copy answer">
      {copied ? <Check size={14} weight="bold" aria-hidden /> : <Copy size={14} aria-hidden />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}
