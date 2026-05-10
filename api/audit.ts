/**
 * POST /api/audit — Full AEO/GEO strategy + audit · 1.00 USDC
 *
 * Comprehensive audit covering all four layers: on-page content,
 * technical SEO, authority signals, and AI-specific optimisations.
 * Delivers a P1/P2/P3 implementation roadmap.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { requirePayment, buildBazaarExtension } from "./_x402-gate.js";
import { runAgent } from "../src/agent.js";

const PRICE_USDC = 1.00;
const BASE_URL   = () => process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com";
const RESOURCE_URL  = () => `${BASE_URL()}/api/audit`;
const RESOURCE_DESC = "AEONOS full AEO/GEO audit — comprehensive 4-layer strategy + P1/P2/P3 roadmap. 1.00 USDC.";

const BAZAAR = buildBazaarExtension({
  serviceName:      "AEONOS — Full Audit",
  queryDescription: "URL or business to audit. E.g. 'Audit mysite.com for AI search visibility'.",
  queryExample:     "Audit mysite.com for AEO readiness and give me a full P1/P2/P3 action plan",
  outputExample:    "# AEO Audit: mysite.com\n\n**Overall Score: 62/100**\n\n## P1 — Do This Week\n1. Add FAQPage JSON-LD schema...",
});

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Payment-Signature, X-Payment, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, PAYMENT-SIGNATURE");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") {
    const { requirePayment: rp, buildBazaarExtension: _, ...gate } = await import("./_x402-gate.js");
    const reqs = (await import("./_x402-gate.js")).buildPaymentReqs(PRICE_USDC);
    return (await import("./_x402-gate.js")).send402(res, reqs, BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body      = req.body;
  const query     = body?.query || body?.message || "";
  const caller_id = body?.caller_id || "anon";

  if (!query) {
    const reqs = (await import("./_x402-gate.js")).buildPaymentReqs(PRICE_USDC);
    return (await import("./_x402-gate.js")).send402(res, reqs, BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  }

  const paymentHeader = await requirePayment(req, res, PRICE_USDC, BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  if (paymentHeader === null) return;

  try {
    const directive = `Perform a comprehensive AEO/GEO audit. Cover all four layers: on-page content optimisation, technical SEO, authority signals, and AI-specific optimisations (schema, llms.txt, E-E-A-T, AI inclusion check). Deliver a scored report and a prioritised P1/P2/P3 action plan.\n\nQuery: ${query}`;
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
    console.error("[aeonos/audit]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
