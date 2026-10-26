#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { baseUrl, defaultModel, generate, hasOwnNone, listModels, matchLabel, NONE } from "./ollama.js";
import type { GenerateOpts } from "./ollama.js";
import {
  generateOpenRouter,
  listOpenRouterModels,
  openRouterConfigured,
  openRouterDefaultModel,
} from "./openrouter.js";
import { registerPrompts } from "./prompts.js";

type Provider = "ollama" | "openrouter";

const DEFAULT_PROVIDER: Provider =
  process.env.LOCAL_LLM_PROVIDER === "openrouter" ? "openrouter" : "ollama";

function run(provider: Provider | undefined, opts: GenerateOpts) {
  return (provider ?? DEFAULT_PROVIDER) === "openrouter" ? generateOpenRouter(opts) : generate(opts);
}

const providerArg = z
  .enum(["ollama", "openrouter"])
  .optional()
  .describe(
    `Backend. Defaults to ${DEFAULT_PROVIDER}. "ollama" runs on this machine: private and free, but a ` +
      `~16 tok/s 7B. "openrouter" sends the text to a hosted model (default ${openRouterDefaultModel()}): ` +
      "faster and stronger, but it leaves the machine and is billed per token, so never send secrets " +
      "or private data there.",
  );

const modelArg = z
  .string()
  .optional()
  .describe(
    `Model for the chosen provider: an Ollama tag (default ${defaultModel()}) or an OpenRouter id ` +
      `like "vendor/model" (default ${openRouterDefaultModel()}). local_models lists both.`,
  );

