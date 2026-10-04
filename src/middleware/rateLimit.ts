import { rateLimit } from 'express-rate-limit'
import { AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS } from '../config'
import { rejected } from '../utils/pipelineLogger'

// Auth.7 — rate limiting for the public /auth routes.
//
// How it works: the limiter keeps a counter per IP address (req.ip). Each
// request adds one; when a counter passes AUTH_RATE_LIMIT inside the window,
// further requests get 429 Too Many Requests until the window resets.
//
// Why only these routes: POST /auth/guest is public and creates a user row
// each time, so without this anyone could loop it and mint unlimited guests
// (each with its own document cap). /auth/login and /auth/register get it
// too, which also slows down password guessing.
//
// The counters live in this process's memory (the default store). That means
// they reset when the server restarts, and Render's free tier sleeps when
// idle. Good enough here; with several server instances you'd need a shared
// store (e.g. Redis) so they all see the same counts.
//
// One limiter object = one shared counter per IP across every route it's
// attached to, so 20 means 20 auth requests in total, not 20 per route.
export const authLimiter = rateLimit({
  windowMs: AUTH_RATE_WINDOW_MS,
  limit: AUTH_RATE_LIMIT,
  // Sends a standard `RateLimit` header so a client can see how much is left,
  // and drops the old non-standard X-RateLimit-* ones.
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res, _next, options) => {
    rejected(`429 ${req.method} ${req.path} — rate limit hit for ${req.ip}`)
    res.status(options.statusCode).json({
      error: 'Too many attempts from this network. Please wait a few minutes and try again.',
    })
  },
})
