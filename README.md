# AI Backend — Learning Path

Following [ai-backend-roadmap.md](ai-backend-roadmap.md), step by step, from zero.

Building **DocMind**: upload a PDF, chat with it, generate a quiz from it. Nothing more until each concept genuinely clicks.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env`, get a free key at [Google AI Studio](https://aistudio.google.com/), add it as `GEMINI_API_KEY`

## Working on more than one machine

Git is the only thing that carries code between machines (never Drive/OneDrive/USB), and `.env` is copied by hand — it's not in the repo.

- One branch per machine/task (e.g. `Streaming-branch` on one laptop, another branch on the other) so pushes never collide; merge to `main` through a PR when a piece is done
- Start a session with `git pull --rebase`, end it with `git push`
- Once one branch is merged, rebase the other onto `main` (`git fetch && git rebase origin/main`) before continuing, so they don't drift apart
- Separate branches only *delay* conflicts to merge time — avoid editing the same file on both machines

## Learning

- [PROGRESS.md](PROGRESS.md) — the tracker, always check this for what to do next
- [topics/README.md](topics/README.md) — how the notes folder is organized
- [topics/OVERVIEW.md](topics/OVERVIEW.md) — the stack and what each concept teaches
