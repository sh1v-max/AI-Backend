# AI Backend Learning Journey — Day 12 Context (for LinkedIn + Twitter)

## Instructions for Claude

Use the `post-writer-sms` skill to write both a LinkedIn post and a Twitter/X post (or thread) based on everything below. Tone: genuine, technical but accessible, real hands-on progress, not buzzwords, not "excited to announce." Write it in my voice: casual, a bit run-on, no em-dashes, no "not just X but Y" lines. I'm a frontend/full-stack engineer learning AI backend development from scratch, documenting the journey publicly. This is day 12, see `post1.md` through `post11.md` for continuity; post 11 was the "I stopped building and re-read my own code" one (six prompt problems found, plan written, nothing built). Only use facts from this file, and respect "Don't overclaim."

**This one is a real bug story with a fix.** I deployed, found a privacy hole on my own live site, and closed it properly. Lead with the hole, not with "I added auth."

LinkedIn can go longer and narrative. Twitter can be a thread. Strongest angle: "I deployed my app and every visitor could see every uploaded file. A login page alone would have fixed nothing." Second angle: "I made userId a required parameter and TypeScript handed me my to-do list: 15 errors." Third, as a short closer or its own thread: "my rate limiter was limiting nobody."

---

## What I built today

Continuing **DocMind** (upload a PDF, chat with it, generate a quiz, built from scratch to actually understand AI backends). This stretch covers Sep 30 → Oct 5.

### Deployed, then found the hole

On Sep 30 I deployed it: API on Render free, frontend on Vercel. First time it was a real public URL. Then I noticed the document list on the live site showed every file anyone had uploaded. Not a bug in one query, the design simply had no owner anywhere. No `user_id` on documents, none on chat messages. Every visitor was the same "user".

### Authentication vs authorization (this is where it clicked)

My first instinct was "add login". But login only answers *who are you*. Anyone holding a document id could still chat with it, quiz it or delete it, logged in or not. The real fix is the other question: *what is yours*. Every query has to filter by the owner. I knew both words before, this is the first time the difference actually mattered.

### Guests are real users

I didn't want a signup wall in front of a demo. So every visitor silently becomes a guest: a real row in the `users` table and a real JWT. Same middleware, same filters as everyone else, no special "guest mode" code paths. When a guest signs up, the same row gets upgraded in place, same id, so their files stay.

Token details: HS256, sent as `Authorization: Bearer`, 7 days for registered users, 30 for guests (an expired guest token means lost files). `jwt.verify` with the algorithm pinned, never `jwt.decode`. Default deny: the public `/auth` routes are mounted first, then `requireAuth`, then every data route, so a route I add later is protected without me remembering.

### The compiler gave me the to-do list

I made `userId` a **required** parameter on every repository function that reads or deletes user data. Instantly 15 call sites stopped compiling. Those 15 errors were the checklist, I just went down them. The one thing it can't catch: two string arguments swapped. One of my old scripts passed a document id where `userId` goes and still compiled, because both are strings.

### Two leaks I would have missed

- **Vector search.** Chunks don't have an owner, the document does. So similarity search has to join `documents` and filter on `documents.user_id`. Without it, "find the 3 closest chunks" happily returns chunks from someone else's PDF.
- **Chat history.** The user never sees the history query, but it feeds the prompt. Unscoped, someone sending another user's `sessionId` would get the model answering from that person's conversation.

Also: someone else's document returns **404, not 403**. A 403 would confirm the id exists.

Tested live with two guests: neither can see, chat with, quiz or delete the other's documents. Every attempt is a 404 or an empty list.

### A real gotcha: my rate limiter was limiting nobody

`/auth` is rate limited, 20 requests per 15 min per IP. On Render, a request goes **me → Cloudflare → Render's proxy → my app**, and Express's `trust proxy` setting has to equal the number of hops so it finds my real IP. I set 1: the limiter keyed on Render's proxies. I set 2: it keyed on Cloudflare's edge servers, which change per request, so every request got a brand new counter. "Remaining: 19" every single time. No limit at all.

Instead of guessing a third time, I measured. The `RateLimit-Policy` response header contains a hash of the key the limiter used. I compared it with a hash of my own IP (Cloudflare tells you your IP at `/cdn-cgi/trace`). With 3 hops it matched, and the counter finally went 19, 18, 17, 16, 15. A faked `X-Forwarded-For` header didn't change it either.

### Smaller bits

Per-user caps (5 documents for guests, 10 registered), sign in / sign up / log out UI, and a frontend refresh: answers now render as markdown (no raw HTML, since the token sits in localStorage and XSS would steal it), centred chat column, starter questions.

## The bigger takeaway

Security bugs don't crash. The app worked perfectly while showing everyone's files to everyone. The fix wasn't a login screen, it was making "whose is this?" part of every single query, and then letting the type system tell me where I forgot. Same lesson twice this week: don't trust it, prove it. Two guests side by side for the data, a header hash for the rate limiter.

## What's next

Background jobs with BullMQ, so uploading a big PDF doesn't keep the HTTP request open while every chunk gets embedded.

---

## Numbers you can quote
- **15** compile errors from making `userId` required = the to-do list
- **0** files visible across users after the fix (tested live with two guests)
- **404**, not 403, for someone else's document
- **3** proxy hops on Render (tried 1 and 2 first), counter went from stuck at **19** to **19 → 15**
- **5 / 10** document cap (guest / registered), **20** auth requests per **15 min** per IP
- Tokens: **7 days** registered, **30 days** guest
- Built in about **2 days** (Oct 3–4), in 9 steps, each tested against the real database

## Don't overclaim
- No refresh tokens, no server-side logout, no email verification, no password reset, no OAuth. Say so if it comes up.
- The rate limiter's counters live in memory and reset whenever the free server restarts or sleeps. It's a spam guard, not production-grade.
- The leak was "every visitor could see every uploaded file". Don't say private data of strangers was exposed or stolen; there's no evidence of that, and the old data was deleted before the fix.
- No automated tests yet. "Tested" means manual checks against the live and local app.
- I built this with Claude as a pair: it wrote a lot of the code, I reviewed and tested every step. Don't present it as solo typing.

## Hook ideas
1. "I deployed my app. Every visitor could see every file. A login page alone would have fixed nothing."
2. "I made one parameter required and TypeScript gave me my to-do list: 15 errors."
3. "Security bugs don't crash. My app worked perfectly while showing everyone's files."
4. "My rate limiter was limiting nobody. Remaining: 19. Every. Single. Time."
5. "404, not 403. Don't even confirm the file exists."
