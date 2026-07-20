/**
 * Thin client over Ollama's HTTP API, plus the pure helpers that keep a small
 * model's output honest.
 *
 * Nothing here enables the integrated GPU. On this class of hardware the iGPU
 * shares system memory with the CPU, so token generation — which is
 * memory-bandwidth-bound — gets *slower*, not faster. Measured on a Radeon
 * 890M: 33.7 tok/s on CPU vs 26.2 tok/s with OLLAMA_IGPU_ENABLE=1. Prompt
 * ingest roughly doubles, so the flag is only worth revisiting for
 * long-input/short-output work, and never as a default.
 */

const BASE = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
const DEFAULT_MODEL = process.env.LOCAL_LLM_MODEL ?? "qwen2.5-coder:7b";

/** Generous, because local generation runs ~16 tok/s for a 7B on CPU. */
const DEFAULT_TIMEOUT_MS = Number(process.env.LOCAL_LLM_TIMEOUT_MS ?? 120_000);

export interface GenerateOpts {
  prompt: string;
  system?: string;
  model?: string;
  /** Cap on generated tokens. The main lever on latency — 16 tok/s is ~1s per 16. */
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface GenerateResult {
  text: string;
  model: string;
  genTokens: number;
  tokensPerSecond: number;
  totalSeconds: number;
}

export function defaultModel(): string {
  return DEFAULT_MODEL;
}

export function baseUrl(): string {
  return BASE;
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status} ${res.statusText}: ${await res.text()}`);
    }
    return await res.json();
  } catch (err) {
    const e = err as Error;
    if (e.name === "AbortError") {
      throw new Error(
        `Local model timed out after ${timeoutMs}ms. Lower maxTokens, or raise LOCAL_LLM_TIMEOUT_MS.`,
      );
    }
    if ((e as any).cause?.code === "ECONNREFUSED") {
      throw new Error(`Cannot reach Ollama at ${BASE}. Is the Ollama service running?`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function generate(opts: GenerateOpts): Promise<GenerateResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const started = Date.now();
  const body: Record<string, unknown> = {
    model,
    prompt: opts.prompt,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0,
      ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
    },
  };
  if (opts.system) body.system = opts.system;

  const r = await post("/api/generate", body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const genTokens = Number(r.eval_count ?? 0);
  const genSeconds = Number(r.eval_duration ?? 0) / 1e9;

  return {
    text: String(r.response ?? "").trim(),
    model,
    genTokens,
    tokensPerSecond: genSeconds > 0 ? Math.round((genTokens / genSeconds) * 10) / 10 : 0,
    totalSeconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
  };
}

export async function listModels(timeoutMs = 15_000): Promise<{ name: string; sizeGb: number }[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Ollama returned ${res.status} ${res.statusText}`);
    const json: any = await res.json();
    return (json.models ?? []).map((m: any) => ({
      name: String(m.name),
      sizeGb: Math.round((Number(m.size ?? 0) / 1e9) * 10) / 10,
    }));
  } catch (err) {
    const e = err as Error;
    if ((e as any).cause?.code === "ECONNREFUSED" || e.name === "AbortError") {
      throw new Error(`Cannot reach Ollama at ${BASE}. Is the Ollama service running?`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Match a small model's free-text answer against the allowed labels.
 *
 * The whole case for delegating to a local model is that verification is
 * cheaper than generation, so classification results are *checked*, never
 * taken on trust — the same reason the Codex handoff pairs its self-report
 * with a git diff. A 7B asked for one word will still return "Answer: error."
 * or "**error**", so match generously on shape, but refuse anything genuinely
 * ambiguous rather than guessing.
 */
export function matchLabel(raw: string, labels: string[]): string | undefined {
  const cleaned = raw
    .toLowerCase()
    .replace(/[*_`"'.]/g, "")
    .replace(/^\s*(answer|label|category|classification)\s*:\s*/i, "")
    .trim();
  if (!cleaned) return undefined;

  const lower = labels.map((l) => l.toLowerCase());

  const exact = lower.indexOf(cleaned);
  if (exact >= 0) return labels[exact];

  // Whole-word appearance anywhere in the reply, e.g. "this is an error line".
  const hits: number[] = [];
  for (let i = 0; i < lower.length; i++) {
    const re = new RegExp(`\\b${lower[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (re.test(cleaned)) hits.push(i);
  }
  // Exactly one candidate is a match; several means the model hedged.
  return hits.length === 1 ? labels[hits[0]] : undefined;
}
