# 15 — Auth (JWT)

Added after reviewing a real production AI backend — every request there is JWT-verified before it reaches the orchestrator (`requireAdmin` in GraphQL context). The base roadmap explicitly skips auth to stay focused on AI concepts; this fills that gap.

## What is it?

-

## Key things to learn

- What's actually inside a JWT (header, payload, signature) and why you can trust it without a DB lookup
- Verifying a token (signature + expiry) vs decoding it — the difference matters
- Where verification happens in a request lifecycle — middleware (Express) vs context construction (GraphQL)
- Role/permission checks after verification (e.g. `requireAdmin`) — authentication vs authorization
- Why you already know this from JWT work elsewhere — this is about wiring it into an AI backend's request path specifically

## Questions / things that felt unclear

-
