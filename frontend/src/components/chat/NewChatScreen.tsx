import { Files, FileText, TrashSimple, XCircle } from '@phosphor-icons/react'
import { UploadDropzone } from '../documents/UploadDropzone'
import type { UploadedDocument, UploadStatus } from '../../types/document'

interface NewChatScreenProps {
  documents: UploadedDocument[]
  uploadStatus: UploadStatus
  uploadError: string | null
  onUpload: (file: File) => void
  onPickDocument: (doc: UploadedDocument) => void
  onPickAll: () => void
  onDeleteDocument: (doc: UploadedDocument) => void
}

export function NewChatScreen({
  documents,
  uploadStatus,
  uploadError,
  onUpload,
  onPickDocument,
  onPickAll,
  onDeleteDocument,
}: NewChatScreenProps) {
  return (
    <div className="new-chat-screen">
      <div className="new-chat-intro">
        <h1>Chat with a document</h1>
        <p>Upload a PDF and ask it anything — DocMind reads it so you don't have to.</p>
      </div>

      <UploadDropzone status={uploadStatus} onFileSelected={onUpload} />

      {uploadStatus === 'error' && uploadError && (
        <div className="banner banner--error" role="alert">
          <XCircle size={20} weight="fill" aria-hidden />
          <span>{uploadError}</span>
        </div>
      )}

      {documents.length > 0 && (
        <div className="new-chat-recent">
          <span className="new-chat-recent-label">Or continue with a document you've uploaded before</span>
          <div className="doc-chip-row">
            {/* Step 3.3 — the default scope: search every document at once.
                Only worth offering when there's more than one to search. */}
            {documents.length > 1 && (
              <div className="doc-chip doc-chip--all">
                <button type="button" className="doc-chip-button" onClick={onPickAll}>
                  <Files size={14} weight="regular" aria-hidden />
                  All documents ({documents.length})
                </button>
              </div>
            )}
            {documents.map((doc) => (
              <div key={doc.documentId} className="doc-chip">
                <button type="button" className="doc-chip-button" onClick={() => onPickDocument(doc)}>
                  <FileText size={14} weight="regular" aria-hidden />
                  {doc.filename}
                </button>
                <button
                  type="button"
                  className="doc-chip-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteDocument(doc)
                  }}
                  aria-label={`Delete "${doc.filename}"`}
                  title="Delete document"
                >
                  <TrashSimple size={12} weight="regular" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
