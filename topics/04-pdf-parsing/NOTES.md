# 04 — PDF Parsing — Quick Revision

Roadmap: Phase 2, Step 2.1 · Guide: [README.md](README.md) · Code: [src/index.ts](../../src/index.ts)

- First real **Express server** in the project — everything before this was standalone scripts
- **Multer** parses `multipart/form-data` (file uploads), which `express.json()` can't handle
- `multer.memoryStorage()` → uploaded file arrives as `req.file.buffer` (raw bytes, not text)
- **`pdf-parse` v2 API** (verified against installed version, not the roadmap's guess):
  ```ts
  const parser = new PDFParse({ data: req.file.buffer })
  const result = await parser.getText()   // result.text = extracted string
  await parser.destroy()
  ```
- **Only works on PDFs with a real text layer** — typed docs, exported PDFs. Scanned/image PDFs return almost nothing.

## Tested on 3 real PDFs — real results, not hypothetical

| File | Extracted length | Result |
|---|---|---|
| My resume | 3432 chars | Clean, readable text ✅ |
| CSS notes (Chapter 1) | **48 chars** | Just page markers (`-- 1 of 3 --`), no real text ❌ — likely slides exported as images |
| Credex assignment PDF | 16282 chars | Clean, structured text ✅ |

**This is the exact lesson the README warned about, hit for real on the first try.** The CSS notes PDF has no usable text layer — this isn't a bug, it's a fundamentally different kind of PDF (image-based), and would need OCR to extract, which is out of scope for this project.

## Takeaway

"PDF in, text out" isn't guaranteed — always need to handle/detect the case where extraction returns near-nothing, rather than assuming every PDF works the same way.
