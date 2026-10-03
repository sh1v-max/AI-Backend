import type { Request, Response, NextFunction } from 'express'
import { tokenFromHeader, verifyToken } from '../services/auth.service'
import { rejected } from '../utils/pipelineLogger'

// Auth.2 — the bouncer. Every route mounted AFTER `app.use(requireAuth)` in
// app.ts goes through this first.
//
// A middleware is just a function Express runs before the route handler. It
// either ends the request itself (here: a 401) or calls next() to hand it on
// to whatever comes next in line.
//
// This only checks the token's signature and expiry — it never queries the
// database. That's the whole point of a JWT: the proof that "the server
// issued this token for user X" is inside the token itself, so a check costs
// microseconds instead of a round trip to Neon on every single request.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = tokenFromHeader(req.headers.authorization)
  const user = token ? verifyToken(token) : null

  if (!user) {
    // Same 401 for "no token", "tampered token" and "expired token" — the
    // client's fix is identical in all three cases (get a new token), and
    // the reason is logged here for whoever is reading the terminal.
    rejected(`401 ${req.method} ${req.path} — ${token ? 'invalid or expired token' : 'no token'}`)
    return res.status(401).json({ error: 'Sign in required' })
  }

  // From here on, every route handler can read req.user.id — and that is the
  // ONLY place a route should ever get a user id from (never the body, query
  // or URL, which the client controls).
  req.user = user
  next()
}
