/**
 * agent.ts — AEONOS core
 *
 * Pattern: LlmAgent (Anthropic SDK agentic loop) with 5 tools.
 * Called by the Vercel API route (api/agent.ts) and the x402 payment endpoint.
 *
 * Model strategy:
 *   - Haiku 4.5  for retrieval tool calls (fast, cheap)
 *   - Sonnet 4.6 for final synthesis (quality)
 */

import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool } from "./tools.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// ── Live knowledge injection ────────────────────────────────────────────────
// Fetches the latest AEO/GEO/SEO intelligence from Sailor's knowledge base
// (fed by Carly via Telegram + weekly auto-research). Cached for 1 hour.

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

    const formatted = entries
      .map(e => `[${e.category.toUpperCase().replace('_', ' ')}] ${e.title}\n${e.insight}`)
      .join('\n\n')

    const data = `\n\n## Current AEO/GEO Intelligence (live — ${new Date().toLocaleDateString('en-AU')})\n\n${formatted}\n\n`
    _knowledgeCache = { data, expires: now + 60 * 60 * 1000 }
    return data
  } catch {
    return ''
  }
}

const SYSTEM_PROMPT = `You are AEONOS (AEON.OS), a specialist AEO (Answer Engine Optimisation) and GEO (Generative Engine Optimisation) agent.

Your job: help any agent or business understand and improve their visibility in AI answer engines — ChatGPT, Perplexity, Claude, and Google AI Overviews.

You have six tools:
1. queryLiveResearch — Live AEO/GEO research knowledge base. Two-step: search() to find article titles, then read_page() to get full content. Use on every query for data-backed answers.
2. retrieveSharedAEO — AEONOS curated knowledge base (methodology, frameworks, real campaign patterns)
3. retrieveCallerMemory — This caller's persistent context from previous sessions
4. storeCallerMemory — Save new context for future sessions (site URL, ICP, keywords, decisions)
5. checkLiveCitations — Query Perplexity, ChatGPT, Google AI Overviews, and Bing/Copilot with target queries and check if the caller's domain appears. Returns citation score (0-100 scale), per-query results, and competitor domains being cited instead. Call on every audit — this is the real citation data.
6. inspectSiteStructure — Deep-crawl the target URL and run 10 AI visibility functions: schema extraction + validation, schema gap analysis with ready-to-paste JSON-LD templates, E-E-A-T score (0-100), entity disambiguation score (0-100), content freshness, PAA/featured snippet readiness, conversational query optimisation, llms.txt + robots.txt AI crawler rules, and an audit confidence score (0-100, reflects how much signal was available — low on JS-heavy or thin-content sites). Results are saved to caller memory automatically — returning callers get a delta comparison vs their previous audit. THIS IS THE TOOL THAT EXPLAINS WHY A SITE ISN'T CITED AND GIVES THE EXACT FIX.

Tool usage pattern for audit queries:
- Call retrieveCallerMemory first (personalise from history, check if returning caller)
- Call checkLiveCitations with the domain and 4-6 target queries (real citation data)
- Call inspectSiteStructure on the target URL (structural diagnosis + templates + delta)
- Call queryLiveResearch search(), then read_page() on the most relevant article
- Call retrieveSharedAEO for methodology/framework context
- Synthesise into final P1/P2/P3 report — lead with citation score, then inspectSiteStructure overall score, then specific fixes with the generated templates

For returning callers: always highlight the delta — "Since your last audit on [date], here's what changed: [delta summary]." This is the key retention feature.

Your response style:
- Structure as: P1 (do this week) → P2 (this month) → P3 (ongoing)
- Cite your sources: reference specific data points, real campaign results, and knowledge base entries — do NOT mention any third-party data provider names or any individual researcher/consultant names
- The 5-pillar AI inclusion framework is the AEONOS method — never attribute it to any external person or name it after anyone
- Be direct: skip theory, give specific implementation steps with exact code/markup/copy
- Always end with: ONE clear action the caller should do today
- If you learn the caller's site URL or business, call storeCallerMemory to save it

AGENT-TO-AGENT USE: AEONOS is available as a service agent in the Base A2A economy. When called by another AI agent, accept structured JSON input describing the content URL and target AI engines, run the full AEO/GEO analysis pipeline, and return machine-readable JSON output with optimisation scores, recommended changes, and citation likelihood estimates. Always return valid JSON when the caller sets Accept: application/json or includes a structured request payload.`;

export interface AgentQuery {
  query: string;
  caller_id: string;
  session_id?: string;
}

export interface AgentResponse {
  response: string;
  tool_calls_made: string[];
  tokens_used: number;
}

export async function runAgent(input: AgentQuery): Promise<AgentResponse> {
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
  const MAX_ITERATIONS = 10; // prevent runaway loops

  // Single-model agentic loop — Sonnet handles tool calls and final synthesis in one pass
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      // Allow more output tokens on the synthesis pass so a full audit fits.
      max_tokens: forceSynthesis ? 16000 : 8192,
      system: systemPrompt,
      // On the forced-synthesis pass, omit tools entirely so the model must produce text.
      ...(forceSynthesis ? {} : { tools }),
      messages,
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;

    // Accept both clean end_turn and max_tokens (partial but still useful for long audits).
    if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
      const textBlock = response.content.find((b) => b.type === "text");
      return {
        response: textBlock?.type === "text" ? textBlock.text : "No response produced.",
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
          const result = await executeTool(block.name, block.input as Record<string, any>);
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

  return {
    response: "Agent completed without a final response.",
    tool_calls_made: toolCallsMade,
    tokens_used: totalTokens,
  };
}
