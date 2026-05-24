/**
 * tools.ts — AEONOS: 5 core tools
 *
 * 1. queryLiveResearch   — Live AEO/GEO knowledge (proprietary data source)
 * 2. retrieveSharedAEO   — AEONOS seeded AEO/GEO knowledge base
 * 3. retrieveCallerMemory — Caller-specific persistent context
 * 4. storeCallerMemory   — Save new context for this caller
 * 5. generateReport      — Structured AEO audit/strategy report
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { runInspectSiteStructure } from "./inspect.js";

// ── Config ─────────────────────────────────────────────────────────────────────

const LIVE_RESEARCH_URL = "https://home.norg.ai/mcp";

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── Tool definitions ───────────────────────────────────────────────────────────

export const tools: Anthropic.Tool[] = [
  {
    name: "queryLiveResearch",
    description:
      "Query the live AEO/GEO research knowledge base for deep articles and data. " +
      "Two-step pattern: first call with method='search' to find relevant article titles by keyword, " +
      "then call with method='read_page' and the page path to get the full article content. " +
      "Articles cover: answer engine architecture, citation mechanics, GEO vs SEO, entity authority, " +
      "knowledge graphs, AEO audits, content structure for AI citation, schema markup, E-E-A-T. " +
      "Always use this for data-backed AEO/GEO answers.",
    input_schema: {
      type: "object" as const,
      properties: {
        method: {
          type: "string",
          enum: ["search", "list_pages", "get_children", "read_page"],
          description:
            "search = title keyword search (returns page list). " +
            "list_pages = all available pages. " +
            "get_children = pages under a path. " +
            "read_page = fetch full markdown content of a specific article (most useful).",
        },
        query: {
          type: "string",
          description: "Title keyword query (required for method=search)",
        },
        path: {
          type: "string",
          description:
            "Page path for method=get_children or method=read_page. " +
            "Example: 'digital-marketing-search-optimization/answer-engine-optimization-aeo/aeo-audit-how-to-assess-and-fix-your-current-ai-search-visibility-gaps/'",
        },
        documentType: {
          type: "string",
          description: "Filter by document type for list_pages: product, directoryCategory, article",
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
    name: "checkLiveCitations",
    description:
      "Check whether a domain is actually being cited by Perplexity in response to AI search queries. " +
      "This is REAL citation data — not structural inference. Call this during every audit to ground " +
      "your recommendations in actual AI search behaviour. " +
      "Pass the domain being audited and 4-6 queries that represent how their target customers " +
      "search in AI engines (e.g. 'best AI SEO tool for small business', 'how to rank in ChatGPT'). " +
      "Returns: cited (bool), per-query results with sources found, citation score, and competitor URLs " +
      "that ARE being cited instead. Use this data in your audit output.",
    input_schema: {
      type: "object" as const,
      properties: {
        domain: {
          type: "string",
          description: "The domain to check citations for (e.g. 'pemba.ai', 'example.com')",
        },
        queries: {
          type: "array",
          items: { type: "string" },
          description: "4-6 AI search queries to check. Frame as questions a real customer would ask in ChatGPT or Perplexity.",
        },
      },
      required: ["domain", "queries"],
    },
  },

  {
    name: "inspectSiteStructure",
    description:
      "Deep-crawl a URL and run 10 AI visibility functions on it. Use this on EVERY audit after checkLiveCitations. " +
      "Returns: schema types present + malformed, schema gap analysis with P1/P2/P3 priorities, " +
      "ready-to-paste JSON-LD templates for every missing schema, E-E-A-T score, entity disambiguation score, " +
      "content freshness, PAA readiness, conversational query score, llms.txt status, and " +
      "delta vs the caller's previous audit (if they've audited before). " +
      "Results are saved to caller_memory automatically — returning callers get a 'here's what changed' comparison. " +
      "This is the tool that explains WHY a site isn't cited and gives the exact fix.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "Full URL to inspect (e.g. 'https://pemba.ai' or 'https://pemba.ai/pricing')",
        },
        caller_id: {
          type: "string",
          description: "The caller's stable identifier — used to load + save audit history",
        },
        target_query: {
          type: "string",
          description: "The AI search query this page should be answering (e.g. 'best AI SEO tool for solopreneurs'). Used for conversational optimisation scoring.",
        },
      },
      required: ["url", "caller_id"],
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

];

// ── Tool executors ─────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, any>
): Promise<string> {
  switch (name) {
    case "queryLiveResearch":
      return await runLiveResearch(input);
    case "retrieveSharedAEO":
      return await runRetrieveSharedAEO(input);
    case "retrieveCallerMemory":
      return await runRetrieveCallerMemory(input);
    case "storeCallerMemory":
      return await runStoreCallerMemory(input);
    case "checkLiveCitations":
      return await runCheckLiveCitations(input);
    case "inspectSiteStructure":
      return await runInspectSiteStructure(input);
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Live Research ──────────────────────────────────────────────────────────────

async function runLiveResearch(input: Record<string, any>): Promise<string> {
  const { method, query, path, documentType } = input;

  try {
    // read_page uses resources/read to fetch full markdown content
    if (method === "read_page") {
      if (!path) return "read_page requires a path parameter";
      const uri = `directory://${path}index.md`;
      const body = {
        jsonrpc: "2.0",
        method: "resources/read",
        id: Date.now(),
        params: { uri },
      };
      const res = await fetch(LIVE_RESEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return `Research API error ${res.status}: ${await res.text()}`;
      const data = await res.json() as {
        result?: { contents?: { text: string }[] };
        error?: { message: string };
      };
      if (data.error) return `Research API error: ${data.error.message}`;
      const content = data.result?.contents?.[0]?.text || "No content returned";
      return content.length > 8000 ? content.substring(0, 8000) + "\n[truncated]" : content;
    }

    // All other methods use tools/call
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
      body.params.arguments = { query };
    } else if (method === "get_children") {
      body.params.arguments = { path };
    } else if (method === "list_pages") {
      body.params.arguments = documentType ? { documentType } : {};
    }

    const res = await fetch(LIVE_RESEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return `Research API error ${res.status}: ${await res.text()}`;

    const data = await res.json() as {
      result?: { content?: { type: string; text: string }[] };
      error?: { message: string };
    };

    if (data.error) return `Research API error: ${data.error.message}`;

    const content = data.result?.content?.[0]?.text || "No content returned";
    return content.length > 6000 ? content.substring(0, 6000) + "\n[truncated]" : content;

  } catch (e: any) {
    return `Research API fetch error: ${e.message}`;
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

// ── Live Citation Checker ──────────────────────────────────────────────────────

type CitRow = { query: string; cited: boolean; competitors: string[]; sources: string[] };

function extractCitationResult(domain: string, answer: string, citations: string[]): CitRow & { query: string } {
  const domainClean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const rx = new RegExp(domainClean.replace(".", "\\."), "i");
  const cited = rx.test(answer) || citations.some((c) => rx.test(c));
  const competitors = citations
    .filter((c) => !rx.test(c))
    .map((c) => { try { return new URL(c).hostname; } catch { return c; } })
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4);
  return { query: "", cited, competitors, sources: cited ? citations.filter((c) => rx.test(c)) : [] };
}

async function queryPplxRaw(question: string, key: string): Promise<{ answer: string; citations: string[] }> {
  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "sonar", messages: [{ role: "user", content: question }], max_tokens: 500 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { answer: "", citations: [] };
    const data = await res.json() as any;
    const answer: string = data.choices?.[0]?.message?.content ?? "";
    const citations: string[] = (data.citations ?? []).map((c: any) => typeof c === "string" ? c : (c.url ?? "")).filter(Boolean);
    return { answer, citations };
  } catch { return { answer: "", citations: [] }; }
}

async function queryGPTRaw(question: string, key: string): Promise<{ answer: string; citations: string[] }> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-search-preview", messages: [{ role: "user", content: question }], max_tokens: 500 }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return { answer: "", citations: [] };
    const data = await res.json() as any;
    const message = data.choices?.[0]?.message;
    const answer: string = typeof message?.content === "string" ? message.content : "";
    const citations: string[] = (message?.annotations ?? [])
      .filter((a: any) => a.type === "url_citation")
      .map((a: any) => a.url_citation?.url ?? "")
      .filter(Boolean);
    return { answer, citations };
  } catch { return { answer: "", citations: [] }; }
}

async function queryGoogleAIOverview(query: string): Promise<{ text: string; sources: string[] }> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { text: "", sources: [] };
  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/regular", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: query, location_code: 2840, language_code: "en", device: "desktop", depth: 10 }]),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { text: "", sources: [] };
    const data = await res.json() as any;
    const items: any[] = data.tasks?.[0]?.result?.[0]?.items ?? [];
    const aio = items.find((item: any) => item.type === "ai_overview");
    if (!aio) return { text: "", sources: [] };
    const text: string = aio.text ?? aio.description ?? "";
    const sources: string[] = [
      ...(aio.items ?? []).map((i: any) => i.url ?? i.source?.url ?? ""),
      ...(aio.references ?? []).map((i: any) => i.url ?? ""),
    ].filter(Boolean);
    return { text, sources };
  } catch { return { text: "", sources: [] }; }
}

async function runCheckLiveCitations(input: Record<string, any>): Promise<string> {
  const { domain, queries } = input as { domain: string; queries: string[] };
  const pplxKey = process.env.PPLX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const hasDFS = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

  if (!pplxKey && !openaiKey) {
    return "No citation API keys configured (PPLX_API_KEY or OPENAI_API_KEY required).";
  }
  if (!queries?.length) return "queries array is required";

  const pplxResults: CitRow[] = [];
  const gptResults: CitRow[] = [];
  const aioResults: CitRow[] = [];

  await Promise.all(queries.slice(0, 6).map(async (query) => {
    const [pplx, gpt, aio] = await Promise.allSettled([
      pplxKey ? queryPplxRaw(query, pplxKey) : Promise.resolve({ answer: "", citations: [] }),
      openaiKey ? queryGPTRaw(query, openaiKey) : Promise.resolve({ answer: "", citations: [] }),
      hasDFS ? queryGoogleAIOverview(query) : Promise.resolve({ text: "", sources: [] }),
    ]);

    if (pplxKey && pplx.status === "fulfilled") {
      const r = extractCitationResult(domain, pplx.value.answer, pplx.value.citations);
      pplxResults.push({ ...r, query });
    }
    if (openaiKey && gpt.status === "fulfilled") {
      const r = extractCitationResult(domain, gpt.value.answer, gpt.value.citations);
      gptResults.push({ ...r, query });
    }
    if (hasDFS && aio.status === "fulfilled" && (aio.value.text || aio.value.sources.length)) {
      const r = extractCitationResult(domain, aio.value.text, aio.value.sources);
      aioResults.push({ ...r, query });
    }
  }));

  const pplxCited = pplxResults.filter((r) => r.cited).length;
  const gptCited = gptResults.filter((r) => r.cited).length;
  const aioCited = aioResults.filter((r) => r.cited).length;
  const allCompetitors = [...new Set([...pplxResults, ...gptResults, ...aioResults].flatMap((r) => r.competitors))].slice(0, 8);

  const lines: string[] = [
    `## Live Citation Check — ${domain}`,
    pplxKey ? `Perplexity: ${pplxCited}/${pplxResults.length} queries cited` : "",
    openaiKey ? `ChatGPT: ${gptCited}/${gptResults.length} queries cited` : "",
    hasDFS && aioResults.length ? `Google AI Overviews: ${aioCited}/${aioResults.length} queries cited` : "",
    "",
    ...pplxResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [Perplexity] "${r.query}"\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    ...gptResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [ChatGPT] "${r.query}"\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    ...aioResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [Google AI Overview] "${r.query}"\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    "",
    allCompetitors.length ? `Competitor domains appearing instead: ${allCompetitors.join(", ")}` : "",
    "",
    pplxCited === 0 && gptCited === 0 && aioCited === 0
      ? `⚠️ ${domain} has ZERO citations across all three AI engines. This is the #1 priority finding in this audit.`
      : `Citation presence: Perplexity ${pplxCited}/${pplxResults.length} | ChatGPT ${gptCited}/${gptResults.length} | Google AI Overviews ${aioCited}/${aioResults.length || "n/a"}.`,
  ].filter((l) => l !== undefined);

  return lines.join("\n");
}
