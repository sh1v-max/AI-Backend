# 04 — PDF Parsing

Everything so far (topics 01-03) was standalone scripts — no server, no HTTP requests, just `npm run stepN` doing its thing and exiting. This topic is where that changes: **an actual Express server enters the project**, because DocMind's real interface is "a user uploads a file over HTTP," not "a script runs on your machine."

Scope for this step, on purpose: **PDF in, plain text out. Nothing else.** No chunking, no embedding, no database writes — that's Step 2.2. This step exists purely to isolate one question: can you reliably get readable text out of a real PDF file?

---

## What "parsing a PDF" actually means

A PDF is not a text file. Open one in a plain text editor and you'll see mostly binary garbage with a few recognizable fragments — because a PDF is a structured binary format: a tree of objects describing fonts, page layout, positioned text runs, embedded images, and metadata, all packed together with its own internal syntax (going back to Adobe's original PostScript-derived spec).

So "extracting text from a PDF" isn't like reading a `.txt` file — it means running a program that understands that internal structure well enough to walk through it, find the objects that represent text, and pull out just the readable characters, discarding the formatting/positioning/font data around them. That program is a **PDF parser**. In this project, that's the `pdf-parse` library, which itself is built on top of `pdfjs-dist` — the same rendering engine behind Firefox's built-in PDF viewer, repurposed here for text extraction instead of visual rendering.

This is also why extraction quality varies by PDF (more on this below): the parser is reconstructing "reading order" from a format that fundamentally stores things by *position on a page*, not by *sequence of ideas*. Two columns of text sitting side by side have no inherent "read left column fully, then right column" instruction baked into the file — the parser has to infer that from coordinates, and sometimes gets it wrong.

## The three new pieces

### 1. Express endpoint that accepts a file (not JSON)

Every endpoint you'd normally write takes JSON in the request body. A file upload is different — the request body is binary file data, not JSON, so Express's normal `express.json()` middleware can't parse it. Browsers/HTTP clients send files using a different request format called `multipart/form-data`, where the body is split into distinct "parts" separated by a boundary marker — one part per form field, each with its own small header describing its content type and (for files) original filename. You need something that understands *that* format specifically.

### 2. Multer

Multer is Express middleware that sits in front of your route handler and does that multipart-parsing work for you, so you never touch the raw format directly:

```ts
import multer from 'multer'
const upload = multer({ storage: multer.memoryStorage() })

app.post('/upload', upload.single('file'), (req, res) => {
  // req.file now exists — the uploaded file, as a Buffer
})
```

