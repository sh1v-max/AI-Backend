import { useEffect, useRef } from 'react'
import { CaretRight, ClipboardText, FileText, X } from '@phosphor-icons/react'
import { formatFileSize, formatRelativeTime } from '../../utils/format'
import type { UploadedDocument } from '../../types/document'

interface QuizPickerModalProps {
  open: boolean
  documents: UploadedDocument[]
  onPick: (doc: UploadedDocument) => void
  onClose: () => void
}

// UI.6 — the sidebar's "Quiz" button opens this: pick which PDF to be quizzed
// on, and the quiz itself opens in QuizModal. A quiz is its own activity,
// not a side action of one document, so it gets its own entry point instead
// of living in the header (Step 4.2F) or in each document's ⋯ menu (UI.5).
// Only real documents are listed: a quiz needs one document's chunks in
// reading order (quiz.service.ts), so "All documents" can't be one.
export function QuizPickerModal({ open, documents, onPick, onClose }: QuizPickerModalProps) {
  const listRef = useRef<HTMLUListElement>(null)

  // Escape closes; focus starts on the first document so the keyboard can pick
  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('button')?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="quiz-overlay" onClick={onClose} role="presentation">
      <div
        className="quiz-modal quiz-picker"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a document to quiz yourself on"
        aria-modal
      >
        <header className="quiz-modal-header">
          <div className="quiz-modal-heading">
            <h2>Quiz yourself</h2>
            <span className="quiz-modal-subtitle">Pick a document: you get 5 multiple-choice questions about it.</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} weight="regular" />
          </button>
        </header>

        <div className="quiz-modal-body">
          {documents.length === 0 ? (
            <div className="quiz-state">
              <ClipboardText size={24} aria-hidden />
              <p>No documents yet.</p>
              <p className="quiz-state-hint">Upload a PDF first, then come back here to be quizzed on it.</p>
            </div>
          ) : (
            <ul className="quiz-picker-list" ref={listRef}>
              {documents.map((doc) => (
                <li key={doc.documentId}>
                  <button type="button" className="quiz-picker-item" onClick={() => onPick(doc)}>
                    <span className="quiz-picker-icon" aria-hidden>
                      <FileText size={18} weight="duotone" />
                    </span>
                    <span className="quiz-picker-text">
                      <span className="quiz-picker-name">{doc.filename}</span>
                      <span className="quiz-picker-meta">
                        {formatFileSize(doc.fileSizeBytes)}
                        {doc.createdAt && ` · uploaded ${formatRelativeTime(doc.createdAt)}`}
                      </span>
                    </span>
                    <CaretRight size={14} className="quiz-picker-arrow" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
