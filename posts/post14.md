# AI Backend Learning Journey — Post 14 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write one LinkedIn post and one Twitter/X post based on everything below. I'm a frontend/full-stack engineer learning AI backend development from scratch and documenting it publicly. See `post1.md` through `post13.md` for continuity; post 13 was background jobs (PDF uploads moved onto a BullMQ queue, answer in ~1 s instead of a request open for a minute).

**Format (my standing preference, this overrides older posts):**
- A **progress update**, not a story. What got done since the last post as plain `-` bullets, one or two things I learned, what's still missing, what's next.
- **No "Day N"** label anywhere. No story arc, no "biggest takeaway" line, no "excited to announce".
- **X = one single post**, no thread.
- My voice: casual, a bit run-on, lowercase-ish bullets of uneven length, **no em-dashes**, no "not just X but Y" lines.
- The link goes in the first comment / reply, not in the post.
- Only use facts from this file, and respect "Don't overclaim". **This is the first half of Phase 7. The agent itself is not built yet.** Don't write "I built an agent".
- **Images:** three, in this order, in `posts/post14-images/`: `post14-1-before-after.png` ("hi" ran the full search, now the router decides first), `post14-2-close-call.png` (the lighthouse question at ≈0.52 vs ≈0.51, so the LLM decides), `post14-3-measured.png` (36/41 vs 41/41, 6–22 s, 0 bad mistakes with the LLM on 17/52). Post all three as a set; the text shouldn't repeat what they already show. `source.html` re-renders them. (`post14-video-prompt.md` exists too, but the video is saved for the agent-loop post.)

Strongest angle for the one or two "learned" lines: **a real question can look like small talk to embeddings.** Specific questions ("when was the lighthouse built?") score about the same (~0.5) against every example phrase, and by a hair closer to "what's your name?". So the cheap vector check only decides when it's clearly sure, and close calls go to the LLM. Second option: **the LLM classifier got everything right, but it's slow** (6–22 s on about half its calls in one run), so it's the backup, not the default.

---

## What I built

Continuing **DocMind** (upload a PDF, chat with it, get quizzed on it, built from scratch to actually understand AI backends). This stretch covers Oct 15 → Oct 28: the first half of Phase 7, agents and tool calling.

### The problem

Every chat message ran the same pipeline: embed it, vector search the PDFs, stuff the top 3 chunks in a prompt, answer. So "hi" did a full document search. "thanks!" did one too. And a guest who hadn't uploaded anything yet got a **404 "no documents"** for typing "hi". A "quiz me" message just got searched like a question.

The fix is to decide what kind of message it is **before** doing any work. That's the first piece of an agent: something that chooses what to do instead of always doing the same thing.

### What changed

- **Probed raw function calling first** (`npm run step6`, no database, a made-up 3-paragraph document so answers could only come from the tool). Sent a tool, got a `functionCall` back, ran it myself, sent the result, got the answer. Did it streamed and not streamed, 17 real Gemini calls.
- **Built an intent router.** Three intents: `smalltalk`, `document_question`, `quiz_request`.
  - First check is cheap: the message is already embedded for the search, so compare it with 28 example phrases (10 small talk, 10 document, 8 quiz; embedded once per server start). Zero extra API calls.
  - If that's a close call, ask the LLM to classify it, in JSON mode with a Zod-checked `{ intent }` reply (same ask + verify idea as the quiz in Phase 4).
  - If anything fails or isn't sure, it falls back to `document_question`, which is just the old behaviour. Never to smalltalk: a real question answered as small talk would be wrong and confident.
- **Put it live in both chat routes.** Small talk gets a short reply with **no search**. A guest with zero documents typing "hi" gets an answer now, not a 404. Every reply carries `route: { intent, by, margin }` so I can see who decided.
- **Built an eval** (`npm run step7`): first 41 labelled messages, then 52 (greetings, follow-ups with history, typos, Hinglish, traps like "what is a quiz?" and "don't quiz me, just explain X"). Each mistake labelled worst / annoying / harmless.

