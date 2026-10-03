import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import multer from 'multer'
import { FRONTEND_ORIGINS, MAX_UPLOAD_BYTES } from './config'
import { summarizeError } from './utils/errors'
import { documentsRouter } from './routes/documents.routes'
import { sessionsRouter } from './routes/sessions.routes'
import { chatRouter } from './routes/chat.routes'
import { quizRouter } from './routes/quiz.routes'
import { authRouter } from './routes/auth.routes'

// The app is built here and started in index.ts — keeping `listen()` out of
// this file means tests (Phase 9) can import the app without opening a port.
export const app = express()

// Only affects requests with Content-Type: application/json — /upload's
// multipart/form-data requests are handled separately by Multer, so the two
// don't conflict.
app.use(express.json())

app.use(
  cors({
    // an array = "allow any of these origins" (see FRONTEND_ORIGINS in config.ts)
    origin: FRONTEND_ORIGINS,
  }),
)

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'DocMind API - POST a PDF to /upload',
  })
})

// Auth.1 — the public /auth routes (guest, register, login). Mounted first,
// above the routers that will need a token once AUTH.2's middleware goes in.
app.use(authRouter)

app.use(documentsRouter)
app.use(sessionsRouter)
app.use(chatRouter)
app.use(quizRouter)

// Phase 10 — Express's last-resort error handler. Anything that throws
// outside withErrorHandling() lands here; without this, Express replies with
// an HTML error page, which the frontend's res.json() can't parse. The four
// arguments are what tells Express this is an error handler, not a route.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // multer rejects an over-limit upload with code LIMIT_FILE_SIZE
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    const mb = MAX_UPLOAD_BYTES / (1024 * 1024)
    return res.status(413).json({ error: `PDF is too large (max ${mb} MB)` })
  }
  console.error(`[unhandled] ${summarizeError(err)}`)
  res.status(500).json({ error: 'Something went wrong on the server' })
})
