import { useRef, useState, type DragEvent } from 'react'
import {
  UploadSimple,
  FileText,
  CheckCircle,
  XCircle,
  Spinner,
} from '@phosphor-icons/react'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface UploadResult {
  filename: string
  textLength: number
  preview: string
}

type Status = 'idle' | 'uploading' | 'success' | 'error'

function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
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
    setResult(null)

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

      setResult(data)
      setStatus('success')
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
        <p className="subtitle">Upload a PDF and extract its text — Step 2.1</p>
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

      {status === 'success' && result && (
        <div className="result-card">
          <div className="result-header">
            <FileText size={20} weight="regular" aria-hidden />
            <span className="result-filename">{result.filename}</span>
            <span className="badge">
              <CheckCircle size={14} weight="fill" aria-hidden />
              {result.textLength.toLocaleString()} chars
            </span>
          </div>
          <pre className="result-preview">{result.preview}</pre>
        </div>
      )}
    </div>
  )
}

export default App
