import { FileText, SidebarSimple } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ChatPanel } from './ChatPanel'
import { ChatEmptyState } from './ChatEmptyState'
import type { ChatMessage } from '../../types/chat'
import type { UploadedDocument } from '../../types/document'

interface ChatMainProps {
  selectedDocument: UploadedDocument | null
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  loading: boolean
  onOpenHistory: () => void
  onOpenDocs: () => void
}

export function ChatMain({
  selectedDocument,
  messages,
  input,
  onInputChange,
  onSend,
  loading,
  onOpenHistory,
  onOpenDocs,
}: ChatMainProps) {
  return (
    <main className="chat-main">
      <header className="chat-main-header">
        <IconButton mobileOnly onClick={onOpenHistory} aria-label="Open history">
          <SidebarSimple size={18} weight="regular" />
        </IconButton>

        <div className="chat-main-title">
          <h1>DocMind</h1>
          {selectedDocument && (
            <span className="chat-main-subtitle">{selectedDocument.filename}</span>
          )}
        </div>

        <IconButton mobileOnly onClick={onOpenDocs} aria-label="Open documents">
          <FileText size={18} weight="regular" />
        </IconButton>
      </header>

      {selectedDocument ? (
        <ChatPanel
          messages={messages}
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          loading={loading}
        />
      ) : (
        <ChatEmptyState />
      )}
    </main>
  )
}
