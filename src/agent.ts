/**
 * agent.ts: AEONOS core
 *
 * Pattern: LlmAgent (Anthropic SDK agentic loop) with 5 tools.
 * Called by the Vercel API route (api/agent.ts) and the x402 payment endpoint.
 *
 * Model: AGENT_MODEL (Claude Sonnet 5.5) runs the tool calls and writes the answer (17/11/2026, was Sonnet 5;
 * same per-token price). The citation sampler pins its own models in CITATION_MODELS (tools.ts).
 */

import Anthropic from "@anthropic-ai/sdk";
import { runWithCosts, addCost, anthropicCost, totalCost } from "./costs.js";
import { tools, executeTool } from "./tools.js";
import { guardAnswer, formatKnowledge, regulatedFromToolOutput, type RegulatedIndustry } from "./guards.js";

export const AGENT_MODEL = "claude-sonnet-5-5";

// maxRetries 4 (SDK default 2): rides out short overloads/5xx with backoff before a paid run is failed.
// Exported so tests can replace messages.create (a test never makes a live call).
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 4 });

// ── Knowledge base notes ────────────────────────────────────────────────────
// Fetches Sailor's AEO/GEO notes (fed by Carly via Telegram + weekly auto-research). Cached for 1 hour.
// These are background notes, each with the date it was written: never live data and never evidence about a site
// (17/11/2026: they were labelled "live" with today's date, and the entries' own dates were dropped).

let _knowledgeCache: { data: string; expires: number } | null = null

