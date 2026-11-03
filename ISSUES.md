# Bugs and issues: open and fixed

The list of everything that's wrong, missing or slow right now, and of everything that went wrong
before and was fixed, so nothing lives only in a chat.

Started 2026-11-03. Open items were checked against the code that day. Fixed items come from git
history, the work log in CLAUDE.md and the results logs in the three plans
([auth-jwt-plan.md](auth-jwt-plan.md) §9, [background-jobs-plan.md](background-jobs-plan.md) §9, [agents-plan.md](agents-plan.md) §9).

When an open item gets fixed, move it to "Fixed" with the date and the commit.

| | Count |
|---|---|
| **Open** | **34**: bugs 7 · robustness 8 · known gaps 8 · slowness 3 · hygiene 8 |
| **Fixed** | **42** app bugs and design problems, plus 12 testing/tooling traps and 4 environment problems |

---

# Open

## Bugs (behaviour is wrong today)

| # | Issue | Where | Notes |
|---|---|---|---|
| 1 | A bad `GEMINI_API_KEY` (or any Gemini 4xx) shows "check your internet connection" | `utils/errors.ts` `withErrorHandling` | Failure types aren't told apart |
| 2 | A failed turn leaves an unanswered user message in the transcript | `chat.service.ts` (the user row is saved before generation) | The agent merges two user turns in a row, so the prompt is fine; the UI history isn't |
| 3 | Messages with the same `created_at` can come back in the wrong order | `chatMessages.repository.ts` (orderBy `createdAt` only, no `id` tiebreak) | Fix: add `id` as the second sort key |
| 4 | The backend doesn't enforce that a session keeps one `documentId` | chat routes / `prepareChat` | Only the frontend does, so a client can mix scopes in one session |
| 5 | Cancelling a stream only stops the browser | `/chat-stream` | The server still finishes the Gemini call and saves both messages |
| 6 | Login with an unknown email answers faster than a wrong password | `auth.service.ts` `login` | A timing leak that reveals which emails exist. Fix: compare against a dummy hash |
| 7 | The quiz offer's button is gone after a reload (text only) | AG.5, not persisted | Same root cause as #16 |

## Robustness (missing guards)

| # | Issue | Where | Notes |
|---|---|---|---|
| 8 | No timeout and no retry on any Gemini `fetch` | `llm.service.ts`, `embeddings.service.ts` | A hung call hangs the request. A 503 "high demand" fails right away (hit several times in AG.4/AG.5 testing) |
| 9 | No max length on the chat `message` | chat routes | A huge paste goes straight into the embedding and the prompt |
| 10 | No `GEMINI_MODEL` env setting | `llm.service.ts` | Switching models when one is overloaded needs a code change |
| 11 | `HISTORY_LIMIT` counts messages, not tokens | `config.ts` | Eight long messages can still make a big prompt |
| 12 | The embedding rate limit is close: uploads have already peaked at 25.85K of the 30K TPM | worker | The worker has no pacing. Logged as a risk in agents-plan §13 |
| 13 | The auth rate limiter is in-memory | `middleware/rateLimit.ts` | Resets on every restart and every Render sleep |
| 14 | Two uploads at the same moment can both pass the document cap | `checkDocumentCap` | Fine as a cost guard, not exact |
| 15 | A crashed job takes up to ~10 min to resume | BullMQ stalled checks (`stalledInterval` 5 min) | The cost of the Upstash tuning. Deploys aren't affected, since SIGTERM waits for the job |

## Known gaps (left out on purpose for now)

| # | Issue | Notes |
|---|---|---|
| 16 | Sources, tool calls and quiz offers aren't saved with the messages | A reopened chat shows answers without sources or buttons |
| 17 | No refresh tokens, server-side logout, email verification or password reset | auth-jwt-plan §7 |
| 18 | No foreign keys anywhere | Cleanup relies on code order (row first, then chunks) |
| 19 | No OCR: scanned PDFs are rejected (400) | `pdf-parse` needs a text layer |
| 20 | `searchSimilar` doesn't return chunk ids | An eval or a citation feature would need them |
| 21 | No token/cost logging, and Gemini's `generationConfig` shape leaks into `quiz.service.ts` | `generateAnswer` drops `usageMetadata` |
| 22 | Errors are logged to the terminal only | File logging deliberately deferred (CLAUDE §10) |
| 23 | If a vector index is ever added, the ANN top-k runs before the owner join filter | Only matters once an index exists (CLAUDE §8) |

