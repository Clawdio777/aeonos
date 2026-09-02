/**
 * tools.ts — AEONOS: 6 core tools
 *
 * 1. queryLiveResearch   — Live AEO/GEO knowledge (proprietary data source)
 * 2. retrieveSharedAEO   — AEONOS seeded AEO/GEO knowledge base
 * 3. retrieveCallerMemory — Caller-specific persistent context
 * 4. storeCallerMemory   — Save new context for this caller
 * 5. checkLiveCitations  — Real citation data from Perplexity, ChatGPT, Google AI Overviews, Bing/Copilot
 * 6. inspectSiteStructure — 10-function site audit with confidence score + delta reporting
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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

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
      "Check whether a domain is being cited by Perplexity, ChatGPT, Google AI Overviews, and Bing/Copilot. " +
      "This is REAL citation data — not structural inference. Call this during every audit to ground " +
      "your recommendations in actual AI search behaviour. " +
      "Pass the domain being audited and 4-6 queries that represent how their target customers " +
      "search in AI engines (e.g. 'best AI SEO tool for small business', 'how to rank in ChatGPT'). " +
      "Pass caller_id when available — results are persisted to citation_history for trend analysis and delta comparison. " +
      "Perplexity and ChatGPT are sampled several times per query (their answers vary run to run), so the headline " +
      "per-engine figure is a citation RATE (% of samples that cited the domain) with the sample count n. " +
      "Returns: per-engine citation rate, per-query results with sources found, competitor URLs " +
      "that ARE being cited instead, and a delta vs previous run (in percentage points, flagged when within sampling noise) when caller_id is provided.",
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
        caller_id: {
          type: "string",
          description: "Optional. When provided, results are saved to citation_history for trend tracking and delta comparison vs previous runs.",
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
      return await runInspectSiteStructure(input as { url: string; caller_id: string; target_query?: string });
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

type CitRow = {
  query: string;
  cited: boolean;        // majority of successful samples cited the domain
  citedSamples: number;
  samples: number;       // successful samples only — failed/rate-limited calls are dropped, never counted as "not cited"
  competitors: string[];
  sources: string[];
};

// Perplexity/ChatGPT answers are non-deterministic, so one sample per query is noise.
// LLM engines get CITATION_SAMPLES per query; Google AIO + Bing are SERP snapshots and run once.
const CITATION_SAMPLES = Math.max(1, Number(process.env.CITATION_SAMPLES) || 5);
const QUERY_CONCURRENCY = 2; // keeps in-flight LLM calls ≈ 2 × 2 × samples, under Perplexity/OpenAI burst limits

type SentimentResult = {
  query: string;
  engine: string;
  cited: boolean;
  sentiment: "positive" | "neutral" | "negative";
  reason: string;
};

async function classifyAnswerSentiment(
  domain: string,
  answers: { query: string; engine: string; answer: string; cited: boolean }[]
): Promise<SentimentResult[]> {
  const withText = answers.filter((a) => a.answer.length > 60);
  if (!withText.length) return [];

  const prompt = `You are analysing how AI search engines talk about the domain "${domain}".

For each answer below, classify the sentiment toward "${domain}" (or toward this topic/industry if the domain is not cited):
- "positive": domain/brand mentioned favourably, or topic framed in a way that benefits visibility
- "neutral": factual or balanced, no strong positive/negative signal
- "negative": domain mentioned unfavourably, or answer actively directs users away from this type of solution

Return ONLY a JSON array. Each element: {"query":"...","engine":"...","cited":true/false,"sentiment":"positive"|"neutral"|"negative","reason":"one short sentence"}

Answers:
${withText.map((a, i) => `${i + 1}. [${a.engine}] Query: "${a.query}" | Cited: ${a.cited}\nAnswer: ${a.answer.slice(0, 600)}`).join("\n\n")}`;

  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as SentimentResult[];
  } catch {
    return [];
  }
}

function extractCitationResult(domain: string, answer: string, citations: string[]): { cited: boolean; competitors: string[]; sources: string[] } {
  const domainClean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const rx = new RegExp(domainClean.replace(".", "\\."), "i");
  const cited = rx.test(answer) || citations.some((c) => rx.test(c));
  const competitors = citations
    .filter((c) => !rx.test(c))
    .map((c) => { try { return new URL(c).hostname; } catch { return c; } })
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4);
  return { cited, competitors, sources: cited ? citations.filter((c) => rx.test(c)) : [] };
}

type LlmRun = { answer: string; citations: string[] };
type LlmRow = CitRow & { answer: string };

/** Run n samples of one LLM engine for one query and fold them into a single row. Empty responses are failed calls and are dropped. */
async function sampleLlm(domain: string, query: string, n: number, run: () => Promise<LlmRun>): Promise<LlmRow | null> {
  const runs = (await Promise.allSettled(Array.from({ length: n }, run)))
    .filter((r): r is PromiseFulfilledResult<LlmRun> => r.status === "fulfilled" && (r.value.answer.length > 0 || r.value.citations.length > 0))
    .map((r) => r.value);
  if (!runs.length) return null;
  const rows = runs.map((r) => extractCitationResult(domain, r.answer, r.citations));
  const citedSamples = rows.filter((r) => r.cited).length;
  return {
    query,
    cited: citedSamples * 2 >= runs.length,
    citedSamples,
    samples: runs.length,
    competitors: [...new Set(rows.flatMap((r) => r.competitors))].slice(0, 4),
    sources: [...new Set(rows.flatMap((r) => r.sources))],
    answer: runs[0].answer,
  };
}

