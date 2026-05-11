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

const TOOLS = [
  {
    name:        "aeonos_query",
    description: "Ask AEONOS any AEO/GEO question. Get citation tactics, quick wins, keyword strategy, or AI visibility advice for any website. Returns structured Markdown. 0.05 USDC per call.",
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
        capabilities:    { tools: {} },
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
    return res.json({ jsonrpc: "2.0", id, result: { prompts: [] } });
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
