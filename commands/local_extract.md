---
description: Pull named fields out of text as JSON, then check each value is really there.
argument-hint: <field,field,...> [file | command | text]
allowed-tools: mcp__local-llm__local_ask, Read
---

<!-- Generated from src/prompts.ts by `npm run commands`. Edit there, not here. -->

Arguments: $ARGUMENTS

The first argument is the comma-separated field names; anything after it is the source. If the source is a file path, read the file. If it is a shell command, run it and use its output. Otherwise treat it as the text itself. With no source, use the most recent relevant text in this conversation.

Extract the fields with local_ask. Ask for a single JSON object with exactly those keys, null for any field not present, and no other text. Use temperature 0 and a maxTokens that fits the fields. Parse the reply; if it is not valid JSON, retry once with the parse error in the prompt. Then confirm each non-null value actually appears in the source. Set any that do not to null and say which.

Ground rules:
- Use the local-llm tools for the generation step; do the reading, trimming and checking yourself. The local model has no file access, no repo context and no memory between calls, so every call must carry all the text it needs.
- Keep maxTokens tight: locally it runs at roughly 16 tokens per second.
- Stay on the default provider unless the user asked for OpenRouter. Never send secrets, keys or private data to provider="openrouter".
- If a call fails because Ollama is unreachable, say so and stop; do not silently do the work yourself instead.
- Treat the reply as a draft. Check it against the source before presenting it, fix what is wrong, and say briefly what you changed.
