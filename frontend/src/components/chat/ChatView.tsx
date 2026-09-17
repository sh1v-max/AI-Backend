import { SidebarSimple, Spinner } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ChatPanel } from './ChatPanel'
import { NewChatScreen } from './NewChatScreen'
import type { ChatMessage } from '../../types/chat'
import type { UploadedDocument, UploadStatus } from '../../types/document'

interface ChatViewProps {
  activeDocument: { documentId: string; filename: string } | null
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  loading: boolean
  restoring: boolean
  onOpenSidebar: () => void
  documents: UploadedDocument[]
  uploadStatus: UploadStatus
  uploadError: string | null
  onUpload: (file: File) => void
  onPickDocument: (doc: UploadedDocument) => void
}

export function ChatView({
  activeDocument,
  messages,
  input,
  onInputChange,
  onSend,
  loading,
  restoring,
  onOpenSidebar,
  documents,
  uploadStatus,
  uploadError,
  onUpload,
  onPickDocument,
}: ChatViewProps) {
  return (
    <main className="chat-main">
      <header className="chat-main-header">
        <IconButton mobileOnly onClick={onOpenSidebar} aria-label="Open sidebar">
          <SidebarSimple size={18} weight="regular" />
        </IconButton>

        <div className="chat-main-title">
          {activeDocument ? (
            <span className="chat-main-subtitle">{activeDocument.filename}</span>
          ) : (
            <span className="chat-main-subtitle chat-main-subtitle--muted">New chat</span>
          )}
        </div>
      </header>

      {restoring ? (
        <div className="chat-restoring">
          <Spinner size={22} weight="bold" className="spin" aria-hidden />
        </div>
      ) : activeDocument ? (
        <ChatPanel
          messages={messages}
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          loading={loading}
        />
      ) : (
        <NewChatScreen
          documents={documents}
          uploadStatus={uploadStatus}
          uploadError={uploadError}
          onUpload={onUpload}
          onPickDocument={onPickDocument}
        />
      )}
    </main>
  )
}