function serpRow(domain: string, query: string, text: string, sources: string[]): CitRow {
  const r = extractCitationResult(domain, text, sources);
  return { ...r, query, citedSamples: r.cited ? 1 : 0, samples: 1 };
}

type Collected = { pplx: LlmRow[]; gpt: LlmRow[]; aio: CitRow[]; bing: CitRow[] };

async function collectCitations(domain: string, queries: string[], samples: number): Promise<Collected> {
  const pplxKey = process.env.PPLX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const hasDFS = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const out: Collected = { pplx: [], gpt: [], aio: [], bing: [] };
  const ordered = queries.slice(0, 6);
  const queue = [...ordered];

  const worker = async () => {
    for (let query = queue.shift(); query !== undefined; query = queue.shift()) {
      const q = query;
      const [pplx, gpt, aio, bing] = await Promise.allSettled([
        pplxKey ? sampleLlm(domain, q, samples, () => queryPplxRaw(q, pplxKey)) : Promise.resolve(null),
        openaiKey ? sampleLlm(domain, q, samples, () => queryGPTRaw(q, openaiKey)) : Promise.resolve(null),
        hasDFS ? queryGoogleAIOverview(q) : Promise.resolve({ text: "", sources: [] }),
        hasDFS ? queryBingResults(q) : Promise.resolve({ text: "", sources: [] }),
      ]);
      if (pplx.status === "fulfilled" && pplx.value) out.pplx.push(pplx.value);
      if (gpt.status === "fulfilled" && gpt.value) out.gpt.push(gpt.value);
      if (aio.status === "fulfilled" && (aio.value.text || aio.value.sources.length)) out.aio.push(serpRow(domain, q, aio.value.text, aio.value.sources));
      if (bing.status === "fulfilled" && bing.value.sources.length) out.bing.push(serpRow(domain, q, "", bing.value.sources));
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUERY_CONCURRENCY, ordered.length) }, worker));

  const byQuery = (a: CitRow, b: CitRow) => ordered.indexOf(a.query) - ordered.indexOf(b.query);
  out.pplx.sort(byQuery); out.gpt.sort(byQuery); out.aio.sort(byQuery); out.bing.sort(byQuery);
  return out;
}

type EngineStats = { cited: number; total: number; citedSamples: number; samples: number; rate: number };

/** cited/total = queries (majority-cited / checked); rate = % of all samples that cited the domain. */
function engineStats(rows: CitRow[]): EngineStats {
  const citedSamples = rows.reduce((a, r) => a + r.citedSamples, 0);
  const samples = rows.reduce((a, r) => a + r.samples, 0);
  return { cited: rows.filter((r) => r.cited).length, total: rows.length, citedSamples, samples, rate: samples ? Math.round((citedSamples / samples) * 100) : 0 };
}

const stripAnswer = ({ query, cited, citedSamples, samples, competitors, sources }: CitRow): CitRow =>
  ({ query, cited, citedSamples, samples, competitors, sources });

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

