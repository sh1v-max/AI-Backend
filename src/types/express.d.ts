import type { AuthUser } from '../services/auth.service'

// Auth.2 — teaches TypeScript that a request can carry `user`.
//
// Express's own Request type has no `user` field, so `req.user = ...` in the
// middleware would be a type error. "Declaration merging" fixes that: when
// two interfaces share a name, TypeScript merges them into one. Declaring
// `interface Request` inside Express's global namespace ADDS `user` to the
// real Request type everywhere in the project, without editing node_modules.
//
// It's optional (`?`) because it honestly is missing on public routes like
// /auth/login, where requireAuth never ran.
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

// An empty export makes this file a "module". Without it TypeScript treats
// the file as a global script, and `declare global` is only allowed inside a
// module.
export {}
