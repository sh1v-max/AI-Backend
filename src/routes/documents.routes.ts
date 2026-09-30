import { Router } from 'express'
import multer from 'multer'
import { ingestPdf } from '../services/ingestion.service'
import { deleteChunksByDocumentId } from '../repositories/chunks.repository'
import { listDocuments, deleteDocument } from '../repositories/documents.repository'
import { deleteMessagesByDocumentId } from '../repositories/chatMessages.repository'
import { pipelineStart, pipelineEnd, step, rejected } from '../utils/pipelineLogger'
import { MAX_UPLOAD_BYTES } from '../config'

export const documentsRouter = Router()

// multer is used to handle multipart/form-data, which is primarily used for uploading files. in this case, we are using multer to handle the file upload for pdf documents. 
// we are using memoryStorage to store the uploaded files in memory as Buffer objects, which is suitable for small files and allows us to process the file immediately without saving it to disk
// Phase 10 — `limits.fileSize` makes multer stop reading past MAX_UPLOAD_BYTES
// and throw a MulterError instead; app.ts turns that into a 413 JSON reply.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

// List all documents
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

// upload endpoint for uploading a PDF document. The uploaded file is processed and ingested into the system, and the document metadata is returned in the response.
documentsRouter.post('/upload', upload.single('file'), async (req, res) => {
  const t0 = Date.now()
  // ignore all pipelineStart, pipelineEnd, step, rejected, etc. These are just for logging and monitoring the upload process. They don't affect the functionality of the upload endpoint. only for debugging and monitoring the upload process
  pipelineStart('upload', 'POST /upload')

  if (!req.file) {
    rejected('no file in request (expected form field "file")')
    return res.status(400).json({
      error: 'No file uploaded (expected form field "file")',
    })
  }

  // check that the uploaded file is a PDF. If not, reject the request with a 400 status code and an error message. This ensures that only PDF files are processed by the ingestPdf function.
  if (req.file.mimetype !== 'application/pdf') {
    rejected(`wrong mimetype (${req.file.mimetype})`)
    return res.status(400).json({ error: 'Only PDF files are supported' })
  }

  step('upload', 1, 5, `File received: "${req.file.originalname}" (${req.file.size} bytes)`)

  const document = await ingestPdf(req.file)

  pipelineEnd('upload', Date.now() - t0)

  res.json(document)
})
