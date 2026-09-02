/**
 * POST /api/progress — AEO progress report (Four Layers) · 1.50 USDC
 *
 * Generates a structured AEO progress report using the Four Layers framework:
 * SXO (search experience), AIO (AI optimisation), GEO (generative engine),
 * AEO (answer engine). Scores each layer and gives next 3 actions.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { requirePayment, buildPaymentReqs, buildBazaarExtension, send402 } from "./_x402-gate.js";
import { runAgent } from "../src/agent.js";

const PRICE_USDC    = 1.50;
const BASE_URL      = () => process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com";
const RESOURCE_URL  = () => `${BASE_URL()}/api/progress`;
const RESOURCE_DESC = "AI search visibility progress report — Four Layers scoring (SXO/AIO/GEO/AEO), what's working, gaps, and your next 3 highest-impact actions. 1.50 USDC.";

const BAZAAR = buildBazaarExtension({
  serviceName:      "AEONOS — Progress Report",
  queryDescription: "URL or business to report on. E.g. 'Generate a progress report for mysite.com'.",
  queryExample:     "Generate an AEO Four Layers progress report for mysite.com",
  outputExample:    "# AEO Progress Report: mysite.com\n\n## Four Layers Scores\n- SXO: 72/100\n- AIO: 58/100\n- GEO: 44/100\n- AEO: 61/100\n\n## What's Working\n...\n\n## Next 3 Actions\n...",
});

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Payment-Signature, X-Payment, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, PAYMENT-SIGNATURE");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" || (req.method === "POST" && !req.body?.query)) {
    return send402(res, buildPaymentReqs(PRICE_USDC), BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body      = req.body;
  const query     = body?.query || body?.message || "";
  const caller_id = body?.caller_id || "anon";

  const paymentHeader = await requirePayment(req, res, PRICE_USDC, BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  if (paymentHeader === null) return;

  try {
    const directive = `Generate a structured AEO progress report using the Four Layers framework. Score each layer (SXO, AIO, GEO, AEO) out of 100. For each layer: current score, what's working, what's not. End with the next 3 highest-impact actions to improve AI search visibility. Use any stored memory for this caller to personalise the report.\n\nQuery: ${query}`;
    const result = await runAgent({ query: directive, caller_id });

    await Promise.all([
      db.from("query_log").insert({
        caller_id, query,
        norg_data_used: result.tool_calls_made.includes("queryLiveResearch"),
        knowledge_entries_hit: result.tool_calls_made.filter((t: string) => t === "retrieveSharedAEO").length,
        response_tokens: result.tokens_used,
        payment_usdc: PRICE_USDC,
      }),
      db.from("caller_memory").upsert(
        { caller_id, query_count: 1, updated_at: new Date().toISOString() },
        { onConflict: "caller_id" }
      ),
    ]);

    return res.json({
      status:    "completed",
      artifact:  { parts: [{ type: "text", text: result.response }], index: 0 },
      tool_calls: result.tool_calls_made,
      tokens:    result.tokens_used,
    });
  } catch (e: any) {
    console.error("[aeonos/progress]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
