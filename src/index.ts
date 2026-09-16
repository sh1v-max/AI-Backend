import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomUUID } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { getEmbedding } from './services/embeddings.service'
import { generateAnswer } from './services/llm.service'
import { insertChunk, searchSimilar } from './repositories/chunks.repository'
import { insertDocument, listDocuments } from './repositories/documents.repository'
import {
  pipelineStart,
  pipelineEnd,
  step,
  detail,
  timing,
  preview,
  rejected,
  notFound,
} from './utils/pipelineLogger'

// Step 2.1 — PDF in, plain text out.
// Step 2.2 — chunk that text, embed each chunk, store it — a document
// becomes a set of searchable chunks, tagged with a documentId.
// Step 2.3 — POST /chat: embed the question, search stored chunks for this
// document, hand the relevant ones to the LLM, return a grounded answer.

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

// Only affects requests with Content-Type: application/json — /upload's
// multipart/form-data requests are handled separately by Multer, so the two
// don't conflict.
app.use(express.json())

// Split text into ~500-word chunks. Deliberately simple — chunking strategy
// tradeoffs (semantic boundaries, overlap) are a later, deeper topic.
function chunkText(text: string, wordsPerChunk = 500): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '))
  }

  return chunks
}

// The frontend (Vite dev server, localhost:5173) and this API (localhost:3000)
// are different origins even both on localhost — browsers block cross-origin
// requests by default unless the server explicitly allows them.
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  }),
)

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'DocMind API - POST a PDF to /upload',
  })
})

app.get('/documents', async (_req, res) => {
  const docs = await listDocuments()
  res.json(docs)
})

app.post('/chat', async (req, res) => {
  const t0 = Date.now()
  const { documentId, message } = req.body

  pipelineStart('chat', 'POST /chat')

  if (!documentId || typeof documentId !== 'string') {
    rejected('missing/invalid documentId')
    return res.status(400).json({ error: 'documentId (string) is required' })
  }

  if (!message || typeof message !== 'string') {
    rejected('missing/invalid message')
    return res.status(400).json({ error: 'message (string) is required' })
  }

  step('chat', 1, 5, 'Request received')
  detail(`documentId: ${documentId}`)
  detail(`message:    "${message}"`)

  step('chat', 2, 5, 'Embedding the question...')
  const embedStart = Date.now()
  const questionEmbedding = await getEmbedding(message)
  timing(Date.now() - embedStart, `vector has ${questionEmbedding.length} dimensions`)

  step('chat', 3, 5, 'Searching stored chunks (scoped to this documentId, top 3 by cosine distance)...')
  const searchStart = Date.now()
  const relevantChunks = await searchSimilar(questionEmbedding, 3, documentId)
  timing(Date.now() - searchStart, `found ${relevantChunks.length} chunk(s)`)

  if (relevantChunks.length === 0) {
    notFound('No chunks found for this documentId — does it exist?')
    pipelineEnd('chat', Date.now() - t0)
    return res.status(404).json({ error: 'No document found with that documentId' })
  }

  relevantChunks.forEach((c, i) => {
    preview(`#${i + 1} distance=${c.distance.toFixed(4)}`, c.content)
  })

  const context = relevantChunks.map((c) => c.content).join('\n\n')
  const prompt = `Answer using only this context:\n${context}\n\nQuestion: ${message}`
  step('chat', 4, 5, `Built prompt — ${prompt.length} characters (${context.length} of which is retrieved context)`)

  step('chat', 5, 5, 'Calling the LLM to generate an answer...')
  const genStart = Date.now()
  const answer = await generateAnswer(prompt)
  timing(Date.now() - genStart)
  preview('answer', answer, 150)

  pipelineEnd('chat', Date.now() - t0)

  res.json({
    answer,
    sources: relevantChunks.map((c) => ({ content: c.content, distance: c.distance })),
  })
})

app.post('/upload', upload.single('file'), async (req, res) => {
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

  // passing the buffer directly to PDFParse, which will handle it in memory
  const parser = new PDFParse({ data: req.file.buffer })

  try {
    step('upload', 2, 5, 'Extracting text from PDF...')
    const extractStart = Date.now()
    const result = await parser.getText()
    timing(Date.now() - extractStart, `extracted ${result.text.length} characters`)

    const textChunks = chunkText(result.text)
    const documentId = randomUUID()

    step('upload', 3, 5, `Split into ${textChunks.length} chunk(s) — documentId: ${documentId}`)

    step('upload', 4, 5, 'Embedding + storing each chunk...')
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i]
      const chunkStart = Date.now()
      const embedding = await getEmbedding(chunk)
      await insertChunk(chunk, embedding, documentId)
      detail(
        `chunk ${i + 1}/${textChunks.length}: ${chunk.length} chars → ${embedding.length}-dim vector, stored in ${Date.now() - chunkStart}ms`,
      )
      preview('preview', chunk)
    }

    const document = await insertDocument(
      documentId,
      req.file.originalname,
      req.file.size,
      result.text.length,
      textChunks.length,
    )

    step('upload', 5, 5, 'Document metadata saved')
    pipelineEnd('upload', Date.now() - t0)

    res.json({
      documentId,
      filename: req.file.originalname,
      fileSizeBytes: req.file.size,
      textLength: result.text.length,
      chunkCount: textChunks.length,
      createdAt: document.createdAt,
    })
  } finally {
    await parser.destroy()
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
