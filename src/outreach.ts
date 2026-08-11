/**
 * outreach.ts — AEONOS distribution outreach content
 *
 * Pitch copy and target contacts for AEO tool roundup inclusion
 * and MCP directory submissions.
 */

// ── 150-word product brief ────────────────────────────────────────────────────

export const PRODUCT_BRIEF = `AEONOS (aeonos-mcp) is an agent-native AEO/GEO MCP server that makes any website citable by ChatGPT, Perplexity, Claude, and Google AI Overviews. Unlike SaaS platforms that require dashboard logins and monthly subscriptions, AEONOS is callable by any AI agent or developer via the Model Context Protocol — no accounts, no API keys, no lock-in.

Unique angle: pay-per-call pricing via x402 micropayments ($0.10 USDC on Base blockchain). Every audit call is permissionless and agent-to-agent composable, making AEONOS the first AEO/GEO tool purpose-built for autonomous agent pipelines and the agentic web.

Core capabilities: live citation checks across Perplexity, ChatGPT, Bing/Copilot and Google AI Overviews; JSON-LD schema generation; E-E-A-T scoring; llms.txt templates; and entity disambiguation analysis — all returned in a single MCP tool call.

npm: https://www.npmjs.com/package/aeonos-mcp
Marketplace: https://agentic.market/?search=aeonos`;

// ── Editor pitch ──────────────────────────────────────────────────────────────

export const AEONOS_PITCH = `Subject: Agent-Native AEO/GEO MCP Server Worth Adding to Your 2026 Roundup

Hi [Editor name],

I wanted to flag a gap in your 2026 AEO/GEO tools roundup: no MCP-native agents are listed.

AEONOS is the only AEO/GEO tool built as an MCP server with per-call USDC payments — no subscription, works inside Claude, Cursor, or any MCP client natively. Where every other AEO platform requires a dashboard login, AEONOS is callable programmatically by any AI agent via the Model Context Protocol, making it the first AEO tool purpose-built for the agentic web.

Key differentiators worth a line in your list:
• MCP-native: runs inside Claude/Cursor with zero setup
• Per-call USDC micropayments via x402 — no subscription lock-in
• Live citation checks across Perplexity, ChatGPT, Google AI Overviews, and Bing/Copilot
• Agent-to-agent compatible: other AI agents can invoke it autonomously

npm package: https://www.npmjs.com/package/aeonos-mcp
Marketplace listing: https://agentic.market/?search=aeonos

Happy to provide a product screenshot, demo, or a brief quote for the piece.

Best,
The AEONOS team`;

export const AEONOS_DIRECTORY_DESCRIPTION =
  "AEONOS — AEO/GEO optimisation agent. Optimise content for ChatGPT, Perplexity, Claude citations. Pay-per-call via x402 USDC on Base. No API keys required.";

export interface OutreachTarget {
  outlet: string;
  url: string;
  contactPath: string;
  notes: string;
}

export const ROUNDUP_TARGETS: OutreachTarget[] = [
  {
    outlet: "Scrunch",
    url: "https://scrunch.com",
    contactPath: "/blog",
    notes: "AEO/GEO tool coverage — request addition to 2026 AEO tools roundup via blog contact/contribute page",
  },
  {
    outlet: "Frase",
    url: "https://frase.io",
    contactPath: "/blog",
    notes: "Content/SEO audience — pitch as the MCP-native entry missing from their AEO list via blog contact/contribute page",
  },
  {
    outlet: "Surmado",
    url: "https://surmado.com",
    contactPath: "/blog",
    notes: "AEO/GEO roundup coverage — request inclusion in their AEO tools list via blog contact/contribute page; emphasise agent-native pay-per-call as a distinct category",
  },
  {
    outlet: "Writer",
    url: "https://writer.com",
    contactPath: "/blog",
    notes: "Enterprise AI writing — angle on agentic AEO for content teams",
  },
  {
    outlet: "toloka.ai",
    url: "https://toloka.ai",
    contactPath: "/blog/best-mcp-servers-for-ai-agents",
    notes: "Request AEONOS inclusion in top-20 MCP servers list — emphasise x402 pay-per-call and Base-native as unique category",
  },
  {
    outlet: "k2view",
    url: "https://k2view.com",
    contactPath: "/blog/awesome-mcp-servers",
    notes: "Request AEONOS inclusion in awesome-mcp-servers list — emphasise x402 pay-per-call and Base-native as unique category",
  },
];

export interface DirectorySubmission {
  directory: string;
  url: string;
  submissionPath: string;
  packageName?: string;
  description?: string;
  notes: string;
}

export const DIRECTORY_SUBMISSIONS: DirectorySubmission[] = [
  {
    directory: "MCP Manager",
    url: "https://mcpmanager.ai",
    submissionPath: "/submit",
    notes: "Submit aeonos-mcp npm package for MCP server directory listing",
  },
  {
    directory: "Skyvia MCP Blog",
    url: "https://skyvia.com",
    submissionPath: "/blog/best-mcp-servers",
    notes: "Request inclusion in 'Best MCP Servers' reference article",
  },
  {
    directory: "Smithery",
    url: "https://smithery.ai",
    submissionPath: "/server/new",
    packageName: "aeonos-mcp",
    description: AEONOS_DIRECTORY_DESCRIPTION,
    notes: "Submit aeonos-mcp npm package to Smithery at smithery.ai/server/new",
  },
  {
    directory: "mcpmarket.com",
    url: "https://mcpmarket.com",
    submissionPath: "/daily",
    description: AEONOS_DIRECTORY_DESCRIPTION,
    notes: "Submit to mcpmarket.com daily listing form using the standard directory description",
  },
];

