import { useState } from 'react'
import { HistoryPanel } from './components/history/HistoryPanel'
import { ChatMain } from './components/chat/ChatMain'
import { DocumentsPanel } from './components/documents/DocumentsPanel'
import { useDocuments } from './hooks/useDocuments'
import { useChat } from './hooks/useChat'
import './App.css'

function App() {
  const { documents, status, error, uploadFile } = useDocuments()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Sidebar starts open on desktop, collapsed to an icon rail on demand —
  // same idea as ChatGPT's history sidebar. Separate from the mobile drawer
  // flags below, which fully hide/show the panels instead of just narrowing them.
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [mobileDocsOpen, setMobileDocsOpen] = useState(false)

  const { messages, chatInput, setChatInput, chatLoading, sendMessage } = useChat(selectedId)
  const selectedDocument = documents.find((d) => d.documentId === selectedId) ?? null

  async function handleFileSelected(file: File) {
    const doc = await uploadFile(file)
    if (doc) {
      setSelectedId(doc.documentId)
      setMobileHistoryOpen(false)
    }
  }

  function handleSelectDocument(id: string) {
    setSelectedId(id)
    setMobileHistoryOpen(false)
  }

  return (
    <div className="app-shell">
      <HistoryPanel
        documents={documents}
        selectedId={selectedId}
        collapsed={historyCollapsed}
        mobileOpen={mobileHistoryOpen}
        onToggleCollapse={() => setHistoryCollapsed((v) => !v)}
        onCloseMobile={() => setMobileHistoryOpen(false)}
        onSelect={handleSelectDocument}
      />

      {mobileHistoryOpen && (
        <div className="scrim" onClick={() => setMobileHistoryOpen(false)} aria-hidden />
      )}

      <ChatMain
        selectedDocument={selectedDocument}
        messages={messages}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={sendMessage}
        loading={chatLoading}
        onOpenHistory={() => setMobileHistoryOpen(true)}
        onOpenDocs={() => setMobileDocsOpen(true)}
      />

      {mobileDocsOpen && (
        <div className="scrim" onClick={() => setMobileDocsOpen(false)} aria-hidden />
      )}

      <DocumentsPanel
        documents={documents}
        selectedDocument={selectedDocument}
        status={status}
        error={error}
        mobileOpen={mobileDocsOpen}
        onCloseMobile={() => setMobileDocsOpen(false)}
        onFileSelected={handleFileSelected}
      />
    </div>
  )
}

export default App
