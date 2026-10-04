import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowUp } from '@phosphor-icons/react'

interface ChatInputFormProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (message: string) => void
  disabled: boolean
}

// How tall the box may grow before it scrolls instead (~8 lines).
const MAX_HEIGHT_PX = 200

export function ChatInputForm({ value, onChange, onSubmit, disabled }: ChatInputFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // A textarea doesn't grow with its content on its own. Reset the height,
  // then set it to the content's real height (scrollHeight), capped. Runs on
  // every change, including when the value is cleared after sending.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  function submit() {
    const message = value.trim()
    if (!message || disabled) return
    onSubmit(message)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  // Enter sends, Shift+Enter makes a new line (what chat apps do).
  // isComposing: while typing with an input method (e.g. Hindi or Japanese
  // keyboards), Enter confirms the chosen word — it must not send.
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-input"
          placeholder="Ask a question…"
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-label="Chat message"
        />
        <button
          type="submit"
          className="composer-send"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
        >
          <ArrowUp size={18} weight="bold" />
        </button>
      </div>
      <p className="composer-hint">Answers are generated from your document by AI and can be wrong. Check the sources.</p>
    </form>
  )
}
