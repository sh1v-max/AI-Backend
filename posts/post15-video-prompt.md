You are a creative developer and motion designer. Build a short, polished product film for my project DocMind, entirely with code, using React and Remotion. I'll post it on LinkedIn and X alongside a progress update.

Treat this as a small motion design project: composition, typography, pacing and visual storytelling matter as much as the code. This video is about one new thing in DocMind: **the chat is now a small agent**. When you ask about your PDF, the model decides what to search for, calls a search tool, reads the results, and answers, and the chat shows each step live ("Searching for …") instead of loading dots. The video should show that mechanism working, not just flash UI screens. Think of a calm launch film for a developer tool with a strong look, not a trailer and not a "top 5 features" template.

Work in your own environment and don't stop to ask me questions. Everything you need is in this message and the attached screenshots. If something is missing, make a sensible choice and note it.

PROJECT DETAILS

Project: DocMind, an AI backend learning project. You upload a PDF, chat with it (answers come only from your documents, with the passages they used), and get a 5-question quiz from it. Built from scratch to understand how AI backends work: embeddings, vector search, RAG, streaming, structured output, queues, and now agents and tool calling.
Author: Shiv Shankar Singh (GitHub: sh1v-max)
Live app: docmind-jet.vercel.app
Repo (public, read it if you can browse; otherwise use what's below): github.com/sh1v-max/AI-Backend
Duration: about 32–38 seconds
Aspect ratio: 4:5 at 1080x1350 (primary, for the LinkedIn mobile feed). Also render a 16:9 1920x1080 cut for X if time allows.
Audience: hiring managers, backend / full-stack engineers and recruiters. They scroll fast, usually muted, and can tell real engineering from a buzzword montage.

ATTACHED SCREENSHOTS (dark mode, taken from the live app on 2026-11-04, 2560x1720 = a 1280x860 window at 2x; the sidebar is on the left, the chat column on the right)

- home.png: the empty new-chat screen ("What do you want to know?", the composer with the paperclip, "Try our sample")
- status.png: the follow-up "and who founded it?" mid-stream, with the status line next to the thinking dots: `Searching for "who founded the Lantern Festival"…`. The first answer ("What is the Lantern Festival?") is above it
- answer.png: the same follow-up finished: "The Lantern Festival was founded in 1902 by a fisherman named Tomas Reyk…", with "3 sources" and Copy
- answer-sources-open.png: the same, with the sources list opened (the passages the answer used)
- documents-status.png: "Which documents do I have?" mid-stream: `Checking your documents…`
- documents.png: its answer, "You have one document: velmora_guide.pdf." (no sources: it listed files, it didn't search)
- offtopic.png: "What's the capital of France?" → "I only answer questions based on your uploaded documents, so I can't answer that!…"
- offer.png: "quiz me on this" → "I can make a 5-question multiple-choice quiz from velmora_guide.pdf. Want it?" with the green **Create quiz** button
- quiz.png: the quiz modal after clicking (question 1 "When was the Velmora lighthouse built?" with 1874 / 1890 / 1950 / 1921)

The sidebar says "Guest" and shows no email; nothing private is in any of them.

Look at every image before using it. Keep proportions, never stretch, and pick tight crops that prove the line on screen (the status line, the button, the sources chip), not whole pages. If a screenshot is missing, rebuild that piece of UI in React from the tokens below instead of inventing a different look. Crop out anything that shows an email address, a token or an API key.

VISUAL IDENTITY (the app's real tokens, from frontend/src/index.css, dark theme)

- Surfaces: background #17191a, surface #202323, muted surface #26292a, border #33383a.
- Text: foreground #f4f4f5, muted #a1a1aa.
- The accent is green #4ade80 (hover #22c55e, soft fill rgba(74,222,128,0.12), text on accent #052e16). It's the only loud colour. Destructive red #f87171 only for an error/“blocked” mark, if at all.
- Fonts: Space Grotesk (headings, semibold/bold, tight tracking), DM Sans (body), and a monospace for labels, tool calls, code and logs (JetBrains Mono via @remotion/google-fonts; the app uses the system mono). Load them with @remotion/google-fonts.
- Logo: a rounded square (border-radius 30%) in #4ade80 with a filled four-point "sparkle" icon in #052e16 inside it (Phosphor's Sparkle, fill weight), next to the word "DocMind" in Space Grotesk semibold.
- Radii: 6 / 10 / 16 px. Cards: surface background, 1px border, radius 10–16. The chat is a centred column (760px in the app).
- Motifs to reuse: the three thinking dots with a status line beside them; a "3 sources" chip; a monospace tool-call chip like `searchDocuments({ query: "…" })`; a small step counter "step 1/3".
- Easing everywhere: cubic-bezier(0.16, 1, 0.3, 1).
- The look is calm, clean, dark, "developer tool": depth from layering and gentle scale, not glow, lens flares or heavy gradients.

REAL CONTENT YOU CAN USE (don't invent claims beyond this)

- Before: a document question ran one fixed recipe: embed the raw message → top 3 chunks → answer. A follow-up like "and who founded it?" was searched with exactly those words.
- Now (document questions): an agent loop. Gemini (Flash-Lite) gets two tools: `searchDocuments({ query })`, where the model writes the query, and `listDocuments()`. It may call them, read the results, and answer.
- The model never gets a user id or document id: those come from the server code (the logged-in user and the current chat). So the tools can only see the user's own files.
- Max 3 model calls; the last one is sent without tools, so it must answer. Real questions used 2 (search → answer).
- Every step streams to the browser as events: `status` ("Searching for …", "Checking your documents…") → `sources` → the answer text → `done`.
- The demo conversation (from a made-up test PDF about a town called Velmora; you may show it as a demo, never as a customer document):
  - "When was the lighthouse built, and by whom?" → "built in 1874 by the engineer Orla Vantris", 3 sources
  - "What is the Lantern Festival?" then "and who founded it?" → status `Searching for "who founded the Lantern Festival"…` → "founded in 1902 by a fisherman named Tomas Reyk"
  - "Which documents do I have?" → `Checking your documents…` → "You have one document: velmora_guide.pdf." (no search)
  - "quiz me on this" → the code-written offer "I can make a 5-question multiple-choice quiz from velmora_guide.pdf. Want it?" + a **Create quiz** button. 0 model calls for the offer; the quiz is generated only on the click.
  - "What's the capital of France?" → "I only answer questions based on your uploaded documents, so I can't answer that!"
- Same 9 test questions, old pipeline vs agent: 8/9 vs 9/9. On the follow-up, the old pipeline's right passage won by 0.002 (luck); the agent's rewritten query found it clearly.
- Live timings (one good day, Nov 4): status after 2.0 s, sources 2.4 s, first words 3.0 s.
- Before the agent, a router sorts each message (small talk / document question / quiz request); that was the previous post. You can show it as one quick beat, not the focus.
- Stack: Node.js, TypeScript, Express, Postgres + pgvector (Neon), Drizzle, Gemini, Zod, BullMQ, React.

Do NOT claim: multi-agent, autonomous, "AI that does anything", a framework (no LangChain/LangGraph, it's hand-written), user numbers, a trained or fine-tuned model, "100% accurate", "zero hallucinations", benchmarks (9 questions is a small test set), or that a typed "yes" starts the quiz (it doesn't yet; that's the next phase). Don't put OpenAI, GPT, Claude or LangChain on screen; the model is Gemini.

REAL CODE (copied from the repo; quote it trimmed only, never rewritten; at most 2 code shots)

From src/services/agent.service.ts, the loop's limit:
  for (let stepNo = 1; stepNo <= AGENT_MAX_STEPS; stepNo++) {
    const lastStep = stepNo === AGENT_MAX_STEPS
    ...
    const { turn, usage, finishReason } = yield* streamTurn({
      systemInstruction,
      contents,
      // the last step gets no tools: it has to answer with what it has
      tools: lastStep ? undefined : tools.declarations,
    })

From src/tools/searchDocuments.tool.ts, the user's scope comes from code, not the model:
  const embedding = await ctx.embed(parsed.data.query)
  // userId + scope from ctx: only this user's ready documents, one or all
  const chunks = await searchSimilar(embedding, SEARCH_TOP_K, ctx.userId, ctx.documentId)

Render code in a card (surface background, 1px border, radius 12, monospace, muted syntax colours, the key line highlighted in green). Highlight one line per shot: `tools: lastStep ? undefined : tools.declarations,` in the first, `ctx.userId, ctx.documentId` in the second.

SIGNATURE MOMENT (build this one best): "It writes its own search"

A two-message chat in the app's style. The user's follow-up "and who founded it?" lands under "What is the Lantern Festival?". Split the frame softly: on the left, the old way, a ghosted search box receives the raw words "and who founded it?" and returns three dim, uncertain chunks with a muted note "won by 0.002". On the right, the new way: a small monospace tool-call chip types itself out, `searchDocuments({ query: "who founded the Lantern Festival" })`, with a tiny "step 1/3" counter. The same text appears in the chat as the status line next to the thinking dots, `Searching for "who founded the Lantern Festival"…`. A "3 sources" chip slides in, the counter ticks to "step 2/3", and the answer streams in word by word: "Tomas Reyk". The left side fades out. It should read as "the model turns your words into a better search, and you can watch it happen". This is a reconstruction of the flow, not a recording.

STORY AND STRUCTURE

Start with a short storyboard: for each scene, what the viewer sees, what they should understand, the on-screen copy, the duration, and how it hands off to the next. Then build it without waiting for my approval.

Starting narrative (adapt it, don't pad it):

1. Hook (~3s): a chat bubble "and who founded it?" and, next to the thinking dots, the status line types out `Searching for "who founded the Lantern Festival"…`. Copy: "My PDF chat shows what it's searching for." Readable in the first second.
2. The loop (~5s): a small diagram built in React: question → model → `searchDocuments` → results → model → answer, with "max 3 calls" and "last call: no tools, must answer" as small mono labels. A side tool, `listDocuments`, is shown too. Copy: "The model picks the search. My code runs it."
3. Signature (~9s): "It writes its own search", see above. Copy across the beat: "Raw words: lucky match." / "Rewritten query: clear match."
4. Your files only (~4s): the tool card with `userId` and `documentId` sliding in from a "server" side, not from the model; the second code card with `ctx.userId, ctx.documentId` highlighted. Copy: "The model never sees a user id."
5. More than search (~6s), three quick beats, each a tight crop: "Which documents do I have?" → `Checking your documents…` → the file list; "capital of France?" → "I only answer from your documents"; "quiz me on this" → the offer + **Create quiz** button, a cursor clicks it, the quiz modal rises. Small mono note on the offer: "0 model calls until you click".
6. Proof (~4s): two scorecards: "old pipeline 8/9" and "agent 9/9", small muted caption "same 9 test questions". Then a timing strip: "status 2.0 s · sources 2.4 s · first words 3.0 s". Copy: "Streamed, step by step."
7. Close (~4s): the DocMind logo, "docmind-jet.vercel.app", "Shiv Shankar Singh · github.com/sh1v-max", and a small mono line "Phase 7 done · agents & tool calling". Hold the final frame for at least 2 seconds.

MOTION DIRECTION

- Use cubic-bezier(0.16, 1, 0.3, 1), short staggers (~0.08–0.1s), small y-offset fade-ups, and gentle scale from 0.96 to 1. Use spring() with high damping, nothing bouncy.
- Text that the app streams (status lines, the answer) should appear word by word, like the real stream; tool-call chips type character by character in monospace.
- Information appears in reading order: when the copy names something, its visual arrives in the same beat.
- Vary the rhythm: the three beats in scene 5 are quick; the signature moment breathes; the close holds.
- No glitch effects, film burns, lens flares, shaking or heavy rotation. Nothing moves without a reason.

TYPOGRAPHY AND COPY

- Short, specific lines. "The model never sees a user id" beats "Enterprise-grade AI security".
- At most ~8 words of headline on screen at once (code, tool-call and diagram cards excepted), readable on a phone playing a muted video.
- Space Grotesk for headlines, DM Sans for supporting lines, monospace for labels, tool names, events and code.
- Safe margins of at least 80px in 4:5, and keep the bottom ~150px clear of key text (LinkedIn's UI covers it).

AUDIO

Optional. If added, use royalty-free music with a swappable file and the volume in config. The video must work fully muted.

IMPLEMENTATION

- Reusable components (BrandMark, ChatColumn, MessageBubble, ThinkingStatus, SourcesChip, ToolCallChip, StepCounter, AgentLoopDiagram, OfferButton, QuizCard, CodeCard, ScoreCard, KineticTitle) and one component per scene.
- Put all copy, colours, fonts, asset paths, crop rectangles, timings and scene durations in one config file.
- Build both aspect ratios from the same scenes with layout switches, not two copies of the code.
- Build the whole sequence rough first, then polish the signature moment, then the rest.

REVIEW AND REFINEMENT

Render stills of at least one frame per scene (both ratios if you make both) and actually look at them. Check that:
- The hook communicates within a second.
- A non-engineer gets the story: you ask → the model decides what to search → your own files only → you watch it happen → the answer arrives with its sources.
- Nothing claims a typed "yes" starts the quiz, or anything beyond the content above.
- Each scene has one focal point; text is readable at phone size and stays on screen long enough.
- The code shown matches the code above exactly (trimmed only).
- No email, token or API key appears anywhere.
- Screenshots are sharp and not stretched.
- The ending holds.

Fix any scene that feels rushed, crowded or repetitive, then render the final versions.

DELIVERABLES

- The storyboard.
- Rendered MP4s (4:5, plus 16:9 if made), as downloadable files.
- The full Remotion project as a downloadable zip, so I can tweak it locally.
- A short note on how to change copy, durations, colours, timings and crops.
