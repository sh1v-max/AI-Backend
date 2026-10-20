# 10 — Agents & Tool Calling

Every message DocMind gets today goes down the same road: embed it, search the top 3 chunks, load history, build one big prompt, generate. That road is right for "what does section 2 say?" and wrong for almost everything else. "hi" triggers a vector search. "and the second one?" is searched as-is, so it finds junk. "Which documents do I have?" can't be answered by chunk search at all. "Quiz me" gets a chat answer *about* quizzes. This topic is how real AI backends fix that: **decide what to do before doing it**, and when the right action needs information, let the model *ask* for it through a tool that your code runs.

---

## How to read this topic

1. **This file** (15 min): the ideas and the vocabulary.
2. **[More_on_Agents_Tool_Calling.md](More_on_Agents_Tool_Calling.md) Part 1, §1–§23** (the concepts): routing, the tool-calling round trip, the agent loop, Kind A vs Kind B, failure modes, interview answers.
3. **The same file, Part 2, §24–§32** (the building blocks the build actually uses): real multi-turn requests, thought signatures, function calls inside a stream, async generators that *return* something, cosine similarity for routing, how to evaluate a router, prompt injection through tool results, the quiz button, and the free-tier math.
4. **[agents-plan.md](../../agents-plan.md)** last: the build plan (AG.0 → AG.7) for DocMind specifically. It assumes you've read 1–3.

---

## The idea: a fixed pipeline vs a decision

```
TODAY (fixed pipeline):
  every message ──► embed ──► search ──► history ──► prompt ──► generate

AFTER (decide first):
  message ──► ROUTER ──┬── smalltalk ─────────► one short reply, no search
                       ├── quiz_request ──────► code proposes a quiz, user clicks, code makes it
                       └── document_question ─► AGENT: the model picks tools, code runs them
```

Two separate ideas live in that picture, and it's worth keeping them apart:

- **Routing** = *classification*. Code asks "which kind of message is this?" and then runs a path **written in code**. The model only labels. You already know both ways to classify: structured output with Zod (topic 08) and vector similarity (topics 01–02).
- **Tool calling** = the model is told which functions exist, and instead of answering it can reply *"please call `searchDocuments({ query: 'pricing tiers' })`"*. **Your code** runs the function and sends the result back; the model then answers. The model never runs anything.

## The words you'll need

- **Tool / function declaration:** a name, a description (this *is* the prompt for when to use it), and a JSON schema for its arguments. Sent with every request.
- **Function call:** the model's reply part that says "call X with these args". It's a request, not an action.
- **Function response:** your code's reply part that says "X returned this". It goes back to the model in the next request.
- **Agent:** an LLM in a loop with tools, with **code deciding when to stop**. That's the whole definition. No magic, no autonomy beyond what you hand it.
- **Kind A tool:** read-only and cheap, safe if called at the wrong moment (search, list). The model may call it on its own.
- **Kind B action:** has a side effect or spends real quota (create a quiz, delete a file, send an email). The model is **never given it as a tool**. It can only propose; a human confirms; code acts.
- **Agentic RAG:** retrieval as a tool, so the model writes its own search query (after reading the history, which fixes "the second one").

## How a tool call actually travels

```
1. YOU   → model:  system rules + history + message + tool declarations
2. MODEL → you:    functionCall { name: "searchDocuments", args: { query: "pricing tiers" } }
3. YOU:            validate args (Zod), run the REAL function, scoped to req.user.id
4. YOU   → model:  everything from step 1 + the model's call (unchanged) + functionResponse { results }
5. MODEL → you:    the answer text (or another functionCall → back to 3, max N times)
```

The API remembers nothing between requests (same as chat memory in topic 06), so step 4 resends the whole conversation, *including the model's own function-call turn, exactly as it came back*.

## How this fits the code you already have

- **The router reuses Phase 1 math.** `prepareChat()` already embeds every message. Comparing that vector against a few example phrases per intent is the same cosine similarity you did in a JS loop in topic 01, so the cheap router costs zero extra API calls.
- **The LLM router reuses Phase 4.** "Classify this message, respond with `{ intent }`" is structured output + Zod, exactly like the quiz, just a smaller schema.
- **The tools wrap repositories you already have.** `searchDocuments` = `getEmbedding` + `searchSimilar`; `listDocuments` = `listDocuments(userId)`. Both already take a required `userId` (auth), so a tool physically can't read another user's data.
- **`llm.service.ts` is the real work.** It only knows "one prompt string in, one text out". Tool calling needs real turns with roles, a system instruction, tool declarations, and the *whole* reply back (not just `parts[0].text`).
- **The SSE stream grows.** Today `meta` carries the sources first, because search always runs before generation. With a tool, sources only exist after the model decided to search, so they move to a new `sources` event, and a `status` event ("Searching rag_guide.pdf…") replaces part of the waiting dots.
- **`generateQuiz()` stays exactly as it is.** It becomes the Kind B action behind a "Create quiz" button.

