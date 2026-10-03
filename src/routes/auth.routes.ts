import { Router } from 'express'
import { loginAsGuest, register, login, tokenFromHeader } from '../services/auth.service'
import { withErrorHandling } from '../utils/errors'
import { pipelineStart, pipelineEnd } from '../utils/pipelineLogger'

// Auth.1 — the three ways to get a token. All three are PUBLIC (you can't be
// asked for a token in order to get your first token), and all three answer
// with the same shape: { token, user: { id, email, isGuest } }.
//
// Thin on purpose, like quiz.routes.ts: read the request, call the service,
// send whatever it decided.

export const authRouter = Router()

// No body needed. Creates a user row with no email/password and returns a
// token for it — this is what the frontend calls silently on a first visit.
authRouter.post(
  '/auth/guest',
  withErrorHandling('POST /auth/guest', async (_req, res) => {
    const t0 = Date.now()
    pipelineStart('auth', 'POST /auth/guest')

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
  withErrorHandling('POST /auth/login', async (req, res) => {
    const t0 = Date.now()
    pipelineStart('auth', 'POST /auth/login')

    const result = await login(req.body)
    if (!result.ok) return res.status(result.status).json({ error: result.error })

    pipelineEnd('auth', Date.now() - t0)
    res.json({ token: result.token, user: result.user })
  }),
)
