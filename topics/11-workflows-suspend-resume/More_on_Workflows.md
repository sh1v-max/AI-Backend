# 11 — Workflows (Suspend / Resume)

**Roadmap: Phase 8** · **Status in DocMind: not built yet.** Concept + how it would land in this codebase. The LangGraph.js section describes the library's shape; its API moves quickly, so read the current [LangGraph.js docs](https://langchain-ai.github.io/langgraphjs/) before writing code.

Code this file talks about: [quiz.service.ts](../../src/services/quiz.service.ts) (`generateQuiz`), [chat.service.ts](../../src/services/chat.service.ts), [chatMessages.repository.ts](../../src/repositories/chatMessages.repository.ts), [schema.ts](../../src/db/schema.ts)

---

# 1. What is a Workflow?

A workflow is a task that takes **more than one step**, where the steps happen **across more than one request**.

Today every DocMind request is self-contained:

```text
request in → do everything → response out → forget
```

Now imagine quiz creation as a conversation:

```text
user:  "quiz me"
bot:   "Sure. How many questions, and should I cover the whole document?"
                                   ← the server must REMEMBER it asked this
user:  "5, whole thing"
bot:   "5 questions on the whole document. Go ahead?"
                                   ← and remember the answers so far
user:  "yes"
bot:   [creates the quiz]
```

Three HTTP requests. One task. Something has to hold the task together in between.

---

# 2. Simple Analogy

A government form with a waiting step.

```text
Day 1:  fill the form → submit → "come back with your ID proof"
        (clerk puts your file in a cabinet, labelled with your token number)

Day 4:  you return with the token → clerk pulls YOUR file
        → sees you're at step 2 → continues from there
```

* The **file in the cabinet** = saved state
* The **token number** = the id used to find it (`sessionId`)
* "Come back later" = **suspend**
* Pulling the file and continuing = **resume**

The clerk on day 4 might be a different person (a different server instance, after a restart). It doesn't matter, because everything needed is in the file. Nothing is in anyone's head.

---

# 3. Why the Server Can't Just "Wait"

A natural first idea:

```ts
const answer = await waitForUserReply()   // ← this does not exist
```

It can't, because:

* **HTTP is request/response.** The request that asked the question has already ended.
* **The server may restart** between messages (deploy, crash, free-tier spin-down).
* **There may be several instances.** The reply could land on a different one.
* **The user may come back in an hour.** Or never.

So "waiting" has to be faked:

> **Suspend = write down where you are and stop. Resume = read it back and continue.**

Nothing is actually paused. There's just a row in a database.

---

# 4. The Mental Model: A State Machine

A workflow is:

```text
STEPS      named points in the process          (proposeScope, awaitConfirmation, createQuiz)
STATE      the data collected so far            ({ documentId, questionCount: 5 })
STATUS     where the whole run stands           (ACTIVE, SUSPENDED, COMPLETED, FAILED)
TRANSITIONS  rules for moving between steps     (confirmed → createQuiz, rejected → cancel)
```

```text
              start
                │
                ▼
        ┌───────────────┐
        │ proposeScope  │   ACTIVE
        └───────────────┘
                │ asks the user, saves state
                ▼
        ┌───────────────────┐
        │ awaitConfirmation │   SUSPENDED   ← nothing is running here
        └───────────────────┘
          │ "yes"        │ "no" / something else
          ▼              ▼
   ┌────────────┐   ┌───────────┐
   │ createQuiz │   │ cancelled │   COMPLETED
   └────────────┘   └───────────┘
     │        │
     ▼        ▼
 COMPLETED  FAILED
```

The four statuses:

| Status | Meaning |
|---|---|
| `ACTIVE` | code is running a step right now |
| `SUSPENDED` | waiting for outside input; nothing is running |
| `COMPLETED` | finished (successfully or cancelled) |
| `FAILED` | a step threw and wasn't recovered |

---

# 5. You've Already Built Half of This

Conversation memory in DocMind works like this: there's **no `sessions` table**; a session is a `session_id` shared by `chat_messages` rows, and history is replayed into each prompt.

That's already "state in the database, keyed by an id, reloaded on every request".

A workflow run is the same idea with a different kind of state:

```text
chat memory    → sessionId → the MESSAGES so far      (unstructured)
workflow run   → sessionId → the STEP + DATA so far   (structured)
```

---

# 6. The `workflow_runs` Table

