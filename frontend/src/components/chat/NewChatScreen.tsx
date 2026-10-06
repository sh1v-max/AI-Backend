import { useRef, useState, type AnimationEvent } from 'react'
import { ArrowRight, ClockCountdown, Files, FileText, Spinner, X, XCircle } from '@phosphor-icons/react'
import { BrandMark } from '../common/BrandMark'
import { ChatInputForm } from './ChatInputForm'
import { SAMPLE_FILENAME } from '../../api/sample'
import { ALL_DOCUMENTS, ALL_DOCUMENTS_LABEL } from '../../types/document'
import type { UploadedDocument, UploadStatus } from '../../types/document'

// Starter questions, shown once a document is picked. Clicking one sends it
// straight away, so a first-time visitor (or a recruiter) sees an answer in
// one click instead of facing a blank box.
const SUGGESTIONS = [
  'Summarize this in 5 bullet points',
  'What are the key facts and numbers?',
  'Explain the main idea simply',
]

// UI.3 — for the sample document: questions it can actually answer, which
// also happen to show off what DocMind does
const SAMPLE_SUGGESTIONS = [
  'How does DocMind work under the hood?',
  'What kind of PDFs work?',
  'How do I keep my files?',
]

interface NewChatScreenProps {
  // the document the next question will be about (picked or just uploaded), or null
  activeDocument: { documentId: string; filename: string } | null
  documents: UploadedDocument[]
  uploadStatus: UploadStatus
  uploadError: string | null
  // the file being uploaded right now, for the progress chip
  uploadingName: string | null
  input: string
  onInputChange: (value: string) => void
  onSend: (message: string) => void
  // UI.2 — the question waiting for the upload to finish, and how to queue / un-queue it
  pendingQuestion: string | null
  onQueueQuestion: (message: string) => void
  onCancelQueued: () => void
  onUpload: (file: File) => void
  // UI.3 — the one-click "How to start.pdf" sample
  onTrySample: () => void
  onPickDocument: (doc: UploadedDocument) => void
  onPickAll: () => void
  onClearDocument: () => void
}

