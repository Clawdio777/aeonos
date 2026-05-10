/**
 * POST /api/schema — JSON-LD schema generation · 0.50 USDC
 *
 * Generates complete JSON-LD Schema.org markup for any page type.
 * Covers: FAQPage, Product, Service, Article, HowTo, LocalBusiness,
 * BreadcrumbList, and custom types based on the page content.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { requirePayment, buildPaymentReqs, buildBazaarExtension, send402 } from "./_x402-gate.js";
import { runAgent } from "../src/agent.js";

const PRICE_USDC    = 0.50;
const BASE_URL      = () => process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com";
const RESOURCE_URL  = () => `${BASE_URL()}/api/schema`;
const RESOURCE_DESC = "AEONOS JSON-LD schema generation — complete Schema.org markup for any page. 0.50 USDC.";

const BAZAAR = buildBazaarExtension({
  serviceName:      "AEONOS — Schema Generator",
  queryDescription: "Page URL or description to generate schema for. E.g. 'Generate JSON-LD for my SaaS pricing page'.",
  queryExample:     "Generate complete JSON-LD schema markup for mysite.com/pricing",
  outputExample:    "```json\n{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"FAQPage\",\n  \"mainEntity\": [...]\n}\n```",
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
    const directive = `Generate complete, production-ready JSON-LD Schema.org markup. Include all relevant schema types for the page. Output valid JSON-LD inside a code block, followed by a brief explanation of each schema type used and why.\n\nQuery: ${query}`;
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
    console.error("[aeonos/schema]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
