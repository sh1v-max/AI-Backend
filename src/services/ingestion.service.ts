import { randomUUID } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { getEmbedding } from './embeddings.service'
import { insertChunk } from '../repositories/chunks.repository'
import { insertDocument } from '../repositories/documents.repository'
import { chunkText } from '../utils/chunkText'
import { step, detail, timing, preview } from '../utils/pipelineLogger'

// Step 2.1 — PDF in, plain text out.
// Step 2.2 — chunk that text, embed each chunk, store it — a document
// becomes a set of searchable chunks, tagged with a documentId.

// Steps 2-5 of the upload pipeline: parse → chunk → embed + store → save the
// document row. Step 1 (the request checks) stays in the route because it
// depends on `req`; this function only needs the file itself, which is also
// what a background job will have later (Phase 6).
export async function ingestPdf(file: { buffer: Buffer; originalname: string; size: number }) {
  // passing the buffer directly to PDFParse, which will handle it in memory
  const parser = new PDFParse({ data: file.buffer })

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
      file.originalname,
      file.size,
      result.text.length,
      textChunks.length,
    )

    step('upload', 5, 5, 'Document metadata saved')

    return {
      documentId,
      filename: file.originalname,
      fileSizeBytes: file.size,
      textLength: result.text.length,
      chunkCount: textChunks.length,
      createdAt: document.createdAt,
    }
  } finally {
    await parser.destroy()
  }
}
