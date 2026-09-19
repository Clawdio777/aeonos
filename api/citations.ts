import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkCitationsRaw } from "../src/tools.js";
import { runWithCosts, totalCost } from "../src/costs.js";

/**
 * Direct live citation check for Pemba (19/09/2026). Same sampler the agent uses, without the Sonnet
 * orchestration around it: about a quarter of the cost per run. Auth: PEMBA_API_KEY bearer, no x402.
 * POST { domain, queries: string[], samples?: number } -> { domain, engines, unavailable, costs, cost_usd }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!token || token !== (process.env.PEMBA_API_KEY || "").trim()) return res.status(401).json({ error: "Unauthorized" });

  const { domain, queries, samples } = (req.body ?? {}) as { domain?: string; queries?: string[]; samples?: number };
  if (!domain || !Array.isArray(queries) || !queries.length) return res.status(400).json({ error: "domain and queries[] are required" });
  const n = Math.min(Math.max(1, Number(samples) || 1), 5);

  try {
    const { result, costs } = await runWithCosts(() => checkCitationsRaw(domain, queries.slice(0, 6), n));
    return res.status(200).json({
      domain,
      queries: queries.slice(0, 6),
      samples: n,
      engines: {
        chatgpt: result.chatgpt,
        gemini: result.gemini,
        google_ai: result.googleAIO,
        google_ai_mode: result.googleAIMode,
        perplexity: result.perplexity,
        claude: result.claude,
      },
      unavailable: result.unavailable,
      competitors: result.competitors,
      costs,
      cost_usd: totalCost(costs),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "citation check failed" });
  }
}
