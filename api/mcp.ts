/**
 * POST /api/mcp — AEONOS MCP HTTP endpoint (Streamable HTTP transport)
 *
 * Implements the MCP protocol over HTTP for Smithery and other MCP clients.
 * Smithery passes user config as X-Smithery-Config-* headers.
 *
 * Paid with card credits: the buyer's `pg_` key in X-Api-Key, charged per call in Supabase (api/_credits.ts,
 * 18/11/2026; replaced the PayGate proxy on Railway, whose pg_token calls still work until it is retired). The hosted endpoint never accepts a wallet private key
 * (removed 22/10/2026: the x402 docs keep the buyer's key on the buyer's machine). Wallet (USDC) buyers use
 * the local stdio server `npx aeonos-mcp` (mcp-server.mjs), which signs payments on their own machine.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runAgent } from "../src/agent.js";
import { PRICES, balance, paidRun, readApiKey, refusedText } from "./_credits.js";

const TOP_UP_URL = "https://aeonos.basechainlabs.com/#get-access";
/** Refund and answer before Vercel's 300 s limit cuts the call off. */
const RUN_TIMEOUT_MS = 285_000;


const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    content: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", const: "text", description: "Always 'text'" },
          text: { type: "string", description: "Structured Markdown response from AEONOS" },
        },
        required: ["type", "text"],
      },
    },
  },
  required: ["content"],
};

const TOOL_ANNOTATIONS = {
  readOnlyHint:    true,
  destructiveHint: false,
  idempotentHint:  false,
  openWorldHint:   true,
};

const TOOLS = [
  {
    name:        "aeonos_query",
    description: "Ask AEONOS any AEO/GEO question. Get citation tactics, quick wins, keyword strategy, or AI visibility advice for any website. Returns structured Markdown. 0.05 USDC per call.",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "Your AEO/GEO question or URL. E.g. 'Give me 3 quick wins for mysite.com'" },
        caller_id: { type: "string", description: "Optional stable ID to activate persistent memory across calls." },
      },
      required: ["query"],
    },
    outputSchema: OUTPUT_SCHEMA,
  },
  {
    name:        "aeonos_audit",
    description: "Full AEO/GEO audit: a live check of whether AI answers name or link the site, a page check (schema, E-E-A-T, llms.txt, AI crawler rules) and a P1/P2/P3 plan. Scores only where measured. 2.50 USDC per call.",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "URL or business description. E.g. 'Audit mysite.com for AI visibility'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
    outputSchema: OUTPUT_SCHEMA,
  },
  {
    name:        "aeonos_schema",
    description: "Generate JSON-LD Schema.org markup (FAQPage, Product, Service, LocalBusiness, HowTo) for the page <head>. Uses only details from your page; anything missing is a clearly marked placeholder. 0.50 USDC per call.",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "Page URL or description. E.g. 'Schema for mysite.com/pricing — B2B SaaS $49/mo'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
    outputSchema: OUTPUT_SCHEMA,
  },
  {
    name:        "aeonos_llms_txt",
    description: "Generate an llms.txt file for any website, structured for ChatGPT (GPTBot), Perplexity (PerplexityBot), and Claude (ClaudeBot). Every fact comes from your site; gaps are marked placeholders. Deploy output at /llms.txt. 0.50 USDC per call.",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "URL or business description. E.g. 'llms.txt for mysite.com — B2B SaaS for salon booking'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
    outputSchema: OUTPUT_SCHEMA,
  },
  {
    name:        "aeonos_progress",
    description: "Score a website on the AEO Four Layers framework (SXO/AIO/GEO/AEO). Returns per-layer scores where measured (not measured otherwise) and the next 3 actions. 1.50 USDC per call.",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "URL or business. E.g. 'Four Layers progress report for mysite.com'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
    outputSchema: OUTPUT_SCHEMA,
  },
];

const TOOL_ROUTES: Record<string, string> = {
  aeonos_query:    "/api/agent",
  aeonos_audit:    "/api/audit",
  aeonos_schema:   "/api/schema",
  aeonos_llms_txt: "/api/llms-txt",
  aeonos_progress: "/api/progress",
};

