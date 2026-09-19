/**
 * tools.ts — AEONOS: 6 core tools
 *
 * 1. queryLiveResearch   — Live AEO/GEO knowledge (proprietary data source)
 * 2. retrieveSharedAEO   — AEONOS seeded AEO/GEO knowledge base
 * 3. retrieveCallerMemory — Caller-specific persistent context
 * 4. storeCallerMemory   — Save new context for this caller
 * 5. checkLiveCitations  — Real citation data from ChatGPT, Gemini, Google AI Overviews, Google AI Mode, Perplexity, Claude
 * 6. inspectSiteStructure — 10-function site audit with confidence score + delta reporting
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { runInspectSiteStructure } from "./inspect.js";
import { addCost, anthropicCost, perplexityCost, openaiSearchCost, geminiGroundedCost } from "./costs.js";

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
      "This is REAL citation data from ChatGPT, Gemini, Google AI Overviews, Google AI Mode, Perplexity and Claude — not structural inference. Engines marked NOT SAMPLED returned nothing: report them as unknown, never as 0%. Call this during every audit to ground " +
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
  /** Full URLs of the pages cited instead of the domain: the outreach target list (19/09/2026). */
  competitorUrls: string[];
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
    addCost("anthropic", anthropicCost("claude-haiku-4-5-20251001", res.usage));
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as SentimentResult[];
  } catch {
    return [];
  }
}

function extractCitationResult(domain: string, answer: string, citations: string[]): { cited: boolean; competitors: string[]; competitorUrls: string[]; sources: string[] } {
  const domainClean = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const rx = new RegExp(domainClean.replace(".", "\\."), "i");
  const cited = rx.test(answer) || citations.some((c) => rx.test(c));
  const competitorUrls = citations.filter((c) => !rx.test(c) && /^https?:\/\//.test(c)).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
  const competitors = citations
    .filter((c) => !rx.test(c))
    .map((c) => { try { return new URL(c).hostname; } catch { return c; } })
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 4);
  return { cited, competitors, competitorUrls, sources: cited ? citations.filter((c) => rx.test(c)) : [] };
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
    competitorUrls: [...new Set(rows.flatMap((r) => r.competitorUrls))].slice(0, 6),
    sources: [...new Set(rows.flatMap((r) => r.sources))],
    answer: runs[0].answer,
  };
}

function serpRow(domain: string, query: string, text: string, sources: string[]): CitRow {
  const r = extractCitationResult(domain, text, sources);
  return { ...r, query, citedSamples: r.cited ? 1 : 0, samples: 1 };
}

type Collected = {
  pplx: LlmRow[]; gpt: LlmRow[]; gemini: LlmRow[]; claude: LlmRow[];
  aio: CitRow[]; aimode: CitRow[];
  /** Engines that produced no data this run, with the reason. Reported as "not sampled", never as 0%. */
  unavailable: Record<string, string>;
};

