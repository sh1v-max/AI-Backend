# AI Backend Learning Journey — Day 10 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread) based on everything below. Tone: genuine, technical but accessible, real hands-on progress, not buzzwords, not "excited to announce." I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 10, see `post1.md` through `post9.md` for continuity; post 9 ended with "next: turn the script into a real endpoint." Only use facts from this file, and respect "Don't overclaim."

**Keep this one backend-heavy.** Today also included frontend work (a quiz UI, an answer-checking screen), but deliberately don't build the post around it, mention it only briefly as "closing the loop." The real story is the API design: retry logic, structured output, and turning yesterday's data into today's code.

LinkedIn can go longer and narrative. Twitter can be a thread. Strongest angle: "yesterday's measurement became today's code" — the shuffle-in-code decision is a direct, provable response to data from the last post, not a guess. Second angle: choosing *not* to build an endpoint the plan called for, and being able to explain exactly why.

---

## What I built today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz — built from scratch to actually understand AI backends). Yesterday proved the approach in a throwaway script. Today it became a real endpoint: `POST /quiz`.

### Turning a script into an endpoint that can fail safely

The script from yesterday assumed a happy path. An endpoint can't. Three things had to be added:

**Validation with a real reason behind it.** A missing document id is an obvious 400. Less obvious: I also reject a request for "all documents." A quiz samples one document's text in reading order, start to finish. There's no single "reading order" across five unrelated PDFs, so instead of silently generating a nonsense quiz, it fails clearly and says why.

**Retry once, then fail honestly.** Ask for a quiz, validate the reply with Zod. If it's wrong, try exactly one more time. If that fails too, don't loop, don't hang, return a clean error a UI can actually show. Two attempts, never more — burning API calls chasing a reply that isn't coming helps nobody.

**Data from yesterday became a design decision today.** Yesterday's testing found the model doesn't place the correct answer evenly across four options, it landed in slot 1 more than slot 4 (36% vs 10%, roughly). That's not a guess I could prompt away reliably. So today, every validated quiz gets its options **shuffled in code** before it's sent out, and the "correct" index gets remapped to match. The part of the system that has to be reliable is now controlled by code, not model habit. Measured a problem yesterday, fixed it in code today.

### Not repeating myself

Yesterday's prompt-building and reply-checking logic used to live only in the throwaway script. Today both the script and the real endpoint call the same functions. One implementation, not two copies quietly drifting apart.

### Closing the loop, briefly

The other half of today was making the quiz actually visible and answerable in the app, plus a way to check your answers. One decision from that work is worth mentioning even in a backend-focused post: I didn't build a `/quiz/check` API endpoint. Quizzes aren't stored anywhere server-side, so a "check my answer" endpoint would just be the server comparing two numbers the browser already has, with nothing stopping the browser from lying about them either way. Grading happens client-side instead. Building an endpoint that can't actually enforce anything isn't a real feature, it's decoration.

## The bigger takeaway

The useful part of yesterday's experiment wasn't "it mostly worked." It was finding the one place it was predictably imperfect, and turning that into a specific line of code today. That's the difference between testing something and *learning* something from the test. And the decision to skip an endpoint is the same instinct pointed at scope: build the thing that's actually trustworthy, not the thing that was merely on the plan.

## What's next

Phase 4 is done, top to bottom, generate a quiz, answer it, get graded, all working. Next is either tying the whole project together and writing it up, or moving on to background jobs so a large PDF upload doesn't block the request.

---

## Numbers you can quote
- **2** attempts max per quiz (one real try, one retry, then a clean failure)
- **5** questions, shuffled per question, before every response goes out
- Yesterday's measured skew (**36% vs 10%** on two of the four answer slots) directly justified today's fix
- **1** shared implementation now, instead of 2 copies of the same prompt/checker logic

## Don't overclaim
- The quiz endpoint doesn't stream, it waits for the complete, validated result before responding, which is correct for this use case but worth being precise about if asked.
- Skipping the check endpoint is the right call *for now* — a version worth trusting would need quizzes stored server-side, which wasn't built today.
- No automated tests yet, this was verified by hand, with real requests and a real browser.

## Hook ideas
1. "Yesterday's data became today's code."
2. "I built an API endpoint on purpose to not build another one."
3. "Retry once. Then fail honestly. Never loop forever."
4. "The model doesn't place the right answer evenly. So I stopped letting it decide."
