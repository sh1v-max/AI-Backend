// Auth.4 — mirrors the backend's PublicUser (users.repository.ts). Never has a
// password or hash: the server doesn't send one.
export interface User {
  id: string
  email: string | null
  isGuest: boolean
}

// What /auth/guest, /auth/register and /auth/login all answer with.
export interface AuthResponse {
  token: string
  user: User
}
