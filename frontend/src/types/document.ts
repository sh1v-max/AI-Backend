export interface UploadedDocument {
  documentId: string
  filename: string
  fileSizeBytes: number
  textLength: number
  chunkCount: number
  createdAt: string
}

export type UploadStatus = 'idle' | 'uploading' | 'error'
