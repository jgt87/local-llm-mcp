/**
 * Thin client over OpenRouter's OpenAI-compatible chat API.
 *
 * Unlike the Ollama backend, everything sent here leaves the machine and costs
 * money per token. It exists for when the local 7B is too slow or too weak for
 * a job that is still the same shape: short, synchronous, cheap to verify.
 */

import type { GenerateOpts, GenerateResult } from "./ollama.js";

const BASE = (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-v4-flash";

/** Hosted models answer in seconds; a minute is already a stuck request. */
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_MS ?? 60_000);

export function openRouterDefaultModel(): string {
  return DEFAULT_MODEL;
}

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Set it as a user environment variable, then restart the " +
        "session so the server starts with it.",
    );
  }
  return key;
}

async function request(path: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) {
      // OpenRouter puts the useful part in error.message; fall back to the raw body.
      const body = await res.text();
      let detail = body;
      try {
        detail = JSON.parse(body)?.error?.message ?? body;
      } catch {}
      throw new Error(`OpenRouter returned ${res.status} ${res.statusText}: ${detail}`);
    }
    return await res.json();
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") {
      throw new Error(
        `OpenRouter timed out after ${timeoutMs}ms. Lower maxTokens, or raise OPENROUTER_TIMEOUT_MS.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateOpenRouter(opts: GenerateOpts): Promise<GenerateResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const messages = [
    ...(opts.system ? [{ role: "system", content: opts.system }] : []),
    { role: "user", content: opts.prompt },
  ];
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
  };

  const r = await request(
    "/chat/completions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey()}`,
        "x-title": "local-llm-mcp",
      },
      body: JSON.stringify(body),
    },
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  // A 200 can still carry an upstream provider failure.
  if (r.error) throw new Error(`OpenRouter error: ${r.error.message ?? JSON.stringify(r.error)}`);

  const totalSeconds = (Date.now() - started) / 1000;
  const genTokens = Number(r.usage?.completion_tokens ?? 0);
  return {
    text: String(r.choices?.[0]?.message?.content ?? "").trim(),
    // The model that actually answered; differs from the request for routers like openrouter/auto.
    model: String(r.model ?? model),
    genTokens,
    // Wall-clock, so it includes network and queueing — a lower bound on real throughput.
    tokensPerSecond: totalSeconds > 0 ? Math.round((genTokens / totalSeconds) * 10) / 10 : 0,
    totalSeconds: Math.round(totalSeconds * 10) / 10,
  };
}

export interface OpenRouterModel {
  id: string;
  contextLength: number;
  /** USD per million tokens. */
  inputPerM: number;
  outputPerM: number;
}

/** The catalogue is several hundred models, so callers filter by substring. */
export async function listOpenRouterModels(search: string, limit = 40): Promise<OpenRouterModel[]> {
  const json = await request("/models", { method: "GET" }, 15_000);
  const needle = search.trim().toLowerCase();
  const perM = (v: unknown) => Math.round(Number(v ?? 0) * 1e6 * 1000) / 1000;
  return (json.data ?? [])
    .filter((m: any) => !needle || String(m.id).toLowerCase().includes(needle))
    .slice(0, limit)
    .map((m: any) => ({
      id: String(m.id),
      contextLength: Number(m.context_length ?? 0),
      inputPerM: perM(m.pricing?.prompt),
      outputPerM: perM(m.pricing?.completion),
    }));
}
