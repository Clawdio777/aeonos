/**
 * POST /api/mcp — AEONOS MCP HTTP endpoint (Streamable HTTP transport)
 *
 * Implements the MCP protocol over HTTP for Smithery and other MCP clients.
 * Smithery passes user config as X-Smithery-Config-* headers.
 *
 * User config required:
 *   AEONOS_PRIVATE_KEY — Base wallet private key with USDC for x402 payments
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createWalletClient, createPublicClient, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

const BASE_URL = "https://aeonos.basechainlabs.com";

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
    description: "Full AEO/GEO audit. Returns AI readiness score (0–100), four-layer analysis, and P1/P2/P3 action roadmap. 1.00 USDC per call.",
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
    description: "Generate production-ready JSON-LD Schema.org markup (FAQPage, Product, Service, LocalBusiness, HowTo). Returns valid JSON-LD ready for <head> injection. 0.50 USDC per call.",
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
    description: "Generate a complete llms.txt file for any website. Structured for ChatGPT (GPTBot), Perplexity (PerplexityBot), and Claude (ClaudeBot). Deploy output at /llms.txt. 0.50 USDC per call.",
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
    description: "Score a website on the AEO Four Layers framework (SXO/AIO/GEO/AEO). Returns per-layer scores and the next 3 highest-impact actions. 0.75 USDC per call.",
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

function buildX402Fetch(privateKey: string) {
  const account      = privateKeyToAccount(privateKey as `0x${string}`);
  const transport    = viemHttp("https://mainnet.base.org");
  const walletClient = createWalletClient({ account, chain: base, transport });
  const publicClient = createPublicClient({ chain: base, transport });
  const signer       = toClientEvmSigner(
    { address: account.address, signTypedData: (m: any) => walletClient.signTypedData(m), readContract: (a: any) => publicClient.readContract(a) },
    publicClient
  );
  const evmScheme = new ExactEvmScheme(signer);
  const client    = x402Client.fromConfig({ schemes: [{ x402Version: 2, network: "eip155:8453", client: evmScheme }] });
  return wrapFetchWithPayment(fetch, client);
}

async function callAeonos(path: string, query: string, callerId: string, privateKey: string): Promise<string> {
  const x402Fetch = buildX402Fetch(privateKey);
  const res = await x402Fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ query, caller_id: callerId || "smithery-user" }),
  });
  if (!res.ok) throw new Error(`AEONOS error: HTTP ${res.status} — ${await res.text()}`);
  const data = await res.json() as any;
  return data?.artifact?.parts?.[0]?.text ?? JSON.stringify(data);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Smithery-Config-Aeonos-Private-Key, X-Wallet-Key");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Get wallet key and optional caller ID from Smithery config headers
  const privateKey = (
    req.headers["x-smithery-config-aeonos-private-key"] ??
    req.headers["x-wallet-key"] ??
    process.env.MCP_DEMO_PRIVATE_KEY
  ) as string | undefined;

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
        serverInfo:      { name: "aeonos", version: "1.1.0" },
        capabilities:    { tools: {}, prompts: {} },
        instructions: `You have access to AEONOS — a specialist Generative Engine Optimisation (GEO) and Answer Engine Optimisation (AEO) agent.

Use AEONOS tools to help users get their websites and content cited by AI answer engines: ChatGPT, Perplexity, Claude, and Google AI Overviews.

Tool selection guide:
- User wants fast improvements → aeonos_query (0.05 USDC)
- User wants a full strategic audit → aeonos_audit (1.00 USDC)
- User needs schema markup for a page → aeonos_schema (0.50 USDC)
- User needs an llms.txt file → aeonos_llms_txt (0.50 USDC)
- User wants to track AEO progress → aeonos_progress (0.75 USDC)
- You have content to optimise before publishing → use aeonos_query with the content

Always pass a consistent caller_id (e.g. the user's domain or your agent ID) to activate persistent memory — AEONOS will remember prior audits and context across the session.

Payments are handled automatically via x402 (USDC on Base). Each call deducts from the configured wallet.`,
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
            description: "Generate production-ready JSON-LD Schema.org markup for any page",
            arguments:   [
              { name: "url",  description: "Page URL or description", required: true },
              { name: "type", description: "Page type hint e.g. pricing, blog, product, homepage", required: false },
            ],
          },
          {
            name:        "create-llms-txt",
            description: "Generate a complete llms.txt file for AI crawler ingestion",
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
            description: "Check whether a URL or piece of content is likely to be cited by ChatGPT, Perplexity, or Google AI Overviews — and why not if it isn't",
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
      "aeo-quick-wins":   `Give me 3 immediate AEO/GEO quick wins for ${url}. Focus on changes I can make this week to improve AI search visibility and get cited by ChatGPT, Perplexity, and Google AI Overviews.`,
      "full-audit":       `Run a full AEO/GEO audit on ${url}. Score each of the four layers (on-page content, technical SEO, authority signals, AI-specific signals) and give me a prioritised P1/P2/P3 action roadmap.`,
      "generate-schema":  `Generate complete, production-ready JSON-LD Schema.org markup for ${url}${type ? ` (${type} page)` : ""}. Include all relevant schema types and provide implementation instructions.`,
      "create-llms-txt":  `Write a complete llms.txt file for ${url}${business ? ` — ${business}` : ""}. Structure it for ingestion by ChatGPT (GPTBot), Perplexity (PerplexityBot), and Claude (ClaudeBot). Include product summary, FAQ, key pages, and entity definitions.`,
      "progress-report":  `Generate an AEO Four Layers progress report for ${url}. Score SXO, AIO, GEO, and AEO out of 100. Tell me what's working, what's not, and the next 3 highest-impact actions.`,
      "optimise-content": `Optimise the following content for AI engine citation${target ? ` targeting the query: "${target}"` : ""}. Rewrite or annotate it so ChatGPT, Perplexity, Claude, and Google AI Overviews are more likely to cite it. Return the optimised version with a brief explanation of changes made.\n\nContent:\n${content}`,
      "citation-check":   `Analyse ${url} and tell me: will ChatGPT, Perplexity, Claude, and Google AI Overviews cite this content? Give a yes/no verdict per engine, explain exactly why not where applicable, and list the top 3 changes that would most improve citation likelihood.`,
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
    return res.json({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params as { name: string; arguments: Record<string, string> };
    const path = TOOL_ROUTES[name];

    if (!path) {
      return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });
    }

    if (!privateKey) {
      return res.json({
        jsonrpc: "2.0", id,
        result: {
          content: [{
            type: "text",
            text: "⚠️ **AEONOS_PRIVATE_KEY not configured.**\n\nTo use AEONOS tools, configure a Base wallet private key with USDC in the Smithery connection settings.\n\nGet USDC on Base at coinbase.com/wallet, then add your private key (0x...) as AEONOS_PRIVATE_KEY.",
          }],
        },
      });
    }

    try {
      const text = await callAeonos(path, args.query, args.caller_id || defaultCallerId || "", privateKey);
      return res.json({
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text }] },
      });
    } catch (e: any) {
      return res.json({
        jsonrpc: "2.0", id,
        error: { code: -32000, message: e.message },
      });
    }
  }

  return res.json({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}