// Engine tiers (19/09/2026, per referral-share studies): Tier 1 ChatGPT, Google AI Overviews + AI Mode, Gemini.
// Tier 2 Perplexity, Claude. Bing/Copilot is NOT sampled: the Bing SERP proxy (DataForSEO) returned unrelated
// results for every query on 19/09/2026 and Copilot has no answer API, so reporting it would be fiction.
async function collectCitations(domain: string, queries: string[], samples: number): Promise<Collected> {
  const pplxKey = process.env.PPLX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const hasDFS = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
  const out: Collected = { pplx: [], gpt: [], gemini: [], claude: [], aio: [], aimode: [], unavailable: {} };
  const ordered = queries.slice(0, 6);
  const queue = [...ordered];
  const attempted = { pplx: 0, gpt: 0, gemini: 0, claude: 0, aio: 0, aimode: 0 };

  const worker = async () => {
    for (let query = queue.shift(); query !== undefined; query = queue.shift()) {
      const q = query;
      const [pplx, gpt, gemini, claude, aio, aimode] = await Promise.allSettled([
        pplxKey ? (attempted.pplx++, sampleLlm(domain, q, samples, () => queryPplxRaw(q, pplxKey))) : Promise.resolve(null),
        openaiKey ? (attempted.gpt++, sampleLlm(domain, q, samples, () => queryGPTRaw(q, openaiKey))) : Promise.resolve(null),
        geminiKey ? (attempted.gemini++, sampleLlm(domain, q, samples, () => queryGeminiRaw(q, geminiKey))) : Promise.resolve(null),
        claudeKey ? (attempted.claude++, sampleLlm(domain, q, Math.min(samples, 2), () => queryClaudeRaw(q))) : Promise.resolve(null),
        hasDFS ? (attempted.aio++, queryGoogleAIOverview(q)) : Promise.resolve({ text: "", sources: [], shown: false }),
        hasDFS ? (attempted.aimode++, queryGoogleAIMode(q)) : Promise.resolve({ text: "", sources: [], shown: false }),
      ]);
      if (pplx.status === "fulfilled" && pplx.value) out.pplx.push(pplx.value);
      if (gpt.status === "fulfilled" && gpt.value) out.gpt.push(gpt.value);
      if (gemini.status === "fulfilled" && gemini.value) out.gemini.push(gemini.value);
      if (claude.status === "fulfilled" && claude.value) out.claude.push(claude.value);
      // Google surfaces: a fetched SERP with no AI answer is a genuine "not shown" and counts as not cited
      if (aio.status === "fulfilled" && aio.value.shown) out.aio.push(serpRow(domain, q, aio.value.text, aio.value.sources));
      if (aimode.status === "fulfilled" && aimode.value.shown) out.aimode.push(serpRow(domain, q, aimode.value.text, aimode.value.sources));
    }
  };
  await Promise.all(Array.from({ length: Math.min(QUERY_CONCURRENCY, ordered.length) }, worker));

  const byQuery = (a: CitRow, b: CitRow) => ordered.indexOf(a.query) - ordered.indexOf(b.query);
  for (const k of ["pplx", "gpt", "gemini", "claude", "aio", "aimode"] as const) out[k].sort(byQuery);

  if (!pplxKey) out.unavailable.perplexity = "no PPLX_API_KEY";
  else if (attempted.pplx && !out.pplx.length) out.unavailable.perplexity = "API returned no data (check Perplexity key or quota)";
  if (!openaiKey) out.unavailable.chatgpt = "no OPENAI_API_KEY";
  else if (attempted.gpt && !out.gpt.length) out.unavailable.chatgpt = "API returned no data (check OpenAI credits)";
  if (!geminiKey) out.unavailable.gemini = "no GEMINI_API_KEY";
  else if (attempted.gemini && !out.gemini.length) out.unavailable.gemini = "API returned no data (check Gemini credits)";
  if (!claudeKey) out.unavailable.claude = "no ANTHROPIC_API_KEY";
  else if (attempted.claude && !out.claude.length) out.unavailable.claude = "API returned no data";
  if (!hasDFS) { out.unavailable.google_ai_overviews = "no DataForSEO credentials"; out.unavailable.google_ai_mode = "no DataForSEO credentials"; }
  return out;
}

type EngineStats = { cited: number; total: number; citedSamples: number; samples: number; rate: number };

/** cited/total = queries (majority-cited / checked); rate = % of all samples that cited the domain. */
function engineStats(rows: CitRow[]): EngineStats {
  const citedSamples = rows.reduce((a, r) => a + r.citedSamples, 0);
  const samples = rows.reduce((a, r) => a + r.samples, 0);
  return { cited: rows.filter((r) => r.cited).length, total: rows.length, citedSamples, samples, rate: samples ? Math.round((citedSamples / samples) * 100) : 0 };
}

const stripAnswer = ({ query, cited, citedSamples, samples, competitors, competitorUrls, sources }: CitRow): CitRow =>
  ({ query, cited, citedSamples, samples, competitors, competitorUrls, sources });

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
    addCost("perplexity", perplexityCost(data.usage));
    const answer: string = data.choices?.[0]?.message?.content ?? "";
    const citations: string[] = (data.citations ?? []).map((c: any) => typeof c === "string" ? c : (c.url ?? "")).filter(Boolean);
    return { answer, citations };
  } catch { return { answer: "", citations: [] }; }
}

