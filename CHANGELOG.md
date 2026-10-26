# Changelog

## Unreleased

### Added

- Slash commands `/local_ask`, `/local_summarize`, `/local_commit`, `/local_triage` and
  `/local_extract`. Each tells the calling model what to send to the local model and how to check the
  reply. Installed into Claude Code with `npm run install-commands`; also served as MCP prompts
  (`/mcp__local-llm__ask` etc.) for any client.

- OpenRouter as an optional second backend. `local_ask` and `local_classify` take
  `provider: "ollama" | "openrouter"`; replies report which provider answered.
- `local_models` can browse OpenRouter's catalogue (`provider: "openrouter"`, `search`) with
  context length and USD price per million tokens, and reports whether OpenRouter is configured.
- Configuration: `LOCAL_LLM_PROVIDER`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
  (default `deepseek/deepseek-v4-flash`), `OPENROUTER_BASE_URL`, `OPENROUTER_TIMEOUT_MS`.

### Changed

- `local_models` still returns OpenRouter status when Ollama is unreachable, instead of failing.
