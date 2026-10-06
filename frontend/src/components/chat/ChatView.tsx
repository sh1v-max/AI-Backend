import { useEffect, useRef, useState, type DragEvent } from 'react'
import { SidebarSimple, Spinner, UploadSimple } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ChatPanel } from './ChatPanel'
import { NewChatScreen } from './NewChatScreen'
import type { ChatMessage } from '../../types/chat'
import type { UploadedDocument, UploadStatus } from '../../types/document'

interface ChatViewProps {
  activeSessionId: string | null
  activeDocument: { documentId: string; filename: string } | null
  messages: ChatMessage[]
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  pendingQuestion: string | null
  onQueueQuestion: (message: string) => void
  onCancelQueued: () => void
  loading: boolean
  restoring: boolean
  onOpenSidebar: () => void
  documents: UploadedDocument[]
  uploadStatus: UploadStatus
  uploadError: string | null
  uploadingName: string | null
  onUpload: (file: File) => void
  onTrySample: () => void
  onPickDocument: (doc: UploadedDocument) => void
  onPickAll: () => void
  onClearDocument: () => void
  onChangeScope: (documentId: string) => void
}

// A drag carries "Files" in its types only when it's a file from the OS —
// not when someone drags selected text or a link around the page.
function isFileDrag(e: { dataTransfer: DataTransfer | null }) {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

export function ChatView({
  activeSessionId,
  activeDocument,
  messages,
  input,
  onInputChange,
  onSend,
  pendingQuestion,
  onQueueQuestion,
  onCancelQueued,
  loading,
  restoring,
  onOpenSidebar,
  documents,
  uploadStatus,
  uploadError,
  uploadingName,
  onUpload,
  onTrySample,
  onPickDocument,
  onPickAll,
  onClearDocument,
  onChangeScope,
}: ChatViewProps) {
  // UI.1 — the home screen and the conversation are told apart by whether a
  // conversation exists yet, NOT by whether a document is picked: picking or
  // uploading a document now keeps you on the home screen with that document
  // attached to the box, and the first question sent is what opens the chat.
  const inConversation = activeSessionId !== null || messages.length > 0
  // the first question, same as a session's title in the sidebar; while an
  // opened conversation is still loading, the document name stands in
  const conversationTitle =
    messages.find((m) => m.role === 'user')?.content ?? activeDocument?.filename ?? 'Conversation'

  // UI.1 — drop a PDF anywhere on the main area. dragenter/dragleave fire for
  // every child element the pointer crosses, so a plain true/false flag would
  // flicker; counting enters minus leaves tells when it has really left.
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  // no drops mid-upload, or mid-answer (a new chat would swap the messages
  // out from under the stream that's still writing into them)
  const canDrop = uploadStatus !== 'uploading' && !loading

  // A file dropped somewhere that isn't a drop target (the sidebar, a gap)
  // makes the browser open it and navigate away from the app. Cancelling the
  // default on the whole window prevents that.
  useEffect(() => {
    function block(e: globalThis.DragEvent) {
      if (isFileDrag(e)) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  function handleDragEnter(e: DragEvent<HTMLElement>) {
    if (!isFileDrag(e) || !canDrop) return
    dragDepth.current += 1
    setDragging(true)
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    // without preventDefault here the browser refuses the drop
    if (isFileDrag(e) && canDrop) e.preventDefault()
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    if (!isFileDrag(e) || !canDrop) return
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragging(false)
    }
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    if (!isFileDrag(e)) return
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!canDrop) return
    const file = e.dataTransfer.files?.[0]
    if (file) onUpload(file)
  }

  return (
    <main
      className="chat-main"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="chat-main-header">
        <IconButton mobileOnly onClick={onOpenSidebar} aria-label="Open sidebar">
          <SidebarSimple size={18} weight="regular" />
        </IconButton>

        <div className="chat-main-title">
          {/* UI.4 — the header names the conversation now (its first question,
              like the sidebar history does). Which document it searches moved
              into the chat box, see ScopeSelect. */}
          {inConversation ? (
            <span className="chat-main-subtitle">
              <span className="chat-main-subtitle-text">{conversationTitle}</span>
            </span>
          ) : (
            <span className="chat-main-subtitle chat-main-subtitle--muted">New chat</span>
          )}
        </div>

      </header>

      {restoring ? (
        <div className="chat-restoring">
          <Spinner size={22} weight="bold" className="spin" aria-hidden />
        </div>
      ) : inConversation ? (
        <ChatPanel
          messages={messages}
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          loading={loading}
          activeDocument={activeDocument}
          documents={documents}
          onChangeScope={onChangeScope}
        />
      ) : (
        <NewChatScreen
          activeDocument={activeDocument}
          documents={documents}
          uploadStatus={uploadStatus}
          uploadError={uploadError}
          uploadingName={uploadingName}
          input={input}
          onInputChange={onInputChange}
          onSend={onSend}
          pendingQuestion={pendingQuestion}
          onQueueQuestion={onQueueQuestion}
          onCancelQueued={onCancelQueued}
          onUpload={onUpload}
          onTrySample={onTrySample}
          onPickDocument={onPickDocument}
          onPickAll={onPickAll}
          onClearDocument={onClearDocument}
        />
      )}

      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-card">
            <UploadSimple size={32} weight="regular" />
            <p>Drop your PDF to chat with it</p>
          </div>
        </div>
      )}
    </main>
  )
}
