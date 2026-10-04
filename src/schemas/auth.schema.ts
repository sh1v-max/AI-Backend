import { z } from 'zod'

// Auth.1 — the shape of a register / login request body. Same tool as the
// quiz schema (Step 4.1), pointed at its more usual target: a request body is
// untrusted input, so nothing in it gets used until it has passed safeParse.

// bcrypt only looks at the first 72 BYTES of a password and silently ignores
// the rest — so two long passwords sharing their first 72 bytes would both
// log in. Rejecting anything longer is the honest fix.
const BCRYPT_MAX_BYTES = 72
export const PASSWORD_MIN_LENGTH = 8

// Trimmed and lowercased BEFORE it is checked or stored, so "Shiv@x.com " and
// "shiv@x.com" are the same account instead of two. .pipe() hands the cleaned
// string on to the email check.
const email = z
  .string('email is required')
  .trim()
  .toLowerCase()
  .pipe(z.email('That does not look like a valid email address'))

export const RegisterInput = z.object(
  {
    email,
    password: z
      .string('password is required')
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
      // bytes, not characters: an emoji or an accented letter is 1 character
      // but 2-4 bytes, and bytes are what bcrypt counts.
      .refine((p) => Buffer.byteLength(p, 'utf8') <= BCRYPT_MAX_BYTES, {
        message: `Password is too long (max ${BCRYPT_MAX_BYTES} bytes)`,
      }),
  },
  'email and password are required',
)

// Login doesn't repeat the length rules: a password that breaks them simply
// won't match any stored hash, and "Invalid email or password" is the only
// thing a login should ever say about why it failed.
export const LoginInput = z.object(
  {
    email,
    password: z.string('password is required').min(1, 'password is required'),
  },
  'email and password are required',
)

export type RegisterInput = z.infer<typeof RegisterInput>
export type LoginInput = z.infer<typeof LoginInput>
