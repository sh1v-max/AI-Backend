# Advanced 06 — LLM Security

Directly relevant to DocMind: a PDF is untrusted user-uploaded content that gets fed straight into a prompt.

## What is it?

-

## Key things to learn

- Prompt injection — text inside the PDF that tries to override your system prompt ("ignore previous instructions...")
- Data leakage — making sure one user's document/context can't leak into another user's answers
- Output sanitization — never blindly trust or execute what the LLM returns
- Why Kind-B tools (see [10-agents-tool-calling](../../10-agents-tool-calling/NOTES.md)) exist: the LLM should never directly trigger sensitive actions

## Questions / things that felt unclear

-
