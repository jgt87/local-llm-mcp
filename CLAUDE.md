# CLAUDE.md

## What this is

An MCP server that answers prompts with a local model through Ollama, **synchronously**. Claude
calls `local_ask` or `local_classify` and gets the answer back in the same turn.

This is the deliberate opposite of the sibling `codex-offload` server. That one exists because
Codex jobs take minutes and must not block; this one exists because a local 7B answers in seconds
and wrapping that in a job store, disk state and polling would be pure overhead. **If a tool here
would need to be polled, it belongs in `codex-offload` instead, not this one.**

## Commands

```sh
npm run build     # tsc -> dist/
npm run watch     # tsc --watch
npm test          # build, then node --test test/*.test.js
```

Tests run against the compiled `dist/`, which is why `npm test` builds first. They cover
`matchLabel` — the label validation — and nothing else. The HTTP path is deliberately uncovered:
exercising it needs a live model, so verify it by driving the built server over stdio with a
JSON-RPC script (initialize → `notifications/initialized` → `tools/call`).

## Layout

- `src/index.ts` — MCP server, tool definitions and their descriptions
- `src/ollama.ts` — HTTP client, plus the pure helpers that keep model output honest

## Configuration

| env | default | meaning |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Ollama endpoint |
| `LOCAL_LLM_MODEL` | `qwen2.5-coder:7b` | default model tag |
| `LOCAL_LLM_TIMEOUT_MS` | `120000` | per-request timeout |

## Notes

**Do not enable the integrated GPU.** On shared-memory hardware the iGPU competes for the same
system RAM, so generation — which is memory-bandwidth-bound — gets *slower*. Measured on a Radeon
890M with llama3.2:3b: **33.7 tok/s on CPU vs 26.2 tok/s** with `OLLAMA_IGPU_ENABLE=1`. Prompt
ingest roughly doubles (285 → 600 tok/s), so the flag is only arguable for long-input /
short-output work, and never as a default. Ollama drops iGPUs by default; leave it that way.

**Throughput sets the tool design.** Measured on CPU: **~34 tok/s for a 3B, ~16 tok/s for a 7B**,
scaling cleanly with size — there is no memory cliff, since 61 GB of RAM means the constraint is
bandwidth, not capacity. At 16 tok/s a 500-token answer costs ~31s, so `maxTokens` is the real
latency lever and short outputs are the only comfortable shape.

**Output is validated, never trusted.** `local_classify` checks the reply against the caller's
label set and returns `matched: false` rather than guessing. This mirrors `codex-offload` pairing
Codex's self-report with a git diff: the delegate says what it did, something independent checks
it. A small model will answer `**error**` or `Answer: error`, so matching is generous about shape —
but it refuses when the reply names two labels, and refuses substrings, so `informational` never
resolves to `info`.

**The escape hatch is on by default, and that default is load-bearing.** Validation catches
malformed and hedged replies but cannot catch a *confidently wrong* one, and a small model asked to
choose will always choose: classifying "the weather in Rotterdam is mild" into
`[database-migration, authentication-bug]` returned `authentication-bug` with `matched: true`. So
`local_classify` offers the model a `none` option unless `allowNone: false`, and reports it as
`declined: true` (never as a match). Measured after the change: the weather case declines, a real
authentication bug with the same labels still classifies correctly, so the hatch does not make the
model shy. `allowNone: false` restores forced choice, and is the right setting only when every
input genuinely belongs to a label.

The hatch is suppressed when the caller's own labels already include `none`, since two ways of
saying nothing-fits would be ambiguous; that case comes back as an ordinary match on the caller's
label. This narrows the failure but does not close it — the model can still decline something it
should have classified, or mislabel within the set. Verification remains the caller's job.

**stdout is the MCP transport.** Anything written there corrupts the protocol. Diagnostics go to
stderr or nowhere.

## When to use this vs the alternatives

Use a local model where **verification is cheaper than generation**, and where a wrong answer is
cheap to notice: triage, classification, summarising long output, boilerplate, commit messages,
extracting fields. Privacy is a real reason too — nothing leaves the machine.

Do not use it for work where a subtly wrong answer is expensive and hard to detect. It has no file
access, no repo context, and no memory between calls. Agentic work belongs with `codex_start`;
judgement belongs with the orchestrator.
