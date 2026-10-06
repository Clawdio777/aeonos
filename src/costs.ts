import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-run cost accounting (19/09/2026). Every paid call inside an agent run adds to the store for that
 * run; the API response carries the breakdown so the caller (Pemba) can budget on real numbers.
 * Anthropic and DataForSEO costs are exact (token usage / task cost). Perplexity, OpenAI and Gemini are
 * computed from their usage fields at the published per-token and per-request prices below.
 */

export type CostStore = Record<string, number>;

const als = new AsyncLocalStorage<CostStore>();

export function runWithCosts<T>(fn: () => Promise<T>): Promise<{ result: T; costs: CostStore }> {
  const store: CostStore = {};
  return als.run(store, async () => ({ result: await fn(), costs: store }));
}

export function addCost(provider: string, usd: number): void {
  const store = als.getStore();
  if (!store || !Number.isFinite(usd) || usd <= 0) return;
  store[provider] = Math.round(((store[provider] ?? 0) + usd) * 1e6) / 1e6;
}

export function totalCost(costs: CostStore): number {
  return Math.round(Object.values(costs).reduce((a, b) => a + b, 0) * 1e6) / 1e6;
}

// USD per million tokens (input, output). Update when Anthropic changes prices.
const ANTHROPIC_PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [1, 5],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-opus-5": [5, 25],
};

export function anthropicCost(model: string, usage: { input_tokens?: number; output_tokens?: number; server_tool_use?: { web_search_requests?: number } } | undefined): number {
  if (!usage) return 0;
  const [inP, outP] = ANTHROPIC_PRICES[model] ?? ANTHROPIC_PRICES["claude-sonnet-5"];
  const tokens = ((usage.input_tokens ?? 0) * inP + (usage.output_tokens ?? 0) * outP) / 1e6;
  const searches = (usage.server_tool_use?.web_search_requests ?? 0) * 0.01; // US$10 per 1,000 web searches
  return tokens + searches;
}

/** Perplexity sonar: US$1/M input, US$1/M output, US$5 per 1,000 requests (search). */
export function perplexityCost(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  return ((usage?.prompt_tokens ?? 0) * 1 + (usage?.completion_tokens ?? 0) * 1) / 1e6 + 0.005;
}

/** gpt-4.1-mini on the Responses API: US$0.40/M input, US$1.60/M output, plus US$25 per 1,000 web search tool calls. */
export function openaiSearchCost(usage: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | undefined): number {
  const inp = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
  const out = usage?.output_tokens ?? usage?.completion_tokens ?? 0;
  return (inp * 0.4 + out * 1.6) / 1e6 + 0.025;
}

/** Gemini 3.8 Flash with Google Search grounding (ai.google.dev/gemini-api/docs/pricing, 06/10/2026): US$0.75/M input,
 *  US$3.75/M output through 31/12/2026 (doubles from 01/01/2027), plus US$14 per 1,000 searches after 5,000 free a month.
 *  Charged as if the free allowance is used up, so recorded cost errs high. */
export function geminiGroundedCost(usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined): number {
  return ((usage?.promptTokenCount ?? 0) * 0.75 + (usage?.candidatesTokenCount ?? 0) * 3.75) / 1e6 + 0.014;
}
