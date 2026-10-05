import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Paperclip } from '@phosphor-icons/react'

interface ChatInputFormProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (message: string) => void
  // disables the whole thing (typing too) — used while an answer streams in
  disabled: boolean
  // UI.1 — the extras the home screen needs; the chat panel passes none of them.
  // sendBlocked stops sending but still allows typing (e.g. no PDF attached yet,
  // so you can write the question first).
  sendBlocked?: boolean
  // chips shown inside the box, above the text (the attached PDF)
  attachments?: ReactNode
  // shows the paperclip button when given
  onAttach?: () => void
  attachDisabled?: boolean
  placeholder?: string
  hint?: string
}

// How tall the box may grow before it scrolls instead (~8 lines).
const MAX_HEIGHT_PX = 200

const DEFAULT_HINT = 'Answers are generated from your document by AI and can be wrong. Check the sources.'

export function ChatInputForm({
  value,
  onChange,
  onSubmit,
  disabled,
  sendBlocked = false,
  attachments,
  onAttach,
  attachDisabled = false,
  placeholder = 'Ask a question…',
  hint = DEFAULT_HINT,
}: ChatInputFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // A textarea doesn't grow with its content on its own. Reset the height,
  // then set it to the content's real height (scrollHeight), capped. Runs on
  // every change, including when the value is cleared after sending.
  // UI.1 — and when the placeholder changes: Chrome counts placeholder text in
  // scrollHeight, so an empty box kept the height of a longer, older one.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value, placeholder])

  function submit() {
    const message = value.trim()
    if (!message || disabled || sendBlocked) return
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
        {attachments && <div className="composer-attachments">{attachments}</div>}

        <div className="composer-row">
          {onAttach && (
            <button
              type="button"
              className="composer-attach"
              onClick={onAttach}
              disabled={attachDisabled}
              aria-label="Attach a PDF"
              title="Attach a PDF"
            >
              <Paperclip size={18} weight="regular" />
            </button>
          )}
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder={placeholder}
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
            disabled={disabled || sendBlocked || !value.trim()}
            aria-label="Send message"
          >
            <ArrowUp size={18} weight="bold" />
          </button>
        </div>
      </div>
      <p className="composer-hint">{hint}</p>
    </form>
  )
}
