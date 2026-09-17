export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export class ApiError extends Error {}

export async function parseJsonOrThrow(res: Response) {
  const data = await res.json()
  if (!res.ok) {
    throw new ApiError(data.error || `Request failed with status ${res.status}`)
  }
  return data
}
