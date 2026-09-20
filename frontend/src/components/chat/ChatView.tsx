import { SidebarSimple, Spinner } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ChatPanel } from './ChatPanel'
import { NewChatScreen } from './NewChatScreen'
import type { ChatMessage } from '../../types/chat'
import { ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL } from '../../types/document'
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
  onPickAll: () => void
  onChangeScope: (documentId: string) => void
  onDeleteDocument: (doc: UploadedDocument) => void
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
  onPickAll,
  onChangeScope,
  onDeleteDocument,
}: ChatViewProps) {
  return (
    <main className="chat-main">
      <header className="chat-main-header">
        <IconButton mobileOnly onClick={onOpenSidebar} aria-label="Open sidebar">
          <SidebarSimple size={18} weight="regular" />
        </IconButton>

        <div className="chat-main-title">
          {activeDocument && documents.length > 1 ? (
            // Step 3.3 — the scope toggle. A conversation's scope is fixed once
            // it starts (its messages are saved against one documentId), so
            // picking a different one starts a fresh chat; the old one stays
            // in the sidebar history.
            <label className="scope-select">
              <span className="scope-select-label">Searching in</span>
              <select
                value={activeDocument.documentId}
                onChange={(e) => onChangeScope(e.target.value)}
                title="Switching starts a new chat"
                aria-label="Which documents to search"
              >
                <option value={ALL_DOCUMENTS}>{ALL_DOCUMENTS_LABEL}</option>
                {documents.map((doc) => (
                  <option key={doc.documentId} value={doc.documentId}>
                    {doc.filename}
                  </option>
                ))}
              </select>
            </label>
          ) : activeDocument ? (
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
          onPickAll={onPickAll}
          onDeleteDocument={onDeleteDocument}
        />
      )}
    </main>
  )
}
