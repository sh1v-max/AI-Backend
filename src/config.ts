import 'dotenv/config'

// Constants shared across routes/services live here so there's one place to
// change them, instead of magic numbers scattered through the route files.

// How many previous messages get replayed into every chat prompt.
export const HISTORY_LIMIT = 8

export const PORT = process.env.PORT || 3000

// The frontend (Vite dev server, localhost:5173) and this API (localhost:3000)
// are different origins even both on localhost — browsers block cross-origin
// requests by default unless the server explicitly allows them.
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

// What the client sees when a network step (Gemini, Neon) fails — the real
// cause goes to the terminal instead (see utils/errors.ts).
export const CONNECTION_ERROR_MESSAGE =
  'Could not reach Gemini or the database — check your internet connection and try again.'
