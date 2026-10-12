# DocMind frontend

The React client for the DocMind API. It exists to use every endpoint the way a real client would: auth headers, file uploads, a streamed reply, structured JSON. The project overview, API reference and setup live in the [main README](../README.md).

Live at [docmind-jet.vercel.app](https://docmind-jet.vercel.app/).

## Run it

```bash
npm install
cp .env.example .env     # VITE_API_URL=http://localhost:3000
npm run dev              # http://localhost:5173
npm run build            # typecheck + production build into dist/
npm run lint             # oxlint
```

The backend has to be running (`npm run dev` in the repo root). `VITE_API_URL` is baked in at build time, so changing it on Vercel needs a redeploy.

## Stack

React 19, Vite, TypeScript, `@phosphor-icons/react`, `react-markdown` + `remark-gfm` for answers (no raw HTML, see below), oxlint. No state library, no router.

## Layout

```
src/
  api/          fetch calls only
    client.ts       API_URL, the token store (localStorage "docmind:token"), authFetch (adds the Bearer header)
    auth.ts         guest / login / register / me (plain fetch: a 401 here is an expected answer)
    chat.ts         sendChatMessage + streamChatMessage (POST /chat-stream read with fetch + a small SSE parser)
    documents.ts    list, upload, delete
    sessions.ts     conversation list + transcripts
    quiz.ts         POST /quiz
    sample.ts       loads public/how-to-start.pdf as a File for the "Try our sample" link
  hooks/        state + async logic: useAuth, useDocuments, useSessions, useChat, useQuiz
  components/
    auth/           sign in / sign up modal, account area in the sidebar footer
    chat/           home screen (NewChatScreen), the conversation, composer, scope picker, markdown, sources
    sidebar/        documents (counter + per-file menu) and conversation history
    quiz/           document picker + the quiz itself (graded in the browser)
    common/         brand mark, splash screen, icon button
  types/        shared TypeScript types
  utils/        format helpers, a tagged console logger ([DocMind:<scope>])
  App.tsx       an auth gate (splash until there's a user), then the app itself
public/how-to-start.pdf    the sample document (its source is sample-docs/how-to-start.html)
```

Rule of thumb: `api/` only talks HTTP, `hooks/` own state, `components/` only render, `App.tsx` wires them together.

## Things worth knowing

- **Every visitor is a user.** On first load `useAuth` creates a guest (`POST /auth/guest`) and keeps the token in `localStorage`. On every load after that it checks the token with `GET /auth/me`. If the token is rejected (expired, or signed with a different `JWT_SECRET`, e.g. a token from the live API used against a local one), it quietly starts a new guest, so the old guest's files are no longer reachable from this browser.
- **Streaming uses `fetch`, not `EventSource`.** `EventSource` can't send an `Authorization` header. `streamChatMessage()` reads the body with `getReader()`, normalises `\r\n`, splits on blank lines and keeps a partial event for the next read.
- **Answers are markdown without raw HTML.** The token lives in `localStorage`, so anything that lets HTML from the model run in the page would be an XSS risk. Don't add `rehype-raw` without a sanitizer.
- **Only two things are stored locally:** the token and the active conversation id. Messages are always re-fetched from the API.