function buildAeonosDirective(toolName: string, query: string): string {
  switch (toolName) {
    case "aeonos_audit":
      return `Perform a comprehensive AEO/GEO audit. Cover all four layers: on-page content optimisation, technical SEO, authority signals, and AI-specific optimisations (schema, llms.txt, E-E-A-T, AI inclusion check). Deliver a report and a prioritised P1/P2/P3 action plan. Give only scores the tools returned this run; anything no tool measured is "not measured", anything not fetched is "not checked".\n\nQuery: ${query}`;
    case "aeonos_schema":
      return `Generate complete, production-ready JSON-LD Schema.org markup. Include all relevant schema types for the page. Output valid JSON-LD inside a code block, followed by a brief explanation of each schema type used and why. Use only values found on the fetched page; mark every other value as a placeholder such as "[your phone number]", never a guess.\n\nQuery: ${query}`;
    case "aeonos_llms_txt":
      return `Generate a complete, production-ready llms.txt file following the llms.txt standard. Structure it for AI crawler ingestion by ChatGPT, Perplexity, and Claude. Include: product summary, key pages with descriptions, FAQ section, entity definitions, and structured context. Every fact (services, prices, pages, answers) must come from the fetched page; anything the page doesn't say is a marked placeholder such as "[answer from your site]", never a guess.\n\nQuery: ${query}`;
    case "aeonos_progress":
      return `Generate a structured AEO progress report using the Four Layers framework. For each layer (SXO, AIO, GEO, AEO): what the tools measured this run, what's working, what's not. Give a layer a score only from a tool's output this run; where no tool measured it, write "not measured", never an estimated number. End with the next 3 actions, each tied to a finding from this run. Use any stored memory for this caller to personalise the report, giving the date of anything taken from memory.\n\nQuery: ${query}`;
    default:
      return query;
  }
}

