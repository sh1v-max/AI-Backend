import { PencilSimpleLine, SidebarSimple, X } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { HistoryList } from './HistoryList'
import type { SessionSummary } from '../../types/chat'

interface SidebarProps {
  sessions: SessionSummary[]
  activeSessionId: string | null
  collapsed: boolean
  mobileOpen: boolean
  onToggleCollapse: () => void
  onCloseMobile: () => void
  onNewChat: () => void
  onSelectSession: (session: SessionSummary) => void
}

export function Sidebar({
  sessions,
  activeSessionId,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onNewChat,
  onSelectSession,
}: SidebarProps) {
  return (
    <aside
      className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${
        mobileOpen ? 'sidebar--mobile-open' : ''
      }`}
      aria-label="Chat sidebar"
    >
      <div className="sidebar-header">
        <span className="sidebar-brand">{!collapsed && 'DocMind'}</span>
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

      {!collapsed && (
        <HistoryList
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectSession}
        />
      )}
    </aside>
  )
}
