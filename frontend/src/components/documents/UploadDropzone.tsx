import { useRef, useState, type DragEvent } from 'react'
import { Spinner, UploadSimple } from '@phosphor-icons/react'
import type { UploadStatus } from '../../types/document'

interface UploadDropzoneProps {
  status: UploadStatus
  onFileSelected: (file: File) => void
}

export function UploadDropzone({ status, onFileSelected }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = status === 'uploading'

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFileSelected(file)
  }

  return (
    <div
      className={`dropzone ${isDragging ? 'dropzone--active' : ''} ${
        busy ? 'dropzone--busy' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => !busy && inputRef.current?.click()}
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
          if (file) onFileSelected(file)
          e.target.value = ''
        }}
      />

      {busy ? (
        <>
          <Spinner size={28} weight="bold" className="spin" aria-hidden />
          <p className="dropzone-title">Extracting text…</p>
        </>
      ) : (
        <>
          <UploadSimple size={28} weight="regular" aria-hidden />
          <p className="dropzone-title">Drag & drop a PDF, or click to browse</p>
          <p className="dropzone-hint">Typed or exported PDFs only</p>
        </>
      )}
    </div>
  )
}
