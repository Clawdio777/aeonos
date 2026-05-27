/**
 * api/internal.ts — AEONOS internal endpoint for Pemba admin
 *
 * No x402 — auth via PEMBA_API_KEY bearer token.
 * Uses async task pattern (same as /api/agent?async=true) so Pemba can
 * fire-and-poll without hitting Vercel's function timeout.
 *
 * POST /api/internal  → { task_id, status: "working" }
 * GET  /api/internal?task_id=xxx → { status, artifact? }
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { runAgent } from "../src/agent.js";

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Auth
  const auth = req.headers.authorization || "";
  const token = auth.replace("Bearer ", "").trim();
  if (token !== (process.env.PEMBA_API_KEY || "").trim()) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Poll
  if (req.method === "GET" && req.query.task_id) {
    const { data: task, error } = await db
      .from("tasks")
      .select("id, status, result, error, created_at, completed_at")
      .eq("id", req.query.task_id as string)
      .single();

    if (error || !task) return res.status(404).json({ error: "Task not found" });

    return res.json({
      task_id: task.id,
      status: task.status,
      ...(task.status === "completed" && { artifact: task.result?.artifact }),
      ...(task.status === "failed" && { error: task.error }),
      created_at: task.created_at,
      completed_at: task.completed_at,
    });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { query, caller_id = "pemba-admin" } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });

  // Create task record
  const { data: task, error } = await db
    .from("tasks")
    .insert({ caller_id, query, status: "working" })
    .select("id")
    .single();

  if (error || !task) {
    return res.status(500).json({ error: "Failed to create task" });
  }

  // Return task_id immediately
  res.json({ task_id: task.id, status: "working" });

  // Run agent in background (Vercel continues executing after response)
  try {
    const result = await runAgent({ query, caller_id });
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
