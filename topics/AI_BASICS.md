# AI Basics — Everything in One Place

The foundation under every other file in this folder. One pass through the vocabulary and ideas an AI backend developer is expected to know: what a model is, tokens, context windows, embeddings, sampling settings, RAG, agents, cost, evaluation, safety.

Each section is short on purpose. Where a topic has its own deep-dive, there's a link.

Exact numbers (prices, context sizes, rate limits, model names) change every few months. This file teaches the ideas; look up current numbers on the provider's site before quoting any.

---

# PART 1 — WHAT THESE THINGS ARE

---

# 1. AI, ML, Deep Learning, GenAI, LLM

Nested terms. Each is a subset of the one before.

```text
AI                    any system that does something "intelligent"
 └─ Machine Learning  learns patterns from data instead of following hand-written rules
     └─ Deep Learning  ML using neural networks with many layers
         └─ Generative AI  models that produce new content (text, images, audio, code)
             └─ LLM  a generative model for text: a Large Language Model
```

Traditional code:

```text
rules + data → answers
```

Machine learning:

```text
data + answers → rules (learned)
```

An LLM is the thing you call when you use Gemini, GPT, or Claude.

---

# 2. What an LLM Actually Does

One thing:

> **Given some text, predict what comes next.**

```text
"The capital of France is"  →  " Paris"
```

It does this one piece at a time, feeding its own output back in:

```text
"The capital of France is"            → " Paris"
"The capital of France is Paris"      → "."
"The capital of France is Paris."     → (stop)
```

That loop is called **autoregressive generation**.

Everything else (answering questions, writing code, returning JSON, "deciding" to call a tool) is this same next-piece prediction, applied to a cleverly built input.

Simple analogy: the autocomplete on your phone keyboard, made enormously more capable.

---

# 3. Model, Parameters, Weights

A **model** is a very large mathematical function with billions of adjustable numbers.

Those numbers are the **parameters** (also called **weights**). "A 7-billion-parameter model" means 7 billion of those numbers.

```text
text in → [ billions of numbers doing arithmetic ] → probabilities for the next piece
```

* More parameters generally means more capable, slower, and more expensive.
* The model's "knowledge" isn't stored as facts in a table. It's spread across the weights as patterns.

---

# 4. Training vs Inference

Two completely different phases.

```text
TRAINING    the provider adjusts the weights using huge amounts of text
            done once, costs millions, takes weeks

INFERENCE   using the finished model to generate output
            what happens every time you call the API
```

As a backend developer you do **inference only**.

The important consequence:

> **Your API calls don't change the model.** It doesn't learn from your conversation. The weights are frozen.

Training stages worth knowing by name:

* **Pre-training** — learn language in general by predicting the next token over a vast amount of text.
* **Fine-tuning** — further training on a smaller, specific dataset to specialise behaviour.
* **Instruction tuning / alignment** — training that makes a raw text predictor behave like a helpful assistant that follows instructions.

---

# 5. The Transformer and Attention (Just Enough)

