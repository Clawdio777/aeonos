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

You have five tools:
1. queryNorgMCP — Live Norg.ai AEO intelligence (use this first on every query)
2. retrieveSharedAEO — AEONOS curated AEO/GEO knowledge base (methodology, patterns, frameworks)
3. retrieveCallerMemory — This caller's persistent context from previous sessions
4. storeCallerMemory — Save new context for future sessions
5. generateReport — Signal to synthesise everything into a structured P1/P2/P3 report

Your response style:
- Lead with action — P1 this week, P2 this month, P3 ongoing
- Cite sources (Norg data, knowledge base entries, real campaign results)
- Be direct: skip theory, give specific implementation steps
- When you give a recommendation, include the exact code/markup/copy where relevant
- Always end with: what the caller should do TODAY (one specific task)

Pricing reminder: Each query costs 0.05 USDC. Bulk (10+ queries/session) costs 0.03 USDC/query.`;

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

  // Agentic loop
  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",  // Fast for tool calls; switch to sonnet for final
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    totalTokens += response.usage.input_tokens + response.usage.output_tokens;

    // No tool use — this is the final response
    if (response.stop_reason === "end_turn") {
      const textBlock = response.content.find((b) => b.type === "text");
      const finalText = textBlock?.type === "text" ? textBlock.text : "";

      // For the final synthesis, use Sonnet if the response is a strategic report
      if (toolCallsMade.length > 0 && finalText.length < 200) {
        // Short response after tool calls — do a Sonnet synthesis pass
        const synthesis = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [
            ...messages,
            { role: "assistant", content: response.content },
            {
              role: "user",
              content:
                "Now synthesise all the data you retrieved into a complete, actionable AEO/GEO strategy response. Include specific implementation steps and end with one clear action for today.",
            },
          ],
        });
        totalTokens += synthesis.usage.input_tokens + synthesis.usage.output_tokens;
        const synthText = synthesis.content.find((b) => b.type === "text");
        return {
          response: synthText?.type === "text" ? synthText.text : finalText,
          tool_calls_made: toolCallsMade,
          tokens_used: totalTokens,
        };
      }

      return {
        response: finalText,
        tool_calls_made: toolCallsMade,
        tokens_used: totalTokens,
      };
    }

    // Tool use — execute all tool calls in parallel
    if (response.stop_reason === "tool_use") {
      const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

      // Add assistant message with tool calls
      messages.push({ role: "assistant", content: response.content });

      // Execute all tool calls in parallel
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

      // Add tool results
      messages.push({
        role: "user",
        content: toolResults.filter(Boolean) as Anthropic.ToolResultBlockParam[],
      });

      continue;
    }

    // Unexpected stop reason
    break;
  }

  return {
    response: "Agent completed without a final response.",
    tool_calls_made: toolCallsMade,
    tokens_used: totalTokens,
  };
}
