import { FilePdf, SidebarSimple, X } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import type { UploadedDocument } from '../../types/document'

interface HistoryPanelProps {
  documents: UploadedDocument[]
  selectedId: string | null
  collapsed: boolean
  mobileOpen: boolean
  onToggleCollapse: () => void
  onCloseMobile: () => void
  onSelect: (id: string) => void
}

export function HistoryPanel({
  documents,
  selectedId,
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
  onSelect,
}: HistoryPanelProps) {
  return (
    <aside
      className={`history-panel ${collapsed ? 'history-panel--collapsed' : ''} ${
        mobileOpen ? 'history-panel--mobile-open' : ''
      }`}
      aria-label="Chat history"
    >
      <div className="history-header">
        <IconButton
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand history' : 'Collapse history'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand history' : 'Collapse history'}
        >
          <SidebarSimple size={18} weight="regular" />
        </IconButton>
        {!collapsed && <h2 className="history-title">History</h2>}
        <IconButton mobileOnly onClick={onCloseMobile} aria-label="Close history">
          <X size={18} weight="regular" />
        </IconButton>
      </div>

      <div className="history-list">
        {documents.length === 0 && !collapsed && (
          <p className="history-empty">Upload a PDF to start your first chat.</p>
        )}

        {documents.map((doc) => {
          const isSelected = doc.documentId === selectedId
          return (
            <button
              key={doc.documentId}
              type="button"
              className={`history-item ${isSelected ? 'history-item--active' : ''}`}
              onClick={() => onSelect(doc.documentId)}
              title={doc.filename}
              aria-current={isSelected}
            >
              <FilePdf size={18} weight="regular" className="history-item-icon" aria-hidden />
              {!collapsed && <span className="history-item-label">{doc.filename}</span>}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
