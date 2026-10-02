# Advanced 04 — Evaluation (RAG / LLM Output Quality)

**Roadmap: Phase 12** · **Revisits:** Phase 2 (RAG) and Phase 4 (quiz) · **Status in DocMind:** no evaluation exists. Quality has been judged by trying questions and reading the answers. The one real measurement in the project is Step 4.1's script (17/17 valid quizzes, answer-position bias 22/36/32/10%), which is a small eval in everything but name. "Step 0" of [prompt-improvement.md](../../../prompt-improvement.md) plans a baseline question set; it isn't built.

Code this file talks about: [chat.service.ts](../../../src/services/chat.service.ts) (`prepareChat`, `buildChatPrompt`), [chunks.repository.ts](../../../src/repositories/chunks.repository.ts) (`searchSimilar`), [step4-quiz-zod.ts](../../../src/step4-quiz-zod.ts), [quiz.service.ts](../../../src/services/quiz.service.ts)

---

# 1. What is Evaluation?

> **Measuring how good the system's outputs are, in a repeatable way.**

Without it, every change is judged like this:

```text
change the prompt → ask one question → "yeah, feels better" → ship
```

That's **vibes**. The problem with vibes:

* one question isn't the system
* output is random, so one good answer proves little
* you don't see what got *worse*
* you can't compare today with last week
* you can't show anyone a number

With evaluation:

```text
change the prompt → run 30 saved questions → 24/30 before, 27/30 after, 1 new failure → decide
```

---

# 2. Simple Analogy

A chef changing a recipe.

**Vibes**: taste one spoonful, decide it's better.

**Evaluation**: the same ten tasters, the same ten dishes, a scorecard with specific criteria (salt, texture, temperature), before and after. Now you know salt improved and texture got worse.

The scorecard and the fixed set of dishes are the whole idea.

---

# 3. Testing vs Evaluation

Different questions, different tools (also in [topic 12](../../12-testing-observability/More_on_Testing_Observability.md)):

| | Testing | Evaluation |
|---|---|---|
| Question | is my **code** correct? | is the **output** good? |
| LLM | mocked | real |
| Result | pass / fail | a score (e.g. 87%) |
| Deterministic | yes | no |
| Runs | every commit | on demand, before prompt/model/retrieval changes |
| Cost | free, milliseconds | API calls, minutes |

You need both. Tests can be 100% green while every answer is wrong.

---

# 4. Why LLM Output Is Hard to Evaluate

* **No single right answer.** "RAG combines retrieval with generation" and "It retrieves relevant text and gives it to the model" are both correct. String equality is useless.
* **Non-deterministic.** Same input, different output.
* **Failures are fluent.** A wrong answer reads as well as a right one.
* **Quality has several dimensions.** Correct, grounded, complete, concise, well-formatted. An answer can be great on four and fail on one.
* **Humans disagree** about what "good" is.

So evaluation isn't one metric. It's picking the few properties that matter for your product and measuring each.

---

# 5. A RAG System Has Two Things to Evaluate

```text
question → [ RETRIEVAL ] → chunks → [ GENERATION ] → answer
```

They fail independently, and they have completely different fixes:

| | Retrieval failed | Generation failed |
|---|---|---|
| What happened | the right chunk wasn't in the top k | the right chunk was there; the answer is still bad |
| Fix | chunking, query rewriting, k, hybrid search, reranking | prompt, model, temperature |

> **The first question about any bad answer: was the right text even retrieved?**

Tuning the prompt to fix a retrieval problem is the most common waste of time in RAG work. DocMind's terminal already makes this check quick: `prepareChat` prints each of the top 3 chunks with its distance.

Evaluate the two stages separately, then end to end.

---

# 6. Evaluating Retrieval

This half is **cheap, fast, and deterministic**: it needs embeddings and a database query, no generation, no judge. Start here.

You need a labelled set: for each question, which chunk(s) contain the answer.

```json
{ "question": "What is the refund window?", "relevantChunkIds": [142] }
```

Then run `searchSimilar` and compare.

**Hit rate (recall@k).** Did a relevant chunk appear in the top k?

```text
30 questions, a relevant chunk in the top 3 for 24 → hit rate@3 = 80%
```

The most useful single retrieval number.

**Precision@k.** Of the k retrieved, how many were relevant?

```text
top 3 = [relevant, irrelevant, irrelevant] → precision@3 = 33%
```

Low precision means noise in the prompt.

