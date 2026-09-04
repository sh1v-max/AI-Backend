# 16 — Idempotency & Multi-Tenancy

Added after reviewing a real production AI backend: it rejects duplicate `messageId`s before processing (idempotency), and scopes memory/data by `schoolId` so one tenant never sees another's data (multi-tenancy). Neither concept appears in the base roadmap — DocMind is single-user, single-document.

## What is it?

-

## Key things to learn

**Idempotency**
- Why a client might send the same request twice (retry after a dropped connection, double-click, flaky network)
- Idempotency key pattern: client generates a unique id per logical action, server checks "have I seen this before?" before doing the work
- Where to check — as early as possible, before any side effect runs

**Multi-tenancy**
- What a "tenant" is (a school, a company, an org) — many tenants sharing one system, one database
- Row-level scoping: every query filtered by `tenantId`/`schoolId`, never trusting the client to only ask for its own data
- Why this matters specifically for AI backends: a vector search or LLM context that isn't scoped can leak one tenant's documents into another tenant's answer (see [advanced/06-llm-security](../advanced/06-llm-security/NOTES.md))

## Questions / things that felt unclear

-