/** ChatGPT via the Responses API with the web search tool (gpt-4o-mini-search-preview was deprecated by 19/09/2026). */
async function queryGPTRaw(question: string, key: string): Promise<{ answer: string; citations: string[] }> {
  const model = process.env.OPENAI_SEARCH_MODEL || "gpt-4.1-mini";
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, tools: [{ type: "web_search" }], input: question, max_output_tokens: 700 }),
      signal: AbortSignal.timeout(40000),
    });
    if (!res.ok) return { answer: "", citations: [] };
    const data = await res.json() as any;
    if (data?.error) return { answer: "", citations: [] };
    addCost("openai", openaiSearchCost(data.usage));
    const messages: any[] = (data.output ?? []).filter((o: any) => o.type === "message");
    const answer: string = messages.flatMap((m: any) => (m.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text ?? "")).join("");
    const citations: string[] = messages
      .flatMap((m: any) => (m.content ?? []).flatMap((c: any) => c.annotations ?? []))
      .filter((a: any) => a.type === "url_citation")
      .map((a: any) => a.url ?? "")
      .filter(Boolean);
    return { answer, citations: [...new Set(citations)] };
  } catch { return { answer: "", citations: [] }; }
}

type GoogleAnswer = { text: string; sources: string[]; shown: boolean };

function markdownLinks(md: string): string[] {
  return [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
}

function dfsAuth(): string | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return Buffer.from(`${login}:${password}`).toString("base64");
}

/** Google AI Overview for the query. The /regular endpoint never returned one; /advanced with load_async_ai_overview does. */
async function queryGoogleAIOverview(query: string): Promise<GoogleAnswer> {
  const auth = dfsAuth();
  if (!auth) return { text: "", sources: [], shown: false };
  try {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: query, location_code: 2840, language_code: "en", device: "desktop", depth: 10, load_async_ai_overview: true }]),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { text: "", sources: [], shown: false };
    const data = await res.json() as any;
    addCost("dataforseo", Number(data.tasks?.[0]?.cost) || 0);
    if (data.tasks?.[0]?.status_code !== 20000) return { text: "", sources: [], shown: false };
    const items: any[] = data.tasks?.[0]?.result?.[0]?.items ?? [];
    const aio = items.find((item: any) => item.type === "ai_overview");
    if (!aio) return { text: "", sources: [], shown: false };
    const text: string = aio.markdown ?? aio.text ?? (aio.items ?? []).map((i: any) => i.text ?? "").join(" ");
    const sources: string[] = [
      ...(aio.references ?? []).map((i: any) => i.url ?? ""),
      ...(aio.items ?? []).flatMap((i: any) => (i.references ?? []).map((r: any) => r.url ?? "")),
      ...markdownLinks(text),
    ].filter(Boolean);
    return { text, sources: [...new Set(sources)], shown: true };
  } catch { return { text: "", sources: [], shown: false }; }
}

