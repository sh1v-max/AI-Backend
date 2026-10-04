import 'dotenv/config'

// Constants shared across routes/services live here so there's one place to
// change them, instead of magic numbers scattered through the route files.

// How many previous messages get replayed into every chat prompt.
export const HISTORY_LIMIT = 8

// Step 3.3 — the documentId value that means "search every uploaded document".
// A sentinel string instead of NULL because chat_messages.document_id is NOT
// NULL — using 'all' avoids altering the live table. A session's scope is
// whatever documentId its messages were saved with.
export const ALL_DOCUMENTS = 'all'
export const ALL_DOCUMENTS_LABEL = 'All documents'

export const PORT = process.env.PORT || 3000

// The frontend (Vite dev server, localhost:5173) and this API (localhost:3000)
// are different origins even both on localhost — browsers block cross-origin
// requests by default unless the server explicitly allows them.
//
// Phase 10 — FRONTEND_URL can hold several origins, comma-separated (e.g.
// "https://docmind.vercel.app,http://localhost:5173"), so the deployed API
// can serve the live site and local dev at once. A trailing slash is stripped
// because the browser's Origin header never has one — "https://x.app/" would
// never match and every request would fail CORS.
export const FRONTEND_ORIGINS = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean)

// Phase 10 — the free Render instance has 512 MB of RAM and multer keeps the
// whole upload in memory, so a cap keeps one huge PDF from crashing the server.
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

// Auth.1 — how long a login token stays valid (the format is the `ms`
// library's: '7d' = 7 days). A guest can't log back in — there's no email or
// password to log in WITH — so an expired guest token means that guest's
// files are gone for good. That's why guests get the longer one.
export const TOKEN_TTL_USER = '7d'
export const TOKEN_TTL_GUEST = '30d'

// Auth.7 — how many documents one user may have at once. Every upload costs
// Gemini embedding calls on the free-tier quota, and POST /auth/guest is
// public, so a cap per user limits how much one identity can use up. Lower
// for guests, which also gives them a reason to sign up.
export const GUEST_MAX_DOCUMENTS = 5
export const USER_MAX_DOCUMENTS = 10

// Auth.7 — the cap above limits ONE guest; it doesn't stop someone creating a
// thousand guests in a loop. This limits the public /auth routes per IP
// address: at most AUTH_RATE_LIMIT requests per AUTH_RATE_WINDOW_MS. A real
// visitor makes one guest per browser, so 20 per 15 minutes leaves plenty of
// room even for a shared office or college network.
export const AUTH_RATE_LIMIT = 20
export const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000

// Auth.7 — how many proxies sit between the visitor and this server (see the
// `trust proxy` comment in app.ts). 2 on Render (Cloudflare + Render's load
// balancer). An env var so another host, or a change on Render's side, can be
// fixed from the dashboard without a code change.
export const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 2)

// What the client sees when a network step (Gemini, Neon) fails — the real
// cause goes to the terminal instead (see utils/errors.ts).
export const CONNECTION_ERROR_MESSAGE =
  'Could not reach Gemini or the database — check your internet connection and try again.'
