import { CaretDown, Files, FileText } from '@phosphor-icons/react'
import { ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL } from '../../types/document'
import type { UploadedDocument } from '../../types/document'

interface ScopeSelectProps {
  activeDocument: { documentId: string; filename: string }
  documents: UploadedDocument[]
  onChange: (documentId: string) => void
  disabled?: boolean
}

// UI.4 — "what is this conversation searching?", shown inside the chat box
// (it used to be a "Searching in" dropdown in the header). It sits where
// people look right before they ask something.
//
// Step 3.3 still applies: a conversation's scope is fixed once it starts (its
// messages are saved against one documentId), so picking a different one
// starts a fresh chat; the old one stays in the sidebar history.
//
// It's a real <select> styled as a pill, not a custom dropdown: keyboard,
// screen readers and the phone's native picker all work for free.
export function ScopeSelect({ activeDocument, documents, onChange, disabled = false }: ScopeSelectProps) {
  const isAll = activeDocument.documentId === ALL_DOCUMENTS
  const label = isAll ? ALL_DOCUMENTS_LABEL : activeDocument.filename
  const icon = isAll ? <Files size={14} aria-hidden /> : <FileText size={14} aria-hidden />

  // With one document there's nothing to switch to: just say what's searched.
  // Same when the conversation's document was deleted in another tab.
  const known = isAll || documents.some((d) => d.documentId === activeDocument.documentId)
  if (documents.length < 2 || !known) {
    return (
      <span className="scope-pill scope-pill--static" title={label}>
        {icon}
        <span className="scope-pill-prefix">Searching</span>
        <span className="scope-pill-text">{label}</span>
      </span>
    )
  }

  return (
    <label className="scope-pill" title="Switching starts a new chat">
      {icon}
      <span className="scope-pill-prefix" aria-hidden>
        Searching
      </span>
      <span className="scope-pill-text" aria-hidden>
        {label}
      </span>
      <CaretDown size={12} weight="bold" aria-hidden className="scope-pill-caret" />
      {/* the select covers the whole pill, invisible: the pill is what you
          see, the select is what you click */}
      <select
        value={activeDocument.documentId}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Which documents to search (switching starts a new chat)"
      >
        <option value={ALL_DOCUMENTS}>{ALL_DOCUMENTS_LABEL}</option>
        {documents.map((doc) => (
          <option key={doc.documentId} value={doc.documentId}>
            {doc.filename}
          </option>
        ))}
      </select>
    </label>
  )
}
