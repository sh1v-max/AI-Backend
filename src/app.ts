import express from 'express'
import cors from 'cors'
import { FRONTEND_URL } from './config'
import { documentsRouter } from './routes/documents.routes'
import { sessionsRouter } from './routes/sessions.routes'
import { chatRouter } from './routes/chat.routes'

// The app is built here and started in index.ts — keeping `listen()` out of
// this file means tests (Phase 9) can import the app without opening a port.
export const app = express()

// Only affects requests with Content-Type: application/json — /upload's
// multipart/form-data requests are handled separately by Multer, so the two
// don't conflict.
app.use(express.json())

app.use(
  cors({
    origin: FRONTEND_URL,
  }),
)

app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'DocMind API - POST a PDF to /upload',
  })
})

app.use(documentsRouter)
app.use(sessionsRouter)
app.use(chatRouter)
