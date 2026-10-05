import { useEffect, useRef, useState, type DragEvent } from 'react'
import { ClipboardText, Files, FileText, SidebarSimple, Spinner, UploadSimple } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { ChatPanel } from './ChatPanel'
import { NewChatScreen } from './NewChatScreen'
import type { ChatMessage } from '../../types/chat'
import { ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL } from '../../types/document'
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
  onPickDocument: (doc: UploadedDocument) => void
  onPickAll: () => void
  onClearDocument: () => void
  onChangeScope: (documentId: string) => void
  onDeleteDocument: (doc: UploadedDocument) => void
  onGenerateQuiz: () => void
  quizLoading: boolean
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
  onPickDocument,
  onPickAll,
  onClearDocument,
  onChangeScope,
  onDeleteDocument,
  onGenerateQuiz,
  quizLoading,
}: ChatViewProps) {
  // UI.1 — the home screen and the conversation are told apart by whether a
  // conversation exists yet, NOT by whether a document is picked: picking or
  // uploading a document now keeps you on the home screen with that document
  // attached to the box, and the first question sent is what opens the chat.
  const inConversation = activeSessionId !== null || messages.length > 0

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
          {inConversation && activeDocument && documents.length > 1 ? (
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
          ) : inConversation && activeDocument ? (
            <span className="chat-main-subtitle">
              {activeDocument.documentId === ALL_DOCUMENTS ? (
                <Files size={16} aria-hidden />
              ) : (
                <FileText size={16} aria-hidden />
              )}
              <span className="chat-main-subtitle-text">{activeDocument.filename}</span>
            </span>
          ) : (
            <span className="chat-main-subtitle chat-main-subtitle--muted">New chat</span>
          )}
        </div>

        {/* Step 4.2F — a quiz needs one document's worth of chunks in reading
            order (see quiz.service.ts), so this is hidden for "All documents"
            and when no document is picked yet. */}
        {activeDocument && activeDocument.documentId !== ALL_DOCUMENTS && (
          <button
            type="button"
            className="quiz-generate-button"
            onClick={onGenerateQuiz}
            disabled={quizLoading}
            title="Generate a quiz from this document"
          >
            <ClipboardText size={15} weight="regular" aria-hidden />
            <span className="quiz-generate-button-label">Generate quiz</span>
          </button>
        )}
      </header>

      {restoring ? (
        <div className="chat-restoring">
          <Spinner size={22} weight="bold" className="spin" aria-hidden />
        </div>
      ) : inConversation ? (
        <ChatPanel messages={messages} input={input} onInputChange={onInputChange} onSend={onSend} loading={loading} />
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
          onPickDocument={onPickDocument}
          onPickAll={onPickAll}
          onClearDocument={onClearDocument}
          onDeleteDocument={onDeleteDocument}
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
