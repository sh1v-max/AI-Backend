import { useCallback, useRef, useState } from 'react'
import { Sidebar } from './components/sidebar/Sidebar'
import { ChatView } from './components/chat/ChatView'
import { useDocuments } from './hooks/useDocuments'
import { useSessions } from './hooks/useSessions'
import { useChat } from './hooks/useChat'
import { useQuiz } from './hooks/useQuiz'
import { useAuth } from './hooks/useAuth'
import { QuizModal } from './components/quiz/QuizModal'
import { SplashScreen } from './components/common/SplashScreen'
import { AuthModal, type AuthMode } from './components/auth/AuthModal'
import { AccountArea } from './components/auth/AccountArea'
import type { User } from './types/auth'
import { log } from './utils/logger'
import { fetchSamplePdf, SAMPLE_FILENAME } from './api/sample'
import { ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL } from './types/document'
import type { UploadedDocument } from './types/document'
import type { SessionSummary } from './types/chat'
import './App.css'

interface AppShellProps {
  user: User
  onLogin: (email: string, password: string) => Promise<void>
  onRegister: (email: string, password: string) => Promise<void>
  onLogout: () => void
}

// Auth.4 — this was `App` before. It's the whole app as it was, unchanged:
// it just only gets mounted once useAuth (below) has a token to send.
// Auth.6 — plus the account area and the sign-in / sign-up modal.
function AppShell({ user, onLogin, onRegister, onLogout }: AppShellProps) {
  const { documents, status, error, uploadingName, uploadFile, showUploadError, deleteDocument } = useDocuments()
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
  const quiz = useQuiz()

  // UI.2 — a question sent while its PDF is still uploading waits here and is
  // sent when the upload finishes. Kept twice on purpose: the state is for
  // rendering (the "Will ask" chip), the ref is for handleUpload, which reads
  // it AFTER an `await` — by then the `pendingQuestion` variable it captured
  // when it started is stale, while ref.current is always the latest value.
  const [pendingQuestion, setPendingQuestionState] = useState<string | null>(null)
  const pendingQuestionRef = useRef<string | null>(null)
  function setPendingQuestion(question: string | null) {
    pendingQuestionRef.current = question
    setPendingQuestionState(question)
  }

  // Sidebar starts open on desktop, collapsed to an icon rail on demand.
  // Separate from the mobile drawer flag, which fully hides/shows the panel
  // instead of just narrowing it.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Auth.6 — which auth form is open, or null for none
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  // useCallback keeps this the SAME function across re-renders. AuthModal's
  // effect depends on onClose; a new function every render (e.g. each piece
  // of a streaming answer) would re-run it and yank focus back to the email
  // field mid-typing.
  const closeAuth = useCallback(() => setAuthMode(null), [])

  function openAuth(mode: AuthMode) {
    log.info('App', `[action] open auth — ${mode}`)
    setAuthMode(mode)
    setMobileSidebarOpen(false)
  }

  async function handleUpload(file: File) {
    log.info('App', `[action] file selected for upload — "${file.name}"`)
    const doc = await uploadFile(file)
    // UI.2 — whatever was queued during the upload, read now (not before the await)
    const queued = pendingQuestionRef.current
    setPendingQuestion(null)
    if (doc) {
      // UI.1 — this no longer opens a chat by itself: it attaches the new
      // document to the home screen's chat box, and the first question opens
      // the chat. (Dropped mid-conversation, it starts a new one about the file.)
      startNewChat(doc.documentId, doc.filename)
      setMobileSidebarOpen(false)
      if (queued) {
        log.info('App', `[action] upload finished — sending the queued question`)
        sendMessage(queued, { documentId: doc.documentId, filename: doc.filename })
      }
    } else {
      log.warn('App', '[action] upload did not return a document — staying on new-chat screen')
      // the question isn't lost: back into the box, in front of anything typed since
      if (queued) setChatInput((prev) => (prev.trim() ? `${queued}
${prev}` : queued))
    }
  }

  // UI.3 — the "How to start.pdf" button. Already uploaded -> just attach that
  // copy (no second upload, no extra embedding calls, no extra slot used).
  // Otherwise fetch the PDF that ships with the frontend and upload it like
  // any other file. The ref stops a double click from uploading it twice: the
  // fetch happens before status turns 'uploading', so the UI can't block it yet.
  const sampleLoading = useRef(false)
  async function handleTrySample() {
    const existing = documents.find((d) => d.filename === SAMPLE_FILENAME)
    if (existing) {
      log.info('App', '[action] sample already uploaded — attaching the existing copy')
      startNewChat(existing.documentId, existing.filename)
      return
    }
    if (sampleLoading.current) return
    sampleLoading.current = true
    log.info('App', '[action] trying the sample document')
    try {
      const file = await fetchSamplePdf()
      await handleUpload(file)
    } catch (err) {
      log.error('App', 'could not load the sample PDF', err)
      showUploadError(err instanceof Error ? err.message : "Couldn't load the sample document.")
    } finally {
      sampleLoading.current = false
    }
  }

  function handlePickDocument(doc: UploadedDocument) {
    log.info('App', `[action] picked existing document — "${doc.filename}" (${doc.documentId})`)
    startNewChat(doc.documentId, doc.filename)
    setMobileSidebarOpen(false)
  }

  // Step 3.3 — start a chat that searches every uploaded document.
  function handlePickAll() {
    log.info('App', '[action] picked "All documents"')
    startNewChat(ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL)
    setMobileSidebarOpen(false)
  }

  // UI.2 — send pressed while the PDF is still uploading
  function handleQueueQuestion(message: string) {
    log.info('App', '[action] question queued until the upload finishes', { message })
    setPendingQuestion(message)
    setChatInput('')
  }

  // UI.2 — the × on the "Will ask" chip: un-queue it, back into the box
  function handleCancelQueued() {
    const queued = pendingQuestionRef.current
    log.info('App', '[action] queued question cancelled')
    setPendingQuestion(null)
    if (queued) setChatInput((prev) => (prev.trim() ? prev : queued))
  }

  // UI.1 — the × on the document chip in the home screen's chat box
  function handleClearDocument() {
    log.info('App', '[action] removed the picked document from the chat box')
    resetToWelcome()
  }

  // Step 3.3 — the header's scope dropdown. A conversation's scope is fixed
  // when it starts, so switching begins a new chat (the old one stays in history).
  function handleChangeScope(documentId: string) {
    log.info('App', `[action] scope changed to ${documentId}`)
    if (documentId === ALL_DOCUMENTS) {
      startNewChat(ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL)
      return
    }
    const doc = documents.find((d) => d.documentId === documentId)
    if (doc) startNewChat(doc.documentId, doc.filename)
  }

  // Step 4.2F — the header's "Generate quiz" button. Only shown when
  // activeDocument is a real, single document (never null, never "All
  // documents" — see the guard in ChatView), but the check stays here too
  // since a handler shouldn't assume the UI enforced its own precondition.
  function handleGenerateQuiz() {
    if (!activeDocument || activeDocument.documentId === ALL_DOCUMENTS) return
    log.info('App', `[action] generate quiz — "${activeDocument.filename}" (${activeDocument.documentId})`)
    quiz.generate(activeDocument.documentId, activeDocument.filename)
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
        footer={
          <AccountArea user={user} collapsed={sidebarCollapsed} onOpenAuth={openAuth} onLogout={onLogout} />
        }
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
        activeSessionId={activeSessionId}
        activeDocument={activeDocument}
        messages={messages}
        input={chatInput}
        onInputChange={setChatInput}
        // a wrapper, so nothing can pass a second argument into `target` by accident
        onSend={(message) => sendMessage(message)}
        pendingQuestion={pendingQuestion}
        onQueueQuestion={handleQueueQuestion}
        onCancelQueued={handleCancelQueued}
        loading={chatLoading}
        restoring={restoring}
        onOpenSidebar={() => setMobileSidebarOpen(true)}
        documents={documents}
        uploadStatus={status}
        uploadError={error}
        uploadingName={uploadingName}
        onUpload={handleUpload}
        onTrySample={handleTrySample}
        onPickDocument={handlePickDocument}
        onPickAll={handlePickAll}
        onClearDocument={handleClearDocument}
        onChangeScope={handleChangeScope}
        onDeleteDocument={handleDeleteDocument}
        onGenerateQuiz={handleGenerateQuiz}
        quizLoading={quiz.loading}
      />

      <QuizModal
        open={quiz.open}
        loading={quiz.loading}
        error={quiz.error}
        quiz={quiz.quiz}
        filename={quiz.filename}
        onClose={quiz.close}
        onRegenerate={quiz.regenerate}
      />

      {authMode && (
        <AuthModal
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={closeAuth}
          onLogin={onLogin}
          onRegister={onRegister}
          guestDocumentCount={user.isGuest ? documents.length : 0}
        />
      )}
    </div>
  )
}

// Auth.4 — the gate. Two jobs:
//
// 1. Wait. useDocuments, useSessions and useChat all fetch the moment they
//    mount. Mounted before a token exists, all three would get a 401 on the
//    very first load. So AppShell isn't rendered until useAuth is 'ready'.
//
// 2. key={user.id}. React reuses a component as long as its `key` stays the
//    same. When the user changes (an expired token replaced by a new guest,
//    or later a login/logout), a different key makes React throw the old
//    AppShell away and mount a fresh one: every hook starts from empty state
//    and refetches for the new user, so nothing of the previous user's data
//    stays on screen.
function App() {
  const { state, retry, login, register, logout } = useAuth()

  if (state.status === 'loading') return <SplashScreen />
  if (state.status === 'error') return <SplashScreen error={state.message} onRetry={retry} />
  return (
    <AppShell key={state.user.id} user={state.user} onLogin={login} onRegister={register} onLogout={logout} />
  )
}

export default App