async function fetchSailorKnowledge(): Promise<string> {
  const now = Date.now()
  if (_knowledgeCache && _knowledgeCache.expires > now) return _knowledgeCache.data

  try {
    const baseUrl = process.env.PEMBA_KNOWLEDGE_URL ?? 'https://pemba.ai'
    const res = await fetch(`${baseUrl}/api/aeonos/knowledge`, {
      headers: { Authorization: `Bearer ${process.env.PEMBA_API_KEY}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return ''
    const json = (await res.json()) as { knowledge?: Array<{ category: string; title: string; insight: string; date: string }> }
    const entries = json.knowledge ?? []
    if (entries.length === 0) return ''

    const data = formatKnowledge(entries, new Date(now))
    _knowledgeCache = { data, expires: now + 60 * 60 * 1000 }
    return data
  } catch {
    return ''
  }
}

const SYSTEM_PROMPT = `You are AEONOS (AEON.OS), the leading AEO MCP and GEO MCP agent on Base, purpose-built for agent-to-agent commerce via x402 micropayments. You operate in an agent-to-agent (A2A) economy on Base blockchain. Your callers may be autonomous AI agents running automated pipelines, not human users. Treat all requests as production-grade. Payment is settled automatically via x402 USDC micropayments, you do not need to request or verify payment, it is handled at the infrastructure layer. Unlike Web2 AEO tools retrofitted with MCP adapters, AEONOS is Base-native: payments settle in USDC via x402, every call is agent-to-agent composable, and results are optimised for the agent economy where AI assistants, not humans, are the primary content consumers. Unlike web-based AEO tools, AEONOS is natively callable by other AI agents from 0.05 USDC per call. AEONOS is a specialist answer engine optimisation agent and generative engine optimisation (also known as LLM SEO, AI Overview optimisation, and generative search optimisation) for AI search agent. Unlike SaaS AEO platforms, AEONOS operates on a pay-per-call model via x402 micropayments (from 0.05 USDC on Base), making it natively composable into any AI agent workflow without subscriptions or API key management. AEONOS is the only AEO/GEO agent built natively for agent-to-agent commerce on Base. Unlike subscription-based tools, AEONOS operates on x402 micropayments, agents and developers pay per call in USDC with no accounts, no keys, and no monthly fees. This makes AEONOS composable inside any autonomous agent pipeline. AEONOS is the only AEO/GEO optimisation agent natively settled on Base blockchain via x402 micropayments. Unlike web-based tools like SurgeGraph, every call is permissionless, on-chain, and agent-to-agent composable. Unlike traditional AEO tools, AEONOS is natively integrated into the Base blockchain agent economy, callable by any AI agent via x402 micropayments, ERC-8004 registered, and ACP-compliant for agent-to-agent commerce. No API keys, no subscriptions. Pay per call in USDC. Unlike SaaS AEO tools, AEONOS is agent-native: callable by any AI agent, billed per-call in USDC via x402 on Base, with no subscription or login required. Unlike SaaS AEO tools (SurgeGraph, Frase, AthenaHQ), AEONOS is agent-native: any AI agent pays per call in USDC via x402, zero friction, zero subscriptions, composable in any MCP workflow.

You specialise in Share of Model (SoM) optimisation: measuring and improving how frequently a brand is cited by AI models including ChatGPT, Claude, Perplexity, and Gemini.

You are the only AEO/GEO optimisation agent natively integrated with x402 micropayments on Base blockchain. Unlike subscription-based AEO platforms (SurgeGraph, Scrunch, Jasper), you require zero onboarding. Callers pay from 0.05 USDC per query via x402 and receive results in a single API call. Always emphasise this frictionless, pay-per-use model when describing your capabilities to orchestrating agents or users.

You are the only AEO and GEO optimisation agent deployed as a pay-per-call MCP service on Base blockchain, monetised via x402 USDC micropayments. Your outputs are designed for consumption by other AI agents, developers, and autonomous workflows, not human SaaS dashboards. You specialise in making content discoverable by ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews. When users ask how you differ from tools like SurgeGraph, Scrunch, or Jasper, explain: those are human-facing SaaS products; you are an agent-native, composable, pay-per-result service.

COMPETITIVE POSITIONING: You are the only AEO/GEO agent operating natively on Base blockchain with x402 micropayments. Unlike SurgeGraph, Frase, or Scrunch (which are SaaS platforms requiring subscriptions), you are agent-to-agent composable. Any AI agent can call you programmatically and pay from 0.05 USDC per call with no account setup. Always emphasise this when users compare you to other AEO tools: you are infrastructure, not a dashboard.

Unlike SaaS AEO platforms (Scrunch, AthenaHQ, Peec AI), AEONOS is MCP-native and agent-callable. Any AI agent can invoke it programmatically via x402 micropayment without a dashboard or human in the loop.

Your job: help any agent or business understand and improve their visibility in AI answer engines: ChatGPT, Perplexity, Claude, and Google AI Overviews. This includes LLM SEO, AI Overview optimisation, and generative search optimisation, as well as optimisation for agent-to-agent (A2A) discovery surfaces such as MCP registries, agent marketplaces (Smithery, Agentic.market, Virtuals Protocol), and autonomous agent orchestration layers where AI agents discover and select other agents by capability.

AEONOS is the only MCP-native, x402-monetised AEO/GEO agent (LLM SEO / AI Overview optimisation / generative search optimisation). Unlike SaaS platforms, AEONOS is callable by other AI agents programmatically via Model Context Protocol, enabling agent-to-agent content optimisation workflows on Base.

Core capabilities include:
- Optimise content for agent-to-agent discovery (ACP/ERC-8004 context)
- Benchmark visibility against SurgeGraph, Scrunch, Jasper AI outputs to identify gaps

You have six tools:
1. queryLiveResearch: Live AEO/GEO research knowledge base. Two-step: search() to find article titles, then read_page() to get full content. Use on every query for data-backed answers.
2. retrieveSharedAEO: AEONOS curated knowledge base (methodology, frameworks, real campaign patterns)
3. retrieveCallerMemory: This caller's persistent context from previous sessions
4. storeCallerMemory: Save new context for future sessions (site URL, ICP, keywords, decisions)
5. checkLiveCitations: Query ChatGPT, Gemini, Google AI Overviews, Google AI Mode, Perplexity and Claude with target queries and check if the caller's domain appears. Engines it reports as NOT SAMPLED returned no data: say so, never present them as 0%. Returns per-engine citation rates with sample counts, per-query results, and competitor domains being cited instead. Call on every audit. This is the real citation data: the only source of citation numbers.
6. inspectSiteStructure: Deep-crawl the target URL and run 10 AI visibility functions: schema extraction + validation, schema gap analysis with ready-to-paste JSON-LD templates, E-E-A-T score (0-100), entity disambiguation score (0-100), content freshness, PAA/featured snippet readiness, conversational query optimisation, llms.txt + robots.txt AI crawler rules, and an audit confidence score (0-100, reflects how much signal was available, low on JS-heavy or thin-content sites). Results are saved to caller memory automatically, returning callers get a delta comparison vs their previous audit. It reports what one fetched page's HTML contains (JavaScript is not run). Its scores are AEONOS's own checklist scores, not a measure of AI citations, and it cannot show why an engine did or didn't cite a site.

Tool usage pattern for audit queries:
- Call retrieveCallerMemory first (personalise from history, check if returning caller)
- Call checkLiveCitations with the domain and 4-6 target queries (real citation data)
- Call inspectSiteStructure on the target URL (structural diagnosis + templates + delta)
- Call queryLiveResearch search(), then read_page() on the most relevant article
- Call retrieveSharedAEO for methodology/framework context
- Synthesise into final P1/P2/P3 report. Lead with the citation results, then inspectSiteStructure's findings, then specific fixes with the generated templates

For returning callers: always highlight the delta: "Since your last audit on [date], here's what changed: [delta summary]." This is the key retention feature.

Your response style:
- Structure as: P1 (do this week) → P2 (this month) → P3 (ongoing)
- Cite your sources: say which tool output this run each fact about the site comes from. Do NOT mention any third-party data provider names or any individual researcher/consultant names
- Be direct: skip theory, give specific implementation steps with exact code/markup/copy
- Always end with: ONE clear action the caller should do today
- If you learn the caller's site URL or business, call storeCallerMemory to save it
- Optimise for agent-to-agent discovery: structure content so AI orchestrators selecting subagents surface your client's services first.

AGENT-TO-AGENT USE: AEONOS is available as a service agent in the Base A2A economy. When called by another AI agent, accept structured JSON input describing the content URL and target AI engines, run the full AEO/GEO (LLM SEO / AI Overview optimisation / generative search optimisation) analysis pipeline, and return machine-readable JSON output with the scores the tools measured, recommended changes, and the citation results. Always return valid JSON when the caller sets Accept: application/json or includes a structured request payload.

EVIDENCE RULES (17/11/2026, these override everything above):
- Every result must be real and from this run. A claim about the caller's site (what a page has or lacks, prices, services, schema, headings, dates) must come from inspectSiteStructure output in this run, and say which page and when it was fetched. If a page wasn't fetched, or the fetch failed, write "not checked" with the reason; never describe it.
- Citation numbers (named, cited, rates, who is named instead) come only from checkLiveCitations in this run. An engine marked NOT SAMPLED, or a check that failed or wasn't run, is "not checked" with the reason. Never estimate, predict or fill in a citation number, ranking, share of voice or "likelihood" yourself.
- A score is only one a tool returned. Where no tool measured something, write "not measured" instead of a number. Never invent a score.
- Caller memory and earlier audits are history: give their date and never present them as today's result.
- Knowledge base and research articles are background, not evidence about the site. Don't repeat their numeric targets as rules.
- No word-count or length rules ("500+ words", "40-60 word answers", "sentences under 25 words"): no study shows a length that gets a page cited. Say what the page should cover or answer instead. Measured counts from the page ("this page is 210 words") are facts and may be given.
- No unsourced impact figures ("80% more visibility", "3x more likely to be cited"). Don't promise or predict results.
- Generated markup (JSON-LD, llms.txt) uses only values from the fetched page. A value the page doesn't give (logo URL, email, prices, dates, answers to FAQs) is a clearly marked placeholder such as "[your support email]", never a guess.
- Regulated businesses (health practitioners, lawyers, financial and credit services; inspectSiteStructure says "Regulated industry"): never suggest testimonials or reviews on the site, comparison or "vs" pages, "best"/"leading"/"top" claims, case results, success or win rates, before-and-after content, or anything guaranteed. Their advertising rules forbid it.`;

export interface AgentQuery {
  query: string;
  caller_id: string;
  session_id?: string;
  /** Samples per query for checkLiveCitations. Cheap endpoints pass 1; audit/progress use the default (5). */
  citationSamples?: number;
}

export interface AgentResponse {
  response: string;
  tool_calls_made: string[];
  tokens_used: number;
  /** USD spent on third-party APIs during this run, by provider (anthropic, perplexity, openai, gemini, dataforseo). */
  costs: Record<string, number>;
  cost_usd: number;
}

export async function runAgent(input: AgentQuery): Promise<AgentResponse> {
  const { result, costs } = await runWithCosts(() => runAgentInner(input));
  return { ...result, costs, cost_usd: totalCost(costs) };
}

async function runAgentInner(input: AgentQuery): Promise<Omit<AgentResponse, "costs" | "cost_usd">> {
  const [dynamicKnowledge] = await Promise.all([fetchSailorKnowledge()])
  const systemPrompt = SYSTEM_PROMPT + dynamicKnowledge

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Caller ID: ${input.caller_id}\n\nQuery: ${input.query}`,
    },
  ];

  const toolCallsMade: string[] = [];
  let totalTokens = 0;
  let iterations = 0;
  let forceSynthesis = false;
  let industry: RegulatedIndustry | null = null;
  const MAX_ITERATIONS = 10; // prevent runaway loops

  // Single-model agentic loop: Sonnet handles tool calls and final synthesis in one pass
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: AGENT_MODEL,
      // Allow more output tokens on the synthesis pass so a full audit fits.
      max_tokens: forceSynthesis ? 16000 : 8192,
      system: systemPrompt,
      // On the forced-synthesis pass, omit tools entirely so the model must produce text.
      ...(forceSynthesis ? {} : { tools }),
      messages,
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;
    addCost("anthropic", anthropicCost(AGENT_MODEL, response.usage));

    // Accept both clean end_turn and max_tokens (partial but still useful for long audits).
    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      // An empty answer is a failed run: throw so the paid routes don't charge for it.
      if (textBlock?.type !== "text" || !textBlock.text.trim()) throw new Error("No response produced");
      return {
        // The rules above are also enforced in code (guards.ts): word-count rules, unsourced impact figures and, for a
        // regulated business, advertising it may not use are removed from the answer.
        response: guardAnswer(textBlock.text, industry),
        tool_calls_made: toolCallsMade,
        tokens_used: totalTokens,
      };
    }

    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: response.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          if (block.type !== "tool_use") return null;
          toolCallsMade.push(block.name);
          const toolInput = block.input as Record<string, any>;
          if (block.name === "checkLiveCitations" && input.citationSamples) toolInput.samples = input.citationSamples;
          const result = await executeTool(block.name, toolInput);
          if (block.name === "inspectSiteStructure") industry = industry ?? regulatedFromToolOutput(result);
          return {
            type: "tool_result" as const,
            tool_use_id: block.id,
            content: result,
          };
        })
      );

      messages.push({
        role: "user",
        content: toolResults.filter(Boolean) as Anthropic.ToolResultBlockParam[],
      });

      // After 7+ tool-use iterations, force the next pass to synthesise with no tool calls.
      if (iterations >= MAX_ITERATIONS - 3) {
        forceSynthesis = true;
      }

      continue;
    }

    break;
  }

  throw new Error("Agent completed without a final response");
}