// UI.1 — the home screen is now the chat box itself (it used to be a big
// upload box, which made DocMind look like a file uploader). The PDF is
// something you attach to the box: the paperclip, a drop anywhere on the page
// (handled in ChatView), or one of your earlier documents below.
export function NewChatScreen({
  activeDocument,
  documents,
  uploadStatus,
  uploadError,
  uploadingName,
  input,
  onInputChange,
  onSend,
  pendingQuestion,
  onQueueQuestion,
  onCancelQueued,
  onUpload,
  onTrySample,
  onPickDocument,
  onPickAll,
  onClearDocument,
}: NewChatScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploading = uploadStatus === 'uploading'
  const isAll = activeDocument?.documentId === ALL_DOCUMENTS
  // UI.2 — "attach a PDF first" is two things: the red hint, which stays
  // until a document is attached (so there's time to read it), and the shake,
  // which ends with its animation so the next blocked send can play it again.
  const [nudged, setNudged] = useState(false)
  const [shaking, setShaking] = useState(false)
  const nudging = nudged && !activeDocument && !uploading

  // UI.2 — what pressing send does depends on where the PDF is:
  // uploading -> queue the question; attached -> send it; none -> nudge.
  function handleSubmit(message: string) {
    if (uploading) {
      onQueueQuestion(message)
    } else if (activeDocument) {
      onSend(message)
    } else {
      setNudged(true)
      setShaking(true)
    }
  }

  // animationend bubbles up from children too (the spinner), so only the
  // shake on this element itself counts
  function handleAnimationEnd(e: AnimationEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) setShaking(false)
  }

  // The chip inside the box: the upload in progress wins, otherwise the
  // picked document (with an × to un-pick it).
  const attachment = uploading ? (
    <span className="attachment attachment--busy" role="status">
      <Spinner size={14} weight="bold" className="spin" aria-hidden />
      <span className="attachment-name">{uploadingName}</span>
      <span className="attachment-status">Reading &amp; indexing…</span>
    </span>
  ) : activeDocument ? (
    <span className="attachment">
      {isAll ? <Files size={14} aria-hidden /> : <FileText size={14} aria-hidden />}
      <span className="attachment-name">
        {isAll ? `${ALL_DOCUMENTS_LABEL} (${documents.length})` : activeDocument.filename}
      </span>
      <button type="button" className="attachment-remove" onClick={onClearDocument} aria-label="Remove document">
        <X size={12} weight="bold" />
      </button>
    </span>
  ) : null

  // UI.2 — the queued question, as a second chip next to the upload's
  const queuedChip = pendingQuestion && (
    <span className="attachment attachment--queued">
      <ClockCountdown size={14} aria-hidden />
      <span className="attachment-name">Will ask: {pendingQuestion}</span>
      <button type="button" className="attachment-remove" onClick={onCancelQueued} aria-label="Cancel queued question">
        <X size={12} weight="bold" />
      </button>
    </span>
  )

  const hint = nudging
    ? 'Attach a PDF first: use the paperclip, or drop one anywhere on this page.'
    : pendingQuestion
      ? 'Your question will be sent as soon as the PDF is ready.'
      : uploading
        ? "You don't have to wait: send your question now and it's asked when the PDF is ready."
        : activeDocument
          ? undefined
          : 'Attach a PDF with the paperclip, or drop one anywhere on this page. Typed or exported PDFs only.'

  // Short on purpose: the chip above already names the file, and a long
  // filename here wrapped onto three lines on a phone.
  const placeholder = pendingQuestion
    ? 'Waiting for the PDF…'
    : uploading
      ? 'Type your question while the PDF is read…'
      : !activeDocument
        ? 'Attach a PDF, then ask anything about it…'
        : isAll
          ? 'Ask anything about all your documents…'
          : 'Ask anything about this document…'

  return (
    <div className="new-chat-screen">
      <div className="new-chat-intro">
        <BrandMark size={40} />
        <h1>What do you want to know?</h1>
        <p>Attach a PDF and ask it anything. Answers come only from your document, with the passages they used.</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUpload(file)
          // reset, so picking the same file again still fires onChange
          e.target.value = ''
        }}
      />

      <div
        className={`home-composer ${nudging ? 'home-composer--nudge' : ''} ${shaking ? 'home-composer--shake' : ''}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <ChatInputForm
          value={input}
          onChange={onInputChange}
          onSubmit={handleSubmit}
          disabled={false}
          // one queued question at a time
          sendBlocked={!!pendingQuestion}
          attachments={
            attachment || queuedChip ? (
              <>
                {attachment}
                {queuedChip}
              </>
            ) : null
          }
          onAttach={() => fileInputRef.current?.click()}
          attachDisabled={uploading}
          placeholder={placeholder}
          hint={hint}
        />
      </div>

      {uploadStatus === 'error' && uploadError && (
        <div className="banner banner--error" role="alert">
          <XCircle size={20} weight="fill" aria-hidden />
          <span>{uploadError}</span>
        </div>
      )}

      {/* UI.3 — no PDF handy? One click: upload the sample (or attach the
          copy uploaded earlier) and the starter questions below take over. */}
      {!activeDocument && !uploading && (
        <button type="button" className="sample-card" onClick={onTrySample}>
          <span className="sample-card-icon" aria-hidden>
            <FileText size={20} weight="duotone" />
          </span>
          <span className="sample-card-text">
            <strong>No PDF handy? Try “{SAMPLE_FILENAME}”</strong>
            <span>A short guide to DocMind. Ask it how the app works.</span>
          </span>
          <ArrowRight size={16} className="sample-card-arrow" aria-hidden />
        </button>
      )}

      {activeDocument && !uploading && (
        <div className="suggestion-row">
          {(activeDocument.filename === SAMPLE_FILENAME ? SAMPLE_SUGGESTIONS : SUGGESTIONS).map((s) => (
            <button key={s} type="button" className="suggestion" onClick={() => onSend(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <div className="new-chat-recent">
          {/* UI.5 — just for picking now; managing (delete, quiz) lives in
              the sidebar's ⋯ menus */}
          <span className="new-chat-recent-label">Your documents</span>
          <div className="doc-chip-row">
            {/* Step 3.3 — search every document at once. Only worth offering
                when there's more than one to search. */}
            {documents.length > 1 && (
              <div className={`doc-chip ${isAll ? 'doc-chip--active' : ''}`}>
                <button type="button" className="doc-chip-button" onClick={onPickAll}>
                  <Files size={14} weight="regular" aria-hidden />
                  {ALL_DOCUMENTS_LABEL} ({documents.length})
                </button>
              </div>
            )}
            {documents.map((doc) => (
              <div
                key={doc.documentId}
                className={`doc-chip ${activeDocument?.documentId === doc.documentId ? 'doc-chip--active' : ''}`}
              >
                <button type="button" className="doc-chip-button" onClick={() => onPickDocument(doc)}>
                  <FileText size={14} weight="regular" aria-hidden />
                  <span className="doc-chip-name">{doc.filename}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
