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

    // No tool use — tool gathering complete, run Sonnet synthesis
    if (response.stop_reason === "end_turn") {
      if (toolCallsMade.length > 0) {
        // Extract all tool results from messages as clean text for Sonnet
        const toolData: string[] = [];
        for (const msg of messages) {
          if (msg.role === "user" && Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (
                block.type === "tool_result" &&
                typeof block.content === "string" &&
                block.content.length > 10
              ) {
                toolData.push(block.content);
              }
            }
          }
        }

        const synthesis = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content:
                `Query: ${input.query}\n\n` +
                `Data retrieved from ${toolCallsMade.join(", ")}:\n\n` +
                toolData.join("\n\n---\n\n") +
                "\n\n---\n\n" +
                "Synthesise all of the above into a complete, actionable AEO/GEO strategy response. " +
                "Structure as P1 (this week) → P2 (this month) → P3 (ongoing). " +
                "Include specific implementation steps — exact code, markup, or copy where relevant. " +
                "Cite sources (Norg article titles, knowledge base entries). " +
                "End with ONE specific action for today.",
            },
          ],
        });

        totalTokens += synthesis.usage.input_tokens + synthesis.usage.output_tokens;
        const synthText = synthesis.content.find((b) => b.type === "text");
        return {
          response: synthText?.type === "text" ? synthText.text : "No synthesis produced.",
          tool_calls_made: toolCallsMade,
          tokens_used: totalTokens,
        };
      }

      // No tools called — direct Sonnet answer
      const textBlock = response.content.find((b) => b.type === "text");
      return {
        response: textBlock?.type === "text" ? textBlock.text : "No response produced.",
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
