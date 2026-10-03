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
import { requireAuth } from './middleware/auth'

// The app is built here and started in index.ts — keeping `listen()` out of
// this file means tests (Phase 9) can import the app without opening a port.
export const app = express()

// Auth.7 — on Render, requests reach this server through Render's proxy, so
// the connection's IP address is the proxy's, the same for every visitor.
// The proxy puts the real visitor's IP in the X-Forwarded-For header, and
// `trust proxy = 1` tells Express to read it from there ("there is exactly 1
// proxy in front of me"). Without it, the rate limiter would see one IP for
// the whole internet and block everyone at once. Too high a number would be
// the opposite mistake: trusting hops a client can fake to dodge the limit.
app.set('trust proxy', 1)

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
// above the line below, so getting a token doesn't require a token.
app.use(authRouter)

// Auth.2 — DEFAULT DENY. Express runs middleware in the order it's added, so
// everything mounted below this line needs a valid token, including any
// router added in the future, without anyone having to remember to protect
// it. (The alternative, adding requireAuth to each route by hand, fails
// silently the first time someone forgets.)
//
// Order matters twice here:
//  - cors() is ABOVE this, so the browser's preflight OPTIONS request (sent
//    before any request with an Authorization header, and never carrying the
//    token itself) gets answered by cors() and never reaches requireAuth.
//  - a path that matches no route now gets 401 instead of 404, because this
//    check runs before Express finds out the route doesn't exist. Fine: it
//    doesn't tell an anonymous caller which routes exist.
app.use(requireAuth)

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
