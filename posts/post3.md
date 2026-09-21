# AI Backend Learning Journey — Day 3 Context (for LinkedIn post)

## Instructions for Claude

Use the `post-writer-sms` skill to write a LinkedIn post based on everything below. Tone: genuine, technical but accessible, showing real hands-on progress — not buzzwords, not "excited to announce." I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 3 (see `post1.md` for embeddings/pgvector, `post2.md` for the Drizzle repository pattern, if useful for continuity). Focus mostly on the PDF parsing concepts below — that's the real lesson of the day. The frontend work is a minor side note, not the focus.

---

## What I built and learned today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz — building it from scratch to actually understand AI backend concepts). Today: the first actual Express server in the project, and the first step of the RAG pipeline — getting real text out of a real PDF.

### What "PDF parsing" actually means

A PDF isn't text — it's a binary file format with its own internal structure: fonts, layout positioning, embedded text streams, sometimes images. You can't just read a PDF like a `.txt` file. Parsing means using a library that understands that internal structure and walks it to pull out whatever readable text exists inside.

Built a `POST /upload` endpoint:
```ts
const parser = new PDFParse({ data: req.file.buffer })
const result = await parser.getText()
```

### What Multer actually does

An HTTP request carrying a file isn't sent as JSON — it's sent as `multipart/form-data`, a completely different format that Express's normal JSON body parser can't read. Multer is middleware that sits in front of the route handler specifically to parse that format: it intercepts the incoming file, decodes it, and hands it to the route handler as `req.file` — so by the time my code runs, the file is already available and ready to use, instead of me having to parse raw multipart data by hand.

### What a Buffer actually is

`req.file.buffer` — the file Multer hands over — is a **Buffer**: Node's representation of raw binary data, essentially an array of bytes. It's not a string, you can't `console.log` it and see anything meaningful, and you can't treat it like text. This is exactly why a dedicated parser is necessary instead of just reading the file — the PDF's readable text is buried inside that binary structure, and something has to know the PDF format well enough to extract it.

### Scope kept deliberately narrow

PDF in, plain text out — nothing else yet. No chunking, no embedding, no database writes. Just proving extraction actually works, in isolation, before building anything on top of it.

### A real gotcha, not a hypothetical one

Tested on 3 real PDFs and got 3 different outcomes:
- My resume → 3432 characters, clean text ✅
- A structured assignment PDF → 16,282 characters, clean text ✅
- A slide-deck PDF → **48 characters** — just page markers, no real text ❌

That third one wasn't a bug in my code. PDF parsers can only extract text that exists *as text* inside the file — typed documents, exported PDFs. A PDF that's actually scanned or rasterized images has no embedded text at all, just pixels, and would need OCR (a completely different, heavier tool) to extract anything. This is exactly the kind of "real data is messier than the happy path" lesson that's easy to read about and different to actually hit on your very first test.

### Also: first frontend, built alongside the backend

Started building a minimal React UI in parallel with the backend, testing each endpoint the way a real client would instead of only curl/Postman — starting with a drag-and-drop upload UI wired to `/upload`.

## The bigger takeaway

"PDF in, text out" sounds like a solved problem until you test it on real files. The extraction step this project depends on for everything downstream (chunking, embedding, RAG answers) isn't guaranteed to work the same way twice — recognizing and handling that upfront matters more than getting the happy path working.

## What's next

Step 2.2 — the full `/upload` pipeline: chunk the extracted text, embed each chunk (from Phase 1's embeddings work), store it via my repository functions, tagged with a `documentId` so multiple documents don't mix together.
