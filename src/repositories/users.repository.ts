import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { users } from '../db/schema'

// Auth.1 — everything that reads or writes the users table lives here.

// What the rest of the app (and the client) is allowed to know about a user.
// No passwordHash: every function below except findUserByEmail() selects
// exactly these columns BY NAME, so the hash can't leak by accident through a
// "select everything" query.
export interface PublicUser {
  id: string
  email: string | null
  isGuest: boolean
}

const publicColumns = {
  id: users.id,
  email: users.email,
  isGuest: users.isGuest,
}

// A guest is a row with just an id — no email, no password. is_guest defaults
// to true in the table, so it isn't set here.
export async function createGuest(id: string): Promise<PublicUser> {
  const [user] = await db.insert(users).values({ id }).returning(publicColumns)
  return user
}
// equivalent sql query:
// INSERT INTO users (id) VALUES ($1) RETURNING id, email, is_guest

// A brand-new registered user. Throws a unique-violation error (Postgres code
// 23505) if the email is already taken — the caller turns that into a 409.
export async function createUser(
  id: string,
  email: string,
  passwordHash: string,
): Promise<PublicUser> {
  const [user] = await db
    .insert(users)
    .values({ id, email, passwordHash, isGuest: false })
    .returning(publicColumns)
  return user
}
// equivalent sql query:
// INSERT INTO users (id, email, password_hash, is_guest) VALUES ($1, $2, $3, FALSE) RETURNING id, email, is_guest

// Turns an existing guest into a registered user IN PLACE: same row, same id,
// so every document and message already saved under that id stays theirs.
// The `is_guest = true` condition means this can never overwrite the email or
// password of an account that's already registered — in that case no row
// matches and it returns null.
export async function upgradeGuest(
  id: string,
  email: string,
  passwordHash: string,
): Promise<PublicUser | null> {
  const [user] = await db
    .update(users)
    .set({ email, passwordHash, isGuest: false })
    .where(and(eq(users.id, id), eq(users.isGuest, true)))
    .returning(publicColumns)
  return user ?? null
}
// equivalent sql query:
// UPDATE users SET email = $2, password_hash = $3, is_guest = FALSE
// WHERE id = $1 AND is_guest = TRUE
// RETURNING id, email, is_guest

// The ONLY function that returns the password hash — login needs it to check
// the password against. Nothing else should call this.
export async function findUserByEmail(
  email: string,
): Promise<(PublicUser & { passwordHash: string | null }) | null> {
  const [user] = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return user ?? null
}
// equivalent sql query:
// SELECT id, email, is_guest, password_hash FROM users WHERE email = $1 LIMIT 1

export async function findUserById(id: string): Promise<PublicUser | null> {
  const [user] = await db
    .select(publicColumns)
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  return user ?? null
}
// equivalent sql query:
// SELECT id, email, is_guest FROM users WHERE id = $1 LIMIT 1
