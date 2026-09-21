# AI Backend Learning Journey — Day 9 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread) based on everything below. Tone: genuine, technical but accessible, real hands-on progress — not buzzwords, not "excited to announce." I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 9 — see `post1.md` through `post8.md` for continuity; post 7 ended by promising this phase ("a quiz needs to arrive as one complete, valid object"), and post 8 was the cleanup day before it. Only use facts from this file, and respect "Don't overclaim" — the honest version of today's story is better than an inflated one.

LinkedIn can be longer and narrative; Twitter can be a thread. Strongest angle: "my validation never failed in real use, so I tried to break it on purpose" — relatable and a little self-deprecating. Second best: "valid isn't the same as good."

---

## What I built today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz — built from scratch to actually understand AI backends). Today started **Phase 4: getting an LLM to return data, not prose.**

### The problem

Everything the AI produced so far was a paragraph for a human, and a slightly-off paragraph hurts nobody. A quiz has to be *data* — five questions, four options each, one marked correct — that code turns into buttons. Models are good at text and only *usually* right about exact shapes. A reply with three options, or `"correctIndex": "2"` (a string), or JSON wrapped in code fences won't fail loudly where it starts — it crashes a UI component far away and costs an hour debugging the wrong layer.

### The rule: ask, then verify — two separate jobs

1. **Ask** for the shape — in the prompt, or with Gemini's structured-output mode, which constrains the model to a schema.
2. **Verify** it with Zod (which I already use for request bodies). Same tool, aimed the other way: the AI is just another untrusted client, and nothing it sends is used until it's checked.

```ts
const QuizQuestion = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),        // exactly 4
  correctIndex: z.number().int().min(0).max(3),         // a whole number, 0–3
}).refine((q) => new Set(q.options).size === q.options.length,
  { message: 'options must all be different' })         // a rule types can't express

const Quiz = z.array(QuizQuestion).length(5)
```
One schema gives both the runtime check *and* the TypeScript type, so they can't drift apart. I also wrote a new way to pick text: chat searches for chunks nearest to a *question*, but a quiz has no question — so it samples chunks **spread evenly across the whole document**.

### The experiment — and an honest result

A script asks Gemini for the same 5-question quiz two ways (plain prompt vs structured-output mode), several times each, and runs every reply through a two-stage check: is it JSON, then is it the *right* JSON.

**Every real reply was valid, in both modes — 17 out of 17 each.** The model almost never goes off-shape. Which meant my validation had nothing to catch, and I couldn't tell whether it worked at all.

So I tried to break it on purpose: a "bad-reply gallery" of ten deliberately broken replies — JSON in code fences, a chatty sentence before the JSON, only three questions, three options, the index as `"2"`, an index of 4, an index of 1.5, duplicate options, a missing field, an object instead of an array — plus one good one, all run through the same checker with no API calls. **It caught all ten, each with the exact reason** (like `0.correctIndex: expected number, received string`). Validation you've never seen fail is validation you can't trust yet.

### Valid isn't the same as good

Zod proves the *shape*, not the *sense*. So the script also counted where the model puts the correct answer across 50 questions: positions 0, 1, 2, 3 came out **22% / 36% / 32% / 10%**. Not stuck on the first option, but the last slot barely gets used — and a predictable answer position makes a weaker quiz. The fix belongs in code, not in a plea to the model: shuffle the options after validating.

### A small scare

Midway, my database calls started failing with `ENOTFOUND`. It looked like my code; it was my network's DNS server refusing to look up the database's hostname — another DNS server resolved it instantly. Half of debugging is proving it isn't your code.

## The bigger takeaway

Don't trust the AI's output — and, more importantly, don't trust *your own safety net* until you've watched it catch something. My validation passing 17 times proved nothing; it could have been a check that accepts everything. Making it fail on purpose turned a hope into evidence. And the position finding is the same lesson one level up: "valid" is a low bar. The parts that must be reliable — here, where the right answer sits — should be controlled by code, not left to the model's habits.

## What's next

Turn the script into a real `POST /quiz` endpoint: validate the reply, retry once if it's bad, shuffle the options, then a "Generate quiz" button in the UI.

---

## Numbers you can quote
- **17/17** real replies valid, in both modes
- **10/10** deliberately broken replies caught, each with a precise reason
- **22 / 36 / 32 / 10%** — where the correct answer landed (positions 0–3, 50 questions)
- The whole quiz shape in one schema: 5 questions × 4 options

## Don't overclaim
- There's **no quiz endpoint or UI yet** — today was a standalone script that proves the approach.
- The model was 100% valid in my runs, so I can't claim validation "saved" real output. It's insurance; the gallery shows what it *would* catch.
- The answer-position skew is one 50-question run — a sample, not a benchmark.
- Checked by running the script by hand; no automated tests yet. The DNS problem was my network, not a code fix.

## Hook ideas
1. "My validation never failed, so I tried to break it on purpose."
2. "The AI's quiz was perfectly valid JSON — and the right answer sat in the last slot 10% of the time."
3. "Ask for a shape. Then verify the shape. Two different jobs."
4. "My database 'broke.' It was my network's DNS the whole time."
