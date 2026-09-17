import { X, XCircle } from '@phosphor-icons/react'
import { IconButton } from '../common/IconButton'
import { UploadDropzone } from './UploadDropzone'
import { DocumentDetail } from './DocumentDetail'
import type { UploadedDocument, UploadStatus } from '../../types/document'

interface DocumentsPanelProps {
  documents: UploadedDocument[]
  selectedDocument: UploadedDocument | null
  status: UploadStatus
  error: string | null
  mobileOpen: boolean
  onCloseMobile: () => void
  onFileSelected: (file: File) => void
}

export function DocumentsPanel({
  documents,
  selectedDocument,
  status,
  error,
  mobileOpen,
  onCloseMobile,
  onFileSelected,
}: DocumentsPanelProps) {
  return (
    <aside className={`doc-panel ${mobileOpen ? 'doc-panel--mobile-open' : ''}`} aria-label="Documents">
      <div className="doc-panel-header">
        <h2 className="doc-panel-title">Documents</h2>
        <IconButton mobileOnly onClick={onCloseMobile} aria-label="Close documents">
          <X size={18} weight="regular" />
        </IconButton>
      </div>

      <UploadDropzone status={status} onFileSelected={onFileSelected} />

      {status === 'error' && error && (
        <div className="banner banner--error" role="alert">
          <XCircle size={20} weight="fill" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {selectedDocument ? (
        <DocumentDetail document={selectedDocument} />
      ) : (
        documents.length > 0 && (
          <p className="doc-panel-hint">Select a document from history to see its details.</p>
        )
      )}
    </aside>
  )
}
