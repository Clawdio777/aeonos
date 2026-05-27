/**
 * POST /api/share-of-voice — AI share of voice across multiple brands · 1.50 USDC
 *
 * Runs citation checks for 2-5 brands in parallel across Perplexity, ChatGPT,
 * Google AI Overviews, and Bing/Copilot. Returns share of voice percentages
 * per engine and per query, so you can see exactly where competitors are winning.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { requirePayment, buildPaymentReqs, buildBazaarExtension, send402 } from "./_x402-gate.js";
import { checkCitationsRaw, type CitationSnapshot } from "../src/tools.js";

const PRICE_USDC    = 1.50;
const BASE_URL      = () => process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com";
const RESOURCE_URL  = () => `${BASE_URL()}/api/share-of-voice`;
const RESOURCE_DESC = "AI share of voice — compare 2-5 brands across Perplexity, ChatGPT, Google AI Overviews, and Bing/Copilot. Returns % of queries where each brand is cited per engine. 1.50 USDC.";

const BAZAAR = buildBazaarExtension({
  serviceName:      "AEONOS — Share of Voice",
  queryDescription: "Brands to compare (2-5 domains) and queries to run. E.g. brands: ['pemba.ai','competitor.com'], queries: ['best AI salon software']",
  queryExample:     "Compare share of voice: pemba.ai vs booksy.com vs fresha.com for 'best salon booking app'",
  outputExample:    "## Share of Voice — AI Search\n\n| Brand | Perplexity | ChatGPT | Google AIO | Bing |\n|---|---|---|---|---|\n| pemba.ai | 60% | 40% | 0% | 20% |\n| booksy.com | 20% | 40% | 100% | 60% |",
});

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

function calcShareOfVoice(snapshots: CitationSnapshot[], engine: "perplexity" | "chatgpt" | "googleAIO" | "bing") {
  const totals = snapshots.map((s) => s[engine].cited);
  const sum = totals.reduce((a, b) => a + b, 0);
  return snapshots.map((s, i) => ({
    domain: s.domain,
    cited: s[engine].cited,
    total: s[engine].total,
    share: sum === 0 ? 0 : Math.round((totals[i] / sum) * 100),
  }));
}

function formatTable(rows: { domain: string; cited: number; total: number; share: number }[]) {
  const sorted = [...rows].sort((a, b) => b.share - a.share);
  return sorted.map((r) => `| ${r.domain} | ${r.cited}/${r.total} queries | ${r.share}% |`).join("\n");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Payment-Signature, X-Payment, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, PAYMENT-SIGNATURE");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET" || (req.method === "POST" && !req.body?.brands)) {
    return send402(res, buildPaymentReqs(PRICE_USDC), BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const body      = req.body;
  const brands: string[]  = body?.brands ?? [];
  const queries: string[] = body?.queries ?? [];
  const caller_id: string = body?.caller_id || "anon";

  if (!Array.isArray(brands) || brands.length < 2 || brands.length > 5) {
    return res.status(400).json({ error: "brands must be an array of 2-5 domain strings" });
  }
  if (!Array.isArray(queries) || queries.length < 1) {
    return res.status(400).json({ error: "queries must be a non-empty array of strings" });
  }

  const paymentHeader = await requirePayment(req, res, PRICE_USDC, BAZAAR, RESOURCE_URL(), RESOURCE_DESC);
  if (paymentHeader === null) return;

  try {
    // Run citation checks for all brands in parallel
    const snapshots = await Promise.all(brands.map((brand) => checkCitationsRaw(brand, queries)));

    const engines = ["perplexity", "chatgpt", "googleAIO", "bing"] as const;
    const engineLabels: Record<string, string> = {
      perplexity: "Perplexity",
      chatgpt: "ChatGPT",
      googleAIO: "Google AI Overviews",
      bing: "Bing/Copilot",
    };

    // Build share-of-voice tables per engine
    const engineSections = engines.map((engine) => {
      const rows = calcShareOfVoice(snapshots, engine);
      const hasData = rows.some((r) => r.total > 0);
      if (!hasData) return null;
      return `### ${engineLabels[engine]}\n| Brand | Citations | Share of Voice |\n|---|---|---|\n${formatTable(rows)}`;
    }).filter(Boolean).join("\n\n");

    // Build per-query breakdown: for each query, which brands were cited by which engines
    const queryBreakdown = queries.slice(0, 6).map((query) => {
      const lines = snapshots.map((snap) => {
        const pplxCited = snap.perplexity.results.find((r) => r.query === query)?.cited;
        const gptCited = snap.chatgpt.results.find((r) => r.query === query)?.cited;
        const aioCited = snap.googleAIO.results.find((r) => r.query === query)?.cited;
        const bingCited = snap.bing.results.find((r) => r.query === query)?.cited;
        const engines = [
          pplxCited ? "Perplexity" : null,
          gptCited ? "ChatGPT" : null,
          aioCited ? "Google AIO" : null,
          bingCited ? "Bing" : null,
        ].filter(Boolean);
        return `  - ${snap.domain}: ${engines.length ? `cited by ${engines.join(", ")}` : "not cited"}`;
      });
      return `**"${query}"**\n${lines.join("\n")}`;
    }).join("\n\n");

    // Overall combined share (all engines)
    const overallRows = snapshots.map((snap) => {
      const totalCited = engines.reduce((sum, e) => sum + snap[e].cited, 0);
      const totalQueries = engines.reduce((sum, e) => sum + snap[e].total, 0);
      return { domain: snap.domain, cited: totalCited, total: totalQueries };
    });
    const overallSum = overallRows.reduce((s, r) => s + r.cited, 0);
    const overallTable = [...overallRows]
      .sort((a, b) => b.cited - a.cited)
      .map((r) => `| ${r.domain} | ${r.cited}/${r.total} | ${overallSum === 0 ? 0 : Math.round((r.cited / overallSum) * 100)}% |`)
      .join("\n");

    // Sentiment summary — per brand, overall tone
    const sentimentSummary = snapshots.map((snap) => {
      if (!snap.sentiment.length) return null;
      const counts = { positive: 0, neutral: 0, negative: 0 };
      snap.sentiment.forEach((s) => counts[s.sentiment]++);
      const dominant = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
      const icon = dominant === "positive" ? "🟢" : dominant === "negative" ? "🔴" : "🟡";
      return `${icon} **${snap.domain}**: ${dominant} overall (${counts.positive}P/${counts.neutral}N/${counts.negative}Neg across ${snap.sentiment.length} answers)`;
    }).filter(Boolean).join("\n");

    const report = [
      `## AI Share of Voice — ${brands.join(" vs ")}`,
      `Queries: ${queries.length} | Engines: Perplexity, ChatGPT, Google AI Overviews, Bing/Copilot`,
      "",
      "### Overall Combined Share",
      "| Brand | Citations | Share of Voice |",
      "|---|---|---|",
      overallTable,
      "",
      engineSections,
      "",
      "### Per-Query Breakdown",
      queryBreakdown,
      sentimentSummary ? `\n### Sentiment (how AI engines talk about each brand)\n${sentimentSummary}` : "",
    ].filter((l) => l !== undefined).join("\n");

    await Promise.all([
      db.from("query_log").insert({
        caller_id,
        query: `share-of-voice: ${brands.join(" vs ")}`,
        payment_usdc: PRICE_USDC,
      }),
      db.from("caller_memory").upsert(
        { caller_id, query_count: 1, updated_at: new Date().toISOString() },
        { onConflict: "caller_id" }
      ),
    ]);

    return res.json({
      status:    "completed",
      artifact:  { parts: [{ type: "text", text: report }], index: 0 },
      brands,
      queries,
      snapshots,
    });
  } catch (e: any) {
    console.error("[aeonos/share-of-voice]", e.message);
    return res.status(500).json({ error: e.message });
  }
}