## Slowness

| # | Issue | Idea (not built) |
|---|---|---|
| 24 | Every quiz request waits on one LLM classifier call, even an exact example match ("let's do a quick quiz", margin 0.366). That was 25–53 s on a slow Gemini day | Accept a vector `quiz_request` at margin ≥ ~0.3 (the AG.1 eval's worst wrong quiz match was at 0.141) |
| 25 | Specific document questions often score as vector smalltalk at tiny margins, so they pay an extra LLM call | A smalltalk score floor (agents-plan §9 AG.2) |
| 26 | Every DB query crosses the US: Render and Upstash are in Oregon, Neon is in Ohio (~50–70 ms per query) | Move Neon to an Oregon region if it ever matters (background-jobs-plan §9 BG.0) |

## Hygiene / tooling / docs

| # | Issue | Notes |
|---|---|---|
| 27 | `npm run step3` still exists and DELETEs the live `chunks` table | Remove the script from `package.json` |
| 28 | No migrations: schema changes are hand-run SQL on Neon | Do a `drizzle-kit` baseline before the next schema change |
| 29 | No automated tests | Phase 9 |
| 30 | 2 oxlint warnings (`set-state-in-effect`) | `frontend/src/hooks/useChat.ts:30`, `frontend/src/components/quiz/QuizModal.tsx:36` |
| 31 | `sendChatMessage` in `frontend/src/api/chat.ts` is unused | Delete it, or keep it as the non-streaming example |
| 32 | The roadmap and walkthrough still say `text-embedding-004` / 768 dims | The code uses `gemini-embedding-001` / 3072 |
| 33 | CODE_EXPLAINED still links `UploadDropzone.tsx` (removed in the UI.1–UI.6 redesign) and `step4-quiz-zod.ts#L54` (that code moved to `quiz.service.ts`). Its Step 2.x frontend text describes the old UI | Found in BG.6; AG.7 is a good time to fix it |
| 34 | CLAUDE.md has no work-log entry for the UI.1–UI.6 frontend redesign (2026-10-06 → 10-09) | Found in BG.6 |

---

# Fixed

## App bugs and design problems

| # | When | What went wrong | Fix |
|---|---|---|---|
| F1 | 2026-09-13 | A `console.log` bug in `src/index.ts` | `cb1bec5` (details not recorded) |
| F2 | 2026-09-15, 09-20 | Drizzle setup issues (`drizzle.config.ts`, `tsconfig.json`) | `a741110`, `67a84c8` (details not recorded) |
| F3 | 2026-09-19 | Frontend crash, "uncaught TypeError", while streaming: the `setMessages` updater mutated an index variable, and StrictMode runs updaters twice | The streaming bubble is always "the last message in `prev`"; updaters are pure (`6319fc2`) |
| F4 | 2026-09-20 | Streaming produced nothing: Gemini ends SSE lines with `\r\n`, so the blank-line split never matched | Normalize `\r\n` → `\n` on the whole buffer, not per chunk (`fd60b18`, `0568597`) |
| F5 | 2026-09-20 | Drizzle errors printed the SQL plus all 3072 embedding numbers, burying the real cause | `summarizeError()`: first line + the `cause` chain + the first in-repo stack frame |
| F6 | 2026-09-20 | 65 orphan chunks (rows with no `documents` row, from early test uploads) showed up in all-documents search | Excluded from search, then unreachable after auth's join, then deleted by Shiv (0 left on 2026-10-05) |
| F7 | 2026-09-21 | Quiz answers weren't evenly spread: the correct option was at positions 22/36/32/10% | Options are shuffled in code (Fisher–Yates, `correctIndex` remapped) (Step 4.2) |
| F8 | 2026-09-22 | `//` comments in `package.json` broke every npm command (`EJSONPARSE`) | Removed; the file must stay strict JSON |
| F9 | 2026-09-23 | A wrong-but-selected quiz option showed green and red at once (the "selected" CSS rule won on specificity) | Scoped the selected style to `:not(:disabled)` |
| F10 | 2026-09-29 | Answers showed raw markdown (`**bold**`) because they were rendered as plain text | `react-markdown` + `remark-gfm`, no raw HTML (2026-10-04 redesign, `6908005`) |
| F11 | 2026-09-29 | A pdf-parsing bug | `c22238e` (details not recorded) |
| F12 | 2026-09-30 | Errors came back as Express's HTML page, and uploads had no size cap (Render free = 512 MB RAM) | 10 MB cap (413) + a last-resort JSON error handler in `app.ts` |
| F13 | 2026-10-02 | **Every visitor saw every uploaded file**: no table had an owner | Guests as real users, JWT, `user_id` on every query, required `userId` in every repository (PR #3, 2026-10-04) |
| F14 | 2026-10-02 | `fetchDocuments()` / `fetchSessions()` skipped `res.ok` and would crash on a 401 (`.map` of `{ error }`) | Both go through `parseJsonOrThrow` (AUTH.4) |
| F15 | 2026-10-02 | `getRecentMessages` wasn't user-scoped: another user's `sessionId` would have put their conversation into the prompt | Filters on `session_id AND user_id` (AUTH.3) |
| F16 | 2026-10-03 | `EventSource` can't send an `Authorization` header, so chat broke once auth was on | Streaming rewritten on `fetch` + `getReader()` (AUTH.5) |
| F17 | 2026-10-04 | React StrictMode's double mount would have created two guests per visit | The in-flight bootstrap promise lives at module level (AUTH.4) |
| F18 | 2026-10-04 | An old mobile CSS rule hid the Log out button; `display: block !important` broke the logo layout | Both fixed in AUTH.6 |
| F19 | 2026-10-04 | The rate limiter keyed on the wrong IP on Render: 1 hop = Render's proxies (2 counters), 2 hops = Cloudflare edges (a new counter per request, so no limit at all) | `TRUST_PROXY_HOPS=3`, verified with the `pk` hash (`5eb5109`, `550d22e`) |
| F20 | 2026-10-05 | `GET /chat-stream` put the question in the URL (logs, browser history, length limit) | POST + JSON body (`98319c0`) |
| F21 | earlier | A real secret leaked through VS Code's `.history/` folder | `.history/` and `.env` gitignored; rotate keys if exposed |
| F22 | 2026-10-06 | BullMQ's defaults would have cost ~1.02M Upstash commands a month (204% of the free plan) with zero uploads | `drainDelay` 30 s + `stalledInterval` 5 min → ~164K (33%) (BG.1) |
| F23 | 2026-10-06 | Two copies of ioredis → TypeScript "incompatible connection" errors | Deduped to one copy (BG.0) |
| F24 | 2026-10-14 | `DELETE /documents/:id` deleted chunks before the row, so a finishing job could leave orphan chunks | Delete the **row first**; a worker that finds no row removes its own chunks (BG.2/BG.3) |
| F25 | 2026-10-14 | A job failed for stalling too often would leave its document `processing` forever (`attemptsMade` arithmetic) | "Last attempt?" = `await job.getState() === 'failed'` (BG.2) |
| F26 | 2026-10-14 | `pdf-parse` v2 adds a `-- 1 of N --` marker per page, so a PDF with no text passed as 12 chars / 1 chunk | `hasText` is checked on the per-page texts (BG.3) |
| F27 | 2026-10-14 | With Redis unreachable since startup, BullMQ's `add()` waits forever | 5 s enqueue timeout → 503, row removed (BG.3) |
| F28 | 2026-10-14 | Render had `BULLMQ_PREFIX=docmind-dev`, so production shared one queue with the laptop | Set to `docmind` on Render, re-verified 10/10 (2026-10-15) |
| F29 | 2026-10-26 | The router's vector match labelled by shared *words*: "compare the two pdfs", "give an example" and "what is a quiz?" → quiz | A vector quiz is always double-checked by the LLM classifier (AG.1/AG.2) |
| F30 | 2026-10-27 | A zero-document guest saying "hi" got a 404 | Smalltalk route, no search (AG.2) |
| F31 | 2026-10-27 | Real document questions paid an extra LLM call when their vector margin was small | A vector `document_question` is accepted at any margin; LLM calls on the eval went 24 → 17 of 52 (2026-10-28) |
| F32 | 2026-09-29 → 10-31 | Follow-ups ("and who founded it?") searched with the raw message, before history, so the right chunk won by 0.002 or lost | The agent writes its own search query ("who founded the Lantern Festival") (AG.3) |
| F33 | 2026-10-31 | "What's the capital of France?" in a document chat → "Paris!" | Smalltalk + agent refuse general-knowledge questions (AG.3) |
| F34 | 2026-10-31 | "Which documents do I have?" couldn't be answered by chunk search | `listDocuments` tool (AG.3) |
| F35 | 2026-10-22 | Dropping a model turn's `thoughtSignature` → 400 | Model turns are sent back unchanged (AG.0/AG.3) |
| F36 | 2026-10-22 | `mode: 'NONE'` is ignored on this model, so a "last step, answer now" could still call a tool | The last step is sent without `tools` at all (AG.0) |
| F37 | 2026-10-31 | Two user turns in a row (after a tolerated failed save) would break the agent's turn order | `historyToContents` merges same-role turns (AG.3) |
| F38 | 2026-11-02 | A step-limit give-up line that was only *returned* would show nothing in a streamed reply | It's yielded as text and saved (AG.4) |
| F39 | 2026-11-02 | An old frontend could break on the new SSE events | Events are additive; checked that the pre-AG.4 bundle still answers (AG.4) |
| F40 | 2026-11-02 | "Quiz me" with no ready documents → a 404 error | A sentence instead ("Upload a PDF first…") (AG.5) |
| F41 | 2026-11-02 | A quiz request was answered as a document question (a search + an answer, no quiz) | A code-written offer + a Create quiz button; the quiz only runs on the click (AG.5) |
| F42 | 2026-10-14 | Uploads made the user wait for every chunk's embedding inside the HTTP request | Parse in the request, embed on a BullMQ worker, 202 + `processing` → `ready` (Phase 6) |

## Testing and tooling traps (not app bugs, but they cost time)

| # | When | What bit | Lesson |
|---|---|---|---|
| T1 | 2026-10-03, 10-27 | A stale test server (and later `ts-node-dev`'s surviving child) kept answering on the test port with old code | Check what's listening on the port before trusting a test |
| T2 | 2026-10-03 | dotenv 17 prints a banner to stdout, which got glued onto tokens made with `node -e` → 400s | `config({ quiet: true })` |
| T3 | 2026-10-03 | `step3-drizzle.ts` passed a document id where `userId` goes and still compiled (both strings) | Check argument order on string parameters |
| T4 | 2026-10 | A time-window cleanup deleted a guest that was probably Shiv's own browser | Delete only the ids your own test captured |
| T5 | 2026-10-06 | BullMQ: in the `completed` event `attemptsMade` already includes the successful attempt (+1 double-counted) | Read it in the processor, or don't add 1 |
| T6 | 2026-10-06 | Two measurements on the same queue name → "Cannot obliterate non-paused queue" | One queue per run |
| T7 | 2026-10-06 | Upstash setup: copied the `redis-cli` command instead of the URL; then `redis://` without TLS; a `verify-fulle` typo `pg` silently accepted | Use the `rediss://` URL from the ioredis tab |
| T8 | 2026-10-14 | A long bash heredoc failed to parse on Windows; later a heredoc turned a written `\n` into a real line break in TS | Use the editor tool for files and anything with backslash escapes |
| T9 | 2026-10-14 | Playwright wanted a Chromium build that wasn't installed | Launch with `executablePath` to the installed one |
| T10 | 2026-10-14 | The live queue check asserted "job hash gone", which passes under any prefix | Assert the specific thing (the job's events under `docmind:`) |
| T11 | 2026-10-26 | Batch embeddings count per text against the 100/min limit → 429 on back-to-back eval runs | Wait a minute between `npm run step7` runs |
| T12 | 2026-11-02 | A fake-stream helper with unsorted cut points looked like a parser bug; "thinking row gone" was taken as "answer finished" | Finished = a new Copy button |

## Environment / external (nothing to fix in code)

| # | When | Problem | What to do |
|---|---|---|---|
| E1 | 2026-09-21, 10-31 | Neon `getaddrinfo ENOTFOUND`: the network's DNS refused the hostname (hotspot) | Switch network or use 8.8.8.8 / 1.1.1.1 |
| E2 | 2026-09-27 → 11-02 | Gemini 503 "high demand" on every Flash model at times | External; retry/timeout is open item #8, a model switch is #10 |
| E3 | 2026-09-27 | The 2.5 Flash models are closed to new users | Stay on `gemini-flash-lite-latest` |
| E4 | 2026-10-14 → 10-15 | Render cold starts: 21 s, ~140 s after an env-change redeploy | Free tier; expect it on the first live request |
