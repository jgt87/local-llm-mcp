# local-llm-mcp

An MCP server that answers prompts with a local model via [Ollama](https://ollama.com), synchronously.

Companion to `codex-offload-mcp`. That server exists for slow agentic work that must not block;
this one is for fast, private, low-stakes calls where the answer is wanted in the same turn.

## Tools

| tool | does |
| --- | --- |
| `local_ask` | Prompt in, text out. Summaries, boilerplate, commit messages, extraction. |
| `local_classify` | Sort text into one of your labels. Replies outside the label set are rejected rather than guessed at, and the model can answer that none fit — though a small model will still label plainly unrelated text with confidence, so treat a result as triage, not a verdict. |
| `local_models` | List models Ollama has on disk, and the configured default. |

No file access, no command execution, no memory between calls.

## Setup

```sh
npm install
npm run build
ollama pull qwen2.5-coder:7b
```

Register with Claude Code:

```sh
claude mcp add --scope user local-llm -- node /absolute/path/to/dist/index.js
```

## Configuration

| env | default |
| --- | --- |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` |
| `LOCAL_LLM_MODEL` | `qwen2.5-coder:7b` |
| `LOCAL_LLM_TIMEOUT_MS` | `120000` |

## Performance

Measured on a Ryzen AI 9 HX 370 (CPU inference, 61 GB RAM):

| model | generation | prompt eval |
| --- | --- | --- |
| llama3.2:3b | 33.7 tok/s | ~285 tok/s |
| qwen2.5-coder:7b | 16.0 tok/s | ~120 tok/s |

Keep outputs short — `maxTokens` is the main latency lever. At 16 tok/s, 160 tokens is ~10 seconds.

**Do not set `OLLAMA_IGPU_ENABLE=1`** on integrated-GPU hardware. The iGPU shares system memory
with the CPU, so generation gets *slower* (26.2 vs 33.7 tok/s on a Radeon 890M) even though prompt
ingest doubles.

## Licence

MIT
