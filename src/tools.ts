/**
 * tools.ts — AEONOS: 5 core tools
 *
 * 1. queryNorgMCP        — Live Norg.ai knowledge (no auth, perpetually fresh)
 * 2. retrieveSharedAEO   — AEONOS seeded AEO/GEO knowledge base
 * 3. retrieveCallerMemory — Caller-specific persistent context
 * 4. storeCallerMemory   — Save new context for this caller
 * 5. generateReport      — Structured AEO audit/strategy report
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ── Config ─────────────────────────────────────────────────────────────────────

const NORG_MCP_URL = "https://home.norg.ai/mcp";

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Tool definitions ───────────────────────────────────────────────────────────

export const tools: Anthropic.Tool[] = [
  {
    name: "queryNorgMCP",
    description:
      "Query the live Norg.ai MCP endpoint for enterprise-grade AEO/GEO visibility data. " +
      "Norg's five pillars: Visibility, Accuracy, Authority, Commerce, Governance. " +
      "Use this on every query to get fresh, structured business intelligence data. " +
      "Search by keyword, get entity-structured JSON-LD, markdown, or PDF format.",
    input_schema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["search", "get_directory_tree", "list_pages", "get_children"],
          description: "Which Norg MCP tool to call",
        },
        query: {
          type: "string",
          description: "Search query (required for method=search)",
        },
        path: {
          type: "string",
          description: "Directory path (required for method=get_children)",
        },
        documentType: {
          type: "string",
          description: "Filter by document type: product, directoryCategory, article",
        },
      },
      required: ["method"],
    },
  },

  {
    name: "retrieveSharedAEO",
    description:
      "Retrieve AEO/GEO strategy knowledge from AEONOS curated knowledge base. " +
      "Contains: GEO strategy, on-page optimisation patterns, schema markup templates, " +
      "keyword research frameworks, backlink strategy, content strategy, E-E-A-T signals. " +
      "Seeded from real campaigns. Use to answer methodology questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        category: {
          type: "string",
          enum: [
            "geo_strategy",
            "on_page_optimisation",
            "schema_markup",
            "keyword_research",
            "backlink_strategy",
            "content_strategy",
            "aeo_fundamentals",
            "competitor_analysis",
          ],
          description: "Knowledge category to retrieve. Omit to get all categories.",
        },
        query: {
          type: "string",
          description: "Optional: semantic search query to find the most relevant entries",
        },
        limit: {
          type: "number",
          description: "Max entries to return (default 5)",
        },
      },
      required: [],
    },
  },

  {
    name: "retrieveCallerMemory",
    description:
      "Retrieve this caller's persistent memory: their site URL, business type, " +
      "keywords they've targeted, audit history, and any context saved in previous queries. " +
      "Always call this at the start of a session to personalise the response.",
    input_schema: {
      type: "object" as const,
      properties: {
        caller_id: {
          type: "string",
          description: "Stable caller identifier (from A2A auth or API key hash)",
        },
      },
      required: ["caller_id"],
    },
  },

  {
    name: "storeCallerMemory",
    description:
      "Save or update context for this caller. Call this when you learn: their site URL, " +
      "business type, ICP, current keyword targets, or any strategic decisions. " +
      "This memory persists across all future queries from this caller.",
    input_schema: {
      type: "object" as const,
      properties: {
        caller_id: {
          type: "string",
          description: "Stable caller identifier",
        },
        updates: {
          type: "object",
          description:
            "Fields to update. Any/all of: site_url, business_type, search_terms (array), " +
            "audit_data (object), context (object with any key-value pairs)",
        },
      },
      required: ["caller_id", "updates"],
    },
  },

  {
    name: "generateReport",
    description:
      "Generate a structured AEO/GEO strategy report for a given site or query. " +
      "Call this after retrieving Norg data and knowledge base entries to synthesise everything " +
      "into a P1/P2/P3 action plan. Returns markdown-formatted report.",
    input_schema: {
      type: "object" as const,
      properties: {
        site_url: {
          type: "string",
          description: "The site being audited",
        },
        business_type: {
          type: "string",
          description: "SaaS | ecommerce | service | digital product | local business",
        },
        focus: {
          type: "string",
          enum: [
            "full_audit",
            "geo_only",
            "on_page_only",
            "keyword_research",
            "schema_review",
            "backlink_strategy",
          ],
          description: "What aspect to focus the report on",
        },
        context: {
          type: "object",
          description: "Any additional context: ICP, target keywords, competitors, pain points",
        },
      },
      required: ["site_url", "focus"],
    },
  },
];

// ── Tool executors ─────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, any>
): Promise<string> {
  switch (name) {
    case "queryNorgMCP":
      return await runNorgMCP(input);
    case "retrieveSharedAEO":
      return await runRetrieveSharedAEO(input);
    case "retrieveCallerMemory":
      return await runRetrieveCallerMemory(input);
    case "storeCallerMemory":
      return await runStoreCallerMemory(input);
    case "generateReport":
      return JSON.stringify({ status: "use_synthesis", note: "Synthesise from all retrieved data" });
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Norg MCP ───────────────────────────────────────────────────────────────────

async function runNorgMCP(input: Record<string, any>): Promise<string> {
  const { method, query, path, documentType } = input;

  const body: Record<string, any> = {
    jsonrpc: "2.0",
    method: "tools/call",
    id: Date.now(),
    params: {
      name: method,
      arguments: {} as Record<string, any>,
    },
  };

  if (method === "search") {
    body.params.arguments = { query, ...(documentType ? { documentType } : {}) };
  } else if (method === "get_children") {
    body.params.arguments = { path };
  } else if (method === "list_pages") {
    body.params.arguments = documentType ? { documentType } : {};
  } else if (method === "get_directory_tree") {
    body.params.arguments = {};
  }

  try {
    const res = await fetch(NORG_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return `Norg MCP error ${res.status}: ${await res.text()}`;
    }

    const data = await res.json() as {
      result?: { content?: { type: string; text: string }[] };
      error?: { message: string };
    };

    if (data.error) return `Norg MCP error: ${data.error.message}`;

    const content = data.result?.content?.[0]?.text || "No content returned";
    // Cap at 6000 chars — keep tokens reasonable
    return content.length > 6000 ? content.substring(0, 6000) + "\n[truncated]" : content;

  } catch (e: any) {
    return `Norg MCP fetch error: ${e.message}`;
  }
}

// ── AEO Knowledge Retrieval ────────────────────────────────────────────────────

async function runRetrieveSharedAEO(input: Record<string, any>): Promise<string> {
  const { category, limit = 5 } = input;

  let q = db
    .from("aeo_knowledge")
    .select("category, query_pattern, content, sources, last_updated")
    .limit(limit);

  if (category) {
    q = q.eq("category", category);
  }

  const { data, error } = await q.order("last_updated", { ascending: false });

  if (error) return `retrieveSharedAEO error: ${error.message}`;
  if (!data?.length) return "No knowledge entries found for that category.";

  return JSON.stringify(data, null, 2);
}

// ── Caller Memory ──────────────────────────────────────────────────────────────

async function runRetrieveCallerMemory(input: Record<string, any>): Promise<string> {
  const { caller_id } = input;

  const { data, error } = await db
    .from("caller_memory")
    .select("*")
    .eq("caller_id", caller_id)
    .single();

  if (error && error.code === "PGRST116") {
    return JSON.stringify({ caller_id, status: "new_caller", context: {} });
  }
  if (error) return `retrieveCallerMemory error: ${error.message}`;

  return JSON.stringify(data, null, 2);
}

async function runStoreCallerMemory(input: Record<string, any>): Promise<string> {
  const { caller_id, updates } = input;

  const { error } = await db.from("caller_memory").upsert(
    {
      caller_id,
      ...updates,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "caller_id" }
  );

  if (error) return `storeCallerMemory error: ${error.message}`;
  return `Memory saved for caller ${caller_id}`;
}