**Recall@k.** Of all relevant chunks, how many were retrieved? Matters when answers need several chunks.

**MRR (mean reciprocal rank).** How high was the first relevant chunk?

```text
rank 1 → 1.0     rank 2 → 0.5     rank 3 → 0.33     not found → 0
MRR = the average
```

Rewards putting the right chunk first.

**nDCG.** Like MRR but handles graded relevance and several relevant chunks. Know the name; hit rate and MRR are enough for a project this size.

The precision/recall tension in plain words:

```text
raise k → recall goes up (more likely to include the right chunk)
        → precision goes down (more junk in the prompt)
```

What it looks like in code:

```ts
let hits = 0, rrSum = 0
for (const item of goldenSet) {
  const embedding = await getEmbedding(item.question)
  const results = await searchSimilarWithIds(embedding, 3, item.documentId)
  const rank = results.findIndex((r) => item.relevantChunkIds.includes(r.id))
  if (rank !== -1) { hits++; rrSum += 1 / (rank + 1) }
}
console.log(`hit rate@3: ${(hits / goldenSet.length * 100).toFixed(0)}%   MRR: ${(rrSum / goldenSet.length).toFixed(2)}`)
```

One practical gap: `searchSimilar` returns `content, distance, documentId, filename`, **not the chunk id**. An eval needs to identify chunks, so either return the id or match on content.

And a caution about labelling by chunk id: ids change when a document is re-chunked. Labelling by a **quote** from the answer passage ("the right chunk is one that contains this sentence") survives re-chunking, which is exactly what you want when comparing chunking strategies ([advanced/02](../02-chunking-strategy/More_on_Chunking.md)).

---

# 7. Evaluating Generation

Assume retrieval gave the right chunks. Is the answer good? The standard properties:

**Faithfulness (groundedness).** Is every claim in the answer supported by the retrieved context? This is the anti-hallucination metric.

```text
context: "The refund window is 30 days."
answer:  "You can get a refund within 30 days, and shipping is free."
                                              └── not in the context → unfaithful
```

**Answer relevance.** Does it actually address the question that was asked?

**Correctness.** Does it match a known reference answer? Needs a "golden" answer.

**Completeness.** Did it cover everything the context had on the question?

**Refusal correctness.** When the document doesn't contain the answer, does it say so? And when it does, does it avoid refusing? Both directions matter:

```text
answerable question   → answered       ✓     refused        ✗ (over-refusal)
unanswerable question → refused        ✓     answered       ✗ (hallucination)
```

Three of these (context relevance, faithfulness, answer relevance) are often called the **RAG triad**.

Faithfulness and correctness are not the same:

```text
faithful but wrong:   the retrieved chunk was the wrong one; the answer follows it loyally
correct but unfaithful: the model answered from its own memory; right this time, by luck
```

For a "chat with your document" product, **faithfulness matters most**. An answer that's right for reasons outside the document can't be trusted or cited.

---

# 8. The Golden Set

A fixed collection of test cases, kept in the repo and reused forever.

```json
{
  "id": "refund-01",
  "documentId": "…",
  "question": "What is the refund window?",
  "expectedAnswer": "30 days from delivery.",
  "answerQuote": "The refund window is 30 days from delivery",
  "type": "simple"
}
```

How to build a useful one:

* **Start small.** 15–30 cases is enough to start. A small set you actually run beats a big one you don't.
* **Use real questions.** The ones you've actually typed while testing.
* **Cover the categories:**

| Type | Example |
|---|---|
| simple factual | "What is the refund window?" |
| needs two chunks | "Compare the basic and pro plans" |
| follow-up (needs history) | "and the second one?" |
| **unanswerable** | "What's the CEO's salary?" (not in the document) |
| partially answerable | half of it is in the document |
| smalltalk | "hi", "thanks" |
| rephrase request | "explain that more simply" |
| multi-document | needs sources from two PDFs |
| adversarial | a document containing an injected instruction |
| exact-term | a product code or a name (embeddings are weak here) |

* **Include the cases that failed.** Every bug becomes a permanent test case. That's how the set grows: from real failures.
* **Use a stable test document**, not something that will be deleted. No private data (the repo is public): not a resume.

Synthetic generation (an LLM writes questions from chunks) can bootstrap a set quickly. Review them by hand: generated questions tend to be easy and reuse the chunk's own wording, which flatters retrieval.

---

# 9. How to Grade: Three Kinds of Graders

### 9.1 Code-based (deterministic)

