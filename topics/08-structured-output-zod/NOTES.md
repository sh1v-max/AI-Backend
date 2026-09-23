# 08 — Structured Output (Zod)

Roadmap: Phase 4

## What is it?

Making the AI give back data instead of a paragraph. Up till now every answer from the model was just text for me to read. A quiz can't be text, it has to be a real object: 5 questions, 4 options each, one marked correct, so the frontend can actually turn it into buttons.

The core idea is two separate jobs, not one. Ask the model nicely for a shape (either in the prompt, or by turning on Gemini's structured output mode), then actually check what came back with Zod before trusting it. Asking nicely makes it likely. Checking makes it certain. Skipping the check is the mistake, even if the model is right almost every time.

## Key facts

- Zod isn't a new tool, it's the same thing I already use for validating request bodies, just pointed at the model's output instead of a user's. The AI is basically just another client I don't trust blindly.
- The schema: exactly 5 questions, exactly 4 options per question, correctIndex has to be a whole number 0 to 3 (not the string "2", not 1.5), and a `.refine()` rule that all 4 options are actually different from each other.
- `safeParse` instead of `parse`, so a bad reply returns a result object instead of throwing, easier to branch on inside a route.
- Real testing on `gemini-flash-lite-latest`: it was valid 17 out of 17 times, both with a plain prompt and with structured output mode turned on. So the model barely ever slips here, which is honestly a bit of an anticlimax after being told to expect occasional garbage.
- Because it almost never fails on its own, I built a "bad reply gallery", a bunch of hand written broken replies (wrapped in code fences, a friendly sentence before the JSON, wrong option count, string instead of number, etc) run through the checker with zero API calls, just to actually watch it catch something.
- Valid isn't the same as good. Zod checks the shape is right, it says nothing about whether the content makes sense. I measured where the model puts the correct answer across 50 questions and it wasn't even, one slot got picked way less than another (roughly 36% vs 10%). So I don't trust the model to be fair about that either, the options get shuffled in code after validating, and correctIndex gets remapped to match.
- A quiz can't be built the same way chat answers are. Chat searches for the chunks closest to a question. A quiz has no question, so instead I grab chunks spread evenly across the whole document, so it actually covers the material instead of one lucky paragraph.
- Production habit: validate, then retry exactly once if it's wrong, then give up cleanly with a real error instead of looping forever or crashing. Two attempts max.
- Decided not to build a `POST /quiz/check` endpoint at all. The quiz never gets saved anywhere on the server, so there's no independent copy of the correct answers to check against, a check endpoint would just be the server comparing two numbers the browser already has. Grading happens entirely in the frontend instead. Felt like the honest call instead of building an endpoint that can't actually enforce anything.

## Questions / things that felt unclear

- Still not fully sure how different structured output mode is under the hood from just asking nicely in the prompt, both worked equally well in my testing, so I can't really say from experience which one Gemini leans on harder internally.
- If I ever do need real anti-cheat grading (quizzes stored server side with an id), not sure yet what the smallest version of that looks like without adding a whole new table just for one feature.
