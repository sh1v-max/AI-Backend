# Advanced 05 — Rate Limiting & Retries

The quiz step (Phase 4) has one-off retry logic — this generalizes that into a real pattern.

## What is it?

-

## Key things to learn

- Exponential backoff — why retrying immediately after a failure makes things worse
- Handling 429 (rate limit) responses specifically vs generic errors
- Circuit breaking — stop calling a failing service instead of hammering it
- Idempotency — safe to retry only if retrying doesn't duplicate side effects

## Questions / things that felt unclear

-