async function queryBingResults(query: string): Promise<{ text: string; sources: string[] }> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return { text: "", sources: [] };
  try {
    const auth = Buffer.from(`${login}:${password}`).toString("base64");
    const res = await fetch("https://api.dataforseo.com/v3/serp/bing/organic/live/regular", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: query, location_code: 2840, language_code: "en", device: "desktop", depth: 10 }]),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { text: "", sources: [] };
    const data = await res.json() as any;
    const items: any[] = data.tasks?.[0]?.result?.[0]?.items ?? [];
    // Bing Copilot draws from organic results — top 10 = Copilot source pool
    const sources: string[] = items
      .filter((item: any) => item.type === "organic")
      .slice(0, 10)
      .map((i: any) => i.url ?? "")
      .filter(Boolean);
    return { text: "", sources };
  } catch { return { text: "", sources: [] }; }
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
  const { domain, queries, caller_id } = input as { domain: string; queries: string[]; caller_id?: string };
  const pplxKey = process.env.PPLX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const hasDFS = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

  if (!pplxKey && !openaiKey) {
    return "No citation API keys configured (PPLX_API_KEY or OPENAI_API_KEY required).";
  }
  if (!queries?.length) return "queries array is required";

  const { pplx: pplxResults, gpt: gptResults, aio: aioResults, bing: bingResults } =
    await collectCitations(domain, queries, CITATION_SAMPLES);
  const pplxStats = engineStats(pplxResults);
  const gptStats = engineStats(gptResults);
  const aioStats = engineStats(aioResults);
  const bingStats = engineStats(bingResults);
  const allCompetitors = [...new Set([...pplxResults, ...gptResults, ...aioResults, ...bingResults].flatMap((r) => r.competitors))].slice(0, 8);
  const zeroCitations = [pplxStats, gptStats, aioStats, bingStats].every((s) => s.citedSamples === 0);
  const timestamp = new Date().toISOString();

  // Sentiment analysis — batch all answers with text into one Haiku call
  const sentimentInputs = [
    ...pplxResults.map((r) => ({ query: r.query, engine: "perplexity", answer: r.answer, cited: r.cited })),
    ...gptResults.map((r) => ({ query: r.query, engine: "chatgpt", answer: r.answer, cited: r.cited })),
  ];
  const sentimentResults = await classifyAnswerSentiment(domain, sentimentInputs);

  // Persist to citation_history when caller_id is provided
  let deltaSection = "";
  if (caller_id) {
    try {
      const { data: existing } = await db
        .from("caller_memory")
        .select("citation_history")
        .eq("caller_id", caller_id)
        .single();

      const prevHistory: any[] = (existing as any)?.citation_history ?? [];
      const snapshot = {
        timestamp,
        domain,
        perplexity: { ...pplxStats, results: pplxResults.map(stripAnswer) },
        chatgpt: { ...gptStats, results: gptResults.map(stripAnswer) },
        googleAIO: { ...aioStats },
        bing: { ...bingStats },
        answers: {
          perplexity: pplxResults.map(({ query, answer }) => ({ query, answer: answer.slice(0, 1000) })),
          chatgpt: gptResults.map(({ query, answer }) => ({ query, answer: answer.slice(0, 1000) })),
        },
        sentiment: sentimentResults,
        competitors: allCompetitors,
      };

      await db.from("caller_memory").upsert(
        {
          caller_id,
          citation_history: [...prevHistory, snapshot].slice(-20),
          updated_at: timestamp,
        },
        { onConflict: "caller_id" }
      );

      // Build delta section comparing vs most recent previous run for same domain
      const prevRun = [...prevHistory].reverse().find((h) => h.domain === domain);
      if (prevRun) {
        const prevDate = new Date(prevRun.timestamp).toLocaleDateString("en-AU");
        const fmt = (n: number) => n > 0 ? `+${n}` : `${n}`;
        // Older snapshots have no rate — derive it from queries cited / queries checked (1 sample each).
        const prevRate = (p: any): number | null =>
          typeof p?.rate === "number" ? p.rate : p?.total ? Math.round((p.cited / p.total) * 100) : null;
        // Conservative 95% band for a proportion at this sample size (p = 0.5 worst case): 100/√n pp.
        const noise = (s: EngineStats) => Math.round(100 / Math.sqrt(Math.max(s.samples, 1)));
        const engineLine = (label: string, now: EngineStats, prev: any) => {
          const was = prevRate(prev);
          if (was === null || !now.samples) return { line: `${label}: no comparable data`, diff: 0, real: false };
          const diff = now.rate - was;
          const real = Math.abs(diff) > noise(now);
          return {
            line: `${label}: ${fmt(diff)}pp (${was}% → ${now.rate}%, n=${now.samples}${real ? "" : `, within noise ±${noise(now)}pp`})`,
            diff,
            real,
          };
        };
        const p = engineLine("Perplexity", pplxStats, prevRun.perplexity);
        const g = engineLine("ChatGPT", gptStats, prevRun.chatgpt);
        const net = p.diff + g.diff;
        const verdict = !p.real && !g.real
          ? "No change beyond sampling noise since last check."
          : net > 0 ? "📈 Citation presence improving." : "📉 Citation presence declined.";
        deltaSection = `\n\n## DELTA VS PREVIOUS RUN (${prevDate})\n${p.line}\n${g.line}\n${verdict}`;
      } else {
        deltaSection = "\n\n## DELTA VS PREVIOUS RUN\nFirst run for this domain — no previous data to compare.";
      }
    } catch {}
  }

  const llmLine = (s: EngineStats) => `${s.rate}% citation rate (${s.citedSamples}/${s.samples} samples across ${s.total} queries)`;
  const sampleNote = (r: CitRow) => r.samples > 1 ? ` — ${r.citedSamples}/${r.samples} samples cited` : "";
  const lines: string[] = [
    `## Live Citation Check — ${domain}`,
    pplxKey ? `Perplexity: ${llmLine(pplxStats)}` : "",
    openaiKey ? `ChatGPT: ${llmLine(gptStats)}` : "",
    hasDFS && aioResults.length ? `Google AI Overviews: ${aioStats.cited}/${aioStats.total} queries cited` : "",
    hasDFS && bingResults.length ? `Bing/Copilot (source pool): ${bingStats.cited}/${bingStats.total} queries in index` : "",
    `Method: ${CITATION_SAMPLES} samples per query on Perplexity + ChatGPT (✅ = cited in a majority of samples); a change under ~${Math.round(100 / Math.sqrt(Math.max(pplxStats.samples, gptStats.samples, 1)))}pp between runs is within sampling noise.`,
    "",
    ...pplxResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [Perplexity] "${r.query}"${sampleNote(r)}\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    ...gptResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [ChatGPT] "${r.query}"${sampleNote(r)}\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    ...aioResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [Google AI Overview] "${r.query}"\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    ...bingResults.map((r) =>
      `${r.cited ? "✅" : "❌"} [Bing/Copilot] "${r.query}"\n   ${r.cited ? `In index: ${r.sources.join(", ")}` : `Competitors: ${r.competitors.join(", ") || "none identified"}`}`
    ),
    "",
    allCompetitors.length ? `Competitor domains appearing instead: ${allCompetitors.join(", ")}` : "",
    "",
    zeroCitations
      ? `⚠️ ${domain} has ZERO citations across all four AI engines. This is the #1 priority finding in this audit.`
      : `Citation presence: Perplexity ${pplxStats.rate}% (n=${pplxStats.samples}) | ChatGPT ${gptStats.rate}% (n=${gptStats.samples}) | Google AI Overviews ${aioStats.cited}/${aioStats.total || "n/a"} | Bing/Copilot ${bingStats.cited}/${bingStats.total || "n/a"}.`,
    sentimentResults.length
      ? `\n## Sentiment Analysis\n` + sentimentResults.map((s) => {
          const icon = s.sentiment === "positive" ? "🟢" : s.sentiment === "negative" ? "🔴" : "🟡";
          return `${icon} [${s.engine}] "${s.query}" → ${s.sentiment.toUpperCase()}${s.cited ? " (cited)" : ""}: ${s.reason}`;
        }).join("\n")
      : "",
    caller_id ? `\n📊 Results saved to citation history (caller: ${caller_id})` : "",
  ].filter((l) => l !== undefined);

  return lines.join("\n") + deltaSection;
}

