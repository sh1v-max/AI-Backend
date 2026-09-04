# 14 — GraphQL + Subscriptions

Added after reviewing a real production AI backend (Learnyst's proximity-ai-ng) — their chat front door is GraphQL over SSE, not plain REST. Not in the base roadmap, which uses simple REST endpoints.

## What is it?

-

## Key things to learn

- GraphQL basics: schema, resolvers, query vs mutation vs subscription
- A subscription resolver as an async generator (`yield`) — how it maps onto SSE under the hood (see [07-streaming-sse](../07-streaming-sse/NOTES.md))
- How GraphQL context carries per-request data (e.g. the verified user) into resolvers — see [15-auth-jwt](../15-auth-jwt/NOTES.md)
- Why a company might pick GraphQL over REST for a chat API (single flexible endpoint, typed schema, native subscription support)

## Questions / things that felt unclear

-
