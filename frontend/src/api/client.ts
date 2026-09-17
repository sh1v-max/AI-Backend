import { log } from '../utils/logger'

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export class ApiError extends Error {}

export async function parseJsonOrThrow(res: Response) {
  const data = await res.json()
  if (!res.ok) {
    log.error('api', `${res.status} ${res.url}`, data)
    throw new ApiError(data.error || `Request failed with status ${res.status}`)
  }
  return data
}
