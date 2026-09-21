# 08 — Structured Output (Zod)

Everything DocMind's LLM has returned so far is *prose* — a paragraph a human reads in a chat bubble. That's fine when the consumer is a person. It stops being fine the moment the consumer is **code**: a quiz has to become five question cards with four radio buttons each, and one of them has to be marked correct. You can't render that from a paragraph. This topic is how you make an LLM hand back **reliable, machine-readable data** instead of free text.

---

## The problem: LLMs are good at text and unreliable at exact shapes

Ask a model "give me 5 multiple-choice questions as JSON" and most of the time you get exactly that. Some of the time you get:

- JSON wrapped in a markdown fence (` ```json ... ``` `) so `JSON.parse` throws
- a friendly sentence before the JSON ("Sure! Here's your quiz:")
- `options` with 3 entries, or 5
- `correctIndex` as the string `"2"` instead of the number `2`, or `4` when the options only go up to index 3
- a missing field, or an extra one

None of these are "the model is broken" — it's just generating likely text, and "likely" isn't "guaranteed". If your code trusts the output blindly, the failure shows up far from the cause (a UI crash on `options[undefined]`), and you'll spend an hour debugging the wrong layer. **Structured output is the discipline of never trusting model output until it's been checked.**

## The two halves: ask for a shape, then verify the shape

**1. Ask for it (make the right output likely).** Two ways, and you'll use both:
- **In the prompt** — describe the exact JSON shape and say "respond with only JSON". Works most of the time.
- **With the API's structured-output mode** — Gemini lets you set `generationConfig.responseMimeType: 'application/json'` plus a schema (`responseSchema`) so the model is *constrained* to that shape. That makes malformed JSON much rarer. (Field names have shifted over time — check the current [structured output docs](https://ai.google.dev/gemini-api/docs/structured-output) rather than trusting this file.)

**2. Verify it (make the wrong output impossible to slip through).** This is Zod's job, and it's the half that *isn't optional* — even a constrained model can return JSON that matches the schema's *types* but is wrong in *meaning* (e.g. `correctIndex` points at an option that isn't actually the right answer; Zod can't catch that, but it does catch the shape problems above, and you should still sanity-check meaning where you can).

You already know Zod from validating request bodies. **This is the exact same tool aimed the other way** — instead of validating what a *user* sent you, you validate what the *model* sent you. The model is just another untrusted client.

## Zod in the shape you'll actually use

```ts
import { z } from 'zod'

const QuizQuestion = z.object({
  question: z.string().min(1),
  options: z.array(z.string()).length(4),        // exactly 4
  correctIndex: z.number().int().min(0).max(3),  // 0..3, a whole number
})

const Quiz = z.array(QuizQuestion).length(5)      // exactly 5 questions

type Quiz = z.infer<typeof Quiz>                  // the TypeScript type comes for free
```

- **`.parse(data)`** — returns the typed data, or **throws** a `ZodError` that says exactly which field failed and why. Good in a script.
- **`.safeParse(data)`** — never throws; returns `{ success: true, data }` or `{ success: false, error }`. Better in a request handler where you want to branch (retry, or return a clean error).
- **`z.infer<typeof Quiz>`** — one schema gives you the runtime check *and* the TypeScript type, so they can never drift apart.

## The pattern to remember: validate, and retry once on failure

Because some fraction of responses will be off-shape, the production habit is:

```
call the model → strip code fences if present → JSON.parse → Quiz.safeParse
   ├─ success → return it
   └─ failure → call the model ONE more time → parse again
                   ├─ success → return it
                   └─ failure → return a clean error (don't loop forever, don't crash)
```

Two details that matter: **cap the retries** (one is enough for a learning project — an unbounded loop can burn your free-tier quota and hang a request), and **log the failure** (the raw model text and the Zod error) so you can see *what* it got wrong — that's how you improve the prompt.

## This is not the same job as `/chat`

| | `/chat` | `/quiz` |
|---|---|---|
| Output | prose, streamed | one complete, valid JSON object |
| Streaming? | yes — words as they arrive | **no** — half a JSON object is useless, so you wait for all of it |
| Which chunks? | the few *most similar to the question* (similarity search) | a *broad spread across the whole document* (no search — there's no question) |
| Failure mode | a slightly off answer | malformed data that breaks the UI |

That third row is a real design point: `searchSimilar()` answers "what's relevant to *this question*?" A quiz has no question, so you need a **different repository function** that pulls several chunks spread across the document (for example, evenly spaced through the stored chunks) so the quiz covers the whole thing instead of one section.

## Where this connects

```
07 streaming    → free-form text arrives progressively
08 (here)       → structured JSON arrives complete, and is verified
10 agents       → the same trick decides *what to do*: force the model to output
                   { intent: "document_question" | "smalltalk" | "quiz_request" }
                   and route on it — structured output as a control signal
```

The intent-classification step in Phase 7 (Step 7.1) reuses this exact pattern, so it's worth getting comfortable with it here.

---

## What you need to learn

- [ ] **Why model output can't be trusted** — it's likely text, not guaranteed text; list the ways a quiz response can be malformed
- [ ] **Ask + verify are two separate jobs** — prompting/structured-output mode makes the right shape likely; Zod makes a wrong shape impossible to slip through
- [ ] **A Zod schema** for the quiz, and the difference between `.parse` (throws) and `.safeParse` (returns a result)
- [ ] **`z.infer`** — one schema gives you both the runtime validation and the TypeScript type
- [ ] **Validate → retry once → fail cleanly** — and why you cap retries
- [ ] **Why a quiz doesn't stream** and why it needs a different chunk-selection function than chat

## What to build

**Step 4.1** — a standalone script (no endpoint yet). Define `QuizQuestion` and `Quiz`. Pull a few stored chunks for one document, prompt Gemini to return 5 multiple-choice questions as JSON, and check the result with `Quiz.parse(...)`. Run it 3–4 times and look at what Zod catches — try it once with a plain prompt and once with Gemini's structured-output mode and compare how often each goes off-shape. You'll need `npm install zod` first.

**Step 4.2** — `POST /quiz` with a `documentId`. Add the repository function that samples chunks across the whole document, run the 4.1 prompt + schema, and add the validate-then-retry-once logic. Follow the layering already in the project: a thin route, a `quiz.service.ts` that does the work (and never touches `req`/`res`), and the new query in `chunks.repository.ts`.

**Step 4.2F** — a "Generate quiz" button (shown when a single document is selected) that calls `/quiz` and renders each question with its 4 options as radio buttons.

**Step 4.3 / 4.3F** *(optional)* — `POST /quiz/check` to grade an answer, and the UI feedback for it.

## Resources

- [Zod docs](https://zod.dev/) — the basics page is enough; you already know most of it
- [Gemini API docs – Structured output](https://ai.google.dev/gemini-api/docs/structured-output) — how to constrain a response to a schema (check current field names)

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, be able to explain in your own words why you validate the model's output even when you asked for JSON, and why the quiz endpoint retries once instead of retrying until it works. If someone asks "how do you make an LLM return reliable data?", that pair of answers *is* the answer.
