# 04 — PDF Parsing

Everything so far (topics 01-03) was standalone scripts — no server, no HTTP requests, just `npm run stepN` doing its thing and exiting. This topic is where that changes: **an actual Express server enters the project**, because DocMind's real interface is "a user uploads a file over HTTP," not "a script runs on your machine."

Scope for this step, on purpose: **PDF in, plain text out. Nothing else.** No chunking, no embedding, no database writes — that's Step 2.2. This step exists purely to isolate one question: can you reliably get readable text out of a real PDF file?

---

## The three new pieces

### 1. Express endpoint that accepts a file (not JSON)

Every endpoint you'd normally write takes JSON in the request body. A file upload is different — the request body is binary file data, not JSON, so Express's normal `express.json()` middleware can't parse it. You need something that understands `multipart/form-data`, the format browsers/clients use to send files over HTTP.

### 2. Multer

Multer is Express middleware specifically for handling `multipart/form-data`. It sits in front of your route handler and does the parsing work for you:

```ts
import multer from 'multer'
const upload = multer({ storage: multer.memoryStorage() })

app.post('/upload', upload.single('file'), (req, res) => {
  // req.file now exists — the uploaded file, as a Buffer
})
```

`upload.single('file')` says "expect exactly one file, sent under the form field name `file`." `multer.memoryStorage()` means the file is held in memory as a `Buffer` (not written to disk) — fine for this project's scale, and simpler than managing temp files.

### 3. A Buffer — what a file actually looks like in Node

A `Buffer` is Node's representation of raw binary data — think of it as an array of bytes. A PDF isn't text; it's a binary format with its own internal structure (fonts, layout, embedded text streams, sometimes images). `req.file.buffer` gives you the whole PDF as raw bytes — you can't `console.log` it and see anything meaningful, and you can't just treat it as a string. This is exactly why you need a dedicated parser for the next piece.

## pdf-parse — turning binary into text

`pdf-parse` reads that buffer, walks the PDF's internal structure, and extracts whatever readable text it can find:

```ts
import { getText } from 'pdf-parse' // or similar — check current API when implementing

const { text } = await getText(req.file.buffer)
```

The important caveat, and the reason Step 2.1 tells you to test on multiple real PDFs before moving on: **`pdf-parse` only works on PDFs that have a real text layer.** A PDF exported from Word/Google Docs, or any "typed" document, has actual text data embedded in it — `pdf-parse` reads that directly. A **scanned or photographed** PDF is just a picture of a page, saved as a PDF — there's no text to extract, only pixels. Getting empty or garbled output from a scanned PDF isn't a bug in your code; it's a fundamentally different kind of file, and extracting text from *that* requires OCR (optical character recognition), which is a separate, heavier tool this project doesn't need.

This is also why the roadmap says to test on 2-3 different real PDFs, not just one — some typed PDFs still extract messier than others (weird spacing, column layouts breaking up mid-sentence, headers/footers mixed into the body text). Seeing that variance firsthand now is the point — it's exactly the kind of "real data is messier than the happy path" lesson that only shows up once you stop testing on one clean example.

## Where this goes next

```
04 (you are here)   → PDF in, plain text out, nothing else
04 → 2.2 (next)      → chunk that text, embed each chunk, store via insertChunk() (topic 03's repository)
05 RAG               → search those stored chunks to answer questions about the document
```

The text you extract here is the raw material every later phase depends on — if extraction is broken or messy, everything downstream (chunking, embedding, RAG answers) inherits that mess. That's why this step is isolated and kept boring on purpose: get "PDF in, clean text out" solid before anything else touches it.

---

## What you need to learn

- [ ] **Why file uploads need different middleware than JSON bodies** — `multipart/form-data` vs `application/json`
- [ ] **What Multer actually does** — parses the multipart request, gives you `req.file` as a Buffer
- [ ] **What a Buffer is** — raw binary bytes, not a string, not something you can read directly
- [ ] **What `pdf-parse` does with that buffer** — walks the PDF's internal structure, extracts embedded text
- [ ] **The text-layer requirement** — `pdf-parse` needs a PDF with real text data; scanned/photographed PDFs need OCR instead, which is out of scope here
- [ ] **Real extracted text is messy** — expect inconsistent spacing, broken paragraphs, headers/footers mixed in — this is normal, not a bug

## What to build (Step 2.1 of the roadmap)

1. Set up the first real Express server in this project (`src/index.ts` or similar) if you haven't already
2. Install `multer` and `pdf-parse`
3. Add `POST /upload` using `upload.single('file')` middleware
4. Inside the handler: run `pdf-parse` on `req.file.buffer`, log the extracted text's length (`text.length`)
5. Test with 2-3 different real PDFs (typed docs, or export one from Google Docs if you don't have one handy) using a tool like `curl -F "file=@yourfile.pdf" http://localhost:3000/upload` or Postman
6. Confirm: you get a reasonable text length back for each, and skim the actual text to see how clean or messy the extraction is

## Resources

- [pdf-parse on npm](https://www.npmjs.com/package/pdf-parse) — skim the API, it's small
- [Multer docs](https://github.com/expressjs/multer) — you already know Express, this is just the file-upload middleware piece

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, what did messy extraction actually look like on your test PDFs? That's the detail worth remembering over "it worked," since "how messy is real extracted text" is exactly the kind of thing that comes up in interviews about RAG/document processing.