// ── Farcaster casts ────────────────────────────────────────────────────────────

export type FarcasterCastType = "educational" | "data" | "demo";

export interface FarcasterCast {
  id: number;
  type: FarcasterCastType;
  account: string;
  text: string;
  tags: string[];
  channels: string[];
  replyTo?: string;
  schedulingNote: string;
}

export const FARCASTER_CASTS: FarcasterCast[] = [
  {
    id: 1,
    type: "educational",
    account: "BaseChain Labs",
    text: `AEO vs GEO vs LLM SEO — what's the difference?

• AEO (Answer Engine Optimisation): structure your content so AI engines extract it as a direct answer to a question
• GEO (Generative Engine Optimisation): optimise for citation inside AI-generated summaries across ChatGPT, Perplexity & Gemini
• LLM SEO: the umbrella — entity authority, schema markup, and llms.txt so language models discover and trust your brand

All three matter now. AEONOS audits all three in one call. basechainlabs.com

@bytebot @shoni.eth`,
    tags: ["@bytebot", "@shoni.eth"],
    channels: ["/base", "/mcp", "/ai-agents"],
    replyTo: "https://warpcast.com/bytebot/0x2aeaeb60",
    schedulingNote: "Post day 1. Reply directly into the bytebot/shoni.eth thread at warpcast.com/bytebot/0x2aeaeb60 to piggyback existing conversation.",
  },
  {
    id: 2,
    type: "data",
    account: "BaseChain Labs",
    text: `ChatGPT just crossed 900M users.

That's 900M people whose first answer to a brand question now comes from an AI — not a search results page.

If your brand isn't cited in those answers, you don't exist to nearly a billion potential customers.

AEONOS shows you exactly where you're invisible and gives you the schema, entity signals, and content fixes to change that. Pay per audit, no subscription. basechainlabs.com`,
    tags: [],
    channels: ["/base", "/mcp", "/ai-agents"],
    schedulingNote: "Post day 3 (48 hours after cast 1). Stand-alone cast — no reply thread needed.",
  },
  {
    id: 3,
    type: "demo",
    account: "BaseChain Labs",
    text: `We ran AEONOS on a real SaaS homepage.

AI visibility score: 34/100
→ No FAQ schema (P1 fix)
→ Entity disambiguation score: 41 — AI engines can't identify what the company does
→ 0 citations in Perplexity across 5 target queries
→ Competitors cited instead: 4 domains

Generated: missing JSON-LD, llms.txt template, 3 PAA-optimised content blocks.

That's one $0.10 call. basechainlabs.com`,
    tags: [],
    channels: ["/base", "/mcp", "/ai-agents"],
    schedulingNote: "Post day 5 or 7. Attach a screenshot of real AEONOS audit output — redact the client domain if needed. If a short screen-recording is available, attach that instead.",
  },
];

// ── Report builders ────────────────────────────────────────────────────────────

export function buildFarcasterCastReport(): string {
  const castLines = FARCASTER_CASTS.map((c) => {
    const replyLine = c.replyTo ? `\n  Reply to: ${c.replyTo}` : "";
    return [
      `### Cast ${c.id} — ${c.type.toUpperCase()} (${c.account})`,
      `Channels: ${c.channels.join(" · ")}`,
      `Scheduling: ${c.schedulingNote}${replyLine}`,
      "",
      c.text,
    ].join("\n");
  }).join("\n\n---\n\n");

  return ["## AEONOS Farcaster Casts — LLM SEO / AEO authority series", "", castLines].join("\n");
}

export function buildOutreachReport(): string {
  const targetLines = ROUNDUP_TARGETS.map(
    (t) => `• ${t.outlet} (${t.url}${t.contactPath}) — ${t.notes}`
  ).join("\n");

  const dirLines = DIRECTORY_SUBMISSIONS.map(
    (d) =>
      `• ${d.directory} (${d.url}${d.submissionPath})${d.packageName ? ` [npm: ${d.packageName}]` : ""}${d.description ? `\n  Description: "${d.description}"` : ""} — ${d.notes}`
  ).join("\n");

  return [
    "## AEONOS Distribution Outreach Package",
    "",
    "### Product Brief (150 words)",
    "",
    PRODUCT_BRIEF,
    "",
    "### Blog Editor Pitch (send to Scrunch / Frase / Surmado / Writer / toloka.ai / k2view)",
    "",
    AEONOS_PITCH,
    "",
    "### Roundup Targets",
    targetLines,
    "",
    "### MCP Directory Submissions",
    dirLines,
    "",
    "### Assets to attach",
    "• npm: https://www.npmjs.com/package/aeonos-mcp",
    "• Marketplace: https://agentic.market/?search=aeonos",
    "",
    buildFarcasterCastReport(),
  ].join("\n");
}
