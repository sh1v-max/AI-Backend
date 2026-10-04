import 'dotenv/config'
import { app } from './app'
import { PORT } from './config'
import { getJwtSecret } from './services/auth.service'

// Auth.1 — fail at startup if JWT_SECRET is missing, not on the first login.
getJwtSecret()

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
