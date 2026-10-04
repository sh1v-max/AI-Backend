import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { ingestPdf } from '../services/ingestion.service'
import { deleteChunksByDocumentId } from '../repositories/chunks.repository'
import { listDocuments, deleteDocument, getDocumentForUser, countDocuments } from '../repositories/documents.repository'
import { deleteMessagesByDocumentId } from '../repositories/chatMessages.repository'
import { pipelineStart, pipelineEnd, step, detail, rejected, notFound } from '../utils/pipelineLogger'
import { MAX_UPLOAD_BYTES, GUEST_MAX_DOCUMENTS, USER_MAX_DOCUMENTS } from '../config'

export const documentsRouter = Router()

// multer is used to handle multipart/form-data, which is primarily used for uploading files. in this case, we are using multer to handle the file upload for pdf documents. 
// we are using memoryStorage to store the uploaded files in memory as Buffer objects, which is suitable for small files and allows us to process the file immediately without saving it to disk
// Phase 10 — `limits.fileSize` makes multer stop reading past MAX_UPLOAD_BYTES
// and throw a MulterError instead; app.ts turns that into a 413 JSON reply.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
})

// Auth.3 — every route in this file runs after requireAuth (see app.ts), so
// req.user is always set here. `req.user!.id` is the ONLY place a user id
// comes from: never the body, query or URL, which the client controls.

// Auth.7 — the per-user document cap, as a middleware that runs BEFORE multer
// on POST /upload. Order matters: multer reads the whole file (up to 10 MB)
// into memory, so checking first means a user who's over the limit is turned
// away before their upload is even read.
//
// 403, not 400: the request itself is fine, and we know exactly who they are
// — they're just not allowed to have more documents.
//
// Known gap: two uploads sent at the same instant could both see "4 of 5"
// and both pass, ending at 6. Fine for a cost guard; a hard limit would need
// the check and the insert in one transaction.
async function checkDocumentCap(req: Request, res: Response, next: NextFunction) {
  const { id, isGuest } = req.user!
  const max = isGuest ? GUEST_MAX_DOCUMENTS : USER_MAX_DOCUMENTS
  const current = await countDocuments(id)

  if (current >= max) {
    rejected(`upload cap — user ${id.slice(0, 8)} already has ${current}/${max} documents`)
    return res.status(403).json({
      error: isGuest
        ? `Guests can keep up to ${max} documents. Delete one, or sign up to keep up to ${USER_MAX_DOCUMENTS}.`
        : `You can keep up to ${max} documents. Delete one to upload another.`,
    })
  }
  next()
}

// List the caller's documents
documentsRouter.get('/documents', async (req, res) => {
  const docs = await listDocuments(req.user!.id)
  res.json(docs)
})

// Deleting a document removes its chunks and every session's chat history
// tied to it too — otherwise chat_messages would keep rows pointing at a
// document_id that no longer exists in the documents table.
documentsRouter.delete('/documents/:documentId', async (req, res) => {
  const { documentId } = req.params
  const userId = req.user!.id

  // Auth.3 — ownership is checked ONCE, up front, before any of the three
  // deletes. It matters most for the chunks: they have no owner column, so
  // deleteChunksByDocumentId() can't check ownership itself. 404 (not 403)
  // for someone else's document — 403 would confirm that the id exists.
  const document = await getDocumentForUser(documentId, userId)
  if (!document) {
    notFound(`DELETE /documents/${documentId} — no such document for user ${userId.slice(0, 8)}`)
    return res.status(404).json({ error: 'No document found with that documentId' })
  }

  await deleteChunksByDocumentId(documentId)
  await deleteMessagesByDocumentId(documentId, userId)
  await deleteDocument(documentId, userId)
  res.json({ deleted: documentId })
})

// upload endpoint for uploading a PDF document. The uploaded file is processed and ingested into the system, and the document metadata is returned in the response.
documentsRouter.post('/upload', checkDocumentCap, upload.single('file'), async (req, res) => {
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
  detail(`user: ${req.user!.id.slice(0, 8)}`)

  const document = await ingestPdf(req.file, req.user!.id)

  pipelineEnd('upload', Date.now() - t0)

  res.json(document)
})
