import { PaperPlaneRight } from '@phosphor-icons/react'
import type { FormEvent } from 'react'

interface ChatInputFormProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (message: string) => void
  disabled: boolean
}

export function ChatInputForm({ value, onChange, onSubmit, disabled }: ChatInputFormProps) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const message = value.trim()
    if (!message) return
    onSubmit(message)
  }

  return (
    <form className="chat-input-row" onSubmit={handleSubmit}>
      <input
        type="text"
        className="chat-input"
        placeholder="Ask a question about this document…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Chat message"
      />
      <button
        type="submit"
        className="chat-send"
        disabled={disabled || !value.trim()}
        aria-label="Send message"
      >
        <PaperPlaneRight size={18} weight="fill" />
      </button>
    </form>
  )
}
