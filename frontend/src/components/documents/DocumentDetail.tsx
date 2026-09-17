import { CheckCircle, FileText } from '@phosphor-icons/react'
import { formatFileSize, formatRelativeTime } from '../../utils/format'
import type { UploadedDocument } from '../../types/document'

interface DocumentDetailProps {
  document: UploadedDocument
}

export function DocumentDetail({ document }: DocumentDetailProps) {
  return (
    <div className="doc-detail">
      <h3 className="doc-detail-title">Active document</h3>
      <div className="doc-detail-card">
        <div className="doc-detail-row">
          <FileText size={18} weight="regular" aria-hidden />
          <span className="doc-detail-filename">{document.filename}</span>
          <span className="badge">
            <CheckCircle size={12} weight="fill" aria-hidden />
            Active
          </span>
        </div>
        <dl className="doc-detail-stats">
          <div>
            <dt>Chunks</dt>
            <dd>{document.chunkCount.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Text</dt>
            <dd>{document.textLength.toLocaleString()} chars</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatFileSize(document.fileSizeBytes)}</dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>{formatRelativeTime(document.createdAt)}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
