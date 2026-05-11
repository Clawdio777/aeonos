#!/usr/bin/env node
/**
 * AEONOS MCP Server
 *
 * Exposes AEONOS as an MCP tool set for Claude Desktop, Cursor, and other
 * MCP-compatible clients. Handles x402 payments transparently via a
 * pre-funded server wallet configured by the user.
 *
 * Setup:
 *   npm install
 *   AEONOS_PRIVATE_KEY=0x... node mcp-server.mjs
 *
 * Or via Smithery — configure AEONOS_PRIVATE_KEY in the tool settings.
 */

import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";

const BASE_URL = "https://aeonos.basechainlabs.com";
const PRIVATE_KEY = process.env.AEONOS_PRIVATE_KEY;

// ── x402 client setup ────────────────────────────────────────────────────────

function buildX402Fetch() {
  if (!PRIVATE_KEY) return null;
  const account      = privateKeyToAccount(PRIVATE_KEY);
  const transport    = http("https://mainnet.base.org");
  const walletClient = createWalletClient({ account, chain: base, transport });
  const publicClient = createPublicClient({ chain: base, transport });
  const signer       = toClientEvmSigner(
    { address: account.address, signTypedData: m => walletClient.signTypedData(m), readContract: a => publicClient.readContract(a) },
    publicClient
  );
  const evmScheme = new ExactEvmScheme(signer);
  const client    = x402Client.fromConfig({ schemes: [{ x402Version: 2, network: "eip155:8453", client: evmScheme }] });
  return wrapFetchWithPayment(fetch, client);
}

const x402Fetch = buildX402Fetch();

async function callAeonos(path, query, callerId) {
  if (!x402Fetch) {
    return "⚠️ AEONOS_PRIVATE_KEY not configured. Add a Base wallet private key with USDC to use AEONOS tools.";
  }
  const res = await x402Fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ query, caller_id: callerId || "mcp-user" }),
  });
  if (!res.ok) throw new Error(`AEONOS error: HTTP ${res.status}`);
  const data = await res.json();
  return data?.artifact?.parts?.[0]?.text ?? JSON.stringify(data);
}

// ── MCP protocol (stdio JSON-RPC) ────────────────────────────────────────────

const TOOLS = [
  {
    name:        "aeonos_query",
    description: "Ask AEONOS any AEO/GEO question. Get citation tactics, quick wins, keyword strategy, or AI visibility advice for any website. Returns structured Markdown. 0.05 USDC per call.",
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "Your AEO/GEO question or URL to analyse. Examples: 'Give me 3 quick wins for mysite.com', 'How do I get cited by Perplexity for X?'" },
        caller_id: { type: "string", description: "Optional stable ID to activate persistent memory across calls." },
      },
      required: ["query"],
    },
  },
  {
    name:        "aeonos_audit",
    description: "Full AEO/GEO audit of any website. Returns AI readiness score (0–100), four-layer analysis (on-page, technical, authority, AI signals), and P1/P2/P3 action roadmap. 1.00 USDC per call.",
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "URL or business description to audit. Example: 'Audit mysite.com for AI visibility'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
  },
  {
    name:        "aeonos_schema",
    description: "Generate production-ready JSON-LD Schema.org markup. Covers FAQPage, Product, Service, LocalBusiness, HowTo and more. Returns valid JSON-LD ready to inject into <head>. 0.50 USDC per call.",
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "Page URL or description. Example: 'Generate schema for mysite.com/pricing — B2B SaaS $49/mo'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
  },
  {
    name:        "aeonos_llms_txt",
    description: "Generate a complete llms.txt file for any business or website. Structured for ingestion by ChatGPT (GPTBot), Perplexity (PerplexityBot), and Claude (ClaudeBot). Deploy output at /llms.txt. 0.50 USDC per call.",
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "URL or business description. Example: 'Write llms.txt for mysite.com — B2B SaaS for salon booking'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
  },
  {
    name:        "aeonos_progress",
    description: "Score a website across the AEO Four Layers framework: SXO, AIO, GEO, AEO. Returns per-layer scores (0–100), what's working, what's not, and the next 3 highest-impact actions. Uses persistent memory if available. 0.75 USDC per call.",
    inputSchema: {
      type:       "object",
      properties: {
        query:     { type: "string", description: "URL or business to score. Example: 'Four Layers progress report for mysite.com'" },
        caller_id: { type: "string", description: "Optional stable ID for persistent memory." },
      },
      required: ["query"],
    },
  },
];

const TOOL_ROUTES = {
  aeonos_query:    ["/api/agent",    0.05],
  aeonos_audit:    ["/api/audit",    1.00],
  aeonos_schema:   ["/api/schema",   0.50],
  aeonos_llms_txt: ["/api/llms-txt", 0.50],
  aeonos_progress: ["/api/progress", 0.75],
};

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handleRequest(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: "2024-11-05",
      serverInfo:      { name: "aeonos", version: "1.1.0" },
      capabilities:    { tools: {} },
    }});
  }

  if (method === "tools/list") {
    return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    const route = TOOL_ROUTES[name];
    if (!route) return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown tool: ${name}` } });

    try {
      const [path] = route;
      const text = await callAeonos(path, args.query, args.caller_id);
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, error: { code: -32000, message: e.message } });
    }
  }

  // Ignore notifications (no id)
  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

// ── Stdio transport ──────────────────────────────────────────────────────────

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete line
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      handleRequest(JSON.parse(line));
    } catch (e) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
  }
});
