#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { baseUrl, defaultModel, generate, hasOwnNone, listModels, matchLabel, NONE } from "./ollama.js";

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
      "or edits on disk, do it yourself or use codex_start.",
    inputSchema: {
      prompt: z.string().min(1).describe("The full question or instruction. No conversation context is carried over."),
      system: z.string().optional().describe("Optional system prompt to set role or output format."),
      model: z.string().optional().describe(`Model tag. Defaults to ${defaultModel()}.`),
      maxTokens: z
        .number()
        .int()
        .positive()
        .max(4096)
        .optional()
        .describe("Cap on generated tokens. Roughly 16 tokens per second, so 160 is ~10s."),
      temperature: z.number().min(0).max(2).optional().describe("Defaults to 0 for repeatable output."),
    },
  },
  async ({ prompt, system, model, maxTokens, temperature }) => {
    try {
      const r = await generate({ prompt, system, model, maxTokens, temperature });
      return text({
        answer: r.text,
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
      "risky. Cheap and private; use it where a wrong answer is cheap for you to detect.",
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
      model: z.string().optional().describe(`Model tag. Defaults to ${defaultModel()}.`),
    },
  },
  async ({ content, labels, instruction, allowNone, model }) => {
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
      const r = await generate({
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
    title: "List local models",
    description:
      "List the models Ollama has on disk, with sizes, plus which one this server uses by " +
      "default. Call it when a request names a model you are not sure exists.",
    inputSchema: {},
  },
  async () => {
    try {
      const models = await listModels();
      return text({ endpoint: baseUrl(), defaultModel: defaultModel(), models });
    } catch (err) {
      return failed((err as Error).message);
    }
  },
);

// stdout is the MCP transport; anything written there corrupts the protocol.
const transport = new StdioServerTransport();
await server.connect(transport);
