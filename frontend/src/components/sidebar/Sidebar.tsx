import type { ReactNode } from 'react'
import { PencilSimpleLine, SidebarSimple, X } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { BrandMark } from '../common/BrandMark'
import { HistoryList } from './HistoryList'
import { DocumentList } from './DocumentList'
import type { SessionSummary } from '../../types/chat'
import type { UploadedDocument } from '../../types/document'

interface SidebarProps {
  // Auth.6 — the account area pinned to the bottom (built in App, which owns the user)
  footer?: ReactNode
  sessions: SessionSummary[]
  activeSessionId: string | null
  collapsed: boolean
  mobileOpen: boolean
  onToggleCollapse: () => void
  onCloseMobile: () => void
  onNewChat: () => void
  onSelectSession: (session: SessionSummary) => void
  onDeleteSession: (session: SessionSummary) => void
  // UI.5 — the Documents section
  documents: UploadedDocument[]
  activeDocumentId: string | null
  maxDocuments: number
  isGuest: boolean
  uploading: boolean
  uploadDisabled: boolean
  onUpload: (file: File) => void
  onChatDocument: (doc: UploadedDocument) => void
  onQuizDocument: (doc: UploadedDocument) => void
  onDeleteDocument: (doc: UploadedDocument) => void
}

export function Sidebar({
  footer,
  sessions,
  activeSessionId,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onNewChat,
  onSelectSession,
  onDeleteSession,
  documents,
  activeDocumentId,
  maxDocuments,
  isGuest,
  uploading,
  uploadDisabled,
  onUpload,
  onChatDocument,
  onQuizDocument,
  onDeleteDocument,
}: SidebarProps) {
  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${
        mobileOpen ? 'sidebar--mobile-open' : ''
      }`}
      aria-label="Chat sidebar"
    >
      <div className="sidebar-header">
        <span className="sidebar-brand">
          {!collapsed && (
            <>
              <BrandMark size={24} />
              DocMind
            </>
          )}
        </span>
        <IconButton
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <SidebarSimple size={18} weight="regular" />
        </IconButton>
        <IconButton mobileOnly onClick={onCloseMobile} aria-label="Close sidebar">
          <X size={18} weight="regular" />
        </IconButton>
      </div>

      <button type="button" className="new-chat-button" onClick={onNewChat} title="New chat">
        <PencilSimpleLine size={17} weight="regular" aria-hidden />
        {!collapsed && <span>New chat</span>}
      </button>

      {/* UI.5 — documents and chats share one scroll area, so a long list of
          either never pushes the other (or the account area) off screen */}
      {!collapsed && (
        <div className="sidebar-scroll">
          <DocumentList
            documents={documents}
            activeDocumentId={activeDocumentId}
            maxDocuments={maxDocuments}
            isGuest={isGuest}
            uploading={uploading}
            uploadDisabled={uploadDisabled}
            onUpload={onUpload}
            onChat={onChatDocument}
            onQuiz={onQuizDocument}
            onDelete={onDeleteDocument}
          />
          <section className="sidebar-section" aria-label="Chats">
            <div className="sidebar-section-header">
              <h3 className="sidebar-section-label">Chats</h3>
            </div>
            <HistoryList
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelectSession={onSelectSession}
              onDeleteSession={onDeleteSession}
            />
          </section>
        </div>
      )}

      {footer}
    </aside>
  )
}
