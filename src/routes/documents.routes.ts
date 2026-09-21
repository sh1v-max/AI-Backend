import { Router } from 'express'
import multer from 'multer'
import { ingestPdf } from '../services/ingestion.service'
import { deleteChunksByDocumentId } from '../repositories/chunks.repository'
import { listDocuments, deleteDocument } from '../repositories/documents.repository'
import { deleteMessagesByDocumentId } from '../repositories/chatMessages.repository'
import { pipelineStart, pipelineEnd, step, rejected } from '../utils/pipelineLogger'

export const documentsRouter = Router()

const upload = multer({ storage: multer.memoryStorage() })

documentsRouter.get('/documents', async (_req, res) => {
  const docs = await listDocuments()
  res.json(docs)
})

// Deleting a document removes its chunks and every session's chat history
// tied to it too — otherwise chat_messages would keep rows pointing at a
// document_id that no longer exists in the documents table.
documentsRouter.delete('/documents/:documentId', async (req, res) => {
  const { documentId } = req.params
  await deleteChunksByDocumentId(documentId)
  await deleteMessagesByDocumentId(documentId)
  await deleteDocument(documentId)
  res.json({ deleted: documentId })
})

documentsRouter.post('/upload', upload.single('file'), async (req, res) => {
  const t0 = Date.now()
  pipelineStart('upload', 'POST /upload')

  if (!req.file) {
    rejected('no file in request (expected form field "file")')
    return res.status(400).json({
      error: 'No file uploaded (expected form field "file")',
    })
  }

  if (req.file.mimetype !== 'application/pdf') {
    rejected(`wrong mimetype (${req.file.mimetype})`)
    return res.status(400).json({ error: 'Only PDF files are supported' })
  }

  step('upload', 1, 5, `File received: "${req.file.originalname}" (${req.file.size} bytes)`)

  const document = await ingestPdf(req.file)

  pipelineEnd('upload', Date.now() - t0)

  res.json(document)
})