/** Google AI Mode answer for the query (DataForSEO serp/google/ai_mode). */
async function queryGoogleAIMode(query: string): Promise<GoogleAnswer> {
  const auth = dfsAuth();
  if (!auth) return { text: "", sources: [], shown: false };
  try {
    const res = await fetch("https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([{ keyword: query, location_code: 2840, language_code: "en" }]),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { text: "", sources: [], shown: false };
    const data = await res.json() as any;
    addCost("dataforseo", Number(data.tasks?.[0]?.cost) || 0);
    if (data.tasks?.[0]?.status_code !== 20000) return { text: "", sources: [], shown: false };
    const items: any[] = data.tasks?.[0]?.result?.[0]?.items ?? [];
    const answer = items.find((item: any) => item.type === "ai_overview" || item.type === "ai_mode");
    if (!answer) return { text: "", sources: [], shown: false };
    const text: string = answer.markdown ?? answer.text ?? "";
    const sources: string[] = [
      ...(answer.references ?? []).map((i: any) => i.url ?? ""),
      ...(answer.items ?? []).flatMap((i: any) => (i.references ?? []).map((r: any) => r.url ?? "")),
      ...markdownLinks(text),
    ].filter(Boolean);
    return { text, sources: [...new Set(sources)], shown: true };
  } catch { return { text: "", sources: [], shown: false }; }
}

/** Gemini with Google Search grounding. Grounding chunks carry a redirect URI and the source domain as title. */
async function queryGeminiRaw(question: string, key: string): Promise<{ answer: string; citations: string[] }> {
  const model = process.env.GEMINI_MODEL || "gemini-flash-latest";
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: question }] }], tools: [{ google_search: {} }] }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return { answer: "", citations: [] };
    const data = await res.json() as any;
    addCost("gemini", geminiGroundedCost(data.usageMetadata));
    const cand = data.candidates?.[0];
    const answer: string = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    const citations: string[] = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c: any) => {
        const title: string = c.web?.title ?? "";
        const uri: string = c.web?.uri ?? "";
        return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(title) ? `https://${title}/` : uri;
      })
      .filter(Boolean);
    return { answer, citations };
  } catch { return { answer: "", citations: [] }; }
}

/** Claude with the web search tool. Sources come from the search result blocks and the text citations. */
async function queryClaudeRaw(question: string): Promise<{ answer: string; citations: string[] }> {
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 } as any],
      messages: [{ role: "user", content: question }],
    });
    addCost("anthropic", anthropicCost("claude-haiku-4-5-20251001", res.usage as any));
    const blocks: any[] = res.content as any[];
    const answer = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const citations: string[] = [];
    for (const b of blocks) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r?.url) citations.push(r.url);
      if (b.type === "text" && Array.isArray(b.citations)) for (const c of b.citations) if (c?.url) citations.push(c.url);
    }
    return { answer, citations: [...new Set(citations)] };
  } catch { return { answer: "", citations: [] }; }
}