// ── Raw citation check (used by share-of-voice endpoint) ──────────────────────

export type CitationSnapshot = {
  domain: string;
  perplexity: EngineStats & { results: CitRow[] };
  chatgpt: EngineStats & { results: CitRow[] };
  googleAIO: EngineStats & { results: CitRow[] };
  bing: EngineStats & { results: CitRow[] };
  competitors: string[];
  sentiment: SentimentResult[];
};

/** Single-sample check — share-of-voice runs 2–5 brands in parallel, so sampling is kept at 1 to bound cost. */
export async function checkCitationsRaw(domain: string, queries: string[]): Promise<CitationSnapshot> {
  const { pplx: pplxResults, gpt: gptResults, aio: aioResults, bing: bingResults } =
    await collectCitations(domain, queries, 1);

  const allCompetitors = [
    ...new Set([...pplxResults, ...gptResults, ...aioResults, ...bingResults].flatMap((r) => r.competitors)),
  ].slice(0, 8);

  const sentimentInputs = [
    ...pplxResults.map((r) => ({ query: r.query, engine: "perplexity", answer: r.answer, cited: r.cited })),
    ...gptResults.map((r) => ({ query: r.query, engine: "chatgpt", answer: r.answer, cited: r.cited })),
  ];
  const sentiment = await classifyAnswerSentiment(domain, sentimentInputs);

  return {
    domain,
    perplexity: { ...engineStats(pplxResults), results: pplxResults.map(stripAnswer) },
    chatgpt: { ...engineStats(gptResults), results: gptResults.map(stripAnswer) },
    googleAIO: { ...engineStats(aioResults), results: aioResults },
    bing: { ...engineStats(bingResults), results: bingResults },
    competitors: allCompetitors,
    sentiment,
  };
}
