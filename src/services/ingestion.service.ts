import { randomUUID } from 'crypto'
import { PDFParse } from 'pdf-parse'
import { getEmbedding } from './embeddings.service'
import { insertChunk } from '../repositories/chunks.repository'
import { insertDocument, deleteDocument, type DocumentStatus } from '../repositories/documents.repository'
import { enqueueIngest } from '../queue/ingest.queue'
import { chunkText } from '../utils/chunkText'
import { summarizeError } from '../utils/errors'
import { step, detail, timing, preview, rejected, failed } from '../utils/pipelineLogger'

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
export async function parsePdf(file: UploadedFile): Promise<{ text: string; chunks: string[]; hasText: boolean }> {
  // passing the buffer directly to PDFParse, which will handle it in memory
  const parser = new PDFParse({ data: file.buffer })

  try {
    step('upload', 2, 4, 'Extracting text from PDF...')
    const extractStart = Date.now()
    const result = await parser.getText()
    timing(Date.now() - extractStart, `extracted ${result.text.length} characters`)

    // BG.3 — "is there any real text?" has to be asked per page: pdf-parse v2
    // adds a "-- 1 of 3 --" marker per page to result.text, so even a PDF
    // with no text layer at all comes back as a non-empty string (found while
    // testing: a drawn-only page gave 12 characters and 1 chunk).
    const hasText = result.pages.some((page) => page.text.trim().length > 0)

    const chunks = chunkText(result.text)
    step('upload', 3, 4, `Split into ${chunks.length} chunk(s)`)
    return { text: result.text, chunks, hasText }
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

// BG.3 — POST /upload's work, now that the slow half runs on the queue:
//   parse + chunk (in the request) → insert the documents row as
//   'processing' → hand the chunks to the queue → return.
// The route answers 202 Accepted right away ("got it, working on it"); the
// worker embeds the chunks and flips the row to 'ready' (or 'failed').
//
// Like prepareChat()/generateQuiz(), it returns `{ ok: false, status, error }`
// for the expected failures and never touches req/res.
//
// Auth.3 — `userId` (the uploader, from the token) is saved on the documents
// row and carried in the job. The chunks don't store it: they belong to the
// document, and the document has the owner.
export async function queuePdfIngestion(
  file: UploadedFile,
  userId: string,
): Promise<
  | { ok: false; status: number; error: string }
  | {
      ok: true
      document: {
        documentId: string
        filename: string
        fileSizeBytes: number
        textLength: number
        chunkCount: number
        createdAt: Date
        status: DocumentStatus
      }
    }
> {
  const { text, chunks, hasText } = await parsePdf(file)

  // A scanned PDF (pages are images) has no text layer, so pdf-parse finds
  // nothing to read. Refuse it now, while the user is still waiting, instead
  // of storing an empty document or queueing a job that has nothing to embed.
  // (Before BG.3 such a PDF was saved with 0 chunks and every chat with it
  // answered "No document found".)
  if (!hasText || chunks.length === 0) {
    rejected('no text layer in this PDF (scanned image?)')
    return {
      ok: false,
      status: 400,
      error: 'This PDF has no text layer (is it a scanned image?). Only typed or exported PDFs are supported.',
    }
  }

  const documentId = randomUUID()
  // It saves one row in the documents table, a "card" describing this PDF.
  // Real numbers already (text length and chunk count are known after
  // chunking); status 'processing' until the worker is done.
  const document = await insertDocument(documentId, userId, file.originalname, file.size, text.length, chunks.length, 'processing')
  detail(`documentId: ${documentId} (saved as 'processing')`)

  step('upload', 4, 4, `Queueing the embedding job (${chunks.length} chunk(s))...`)
  try {
    await enqueueIngest({ documentId, userId, chunks })
  } catch (err) {
    // Redis is down or too slow. Without a job nothing would ever finish
    // this document, so undo the row; a 503 tells the client to try again
    // later (and chat keeps working, it doesn't need Redis).
    console.error(`[upload] could not queue the job: ${summarizeError(err)}`)
    await deleteDocument(documentId, userId)
    failed('upload queue unavailable — documents row removed again')
    return { ok: false, status: 503, error: 'The upload queue is unavailable right now. Try again shortly.' }
  }
  detail('queued — the worker embeds the chunks in the background')

  return {
    ok: true,
    document: {
      documentId,
      filename: file.originalname,
      fileSizeBytes: file.size,
      textLength: text.length,
      chunkCount: chunks.length,
      createdAt: document.createdAt,
      status: 'processing',
    },
  }
}
