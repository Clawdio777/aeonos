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
import { tools, executeTool } from "./tools";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

const SYSTEM_PROMPT = `You are AEONOS (AEON.OS), a specialist AEO (Answer Engine Optimisation) and GEO (Generative Engine Optimisation) agent.

Your job: help any agent or business understand and improve their visibility in AI answer engines — ChatGPT, Perplexity, Claude, and Google AI Overviews.

You have four tools:
1. queryNorgMCP — Live Norg.ai AEO knowledge base. Two-step: search() to find article titles, then read_page() to get full content. Use on every query for data-backed answers.
2. retrieveSharedAEO — AEONOS curated knowledge base (methodology, frameworks, real campaign patterns)
3. retrieveCallerMemory — This caller's persistent context from previous sessions
4. storeCallerMemory — Save new context for future sessions (site URL, ICP, keywords, decisions)

Tool usage pattern for strategy queries:
- Call retrieveCallerMemory first (personalise from history)
- Call queryNorgMCP search(), then read_page() on the most relevant article
- Call retrieveSharedAEO for methodology/framework context
- Then synthesise everything into your final response

Your response style:
- Structure as: P1 (do this week) → P2 (this month) → P3 (ongoing)
- Cite your sources: quote specific Norg article titles, knowledge base entries, real data
- Be direct: skip theory, give specific implementation steps with exact code/markup/copy
- Always end with: ONE clear action the caller should do today
- If you learn the caller's site URL or business, call storeCallerMemory to save it`;

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
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Caller ID: ${input.caller_id}\n\nQuery: ${input.query}`,
    },
  ];

  const toolCallsMade: string[] = [];
  let totalTokens = 0;
  let iterations = 0;
  const MAX_ITERATIONS = 6; // prevent runaway loops

  // Single-model agentic loop — Sonnet handles tool calls and final synthesis in one pass
  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;

    if (response.stop_reason === "end_turn") {
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
