import { Router } from 'express'
import { loginAsGuest, register, login, tokenFromHeader } from '../services/auth.service'
import { findUserById } from '../repositories/users.repository'
import { requireAuth } from '../middleware/auth'
import { authLimiter } from '../middleware/rateLimit'
import { withErrorHandling } from '../utils/errors'
import { pipelineStart, pipelineEnd, detail, rejected } from '../utils/pipelineLogger'

// Auth.1 — the three ways to get a token. All three are PUBLIC (you can't be
// asked for a token in order to get your first token), and all three answer
// with the same shape: { token, user: { id, email, isGuest } }.
//
// Thin on purpose, like quiz.routes.ts: read the request, call the service,
// send whatever it decided.

export const authRouter = Router()

// No body needed. Creates a user row with no email/password and returns a
// token for it — this is what the frontend calls silently on a first visit.
// Auth.7 — authLimiter runs first on the three public routes (not on
// /auth/me, which every page load calls with a token it already has).
authRouter.post(
  '/auth/guest',
  authLimiter,
  withErrorHandling('POST /auth/guest', async (req, res) => {
    const t0 = Date.now()
    pipelineStart('auth', 'POST /auth/guest')
    // Auth.7 — the IP the rate limiter counts. After a deploy, compare this
    // with your real public IP: if every visitor shows the same address,
    // `trust proxy` in app.ts is wrong and the limiter is one shared bucket.
    detail(`ip: ${req.ip}`)

    const result = await loginAsGuest()
    if (!result.ok) return res.status(result.status).json({ error: result.error })

    pipelineEnd('auth', Date.now() - t0)
    // 201 Created — a new user row now exists
    res.status(201).json({ token: result.token, user: result.user })
  }),
)

// { email, password }. If the request also carries a valid guest token, that
// guest is upgraded in place instead of a new user being created. The header
// is read here by hand because this route is public — no middleware has
// looked at it.
authRouter.post(
  '/auth/register',
  authLimiter,
  withErrorHandling('POST /auth/register', async (req, res) => {
    const t0 = Date.now()
    pipelineStart('auth', 'POST /auth/register')

    const result = await register(req.body, tokenFromHeader(req.headers.authorization))
    if (!result.ok) return res.status(result.status).json({ error: result.error })

    pipelineEnd('auth', Date.now() - t0)
    res.status(201).json({ token: result.token, user: result.user })
  }),
)

// { email, password } -> a token for an existing account.
authRouter.post(
  '/auth/login',
  authLimiter,
  withErrorHandling('POST /auth/login', async (req, res) => {
    const t0 = Date.now()
    pipelineStart('auth', 'POST /auth/login')

    const result = await login(req.body)
    if (!result.ok) return res.status(result.status).json({ error: result.error })

    pipelineEnd('auth', Date.now() - t0)
    res.json({ token: result.token, user: result.user })
  }),
)

// Auth.2 — "who am I?". The frontend calls this on every page load to check
// that the token it saved last time still works.
//
// The only /auth route that needs a token, so requireAuth is passed to this
// one route directly (a route can take any number of middlewares before its
// handler). authRouter is mounted ABOVE the global requireAuth in app.ts, so
// without this the route would be public.
//
// Unlike requireAuth, this one DOES hit the database: a token can be
// perfectly valid while its user row is gone (e.g. a deleted guest). The
// frontend needs to hear that, so it can start over with a fresh guest.
authRouter.get(
  '/auth/me',
  requireAuth,
  withErrorHandling('GET /auth/me', async (req, res) => {
    // req.user! — the `!` tells TypeScript "this can't be undefined here".
    // True only because requireAuth runs first and stops the request if
    // there is no valid token.
    const user = await findUserById(req.user!.id)
    if (!user) {
      rejected(`401 GET /auth/me — token is valid but user ${req.user!.id.slice(0, 8)} no longer exists`)
      return res.status(401).json({ error: 'Sign in required' })
    }
    res.json({ user })
  }),
)
