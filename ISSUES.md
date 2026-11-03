# Known bugs and issues (to fix later)

One list of everything known to be wrong, missing or slow, so nothing lives only in a chat.
Started 2026-11-03 from CLAUDE.md, the plans' results logs and the AG.5 session; each item
was re-checked against the code that day. When one is fixed, move it to "Fixed" with the date.

**Open: 31** (bugs 7 · robustness 8 · known gaps 8 · slowness 2 · hygiene 6)

## Bugs (behaviour is wrong today)

| # | Issue | Where | Notes |
|---|---|---|---|
| 1 | A bad `GEMINI_API_KEY` (or any Gemini 4xx) shows "check your internet connection" | `utils/errors.ts` `withErrorHandling` | Doesn't tell failure types apart |
| 2 | A failed turn leaves an unanswered user message in the transcript | `chat.service.ts` (user row saved before generation) | The agent merges two user turns in a row, so the prompt is fine; the UI history isn't |
| 3 | Messages with the same `created_at` can come back in the wrong order | `chatMessages.repository.ts` (orderBy `createdAt`, no `id` tiebreak) | Add `id` as the second sort key |
| 4 | The backend doesn't enforce that a session keeps one `documentId` | chat routes / `prepareChat` | Only the frontend does; a client can mix scopes in one session |
| 5 | Cancelling a stream only stops the browser | `/chat-stream` | Server still finishes the Gemini call and saves both messages |
| 6 | Login with an unknown email answers faster than a wrong password | `auth.service.ts` `login` | Timing leak (email enumeration); fix = compare against a dummy hash |
| 7 | The quiz offer's button is gone after a reload (text only) | AG.5, not persisted | Same root cause as #16 |

## Robustness (missing guards)

| # | Issue | Where | Notes |
|---|---|---|---|
| 8 | No timeout and no retry on any Gemini `fetch` | `llm.service.ts`, `embeddings.service.ts` | A hung call hangs the request; a 503 "high demand" fails at once (hit several times in AG.4/AG.5 testing) |
| 9 | No max length on the chat `message` | chat routes | A huge paste goes straight into embedding + prompt |
| 10 | No `GEMINI_MODEL` env setting | `llm.service.ts` | Switching models when one is overloaded needs a code change |
| 11 | `HISTORY_LIMIT` counts messages, not tokens | `config.ts` | Eight long messages can still be a big prompt |
| 12 | Embedding rate limit is close: uploads already peaked at 25.85K of the 30K TPM | worker | Worker has no pacing; logged as a risk in agents-plan §13 |
| 13 | Auth rate limiter is in-memory | `middleware/rateLimit.ts` | Resets on every restart / Render sleep |
| 14 | Two uploads at the same moment can both pass the document cap | `checkDocumentCap` | Fine as a cost guard, not exact |
| 15 | A crashed job takes up to ~10 min to resume | BullMQ stalled checks (`stalledInterval` 5 min) | Price of the Upstash tuning; deploys aren't affected (SIGTERM waits) |

## Known gaps (left out on purpose for now)

| # | Issue | Notes |
|---|---|---|
| 16 | Sources, tool calls and quiz offers aren't saved with messages | A reopened chat shows answers without sources or buttons |
| 17 | No refresh tokens, server-side logout, email verification, password reset | auth-jwt-plan §7 |
| 18 | No foreign keys anywhere | Cleanup relies on code order (row first, then chunks) |
| 19 | No OCR: scanned PDFs are rejected (400) | `pdf-parse` needs a text layer |
| 20 | `searchSimilar` doesn't return chunk ids | An eval/citation feature would need them |
| 21 | No token/cost logging; Gemini's `generationConfig` shape leaks into `quiz.service.ts` | `generateAnswer` drops `usageMetadata` |
| 22 | Errors are logged to the terminal only | File logging deliberately deferred (CLAUDE §10) |
| 23 | If a vector index is ever added, the ANN top-k runs before the owner join filter | Only matters once an index exists (CLAUDE §8) |

## Slowness

| # | Issue | Idea (not built) |
|---|---|---|
| 24 | Every quiz request waits on one LLM classifier call, even an exact example match ("let's do a quick quiz", margin 0.366); 25–53 s on a slow Gemini day | Accept a vector `quiz_request` at margin ≥ ~0.3 (AG.1 eval's worst wrong quiz match was 0.141) |
| 25 | Specific document questions often score as vector smalltalk at tiny margins, so they pay an LLM call | A smalltalk score floor (agents-plan §9 AG.2) |

## Hygiene / tooling / docs

| # | Issue | Notes |
|---|---|---|
| 26 | `npm run step3` still exists and DELETEs the live `chunks` table | Remove the script from `package.json` |
| 27 | No migrations: schema changes are hand-run SQL on Neon | Do a `drizzle-kit` baseline before the next schema change |
| 28 | No automated tests | Phase 9 |
| 29 | 2 oxlint warnings (`set-state-in-effect`) | `frontend/src/hooks/useChat.ts:30`, `components/quiz/QuizModal.tsx:36` |
| 30 | `sendChatMessage` in `frontend/src/api/chat.ts` is unused | Delete it or keep it as the non-streaming example |
| 31 | Roadmap + walkthrough still say `text-embedding-004` / 768 dims | Code uses `gemini-embedding-001` / 3072 |

## Fixed

| # | Issue | Fixed |
|---|---|---|
| — | Two user turns in a row in history broke the agent's turns | Already handled: `historyToContents` merges same-role turns (AG.3) |
