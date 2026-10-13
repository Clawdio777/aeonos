import type { VercelRequest, VercelResponse } from "@vercel/node";
import { checkCitationsRaw, MAX_CITATION_QUESTIONS, CITATION_ENGINE_NAMES, type CitationEngineName } from "../src/tools.js";
import { runWithCosts, totalCost } from "../src/costs.js";

/**
 * Direct live citation check for Pemba (19/09/2026). Same sampler the agent uses, without the Sonnet
 * orchestration around it: about a quarter of the cost per run. Auth: PEMBA_API_KEY bearer, no x402.
 * POST { domain, queries: string[], samples?: number, brand_name?: string, location_code?: number, include_answers?: boolean, engines?: string[] }
 *   -> { domain, engines, unavailable, costs, cost_usd }
 * brand_name: an answer naming the business without its web address counts as cited (row.namedSamples).
 * location_code: DataForSEO location for the Google AI surfaces (default 2840, United States).
 * include_answers: every row carries answers[], the full text of each sampled answer (06/10/2026).
 * engines: only these are sampled (chatgpt, gemini, google_ai, google_ai_mode, perplexity, claude); the rest
 *   come back unavailable "not requested". Default all six (13/10/2026).
 * At most 6 questions per call: more is a 400, never a silent drop (13/10/2026). Send the rest in another call.
 */
const ENGINE_NAMES = Object.keys(CITATION_ENGINE_NAMES) as CitationEngineName[];
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  if (!token || token !== (process.env.PEMBA_API_KEY || "").trim()) return res.status(401).json({ error: "Unauthorized" });

  const { domain, queries, samples, brand_name, location_code, include_answers, engines: wanted } = (req.body ?? {}) as {
    domain?: string; queries?: string[]; samples?: number; brand_name?: unknown; location_code?: unknown; include_answers?: unknown; engines?: unknown
  };
  if (!domain || !Array.isArray(queries) || !queries.length) return res.status(400).json({ error: "domain and queries[] are required" });
  if (queries.length > MAX_CITATION_QUESTIONS) {
    return res.status(400).json({ error: `at most ${MAX_CITATION_QUESTIONS} questions per call, got ${queries.length}; send the rest in another call`, max_queries: MAX_CITATION_QUESTIONS });
  }
  let engineKeys: (typeof CITATION_ENGINE_NAMES)[CitationEngineName][] | undefined;
  if (wanted !== undefined) {
    const bad = !Array.isArray(wanted) || !wanted.length || wanted.some((e) => typeof e !== "string" || !ENGINE_NAMES.includes(e as CitationEngineName));
    if (bad) return res.status(400).json({ error: `engines must be a non-empty list of: ${ENGINE_NAMES.join(", ")}` });
    engineKeys = [...new Set((wanted as CitationEngineName[]).map((e) => CITATION_ENGINE_NAMES[e]))];
  }
  const n = Math.min(Math.max(1, Number(samples) || 1), 5);
  const brandName = typeof brand_name === "string" && brand_name.trim() ? brand_name.trim().slice(0, 80) : undefined;
  const loc = Number(location_code);
  const locationCode = Number.isInteger(loc) && loc > 0 ? loc : undefined;
  const opts = { brandName, locationCode, includeAnswers: include_answers === true, engines: engineKeys };

  try {
    const { result, costs } = await runWithCosts(() => checkCitationsRaw(domain, queries, n, opts));
    return res.status(200).json({
      domain,
      queries,
      samples: n,
      engines_requested: wanted !== undefined ? [...new Set(wanted as CitationEngineName[])] : ENGINE_NAMES,
      brand_name: brandName ?? null,
      location_code: locationCode ?? 2840,
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
      valid: result.valid,
      invalidReasons: result.invalidReasons,
      method: result.method,
      costs,
      cost_usd: totalCost(costs),
    });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "citation check failed" });
  }
}