```sql
CREATE TABLE workflow_runs (
  id            text PRIMARY KEY,          -- uuid
  session_id    text NOT NULL,
  workflow      text NOT NULL,             -- 'create_quiz'
  current_step  text NOT NULL,             -- 'awaitConfirmation'
  state         jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL,             -- ACTIVE | SUSPENDED | COMPLETED | FAILED
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_runs_session_status ON workflow_runs (session_id, status);
```

Why `jsonb` for `state`? Different workflows collect different data. A JSON column lets one table serve them all. The tradeoff is the database no longer checks the shape, so **validate it with Zod when you read it** (it's another untrusted input: old rows may have an old shape).

In the repo this would be a new table in [schema.ts](../../src/db/schema.ts) with the SQL kept in a comment beside it (the existing convention), and a new `workflowRuns.repository.ts`. Nothing else touches SQL.

---

# 7. The Message Handler With Workflows

Every incoming message now starts with one question:

```text
                    message arrives (sessionId)
                              │
                              ▼
        is there a SUSPENDED run for this session?
              │                        │
             yes                       no
              │                        │
              ▼                        ▼
     resume(run, message)        normal routing
              │                  (smalltalk / RAG / start a workflow)
              ▼
     step logic → save → reply
```

In code shape:

```ts
const run = await findSuspendedRun(sessionId)
if (run) return resumeWorkflow(run, message)
return routeNormally(message)        // may START a workflow
```

This check goes at the very top of the chat pipeline, before embedding or searching. A "yes" should never be sent to vector search.

---

# 8. Building It by Hand (Step 8.2)

A small, honest implementation: each step is a function that takes the state and the user's input, and returns the next step, new state, new status, and a reply.

```ts
type StepResult = {
  nextStep: string
  state: QuizWorkflowState
  status: 'SUSPENDED' | 'COMPLETED' | 'FAILED'
  reply: string
}

const steps = {
  // Step 1 — propose and stop
  async proposeScope(state): Promise<StepResult> {
    return {
      nextStep: 'awaitConfirmation',
      state,
      status: 'SUSPENDED',
      reply: `I'll make 5 questions covering the whole document. Go ahead?`,
    }
  },

  // Step 2 — runs on the NEXT message
  async awaitConfirmation(state, userMessage): Promise<StepResult> {
    const decision = await classifyConfirmation(userMessage)   // 'confirm' | 'reject' | 'other'

    if (decision === 'reject') {
      return { nextStep: 'done', state, status: 'COMPLETED', reply: 'No problem, cancelled.' }
    }
    if (decision === 'other') {
      // user changed the subject: see §12
      return { nextStep: 'done', state, status: 'COMPLETED', reply: '' }
    }

    const result = await generateQuiz({ documentId: state.documentId }, Date.now())
    if (!result.ok) {
      return { nextStep: 'done', state, status: 'FAILED', reply: result.error }
    }
    return {
      nextStep: 'done',
      state: { ...state, quiz: result.quiz },
      status: 'COMPLETED',
      reply: 'Your quiz is ready.',
    }
  },
}
```

And a tiny engine around it:

```ts
async function runStep(run: WorkflowRun, userMessage?: string) {
  const result = await steps[run.currentStep](run.state, userMessage)
  await saveRun(run.id, result.nextStep, result.state, result.status)   // persist BEFORE replying
  return result.reply
}
```

Notice `createQuiz` is `generateQuiz()`, the function that already exists. It never touches `req`/`res`, which is why a workflow can call it. Same reason a worker could.

---

# 9. The Rules That Make It Correct

**1. Save after every step, before replying.**

```text
✓ do step → save state → send reply
✗ do step → send reply → save state     (crash in between = user saw a question the server doesn't remember asking)
```

**2. Everything in `state` must be serializable.**

Plain JSON only: strings, numbers, arrays, objects. No functions, class instances, `Date` objects (store ISO strings), sockets, or promises. If it can't survive `JSON.parse(JSON.stringify(x))`, it can't be suspended.

**3. Don't keep anything in memory between requests.**

A `Map<sessionId, state>` in the server works on your laptop and breaks on the first restart. Render's free tier restarts and spins down constantly.

**4. Store ids, not copies.**

`{ documentId }`, not the document's text. The document could be deleted while the run is suspended, which leads to rule 5.

**5. Re-validate on resume.**

The world may have changed while you were suspended: the document was deleted, the session was deleted. Check before acting.

**6. One active run per session.**

Decide what happens if the user starts a second workflow while one is suspended. Simplest: cancel the old one. A partial unique index enforces it at the DB level:

```sql
CREATE UNIQUE INDEX one_open_run_per_session
  ON workflow_runs (session_id) WHERE status IN ('ACTIVE', 'SUSPENDED');
```

---

# 10. Double Messages (a Race Condition)

The user double-clicks send, or the client retries. Two requests arrive with "yes" for the same suspended run:

```text
request A: loads run (SUSPENDED) → generates a quiz
request B: loads run (SUSPENDED) → generates a quiz     ← two quizzes
```

The fix is to **claim** the run atomically:

```sql
UPDATE workflow_runs
SET status = 'ACTIVE', updated_at = now()
WHERE id = $1 AND status = 'SUSPENDED'
RETURNING *;
```

Only one request gets a row back. The other sees zero rows and backs off. This is **optimistic locking**, and it's the same family of problem as idempotency in [topic 16](../16-idempotency-multi-tenancy/More_on_Idempotency_Multi_Tenancy.md).

It also has a failure case of its own: a run stuck in `ACTIVE` forever because the process died mid-step. A timeout (treat `ACTIVE` older than N minutes as stalled) handles that. Same idea as BullMQ's stalled jobs.

---

# 11. Human-in-the-Loop

The most common reason to suspend is a person:

```text
approval       "Go ahead and create this?"            ← Step 7.4's Kind-B confirmation
missing info   "Which chapters?"
choice         "Option A or B?"
review         "Here's the draft, edit before I send"
```

This is why topics 10 and 11 connect. A Kind-B tool (the model must not call it itself) needs a human "yes", and waiting for that "yes" is a suspended workflow.

Other things a workflow can wait on, with the same mechanism:

* a background job finishing (topic 09)
* a webhook from a payment provider
* a timer ("remind in 24 hours")

---

# 12. When the User Changes the Subject

```text
bot:   "5 questions on the whole document. Go ahead?"
user:  "wait, what does chapter 3 say about pricing?"
```

That's not yes and not no. Options:

| Policy | Behaviour |
|---|---|
| **Cancel and answer** | drop the workflow, treat the message normally (simplest, least surprising) |
| Answer and stay suspended | answer the question, then re-ask the confirmation |
| Insist | "Please answer yes or no" (annoying) |

Whatever you pick, the classifier needs three outputs (`confirm | reject | other`), not two. Treating everything that isn't "yes" as "no" is fine; treating everything that isn't "no" as "yes" is a bug that creates quizzes nobody asked for.

Also add **expiry**: a run suspended for a day shouldn't hijack tomorrow's first message. Check `updated_at` on load and ignore stale runs.

---

# 13. Errors Inside a Workflow

```text
step throws
   ├─ transient (Gemini 503)  → retry the STEP (not the whole workflow)
   └─ permanent               → status FAILED, tell the user, keep the state for debugging
```

Because state is saved after each step, a retry re-runs only the failed step. Completed steps aren't repeated. That property is called **durable execution**, and it's the main selling point of workflow engines.

It only works if steps are **idempotent**: a step that ran halfway and gets retried must not double its side effects. Again.

Bigger systems add **compensation** (the "saga" pattern): if step 3 fails after step 2 charged a card, run an "undo" for step 2. DocMind doesn't need it.

---

# 14. What Does `/chat-stream` Do During a Workflow?

The existing SSE protocol is `meta → text pieces → done`. A workflow reply is usually a short fixed string or a non-text result.

Options:

* **Send workflow replies through the same protocol**: one `data: { text }` frame, then `done`. No frontend change. Good enough for "Go ahead?".
* **A new named event** for non-text results, e.g. `event: quiz` with the quiz JSON, so the frontend can open `QuizModal`.
* **Include workflow status in `meta`** (`{ sessionId, sources: [], workflow: { status: 'SUSPENDED' } }`) so the UI could render Yes/No buttons instead of making the user type.

Buttons are worth it: a button sends an exact value, so you don't need an LLM to interpret "yeah sure go for it".

Remember the frontend depends on the SSE protocol exactly. Any new event needs matching frontend code.

---

# 15. Hand-Rolled vs a Framework

What you wrote by hand in §8 is, in miniature, what workflow libraries do:

| You wrote | A framework calls it |
|---|---|
| `steps` object | nodes |
| `nextStep` | edges / conditional edges |
| `state` jsonb | graph state |
| `workflow_runs` table | checkpointer |
| `sessionId` lookup | thread id |
| returning `SUSPENDED` | interrupt |
| loading and continuing | resume |

That mapping is the reason to build by hand first. After it, a framework is vocabulary, not magic.

---

# 16. LangGraph.js in One Page (Step 8.3)

LangGraph models a workflow as a **graph**: nodes are functions that read and update a shared state; edges say what runs next.

Conceptual shape:

```ts
import { StateGraph, Annotation, START, END, interrupt, Command, MemorySaver } from '@langchain/langgraph'

// 1. The state
const State = Annotation.Root({
  documentId: Annotation<string>(),
  confirmed: Annotation<boolean>(),
  quiz: Annotation<unknown>(),
})

// 2. The nodes: each returns a PARTIAL state update
async function proposeScope(state: typeof State.State) {
  // interrupt() pauses the graph here and surfaces this value to the caller
  const answer = interrupt({ question: '5 questions on the whole document. Go ahead?' })
  return { confirmed: answer === 'yes' }
}

async function createQuiz(state: typeof State.State) {
  const result = await generateQuiz({ documentId: state.documentId }, Date.now())
  return { quiz: result.ok ? result.quiz : null }
}

// 3. The graph
const graph = new StateGraph(State)
  .addNode('proposeScope', proposeScope)
  .addNode('createQuiz', createQuiz)
  .addEdge(START, 'proposeScope')
  .addConditionalEdges('proposeScope', (s) => (s.confirmed ? 'createQuiz' : END))
  .addEdge('createQuiz', END)
  .compile({ checkpointer: new MemorySaver() })

// 4. Run: first message
const config = { configurable: { thread_id: sessionId } }
await graph.invoke({ documentId }, config)          // stops at the interrupt

// 5. Run: next message, resume with the user's answer
await graph.invoke(new Command({ resume: 'yes' }), config)
```

The ideas to hold on to:

* **Checkpointer** = where state is saved after every step. `MemorySaver` is in-memory (dev only, same problem as a `Map`). For real use there's a Postgres checkpointer (`@langchain/langgraph-checkpoint-postgres`) which creates its own tables: your `workflow_runs`, written by someone else.
* **`thread_id`** = which saved run to load. Your `sessionId`.
* **`interrupt()`** = suspend. **`Command({ resume })`** = resume with a value.
* **Reducers**: each state field can define how updates merge (replace vs append). Appending is how message lists grow.

One real gotcha: when a graph resumes, **the interrupted node runs again from its first line**, and `interrupt()` returns the resume value this time. So anything in that node *before* the `interrupt()` call executes twice. Keep side effects after the interrupt, or in a separate node.

LangGraph is not the same as LangChain's high-level "chains". You can use it with plain functions and your own `fetch`-based Gemini calls; it doesn't require LangChain's model wrappers.

---

# 17. Other Tools in This Space

So the names aren't strangers:

| Tool | What it is |
|---|---|
| **LangGraph** | graph-based agent/workflow library with checkpointing and interrupts |
| **Mastra** | TypeScript agent framework with workflows that suspend/resume |
| **Temporal** | heavy-duty durable execution engine; workflows as code, replayed from an event history |
| **Inngest** | event-driven durable functions (`step.run`, `step.waitForEvent`) |
| **AWS Step Functions** | state machines defined as JSON, managed by AWS |
| **XState** | state machine library, common in frontends |
| **BullMQ Flows** | parent/child job trees (durable, but no "wait for a human") |

They all solve the same three problems: **persist state between steps, resume after a crash or a wait, retry a failed step without redoing the finished ones.**

---

# 18. Workflow vs Agent vs Queue

Easy to blur:

```text
QUEUE      "do this slow thing later, with retries"          one step, no human
WORKFLOW   "do these steps in order, pausing when needed"    many steps, state between them
AGENT      "let the model choose the next step"              the path isn't fixed
```

They combine. A workflow step can enqueue a job and suspend until it finishes. An agent can be one node inside a workflow. A human-approval step can sit inside an agent loop.

---

# 19. When NOT to Build a Workflow

* The task finishes in one request. (Today's `/quiz` with a button is already a great UX.)
* The "state" is one boolean. A column on an existing table may be enough.
* A UI form would collect the same inputs with zero ambiguity.

Honest note: for DocMind, a **button + modal** is a better product than a chat-driven quiz confirmation. The workflow is built to learn the mechanics of suspend/resume, which matter enormously in real agent systems (approvals, long-running tasks). Say that if asked; it shows judgment.

---

# 20. Where the Code Would Go

```text
src/
  db/schema.ts                              + workflow_runs table (+ SQL in a comment)
  repositories/workflowRuns.repository.ts   createRun, findOpenRun, claimRun, saveRun
  workflows/hand-rolled/quiz.workflow.ts    steps + the tiny engine
  workflows/langgraph/quiz.graph.ts         Step 8.3 (optional), same behaviour
  services/chat.service.ts                  check for an open run before the RAG steps
```

The roadmap suggests keeping **both** versions side by side. "Built from scratch to understand the mechanics, then reimplemented with a framework" is a strong story precisely because most people only have the second half.

Log every transition with `pipelineLogger` (`proposeScope → SUSPENDED`, `awaitConfirmation → COMPLETED`). A workflow you can't see in the terminal is very hard to debug.

---

# 21. Testing Workflows

State machines are the most testable thing in an AI backend, because the transitions are **pure logic**:

```text
given step=awaitConfirmation, input="yes"  → nextStep=done, status=COMPLETED, generateQuiz called once
given step=awaitConfirmation, input="no"   → status=COMPLETED, generateQuiz NOT called
given step=awaitConfirmation, input="what about chapter 3?" → cancelled, falls through to chat
generateQuiz returns { ok: false }         → status=FAILED
two concurrent resumes                     → only one claims the run
state loaded from DB with a missing field  → rejected by Zod, not a crash
expired run                                → ignored
```

Mock `classifyConfirmation` and `generateQuiz`. No LLM needed. This is Step 9.1's third test target.

---

# 22. Interview-Level Summary

If asked **"What is a suspend/resume workflow?"**:

> A multi-step process that spans several requests. When it needs outside input, it saves its current step and collected data to the database and stops: that's suspend. When the next message arrives, the server loads that state and continues from the saved step: that's resume. Nothing actually waits in memory.

If asked **"Why not keep the state in memory?"**:

> It wouldn't survive a restart or a deploy, and it wouldn't work with more than one server instance. The state has to live in shared storage, keyed by something the client sends back, like a session id.

If asked **"How did you build it?"**:

> As a state machine: a `workflow_runs` table with the current step, a JSON state column, and a status. Each step is a function from state plus input to next step, new state and status. On every message I first check for a suspended run for that session; if there is one I resume it, otherwise I route normally. I save after every step and before replying.

If asked **"What goes wrong?"**:

> Double-submits resuming the same run twice, which I prevent with an atomic status update. Non-serializable state. The world changing while suspended, so I re-validate on resume. The user changing the subject instead of answering. And abandoned runs, which need an expiry.

If asked **"Why use LangGraph if you can hand-roll it?"**:

> For anything bigger it gives me checkpointing, interrupts, retries, branching and tooling without maintaining my own engine. I built the small version first so I'd know what the framework is doing: nodes are my steps, the checkpointer is my table, the thread id is my session id.

If asked **"What's durable execution?"**:

> State is persisted after each step, so a crash or a failed step resumes from the last completed step instead of starting over. It depends on steps being idempotent.

---

# 23. Things That Will Bite You

* State in a `Map` → gone on restart.
* Replying before saving.
* Putting a `Date` or a class instance into state.
* No expiry → yesterday's suspended run eats today's first message.
* Two outputs (`yes`/`no`) where three are needed.
* Two requests resuming the same run.
* LangGraph: code before `interrupt()` runs again on resume.
* `MemorySaver` in anything deployed.
* A new SSE event the frontend doesn't know about.

---

# 24. Final Mental Model

```text
                     MESSAGE ARRIVES (sessionId)
                               │
                               ▼
                 open run for this session?
                    │                  │
                   no                 yes
                    │                  │
                    ▼                  ▼
             route normally      claim it atomically
                    │            (SUSPENDED → ACTIVE)
          starts a workflow?           │
                    │                  ▼
                    ▼            load step + state
              create run               │
                    │                  ▼
                    └──────►  RUN THE STEP FUNCTION
                              (state, input) → (nextStep, state, status)
                                       │
                                       ▼
                              SAVE to workflow_runs
                                       │
                         ┌─────────────┼──────────────┐
                         ▼             ▼              ▼
                     SUSPENDED     COMPLETED        FAILED
                     ask the       reply with       clean error,
                     user, stop    the result       state kept
```

**A workflow = steps + state + status, stored in a table.**

**Suspend = save and stop. Resume = load and continue. Nothing waits in memory.**

**Save before you reply. State must be plain JSON.**

**Claim a run atomically so it can't be resumed twice.**

**Hand-rolled first, framework second: nodes = steps, checkpointer = your table, thread id = sessionId.**
