# AI Backend Learning Journey — Post 15 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write one LinkedIn post and one Twitter/X post based on everything below. I'm a frontend/full-stack engineer learning AI backend development from scratch and documenting it publicly. See `post1.md` through `post14.md` for continuity; post 14 was the first half of this phase: an intent router that decides if a message is small talk, a document question or a quiz request before doing any work.

**Format (my standing preference, this overrides older posts):**
- A **progress update**, not a story. What got done since the last post as plain `-` bullets, one or two things I learned, what's still missing, what's next.
- **No "Day N"** label anywhere. No story arc, no "biggest takeaway" line, no "excited to announce".
- **X = one single post**, no thread.
- My voice: casual, a bit run-on, lowercase-ish bullets of uneven length, **no em-dashes**, no "not just X but Y" lines.
- The link goes in the first comment / reply, not in the post.
- Only use facts from this file, and respect "Don't overclaim".
- **Media:** a ~35 s video goes with this post (`post15-video-prompt.md`). The text shouldn't repeat what the video already shows.

Strongest angle for the one or two "learned" lines: **the model writes its own search query.** The old pipeline embedded the raw message, so "and who founded it?" searched for those exact words; the right passage won by 0.002 and mostly by luck. The agent searched for "who founded the Lantern Festival" and the right passage won clearly. Second option: **the agent part was the easy part; the 3-call limit, "answer now" with no tools, and every model turn sent back byte-for-byte were the real work.**

---

## What I built

Continuing **DocMind** (upload a PDF, chat with it, get quizzed on it, built from scratch to actually understand AI backends). This stretch covers Oct 29 → Nov 4: the second half of Phase 7. Phase 7 is now done and live.

### The problem

After post 14 the chat knew *what kind* of message it got, but a document question still ran one fixed recipe: embed the raw message, take the top 3 chunks, answer. That breaks on:
- follow-ups: "and who founded it?" has no "Lantern Festival" in it, so the search had nothing to go on
- two-part questions: one search for both parts
- "which documents do I have?": no chunk contains a list of your files

### What changed

- **Document questions go to an agent loop now.** Gemini gets two tools:
  - `searchDocuments({ query })`: the model writes the query itself
  - `listDocuments()`: your files, for "which documents do I have?"
- The model never gets a user id or document id. Those come from my code (the logged-in user and the current chat), so a tool can only ever see your own files, whatever the model or a PDF says.
- **Max 3 model calls**, and the last one is sent **without tools** so it has to answer with what it has. In practice every document question took 2 (search → answer).
- Bad tool arguments, an unknown tool name, or a tool that crashes all come back to the model as `{ error }` data instead of crashing the request. Tool args are checked with Zod, same as a request body.
- Past messages go to Gemini as real user/model turns with a system instruction, not pasted into one text blob.
- **Every step streams.** The chat shows what's happening instead of three dots: `Searching for "who founded the Lantern Festival"…`, `Checking your documents…`, then the sources, then the answer word by word.
- **"quiz me" gets an offer with a button.** The reply is written by code (0 model calls), with a **Create quiz** button (or **Choose a document** if you have several). The quiz is only generated when you click.
- Off-topic questions ("capital of France?") get "I only answer from your documents" now. Before, small talk happily said "Paris!".

### Things I learned / measured

- **Same 9 questions, old pipeline vs agent: 8/9 vs 9/9.** The old pipeline's follow-up only passed because the right chunk won by **0.002**. The agent searched "who founded the Lantern Festival" and the right chunk led clearly. A two-part question made **two searches in one step**.
- **Gemini wants every model turn back exactly as it sent it.** Each turn carries a `thoughtSignature`; send the tool-call turn back without it → 400. Streaming made it harder: the turn arrives in pieces and has to be rebuilt without touching those parts.
- **What's saved = what was streamed.** If the model writes a sentence and then calls a tool, that sentence is already on the user's screen, so it has to be in the saved answer too.
- `for await` silently drops a generator's return value. My streaming loop yields text and *returns* the finished turn, so the caller has to call `.next()` by hand.
- **Gemini's speed is all over the place.** Live check (Nov 4): status after **2.0 s**, sources **2.4 s**, first words **3.0 s**, every reply 1.7–3.4 s. Two days earlier the router's classifier call alone took 25–53 s.

### Gotchas (real ones)

- `mode: 'NONE'` (meaning "no tools now") is ignored by this model, so "answer now" = leave the tools out of the request entirely.
- Adding new stream events (`status`, `sources`, `action`) was safe only because the old frontend's event switch skips unknown events. I tested the pre-change frontend against the new API: it still answers, just without the new bits.
- The model writes keyword-soup queries sometimes ("height of the lighthouse lighthouse height Velmora"), and now users can see them in the status line.

---

## What's still missing

- A typed "yes" to the quiz offer doesn't start a quiz; you have to click. Remembering a pending offer between two requests is Phase 8 (suspend/resume workflows).
- The router still asks the LLM on most specific questions (4 of 7 messages on the live check), one extra call each.
- No automated test suite yet (Phase 9). Each step was tested by hand-written scripts against the real stack.
- 33 open issues in my own tracker, to fix in one go later.

## What's next

Phase 8: suspend/resume workflows. First case: "quiz me" → "yes" should work as a conversation, which means the server has to remember the offer between two requests.

## Numbers you can quote

- old pipeline vs agent on the same 9 questions: **8/9 vs 9/9**
- old follow-up won by **0.002**; the agent's rewritten query won clearly
- max **3** model calls per answer, the last without tools; real questions used **2**
- live: status **2.0 s**, sources **2.4 s**, first text **3.0 s**; replies **1.7–3.4 s**
- quiz offer: **0** model calls, offer in **1.7 s**, the quiz after the click in **2.0 s**
- tests: **26/26** with a fake Gemini (scripted stream bytes, 0 API calls), **18/18** over HTTP, **16/16** live

## Don't overclaim

- Two tools, one loop, max 3 calls. A small agent, not a framework, not multi-agent.
- 9 questions is a tiny comparison set (it included two trap sections on purpose). 8/9 vs 9/9 is not a benchmark.
- The live numbers are from one good day on the free tier; other days are much slower.
- "Can only see your own files" is enforced by my code passing the user id, not by the model behaving. That's the point, but don't phrase it as "the AI is secure".
- No automated test suite yet.
- I built it step by step with Claude Code as a pair programmer; every step was tested against the real stack before moving on.

## Hook ideas

- "asked my PDF chat 'and who founded it?'. it searched for 'who founded the Lantern Festival'"
- "my chat used to show three dots. now it shows what it's searching for"
- "the loop itself was small. the 3-call limit, 'answer now' and sending every turn back byte-for-byte were the actual work"
