/**
 * api/agent.ts — AEONOS: Public Vercel API endpoint
 *
 * Three communication patterns (from joint Google+Anthropic webinar, 05/05/2026):
 *
 *   1. SYNC   POST /api/agent              → immediate response (simple queries < 10s)
 *   2. ASYNC  POST /api/agent?async=true   → returns { task_id, status: "working" }
 *             GET  /api/agent?task_id=xxx  → poll for { status, artifact }
 *   3. STREAM POST /api/agent?stream=true  → SSE stream with progress + final artifact
 *
 * Also handles:
 *   - A2A JSON-RPC 2.0 (any agent built on Google ADK, LangGraph, CrewAI etc.)
 *   - x402 payment gate (USDC on Base)
 *   - Agent card discovery GET /api/agent?agent-card=true
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { HTTPFacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { x402Version as X402_VERSION } from "@x402/core";
import { createFacilitatorConfig } from "@coinbase/x402";
import { declareDiscoveryExtension } from "@x402/extensions";
import { runAgent } from "../src/agent.js";
import { withPlaceholderNotice, DISCOVERY_CALLER_ID_EXAMPLE } from "./_x402-gate.js";
import agentCard from "../public/.well-known/agent.json" with { type: "json" };

// ── Coinbase CDP facilitator for Base mainnet ──────────────────────────────────
// .trim() is critical — Vercel env vars can have trailing newlines
const facilitatorClient = new HTTPFacilitatorClient(
  process.env.CDP_API_KEY_NAME && process.env.CDP_API_KEY_PRIVATE_KEY
    ? createFacilitatorConfig(
        process.env.CDP_API_KEY_NAME.trim(),
        process.env.CDP_API_KEY_PRIVATE_KEY.trim()
      )
    : {}
);

const PRICE_PER_QUERY_USDC = 0.05;
const AGENT_URL = () => `${process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com"}/api/agent`;

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Main handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Payment, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE, PAYMENT-SIGNATURE");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Async task polling ───────────────────────────────────────────────────────
  if (req.method === "GET" && req.query.task_id) {
    return handleTaskPoll(req, res);
  }

  // ── A2A agent card discovery (8004scan, Cursor, Claude Desktop, etc.) ───────
  // POST without payment still returns 402 with bazaar extension for x402 discovery.
  if (req.method === "GET") {
    return res.json(buildAgentCard());
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // ── Parse request ────────────────────────────────────────────────────────────
  const body = req.body;
  const isJsonRpc = body?.jsonrpc === "2.0";
  const isStream  = req.query.stream === "true" || req.headers.accept?.includes("text/event-stream");
  const isAsync   = req.query.async === "true";
  const jsonRpcId = body?.id ?? null;

  let query: string;
  let caller_id: string;

  if (isJsonRpc) {
    query     = body.params?.query || body.params?.message || "";
    caller_id = body.params?.caller_id || extractCallerId(req) || "anon";
  } else {
    query     = body?.query || body?.message || "";
    caller_id = body?.caller_id || extractCallerId(req) || "anon";
  }

  // ── x402 payment gate (x402 v2 protocol) ─────────────────────────────────────
  // v2 uses "payment-signature"; also accept legacy "x-payment" for backward compat
  const xPaymentHeader = (req.headers["payment-signature"] ?? req.headers["x-payment"]) as string | undefined;

  // PayGated internal bypass — already authenticated + billed via credit system
  const internalKey = req.headers["x-internal-key"] as string | undefined;
  if (internalKey && process.env.INTERNAL_API_KEY && internalKey === process.env.INTERNAL_API_KEY) {
    if (!query) return jsonRpcError(res, isJsonRpc, jsonRpcId, -32602, "Missing query");
    const queryCount = await getQueryCount(caller_id);
    try {
      if (isStream) return await handleStream(req, res, query, caller_id, undefined);
      if (isAsync)  return await handleAsync(req, res, query, caller_id, isJsonRpc, jsonRpcId, undefined);
      return await handleSync(req, res, query, caller_id, isJsonRpc, jsonRpcId, undefined, queryCount);
    } catch (e: any) {
      console.error("[aeonos] Error:", e.message, e.stack);
      return jsonRpcError(res, isJsonRpc, jsonRpcId, -32000, e.message);
    }
  }

  // Discovery probe: no query body + no payment = CDP Facilitator or agent discovery probe.
  // Always return 402 so CDP can extract extensions.bazaar and index the service.
  if (!query) {
    if (!xPaymentHeader) {
      return send402(res, buildPaymentRequirements(req));
    }
    return jsonRpcError(res, isJsonRpc, jsonRpcId, -32602, "Missing query");
  }

  // x402 payment gate — always required, no free tier
  const paymentReqs = buildPaymentRequirements(req);

  if (!xPaymentHeader) {
    return send402(res, paymentReqs);
  }

  // Decode payment payload (base64 JSON)
  let paymentPayload: PaymentPayload;
  try {
    paymentPayload = JSON.parse(Buffer.from(xPaymentHeader, "base64").toString("utf8")) as PaymentPayload;
  } catch {
    return send402(res, paymentReqs, "invalid_payment");
  }

  let verifyResult: { isValid: boolean; invalidReason?: string };
  try {
    verifyResult = await facilitatorClient.verify(paymentPayload, paymentReqs);
  } catch (e: any) {
    console.error("[aeonos] x402 verify error:", e.message);
    return res.status(500).json({ error: "Payment verification failed", detail: e.message });
  }
  if (!verifyResult.isValid) {
    return send402(res, paymentReqs, verifyResult.invalidReason);
  }

  // Settle — locks in the payment on-chain
  let settleResult: { success: boolean; errorReason?: string; transaction?: string; network?: string };
  try {
    settleResult = await facilitatorClient.settle(paymentPayload, paymentReqs);
  } catch (e: any) {
    console.error("[aeonos] x402 settle error:", e.message);
    return res.status(500).json({ error: "Payment settlement failed", detail: e.message });
  }
  if (!settleResult.success) {
    return send402(res, paymentReqs, settleResult.errorReason);
  }

  // Signal settlement to the client (v2 header: PAYMENT-RESPONSE)
  res.setHeader(
    "PAYMENT-RESPONSE",
    Buffer.from(JSON.stringify(settleResult)).toString("base64")
  );

  const queryCount = await getQueryCount(caller_id);

  // paymentHeader used downstream for logging (paid vs free)
  const paymentHeader = xPaymentHeader;

  // ── Route to correct pattern ─────────────────────────────────────────────────
  try {
    if (isStream) {
      return await handleStream(req, res, query, caller_id, paymentHeader);
    }
    if (isAsync) {
      return await handleAsync(req, res, query, caller_id, isJsonRpc, jsonRpcId, paymentHeader);
    }
    return await handleSync(req, res, query, caller_id, isJsonRpc, jsonRpcId, paymentHeader, queryCount);
  } catch (e: any) {
    console.error("[aeonos] Error:", e.message, e.stack);
    return jsonRpcError(res, isJsonRpc, jsonRpcId, -32000, e.message);
  }
}

// ── Pattern 1: Synchronous ─────────────────────────────────────────────────────

async function handleSync(
  req: VercelRequest,
  res: VercelResponse,
  query: string,
  caller_id: string,
  isJsonRpc: boolean,
  jsonRpcId: any,
  paymentHeader: string | undefined,
  queryCount: number
) {
  const result = await runAgent({ query, caller_id, citationSamples: 1 });
  await logQuery(caller_id, query, result, paymentHeader);

  const body = {
    status: "completed",
    artifact: {
      parts: [{ type: "text", text: withPlaceholderNotice(result.response, query, caller_id, AGENT_URL()) }],
      index: 0,
    },
    tool_calls: result.tool_calls_made,
    tokens: result.tokens_used,
    costs: result.costs,
    cost_usd: result.cost_usd,
    query_count: queryCount + 1,
  };

  return isJsonRpc
    ? res.json({ jsonrpc: "2.0", id: jsonRpcId, result: body })
    : res.json(body);
}

// ── Pattern 2: Async Task ──────────────────────────────────────────────────────

async function handleAsync(
  req: VercelRequest,
  res: VercelResponse,
  query: string,
  caller_id: string,
  isJsonRpc: boolean,
  jsonRpcId: any,
  paymentHeader: string | undefined
) {
  // Create task record immediately
  const { data: task, error } = await db
    .from("tasks")
    .insert({ caller_id, query, status: "working" })
    .select("id")
    .single();

  if (error || !task) {
    return jsonRpcError(res, isJsonRpc, jsonRpcId, -32000, "Failed to create task");
  }

  // Return task_id straight away — caller polls GET /api/agent?task_id=xxx
  const immediate = { task_id: task.id, status: "working" };
  if (isJsonRpc) {
    res.json({ jsonrpc: "2.0", id: jsonRpcId, result: immediate });
  } else {
    res.json(immediate);
  }

  // Run agent in background (Vercel waits for the function to complete even after response)
  try {
    const result = await runAgent({ query, caller_id, citationSamples: 1 });
    await logQuery(caller_id, query, result, paymentHeader);
    await db.from("tasks").update({
      status: "completed",
      result: {
        artifact: {
          parts: [{ type: "text", text: withPlaceholderNotice(result.response, query, caller_id, AGENT_URL()) }],
          index: 0,
        },
        tool_calls: result.tool_calls_made,
        tokens: result.tokens_used,
      },
      completed_at: new Date().toISOString(),
    }).eq("id", task.id);
  } catch (e: any) {
    await db.from("tasks").update({
      status: "failed",
      error: e.message,
      completed_at: new Date().toISOString(),
    }).eq("id", task.id);
  }
}

// ── Pattern 2: Task Polling ────────────────────────────────────────────────────

async function handleTaskPoll(req: VercelRequest, res: VercelResponse) {
  const task_id = req.query.task_id as string;

  const { data: task, error } = await db
    .from("tasks")
    .select("id, status, result, error, created_at, completed_at")
    .eq("id", task_id)
    .single();

  if (error || !task) return res.status(404).json({ error: "Task not found" });

  return res.json({
    task_id: task.id,
    status: task.status,               // working | completed | failed
    ...(task.status === "completed" && { artifact: task.result?.artifact }),
    ...(task.status === "failed"    && { error: task.error }),
    created_at:   task.created_at,
    completed_at: task.completed_at,
  });
}

// ── Pattern 3: SSE Streaming ───────────────────────────────────────────────────

async function handleStream(
  req: VercelRequest,
  res: VercelResponse,
  query: string,
  caller_id: string,
  paymentHeader: string | undefined
) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Nginx buffering on Vercel

  const send = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Push progress events as tools are called
  send({ status: "working", progress: "Starting AEONOS..." });

  try {
    // We intercept tool calls by running agent with a progress callback
    // For now: send working heartbeats, then final result
    send({ status: "working", progress: "Querying live AEO data sources..." });

    const result = await runAgent({ query, caller_id, citationSamples: 1 });
    await logQuery(caller_id, query, result, paymentHeader);

    for (const tool of result.tool_calls_made) {
      send({ status: "working", progress: `Completed: ${tool}` });
    }

    // Final artifact — matches A2A spec format
    send({
      status: "completed",
      artifact: {
        parts: [{ type: "text", text: withPlaceholderNotice(result.response, query, caller_id, AGENT_URL()) }],
        index: 0,
      },
      tool_calls: result.tool_calls_made,
      tokens: result.tokens_used,
    });

  } catch (e: any) {
    send({ status: "failed", error: e.message });
  }

  res.end();
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractCallerId(req: VercelRequest): string | null {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const token = auth.replace("Bearer ", "");
  return `api_${Buffer.from(token).toString("base64").substring(0, 16)}`;
}

async function getQueryCount(caller_id: string): Promise<number> {
  const { data } = await db
    .from("caller_memory")
    .select("query_count")
    .eq("caller_id", caller_id)
    .single();
  return data?.query_count || 0;
}

async function logQuery(
  caller_id: string,
  query: string,
  result: { tool_calls_made: string[]; tokens_used: number },
  paymentHeader?: string
): Promise<void> {
  const currentCount = await getQueryCount(caller_id);
  await Promise.all([
    db.from("query_log").insert({
      caller_id,
      query,
      norg_data_used: result.tool_calls_made.includes("queryLiveResearch"),
      knowledge_entries_hit: result.tool_calls_made.filter(t => t === "retrieveSharedAEO").length,
      response_tokens: result.tokens_used,
      payment_usdc: paymentHeader ? PRICE_PER_QUERY_USDC : 0,
    }),
    db.from("caller_memory").upsert(
      { caller_id, query_count: currentCount + 1, updated_at: new Date().toISOString() },
      { onConflict: "caller_id" }
    ),
  ]);
}

function jsonRpcError(
  res: VercelResponse,
  isJsonRpc: boolean,
  id: any,
  code: number,
  message: string
) {
  if (isJsonRpc) {
    return res.json({ jsonrpc: "2.0", id, error: { code, message } });
  }
  return res.status(code === -32602 ? 400 : 500).json({ error: message });
}

// ── x402 helpers ──────────────────────────────────────────────────────────────

// v2 PaymentRequirements: `amount` (not maxAmountRequired), no resource/description/mimeType
function buildPaymentRequirements(_req: VercelRequest): PaymentRequirements {
  return {
    scheme:            "exact",
    network:           "eip155:8453",   // CAIP-2 required for x402 v2
    amount:            "50000",          // 0.05 USDC — 6 decimals
    payTo:             (process.env.PAYMENT_ADDRESS || "0x400d65bb174c546ed92f5d61ce21fbde96b8bacc").trim(),
    maxTimeoutSeconds: 300,
    asset:             "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
    // EIP-712 domain params for USDC on Base — required for correct signature
    extra:             { name: "USD Coin", version: "2" },
  };
}

// Bazaar discovery extension — x402 v2 format for agentic.market indexing
const _bazaarBase = declareDiscoveryExtension({
  bodyType: "json",
  input: {
    query: "Audit https://YOUR-SITE.com for AI search visibility and get a P1/P2/P3 action plan",
    caller_id: DISCOVERY_CALLER_ID_EXAMPLE,
  },
  inputSchema: {
    properties: {
      query: {
        type: "string",
        description:
          "AEO/GEO question or your real URL to audit (replace YOUR-SITE.com). Examples: 'Audit https://yourdomain.com for AI visibility', " +
          "'Write an llms.txt for my SaaS', 'Generate JSON-LD schema for my pricing page', " +
          "'Score my site on the AEONOS 5-pillar AI inclusion check'",
      },
      caller_id: {
        type: "string",
        description:
          "Stable ID for your agent or the site you are working on (e.g. your domain); replace the example value. " +
          "AEONOS stores persistent memory per caller_id: site URL, keywords, and audit history are remembered across sessions.",
      },
    },
    required: ["query"],
  },
  output: {
    example: {
      status: "completed",
      artifact: {
        parts: [{
          type: "text",
          text: "# AEO Audit: mysite.com\n\n**Overall Score: 62/100**\n\n## P1 — Do This Week\n1. Add FAQPage JSON-LD schema...",
        }],
        index: 0,
      },
      tool_calls: ["queryLiveResearch", "retrieveSharedAEO", "storeCallerMemory"],
      tokens: 4800,
    },
    schema: {
      properties: {
        status: { type: "string", description: "completed | failed" },
        artifact: {
          type: "object",
          description: "A2A-format artifact containing the AEO/GEO strategy report as markdown text",
        },
        tool_calls: {
          type: "array",
          items: { type: "string" },
          description: "Tools used: queryLiveResearch, retrieveSharedAEO, retrieveCallerMemory, storeCallerMemory",
        },
        tokens: { type: "number" },
      },
    },
  },
});

// Enrich with optional Bazaar metadata (serviceName/tags/iconUrl) directly on the bazaar object
const BAZAAR_EXTENSION = {
  bazaar: {
    ..._bazaarBase.bazaar,
    // method is omitted from declareDiscoveryExtension intentionally — set manually here
    info: {
      ..._bazaarBase.bazaar.info,
      input: {
        ..._bazaarBase.bazaar.info.input,
        method: "POST",
      },
    },
    serviceName: "AEONOS",
    tags: ["aeo", "geo", "seo", "ai-search", "llms"],
    iconUrl: "https://aeonos.basechainlabs.com/aeonos-logo.jpg",
  },
};

function send402(
  res: VercelResponse,
  paymentReqs: PaymentRequirements,
  errorReason?: string
) {
  const base = process.env.AGENT_BASE_URL || "https://aeonos.basechainlabs.com";
  const body: PaymentRequired = {
    x402Version: X402_VERSION,  // 2
    error:       errorReason ?? "payment-required",
    resource: {
      url:         `${base}/api/agent`,
      description: "Improve AI search visibility and get cited by ChatGPT, Perplexity, Claude & Google AI Overviews. AEO/GEO/SEO strategy, AI visibility audits, schema markup, llms.txt. 0.05 USDC/query.",
      mimeType:    "application/json",
    },
    accepts:    [paymentReqs],
    extensions: BAZAAR_EXTENSION,
  };
  res.setHeader(
    "PAYMENT-REQUIRED",
    Buffer.from(JSON.stringify(body)).toString("base64")
  );
  return res.status(402).json(body);
}

// ── A2A Agent Card ─────────────────────────────────────────────────────────────
// Single source: public/.well-known/agent.json (also served at
// /.well-known/agent.json and /.well-known/agent-card.json via vercel.json).

function buildAgentCard() {
  return agentCard;
}
