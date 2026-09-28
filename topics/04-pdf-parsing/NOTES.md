# 04: PDF Parsing, In My Own Words

Roadmap: Phase 2, Step 2.1 · Guide: [README.md](README.md) · Code now lives in: [src/routes/documents.routes.ts](../../src/routes/documents.routes.ts) (the upload route) and [src/services/ingestion.service.ts](../../src/services/ingestion.service.ts) (the parsing)

## What "PDF parsing" actually means

A PDF isn't text. It's a binary file with its own internal structure: fonts, positions, text streams, sometimes just images. I can't read it like a `.txt`. Parsing means using a library that understands that structure and pulls out whatever readable text is inside.

This was also the first real **Express server** in the project. Everything before was standalone scripts.

## The three pieces, in plain words

- **Multer** gets the file into my Node app. A file upload isn't sent as JSON, it's `multipart/form-data`, which `express.json()` can't read. Multer sits in front of the route and hands me the file as `req.file`.
- **Buffer** is how the file sits in memory: raw bytes, not a string. `console.log` it and you see nothing useful. I used `multer.memoryStorage()` so it never touches disk.
- **pdf-parse** understands the PDF format and pulls the text out:

```ts
const parser = new PDFParse({ data: file.buffer })
const result = await parser.getText()   // result.text = the extracted string
await parser.destroy()                  // in a finally, so it always cleans up
```

(Checked this against the version I actually installed, v2, not the roadmap's guess.)

## Tested on 3 real PDFs, 3 different outcomes

| File | Extracted | Result |
|---|---|---|
| My resume | 3432 chars | clean, readable text ✅ |
| CSS notes (a slide deck) | **48 chars** | only page markers like `-- 1 of 3 --` ❌ |
| An assignment PDF | 16282 chars | clean, structured text ✅ |

The 48 character one wasn't a bug in my code. That PDF is basically images of slides, there's no text layer at all, just pixels. Getting anything out of it would need OCR, which is a completely different (and heavier) tool. The README warned about this and I hit it on literally my first test.

## Confirmed by actually running it

- [x] Upload endpoint accepts a PDF, rejects no file (400) and rejects non-PDFs (400)
- [x] Text extraction works on typed/exported PDFs
- [x] Tested through Postman first, then through my own React upload screen

## The takeaway

"PDF in, text out" sounds solved until you try real files. Everything after this (chunking, embedding, answers) depends on this step, and it isn't guaranteed to work the same way twice.

## What still feels a little shaky

- The app doesn't detect the "basically empty" case yet. A 48 character PDF would still get uploaded as one tiny useless chunk instead of the user being told "this PDF has no readable text."
- The PDF check trusts the file type the browser sends. Fine for a learning project, not a real security check.
