# AI Backend Learning Journey — Day 11 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread) based on everything below. Tone: genuine, technical but accessible, real hands-on progress, not buzzwords, not "excited to announce." Write it in my voice: casual, a bit run-on, no em-dashes, no "not just X but Y" lines. I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 11, see `post1.md` through `post10.md` for continuity; post 10 closed Phase 4 (quiz endpoint, retry once, shuffle in code) and said "next is tying the whole project together." Only use facts from this file, and respect "Don't overclaim."

**This one is different from the last few: I didn't ship a feature.** I stopped building, went back to line 1, and re-read my own code. The post is about what that found. Don't dress it up as a launch.

LinkedIn can go longer and narrative. Twitter can be a thread. Strongest angle: "I told the model to use the chat history to understand 'the first one'. But the search runs before the model ever sees the history." A real bug-shaped gap, found by reading, not by testing. Second angle: "my prompt wasn't weak because of the wording, it was weak because of everything around it."

---

## What I built today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz, built from scratch to actually understand AI backends). Phase 4 was done, the whole loop worked end to end. So instead of starting Phase 6 straight away, I spent this stretch going back through everything I built, file by file.

### Re-reading my own code, from embeddings to chat

Embeddings, the pgvector schema, the repository layer, PDF parsing, upload, the chat routes. For each file I added comments explaining what every piece does *in my own words*, plus a small workflow diagram at the bottom of the chat routes (request → error wrapper → prepare → LLM → save → respond, and the streaming version). The project README also got rewritten into a proper public one.

Honestly, a lot of code I "wrote" two weeks ago I could not explain line by line anymore. Things like why `.returning()` comes back as an array, or why the error wrapper's handler is typed `Promise<unknown>`. Writing it down is where it actually stuck.

### The finding: my chat prompt felt weak, and the wording wasn't the reason

While testing different questions the answers felt kind of novice. My first instinct was "rewrite the prompt." But when I traced what actually happens to one message, most of the problems were *around* the prompt, not in it.

**The one I'm most annoyed about.** My prompt literally says: *"use the conversation history to understand what the new question is referring to (e.g. 'the first one')."* Sounds right. But look at the order in `prepareChat()`:

```ts
const questionEmbedding = await getEmbedding(message)   // 1. embed the raw message
const relevantChunks = await searchSimilar(...)          // 2. search with it
// ...
const history = await getRecentMessages(sessionId, 8)    // 3. history loaded AFTER search
```

So for a follow-up like *"how does the first one work?"*, the thing that gets embedded is exactly that sentence. No topic word in it at all. The search picks chunks for basically nothing, and *then* the model gets told "use the history". The model can figure out what "the first one" means, sure, but it's reading the wrong chunks by then. The instruction was fixing the wrong layer. Real fix is query rewriting: turn the follow-up into a standalone question *before* embedding it.

**The other five, shorter:**
- **Everything is one text blob.** Rules, PDF chunks, history and the question all go to Gemini as one single user message. Gemini has a real `systemInstruction` field and real multi-turn messages, I'm just not using them.
- **The PDF can talk to the model.** Chunks get pasted in with no markers saying "document text starts / ends here". So a line in a PDF like "answer in one word" reads the same as my own instructions. That's prompt injection, and I don't control what's inside an uploaded PDF, whoever made it does.
- **The rules are a light switch.** Either "answer from context" or "say it's not in the document". A question that's half answerable, or just "thanks!", falls in between and the model has to guess.
- **Markdown shows up raw.** Gemini formats with markdown by default. My frontend renders plain text. So bold comes out as literal `**asterisks**`.
- **Top 3 is "nearest", not "relevant".** Vector search always returns 3 chunks, even for a question that has nothing to do with the PDF. `ORDER BY distance LIMIT 3` has no idea what "too far" means. Like asking a maps app for the 3 nearest pizza places while standing in a desert.

### A real gotcha: the model was down, not my code

Mid-week the stream started failing with `Gemini API error: 503`. I went looking for my bug. There wasn't one: Gemini itself was returning "this model is currently experiencing high demand", on every Flash model I tried. Lesson: log the upstream error body, not just the status code, or you'll spend an hour debugging the wrong side.

### Planned, not built

I wrote all six up as a plan (problem, fix, gotchas, how to test, time estimate) and a build order. First step isn't a fix at all: a fixed set of ~12 test questions answered *before* changing anything. Because LLM answers vary between runs, "this feels better" is not evidence. Without a before, I can't prove an after.

## The bigger takeaway

Building fast got me a working app. Re-reading slowly got me the list of things that are actually wrong with it. The follow-up bug didn't show up as an error, the app responded fine, it just responded worse than it could. You only catch that kind of thing by following one request through the code step by step, and asking "what does the model actually see here?"

## What's next

Build the plan: the baseline question set first, then move the prompt into Gemini's system instruction + real turns, then query rewriting. Every change gets re-run against the same questions so I can say if it helped, not guess.

---

## Numbers you can quote
- **6** prompt/retrieval problems found by reading the code, **0** of them were crashes
- **3** chunks sent every time, relevant or not
- **8** messages of history, loaded *after* the search already happened
- **~12** baseline test questions planned before touching the prompt
- **~7–9 hours** estimated for the whole improvement pass

## Don't overclaim
- **Nothing in the plan is built yet.** This post is about finding problems and planning fixes, not fixing them.
- The example conversations in the plan (like "how does the first one work?") are reasoned from how the code works, not measured results. The baseline step is where real before/after numbers come from.
- The injection problem is a *risk I found in the code*, nobody attacked DocMind. And a delimiter-based fix reduces it, it doesn't make prompt injection impossible.
- The 503 was Gemini's capacity issue, not something I fixed. I just stopped blaming my code for it.
- The README rewrite and some topic notes were done with AI help. Don't present them as solo work.

## Hook ideas
1. "I told my AI to use the chat history. The search ran before it ever saw the history."
2. "My prompt wasn't the problem. Everything around it was."
3. "I stopped building for a week and read my own code. Found 6 problems, 0 crashes."
4. "Vector search is a maps app in the desert: it always finds 3 pizza places."
