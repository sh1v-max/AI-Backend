import { ChatCircleDots } from '@phosphor-icons/react'

export function ChatEmptyState() {
  return (
    <div className="chat-empty-state">
      <ChatCircleDots size={40} weight="regular" aria-hidden />
      <p className="chat-empty-state-title">No document selected</p>
      <p className="chat-empty-state-hint">
        Upload a PDF or pick one from your history to start chatting.
      </p>
    </div>
  )
}