async function runCheckLiveCitations(input: Record<string, any>): Promise<string> {
  const { domain, queries, caller_id } = input as { domain: string; queries: string[]; caller_id?: string };
  const samples = Math.max(1, Number(input.samples) || CITATION_SAMPLES);
  if (!process.env.PPLX_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return "No citation API keys configured (PPLX_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or ANTHROPIC_API_KEY required).";
  }
  if (!queries?.length) return "queries array is required";

  const c = await collectCitations(domain, queries, samples);
  const engines: { key: keyof Collected & string; label: string; rows: CitRow[]; llm: boolean; unavailableKey: string }[] = [
    { key: "gpt", label: "ChatGPT", rows: c.gpt, llm: true, unavailableKey: "chatgpt" },
    { key: "gemini", label: "Gemini", rows: c.gemini, llm: true, unavailableKey: "gemini" },
    { key: "aio", label: "Google AI Overviews", rows: c.aio, llm: false, unavailableKey: "google_ai_overviews" },
    { key: "aimode", label: "Google AI Mode", rows: c.aimode, llm: false, unavailableKey: "google_ai_mode" },
    { key: "pplx", label: "Perplexity", rows: c.pplx, llm: true, unavailableKey: "perplexity" },
    { key: "claude", label: "Claude", rows: c.claude, llm: true, unavailableKey: "claude" },
  ];
  const stats = Object.fromEntries(engines.map((e) => [e.key, engineStats(e.rows)])) as Record<string, EngineStats>;
  const measured = engines.filter((e) => !c.unavailable[e.unavailableKey] && e.rows.length);
  const allCompetitors = [...new Set(engines.flatMap((e) => e.rows).flatMap((r) => r.competitors))].slice(0, 8);
  const zeroCitations = measured.length > 0 && measured.every((e) => stats[e.key].citedSamples === 0);
  const timestamp = new Date().toISOString();

  // Sentiment analysis — batch all LLM answers with text into one Haiku call
  const llmRows = (rows: LlmRow[], engine: string) => rows.map((r) => ({ query: r.query, engine, answer: r.answer, cited: r.cited }));
  const sentimentResults = await classifyAnswerSentiment(domain, [
    ...llmRows(c.pplx, "perplexity"), ...llmRows(c.gpt, "chatgpt"), ...llmRows(c.gemini, "gemini"), ...llmRows(c.claude, "claude"),
  ]);

  // Persist to citation_history when caller_id is provided
  let deltaSection = "";
  if (caller_id) {
    try {
      const { data: existing } = await db.from("caller_memory").select("citation_history").eq("caller_id", caller_id).single();
      const prevHistory: any[] = (existing as any)?.citation_history ?? [];
      const snapshot = {
        timestamp,
        domain,
        perplexity: { ...stats.pplx, results: c.pplx.map(stripAnswer) },
        chatgpt: { ...stats.gpt, results: c.gpt.map(stripAnswer) },
        gemini: { ...stats.gemini, results: c.gemini.map(stripAnswer) },
        claude: { ...stats.claude, results: c.claude.map(stripAnswer) },
        googleAIO: { ...stats.aio },
        googleAIMode: { ...stats.aimode },
        unavailable: c.unavailable,
        answers: {
          perplexity: c.pplx.map(({ query, answer }) => ({ query, answer: answer.slice(0, 1000) })),
          chatgpt: c.gpt.map(({ query, answer }) => ({ query, answer: answer.slice(0, 1000) })),
          gemini: c.gemini.map(({ query, answer }) => ({ query, answer: answer.slice(0, 1000) })),
          claude: c.claude.map(({ query, answer }) => ({ query, answer: answer.slice(0, 1000) })),
        },
        sentiment: sentimentResults,
        competitors: allCompetitors,
      };
      await db.from("caller_memory").upsert(
        { caller_id, citation_history: [...prevHistory, snapshot].slice(-20), updated_at: timestamp },
        { onConflict: "caller_id" }
      );

      const prevRun = [...prevHistory].reverse().find((h) => h.domain === domain);
      if (prevRun) {
        const prevDate = new Date(prevRun.timestamp).toLocaleDateString("en-AU");
        const fmt = (n: number) => n > 0 ? `+${n}` : `${n}`;
        const prevRate = (p: any): number | null =>
          typeof p?.rate === "number" ? p.rate : p?.total ? Math.round((p.cited / p.total) * 100) : null;
        const noise = (st: EngineStats) => Math.round(100 / Math.sqrt(Math.max(st.samples, 1)));
        const lines: string[] = [];
        let net = 0; let anyReal = false;
        for (const e of engines) {
          const now = stats[e.key];
          const prevKey = e.key === "pplx" ? "perplexity" : e.key === "gpt" ? "chatgpt" : e.key === "aio" ? "googleAIO" : e.key === "aimode" ? "googleAIMode" : e.key;
          const was = prevRate(prevRun[prevKey]);
          if (was === null || !now.samples) { lines.push(`${e.label}: no comparable data`); continue; }
          const diff = now.rate - was;
          const real = Math.abs(diff) > noise(now);
          net += diff; anyReal = anyReal || real;
          lines.push(`${e.label}: ${fmt(diff)}pp (${was}% → ${now.rate}%, n=${now.samples}${real ? "" : `, within noise ±${noise(now)}pp`})`);
        }
        const verdict = !anyReal ? "No change beyond sampling noise since last check." : net > 0 ? "📈 Citation presence improving." : "📉 Citation presence declined.";
        deltaSection = `\n\n## DELTA VS PREVIOUS RUN (${prevDate})\n${lines.join("\n")}\n${verdict}`;
      } else {
        deltaSection = "\n\n## DELTA VS PREVIOUS RUN\nFirst run for this domain — no previous data to compare.";
      }
    } catch {}
  }

  const llmLine = (st: EngineStats) => `${st.rate}% citation rate (${st.citedSamples}/${st.samples} samples across ${st.total} queries)`;
  const serpLine = (st: EngineStats) => `${st.cited}/${st.total} queries cited`;
  const sampleNote = (r: CitRow) => r.samples > 1 ? ` — ${r.citedSamples}/${r.samples} samples cited` : "";
  const summaryLine = (e: typeof engines[number]) => {
    const reason = c.unavailable[e.unavailableKey];
    if (reason) return `${e.label}: NOT SAMPLED (${reason})`;
    if (!e.rows.length) return `${e.label}: NOT SAMPLED (${e.llm ? "no answers returned" : "no AI answer shown for these queries"})`;
    return `${e.label}: ${e.llm ? llmLine(stats[e.key]) : serpLine(stats[e.key])}`;
  };
  const maxSamples = Math.max(1, ...measured.map((e) => stats[e.key].samples));
  const lines: string[] = [
    `## Live Citation Check — ${domain}`,
    ...engines.map(summaryLine),
    `Method: ${samples} samples per query on ChatGPT, Gemini and Perplexity (Claude up to 2), one fetch per query for Google AI Overviews and AI Mode (✅ = cited in a majority of samples); a change under ~${Math.round(100 / Math.sqrt(maxSamples))}pp between runs is within sampling noise. Engines marked NOT SAMPLED returned nothing and must be reported as unknown, never as 0%. Bing/Copilot is not measured (no reliable source).`,
    "",
    ...engines.flatMap((e) => e.rows.map((r) =>
      `${r.cited ? "✅" : "❌"} [${e.label}] "${r.query}"${sampleNote(r)}\n   ${r.cited ? `Cited: ${r.sources.join(", ")}` : `Cited instead: ${(r.competitorUrls.length ? r.competitorUrls : r.competitors).join(", ") || "none identified"}`}`
    )),
    "",
    allCompetitors.length ? `Competitor domains appearing instead: ${allCompetitors.join(", ")}` : "",
    "",
    zeroCitations
      ? `⚠️ ${domain} has ZERO citations across every engine that returned data (${measured.map((e) => e.label).join(", ")}). This is the #1 priority finding in this audit.`
      : `Citation presence: ` + engines.map((e) => c.unavailable[e.unavailableKey] || !e.rows.length ? `${e.label} not sampled` : e.llm ? `${e.label} ${stats[e.key].rate}% (n=${stats[e.key].samples})` : `${e.label} ${stats[e.key].cited}/${stats[e.key].total}`).join(" | ") + ".",
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
  gemini: EngineStats & { results: CitRow[] };
  claude: EngineStats & { results: CitRow[] };
  googleAIO: EngineStats & { results: CitRow[] };
  googleAIMode: EngineStats & { results: CitRow[] };
  unavailable: Record<string, string>;
  competitors: string[];
  sentiment: SentimentResult[];
};

/** Single-sample check — share-of-voice runs 2–5 brands in parallel, so sampling is kept at 1 to bound cost. */
export async function checkCitationsRaw(domain: string, queries: string[]): Promise<CitationSnapshot> {
  const c = await collectCitations(domain, queries, 1);
  const all = [...c.pplx, ...c.gpt, ...c.gemini, ...c.claude, ...c.aio, ...c.aimode];
  const allCompetitors = [...new Set(all.flatMap((r) => r.competitors))].slice(0, 8);
  const llmRows = (rows: LlmRow[], engine: string) => rows.map((r) => ({ query: r.query, engine, answer: r.answer, cited: r.cited }));
  const sentiment = await classifyAnswerSentiment(domain, [
    ...llmRows(c.pplx, "perplexity"), ...llmRows(c.gpt, "chatgpt"), ...llmRows(c.gemini, "gemini"), ...llmRows(c.claude, "claude"),
  ]);
  return {
    domain,
    perplexity: { ...engineStats(c.pplx), results: c.pplx.map(stripAnswer) },
    chatgpt: { ...engineStats(c.gpt), results: c.gpt.map(stripAnswer) },
    gemini: { ...engineStats(c.gemini), results: c.gemini.map(stripAnswer) },
    claude: { ...engineStats(c.claude), results: c.claude.map(stripAnswer) },
    googleAIO: { ...engineStats(c.aio), results: c.aio },
    googleAIMode: { ...engineStats(c.aimode), results: c.aimode },
    unavailable: c.unavailable,
    competitors: allCompetitors,
    sentiment,
  };
}
