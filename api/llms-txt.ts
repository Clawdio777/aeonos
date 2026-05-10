/**
 * POST /api/llms-txt — llms.txt file generation · 0.50 USDC
 *
 * Generates a complete llms.txt file structured for AI crawler ingestion.
 * Follows the llms.txt standard: product summary, FAQs, key pages,
 * entity definitions, and structured context for ChatGPT/Perplexity/Claude.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { requirePayment, buildPaymentReqs, buildBazaarExtension, send402 } from "./_x402-gate.js";
import { runAgent } from "../src/agent.js";

const PRICE_USDC    = 0.50;
const BASE_URL      = () => process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com";
const RESOURCE_URL  = () => `${BASE_URL()}/api/llms-txt`;
const RESOURCE_DESC = "AEONOS llms.txt generator — structured AI-crawler file for ChatGPT, Perplexity & Claude ingestion. 0.50 USDC.";

const BAZAAR = buildBazaarExtension({
  serviceName:      "AEONOS — llms.txt Generator",
  queryDescription: "Business URL or description to generate llms.txt for. E.g. 'Write llms.txt for my SaaS product'.",
  queryExample:     "Write a complete llms.txt file for mysite.com — it's a B2B SaaS for beauty salon booking",
  outputExample:    "# mysite.com\n\n> AI booking software for beauty salons\n\n## Product\n...\n\n## FAQ\n...",
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
    const directive = `Generate a complete, production-ready llms.txt file following the llms.txt standard. Structure it for AI crawler ingestion by ChatGPT, Perplexity, and Claude. Include: product summary, key pages with descriptions, FAQ section answering the most common user questions, entity definitions, and structured context that helps AI systems cite this business accurately.\n\nQuery: ${query}`;
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
    console.error("[aeonos/llms-txt]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
