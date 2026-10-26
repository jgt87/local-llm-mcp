---
description: Summarise a file, command output, or the last long output in the conversation.
argument-hint: [file | command | text] [focus]
allowed-tools: mcp__local-llm__local_ask, Read
---

<!-- Generated from src/prompts.ts by `npm run commands`. Edit there, not here. -->

Arguments: $ARGUMENTS

The arguments name the source and may add what to focus on. If the source is a file path, read the file. If it is a shell command, run it and use its output. Otherwise treat it as the text itself. If there are no arguments, the source is the most recent long tool output or text in this conversation.

Summarise the source with local_ask. Send it with a system prompt asking for a short plain summary: what happened, anything that failed, and anything needing action. Use maxTokens around 200. If the text is very long, drop repetitive lines (progress bars, repeated warnings) before sending rather than cutting off the end, where errors usually are. Then check every claim in the summary against the source; a summary that invents an error or misses one is worse than none.

Ground rules:
- Use the local-llm tools for the generation step; do the reading, trimming and checking yourself. The local model has no file access, no repo context and no memory between calls, so every call must carry all the text it needs.
- Keep maxTokens tight: locally it runs at roughly 16 tokens per second.
- Stay on the default provider unless the user asked for OpenRouter. Never send secrets, keys or private data to provider="openrouter".
- If a call fails because Ollama is unreachable, say so and stop; do not silently do the work yourself instead.
- Treat the reply as a draft. Check it against the source before presenting it, fix what is wrong, and say briefly what you changed.
