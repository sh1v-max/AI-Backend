import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { PDFParse } from 'pdf-parse'

// Step 2.1 — PDF in, plain text out. Nothing else yet: no chunking, no
// embedding, no database writes. Just proving extraction works.

const app = express()
const upload = multer({ storage: multer.memoryStorage() })

// The frontend (Vite dev server, localhost:5173) and this API (localhost:3000)
// are different origins even both on localhost — browsers block cross-origin
// requests by default unless the server explicitly allows them.
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173' }))

app.get('/', (_req, res) => {
  res.json({ status: 'ok', message: 'DocMind API — POST a PDF to /upload' })
})

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded (expected form field "file")' })
  }

  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'Only PDF files are supported' })
  }

  const parser = new PDFParse({ data: req.file.buffer })

  try {
    const result = await parser.getText()

    console.log(`Extracted ${result.text.length} characters from "${req.file.originalname}"`)
    console.log('First 300 characters:\n', result.text.slice(0, 300))

    res.json({
      filename: req.file.originalname,
      textLength: result.text.length,
      preview: result.text.slice(0, 300),
    })
  } finally {
    await parser.destroy()
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
