---
description: Draft a commit message for the staged diff with the local model, then check it.
argument-hint: [what the message should mention]
allowed-tools: mcp__local-llm__local_ask, Read, Bash(git diff:*), Bash(git log:*), Bash(git status:*)
---

<!-- Generated from src/prompts.ts by `npm run commands`. Edit there, not here. -->

Context from the user (may be empty): $ARGUMENTS

Draft a commit message with local_ask.

1. Run `git diff --staged`. If nothing is staged, run `git diff` and say the message covers unstaged changes. If there are no changes at all, stop and say so.
2. Run `git log --oneline -10` to see the repository's subject style.
3. Send the diff to local_ask. Leave out lockfiles, binaries and generated output, and trim very large hunks to their headers. System prompt: write a commit message in the style of the example subjects (include them), an imperative subject under 72 characters, then a blank line and a short body explaining why. Output only the message. Use maxTokens around 150.
4. Check the draft against the diff: every claim must be true of the change, and nothing important may be missing. Correct it.
5. Show the final message. Do not commit unless the user asked you to.

Ground rules:
- Use the local-llm tools for the generation step; do the reading, trimming and checking yourself. The local model has no file access, no repo context and no memory between calls, so every call must carry all the text it needs.
- Keep maxTokens tight: locally it runs at roughly 16 tokens per second.
- Stay on the default provider unless the user asked for OpenRouter. Never send secrets, keys or private data to provider="openrouter".
- If a call fails because Ollama is unreachable, say so and stop; do not silently do the work yourself instead.
- Treat the reply as a draft. Check it against the source before presenting it, fix what is wrong, and say briefly what you changed.