Fast, free, exact. Use wherever possible.

* does the answer contain "30 days"?
* is it under 100 words?
* does it contain raw markdown (`**`)?
* does it start with "Based on the provided context"?
* did it cite a filename in multi-document mode?
* is it valid JSON of the right shape? (Zod: that's what Step 4.1 measured)
* is `correctIndex` evenly distributed? (also Step 4.1)

Limit: can't judge meaning.

### 9.2 Human

The gold standard, and the slowest and most expensive. Use it to **create** the golden set and to **calibrate** the automated graders, not to grade every run.

### 9.3 LLM-as-judge

A second model call grades the output against a rubric. Scales like code, judges meaning like a human (imperfectly).

---

# 10. LLM-as-Judge

```text
question + retrieved context + the answer
                ↓
        JUDGE PROMPT (rubric)
                ↓
   { "faithful": false, "reason": "'shipping is free' is not in the context" }
```

A faithfulness judge:

```text
You are grading an answer for faithfulness to the provided context.

<context>
{chunks}
</context>

<answer>
{answer}
</answer>

List each factual claim in the answer. For each, state whether the context supports it.
Then give a verdict: "faithful" if every claim is supported, otherwise "unfaithful".

Reply as JSON: { "claims": [{ "claim": string, "supported": boolean }], "verdict": "faithful" | "unfaithful" }
```

That's structured output (topic 08) used for grading: a response schema, validated with Zod.

What makes a judge reliable:

* **One criterion per judge.** A faithfulness judge and a relevance judge, not one judge scoring "overall quality".
* **Binary or a short scale.** "faithful / unfaithful" is far more consistent than "rate 1–10". On a 10-point scale nobody, human or model, can say what separates a 6 from a 7.
* **A concrete rubric.** Define each label. Give examples of each.
* **Reasoning before the verdict.** Ask for the claim-by-claim analysis first, then the label (field order matters in JSON).
* **Low temperature.**
* **A stronger model as judge** than the one being judged, when you can.
* **Give the judge everything**: the question, the context, the answer, and the reference if there is one.

Known weaknesses:

* judges are biased toward longer, more confident answers
* a model tends to rate its own style favourably
* they miss subtle errors
* they're non-deterministic too
* they cost a call per graded answer

**Calibrate the judge.** Hand-grade 20–30 answers yourself, run the judge on the same ones, and measure agreement. If it agrees with you 90% of the time, it's usable. If 60%, fix the rubric before trusting any score it gives. An uncalibrated judge produces confident-looking numbers that mean nothing.

---

# 11. Older Automatic Metrics (Know the Names)

| Metric | Idea | Verdict for RAG |
|---|---|---|
| Exact match | output == reference | useless for prose; fine for classification labels |
| BLEU / ROUGE | word-overlap with a reference | built for translation/summarisation; poor for open answers (a correct paraphrase scores low) |
| Embedding similarity | cosine(answer, reference) | cheap rough signal; "the window is 30 days" and "the window is 90 days" are very similar vectors |

They show up in papers and interviews. For a RAG product, code checks plus an LLM judge are more useful.

---

# 12. The Eval Loop

```text
1. BASELINE     run the golden set on the current system. Save every output and score.
2. HYPOTHESIS   "adding overlap will fix boundary misses"
3. CHANGE       ONE thing
4. RE-RUN       the same golden set
5. COMPARE      per case: fixed / broken / unchanged. Not just the average.
6. READ         the actual outputs of every case that changed
7. DECIDE       keep or revert. Write down the result.
```

Things that make it work:

* **One change at a time.** Otherwise you can't attribute the result.
* **Look per case, not only at the average.** 80% → 80% can hide three fixes and three regressions.
* **Read the outputs.** The score tells you *that* something changed. Reading tells you *why*. This is the step people skip, and it's where the insight is.
* **Account for randomness.** With 20 cases, one flip is 5 points. Run cases more than once, or lower temperature for eval runs, and don't celebrate a 3-point change on a tiny set.
* **Save results with a label** (date, git commit, what changed) so runs can be compared later.

---

# 13. Error Analysis: The Highest-Value Activity

Before building any metric, do this:

```text
1. Collect 30–50 real question/answer pairs.
2. Read each one. Write a short note on what's wrong.
3. Group the notes into categories.
4. Count.
```

You'll get something like:

```text
follow-ups retrieve the wrong chunks      11
over-refuses on partial answers            7
raw markdown shown                         6
"Based on the context…" opener             4
actual hallucination                       2
```

Now you know what to fix first, and which metrics are worth building: a metric for each real failure category. Metrics invented without this step tend to measure things that weren't the problem.

The plan in [prompt-improvement.md](../../../prompt-improvement.md) is essentially the output of an informal error analysis: six named failure types with a fix for each.

---

# 14. What Step 4.1 Already Taught

The Step 4.1 script is worth re-reading as an eval:

| Eval concept | What the script did |
|---|---|
| A fixed harness | the same prompt, several runs, two modes |
| A code-based grader | `JSON.parse` → `Quiz.safeParse` |
| A grader test set | the 11-sample bad-reply gallery (testing the grader itself) |
| A metric | 17/17 valid |
| An **aggregate** metric | correct-answer position across 50 questions: 22/36/32/10% |
| Acting on it | shuffle in code |

The answer-position finding is the important lesson: **some defects are invisible in any single output and only appear across many.** Every individual quiz was valid. Only counting revealed the bias.

Things a fuller quiz eval would measure:

* is the marked answer actually correct, per the source? (judge)
* is exactly one option correct? (judge)
* is the question answerable from the content alone? (judge)
* do the five questions cover different parts? (code: which chunk each came from)
* are distractors plausible? (judge / human)

---

# 15. A Minimal Eval for DocMind

Smallest version worth building, in order:

**1. A golden set** as a JSON file: ~20 questions on one stable public test PDF, typed by category, each with an `answerQuote`.

**2. A retrieval eval script** (`npm run eval:retrieval`): for each answerable question, embed → search → is a chunk containing `answerQuote` in the top 3? Print hit rate and MRR. No generation calls: cheap, fast, repeatable. This alone turns "should I add overlap / change k / rewrite queries?" into a measurement.

**3. Code checks on answers**: length, raw markdown, banned opener, refusal phrase present for unanswerable cases.

**4. One LLM judge**: faithfulness. Calibrated against your own labels on ~20 answers.

**5. A results file**: one line per run with date, commit, and scores.

Notes for building it:

* It's read-only against the database, like `step4`. Keep it that way: an eval must never write or delete.
* Calling `prepareChat` directly would **save a user message** to `chat_messages` on every case. An eval should call `getEmbedding` + `searchSimilar` + `buildChatPrompt` itself, or use a throwaway session and clean up.
* Free-tier limits: 20 cases × (1 embed + 1 generate + 1 judge) is 60 calls. Pace it.
* Lower the temperature for eval runs, or run each case a few times.

---

# 16. Offline vs Online Evaluation

```text
OFFLINE   before shipping, on the golden set          "is this change safe to ship?"
ONLINE    after shipping, on real traffic             "is it working for real users?"
```

Online signals:

* 👍 / 👎 on answers
* did the user rephrase and ask again? (a quiet failure signal)
* refusal rate, average retrieval distance, answer length over time
* **A/B tests**: half of users get prompt A, half get B; compare
* sampling real conversations and running the judge on them

The loop that ties it together:

```text
production traces → find failures → add them to the golden set → fix → offline eval → ship
```

That's why observability ([topic 12](../../12-testing-observability/More_on_Testing_Observability.md)) and evaluation are neighbours: you can't evaluate what you didn't record.

---

# 17. Evaluating Other Parts

| Component | Eval | Metric |
|---|---|---|
| Intent router (Step 7.1/7.2) | labelled messages → predicted intent | accuracy, confusion matrix (which intents get mixed up) |
| Query rewriter (PI.1) | follow-ups → retrieval hit rate before vs after rewriting | hit rate |
| Tool calling (Step 7.3) | messages → was the right tool called with the right args? | tool-selection accuracy |
| Chunking | golden set → hit rate per config | hit rate, MRR |
| Relevance threshold (PI.6) | distances for answerable vs unanswerable questions | the threshold that separates them best |
| Model swap | whole golden set on both models | everything, side by side |

The router is the easiest eval of all: a classification problem with exact-match grading.

---

# 18. Tools and Frameworks

| Tool | What it is |
|---|---|
| **Ragas** | Python library of RAG metrics (faithfulness, answer relevancy, context precision/recall) |
| **promptfoo** | CLI/config-driven prompt and model comparison, runs in Node |
| **DeepEval** | pytest-style LLM evaluation |
| **Langfuse / LangSmith / Braintrust / Phoenix** | tracing + datasets + scoring + experiment comparison |

For a learning project, **a script and a JSON file** teach more than a framework: you see what a metric actually computes. Frameworks pay off when there are many cases, many runs, and several people.

---

# 19. Common Mistakes

* No baseline before changing things.
* A golden set of only easy, answerable questions.
* Tuning the prompt until the golden set passes, then assuming it generalises (**overfitting to the eval set**). Keep some cases you don't look at while tuning.
* Trusting an uncalibrated judge.
* 1–10 scales.
* One "overall quality" score.
* Reading the average and not the outputs.
* Evaluating only end-to-end, so you can't tell retrieval from generation.
* Treating a small difference on 20 cases as real.
* An eval that writes to the production database.
* Never adding the bugs you find to the set.

---

# 20. Interview-Level Summary

If asked **"How do you know your RAG system is good?"**:

> I evaluate the two stages separately. For retrieval, a set of questions labelled with the passage that answers them, measuring hit rate and MRR at k: is the right chunk in the top results and how high. For generation, mainly faithfulness, whether every claim is supported by the retrieved context, plus answer relevance and whether it correctly refuses when the document doesn't contain the answer. Then I run that set before and after any change.

If asked **"What's a golden set?"**:

> A fixed, versioned collection of test questions with expected answers or the passages that answer them, covering the categories that matter: simple, multi-chunk, follow-ups, unanswerable, adversarial. It's the regression suite for output quality, and it grows from real failures.

If asked **"What is LLM-as-judge?"**:

> Using a second model call to grade an output against a rubric, usually returning a structured verdict. It scales where human grading doesn't. To make it trustworthy: one criterion per judge, binary or short scales, reasoning before the verdict, low temperature, and calibrating it against human labels before believing its scores.

If asked **"Precision vs recall in retrieval?"**:

> Recall is whether the relevant chunks were retrieved at all; precision is how much of what was retrieved is relevant. Raising k improves recall and lowers precision, putting more noise into the prompt.

If asked **"Faithfulness vs correctness?"**:

> Faithfulness is whether the answer is supported by the retrieved context. Correctness is whether it matches the truth. An answer can be faithful to the wrong chunk, or correct from the model's own memory without being grounded. For a document Q&A product, faithfulness is the one I care about most.

If asked **"Have you actually measured anything?"**:

> For quiz generation, yes: a script ran the same prompt repeatedly in two modes and validated every reply, 17 out of 17 valid. Counting the correct answer's position across 50 questions showed it wasn't uniform, 22, 36, 32 and 10 percent, which no single quiz would have revealed, so I shuffle options in code. For chat I've been honest that it's been manual so far; the plan is a golden set and a retrieval hit-rate script first, since that's cheap and deterministic.

If asked **"How do you approach a bad answer?"**:

> First check what was retrieved. If the right passage wasn't in the context, it's a retrieval problem and no prompt change will fix it. If it was, it's generation: prompt, model, or settings.

---

# 21. Things to Remember

* One good answer proves nothing.
* Retrieval and generation fail separately.
* Retrieval eval is cheap and deterministic. Do it first.
* Faithful ≠ correct.
* Include unanswerable questions.
* Some defects only show in aggregate.
* Calibrate the judge.
* Read the outputs, not just the score.
* Every bug becomes a test case.

---

# 22. Final Mental Model

```text
                      GOLDEN SET
          (real questions, typed, with answer quotes)
                          │
        ┌─────────────────┴──────────────────┐
        ▼                                    ▼
   RETRIEVAL EVAL                      GENERATION EVAL
   embed → search                      full pipeline → answer
        │                                    │
   is the answer passage                ┌────┴─────────────┐
   in the top k?                        ▼                  ▼
        │                          CODE CHECKS        LLM JUDGE
   hit rate, MRR,                  length, format,    faithfulness,
   precision@k                     refusal, schema    relevance
        │                               │             (calibrated vs human)
        └───────────────┬───────────────┘
                        ▼
                 SCORES + OUTPUTS  (saved, labelled with the commit)
                        │
                        ▼
        change ONE thing → re-run → compare PER CASE → read the diffs
                        │
                        ▼
                  keep or revert
                        │
                        ▼
        production failures → new golden cases (the set grows)
```

**Evaluation replaces "feels better" with a number and a list of what changed.**

**Two stages, measured separately: was it retrieved, and was it used well.**

**Code checks where possible, a calibrated judge where meaning matters, humans to ground both.**

**Aggregate over many outputs; some problems don't exist in any single one.**

**Start with twenty questions and a script.**
