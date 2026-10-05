import { log } from '../utils/logger'

// UI.3 — the sample document behind the home screen's "How to start.pdf"
// button. The PDF ships with the frontend (frontend/public/how-to-start.pdf,
// so Vercel serves it next to the app; its source is
// frontend/sample-docs/how-to-start.html). Clicking the button turns it into a
// normal File and sends it through the normal /upload, so the backend doesn't
// know it's a sample: it gets parsed, chunked, embedded and owned by the
// caller like any other upload.
export const SAMPLE_FILENAME = 'How to start.pdf'

// BASE_URL is '/' unless the app is ever served from a sub-path
const SAMPLE_URL = `${import.meta.env.BASE_URL}how-to-start.pdf`

export async function fetchSamplePdf(): Promise<File> {
  log.info('api:sample', `GET ${SAMPLE_URL}`)
  const res = await fetch(SAMPLE_URL)
  // The content-type check matters: if the file were ever missing, Vite (and
  // most SPA hosts) answer an unknown path with index.html and a 200, and
  // that HTML would get uploaded as a "PDF".
  const type = res.headers.get('content-type') ?? ''
  if (!res.ok || !type.includes('pdf')) {
    throw new Error(`Couldn't load the sample document (${res.status} ${type || 'no type'}).`)
  }
  const blob = await res.blob()
  // The name on disk has no spaces (a clean URL); this is the name the user
  // sees in their documents list.
  return new File([blob], SAMPLE_FILENAME, { type: 'application/pdf' })
}
