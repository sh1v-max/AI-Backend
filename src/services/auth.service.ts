import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import {
  createGuest,
  createUser,
  upgradeGuest,
  findUserByEmail,
  type PublicUser,
} from '../repositories/users.repository'
import { RegisterInput, LoginInput } from '../schemas/auth.schema'
import { TOKEN_TTL_GUEST, TOKEN_TTL_USER } from '../config'
import { detail, rejected } from '../utils/pipelineLogger'

// Auth.1 — everything about proving who someone is: making tokens, checking
// tokens, and the three ways to get one (guest, register, login).
//
// A JWT is three base64 pieces joined by dots: header.payload.signature. The
// payload is NOT secret — anyone can decode and read it. What makes it
// trustworthy is the signature: a hash of header + payload + a secret only
// this server knows. Change one character of the payload and the signature
// no longer matches, so the server can tell "I issued this, untouched"
// without looking anything up in the database.

// How slow to make each password hash: 2^10 rounds. Slow on purpose — a
// stolen users table then takes an attacker years to brute-force, not hours.
const BCRYPT_ROUNDS = 10

// Read through a function instead of a top-level constant so a missing secret
// fails with a clear message (index.ts calls this once at startup), rather
// than signing tokens with the string "undefined".
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET is not set — add it to .env (see .env.example)')
  }
  return secret
}

// What a verified token tells us about the caller. This is what AUTH.2's
// middleware will attach to the request as req.user.
export interface AuthUser {
  id: string
  isGuest: boolean
}

// The payload is kept tiny: `sub` ("subject", the standard JWT name for "who
// this token is about") and whether they're a guest. No email, nothing
// private — remember anyone holding the token can read this part.
export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, guest: user.isGuest }, getJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: user.isGuest ? TOKEN_TTL_GUEST : TOKEN_TTL_USER,
  })
}

// Returns who the token belongs to, or null if it's anything other than a
// valid, unexpired token signed by us. Never throws — callers only ever need
// "valid or not".
//
// verify, NOT decode: jwt.decode() just reads the payload without checking
// the signature, so it would happily accept a token someone typed by hand.
// `algorithms` is pinned because the token's own header says which algorithm
// it used — without the pin, an attacker gets to pick.
export function verifyToken(token: string): AuthUser | null {
  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] })
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') return null
    return { id: payload.sub, isGuest: payload.guest === true }
  } catch {
    return null
  }
}

// Pulls the token out of an "Authorization: Bearer <token>" header value.
// Takes the header STRING, not the request — services never touch req/res.
export function tokenFromHeader(header: string | undefined): string | null {
  if (!header || !header.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

// Same result style as prepareChat() / generateQuiz(): the service decides
// the outcome, the route sends the response.
export type AuthResult =
  | { ok: false; status: number; error: string }
  | { ok: true; token: string; user: PublicUser }

function success(user: PublicUser): AuthResult {
  // Only the first 8 characters of the id are logged — enough to follow one
  // user through the terminal, and never a token, password or hash.
  detail(`user: ${user.id.slice(0, 8)} (${user.isGuest ? 'guest' : user.email})`)
  return { ok: true, token: signToken(user), user }
}

// Drizzle wraps the database's own error, so the Postgres error code lives
// on `cause`. 23505 = unique_violation, i.e. "that email is already in the
// table".
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } }
  return e?.code === '23505' || e?.cause?.code === '23505'
}

export async function loginAsGuest(): Promise<AuthResult> {
  const user = await createGuest(randomUUID())
  return success(user)
}

// `guestToken` is the caller's current token, if they sent one. If it's a
// valid GUEST token, registering upgrades that same user row instead of
// making a new one — so the files they uploaded as a guest come with them.
export async function register(input: unknown, guestToken: string | null): Promise<AuthResult> {
  const parsed = RegisterInput.safeParse(input)
  if (!parsed.success) {
    const reason = parsed.error.issues[0].message
    rejected(reason)
    return { ok: false, status: 400, error: reason }
  }
  const { email, password } = parsed.data

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

  try {
    const guest = guestToken ? verifyToken(guestToken) : null
    if (guest?.isGuest) {
      // null if that guest row is gone or was already upgraded — then fall
      // through and create a fresh account instead.
      const upgraded = await upgradeGuest(guest.id, email, passwordHash)
      if (upgraded) {
        detail('upgraded an existing guest (same id, their data stays)')
        return success(upgraded)
      }
    }

    return success(await createUser(randomUUID(), email, passwordHash))
  } catch (err) {
    // No "does this email exist?" SELECT before the insert on purpose: two
    // sign-ups for the same email at the same moment could both pass that
    // check. The UNIQUE constraint on the column is the real guard, so the
    // insert is simply attempted and this handles the loser.
    if (isUniqueViolation(err)) {
      rejected('email already registered')
      return { ok: false, status: 409, error: 'An account with this email already exists' }
    }
    throw err
  }
}

export async function login(input: unknown): Promise<AuthResult> {
  // One message for "no such email" AND "wrong password". Two different
  // messages would let anyone test which emails have an account here.
  const invalid: AuthResult = { ok: false, status: 401, error: 'Invalid email or password' }

  const parsed = LoginInput.safeParse(input)
  if (!parsed.success) {
    const reason = parsed.error.issues[0].message
    rejected(reason)
    return { ok: false, status: 400, error: reason }
  }
  const { email, password } = parsed.data

  const user = await findUserByEmail(email)
  if (!user || !user.passwordHash) {
    rejected('login failed — no account with that email')
    return invalid
  }

  // compare() re-hashes the typed password using the salt stored inside the
  // saved hash, and checks the two match. The original password is never
  // stored anywhere, so this is the only way to check it.
  const matches = await bcrypt.compare(password, user.passwordHash)
  if (!matches) {
    rejected('login failed — wrong password')
    return invalid
  }

  return success({ id: user.id, email: user.email, isGuest: user.isGuest })
}
