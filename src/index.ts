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
  const { documentId, message } = req.body

  if (!documentId || typeof documentId !== 'string') {
    return res.status(400).json({ error: 'documentId (string) is required' })
  }

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message (string) is required' })
  }

  console.log(`Chat request for document ${documentId}: "${message}"`)

  const questionEmbedding = await getEmbedding(message)
  const relevantChunks = await searchSimilar(questionEmbedding, 3, documentId)

  if (relevantChunks.length === 0) {
    return res.status(404).json({ error: 'No document found with that documentId' })
  }

  const context = relevantChunks.map((c) => c.content).join('\n\n')
  const prompt = `Answer using only this context:\n${context}\n\nQuestion: ${message}`

  const answer = await generateAnswer(prompt)

  console.log(`Answered using ${relevantChunks.length} chunks`)

  res.json({
    answer,
    sources: relevantChunks.map((c) => ({ content: c.content, distance: c.distance })),
  })
})

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: 'No file uploaded (expected form field "file")',
    })
  }

  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF files are supported' })
  }

  // passing the buffer directly to PDFParse, which will handle it in memory
  const parser = new PDFParse({ data: req.file.buffer })
  console.log(`Parsing PDF "${req.file.originalname}" (${req.file.size} bytes)`)

  try {
    const result = await parser.getText()

    console.log(
      `Extracted ${result.text.length} characters from "${req.file.originalname}"`,
    )

    const textChunks = chunkText(result.text)
    const documentId = randomUUID()

    console.log(`Split into ${textChunks.length} chunks, embedding each...`)

    for (const chunk of textChunks) {
      const embedding = await getEmbedding(chunk)
      await insertChunk(chunk, embedding, documentId)
    }

    const document = await insertDocument(
      documentId,
      req.file.originalname,
      req.file.size,
      result.text.length,
      textChunks.length,
    )

    console.log(`Stored ${textChunks.length} chunks under documentId ${documentId}`)

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
