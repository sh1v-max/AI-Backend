import { useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { useDocuments } from './hooks/useDocuments'
import { useSessions } from './hooks/useSessions'
import { useChat } from './hooks/useChat'
import { log } from './utils/logger'
import type { UploadedDocument } from './types/document'
import type { SessionSummary } from './types/chat'
import './App.css'

function App() {
  const { documents, status, error, uploadFile, deleteDocument } = useDocuments()
  const { sessions, refresh: refreshSessions, deleteSession } = useSessions()
  const {
    activeSessionId,
    activeDocument,
    messages,
    chatInput,
    setChatInput,
    chatLoading,
    restoring,
    startNewChat,
    resetToWelcome,
    openSession,
    sendMessage,
  } = useChat(refreshSessions)

  // Sidebar starts open on desktop, collapsed to an icon rail on demand.
  // Separate from the mobile drawer flag, which fully hides/shows the panel
  // instead of just narrowing it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  async function handleUpload(file: File) {
    log.info('App', `[action] file selected for upload — "${file.name}"`)
    const doc = await uploadFile(file)
    if (doc) {
      startNewChat(doc.documentId, doc.filename)
      setMobileSidebarOpen(false)
    } else {
      log.warn('App', '[action] upload did not return a document — staying on new-chat screen')
    }
  }

  function handlePickDocument(doc: UploadedDocument) {
    log.info('App', `[action] picked existing document — "${doc.filename}" (${doc.documentId})`)
    startNewChat(doc.documentId, doc.filename)
    setMobileSidebarOpen(false)
  }

  function handleSelectSession(session: (typeof sessions)[number]) {
    log.info('App', `[action] selected session from history — "${session.title}"`)
    openSession(session)
    setMobileSidebarOpen(false)
  }

  function handleNewChat() {
    log.info('App', '[action] "New chat" clicked')
    resetToWelcome()
    setMobileSidebarOpen(false)
  }

  async function handleDeleteDocument(doc: UploadedDocument) {
    log.info('App', `[action] delete document requested — "${doc.filename}" (${doc.documentId})`)
    const confirmed = window.confirm(
      `Delete "${doc.filename}"? This also deletes every conversation about it. This can't be undone.`,
    )
    if (!confirmed) {
      log.info('App', '[action] delete document cancelled by user')
      return
    }

    const wasActive = activeDocument?.documentId === doc.documentId
    const ok = await deleteDocument(doc.documentId)

    if (ok) {
      // Deleting a document also deletes its chat_messages on the backend,
      // so any session summaries for it are now stale — refresh the list
      // instead of trying to figure out which ones to drop client-side.
      refreshSessions()
      if (wasActive) resetToWelcome()
    }
  }

  async function handleDeleteSession(session: SessionSummary) {
    log.info('App', `[action] delete session requested — "${session.title}" (${session.sessionId})`)
    const confirmed = window.confirm(`Delete this conversation? This can't be undone.`)
    if (!confirmed) {
      log.info('App', '[action] delete session cancelled by user')
      return
    }

    const wasActive = activeSessionId === session.sessionId
    const ok = await deleteSession(session.sessionId)
    if (ok && wasActive) resetToWelcome()
  }

  return (
    <div className="app-shell">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        onCloseMobile={() => setMobileSidebarOpen(false)}
        onNewChat={handleNewChat}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
      />

      {mobileSidebarOpen && (
        <div className="scrim" onClick={() => setMobileSidebarOpen(false)} aria-hidden />
      )}

      <ChatView
        activeDocument={activeDocument}
        messages={messages}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={sendMessage}
        loading={chatLoading}
        restoring={restoring}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
        documents={documents}
        uploadStatus={status}
        uploadError={error}
        onUpload={handleUpload}
        onPickDocument={handlePickDocument}
        onDeleteDocument={handleDeleteDocument}
      />
    </div>
  )
}

export default App
