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
import { runAgent } from "../src/agent";

const PRICE_PER_QUERY_USDC = 0.05;
const FREE_TIER_QUERIES = 3;

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Main handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Payment, Accept");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ── Agent card discovery ─────────────────────────────────────────────────────
  if (req.method === "GET" && req.query["agent-card"]) {
    return res.json(buildAgentCard());
  }

  // ── Async task polling ───────────────────────────────────────────────────────
  if (req.method === "GET" && req.query.task_id) {
    return handleTaskPoll(req, res);
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

  if (!query) {
    return jsonRpcError(res, isJsonRpc, jsonRpcId, -32602, "Missing query");
  }

  // ── x402 payment check ───────────────────────────────────────────────────────
  const paymentHeader = req.headers["x-payment"] as string | undefined;
  const queryCount = await getQueryCount(caller_id);

  if (queryCount >= FREE_TIER_QUERIES && !paymentHeader) {
    res.setHeader("X-Payment-Required", "true");
    res.setHeader("X-Payment-Amount", `${PRICE_PER_QUERY_USDC} USDC`);
    res.setHeader("X-Payment-Network", "base");
    res.setHeader("X-Payment-Address", process.env.PAYMENT_ADDRESS || "");
    return res.status(402).json({
      error: "Payment required",
      amount: PRICE_PER_QUERY_USDC,
      currency: "USDC",
      network: "base",
      payment_address: process.env.PAYMENT_ADDRESS,
      free_queries_used: queryCount,
      note: `First ${FREE_TIER_QUERIES} queries free. After that: ${PRICE_PER_QUERY_USDC} USDC/query.`,
    });
  }

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
  const result = await runAgent({ query, caller_id });
  await logQuery(caller_id, query, result, paymentHeader);

  const body = {
    status: "completed",
    artifact: {
      parts: [{ type: "text", text: result.response }],
      index: 0,
    },
    tool_calls: result.tool_calls_made,
    tokens: result.tokens_used,
    query_count: queryCount + 1,
    free_queries_remaining: Math.max(0, FREE_TIER_QUERIES - queryCount - 1),
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
    const result = await runAgent({ query, caller_id });
    await logQuery(caller_id, query, result, paymentHeader);
    await db.from("tasks").update({
      status: "completed",
      result: {
        artifact: {
          parts: [{ type: "text", text: result.response }],
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
    send({ status: "working", progress: "Querying Norg MCP for live AEO data..." });

    const result = await runAgent({ query, caller_id });
    await logQuery(caller_id, query, result, paymentHeader);

    for (const tool of result.tool_calls_made) {
      send({ status: "working", progress: `Completed: ${tool}` });
    }

    // Final artifact — matches A2A spec format
    send({
      status: "completed",
      artifact: {
        parts: [{ type: "text", text: result.response }],
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
      norg_data_used: result.tool_calls_made.includes("queryNorgMCP"),
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

// ── A2A Agent Card ─────────────────────────────────────────────────────────────

function buildAgentCard() {
  const base = process.env.AGENT_BASE_URL || "https://aeonos.vercel.app";
  return {
    name: "AEONOS",
    description:
      "Specialist AEO/GEO knowledge agent (AEON.OS). Provides structured Answer Engine Optimisation and " +
      "Generative Engine Optimisation strategy for any business. Backed by live Norg.ai data + " +
      "real campaign knowledge (Emilia Möller Four Layers framework). Persistent per-caller memory.",
    url: `${base}/api/agent`,
    version: "1.0.0",
    protocolVersion: "0.2.1",
    capabilities: {
      streaming: true,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    skills: [
      {
        id: "aeo_optimisation",
        name: "AEO Optimisation",
        description:
          "Full AEO audit and strategy: on-page, schema, llms.txt, E-E-A-T, " +
          "Emilia Möller 5-Part AI Inclusion Check, keyword targeting, P1/P2/P3 roadmap.",
        inputModes: ["text"],
        outputModes: ["text", "json"],
        examples: [
          "Audit mysite.com for AEO readiness",
          "What schema markup should I add to my pricing page?",
          "Run Emilia Möller's AI inclusion check on example.com",
        ],
      },
      {
        id: "geo_strategy",
        name: "GEO Strategy",
        description:
          "Getting cited by ChatGPT, Perplexity, Claude, and Google AI Overviews. " +
          "llms.txt, FAQ schema, entity markup, question-based headings (#1 AEO signal).",
        inputModes: ["text"],
        outputModes: ["text"],
        examples: [
          "How do I get cited by Perplexity for my target keywords?",
          "Write an llms.txt for my SaaS product",
        ],
      },
      {
        id: "persistent_memory",
        name: "Persistent Caller Memory",
        description:
          "Remembers your site, keywords, audit history, and strategy across sessions.",
        inputModes: ["text"],
        outputModes: ["text"],
      },
      {
        id: "progress_report",
        name: "AEO Progress Report",
        description:
          "Structured progress report with Four Layers scores, what's working, and next 3 actions.",
        inputModes: ["text"],
        outputModes: ["text", "json"],
      },
    ],
    pricing: {
      default: `${PRICE_PER_QUERY_USDC} USDC per query`,
      free_tier: `First ${FREE_TIER_QUERIES} queries free`,
      bulk: "0.03 USDC per query (10+ queries/session)",
    },
    protocols: ["x402", "a2a"],
    network: "base",
    payment_address: process.env.PAYMENT_ADDRESS || "",
  };
}
