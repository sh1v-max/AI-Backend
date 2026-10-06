import { useEffect, useRef, useState } from 'react'
import { ChatCircleText, ClipboardText, DotsThree, FileText, Plus, Spinner, TrashSimple } from '@phosphor-icons/react'
import { USER_MAX_DOCUMENTS } from '../../types/document'
import type { UploadedDocument } from '../../types/document'

interface DocumentListProps {
  documents: UploadedDocument[]
  // highlighted: the document the open chat (or the home screen's box) is about
  activeDocumentId: string | null
  // the caller's cap (guest 5, registered 10), for the "3 / 5" counter
  maxDocuments: number
  isGuest: boolean
  uploading: boolean
  // no uploads mid-answer (see App.handleUpload)
  uploadDisabled: boolean
  onUpload: (file: File) => void
  onChat: (doc: UploadedDocument) => void
  onQuiz: (doc: UploadedDocument) => void
  onDelete: (doc: UploadedDocument) => void
}

// Where the open ⋯ menu goes. position: fixed, measured from the button,
// because the sidebar's scroll area has overflow: auto, which would clip a
// menu opened near its bottom edge.
interface MenuState {
  documentId: string
  top: number
  left: number
}

const MENU_WIDTH = 176

// UI.5 — the sidebar's Documents section. Documents used to appear only as
// chips on the new-chat screen, so once you were in a conversation there was
// nowhere to see or manage them. Now: the list, a + to upload, the cap, and a
// ⋯ menu per file with the three things you can do with one (chat, quiz,
// delete). The quiz button moved here from the chat header.
export function DocumentList({
  documents,
  activeDocumentId,
  maxDocuments,
  isGuest,
  uploading,
  uploadDisabled,
  onUpload,
  onChat,
  onQuiz,
  onDelete,
}: DocumentListProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const atCap = documents.length >= maxDocuments

  // Close the menu on a click outside it, Escape, scrolling or resizing (a
  // fixed-position menu would otherwise float away from its row).
  useEffect(() => {
    if (!menu) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element
      // a ⋯ button handles itself in toggleMenu (closing here first would make
      // its click re-open the menu it was meant to close)
      if (target.closest('.doc-item-more')) return
      if (!menuRef.current?.contains(target)) setMenu(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenu(null)
    }
    function close() {
      setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    // capture: scroll events don't bubble, this catches the sidebar's own scroll too
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [menu])

  // Move focus into the menu when it opens, so the keyboard can use it.
  useEffect(() => {
    if (menu) menuRef.current?.querySelector('button')?.focus()
  }, [menu])

  function toggleMenu(doc: UploadedDocument, button: HTMLButtonElement) {
    if (menu?.documentId === doc.documentId) {
      setMenu(null)
      return
    }
    const rect = button.getBoundingClientRect()
    // right-aligned under the button, kept inside the window
    const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8))
    setMenu({ documentId: doc.documentId, top: rect.bottom + 4, left })
  }

  // run a menu action and close the menu first
  function act(action: (doc: UploadedDocument) => void, doc: UploadedDocument) {
    setMenu(null)
    action(doc)
  }

  const menuDoc = menu ? documents.find((d) => d.documentId === menu.documentId) : undefined

  return (
    <section className="sidebar-section" aria-label="Your documents">
      <div className="sidebar-section-header">
        <h3 className="sidebar-section-label">Documents</h3>
        <span
          className={`doc-count ${atCap ? 'doc-count--full' : ''}`}
          title={
            atCap
              ? `You've reached the limit of ${maxDocuments}. Delete one to upload another.`
              : `${documents.length} of ${maxDocuments} documents used`
          }
        >
          {documents.length} / {maxDocuments}
        </span>
        <button
          type="button"
          className="sidebar-section-action"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || uploadDisabled || atCap}
          aria-label="Upload a PDF"
          title={atCap ? 'Document limit reached' : 'Upload a PDF'}
        >
          {uploading ? <Spinner size={14} className="spin" /> : <Plus size={14} weight="bold" />}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }}
        />
      </div>

      {documents.length === 0 ? (
        <p className="doc-list-empty">No documents yet. Upload a PDF to start.</p>
      ) : (
        <ul className="doc-list">
          {documents.map((doc) => {
            const isActive = doc.documentId === activeDocumentId
            const menuOpen = menu?.documentId === doc.documentId
            return (
              <li
                key={doc.documentId}
                className={`doc-item ${isActive ? 'doc-item--active' : ''} ${menuOpen ? 'doc-item--menu-open' : ''}`}
              >
                <button type="button" className="doc-item-button" onClick={() => onChat(doc)} title={doc.filename}>
                  <FileText size={15} aria-hidden />
                  <span className="doc-item-name">{doc.filename}</span>
                </button>
                <button
                  type="button"
                  className="doc-item-more"
                  onClick={(e) => toggleMenu(doc, e.currentTarget)}
                  aria-label={`Actions for "${doc.filename}"`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <DotsThree size={18} weight="bold" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* a guest at the cap gets told how to get more room */}
      {isGuest && atCap && <p className="doc-cap-note">Sign up to keep up to {USER_MAX_DOCUMENTS} documents.</p>}

      {menu && menuDoc && (
        <div
          ref={menuRef}
          className="doc-menu"
          role="menu"
          aria-label={`Actions for "${menuDoc.filename}"`}
          style={{ top: menu.top, left: menu.left, width: MENU_WIDTH }}
        >
          <button type="button" role="menuitem" onClick={() => act(onChat, menuDoc)}>
            <ChatCircleText size={16} aria-hidden />
            New chat about it
          </button>
          <button type="button" role="menuitem" onClick={() => act(onQuiz, menuDoc)}>
            <ClipboardText size={16} aria-hidden />
            Generate quiz
          </button>
          <button type="button" role="menuitem" className="doc-menu-danger" onClick={() => act(onDelete, menuDoc)}>
            <TrashSimple size={16} aria-hidden />
            Delete
          </button>
        </div>
      )}
    </section>
  )
}