The **transformer** is the neural network design behind every modern LLM (it's the "T" in GPT).

Its key mechanism is **attention**: when processing a word, the model can look at every other word in the input and weigh how relevant each one is.

```text
"The trophy didn't fit in the suitcase because it was too big."
                                               ↑
                        attention links "it" to "trophy"
```

You don't need the maths. You need three consequences:

1. The model considers the **whole input at once**, which is why putting documents and history in the prompt works.
2. There's a maximum input size (the context window, §9).
3. Longer input costs more compute.

---

# 6. Knowledge Cutoff

Training data stops at some date. The model knows nothing after it, and nothing private (your PDFs, your database).

```text
"Who won yesterday's match?"       → it can't know
"What does my contract say?"       → it has never seen it
```

Two fixes: give it the information in the prompt (RAG, §24), or give it tools to look things up (§29).

---

# 7. Hallucination

When a model states something false, fluently and confidently.

Why it happens: the model generates **plausible** text, not **verified** text. It has no built-in "I don't know this" signal. If the likely-sounding continuation is wrong, you get a wrong answer that reads perfectly.

What reduces it:

* **Grounding**: give it the source text and tell it to answer only from that.
* **An exit**: explicitly allow "I couldn't find that".
* **Lower temperature** for factual tasks.
* **Showing sources** so a human can check.

It can be reduced, not eliminated.

---

# PART 2 — TOKENS AND CONTEXT

---

# 8. Tokens

Models don't read characters or words. They read **tokens**: chunks of text from a fixed vocabulary.

```text
"Hello world"      → ["Hello", " world"]              2 tokens
"unbelievable"     → ["un", "believ", "able"]         ~3 tokens
```

A token can be a word, part of a word, a space plus a word, or punctuation.

Rules of thumb for English:

```text
1 token ≈ 4 characters ≈ ¾ of a word
100 tokens ≈ 75 words
```

Code, JSON, numbers, URLs, and many non-English languages use more tokens per word.

The **tokenizer** is the component that splits text into tokens. Each model family has its own, so the same text has a different token count on different models.

> **Tokens are the unit of everything: limits, speed, and price.**

Deep-dive: [advanced/03 — Tokens & Cost](advanced/03-token-counting-cost/More_on_Tokens_Cost.md)

---

# 9. Context Window

The maximum number of tokens a model can handle in one request.

```text
┌──────────────── context window ─────────────────┐
│ instructions │ history │ documents │ question │   ← input
│                                      [ output ]  │
└──────────────────────────────────────────────────┘
```

* Everything the model "knows" during a request must fit in here.
* There's a separate, smaller cap on **output** tokens.
* Too much input → an error. Output cap reached → the reply just stops mid-sentence.

Modern windows are very large. But **fitting isn't the same as should**: more input costs more, is slower, and models use the middle of a very long context less reliably ("lost in the middle").

---

# 10. The Model Is Stateless

Every API call starts from nothing. The model doesn't remember your previous call.

```text
call 1: "My name is Shiv."    → "Nice to meet you!"
call 2: "What's my name?"     → it has no idea
```

A chatbot "remembers" only because the app stores the messages and **sends them again** each time.

Deep-dive: [06 — Conversation Memory](06-conversation-memory/More_on_Conversation_Memory.md)

---

# 11. Input vs Output Tokens

```text
INPUT  (prompt) tokens      everything you send
OUTPUT (completion) tokens  everything the model writes
```

* Output tokens are priced several times higher than input tokens.
* Output is generated one token at a time, so **output length drives response time**.
* In a RAG app, input usually dominates the bill (documents + history).

---

# PART 3 — TALKING TO A MODEL

---

# 12. Prompt

The text you send. In an application a prompt is built by code, from parts:

```text
role / rules → context (documents) → history → the question
```

Deep-dive: [advanced/01 — Prompt Engineering](advanced/01-prompt-engineering/More_on_Prompt_Engineering.md)

---

# 13. Roles: System, User, Assistant

Chat APIs label each piece of text with who it's from.

```text
SYSTEM      standing instructions from the developer   "You answer questions about a document…"
USER        the human's message
ASSISTANT   the model's earlier replies   (Gemini calls this role "model")
```

A conversation is a list of these turns. The system instruction carries more weight than ordinary content and marks the boundary between your rules and untrusted text.

---

# 14. Zero-Shot, Few-Shot

```text
ZERO-SHOT   instructions only
FEW-SHOT    instructions + a few example inputs and ideal outputs
```

Examples help when a format or edge case is easier to show than describe. Models copy examples closely, so make them varied.

**Chain-of-thought**: asking the model to reason step by step before answering. Improves hard reasoning tasks; costs output tokens.

---

# 15. Temperature

Controls randomness when choosing the next token.

```text
"The sky is"  →  blue 70% · clear 15% · grey 10% · falling 0.1% …

temperature 0     always (nearly) the top choice   → consistent, repeatable
temperature 1     samples by the probabilities      → varied
temperature >1    flattens them                     → creative, erratic
```

| Task | Temperature |
|---|---|
| extraction, classification, factual Q&A, RAG | low (0–0.3) |
| general chat | medium |
| brainstorming, creative writing | higher |

Temperature 0 means *less* random, not perfectly deterministic.

---

# 16. Top-P, Top-K, and Other Settings

| Setting | What it does |
|---|---|
| **top-k** | only consider the K most likely tokens |
| **top-p** (nucleus) | only consider the smallest set of tokens whose probabilities add up to P |
| **max output tokens** | hard cap on reply length (a cost and safety limit) |
| **stop sequences** | stop generating when this text appears |
| **seed** | where supported, makes sampling more repeatable |

Usually you adjust temperature and leave top-p/top-k alone.

---

# 17. Finish Reason

Every response says why generation ended.

```text
STOP          finished naturally
MAX_TOKENS    hit the output cap (the reply is cut off)
SAFETY        blocked by a content filter
```

Worth checking in code: a truncated JSON reply is invalid JSON.

---

# 18. Streaming

Instead of waiting for the whole answer, the server sends pieces as they're generated.

It doesn't make generation faster. It makes the wait *feel* shorter, because the first words appear almost immediately.

Usually delivered with **SSE** (Server-Sent Events).

Deep-dive: [07 — Streaming](07-streaming-sse/More_on_Streaming.md)

---

# 19. Structured Output

Getting data (JSON) instead of prose, in an exact shape code can use.

Two separate jobs:

```text
ASK      prompt wording, or the API's JSON / schema mode   → makes the right shape likely
VERIFY   parse + validate (Zod)                             → makes a wrong shape unusable
```

Never skip the verify half.

Deep-dive: [08 — Structured Output](08-structured-output-zod/More_on_Structured_Output.md)

---

# 20. Multimodal

A model that handles more than text: images, audio, video, PDFs as input, and sometimes as output.

Images and audio are converted to tokens too, so they count against the context window and the bill.

DocMind is text-only: it extracts text from PDFs and ignores images. A scanned PDF with no text layer gives it nothing.

---

# PART 4 — EMBEDDINGS AND SEARCH

---

# 21. Embeddings

An **embedding** is a list of numbers (a **vector**) that represents the *meaning* of a piece of text.

```text
"How do I reset my password?"   → [0.021, -0.44, 0.13, … ]   (hundreds or thousands of numbers)
```

The key property:

> **Texts with similar meaning get vectors that are close together.**

```text
"reset my password"      ┐ close
"forgot my login"        ┘
"best pizza in town"       far away
```

An **embedding model** is a different model from a chat model. It doesn't generate text; it turns text into a vector. They're much cheaper than generation.

**Dimensions** = how many numbers in the vector. DocMind uses `gemini-embedding-001` with **3072** dimensions.

Vectors from different embedding models can't be compared. Changing the embedding model means re-embedding everything.

Reading: [01 — Embeddings](01-embeddings/README.md)

---

# 22. Similarity

How "close" two vectors are.

| Measure | Idea |
|---|---|
| **Cosine similarity** | the angle between two vectors. 1 = same direction, 0 = unrelated |
| **Cosine distance** | 1 − cosine similarity. 0 = identical, bigger = less similar |
| **Dot product** | like cosine, also affected by vector length |
| **Euclidean (L2)** | straight-line distance |

Cosine is the common default for text. In pgvector, `<=>` is cosine distance, so **smaller is better**.

---

# 23. Vector Search and Vector Databases

**Semantic search**: embed the query, then find the stored vectors closest to it.

```text
question → embed → find nearest chunk vectors → return those chunks
```

It finds text by *meaning*, not matching words: "car" can find "automobile".

A **vector database** stores vectors and searches them fast. Options: pgvector (an extension for Postgres, what DocMind uses), Pinecone, Qdrant, Weaviate, Chroma, Milvus.

* **Exact search** compares against every vector. Accurate, slow at scale.
* **ANN (approximate nearest neighbour)** uses an index (HNSW, IVFFlat) to be much faster with a small loss of accuracy.

**Hybrid search** = vector search + keyword search combined. Embeddings are weak on exact terms like product codes and names; keywords cover that.

**Reranking** = retrieve a wider set cheaply, then use a more accurate model to pick the best few.

Reading: [02 — Vector Search](02-vector-search-pgvector/README.md) · [Indexing at scale](02-vector-search-pgvector/INDEXING-AT-SCALE.md)

---

# 24. RAG (Retrieval-Augmented Generation)

The most important pattern in applied AI.

Problem: the model doesn't know your documents (§6) and will guess (§7).

Solution: **find the relevant text first, then hand it to the model with the question.**

```text
INGESTION (once per document)
   document → extract text → split into chunks → embed each → store

QUERY (every question)
   question → embed → search for the closest chunks
            → prompt = rules + chunks + question
            → model answers from the chunks
```

```text
Retrieval   = find the relevant pieces
Augmented   = add them to the prompt
Generation  = the model writes the answer
```

Why RAG instead of pasting the whole document in: cheaper, faster, works for any size, and the answer can cite where it came from.

The rule to remember:

> **The answer can only be as good as what was retrieved.** If the right chunk isn't in the prompt, no prompt wording will save it.

Reading: [05 — RAG](05-rag/README.md)

---

# 25. Chunking

Splitting a document into pieces before embedding.

```text
small chunks   precise matches, may lack context
large chunks   more context, blurrier match (one vector averages many topics)
overlap        repeat a little between neighbours so nothing is cut in half
```

Deep-dive: [advanced/02 — Chunking](advanced/02-chunking-strategy/More_on_Chunking.md)

---

# 26. Top-K (in Retrieval)

How many chunks to retrieve. DocMind uses 3.

Not the same as the *sampling* top-k in §16. Same name, different thing.

```text
context sent to the model = top_k × chunk size
```

---

# PART 5 — BUILDING ON TOP

---

# 27. The Three Ways to Customise a Model

When a model doesn't do what you need, in order of cost:

| Approach | What it is | Use when |
|---|---|---|
| **Prompting** | better instructions and examples | always first |
| **RAG** | give it knowledge at request time | it lacks *information* (your data, recent facts) |
| **Fine-tuning** | further train the model | it lacks a *behaviour* (a style, a format, a narrow skill), and prompting can't get there |

Common confusion: fine-tuning is **not** how you teach a model your documents. RAG is. Fine-tuning changes how it behaves, is slow and costly to update, and can't cite sources.

---

# 28. Conversation Memory

Store the messages, replay the recent ones in each prompt.

Strategies: a sliding window of the last N messages (DocMind: 8), a token-budgeted window, summarising older turns, or retrieving relevant past messages.

Deep-dive: [06 — Conversation Memory](06-conversation-memory/More_on_Conversation_Memory.md)

---

# 29. Tool Calling (Function Calling)

Letting the model ask your code to do something.

```text
1. you describe functions to the model (name, description, argument schema)
2. the model replies with a structured request: call searchDocument({ query: "…" })
3. YOUR CODE runs the real function
4. you send the result back
5. the model writes the final answer
```

> **The model never executes anything. It only asks. Code decides and acts.**

This is how a model gets current data, searches, does maths reliably, or triggers actions.

---

# 30. Agents

> **An LLM in a loop with tools, with code deciding when to stop.**

```text
WORKFLOW   the steps are fixed in code; the model fills them in
AGENT      the model chooses the next step at runtime
```

Related terms:

* **Router** — classify the request, then pick a fixed path.
* **Agentic RAG** — retrieval is a tool the model calls with its own search query.
* **Human in the loop** — the agent pauses for approval before a risky action.
* **Multi-agent** — one model delegating to others.

Default to the simplest thing that works. Agents cost more calls and are harder to test.

Deep-dive: [10 — Agents & Tool Calling](10-agents-tool-calling/More_on_Agents_Tool_Calling.md) · [11 — Workflows](11-workflows-suspend-resume/More_on_Workflows.md)

---

# 31. MCP (Model Context Protocol)

A standard way to expose tools and data to models, so one tool server works with many AI apps.

Tool calling is the mechanism. MCP is a packaging standard on top: "USB for AI tools".

---

# 32. Reasoning ("Thinking") Models

Some models can spend extra hidden computation working through a problem before answering.

* better on hard, multi-step problems
* slower, and the thinking tokens are billed
* usually controlled by a setting (an effort level or token budget)

Not needed for simple grounded Q&A.

---

# PART 6 — RUNNING IT FOR REAL

---

# 33. Model Sizes and Tiers

Every provider sells a range:

```text
small / "lite" / "mini" / "flash"   fast, cheap, good enough for simple tasks
medium                              the balance
large / "pro" / "opus"              most capable, slowest, most expensive
```

DocMind uses `gemini-flash-lite-latest`: the cheap, fast tier.

Pick the smallest model that does the job. A common pattern is **routing**: cheap model for easy tasks (classification), stronger model only where needed.

**Open-weight models** (Llama, Mistral, Gemma and others) can be downloaded and run yourself, with tools like Ollama. **Quantization** shrinks a model by storing its weights with less precision, so it fits on smaller hardware at a small quality cost.

---

# 34. Cost

```text
cost = input tokens × input price + output tokens × output price
```

Quoted per million tokens. Output is pricier than input; bigger models cost far more.

Ways to reduce it: a smaller model, less input (fewer chunks, trimmed history), shorter output, caching, batching.

**Prompt caching**: providers can cache a repeated prompt prefix and charge less for it. Put stable content first.

**Batch APIs**: asynchronous processing at a discount, for work nobody's waiting on.

Deep-dive: [advanced/03 — Tokens & Cost](advanced/03-token-counting-cost/More_on_Tokens_Cost.md)

---

# 35. Rate Limits

Providers cap how much you can use:

```text
RPM   requests per minute
TPM   tokens per minute
RPD   requests per day
```

Exceed one → `429 Too Many Requests`. Overloaded provider → `503`.

The response: retry with **exponential backoff and jitter**, a timeout on every call, and a cap on attempts.

Deep-dive: [advanced/05 — Rate Limiting & Retries](advanced/05-rate-limiting-retries/More_on_Rate_Limiting_Retries.md)

---

# 36. Latency

```text
TTFT             time to first token   what the user feels when streaming
tokens / second  generation speed
total            TTFT + output length ÷ speed
```

Shorter answers are faster answers.

---

# 37. Online vs Offline Work

```text
ONLINE    a human is waiting       → run now, stream          (chat)
OFFLINE   nobody is waiting        → put it on a queue        (ingesting a PDF)
```

Deep-dive: [09 — Background Jobs](09-background-jobs-bullmq/More_on_Background_Jobs.md)

---

# 38. Evaluation

How you know the output is good, beyond "it felt right".

```text
TESTING      is my code correct?      mock the model; pass/fail
EVALUATION   are the answers good?    real model; a score over a fixed question set
```

Terms:

* **Golden set** — a saved collection of test questions with expected answers.
* **Faithfulness / groundedness** — is the answer supported by the retrieved text?
* **LLM-as-judge** — a second model call grades the output against a rubric.
* **Benchmark** — a public standard test for comparing models. Useful for a rough ranking; your own eval set matters more for your app.

For RAG, evaluate two things separately: was the right text retrieved, and was it used well.

Deep-dive: [advanced/04 — Evaluation](advanced/04-evaluation/More_on_Evaluation.md) · [12 — Testing & Observability](12-testing-observability/More_on_Testing_Observability.md)

---

# 39. Safety and Security

**Prompt injection** — text that reaches the model and overrides your instructions. It works because instructions and data share one channel: text.

* *Direct*: the user types it.
* *Indirect*: it's hidden in a document or web page the model reads. More dangerous.

**Jailbreak** — getting a model to break its provider's content rules.

**Guardrails** — checks around the model: input limits, output validation, moderation.

The principles:

* Treat model output as untrusted input. Validate it, escape it, never execute it.
* The model proposes; code decides and acts.
* Access control belongs in your queries, never in a prompt instruction.
* Never put secrets in a prompt.

Deep-dive: [advanced/06 — LLM Security](advanced/06-llm-security/More_on_LLM_Security.md)

---

# 40. Providers and Portability

Each provider's API differs in message format, role names, streaming format, and how structured output and tools are specified.

Keeping all provider calls behind your own small set of functions makes a swap cheap. Generation models are easy to swap; embedding models aren't, because stored vectors depend on them.

Deep-dive: [advanced/07 — Vendor Abstraction](advanced/07-vendor-abstraction/More_on_Vendor_Abstraction.md)

---

# PART 7 — PUTTING IT TOGETHER

---

# 41. How DocMind Uses Each Idea

| Idea | In DocMind |
|---|---|
| LLM | `gemini-flash-lite-latest`, called with plain `fetch` |
| Embeddings | `gemini-embedding-001`, 3072 dimensions |
| Vector search | Postgres + pgvector, cosine distance, exact search |
| Chunking | fixed ~500 words, no overlap |
| RAG | top 3 chunks pasted into the prompt |
| Memory | last 8 messages replayed |
| Streaming | SSE on `/chat-stream` |
| Structured output | quiz JSON, schema mode + Zod, retry once |
| Temperature | not set (model default) |
| Tool calling, agents | not built (Phase 7) |
| Evaluation | not built (manual testing so far) |
| Auth, rate limits | not built |

---

# 42. One Request, Every Concept

A single chat message, traced through the vocabulary:

```text
"What is the notice period?"
        │
        ▼
EMBEDDING MODEL turns the question into a VECTOR                  (§21)
        │
        ▼
VECTOR SEARCH finds the TOP-K closest CHUNKS by COSINE DISTANCE   (§22–26)
        │
        ▼
MEMORY: the last 8 messages are loaded                            (§28)
        │
        ▼
PROMPT is built: rules + chunks + history + question              (§12)
        │   everything is counted in TOKENS and must fit the
        │   CONTEXT WINDOW                                        (§8–9)
        ▼
LLM runs INFERENCE: predicts the next token, repeatedly,
   sampling according to TEMPERATURE                              (§2, §4, §15)
        │
        ▼
STREAMING sends each piece to the browser as it's generated       (§18)
        │
        ▼
the answer is GROUNDED in the chunks, which limits HALLUCINATION  (§7)
        │
        ▼
the exchange is saved, because the model is STATELESS             (§10)
```

That's RAG (§24), and it uses most of this file.

---

# 43. Common Misconceptions

| Belief | Reality |
|---|---|
| "The model remembers our chat." | It's stateless. The app re-sends history. |
| "It learns from my conversations." | Weights are frozen at inference. |
| "Fine-tune it on my documents." | Use RAG for knowledge. Fine-tuning is for behaviour. |
| "Bigger context window means I don't need RAG." | Filling it costs more, is slower, and can lower quality. |
| "Temperature 0 is deterministic." | Less random, not guaranteed identical. |
| "JSON mode means I don't need validation." | It constrains shape, not meaning. Validate anyway. |
| "Streaming is faster." | Same total time; the first words just arrive sooner. |
| "It said it confidently, so it's right." | Confidence and correctness are unrelated. |
| "A prompt instruction keeps data private." | If the text is in the prompt, it's already exposed. |
| "A token is a word." | Roughly ¾ of a word, and it varies. |
| "Embeddings and chat use the same model." | Different models, different jobs. |
| "The model ran the function." | It asked. Your code ran it. |

---

# 44. Glossary

| Term | Meaning |
|---|---|
| **Agent** | an LLM in a loop with tools |
| **ANN** | approximate nearest neighbour search; fast, slightly inexact |
| **Attention** | the mechanism letting a model weigh every part of its input |
| **Autoregressive** | generating one token at a time, feeding output back in |
| **Chunk** | a piece of a document, the unit of retrieval |
| **Completion** | the model's output |
| **Context window** | max tokens per request |
| **Cosine distance** | 1 − cosine similarity; smaller = more similar |
| **Embedding** | a vector representing meaning |
| **Few-shot** | a prompt with examples |
| **Fine-tuning** | further training on specific data |
| **Grounding** | tying an answer to provided sources |
| **Guardrails** | checks around a model's input and output |
| **Hallucination** | fluent, confident, false output |
| **HNSW** | a common index type for fast vector search |
| **Inference** | running a trained model |
| **Jailbreak** | bypassing a model's content rules |
| **Knowledge cutoff** | the date the training data ends |
| **LLM** | large language model |
| **MCP** | a standard for exposing tools to models |
| **Multimodal** | handles text plus images/audio/video |
| **Parameters / weights** | the model's learned numbers |
| **Prompt** | the input text |
| **Prompt caching** | reusing a repeated prompt prefix at lower cost |
| **Prompt injection** | text that overrides the developer's instructions |
| **Quantization** | shrinking a model by lowering number precision |
| **RAG** | retrieve relevant text, add it to the prompt, generate |
| **Reranking** | re-ordering retrieved results with a more accurate model |
| **Semantic search** | search by meaning, using embeddings |
| **SSE** | Server-Sent Events, the usual streaming transport |
| **Stateless** | no memory between calls |
| **Structured output** | a reply in an exact machine-readable shape |
| **System prompt** | the developer's standing instructions |
| **Temperature** | randomness of token selection |
| **Token** | the unit of text a model reads and writes |
| **Tokenizer** | splits text into tokens |
| **Tool / function calling** | the model requests a function; code runs it |
| **Top-k (retrieval)** | how many chunks to fetch |
| **Top-k / top-p (sampling)** | limits on which tokens can be picked |
| **Transformer** | the neural network design behind LLMs |
| **TTFT** | time to first token |
| **Vector** | a list of numbers |
| **Vector database** | stores vectors and finds the nearest ones |
| **Zero-shot** | a prompt with no examples |

---

# 45. Interview Quick Answers

**What is an LLM?**
> A neural network trained to predict the next token of text. Everything it does, including answering and returning JSON, is that prediction applied repeatedly to the input it's given.

**What's a token?**
> The unit a model reads and writes: a word or piece of a word, about four characters in English. Limits and prices are measured in tokens.

**What's a context window?**
> The maximum tokens in one request, covering instructions, history, documents and the question, with a separate cap on output.

**What's an embedding?**
> A vector of numbers representing the meaning of text, produced by an embedding model. Similar meanings give nearby vectors, which is what makes semantic search work.

**What is RAG and why use it?**
> Retrieve the text relevant to a question and put it in the prompt, so the model answers from real sources instead of its training data. It gives the model private and current knowledge, reduces hallucination, and allows citations.

**RAG vs fine-tuning?**
> RAG adds knowledge at request time and is easy to update. Fine-tuning changes the model's behaviour through more training. For "answer from my documents", RAG.

**What's temperature?**
> How random the choice of each next token is. Low for factual and structured tasks, higher for creative ones.

**Why do models hallucinate?**
> They generate likely text, not verified text, and have no built-in sense of not knowing. Grounding in sources, an explicit way to say "not found", and lower temperature reduce it.

**How does a chatbot remember?**
> It doesn't. The app stores the messages and re-sends recent ones each request.

**What's tool calling?**
> The model returns a structured request to call a function I described. My code validates it, runs the function, and returns the result. The model never executes anything itself.

**What's an agent?**
> An LLM in a loop with tools, choosing the next step at runtime until it answers or hits a step limit.

**What's prompt injection?**
> Text reaching the model that overrides the developer's instructions, possible because instructions and data are both just text. The real defence is limiting what the model's output is allowed to do.

---

# 46. Final Mental Model

```text
                       TEXT
                         │  tokenizer
                         ▼
                      TOKENS ───────────► limits · cost · speed
                         │
          ┌──────────────┴───────────────┐
          ▼                              ▼
   EMBEDDING MODEL                  LANGUAGE MODEL (LLM)
   text → vector (meaning)          tokens → next token, repeated
          │                              │
          ▼                              │  stateless · frozen weights
   VECTOR SEARCH                         │  knows nothing private or recent
   nearest = most similar                │  can hallucinate
          │                              │
          └──────────► RAG ◄─────────────┘
             retrieve the right text, put it in the prompt
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
     MEMORY         STRUCTURED          TOOLS
  replay history      OUTPUT          model asks,
                   ask + verify        code acts
        │                │                 │
        └────────────────┼─────────────────┘
                         ▼
                      AGENTS
               an LLM in a loop with tools
                         │
                         ▼
     AROUND ALL OF IT:  cost · rate limits · retries · evaluation · security
```

**An LLM predicts the next token. That's all, and it's enough.**

**It's stateless, frozen, and only knows what's in the request.**

**So the job of an AI backend is deciding what goes into that request, and what to do with what comes out.**

**Embeddings turn meaning into numbers; search finds the closest; RAG puts them in the prompt.**

**Never trust the output: validate it, ground it, measure it.**