### Things I learned / measured

- **Embeddings match shared words, not intent.** Vector router alone: **36/41**. "how many chapters are there?" → quiz (nearest example: "I want to take a quiz on chapter 2"). "give an example" → quiz ("give me a quiz"). "what's the refund policy?" → small talk.
- **The LLM classifier got 41/41, but it's slow.** One run: median 1.5 s but **6–22 s on about half the calls**. A later run: median **9 s**, and one 503 "high demand". So it's the backup, not the default.
- **The rule I ended with:** the vectors decide alone only when they say `document_question` (the safe default anyway), or smalltalk with a margin of at least **0.03**. A vector "quiz" always goes to the LLM, because every wrong vector guess on the eval was a quiz. On the 52 messages: **0 bad mistakes**, LLM called on **17/52**.
- **A real question can look like small talk.** I expected specific questions to be clearly "document". Live, they scored about **0.52** against "what's your name?" and **0.51** against the document examples, a margin of 0.002–0.008. They're far from *every* generic phrase. The margin rule is exactly what catches that and sends them to the LLM.

### Gotchas (real ones)

- Gemini 3.5 Flash-Lite puts a `thoughtSignature` on every model turn. Drop it when sending the history back and you get a **400**.
- `mode: 'NONE'` (meaning "don't call a tool") was **ignored** on a fresh question, 2 out of 2 times. Leaving the tools out of the request works, so that's what the agent loop's last step will do.
- With `mode: 'ANY'` it called the search tool for "thanks!". Never use that for chat.
- Batch embeddings count **per text** against the 100/minute limit. 70 texts in one call = 70 requests. Two eval runs back to back → 429.

---

## The bigger takeaway

(Not for the post itself, just context for the writer.) A router is a classifier with a fallback. The cheap path and the smart path both make mistakes, so what matters is which mistakes each one makes, and sending the risky ones to the other.

## What's still missing

- The actual agent: the model calling a `searchDocuments` tool itself (and rewriting the query), and a `listDocuments` tool so "which files do I have?" finally works.
- "quiz me" is detected now but still answered like a normal question. A "Create quiz" button comes later.
- Most specific questions still cost one extra LLM call to route. An idea to fix that (a minimum score for small talk) is written down but not built, because the gap is thin and fitted on the same 52 messages.
- No progress messages yet, still the three loading dots.

## What's next

AG.3: the agent loop. The model gets the search tool and decides what to search for, capped at 3 steps. Then streaming it with progress messages ("Searching the document…") in the UI.

## Numbers you can quote

- vector router alone **36/41**, LLM classifier **41/41**
- LLM latency: **6–22 s** on ~half the calls in one run, median **9 s** in another
- final rule on **52** messages: **0** bad mistakes, LLM on **17/52** (the earlier rule needed 24/52)
- margin threshold **0.03**
- live specific questions: ~**0.52** vs ~**0.51**, margin **0.002–0.008**
- probe: **17** Gemini calls; the two tool declarations cost ~**136** input tokens per request
- **12/12** HTTP tests on the live router (local server, real database and Gemini, throwaway guests deleted after)

## Don't overclaim

- **No agent yet.** Today the model doesn't call tools inside DocMind; that was only the probe script. The router is the live part.
- 52 messages is a small eval set, and the threshold was picked on it. 12 held out, all correct, but they were easy.
- The 0.52 / 0.51 numbers are from a handful of live test questions, not a big sample.
- Latency numbers are from the free tier on two days; they vary a lot.
- I built it step by step with Claude Code as a pair programmer; every step was tested against the real stack before moving on.

## Hook ideas

- "my chat app ran a full vector search when you said hi. now it checks what you meant first"
- "to embeddings, 'when was the lighthouse built?' looks more like 'what's your name?' than like a document question"
- "the LLM classifier was right 41 out of 41 times. i still made it the backup"