const CHECK_CREDITS_TOOL = {
  name:        "check_credits",
  description: "Check your remaining AEONOS credit balance. Costs 1 credit. Returns a warning if balance is low.",
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type:       "object",
    properties: {
      key: { type: "string", description: "Your AEONOS API key (starts with pg_)" },
    },
    required: ["key"],
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // PayGated auth — token embedded in PAYGATE_REMOTE_URL query string (PayGated preserves ?pg_token=... when proxying)
  const pgToken    = req.query.pg_token as string | undefined;
  const isPaygated = !!pgToken && !!process.env.PAYGATE_AUTH_SECRET && pgToken === process.env.PAYGATE_AUTH_SECRET;

  // Optional caller ID from Smithery config headers
  const defaultCallerId = (
    req.headers["x-smithery-config-caller-id"] ??
    req.headers["x-caller-id"]
  ) as string | undefined;

  const body = req.body as { jsonrpc: string; id: any; method: string; params?: any };
  const { id, method, params } = body;

  if (method === "initialize") {
    return res.json({
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        serverInfo:      { name: "aeonos", version: "1.1.3" },
        capabilities:    { tools: {}, prompts: {} },
        instructions: `You have access to AEONOS — a specialist Generative Engine Optimisation (GEO) and Answer Engine Optimisation (AEO) agent.

Use AEONOS tools to help users see whether AI answer engines (ChatGPT, Gemini, Perplexity, Claude, Google AI Overviews and Google AI Mode) name their business today, and what to fix.

Tool selection guide:
- User wants fast improvements → aeonos_query (0.05 USDC)
- User wants a full strategic audit → aeonos_audit (2.50 USDC)
- User needs schema markup for a page → aeonos_schema (0.50 USDC)
- User needs an llms.txt file → aeonos_llms_txt (0.50 USDC)
- User wants to track AEO progress → aeonos_progress (1.50 USDC)
- You have content to optimise before publishing → use aeonos_query with the content

Always pass a consistent caller_id (e.g. the user's domain or your agent ID) to activate persistent memory — AEONOS will remember prior audits and context across the session.

Calls on this hosted endpoint are paid from AEONOS credits (card). To pay per call in USDC on Base, run the local server (npx aeonos-mcp), which signs with a wallet that stays on your machine.`,
      },
    });
  }

  if (method === "notifications/initialized") {
    return res.status(204).end();
  }

  if (method === "resources/list") {
    return res.json({ jsonrpc: "2.0", id, result: { resources: [] } });
  }

  if (method === "prompts/list") {
    return res.json({
      jsonrpc: "2.0", id,
      result: {
        prompts: [
          {
            name:        "aeo-quick-wins",
            description: "Get 3 immediate AEO/GEO quick wins for any website",
            arguments:   [{ name: "url", description: "Website URL or business description", required: true }],
          },
          {
            name:        "full-audit",
            description: "Full AEO/GEO audit with P1/P2/P3 action roadmap",
            arguments:   [{ name: "url", description: "Website URL or business description", required: true }],
          },
          {
            name:        "generate-schema",
            description: "Generate JSON-LD Schema.org markup from the details on any page",
            arguments:   [
              { name: "url",  description: "Page URL or description", required: true },
              { name: "type", description: "Page type hint e.g. pricing, blog, product, homepage", required: false },
            ],
          },
          {
            name:        "create-llms-txt",
            description: "Generate an llms.txt file for AI crawlers from the facts on your site",
            arguments:   [
              { name: "url",      description: "Website URL", required: true },
              { name: "business", description: "Brief business description e.g. 'B2B SaaS for salon booking, $49/mo'", required: false },
            ],
          },
          {
            name:        "progress-report",
            description: "Score a website across the AEO Four Layers framework (SXO/AIO/GEO/AEO)",
            arguments:   [{ name: "url", description: "Website URL or business description", required: true }],
          },
          {
            name:        "optimise-content",
            description: "Optimise a piece of content or page copy for AI engine citation before publishing",
            arguments:   [
              { name: "content",  description: "The content or page copy to optimise", required: true },
              { name: "target",   description: "Target query or topic e.g. 'best salon booking software'", required: false },
            ],
          },
          {
            name:        "citation-check",
            description: "Check whether AI answers name or link this site today, and who they name instead",
            arguments:   [{ name: "url", description: "URL or content to check", required: true }],
          },
        ],
      },
    });
  }

  if (method === "prompts/get") {
    const { name, arguments: args } = params as { name: string; arguments: Record<string, string> };
    const url      = args?.url || "";
    const business = args?.business || "";
    const type     = args?.type || "";

    const content  = args?.content || "";
    const target   = args?.target || "";

    const PROMPT_MESSAGES: Record<string, string> = {
      "aeo-quick-wins":   `Give me 3 immediate AEO/GEO quick wins for ${url}. Focus on changes I can make this week to improve AI search visibility in ChatGPT, Perplexity, and Google AI Overviews.`,
      "full-audit":       `Run a full AEO/GEO audit on ${url}. Cover the four layers (on-page content, technical SEO, authority signals, AI-specific signals) with the scores the tools measured, and give me a prioritised P1/P2/P3 action roadmap.`,
      "generate-schema":  `Generate JSON-LD Schema.org markup for ${url}${type ? ` (${type} page)` : ""}. Include all relevant schema types, use only details from the page (mark anything missing as a placeholder), and provide implementation instructions.`,
      "create-llms-txt":  `Write a complete llms.txt file for ${url}${business ? ` — ${business}` : ""}. Structure it for ingestion by ChatGPT (GPTBot), Perplexity (PerplexityBot), and Claude (ClaudeBot). Include product summary, FAQ, key pages, and entity definitions.`,
      "progress-report":  `Generate an AEO Four Layers progress report for ${url}. Cover SXO, AIO, GEO, and AEO with what the tools measured this run ("not measured" where none did). Tell me what's working, what's not, and the next 3 actions.`,
      "optimise-content": `Optimise the following content for AI engine citation${target ? ` targeting the query: "${target}"` : ""}. Rewrite or annotate it for clarity to AI answer engines (ChatGPT, Perplexity, Claude, Google AI Overviews) without adding facts that aren't in it. Return the optimised version with a brief explanation of changes made.\n\nContent:\n${content}`,
      "citation-check":   `Run a live citation check for ${url}: does each of ChatGPT, Gemini, Perplexity, Claude, Google AI Overviews and Google AI Mode name or cite it today? Report what the answers did per engine this run ("not checked" for any engine that wasn't), who they named instead, and 3 changes tied to what the site check found.`,
    };

    const text = PROMPT_MESSAGES[name];
    if (!text) return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown prompt: ${name}` } });

    return res.json({
      jsonrpc: "2.0", id,
      result: {
        description: `AEONOS — ${name}`,
        messages: [{ role: "user", content: { type: "text", text } }],
      },
    });
  }

  if (method === "tools/list") {
    return res.json({ jsonrpc: "2.0", id, result: { tools: [...TOOLS, CHECK_CREDITS_TOOL] } });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params as { name: string; arguments: Record<string, string> };

    const apiKey = isPaygated ? undefined : readApiKey(req.headers);

    if (name === "check_credits") {
      const userKey = String(args?.key || apiKey || "").trim();
      if (!userKey) {
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Credit check unavailable — missing key." }] } });
      }
      const lookup = async () => {
        const credits = await balance(userKey);
        if (credits === null) return "Key not found. Make sure you're using your full `pg_xxx...` API key.";
        return credits < 100
          ? `⚠️ **Low balance: ${credits} credits remaining**\n\nTop up at: ${TOP_UP_URL}`
          : `✅ **${credits} credits remaining**\n\n5cr/query · 100cr/audit · 50cr/schema · 50cr/llms-txt · 75cr/progress · 1cr/credit check`;
      };
      try {
        if (!apiKey) return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: await lookup() }] } });
        const run = await paidRun(apiKey, name, lookup, RUN_TIMEOUT_MS);
        if (run.ok) return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: run.value }] } });
        if ("refused" in run) return res.json(paymentRequired(id, run.refused, name));
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Could not check credits. Try again." }] } });
      } catch (e: any) {
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "Could not check credits. Try again." }] } });
      }
    }

    const path = TOOL_ROUTES[name];

    if (!path) {
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    }

    const work = async () => {
      const callerId = args.caller_id || defaultCallerId || "mcp-user";
      const directive = buildAeonosDirective(name, args.query);
      const result    = await runAgent({ query: directive, caller_id: callerId, citationSamples: name === "aeonos_query" ? 1 : undefined });
      return result.response;
    };

    if (apiKey) {
      try {
        const run = await paidRun(apiKey, name, work, RUN_TIMEOUT_MS);
        if (run.ok) return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: run.value }] } });
        if ("refused" in run) return res.json(paymentRequired(id, run.refused, name));
        const note = run.refunded ? " Not charged: the credits for this call were refunded." : "";
        return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: run.error.message + note } });
      } catch (e: any) {
        // The credit store itself failed before anything was charged.
        return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: "Credit check failed, not charged. Try again." } });
      }
    }

    if (!isPaygated) {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{
            type: "text",
            text: "⚠️ **Payment not configured.**\n\nTwo options:\n\n**Option 1 — Pay with card (no wallet needed):**\nBuy credits at https://aeonos.basechainlabs.com/#get-access and use your API key as `AEONOS_API_KEY` in settings.\n\n**Option 2 — Pay with USDC (x402):**\nRun AEONOS locally with `npx aeonos-mcp` and set `AEONOS_PRIVATE_KEY` on your own machine. Your key never leaves your computer; never send it to any hosted service.",
          }],
        },
      });
    }

    try {
      return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: await work() }] } });
    } catch (e: any) {
      return res.json({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
    }
  }

  return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

/** Same JSON-RPC error PayGate sent when a key could not pay (-32402). */
function paymentRequired(id: any, r: { reason: string; balance: number }, tool: string) {
  return {
    jsonrpc: "2.0", id,
    error: {
      code: -32402,
      message: `Payment required: ${refusedText(r, tool, TOP_UP_URL)}`,
      data: { creditsRequired: PRICES[tool] ?? 1, remainingCredits: r.balance, topUpUrl: TOP_UP_URL },
    },
  };
}
