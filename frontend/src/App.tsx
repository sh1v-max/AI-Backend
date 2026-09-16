import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import {
  UploadSimple,
  FileText,
  CheckCircle,
  XCircle,
  Spinner,
  PaperPlaneRight,
  ChatCircleDots,
  SidebarSimple,
  X,
  FilePdf,
} from '@phosphor-icons/react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface UploadedDocument {
  documentId: string
  filename: string
  fileSizeBytes: number
  textLength: number
  chunkCount: number
  createdAt: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  isError?: boolean
}

type Status = 'idle' | 'uploading' | 'error'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatRelativeTime(isoDate: string): string {
  const seconds = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sidebar starts open on desktop, collapsed to an icon rail on demand —
  // same idea as ChatGPT's history sidebar. Separate from the mobile drawer
  // flags below, which fully hide/show the panels instead of just narrowing them.
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [mobileDocsOpen, setMobileDocsOpen] = useState(false)

  // Keyed by documentId so switching between documents keeps each chat
  // history separate instead of one shared thread across every document.
  const [chatsByDocument, setChatsByDocument] = useState<Record<string, ChatMessage[]>>({})
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const messages = selectedId ? chatsByDocument[selectedId] ?? [] : []
  const selectedDocument = documents.find((d) => d.documentId === selectedId) ?? null

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Load whatever documents already exist on the server — not just ones this
  // tab uploaded itself. Without this, a document uploaded via Postman/curl
  // (or from a different browser tab) would never show up here.
  useEffect(() => {
    fetch(`${API_URL}/documents`)
      .then((res) => res.json())
      .then(
        (
          docs: {
            id: string
            filename: string
            fileSizeBytes: number
            textLength: number
            chunkCount: number
            createdAt: string
          }[],
        ) => {
          setDocuments(
            docs.map((d) => ({
              documentId: d.id,
              filename: d.filename,
              fileSizeBytes: d.fileSizeBytes,
              textLength: d.textLength,
              chunkCount: d.chunkCount,
              createdAt: d.createdAt,
            })),
          )
        },
      )
      .catch(() => {
        // Non-fatal — the upload flow still works even if this initial fetch fails
      })
  }, [])

  async function uploadFile(file: File) {
    if (file.type !== 'application/pdf') {
      setStatus('error')
      setError('Only PDF files are supported.')
      return
    }

    setStatus('uploading')
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      const doc: UploadedDocument = {
        documentId: data.documentId,
        filename: data.filename,
        fileSizeBytes: data.fileSizeBytes,
        textLength: data.textLength,
        chunkCount: data.chunkCount,
        createdAt: data.createdAt,
      }

      setDocuments((prev) => [doc, ...prev])
      setSelectedId(doc.documentId)
      setStatus('idle')
      setMobileHistoryOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  async function handleSendMessage(e: FormEvent) {
    e.preventDefault()
    const message = chatInput.trim()
    if (!message || !selectedId || chatLoading) return

    const documentId = selectedId
    const userMessage: ChatMessage = { role: 'user', content: message }

    setChatsByDocument((prev) => ({
      ...prev,
      [documentId]: [...(prev[documentId] ?? []), userMessage],
    }))
    setChatInput('')
    setChatLoading(true)

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, message }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Chat request failed')
      }

      const assistantMessage: ChatMessage = { role: 'assistant', content: data.answer }
      setChatsByDocument((prev) => ({
        ...prev,
        [documentId]: [...(prev[documentId] ?? []), assistantMessage],
      }))
    } catch (err) {
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: err instanceof Error ? err.message : 'Something went wrong',
        isError: true,
      }
      setChatsByDocument((prev) => ({
        ...prev,
        [documentId]: [...(prev[documentId] ?? []), errorMessage],
      }))
    } finally {
      setChatLoading(false)
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  function selectDocument(id: string) {
    setSelectedId(id)
    setMobileHistoryOpen(false)
  }

  return (
    <div className="app-shell">
      {/* History — left. Collapses to an icon rail on desktop, becomes an
          overlay drawer on narrow screens (mobileHistoryOpen). */}
      <aside
        className={`history-panel ${historyCollapsed ? 'history-panel--collapsed' : ''} ${
          mobileHistoryOpen ? 'history-panel--mobile-open' : ''
        }`}
        aria-label="Chat history"
      >
        <div className="history-header">
          <button
            type="button"
            className="icon-button"
            onClick={() => setHistoryCollapsed((v) => !v)}
            aria-label={historyCollapsed ? 'Expand history' : 'Collapse history'}
            aria-expanded={!historyCollapsed}
            title={historyCollapsed ? 'Expand history' : 'Collapse history'}
          >
            <SidebarSimple size={18} weight="regular" />
          </button>
          {!historyCollapsed && <h2 className="history-title">History</h2>}
          <button
            type="button"
            className="icon-button icon-button--mobile-only"
            onClick={() => setMobileHistoryOpen(false)}
            aria-label="Close history"
          >
            <X size={18} weight="regular" />
          </button>
        </div>

        <div className="history-list">
          {documents.length === 0 && !historyCollapsed && (
            <p className="history-empty">Upload a PDF to start your first chat.</p>
          )}

          {documents.map((doc) => {
            const isSelected = doc.documentId === selectedId
            return (
              <button
                key={doc.documentId}
                type="button"
                className={`history-item ${isSelected ? 'history-item--active' : ''}`}
                onClick={() => selectDocument(doc.documentId)}
                title={doc.filename}
                aria-current={isSelected}
              >
                <FilePdf size={18} weight="regular" className="history-item-icon" aria-hidden />
                {!historyCollapsed && (
                  <span className="history-item-label">{doc.filename}</span>
                )}
              </button>
            )
          })}
        </div>
      </aside>

      {mobileHistoryOpen && (
        <div className="scrim" onClick={() => setMobileHistoryOpen(false)} aria-hidden />
      )}

      {/* Chat — middle-left, the primary surface. */}
      <main className="chat-main">
        <header className="chat-main-header">
          <button
            type="button"
            className="icon-button icon-button--mobile-only"
            onClick={() => setMobileHistoryOpen(true)}
            aria-label="Open history"
          >
            <SidebarSimple size={18} weight="regular" />
          </button>

          <div className="chat-main-title">
            <h1>DocMind</h1>
            {selectedDocument && (
              <span className="chat-main-subtitle">{selectedDocument.filename}</span>
            )}
          </div>

          <button
            type="button"
            className="icon-button icon-button--mobile-only"
            onClick={() => setMobileDocsOpen(true)}
            aria-label="Open documents"
          >
            <FileText size={18} weight="regular" />
          </button>
        </header>

        {selectedId ? (
          <div className="chat-panel">
            <div className="chat-messages">
              {messages.length === 0 ? (
                <p className="chat-empty">Ask a question about this document to get started.</p>
              ) : (
                messages.map((m, i) => (
                  <div
                    key={i}
                    className={`chat-bubble chat-bubble--${m.role} ${
                      m.isError ? 'chat-bubble--error' : ''
                    }`}
                  >
                    {m.content}
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="chat-bubble chat-bubble--assistant chat-bubble--loading">
                  <Spinner size={16} weight="bold" className="spin" aria-hidden />
                  Thinking…
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="chat-input-row" onSubmit={handleSendMessage}>
              <input
                type="text"
                className="chat-input"
                placeholder="Ask a question about this document…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={chatLoading}
                aria-label="Chat message"
              />
              <button
                type="submit"
                className="chat-send"
                disabled={chatLoading || !chatInput.trim()}
                aria-label="Send message"
              >
                <PaperPlaneRight size={18} weight="fill" />
              </button>
            </form>
          </div>
        ) : (
          <div className="chat-empty-state">
            <ChatCircleDots size={40} weight="regular" aria-hidden />
            <p className="chat-empty-state-title">No document selected</p>
            <p className="chat-empty-state-hint">
              Upload a PDF or pick one from your history to start chatting.
            </p>
          </div>
        )}
      </main>

      {mobileDocsOpen && (
        <div className="scrim" onClick={() => setMobileDocsOpen(false)} aria-hidden />
      )}

      {/* Documents — right. Upload + metadata for the active document. */}
      <aside
        className={`doc-panel ${mobileDocsOpen ? 'doc-panel--mobile-open' : ''}`}
        aria-label="Documents"
      >
        <div className="doc-panel-header">
          <h2 className="doc-panel-title">Documents</h2>
          <button
            type="button"
            className="icon-button icon-button--mobile-only"
            onClick={() => setMobileDocsOpen(false)}
            aria-label="Close documents"
          >
            <X size={18} weight="regular" />
          </button>
        </div>

        <div
          className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${
            status === 'uploading' ? 'dropzone--busy' : ''
          }`}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => status !== 'uploading' && inputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Upload PDF file"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadFile(file)
              e.target.value = ''
            }}
          />

          {status === 'uploading' ? (
            <>
              <Spinner size={28} weight="bold" className="spin" aria-hidden />
              <p className="dropzone-title">Extracting text…</p>
            </>
          ) : (
            <>
              <UploadSimple size={28} weight="regular" aria-hidden />
              <p className="dropzone-title">Drag & drop a PDF, or click to browse</p>
              <p className="dropzone-hint">Typed or exported PDFs only</p>
            </>
          )}
        </div>

        {status === 'error' && error && (
          <div className="banner banner--error" role="alert">
            <XCircle size={20} weight="fill" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {selectedDocument ? (
          <div className="doc-detail">
            <h3 className="doc-detail-title">Active document</h3>
            <div className="doc-detail-card">
              <div className="doc-detail-row">
                <FileText size={18} weight="regular" aria-hidden />
                <span className="doc-detail-filename">{selectedDocument.filename}</span>
                <span className="badge">
                  <CheckCircle size={12} weight="fill" aria-hidden />
                  Active
                </span>
              </div>
              <dl className="doc-detail-stats">
                <div>
                  <dt>Chunks</dt>
                  <dd>{selectedDocument.chunkCount.toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Text</dt>
                  <dd>{selectedDocument.textLength.toLocaleString()} chars</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatFileSize(selectedDocument.fileSizeBytes)}</dd>
                </div>
                <div>
                  <dt>Uploaded</dt>
                  <dd>{formatRelativeTime(selectedDocument.createdAt)}</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : (
          documents.length > 0 && (
            <p className="doc-panel-hint">Select a document from history to see its details.</p>
          )
        )}
      </aside>
    </div>
  )
}

export default App
