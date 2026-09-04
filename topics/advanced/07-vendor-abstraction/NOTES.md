# Advanced 07 — Vendor Abstraction

The project is hardcoded to Gemini — interviewers often probe "how would you swap providers?"

## What is it?

-

## Key things to learn

- Why you'd wrap LLM calls behind your own interface instead of calling the SDK directly everywhere
- Differences between provider APIs (Gemini vs OpenAI vs Anthropic) — message format, streaming, function calling shape
- Tradeoff: abstraction adds indirection: only worth it if you actually expect to swap providers or support multiple

## Questions / things that felt unclear

-