## Things that will bite you (worth knowing before you hit them)

- **Letting the model supply scope.** If `searchDocuments` had a `documentId` parameter, text inside a PDF could steer it. Identity and scope come from the server and are closed over by the tool. (The roadmap's `searchDocument(documentId, query)` signature is deliberately not what DocMind builds.)
- **Changing the model's turn before sending it back.** Newer Gemini models attach `thoughtSignature`s to reply parts; drop or rebuild them and the next request fails.
- **The model skipping the tool and answering from memory.** The system instruction has to say "for any question about the documents you must search first".
- **Loops.** A model that keeps searching burns quota and hangs the request. Cap the steps (3).
- **Classifying a follow-up without history.** "why?" means nothing alone; a vector router can't see history, which is why close calls go to the LLM classifier.
- **Twice the calls on a free tier.** A document question goes from 1 generate call to 2. Know your per-minute limit (AI Studio).
- **Google's function-calling guide now documents a newer "Interactions API"** with different field names (`steps`, `function_call`, `tool_choice`). DocMind uses `generateContent`; use the API reference's names (`functionDeclarations`, `functionCall`, `functionResponse`, `toolConfig`), listed in agents-plan.md §13.

## Where this connects

```
01/02 embeddings + vector search → the vector router is vector search over 3 intents instead of thousands of chunks
06 conversation memory           → history becomes real user/model turns instead of lines pasted in a prompt
07 streaming                     → the stream now carries status + sources events between tool steps
08 structured output             → the LLM router; tool arguments validated with Zod like any model output
10 (here)                        → routing, tools, the agent loop, Kind A vs Kind B
11 workflows                     → Kind B with a typed "yes": the pending quiz is stored and resumed
12 testing                       → the router and the loop are tested with a scripted fake model
advanced/06 LLM security         → prompt injection through tool results
```

---

## What you need to learn

- [ ] **Workflow vs agent** — who chooses the path, code or the model, and why "simplest thing that works" usually wins
- [ ] **Routing = classification** — the LLM way (structured output) vs the vector way (cosine over example phrases), and the hybrid
- [ ] **The tool-calling round trip** — declaration → function call → your code runs it → function response → answer, and why it's at least two model calls
- [ ] **The agent loop** — and the three things that make it safe: a step cap, a whitelist, errors returned as data
- [ ] **Tool arguments are untrusted input** — and why scope/identity never come from the model
- [ ] **Kind A vs Kind B** — "if the model called this at the wrong moment, could I undo it for free?"
- [ ] **Why agentic RAG fixes follow-ups** — the model writes the search query after reading the history
- [ ] **What changes when a stream contains tool calls** — sources arrive late, status events appear
- [ ] **What it costs** — calls per message before and after, on a free tier

## What to build

Full detail, tests and decisions in [agents-plan.md](../../agents-plan.md). In short:

**AG.0** — a probe script: one fake tool, the raw round trip against the real model, streamed and not, so you *see* the JSON instead of trusting docs.

**AG.1 + AG.2 (roadmap 7.1 + 7.2)** — both routers, measured on ~40 labelled messages; the hybrid goes live in `/chat`, and smalltalk skips the search.

**AG.3 + AG.4 (roadmap 7.3)** — the agent for document questions with `searchDocuments` + `listDocuments`; history as real turns; streamed, with `status` and `sources` events in the UI.

**AG.5 (roadmap 7.4)** — "quiz me" → a code-written proposal + a "Create quiz" button → the existing `POST /quiz`.

## Resources

- [Gemini API reference – generateContent](https://ai.google.dev/api/generate-content) — `Content`, `Part`, `FunctionCall`, `FunctionResponse`, `Tool`, `FunctionDeclaration`, finish reasons (the field names DocMind uses)
- [Gemini API reference – ToolConfig](https://ai.google.dev/api/caching) — `functionCallingConfig.mode`: `AUTO` / `ANY` / `NONE` / `VALIDATED`
- [Gemini function calling guide](https://ai.google.dev/gemini-api/docs/function-calling) — the concepts are right, but its code uses the newer Interactions API; don't copy field names from it
- [Gemini thinking guide – signatures](https://ai.google.dev/gemini-api/docs/thinking#signatures) — what a thought signature is and why it goes back unchanged
- [Anthropic – Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) — workflows vs agents, routing, "start with the simplest thing"; provider-neutral and the best single read on *when* to use an agent
- [ReAct paper (Yao et al., 2022)](https://arxiv.org/abs/2210.03629) — the original "reason + act" loop that native tool calling now builds in (the abstract and figure 1 are enough)

## After you finish

Fill in [NOTES.md](NOTES.md) — specifically, be able to explain out loud: (1) what an agent is in one sentence, (2) why the model never gets a `createQuiz` tool, and (3) why `searchDocuments` has no `documentId` parameter. If an interviewer asks "how do you keep an agent safe?", those three answers are the answer.
