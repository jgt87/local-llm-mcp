---
description: Classify each item (log lines, errors, files) into your labels with local_classify.
argument-hint: <label,label,...> [file | command | text]
allowed-tools: mcp__local-llm__local_classify, Read
---

<!-- Generated from src/prompts.ts by `npm run commands`. Edit there, not here. -->

Arguments: $ARGUMENTS

The first argument is the comma-separated label set; anything after it is the source. If the source is a file path, read the file. If it is a shell command, run it and use its output. Otherwise treat it as the text itself. With no source, use the most recent list of items in this conversation (log lines, files, errors). If fewer than two labels are given, ask the user for the label set before calling.

Split the source into items — one per line or entry — and call local_classify once per item with the labels. Independent calls can run in parallel. Report a table of item and label, then list separately the items that came back declined=true (none of the labels fit) and matched=false (unclassified). Do not assign those yourself without saying so. A returned label is triage, not a verdict: spot-check a few, and flag any you disagree with.

Ground rules:
- Use the local-llm tools for the generation step; do the reading, trimming and checking yourself. The local model has no file access, no repo context and no memory between calls, so every call must carry all the text it needs.
- Keep maxTokens tight: locally it runs at roughly 16 tokens per second.
- Stay on the default provider unless the user asked for OpenRouter. Never send secrets, keys or private data to provider="openrouter".
- If a call fails because Ollama is unreachable, say so and stop; do not silently do the work yourself instead.
- Treat the reply as a draft. Check it against the source before presenting it, fix what is wrong, and say briefly what you changed.
