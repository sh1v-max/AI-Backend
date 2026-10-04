import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import multer from 'multer'
import { FRONTEND_ORIGINS, MAX_UPLOAD_BYTES, TRUST_PROXY_HOPS } from './config'
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

// Auth.7 — on Render, requests reach this server through proxies, so the
// connection's IP address is a proxy's, not the visitor's. Each proxy appends
// the address it received the request from to the X-Forwarded-For header,
// and `trust proxy = N` tells Express "there are exactly N proxies in front
// of me": skip that many hops from the right and the next one is the visitor.
// Without it, the rate limiter would see proxy IPs and lump everyone together.
// Too high a number is the opposite mistake: trusting a hop the CLIENT wrote,
// which lets anyone dodge the limit by sending a fake header.
//
// Measured on the live deploy, not guessed: Render's chain is
// `<visitor>, <Cloudflare edge>, <Render front proxy>` before it reaches us,
// so N = 3. With 1 the limiter keyed on Render's proxies (one machine's
// requests split into 2 counters); with 2 it keyed on Cloudflare edges (a new
// counter every request = no limit at all). Confirmed with 3: the
// RateLimit-Policy header's `pk` (first 12 hex of sha256(key)) matched
// sha256 of the visitor IP from /cdn-cgi/trace, stayed the same across
// requests, and a faked X-Forwarded-For header didn't change it.
// See TRUST_PROXY_HOPS in config.ts.
app.set('trust proxy', TRUST_PROXY_HOPS)

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