- `upload.single('file')` — says "expect exactly one file, sent under the form field name `file`." (There's also `.array('files')` for multiple files, and `.fields([...])` for multiple named file fields — not needed here.)
- `multer.memoryStorage()` — one of two storage engines Multer offers. This one holds the uploaded file entirely in RAM as a `Buffer`, attached to `req.file.buffer`. The alternative, `multer.diskStorage()`, writes the file to a temp directory on disk and gives you a file *path* instead. Memory storage is simpler (no cleanup, no filesystem permissions to think about) and fine at this project's scale — a real production system handling large files or many concurrent uploads might switch to disk storage or stream straight to cloud storage instead, to avoid holding many large files in RAM at once.
- Multer runs as middleware *before* your handler function — by the time your code executes, `req.file` already exists, fully parsed. You never see the raw multipart boundaries/headers.

### 3. A Buffer — what a file actually looks like in Node

A `Buffer` is Node's built-in representation of raw binary data — essentially a fixed-length array of bytes (numbers 0-255), stored outside the normal JavaScript heap for efficiency. It predates JavaScript's own `Uint8Array` (which Buffer is now built on top of / interoperable with).

A PDF's bytes, held in a `Buffer`, have no inherent "text" meaning yet — `req.file.buffer` gives you the whole file exactly as it exists on disk, byte for byte. You can't `console.log` it and see anything meaningful (you'd get a wall of hex-looking output), you can't treat it as a string, and simple operations like "does this contain the word 'hello'" don't work the way they would on text — the bytes might represent a compressed stream, an embedded font, or actual visible text, and nothing about the `Buffer` itself tells you which. This is exactly why a dedicated parser is necessary for the next piece — something has to know the PDF *format* to make sense of what's inside.

## pdf-parse — turning binary into text

The real API (verified against the installed `pdf-parse@2.x` package's own type definitions, not guessed from outdated docs — versions of this library have changed their API shape before):

```ts
import { PDFParse } from 'pdf-parse'

const parser = new PDFParse({ data: req.file.buffer })
try {
  const result = await parser.getText()
  console.log(result.text) // the full extracted string
} finally {
  await parser.destroy()
}
```

- `new PDFParse({ data: buffer })` — constructs a parser instance around your file's bytes. It also accepts a `url` instead of `data` (for parsing a remote PDF), but a `Buffer` from Multer is what you'll use here.
- `parser.getText()` — returns a `TextResult`: `.text` is the whole document concatenated into one string, and `.pages` gives you the same text split per page, in case you ever need per-page granularity (useful later for citing "this answer came from page 4").
- `parser.destroy()` — releases internal resources (the parser is built on `pdfjs-dist`, which can hold onto worker threads/memory for the document). **Always call this in a `finally` block**, so it runs whether parsing succeeds or throws — otherwise a parsing error on one upload could silently leak memory over many requests.
- The same `PDFParse` instance can also do more than text: `getInfo()` (metadata like title/author), `getImage()` (extract embedded images), `getTable()` (detect table structures) — not needed for Step 2.1, but worth knowing they exist under the same class if a later feature ever needs them.

### The critical caveat: not every PDF has extractable text

**`pdf-parse` (and PDF text extraction in general) only works on PDFs that have a real text layer.** A PDF exported from Word, Google Docs, or any "typed" document has actual text objects embedded in its structure — the parser reads those directly. A **scanned or photographed** PDF — a picture of a page, saved as a PDF — has no text objects at all, only an embedded image. There's nothing for a text parser to find; it's not a matter of the parser being bad at its job, the information genuinely isn't there in text form.

Getting empty or near-empty output from such a PDF isn't a bug in your code. Extracting text from *that* kind of file requires OCR (Optical Character Recognition) — a fundamentally different technique that visually analyzes pixel patterns to recognize characters, the way a scanner app on your phone does. OCR is a separate, much heavier tool (and a different, harder problem — accuracy varies with image quality, font, skew, etc.) that this project deliberately doesn't need.

This is also why the roadmap says to test on 2-3 different real PDFs, not just one — even among PDFs that *do* have a text layer, extraction quality varies: multi-column layouts can interleave incorrectly, headers/footers can get mixed into the body text mid-sentence, and spacing can come out inconsistent. Seeing that variance firsthand is the point — it's the kind of "real data is messier than the happy path" lesson that only shows up once you stop testing on one clean example.

## Where this goes next

```
04 (you are here)   → PDF in, plain text out, nothing else
04 → 2.2 (next)      → chunk that text, embed each chunk, store via insertChunk() (topic 03's repository)
05 RAG               → search those stored chunks to answer questions about the document
```

The text you extract here is the raw material every later phase depends on — if extraction is broken or messy, everything downstream (chunking, embedding, RAG answers) inherits that mess. That's why this step is isolated and kept boring on purpose: get "PDF in, clean text out" solid before anything else touches it.

---

## What you need to learn

- [ ] **What a PDF actually is** — a structured binary format (objects, fonts, positioned text), not a text file — and why extraction means "reconstructing reading order from position data"
- [ ] **Why file uploads need different middleware than JSON bodies** — `multipart/form-data` vs `application/json`
- [ ] **What Multer actually does** — parses the multipart request, gives you `req.file` as a Buffer; memory storage vs disk storage
- [ ] **What a Buffer is** — raw binary bytes, not a string, not something you can read directly
- [ ] **The real `pdf-parse` API** — `new PDFParse({ data })`, `.getText()`, and always `.destroy()` in a `finally`
- [ ] **The text-layer requirement** — `pdf-parse` needs a PDF with real embedded text; scanned/photographed PDFs need OCR instead, which is out of scope here
- [ ] **Real extracted text is messy** — expect inconsistent spacing, broken paragraphs, headers/footers mixed in — this is normal, not a bug

## What to build (Step 2.1 of the roadmap)

1. Set up the first real Express server in this project (`src/index.ts`) if you haven't already
2. Install `multer` and `pdf-parse`
3. Add `POST /upload` using `upload.single('file')` middleware
4. Inside the handler: run `pdf-parse`'s `PDFParse` class on `req.file.buffer`, log the extracted text's length
5. Test with 2-3 different real PDFs (typed docs, or export one from Google Docs if you don't have one handy) using a tool like Postman or `curl -F "file=@yourfile.pdf" http://localhost:3000/upload`
6. Confirm: you get a reasonable text length back for each, and skim the actual text to see how clean or messy the extraction is — including deliberately trying a scanned/image-based PDF if you have one, to see the near-empty-output case firsthand

## Resources

- [pdf-parse on npm](https://www.npmjs.com/package/pdf-parse) — skim the API, but note versions have changed shape; check the installed version's own type definitions (`node_modules/pdf-parse/dist/.../*.d.cts`) if something doesn't match
- [Multer docs](https://github.com/expressjs/multer) — you already know Express, this is just the file-upload middleware piece
- [pdf.js project](https://mozilla.github.io/pdf.js/) — the underlying engine `pdf-parse` is built on, if you ever want to go deeper than this project needs

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, what did messy extraction actually look like on your test PDFs? That's the detail worth remembering over "it worked," since "how messy is real extracted text" is exactly the kind of thing that comes up in interviews about RAG/document processing.
