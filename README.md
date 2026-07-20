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

## Install

### Prerequisites

- **Node.js 20+**
- **[Ollama](https://ollama.com) running locally**, with at least one model pulled. The server talks
  to it over HTTP and does not start it for you:

```sh
ollama pull qwen2.5-coder:7b
ollama list          # confirm the model is on disk
```

### Build

```sh
git clone https://github.com/jgt87/local-llm-mcp.git
cd local-llm-mcp
npm install
npm run build
```

This produces `dist/index.js`. Note its **absolute** path — every step below needs it.

### Add to VS Code

MCP support is built into current VS Code; if the Command Palette lists `MCP:` commands, you have
it. Pick either route:

**Guided.** Command Palette (`Ctrl+Shift+P`) → **MCP: Add Server** → **Command (stdio)**. Enter
`node` as the command and the absolute path to `dist/index.js` as the argument, then name it
`local-llm`.

**By hand.** Command Palette → **MCP: Open User Configuration** to open your user `mcp.json`
(`%APPDATA%\Code\User\mcp.json` on Windows), and add the server:

```json
{
  "servers": {
    "local-llm": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/path/to/local-llm-mcp/dist/index.js"]
    }
  }
}
```

Use forward slashes on Windows, or escape backslashes as `\\` — a raw `C:\path` is invalid JSON and
the server will silently fail to start.

Non-default Ollama host or model? Add an `env` block alongside `args`:

```json
      "env": { "LOCAL_LLM_MODEL": "llama3.2:3b" }
```

To scope it to one project instead of your whole profile, use **MCP: Open Workspace Folder
Configuration** and put the same `servers` block in `.vscode/mcp.json`. That file can be committed,
which gives everyone on the repo the same tools.

**Verify.** Open the Chat view, switch to **Agent** mode, click **Configure Tools**, and confirm
`local_ask`, `local_classify` and `local_models` appear and are enabled. **MCP: List Servers** shows
the server's status and its logs if it failed to start. If the tools load but every call errors,
Ollama is not running — check `ollama list`.

### Add to Claude Code

```sh
claude mcp add local-llm --scope user -- node /absolute/path/to/dist/index.js
```

Confirm with `/mcp` in a session, or `claude mcp list` from a shell.

### After changing the code

A running server keeps serving the old `dist/`, so rebuild **and** restart it:

```sh
npm run build
```

- **VS Code** — **MCP: List Servers** → select the server → **Restart**. (The experimental
  `chat.mcp.autoStart` setting can do this for you.)
- **Claude Code** — restart the session; MCP servers connect at session start.

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
