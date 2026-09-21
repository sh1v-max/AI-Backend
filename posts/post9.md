# Post 9 — Source notes

Source notes for a LinkedIn post and a Twitter/X post. Only use facts from this file.

**Project:** DocMind — upload a PDF, chat with it (with memory), watch the answer stream in live. Built from scratch to understand how AI backends work: Node + TypeScript + Express, Postgres/pgvector, Drizzle, Gemini, React. No AI framework.

**Where things stand:** chat, memory, streaming and multi-document search are done. Today started **Phase 4: generating a quiz from a PDF**.

---

## What I did today

**1. Started Phase 4 — making an LLM return *data*, not prose**
- So far the AI's answers were paragraphs for a human to read. A quiz has to be data: 5 questions, 4 options each, one marked correct, so code can turn it into buttons. Models are good at text but only *usually* right about exact shapes.
- Rule I built around: **never use model output until it's been checked.** I used Zod (already know it for validating request bodies) — the AI is just another untrusted client.
- The schema: exactly 5 questions, exactly 4 options each, `correctIndex` must be a whole number from 0 to 3, and a custom rule that all 4 options must be different. One schema gives both the runtime check *and* the TypeScript type.
- Two separate jobs: **ask** for the shape (in the prompt, or with Gemini's structured-output mode) and **verify** it (Zod). I compared both ways of asking, several runs each.
- A quiz needs a different way of picking text than chat: chat searches for the chunks nearest to a *question*; a quiz has no question, so it needs chunks **spread evenly across the whole document**.

**2. Made the failures visible**
- Real runs: **every reply was valid, in both modes — 17 out of 17 each.** The model almost never goes off-shape, so Zod had nothing to catch.
- So I added a "bad-reply gallery": 10 deliberately broken replies (JSON in code fences, a chatty sentence before the JSON, only 3 questions, 3 options, the index as the string `"2"`, an index of 4, duplicate options, a missing field...) plus one good one, run through the same checker with no API calls. **It caught all 10, each with the exact reason.**

**3. Found that "valid" isn't "good"**
- Zod proves the *shape* is right, not that the *content* is sensible. I counted where the model puts the correct answer across 50 questions: position 0/1/2/3 came out **22% / 36% / 32% / 10%**. Not terrible, but a quiz with a predictable answer position is a weaker quiz.
- Fix planned: shuffle the options in code after validating, instead of trusting the model.

**4. Wrote the notes**
- Reading guides for the next two topics (structured output, and background jobs with a queue) and a short note on what I learned about streaming.

---

## Numbers
- **17/17** real replies valid in both modes
- **10/10** deliberately bad replies caught by the checker
- **22 / 36 / 32 / 10%** — where the correct answer landed (positions 0–3, over 50 questions)
- 5 questions × 4 options: the whole shape in one schema

## Lessons (quotable)
- "Ask for a shape. Then verify the shape. They're two different jobs."
- "Treat the AI like any other untrusted client: validate what it sends you."
- "My validation never failed — so I wrote replies that break it on purpose to prove it works."
- "Valid isn't the same as good. The JSON was perfect; the correct answer was in slot 1 a third of the time."
- "A quiz has no question — so similarity search is the wrong tool. Sample the whole document instead."

## Small stuff (optional, good for a light tweet)
- Mid-task my database calls started failing with `ENOTFOUND`. Not a bug in my code — my network's DNS server refused to look up the database's hostname; another DNS server resolved it instantly. "Half of debugging is proving it isn't your code."

## Don't overclaim
- There's no quiz endpoint or UI yet — today was a standalone script that proves the approach. The endpoint, a "retry once if invalid" step, the option shuffling and the buttons come next.
- The model was 100% valid in my runs; I can't claim Zod "saved" real output. The point is it's insurance, and the gallery shows what it would catch.
- Checked manually by running the script; no automated tests yet.

## Next
Turn the script into a real `POST /quiz` endpoint: validate → retry once if the reply is bad → shuffle the options → then a "Generate quiz" button in the UI.

## Hook ideas
1. "My validation never failed, so I tried to break it on purpose."
2. "The AI's quiz was perfectly valid JSON — and the right answer was in slot 1 a third of the time."
3. "Ask for a shape. Then verify the shape. Two different jobs."
4. "My database 'broke.' It was my network's DNS the whole time."
