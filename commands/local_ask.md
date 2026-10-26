---
description: Send a question or instruction to the local model and show its answer.
argument-hint: <question>
allowed-tools: mcp__local-llm__local_ask, Read
---

<!-- Generated from src/prompts.ts by `npm run commands`. Edit there, not here. -->

Request: $ARGUMENTS

If the request is empty, ask the user what to send.

Answer the request with local_ask. If it refers to a file or command output, read it yourself and include the relevant part in the prompt. Pick maxTokens to fit the expected answer length (160 is about 10 seconds). Present the answer with the model name and time taken.

Ground rules:
- Use the local-llm tools for the generation step; do the reading, trimming and checking yourself. The local model has no file access, no repo context and no memory between calls, so every call must carry all the text it needs.
- Keep maxTokens tight: locally it runs at roughly 16 tokens per second.
- Stay on the default provider unless the user asked for OpenRouter. Never send secrets, keys or private data to provider="openrouter".
- If a call fails because Ollama is unreachable, say so and stop; do not silently do the work yourself instead.
- Treat the reply as a draft. Check it against the source before presenting it, fix what is wrong, and say briefly what you changed.
