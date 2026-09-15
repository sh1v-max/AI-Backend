import { useRef, useState, type DragEvent } from 'react'
import {
  UploadSimple,
  FileText,
  CheckCircle,
  XCircle,
  Spinner,
  Stack,
} from '@phosphor-icons/react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface UploadedDocument {
  documentId: string
  filename: string
  textLength: number
  chunkCount: number
}

type Status = 'idle' | 'uploading' | 'error'

function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [documents, setDocuments] = useState<UploadedDocument[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    if (file.type !== 'application/pdf') {
      setStatus('error')
      setError('Only PDF files are supported.')
      return
    }

    setStatus('uploading')
    setError(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch(`${API_URL}/upload`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Upload failed')
      }

      const doc: UploadedDocument = {
        documentId: data.documentId,
        filename: data.filename,
        textLength: data.textLength,
        chunkCount: data.chunkCount,
      }

      setDocuments((prev) => [doc, ...prev])
      setSelectedId(doc.documentId)
      setStatus('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setStatus('error')
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(file)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>DocMind</h1>
        <p className="subtitle">Upload a PDF, then chat with it</p>
      </header>

      <div
        className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${
          status === 'uploading' ? 'dropzone--busy' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => status !== 'uploading' && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Upload PDF file"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) uploadFile(file)
            e.target.value = ''
          }}
        />

        {status === 'uploading' ? (
          <>
            <Spinner size={32} weight="bold" className="spin" aria-hidden />
            <p className="dropzone-title">Extracting text…</p>
          </>
        ) : (
          <>
            <UploadSimple size={32} weight="regular" aria-hidden />
            <p className="dropzone-title">Drag & drop a PDF, or click to browse</p>
            <p className="dropzone-hint">Typed or exported PDFs only — scanned PDFs won't work</p>
          </>
        )}
      </div>

      {status === 'error' && error && (
        <div className="banner banner--error" role="alert">
          <XCircle size={20} weight="fill" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {documents.length > 0 && (
        <div className="doc-list" role="radiogroup" aria-label="Uploaded documents">
          <h2 className="doc-list-title">
            <Stack size={16} weight="bold" aria-hidden />
            Documents
          </h2>

          {documents.map((doc) => {
            const isSelected = doc.documentId === selectedId
            return (
              <button
                key={doc.documentId}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`doc-card ${isSelected ? 'doc-card--selected' : ''}`}
                onClick={() => setSelectedId(doc.documentId)}
              >
                <div className="doc-card-icon" aria-hidden>
                  {isSelected ? (
                    <CheckCircle size={20} weight="fill" />
                  ) : (
                    <FileText size={20} weight="regular" />
                  )}
                </div>

                <div className="doc-card-body">
                  <span className="doc-card-filename">{doc.filename}</span>
                  <span className="doc-card-meta">
                    {doc.chunkCount.toLocaleString()} chunk
                    {doc.chunkCount === 1 ? '' : 's'} ·{' '}
                    {doc.textLength.toLocaleString()} chars
                  </span>
                </div>

                {isSelected && <span className="badge">Active</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default App