function text(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function failed(message: string) {
  return { ...text(message), isError: true as const };
}

const server = new McpServer({ name: "local-llm", version: "0.1.0" });

server.registerTool(
  "local_ask",
  {
    title: "Ask the local model",
    description:
      "Send a prompt to a local model via Ollama and get the answer back immediately. Runs on " +
      "this machine, so nothing leaves it and there is no API cost. Use it for work where " +
      "checking the answer is cheaper than producing it: summarising long output, drafting " +
      "boilerplate or commit messages, extracting fields from text. It is a small model on CPU " +
      "(~16 tok/s for a 7B), so keep outputs short — `maxTokens` is the main latency lever. " +
      "It has no file access and cannot run anything. For work needing judgement, repo context, " +
      "or edits on disk, do it yourself or use codex_start. provider=\"openrouter\" swaps in a fast " +
      "hosted model when speed or quality matters more than keeping the text on this machine.",
    inputSchema: {
      prompt: z.string().min(1).describe("The full question or instruction. No conversation context is carried over."),
      system: z.string().optional().describe("Optional system prompt to set role or output format."),
      provider: providerArg,
      model: modelArg,
      maxTokens: z
        .number()
        .int()
        .positive()
        .max(4096)
        .optional()
        .describe("Cap on generated tokens. Locally roughly 16 tokens per second, so 160 is ~10s."),
      temperature: z.number().min(0).max(2).optional().describe("Defaults to 0 for repeatable output."),
    },
  },
  async ({ prompt, system, provider, model, maxTokens, temperature }) => {
    try {
      const r = await run(provider, { prompt, system, model, maxTokens, temperature });
      return text({
        answer: r.text,
        provider: provider ?? DEFAULT_PROVIDER,
        model: r.model,
        genTokens: r.genTokens,
        tokensPerSecond: r.tokensPerSecond,
        totalSeconds: r.totalSeconds,
      });
    } catch (err) {
      return failed((err as Error).message);
    }
  },
);

server.registerTool(
  "local_classify",
  {
    title: "Classify text with the local model",
    description:
      "Put a piece of text into one of the labels you supply, using a local model. The reply is " +
      "validated against your label set rather than trusted: if the model answers with something " +
      "outside the list, or hedges between labels, this returns matched=false with the raw reply " +
      "instead of guessing. By default the model may also answer that no label fits, which comes " +
      "back as declined=true. That escape hatch helps but does not hold: a small model will still " +
      "pick a confident in-set label for text that belongs to none of them, so a returned label is " +
      "triage, not a verdict. Set allowNone=false only when a forced choice is genuinely wanted. " +
      "Good for triage — log lines, error vs warning, which files look relevant, is this diff " +
      "risky. Cheap and private; use it where a wrong answer is cheap for you to detect. " +
      "provider=\"openrouter\" uses a hosted model instead: faster, but the text leaves the machine.",
    inputSchema: {
      content: z.string().min(1).describe("The text to classify."),
      labels: z
        .array(z.string().min(1))
        .min(2)
        .max(20)
        .describe("Allowed labels. The answer is checked against these."),
      instruction: z
        .string()
        .optional()
        .describe("Optional extra guidance, e.g. what the labels mean."),
      allowNone: z
        .boolean()
        .optional()
        .describe(
          "Default true: the model may reply that no label fits, returned as declined=true. " +
            "Set false to force a choice, accepting that unrelated text will be mislabelled.",
        ),
      provider: providerArg,
      model: modelArg,
    },
  },
  async ({ content, labels, instruction, allowNone, provider, model }) => {
    // Offered by default: without the escape hatch a small model invents a
    // label for unrelated text every time. It reduces that failure rather than
    // removing it — measured against qwen2.5-coder:7b, plainly unrelated text
    // still draws a confident in-set label often enough that callers must
    // verify. Suppressed when the caller already supplies a "none" label of
    // their own, since two ways of saying nothing-fits would be ambiguous.
    const escape = (allowNone ?? true) && !hasOwnNone(labels);
    const offered = escape ? [...labels, NONE] : labels;

    const prompt =
      `Classify the text below into exactly one of these categories: ${labels.join(", ")}.\n` +
      (instruction ? `${instruction}\n` : "") +
      (escape ? `If none of those categories apply to the text, reply with: ${NONE}\n` : "") +
      `Reply with only the category name and nothing else.\n\nText:\n${content}`;
    try {
      // Short cap: the answer is one word, and it bounds the cost of a model
      // that decides to explain itself anyway.
      const r = await run(provider, {
        prompt,
        model,
        maxTokens: 24,
        temperature: 0,
        system: "You are a precise classifier. Answer with one category name only.",
      });
      const hit = matchLabel(r.text, offered);
      const declined = escape && hit === NONE;
      const label = declined ? undefined : hit;
      return text({
        matched: label !== undefined,
        label: label ?? null,
        declined,
        raw: r.text,
        provider: provider ?? DEFAULT_PROVIDER,
        model: r.model,
        totalSeconds: r.totalSeconds,
        ...(declined
          ? { note: "The model reports that none of the supplied labels fit this text." }
          : label === undefined
            ? { note: "Reply did not resolve to exactly one of the supplied labels. Treat as unclassified." }
            : {}),
      });
    } catch (err) {
      return failed((err as Error).message);
    }
  },
);

server.registerTool(
  "local_models",
  {
    title: "List available models",
    description:
      "List the models each backend offers, plus the defaults this server uses. Without a " +
      "provider it lists the Ollama models on disk and reports whether OpenRouter is configured. " +
      "With provider=\"openrouter\" it searches OpenRouter's catalogue (several hundred models) by " +
      "id substring, e.g. search=\"qwen\" or \"anthropic/\", returning ids with USD prices per " +
      "million tokens. Pass a returned id as `model` together with provider=\"openrouter\". Call it " +
      "when a request names a model you are not sure exists.",
    inputSchema: {
      provider: z
        .enum(["ollama", "openrouter"])
        .optional()
        .describe("Which catalogue to list. Omit for the Ollama models plus OpenRouter status."),
      search: z
        .string()
        .optional()
        .describe("OpenRouter only: case-insensitive substring of the model id. Omit for the first 40."),
    },
  },
  async ({ provider, search }) => {
    try {
      if (provider === "openrouter") {
        const models = await listOpenRouterModels(search ?? "");
        return text({
          provider,
          configured: openRouterConfigured(),
          defaultModel: openRouterDefaultModel(),
          shown: models.length,
          models,
        });
      }
      const openrouter = {
        configured: openRouterConfigured(),
        defaultModel: openRouterDefaultModel(),
        note: 'Call again with provider="openrouter" and a search term to browse its models.',
      };
      try {
        const models = await listModels();
        return text({ defaultProvider: DEFAULT_PROVIDER, endpoint: baseUrl(), defaultModel: defaultModel(), models, openrouter });
      } catch (err) {
        // Ollama being down should not hide that the other backend is usable.
        if (provider === "ollama") throw err;
        return text({ defaultProvider: DEFAULT_PROVIDER, ollamaError: (err as Error).message, openrouter });
      }
    } catch (err) {
      return failed((err as Error).message);
    }
  },
);

registerPrompts(server);

// stdout is the MCP transport; anything written there corrupts the protocol.
const transport = new StdioServerTransport();
await server.connect(transport);
