import { randomUUID } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { getEmbedding } from './embeddings.service'
import { insertChunk } from '../repositories/chunks.repository'
import { insertDocument } from '../repositories/documents.repository'
import { chunkText } from '../utils/chunkText'
import { step, detail, timing, preview } from '../utils/pipelineLogger'

// PDF in, plain text out.
// chunk that text, embed each chunk, store it — a document
// becomes a set of searchable chunks, tagged with a documentId.
//
// BG.2 — split in two halves, because they now run at different times:
//   parsePdf()             FAST, in the request: needs the PDF bytes, which
//                          only exist there (multer keeps them in memory).
//   embedAndStoreChunks()  SLOW, in the queue worker: one Gemini call per
//                          chunk. Nobody should wait on an HTTP request for it.
// The job in between carries only the chunk texts, never the PDF itself
// (Redis shouldn't hold a 10 MB file).

// `file` is a Multer file object, which has the PDF bytes in `file.buffer` and the original filename in `file.originalname`. The file size is in `file.size`.
type UploadedFile = { buffer: Buffer; originalname: string; size: number }

// BG.2 — steps 2-3 of the upload: PDF bytes → text → ~500-word chunks.
// Milliseconds to about a second, so it stays inside the request. That also
// means a PDF with no text layer can be refused straight away (BG.3) instead
// of turning into a job that fails later.
export async function parsePdf(file: UploadedFile): Promise<{ text: string; chunks: string[] }> {
  // passing the buffer directly to PDFParse, which will handle it in memory
  const parser = new PDFParse({ data: file.buffer })

  try {
    step('upload', 2, 4, 'Extracting text from PDF...')
    const extractStart = Date.now()
    const result = await parser.getText()
    timing(Date.now() - extractStart, `extracted ${result.text.length} characters`)

    const chunks = chunkText(result.text)
    step('upload', 3, 4, `Split into ${chunks.length} chunk(s)`)
    return { text: result.text, chunks }
  } finally {
    // pdf-parse holds resources for the parsed document; release them even
    // when getText() throws.
    await parser.destroy()
  }
}

// BG.2 — the slow half: embed every chunk (a Gemini call each) and store it,
// tagged with documentId. Runs in the queue worker. It doesn't check
// ownership or clean up old chunks — the worker does both around it (see
// workers/ingest.worker.ts), so this stays "just the work".
export async function embedAndStoreChunks(documentId: string, chunks: string[]): Promise<void> {
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const chunkStart = Date.now()
    const embedding = await getEmbedding(chunk)
    await insertChunk(chunk, embedding, documentId)
    detail(
      `chunk ${i + 1}/${chunks.length}: ${chunk.length} chars → ${embedding.length}-dim vector, stored in ${Date.now() - chunkStart}ms`,
    )
    preview('preview', chunk)
  }
}

// The whole upload in one go, still inside the request: parse → chunk →
// embed + store → save the document row.
// Auth.3 — `userId` (the uploader, from the token) is saved on the documents
// row. The chunks don't store it: they belong to the document, and the
// document has the owner.
// BG.2 — now just the two halves above, run back to back, so POST /upload
// keeps working exactly as before until BG.3 moves the slow half onto the
// queue. BG.3 deletes this function.
export async function ingestPdf(file: UploadedFile, userId: string) {
  const { text, chunks } = await parsePdf(file)
  const documentId = randomUUID()
  detail(`documentId: ${documentId}`)

  step('upload', 4, 4, 'Embedding + storing each chunk (in the request, until BG.3)...')
  await embedAndStoreChunks(documentId, chunks)

  // It saves one row in the documents table, a "card" describing this PDF
  const document = await insertDocument(documentId, userId, file.originalname, file.size, text.length, chunks.length)
  detail('Document metadata saved')

  return {
    documentId,
    filename: file.originalname,
    fileSizeBytes: file.size,
    textLength: text.length,
    chunkCount: chunks.length,
    createdAt: document.createdAt,
  }
}
